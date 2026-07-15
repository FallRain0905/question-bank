import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserLLMConfig, getUserResearchToolConfig } from '@/lib/user-settings';
import { normalizeResearchOptions, planResearchQueries, retrieveResearchSources } from '@/lib/research-retrieval';
import type { ResearchSource } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function sseEvent(event: string, data: object): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function supabaseForToken(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : undefined
  );
}

function uniqueStrings(items: string[]) {
  return Array.from(new Set(items.map(item => item.trim()).filter(Boolean)));
}

export async function POST(req: NextRequest) {
  const { query, mode, depth } = await req.json();
  if (!query?.trim()) {
    return new Response(JSON.stringify({ error: 'Missing search query' }), { status: 400 });
  }

  const selected = normalizeResearchOptions(mode, depth);
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  const [llmConfig, toolConfig] = await Promise.all([
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
    let sources: ResearchSource[] = [];
    try {
      await send('status', { stage: 'planning' });
      const retrievalOptions = {
        query: query.trim(),
        mode: selected.mode,
        depth: selected.depth,
        llmConfig,
        toolConfig,
        supabase: supabaseForToken(token),
      };
      const plan = await planResearchQueries(retrievalOptions);
      const searchQueries = uniqueStrings(plan.flatMap(item => item.queries));
      await send('plannedQueries', { plannedQueries: plan, searchQueries });

      await send('status', { stage: 'searching' });
      sources = await retrieveResearchSources({ ...retrievalOptions, plan });
      for (const source of sources) {
        await send('source', { source });
      }

      if (sources.length === 0) {
        await send('done', {
          summary: 'No relevant results found. Try different keywords.',
          sources: [],
          plannedQueries: plan,
          searchQueries,
          mode: selected.mode,
          depth: selected.depth,
        });
        await writer.close();
        return;
      }

      await send('status', { stage: 'generating' });
      const sourceContext = sources
        .map((source, i) => {
          const text = source.fullTextExcerpt || source.snippet || '';
          return `[${i + 1}] ${source.title}\nProvider: ${source.sourceProvider || source.type}\nPerspective: ${source.perspective || ''}\n${text}\n${source.url || ''}`;
        })
        .join('\n\n');

      const summaryPrompt = `You are a research assistant. Based on the following sources, answer the user's question.

Use inline citations like [1], [2]. Respond in the same language as the user's question.

User question: ${query}
Search mode: ${selected.mode}
Search depth: ${selected.depth}
Search queries used: ${searchQueries.join(' | ')}

Sources:
${sourceContext}`;

      const summaryRes = await fetch(llmConfig.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llmConfig.apiKey}` },
        body: JSON.stringify({
          model: llmConfig.defaultModel,
          messages: [{ role: 'user', content: summaryPrompt }],
          temperature: 0.3,
          max_tokens: selected.depth === 'deep' ? 2600 : 2000,
          stream: true,
        }),
      });

      if (!summaryRes.ok || !summaryRes.body) {
        await send('done', {
          summary: 'Summary generation failed. Please try again later.',
          sources,
          plannedQueries: plan,
          searchQueries,
          mode: selected.mode,
          depth: selected.depth,
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

      await send('done', {
        summary: fullSummary,
        sources,
        plannedQueries: plan,
        searchQueries,
        mode: selected.mode,
        depth: selected.depth,
      });
      await writer.close();
    } catch (err: any) {
      await send('done', {
        summary: `Search failed: ${err.message}`,
        sources,
        mode: selected.mode,
        depth: selected.depth,
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
