import { NextRequest } from 'next/server';
import { getUserLLMConfig, getUserResearchToolConfig } from '@/lib/user-settings';
import type { ResearchSource } from '@/types';

export const runtime = 'nodejs';

type SearchMode = 'academic' | 'general' | 'both';

interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

interface ScholarPaper {
  paperId: string;
  title: string;
  abstract?: string;
  url: string;
  year?: number;
  authors?: { name: string }[];
  citationCount?: number;
  venue?: string;
}

function sseEvent(event: string, data: object): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function uniqueItems<T>(items: T[], keyFn: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFn(item).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseEnglishQuery(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return '';
  try {
    const parsed = JSON.parse(match[0]);
    return typeof parsed.english_query === 'string' ? parsed.english_query.trim() : '';
  } catch {
    return '';
  }
}

async function callLLM(prompt: string, apiKey: string, endpoint: string, model: string, maxTokens: number) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) throw new Error(`LLM error ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function buildSearchQueries(query: string, apiKey: string, endpoint: string, model: string) {
  const baseQuery = query.trim();
  if (!apiKey || !endpoint || !model) return [baseQuery];

  const prompt = `Translate or rewrite this search query into one concise English academic/web search query.

Return only JSON: {"english_query":"..."}

Rules:
- If the query is already English, return a cleaned English version.
- Keep it under 14 words.
- Preserve important domain terms.

User query: ${baseQuery}`;

  try {
    const content = await callLLM(prompt, apiKey, endpoint, model, 220);
    return uniqueItems([baseQuery, parseEnglishQuery(content)], q => q).slice(0, 2);
  } catch {
    return [baseQuery];
  }
}

async function searchTavily(query: string, apiKey: string): Promise<ResearchSource[]> {
  if (!apiKey) return [];

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'advanced',
        include_answer: false,
        max_results: 5,
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).map((r: TavilyResult, i: number) => ({
      id: `web-${i}-${encodeURIComponent(query).slice(0, 20)}`,
      title: r.title,
      snippet: (r.content || '').slice(0, 300),
      url: r.url,
      type: 'web' as const,
    }));
  } catch {
    return [];
  }
}

function mapScholarPaper(p: ScholarPaper, idPrefix = 'paper'): ResearchSource {
  return {
    id: `${idPrefix}-${p.paperId}`,
    title: p.title,
    snippet: (p.abstract || '').slice(0, 300),
    url: p.url,
    type: 'paper' as const,
    authors: p.authors?.map(a => a.name),
    year: p.year,
    venue: p.venue,
    citationCount: p.citationCount,
  };
}

async function searchSemanticScholar(query: string, apiKey: string): Promise<ResearchSource[]> {
  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers['x-api-key'] = apiKey;

    const url = `https://api.semanticscholar.org/graph/v1/paper/search?${new URLSearchParams({
      query,
      limit: '5',
      fields: 'title,abstract,url,year,authors,citationCount,venue',
    })}`;
    const res = await fetch(url, { headers });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data || []).map((p: ScholarPaper) => mapScholarPaper(p));
  } catch {
    return [];
  }
}

function extractPaperIds(sources: ResearchSource[]) {
  return sources
    .map(source => source.id.match(/paper-(.+)$/)?.[1])
    .filter(Boolean)
    .slice(0, 3) as string[];
}

async function recommendSemanticScholar(seedPaperIds: string[], apiKey: string): Promise<ResearchSource[]> {
  if (seedPaperIds.length === 0) return [];

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['x-api-key'] = apiKey;

    const url = `https://api.semanticscholar.org/recommendations/v1/papers?${new URLSearchParams({
      limit: '5',
      fields: 'title,abstract,url,year,authors,citationCount,venue',
    })}`;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ positivePaperIds: seedPaperIds }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.recommendedPapers || []).map((p: ScholarPaper) => mapScholarPaper(p, 'recommended-paper'));
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  const { query, mode } = await req.json();
  if (!query?.trim()) {
    return new Response(JSON.stringify({ error: 'Missing search query' }), { status: 400 });
  }

  const selectedMode: SearchMode = mode === 'academic' || mode === 'general' || mode === 'both' ? mode : 'both';
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  const [{ apiKey, endpoint, defaultModel: model }, toolConfig] = await Promise.all([
    getUserLLMConfig(token),
    getUserResearchToolConfig(token),
  ]);

  const encoder = new TextEncoder();
  const transform = new TransformStream();
  const writer = transform.writable.getWriter();
  const send = async (event: string, data: object) => {
    await writer.write(encoder.encode(sseEvent(event, data)));
  };

  (async () => {
    let searchQueries: string[] = [query.trim()];
    let sources: ResearchSource[] = [];

    try {
      await send('status', { stage: 'searching' });
      searchQueries = await buildSearchQueries(query, apiKey, endpoint, model);

      const searchPromises: Promise<ResearchSource[]>[] = [];
      for (const searchQuery of searchQueries) {
        if (selectedMode === 'academic' || selectedMode === 'both') {
          searchPromises.push(searchSemanticScholar(searchQuery, toolConfig.semanticScholarApiKey));
        }
        if (selectedMode === 'general' || selectedMode === 'both') {
          searchPromises.push(searchTavily(searchQuery, toolConfig.tavilyApiKey));
        }
      }

      const results = await Promise.all(searchPromises);
      const initialSources = uniqueItems(results.flat(), source => source.url || source.title);
      const recommendedSources = selectedMode === 'academic' || selectedMode === 'both'
        ? await recommendSemanticScholar(extractPaperIds(initialSources), toolConfig.semanticScholarApiKey)
        : [];
      sources = uniqueItems([...initialSources, ...recommendedSources], source => source.url || source.title).slice(0, 12);

      if (sources.length === 0) {
        await send('done', {
          summary: 'No relevant results found. Try different keywords.',
          sources: [],
          mode: selectedMode,
          searchQueries,
        });
        await writer.close();
        return;
      }

      await send('status', { stage: 'generating' });
      const sourceContext = sources
        .map((s, i) => `[${i + 1}] ${s.title}\n${s.snippet || ''}`)
        .join('\n\n');

      const summaryPrompt = `You are a research assistant. Based on the following sources, answer the user's question.

Use inline citations like [1], [2]. Respond in the same language as the user's question.

User question: ${query}
Search mode: ${selectedMode}
Search queries used: ${searchQueries.join(' | ')}

Sources:
${sourceContext}`;

      const summaryRes = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: summaryPrompt }],
          temperature: 0.3,
          max_tokens: 2000,
          stream: true,
        }),
      });

      if (!summaryRes.ok || !summaryRes.body) {
        await send('done', {
          summary: 'Summary generation failed. Please try again later.',
          sources,
          mode: selectedMode,
          searchQueries,
        });
        await writer.close();
        return;
      }

      const reader = summaryRes.body.getReader();
      const decoder = new TextDecoder();
      let fullSummary = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw || raw === '[DONE]') continue;
          try {
            const parsed = JSON.parse(raw);
            const content = parsed.choices?.[0]?.delta?.content || '';
            if (content) {
              fullSummary += content;
              await send('token', { content });
            }
          } catch {
            // Ignore malformed stream lines.
          }
        }
      }

      await send('done', { summary: fullSummary, sources, mode: selectedMode, searchQueries });
      await writer.close();
    } catch (err: any) {
      await send('done', {
        summary: `Search failed: ${err.message}`,
        sources,
        mode: selectedMode,
        searchQueries,
      });
      await writer.close();
    }
  })();

  return new Response(transform.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
