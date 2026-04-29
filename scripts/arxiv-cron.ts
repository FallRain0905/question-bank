/**
 * arXiv 论文每日抓取 + DeepSeek 总结脚本
 * 用法: npx tsx scripts/arxiv-cron.ts
 * PM2: pm2 start "npx tsx scripts/arxiv-cron.ts" --name arxiv-cron --cron "0 9 * * *" --no-autorestart
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';

// Load .env.local from project root
config({ path: resolve(__dirname, '..', '.env.local') });

// Load config from arxiv-config.json
const CONFIG_PATH = resolve(__dirname, 'arxiv-config.json');
interface ArxivConfig {
  max_papers: number;
  categories: string[];
  keywords: string[];
  exclude_keywords?: string[];
}
const CONFIG: ArxivConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));

import { createClient } from '@supabase/supabase-js';

// DeepSeek config (same as lib/user-settings.ts)
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || 'sk-bb3c52688dbc43b3864f8fb07ede67dd';
const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-v4-flash';

// Supabase config
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const { categories: CATEGORIES, keywords: KEYWORDS, max_papers: MAX_PAPERS, exclude_keywords: EXCLUDE_KEYWORDS = [] } = CONFIG;

console.log(`[Config] Categories: ${CATEGORIES.join(', ')}`);
console.log(`[Config] Keywords: ${KEYWORDS.length} keywords`);
console.log(`[Config] Max papers: ${MAX_PAPERS}`);

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
  const res = await fetch(url);
  const xml = await res.text();

  // Parse Atom XML
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
    // Exclude filter
    const fullText = `${entry.title} ${entry.summary}`;
    const excluded = excludePatterns.some(({ regex }) => regex.test(fullText));
    if (excluded) continue;

    const matched: string[] = [];
    let score = 0;

    for (const { regex, keyword } of keywordPatterns) {
      if (regex.test(fullText)) {
        matched.push(keyword);
        // Title match gets bonus weight
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

  // Sort by score descending (title-weighted)
  results.sort((a, b) => b.score - a.score);
  return results;
}

// ======================== DeepSeek ========================

interface DeepseekResult {
  title_zh: string;
  points: string[];
}

async function summarizePaper(title: string, abstract: string): Promise<DeepseekResult> {
  const prompt = `请将以下论文信息翻译和总结。

标题：${title}
摘要：${abstract}

请严格按以下 JSON 格式返回（不要加 markdown 代码块）：
{"title_zh": "中文翻译标题", "points": ["要点1", "要点2", "要点3"]}

要求：
1. 标题翻译为简洁准确的中文
2. 从摘要中提炼3个核心要点，每个要点一句话，用中文
3. 只返回 JSON，不要其他内容`;

  const res = await fetch(DEEPSEEK_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_KEY}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 500,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`DeepSeek API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';

  // Extract JSON from response (might have markdown wrapping)
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Failed to parse DeepSeek response: ${content.slice(0, 200)}`);
  }

  return JSON.parse(jsonMatch[0]) as DeepseekResult;
}

// ======================== Main ========================

async function main() {
  console.log('=== arXiv Daily Paper Crawler ===');
  console.log(`Time: ${new Date().toISOString()}`);

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing Supabase env vars');
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

  for (let i = 0; i < topPapers.length; i++) {
    const paper = topPapers[i];
    console.log(`\n[${i + 1}/${topPapers.length}] ${paper.id}: ${paper.title.slice(0, 60)}...`);

    // Check if already exists
    const { data: existing } = await supabase
      .from('daily_papers')
      .select('id')
      .eq('arxiv_id', paper.id)
      .single();

    if (existing) {
      console.log(`  Already exists, skipping`);
      skipCount++;
      continue;
    }

    // Call DeepSeek for summary
    try {
      const result = await summarizePaper(paper.title, paper.summary);
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
      } else {
        successCount++;
        console.log(`  Inserted successfully`);
      }

      // Rate limit: wait 2s between DeepSeek calls
      if (i < topPapers.length - 1) {
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (err: any) {
      console.error(`  DeepSeek failed: ${err.message}`);
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`Success: ${successCount}, Skipped: ${skipCount}, Total: ${topPapers.length}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
