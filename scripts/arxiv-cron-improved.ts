/**
 * 改进版 arXiv 论文抓取脚本
 * 新增：重试机制、详细日志、多 LLM 支持、备用摘要生成
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';

config({ path: resolve(__dirname, '..', '.env.local') });

const CONFIG_PATH = resolve(__dirname, 'arxiv-config.json');
interface ArxivConfig {
  max_papers: number;
  categories: string[];
  keywords: string[];
  exclude_keywords?: string[];
}
const CONFIG: ArxivConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));

import { createClient } from '@supabase/supabase-js';

// LLM 配置（支持多个备选）
const LLM_PROVIDERS = [
  {
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    model: 'deepseek-v4-flash',
  },
  {
    name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    apiKey: process.env.OPENAI_API_KEY || '',
    model: 'gpt-4o-mini',
  },
  {
    name: 'Kimi',
    endpoint: 'https://api.moonshot.cn/v1/chat/completions',
    apiKey: process.env.KIMI_API_KEY || '',
    model: 'moonshot-v1-8k',
  },
].filter(provider => provider.apiKey);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const { categories: CATEGORIES, keywords: KEYWORDS, max_papers: MAX_PAPERS, exclude_keywords: EXCLUDE_KEYWORDS = [] } = CONFIG;

console.log(`[Config] Categories: ${CATEGORIES.join(', ')}`);
console.log(`[Config] Keywords: ${KEYWORDS.length} keywords`);
console.log(`[Config] Max papers: ${MAX_PAPERS}`);
console.log(`[Config] Available LLM providers: ${LLM_PROVIDERS.map(p => p.name).join(', ')}`);

// ======================== ArXiv API ========================

interface ArxivEntry {
  id: string;
  title: string;
  summary: string;
  authors: string[];
  categories: string[];
  pdfUrl: string;
  published: string;
}

async function fetchArxivPapers(): Promise<ArxivEntry[]> {
  const catQuery = CATEGORIES.map(c => `cat:${c}`).join(' OR ');
  const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(catQuery)}&sortBy=submittedDate&sortOrder=descending&max_results=200`;

  console.log(`[arXiv] Fetching: ${url}`);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'question-bank-arxiv-crawler/1.0' },
  });
  if (!res.ok) {
    throw new Error(`arXiv API error ${res.status}: ${await res.text()}`);
  }
  const xml = await res.text();

  const entries: ArxivEntry[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;

  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];

    const idMatch = block.match(/<id>.*?\/abs\/([\w.-]+)<\/id>/);
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
    const summaryMatch = block.match(/<summary>([\s\S]*?)<\/summary>/);
    const publishedMatch = block.match(/<published>([\s\S]*?)<\/published>/);
    const pdfMatch = block.match(/<link[^>]*title="pdf"[^>]*href="([^"]+)"/);

    const authors: string[] = [];
    const authorRegex = /<name>([\s\S]*?)<\/name>/g;
    let authorMatch;
    while ((authorMatch = authorRegex.exec(block)) !== null) {
      authors.push(authorMatch[1].trim());
    }

    const categories: string[] = [];
    const catRegex = /<category[^>]*term="([^"]+)"/g;
    let catMatch;
    while ((catMatch = catRegex.exec(block)) !== null) {
      categories.push(catMatch[1]);
    }

    if (idMatch && titleMatch) {
      entries.push({
        id: idMatch[1],
        title: titleMatch[1].replace(/\s+/g, ' ').trim(),
        summary: summaryMatch ? summaryMatch[1].replace(/\s+/g, ' ').trim() : '',
        authors,
        categories,
        pdfUrl: pdfMatch ? pdfMatch[1] : `https://arxiv.org/pdf/${idMatch[1]}`,
        published: publishedMatch ? publishedMatch[1].trim() : '',
      });
    }
  }

  console.log(`[arXiv] Fetched ${entries.length} entries`);
  return entries;
}

interface ScoredEntry extends ArxivEntry {
  matchedKeywords: string[];
  score: number;
}

function filterByKeywords(entries: ArxivEntry[]): ScoredEntry[] {
  const keywordPatterns = KEYWORDS.map(kw => ({
    regex: new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
    keyword: kw,
  }));

  const excludePatterns = EXCLUDE_KEYWORDS.map(kw => ({
    regex: new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
    keyword: kw,
  }));

  const results: ScoredEntry[] = [];

  for (const entry of entries) {
    const fullText = `${entry.title} ${entry.summary}`;
    const excluded = excludePatterns.some(({ regex }) => regex.test(fullText));
    if (excluded) continue;

    const matched: string[] = [];
    let score = 0;

    for (const { regex, keyword } of keywordPatterns) {
      if (regex.test(fullText)) {
        matched.push(keyword);
        if (regex.test(entry.title)) {
          score += 2;
        } else {
          score += 1;
        }
      }
    }

    if (matched.length > 0) {
      results.push({ ...entry, matchedKeywords: [...new Set(matched)], score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

// ======================== LLM 总结（带重试） ========================

interface SummaryResult {
  title_zh: string;
  points: string[];
}

async function summarizePaperWithRetry(
  title: string,
  abstract: string,
  maxRetries = 3
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

  for (const provider of LLM_PROVIDERS) {
    console.log(`  Trying ${provider.name}...`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(provider.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${provider.apiKey}`,
          },
          body: JSON.stringify({
            model: provider.model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
            max_tokens: 500,
          }),
          signal: AbortSignal.timeout(15000), // 15s 超时
        });

        if (!res.ok) {
          const errText = await res.text();
          lastError = `${provider.name} HTTP ${res.status}: ${errText.slice(0, 200)}`;
          console.warn(`  ${lastError}`);
          if (res.status === 429) {
            await new Promise(r => setTimeout(r, 2000 * attempt)); // 指数退避
            continue;
          }
          break; // 非 429 错误，切换 provider
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
        console.warn(`  Attempt ${attempt}/${maxRetries}: ${lastError}`);
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 1000 * attempt));
        }
      }
    }
  }

  // 所有 LLM 都失败，使用备用简单翻译
  console.warn(`  所有 LLM 提供商失败，使用备用方案`);
  return {
    title_zh: title.slice(0, 120), // 保留英文标题
    points: [
      '论文摘要：' + abstract.slice(0, 300),
      '详细内容请查看原文',
      '自动摘要服务暂时不可用'
    ],
  };
}

// ======================== Main ========================

async function main() {
  console.log('=== arXiv Daily Paper Crawler (Improved) ===');
  console.log(`Time: ${new Date().toISOString()}`);

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing Supabase env vars');
    process.exit(1);
  }
  if (LLM_PROVIDERS.length === 0) {
    console.error('No LLM provider configured (DEEPSEEK_API_KEY / OPENAI_API_KEY / KIMI_API_KEY)');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // 1. Fetch from arXiv
  const entries = await fetchArxivPapers();

  // 2. Filter by keywords
  const filtered = filterByKeywords(entries);
  console.log(`[Filter] ${filtered.length} papers matched keywords`);

  // 3. Take top N
  const topPapers = filtered.slice(0, MAX_PAPERS);
  console.log(`[Limit] Processing top ${topPapers.length} papers`);

  // 4. Process each paper
  let successCount = 0;
  let skipCount = 0;
  let failCount = 0;

  for (let i = 0; i < topPapers.length; i++) {
    const paper = topPapers[i];
    console.log(`\n[${i + 1}/${topPapers.length}] ${paper.id}: ${paper.title.slice(0, 60)}...`);

    // Check if already exists
    const { data: existing } = await supabase
      .from('daily_papers')
      .select('id')
      .eq('arxiv_id', paper.id)
      .maybeSingle();

    if (existing) {
      console.log(`  Already exists, skipping`);
      skipCount++;
      continue;
    }

    // Call LLM for summary (with retry)
    try {
      const result = await summarizePaperWithRetry(paper.title, paper.summary);
      console.log(`  Title ZH: ${result.title_zh}`);
      console.log(`  Points: ${result.points.length}`);

      // Insert into Supabase
      const { error } = await supabase.from('daily_papers').insert({
        arxiv_id: paper.id,
        title_en: paper.title,
        title_zh: result.title_zh,
        abstract_en: paper.summary,
        summary_zh: JSON.stringify(result.points),
        authors: paper.authors,
        categories: paper.categories,
        keywords: paper.matchedKeywords,
        pdf_url: paper.pdfUrl,
        arxiv_url: `https://arxiv.org/abs/${paper.id}`,
        published_at: paper.published,
      });

      if (error) {
        console.error(`  Insert failed: ${error.message}`);
        failCount++;
      } else {
        successCount++;
        console.log(`  ✓ Inserted successfully`);
      }

      // Rate limit
      if (i < topPapers.length - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    } catch (err: any) {
      console.error(`  Fatal error: ${err.message}`);
      failCount++;
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`Success: ${successCount}, Skipped: ${skipCount}, Failed: ${failCount}, Total: ${topPapers.length}`);

  if (failCount > topPapers.length * 0.3) {
    console.warn(`⚠ 失败率过高 (${Math.round(failCount / topPapers.length * 100)}%)，请检查 LLM API 配置`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
