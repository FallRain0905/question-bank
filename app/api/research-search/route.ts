import { NextRequest } from 'next/server';
import { getUserLLMConfig } from '@/lib/user-settings';
import type { ResearchSource } from '@/types';

export const runtime = 'edge';

const TAVILY_KEY = () => process.env.TAVILY_API_KEY || '';
const SCHOLAR_KEY = () => process.env.SEMANTIC_SCHOLAR_API_KEY || '';

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

// ======================== Tavily Search ========================

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  raw_content?: string;
}

async function searchTavily(query: string): Promise<ResearchSource[]> {
  const key = TAVILY_KEY();
  if (!key) return [];

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
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

async function searchSemanticScholar(query: string): Promise<ResearchSource[]> {
  try {
    const headers: Record<string, string> = {};
    const key = SCHOLAR_KEY();
    if (key) headers['x-api-key'] = key;

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
  const { apiKey, endpoint, defaultModel: model } = await getUserLLMConfig(token);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: object) => {
        controller.enqueue(encoder.encode(sseEvent(event, data)));
      };

      try {
        // Step 1: Classify intent (skip if user specified)
        send('status', { stage: 'analyzing' });
        const intent = userIntent || await classifyIntent(query, apiKey, endpoint, model);

        // Step 2: Search
        send('status', { stage: 'searching' });
        const searchPromises: Promise<ResearchSource[]>[] = [];
        if (intent === 'academic' || intent === 'both') {
          searchPromises.push(searchSemanticScholar(query));
        }
        if (intent === 'general' || intent === 'both') {
          searchPromises.push(searchTavily(query));
        }
        const results = await Promise.all(searchPromises);
        const sources: ResearchSource[] = results.flat();

        if (sources.length === 0) {
          send('done', { summary: '未找到相关结果，请尝试其他关键词。', sources: [], intent });
          controller.close();
          return;
        }

        // Step 3: Stream summary
        send('status', { stage: 'generating' });

        const sourceContext = sources
          .map((s, i) => `[${i + 1}] ${s.title}\n${s.snippet}`)
          .join('\n\n');

        const summaryPrompt = `You are a research assistant. Based on the following sources, provide a comprehensive answer to the user's question.

Use inline citations like [1], [2] to reference sources. Be thorough and accurate. Respond in the same language as the user's question.

User question: ${query}

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
          send('done', { summary: '生成总结失败，请稍后重试。', sources, intent });
          controller.close();
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
                send('token', { content });
              }
            } catch { /* skip */ }
          }
        }

        send('done', { summary: fullSummary, sources, intent });
        controller.close();
      } catch (err: any) {
        send('done', { summary: `搜索出错: ${err.message}`, sources: [], intent: 'both' });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
