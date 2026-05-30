import { NextRequest } from 'next/server';
import { getUserLLMConfig, getUserResearchToolConfig } from '@/lib/user-settings';
import type { ResearchSource } from '@/types';

export const runtime = 'nodejs';

// ======================== Intent Classification ========================

type Intent = 'academic' | 'general' | 'both';

async function classifyIntent(
  query: string,
  apiKey: string,
  endpoint: string,
  model: string
): Promise<Intent> {
  const prompt = `Analyze this search query and classify the intent.

Query: "${query}"

Respond with ONLY a JSON object: {"intent": "academic" | "general" | "both"}

Rules:
- "academic": research papers, algorithms, scientific studies, theories, citations, specific researchers
- "general": current events, how-to guides, product info, news, opinions, practical advice
- "both": queries that benefit from both academic and general sources`;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 30,
      }),
    });
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (['academic', 'general', 'both'].includes(parsed.intent)) {
        return parsed.intent;
      }
    }
  } catch { /* fallback */ }
  return 'both';
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

function parseQueryList(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed.queries)
      ? parsed.queries.filter((q: any) => typeof q === 'string' && q.trim()).slice(0, 4)
      : [];
  } catch {
    return [];
  }
}

async function buildSearchQueries(query: string, apiKey: string, endpoint: string, model: string) {
  const baseQuery = query.trim();
  if (!apiKey || !endpoint || !model) return [baseQuery];

  const prompt = `Create precise search queries for academic/web search.

Return only JSON: {"queries":["query 1","query 2","query 3"]}

Rules:
- Add an English query when the user query is Chinese.
- Keep each query under 14 words.
- Preserve important domain terms.

User query: ${baseQuery}`;

  try {
    const content = await classifyLikeCompletion(prompt, apiKey, endpoint, model, 220);
    return uniqueItems([baseQuery, ...parseQueryList(content)], q => q).slice(0, 4);
  } catch {
    return [baseQuery];
  }
}

async function classifyLikeCompletion(
  prompt: string,
  apiKey: string,
  endpoint: string,
  model: string,
  maxTokens: number
) {
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

// ======================== Tavily Search ========================

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  raw_content?: string;
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
      id: `web-${i}`,
      title: r.title,
      snippet: (r.content || '').slice(0, 300),
      url: r.url,
      type: 'web' as const,
    }));
  } catch {
    return [];
  }
}

// ======================== Semantic Scholar ========================

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
    return (data.data || []).map((p: ScholarPaper) => ({
      id: `paper-${p.paperId}`,
      title: p.title,
      snippet: (p.abstract || '').slice(0, 300),
      url: p.url,
      type: 'paper' as const,
      authors: p.authors?.map(a => a.name),
      year: p.year,
      venue: p.venue,
      citationCount: p.citationCount,
    }));
  } catch {
    return [];
  }
}

// ======================== SSE Helper ========================

function sseEvent(event: string, data: object): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// ======================== Main Handler ========================

export async function POST(req: NextRequest) {
  const { query, mode } = await req.json();
  if (!query?.trim()) {
    return new Response(JSON.stringify({ error: '请输入搜索内容' }), { status: 400 });
  }

  const userIntent = (mode === 'academic' || mode === 'general' || mode === 'both') ? mode : null;

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

  // Run async work in background
  (async () => {
    try {
      // Step 1: Classify intent (skip if user specified)
      await send('status', { stage: 'analyzing' });
      const intent = userIntent || await classifyIntent(query, apiKey, endpoint, model);

      // Step 2: Search
      await send('status', { stage: 'searching' });
      const searchQueries = await buildSearchQueries(query, apiKey, endpoint, model);
      const searchPromises: Promise<ResearchSource[]>[] = [];
      for (const searchQuery of searchQueries) {
        if (intent === 'academic' || intent === 'both') {
          searchPromises.push(searchSemanticScholar(searchQuery, toolConfig.semanticScholarApiKey));
        }
        if (intent === 'general' || intent === 'both') {
          searchPromises.push(searchTavily(searchQuery, toolConfig.tavilyApiKey));
        }
      }
      const results = await Promise.all(searchPromises);
      const sources: ResearchSource[] = uniqueItems(
        results.flat(),
        source => source.url || source.title
      ).slice(0, 10);

      if (sources.length === 0) {
        await send('done', { summary: '未找到相关结果，请尝试其他关键词。', sources: [], intent });
        await writer.close();
        return;
      }

      // Step 3: Stream summary
      await send('status', { stage: 'generating' });

      const sourceContext = sources
        .map((s, i) => `[${i + 1}] ${s.title}\n${s.snippet}`)
        .join('\n\n');

      const summaryPrompt = `You are a research assistant. Based on the following sources, provide a comprehensive answer to the user's question.

Use inline citations like [1], [2] to reference sources. Be thorough and accurate. Respond in the same language as the user's question.

User question: ${query}
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
        await send('done', { summary: '生成总结失败，请稍后重试。', sources, intent });
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
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') continue;
          try {
            const parsed = JSON.parse(raw);
            const content = parsed.choices?.[0]?.delta?.content || '';
            if (content) {
              fullSummary += content;
              await send('token', { content });
            }
          } catch { /* skip */ }
        }
      }

      await send('done', { summary: fullSummary, sources, intent });
      await writer.close();
    } catch (err: any) {
      await send('done', { summary: `搜索出错: ${err.message}`, sources: [], intent: 'both' });
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
