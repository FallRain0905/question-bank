/**
 * 多渠道论文收集脚本（集成版）
 * 支持：arXiv + Semantic Scholar + PubMed + bioRxiv + OpenReview
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import {
  collectPapersFromMultipleSources,
  type PaperSource,
  type MultiSourceCollectorOptions,
} from './paper-sources';

config({ path: resolve(__dirname, '..', '.env.local') });

const CONFIG_PATH = resolve(__dirname, 'paper-collection-config.json');
const CONFIG = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// ======================== 工具函数 ========================

function getEnvValue(key: string): string | undefined {
  return process.env[key]?.trim() || undefined;
}

function calculatePaperScore(paper: PaperSource, keywords: string[]): number {
  const fullText = `${paper.title} ${paper.abstract}`.toLowerCase();
  let score = 0;

  for (const keyword of keywords) {
    const regex = new RegExp(keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (regex.test(paper.title)) {
      score += 2; // 标题匹配权重更高
    } else if (regex.test(paper.abstract)) {
      score += 1;
    }
  }

  // 引用数加分（Semantic Scholar）
  if (paper.citationCount && paper.citationCount > 0) {
    score += Math.min(Math.log10(paper.citationCount), 2);
  }

  // 最近发布加分
  const daysAgo = (Date.now() - new Date(paper.publishedDate || 0).getTime()) / (1000 * 60 * 60 * 24);
  if (daysAgo <= CONFIG.filtering.prefer_recent_days) {
    score += 1;
  }

  return score;
}

function filterPapers(papers: PaperSource[]): PaperSource[] {
  const keywords = CONFIG.filtering.keywords || [];
  const excludeKeywords = CONFIG.filtering.exclude_keywords || [];
  const minScore = CONFIG.filtering.min_score || 1;

  const filtered = papers
    .map((paper) => {
      const fullText = `${paper.title} ${paper.abstract}`.toLowerCase();

      // 排除关键词过滤
      for (const exclude of excludeKeywords) {
        const regex = new RegExp(exclude.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        if (regex.test(fullText)) {
          return null;
        }
      }

      const score = calculatePaperScore(paper, keywords);
      if (score < minScore) return null;

      return { paper, score };
    })
    .filter((item): item is { paper: PaperSource; score: number } => item !== null);

  // 按分数排序
  filtered.sort((a, b) => b.score - a.score);

  return filtered.slice(0, CONFIG.filtering.max_papers).map((item) => item.paper);
}

// ======================== LLM 摘要生成 ========================

interface LLMProvider {
  name: string;
  enabled: boolean;
  endpoint: string;
  model: string;
  apiKey: string;
  maxRetries: number;
}

function getEnabledLLMProviders(): LLMProvider[] {
  return CONFIG.llm.providers
    .filter((p: any) => p.enabled)
    .map((p: any) => {
      const apiKey = getEnvValue(p.api_key_env) || '';
      return {
        name: p.name,
        enabled: p.enabled && Boolean(apiKey),
        endpoint: p.endpoint,
        model: p.model,
        apiKey,
        maxRetries: p.max_retries || 3,
      };
    })
    .filter((p) => p.enabled);
}

interface SummaryResult {
  title_zh: string;
  points: string[];
}

async function summarizePaperWithRetry(
  title: string,
  abstract: string,
  providers: LLMProvider[]
): Promise<SummaryResult> {
  const prompt = `请将以下论文信息翻译和总结。

标题：${title}
摘要：${abstract}

请严格按以下 JSON 格式返回（不要加 markdown 代码块）：
{"title_zh": "中文翻译标题", "points": ["要点1", "要点2", "要点3"]}

要求：
1. 标题翻译为简洁准确的中文
2. 从摘要中提炼3个核心要点，每个要点一句话，用中文
3. 只返回 JSON，不要其他内容`;

  let lastError = '';

  for (const provider of providers) {
    console.log(`  Trying ${provider.name}...`);

    for (let attempt = 1; attempt <= provider.maxRetries; attempt++) {
      try {
        const res = await fetch(provider.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${provider.apiKey}`,
          },
          body: JSON.stringify({
            model: provider.model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
            max_tokens: 500,
          }),
          signal: AbortSignal.timeout(15000),
        });

        if (!res.ok) {
          const errText = await res.text();
          lastError = `${provider.name} HTTP ${res.status}: ${errText.slice(0, 200)}`;
          console.warn(`  ${lastError}`);
          if (res.status === 429) {
            await new Promise((r) => setTimeout(r, 2000 * attempt));
            continue;
          }
          break;
        }

        const data = await res.json();
        const content = data.choices?.[0]?.message?.content || '';

        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          lastError = `${provider.name} 返回非 JSON 格式`;
          console.warn(`  ${lastError}: ${content.slice(0, 100)}`);
          continue;
        }

        const parsed = JSON.parse(jsonMatch[0]) as SummaryResult;
        if (!parsed.title_zh || !Array.isArray(parsed.points) || parsed.points.length === 0) {
          lastError = `${provider.name} JSON 格式不完整`;
          console.warn(`  ${lastError}`);
          continue;
        }

        console.log(`  ✓ ${provider.name} 成功`);
        return parsed;
      } catch (err: any) {
        lastError = `${provider.name} 错误: ${err.message}`;
        console.warn(`  Attempt ${attempt}/${provider.maxRetries}: ${lastError}`);
        if (attempt < provider.maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    }
  }

  // 所有 LLM 都失败，使用备用方案
  console.warn(`  所有 LLM 提供商失败，使用备用方案`);
  if (CONFIG.llm.fallback_behavior === 'use_english_title') {
    return {
      title_zh: title.slice(0, 120),
      points: [
        '论文摘要：' + abstract.slice(0, 300),
        '详细内容请查看原文',
        '自动摘要服务暂时不可用',
      ],
    };
  }

  throw new Error(`All LLM providers failed: ${lastError}`);
}

// ======================== Main ========================

async function main() {
  console.log('=== 多渠道论文收集脚本 ===');
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`Mode: ${CONFIG.collection_mode}`);

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing Supabase env vars');
    process.exit(1);
  }

  const llmProviders = getEnabledLLMProviders();
  if (llmProviders.length === 0) {
    console.error('No LLM provider configured');
    process.exit(1);
  }
  console.log(`[LLM] Providers: ${llmProviders.map((p) => p.name).join(', ')}`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // 1. 构建多渠道收集选项
  const collectorOptions: MultiSourceCollectorOptions = {};

  if (CONFIG.arxiv?.enabled) {
    collectorOptions.arxiv = {
      categories: CONFIG.arxiv.categories,
      maxResults: CONFIG.arxiv.max_results,
    };
  }

  if (CONFIG.semantic_scholar?.enabled) {
    const apiKey = getEnvValue(CONFIG.semantic_scholar.api_key_env);
    for (const query of CONFIG.semantic_scholar.queries || []) {
      collectorOptions.semanticScholar = {
        query,
        apiKey,
        limit: CONFIG.semantic_scholar.limit_per_query,
      };
    }
  }

  if (CONFIG.pubmed?.enabled) {
    for (const query of CONFIG.pubmed.queries || []) {
      collectorOptions.pubmed = {
        query,
        maxResults: CONFIG.pubmed.max_results_per_query,
      };
    }
  }

  if (CONFIG.biorxiv?.enabled) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (CONFIG.biorxiv.days_back || 7));
    collectorOptions.biorxiv = {
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      server: CONFIG.biorxiv.server || 'biorxiv',
    };
  }

  if (CONFIG.openreview?.enabled) {
    for (const venue of CONFIG.openreview.venues || []) {
      collectorOptions.openreview = {
        venue,
        limit: CONFIG.openreview.limit_per_venue,
      };
    }
  }

  // 2. 收集论文
  console.log('\n[Step 1] 从多个渠道收集论文...');
  const allPapers = await collectPapersFromMultipleSources(collectorOptions);
  console.log(`[Step 1] 收集到 ${allPapers.length} 篇论文（去重后）`);

  // 3. 过滤和排序
  console.log('\n[Step 2] 根据关键词过滤和排序...');
  const filteredPapers = filterPapers(allPapers);
  console.log(`[Step 2] 过滤后保留 ${filteredPapers.length} 篇论文`);

  // 4. 处理每篇论文
  console.log('\n[Step 3] 生成中文摘要并保存...');
  let successCount = 0;
  let skipCount = 0;
  let failCount = 0;

  for (let i = 0; i < filteredPapers.length; i++) {
    const paper = filteredPapers[i];
    console.log(`\n[${i + 1}/${filteredPapers.length}] ${paper.source}:${paper.id}`);
    console.log(`  Title: ${paper.title.slice(0, 80)}...`);

    // 检查是否已存在
    const uniqueId = paper.doi || paper.id;
    const { data: existing } = await supabase
      .from('daily_papers')
      .select('id')
      .or(`arxiv_id.eq.${uniqueId},doi.eq.${uniqueId}`)
      .maybeSingle();

    if (existing) {
      console.log(`  Already exists, skipping`);
      skipCount++;
      continue;
    }

    // 生成摘要
    try {
      const summary = await summarizePaperWithRetry(paper.title, paper.abstract, llmProviders);
      console.log(`  Title ZH: ${summary.title_zh}`);
      console.log(`  Points: ${summary.points.length}`);

      // 保存到数据库
      const { error } = await supabase.from('daily_papers').insert({
        arxiv_id: paper.id,
        title_en: paper.title,
        title_zh: summary.title_zh,
        abstract_en: paper.abstract,
        summary_zh: JSON.stringify(summary.points),
        authors: paper.authors,
        categories: paper.categories || [],
        keywords: [], // 匹配的关键词可以在这里填充
        pdf_url: paper.pdfUrl || '',
        arxiv_url: paper.url,
        doi: paper.doi || null,
        published_at: paper.publishedDate,
        metadata: {
          source: paper.source,
          venue: paper.venue,
          citationCount: paper.citationCount,
        },
      });

      if (error) {
        console.error(`  Insert failed: ${error.message}`);
        failCount++;
      } else {
        successCount++;
        console.log(`  ✓ Inserted successfully`);
      }

      // 速率限制
      if (i < filteredPapers.length - 1) {
        await new Promise((r) => setTimeout(r, CONFIG.llm.rate_limit_delay_ms || 1500));
      }
    } catch (err: any) {
      console.error(`  Fatal error: ${err.message}`);
      failCount++;
    }
  }

  console.log(`\n=== 完成 ===`);
  console.log(`成功: ${successCount}, 跳过: ${skipCount}, 失败: ${failCount}, 总计: ${filteredPapers.length}`);

  if (failCount > filteredPapers.length * 0.3) {
    console.warn(`⚠ 失败率过高 (${Math.round((failCount / filteredPapers.length) * 100)}%)，请检查配置`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
