import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  getUserEmbeddingConfig,
  getUserLLMConfig,
  getUserResearchToolConfig,
} from '@/lib/user-settings';
import { normalizeResearchOptions, runResearchRetrieval } from '@/lib/research-retrieval';
import type { ResearchAgentSource, ResearchAgentToolCall } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ToolName = ResearchAgentToolCall['name'];

interface ToolRequest {
  name: ToolName;
  args: Record<string, any>;
}

interface AgentBody {
  question: string;
  documentId?: string;
  kbId?: string;
  documentTitle?: string;
  documentContent?: string;
  documentUrl?: string;
  selection?: string;
}

function supabaseForToken(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

function sseEvent(event: string, data: object): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function callLLM(endpoint: string, apiKey: string, model: string, messages: any[], maxTokens = 800) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature: 0.1, max_tokens: maxTokens }),
  });
  if (!res.ok) throw new Error(`LLM error ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || data?.message?.content || '';
}

function parseToolJson(text: string): ToolRequest[] {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    const tools = Array.isArray(parsed.tools) ? parsed.tools : [];
    return tools
      .filter((t: any) => ['webSearch', 'searchMyKB', 'searchPapers', 'saveNote', 'summarizeCurrentPaper'].includes(t.name))
      .slice(0, 4)
      .map((t: any) => ({ name: t.name, args: t.args || {} }));
  } catch {
    return [];
  }
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

function enrichResearchQuery(query: string, body: AgentBody) {
  const q = query.trim() || body.question;
  const lower = q.toLowerCase();
  const title = (body.documentTitle || '').trim();
  const refersToCurrentPaper = [
    'this paper',
    'current paper',
    'the paper',
    '\u8fd9\u7bc7',
    '\u5f53\u524d',
    '\u8be5\u8bba\u6587',
    '\u672c\u6587',
  ].some(term => lower.includes(term));

  if (title && (refersToCurrentPaper || q.length < 32) && !lower.includes(title.toLowerCase())) {
    return `${title} ${q}`;
  }
  return q;
}

function parseQueryList(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    if (typeof parsed.english_query === 'string' && parsed.english_query.trim()) {
      return [parsed.english_query.trim()];
    }
    return Array.isArray(parsed.queries)
      ? parsed.queries.filter((q: any) => typeof q === 'string' && q.trim()).slice(0, 1)
      : [];
  } catch {
    return [];
  }
}

async function buildSearchQueries(
  rawQuery: string,
  body: AgentBody,
  llm: { endpoint: string; apiKey: string; model: string }
) {
  const baseQuery = enrichResearchQuery(rawQuery, body);
  if (!llm.apiKey) return [baseQuery];

  const prompt = `Translate or rewrite this query into one concise English academic/web search query.

Return only JSON: {"english_query":"..."}

Rules:
- Include the current paper title when the user says "this paper" or asks for background/progress.
- If the query is already English, return a cleaned English version.
- Keep each query under 14 words.

User request: ${rawQuery}
Current paper title: ${body.documentTitle || ''}
Selected text: ${(body.selection || '').slice(0, 500)}
Document excerpt: ${(body.documentContent || '').slice(0, 800)}`;

  try {
    const content = await callLLM(llm.endpoint, llm.apiKey, llm.model, [{ role: 'user', content: prompt }], 220);
    return uniqueItems([baseQuery, ...parseQueryList(content)], q => q).slice(0, 2);
  } catch {
    return [baseQuery];
  }
}

function heuristicTools(body: AgentBody): ToolRequest[] {
  const q = `${body.question} ${body.selection || ''}`.toLowerCase();
  const tools: ToolRequest[] = [];
  const add = (name: ToolName, args: Record<string, any>) => {
    if (!tools.some(t => t.name === name)) tools.push({ name, args });
  };
  const hasAny = (keywords: string[]) => keywords.some(keyword => q.includes(keyword.toLowerCase()));

  if (hasAny(['web', 'search', 'internet', 'recent', 'current', '\u8054\u7f51', '\u7f51\u4e0a', '\u6700\u65b0', '\u8d44\u6599', '\u641c\u7d22'])) {
    add('webSearch', { query: body.question });
  }
  if (hasAny(['kb', '\u77e5\u8bc6\u5e93', '\u6211\u7684\u8d44\u6599', '\u8d44\u6599\u5e93', '\u5e93\u91cc'])) {
    add('searchMyKB', { query: body.question });
  }
  if (hasAny(['paper', 'arxiv', 'citation', 'literature', '\u8bba\u6587', '\u6587\u732e', '\u76f8\u5173\u7814\u7a76', '\u5f15\u7528'])) {
    add('searchPapers', { query: body.question });
  }
  if (hasAny(['summary', 'summarize', 'abstract', '\u603b\u7ed3', '\u6982\u62ec', '\u6458\u8981'])) {
    add('summarizeCurrentPaper', { selection: body.selection || '' });
  }
  if (hasAny(['save note', 'save', '\u4fdd\u5b58', '\u8bb0\u5f55', '\u8bb0\u4e00\u4e0b'])) {
    add('saveNote', {
      title: body.selection ? body.selection.slice(0, 40) : body.question.slice(0, 40),
      content: body.selection || body.question,
      selected_text: body.selection || null,
    });
  }

  return tools;
}

async function chooseTools(body: AgentBody, llm: { endpoint: string; apiKey: string; model: string }) {
  if (!llm.apiKey) return heuristicTools(body);

  const prompt = `Choose tools for a research reading assistant.

Available tools:
- webSearch(query): run the unified research pipeline across web, crawled pages, Semantic Scholar, OpenAlex, arXiv, and local papers.
- searchMyKB(query): search the user's current knowledge base.
- searchPapers(query): search local arXiv/daily papers.
- saveNote(title, content, selected_text): save a private reading note, only when the user explicitly asks to record/save.
- summarizeCurrentPaper(selection): summarize the current paper or selected text.

Return only JSON:
{"tools":[{"name":"toolName","args":{}}]}

User question: ${body.question}
Selected text: ${body.selection || ''}
Current paper: ${body.documentTitle || ''}
Excerpt: ${(body.documentContent || '').slice(0, 1200)}`;

  try {
    const content = await callLLM(llm.endpoint, llm.apiKey, llm.model, [{ role: 'user', content: prompt }], 300);
    const modelTools = parseToolJson(content);
    return modelTools.length > 0 ? modelTools : heuristicTools(body);
  } catch {
    return heuristicTools(body);
  }
}

export async function GET(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Please log in first' }, { status: 401 });

  const supabase = supabaseForToken(token);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Please log in first' }, { status: 401 });

  const [toolConfig, embeddingConfig] = await Promise.all([
    getUserResearchToolConfig(token),
    getUserEmbeddingConfig(token),
  ]);

  return NextResponse.json({
    tools: [
      {
        name: 'webSearch',
        enabled: true,
        detail: 'Unified research pipeline: Tavily, Crawl4AI, Semantic Scholar, OpenAlex, arXiv, local papers',
      },
      {
        name: 'Semantic Scholar',
        enabled: true,
        detail: toolConfig.semanticScholarApiKey ? 'API key configured' : 'No API key; using public low-rate access',
      },
      {
        name: 'searchMyKB',
        enabled: !!embeddingConfig?.apiKey && !!embeddingConfig?.hyperragServiceUrl,
        detail: embeddingConfig?.apiKey ? 'Embedding and HyperRAG config found' : 'Missing embedding config',
      },
      { name: 'searchPapers', enabled: true, detail: 'Local daily_papers table' },
      { name: 'saveNote', enabled: true, detail: 'Private reading_notes table' },
      { name: 'summarizeCurrentPaper', enabled: true, detail: 'Uses current document context' },
    ],
  });
}

export async function POST(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  if (!token) return new Response(JSON.stringify({ error: 'Please log in first' }), { status: 401 });

  const supabase = supabaseForToken(token);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response(JSON.stringify({ error: 'Please log in first' }), { status: 401 });

  const body = await req.json() as AgentBody;
  if (!body.question?.trim()) return new Response(JSON.stringify({ error: 'Missing question' }), { status: 400 });

  const [llmConfig, researchTools] = await Promise.all([
    getUserLLMConfig(token),
    getUserResearchToolConfig(token),
  ]);
  if (!llmConfig.apiKey || !llmConfig.endpoint) {
    return new Response(JSON.stringify({ error: 'Missing LLM configuration' }), { status: 400 });
  }

  const encoder = new TextEncoder();
  const transform = new TransformStream();
  const writer = transform.writable.getWriter();
  const send = async (event: string, data: object) => {
    await writer.write(encoder.encode(sseEvent(event, data)));
  };

  (async () => {
    const sources: ResearchAgentSource[] = [];
    const toolSummaries: string[] = [];
    try {
      await send('status', { stage: 'thinking' });
      const tools = await chooseTools(body, {
        endpoint: llmConfig.endpoint,
        apiKey: llmConfig.apiKey,
        model: llmConfig.defaultModel,
      });

      for (const [index, tool] of tools.entries()) {
        const callId = `${tool.name}-${index}`;
        await send('tool', { id: callId, name: tool.name, args: tool.args, status: 'running' });

        try {
          if (tool.name === 'webSearch') {
            const query = enrichResearchQuery(tool.args.query || body.question, body);
            const selected = normalizeResearchOptions('both', tool.args.depth || 'medium');
            const result = await runResearchRetrieval({
              query,
              mode: selected.mode,
              depth: selected.depth,
              llmConfig,
              toolConfig: researchTools,
              supabase,
            });
            const found: ResearchAgentSource[] = result.sources.map(source => ({
              id: source.id,
              title: source.title,
              snippet: source.fullTextExcerpt || source.snippet,
              url: source.url || undefined,
              type: source.type,
              sourceProvider: source.sourceProvider,
              perspective: source.perspective,
              query: source.query,
              fullTextExcerpt: source.fullTextExcerpt,
              score: source.score,
            }));
            sources.push(...found);
            toolSummaries.push(`webSearch plan: ${result.plan.map(item => item.perspective).join(' | ')}
Queries: ${result.searchQueries.join(' | ')}
${found.map((s, i) => `[${i + 1}] ${s.title} (${s.sourceProvider || s.type}): ${s.snippet}`).join('\n') || 'No results.'}`);
            await send('tool', {
              id: callId,
              name: tool.name,
              args: { ...tool.args, query, depth: selected.depth, plannedQueries: result.plan, queries: result.searchQueries },
              status: 'done',
              result: `${found.length} sources`,
            });
          }

          if (tool.name === 'searchPapers') {
            const query = String(tool.args.query || body.question).replace(/[%,]/g, ' ').trim();
            const queries = await buildSearchQueries(query, body, {
              endpoint: llmConfig.endpoint,
              apiKey: llmConfig.apiKey,
              model: llmConfig.defaultModel,
            });
            const rows: any[] = [];
            for (const searchQuery of queries) {
              const safeQuery = searchQuery.replace(/[%,().]/g, ' ').replace(/\s+/g, ' ').trim();
              if (!safeQuery) continue;
              const { data } = await supabase
                .from('daily_papers')
                .select('id,title_en,title_zh,abstract_en,summary_zh,arxiv_url,pdf_url,published_at')
                .or(`title_en.ilike.%${safeQuery}%,title_zh.ilike.%${safeQuery}%,abstract_en.ilike.%${safeQuery}%,summary_zh.ilike.%${safeQuery}%`)
                .order('published_at', { ascending: false })
                .limit(5);
              rows.push(...(data || []));
            }
            const paperSources = uniqueItems(rows, p => String(p.id)).slice(0, 8).map((p: any) => ({
              id: `local-paper-${p.id}`,
              title: p.title_zh || p.title_en,
              snippet: (p.abstract_en || p.summary_zh || '').slice(0, 500),
              url: p.arxiv_url || p.pdf_url || undefined,
              type: 'paper' as const,
            }));
            sources.push(...paperSources);
            toolSummaries.push(`searchPapers queries: ${queries.join(' | ')}\n${paperSources.map((s, i) => `[${i + 1}] ${s.title}: ${s.snippet}`).join('\n') || 'No local papers found.'}`);
            await send('tool', { id: callId, name: tool.name, args: { ...tool.args, queries }, status: 'done', result: `${paperSources.length} papers` });
          }

          if (tool.name === 'searchMyKB') {
            const embeddingConfig = await getUserEmbeddingConfig(token);
            if (!body.kbId || !embeddingConfig?.apiKey) {
              toolSummaries.push('searchMyKB: skipped because kbId or embedding config is missing.');
              await send('tool', { id: callId, name: tool.name, args: tool.args, status: 'done', result: 'missing kb/config' });
            } else {
              const query = tool.args.query || body.question;
              const ragRes = await fetch(`${embeddingConfig.hyperragServiceUrl}/api/query`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  kb_id: body.kbId,
                  user_id: user.id,
                  question: query,
                  mode: 'hyper',
                  config: {
                    llm: {
                      api_key: llmConfig.apiKey,
                      model_name: llmConfig.defaultModel,
                      base_url: llmConfig.endpoint.replace('/chat/completions', ''),
                    },
                    embedding: {
                      api_key: embeddingConfig.apiKey,
                      model_name: embeddingConfig.model,
                      base_url: embeddingConfig.apiUrl,
                      dimensions: embeddingConfig.dimensions,
                    },
                  },
                }),
              });
              if (!ragRes.ok) throw new Error(`HyperRAG error ${ragRes.status}`);
              const rag = await ragRes.json();
              const textUnits = rag.text_units || [];
              const kbSources = textUnits.slice(0, 5).map((u: any, i: number) => ({
                id: `kb-${i}`,
                title: u.document_title || body.documentTitle || 'Knowledge base passage',
                snippet: (u.content || '').slice(0, 500),
                type: 'kb' as const,
              }));
              sources.push(...kbSources);
              toolSummaries.push(`searchMyKB("${query}"):\n${rag.response || kbSources.map((s: any) => s.snippet).join('\n\n') || 'No KB result.'}`);
              await send('tool', { id: callId, name: tool.name, args: tool.args, status: 'done', result: rag.response ? 'answer found' : `${kbSources.length} passages` });
            }
          }

          if (tool.name === 'saveNote') {
            const { data, error } = await supabase
              .from('reading_notes')
              .insert({
                user_id: user.id,
                document_id: body.documentId || null,
                title: tool.args.title || body.documentTitle || 'Reading note',
                content: tool.args.content || body.selection || body.question,
                selected_text: tool.args.selected_text || body.selection || null,
                source_url: body.documentUrl || null,
                metadata: { created_by: 'research-agent', question: body.question },
              })
              .select()
              .single();
            if (error) throw error;
            sources.push({ id: `note-${data.id}`, title: data.title, snippet: data.content, type: 'note' });
            toolSummaries.push(`saveNote: saved "${data.title}".`);
            await send('savedNote', { note: data });
            await send('tool', { id: callId, name: tool.name, args: tool.args, status: 'done', result: 'saved' });
          }

          if (tool.name === 'summarizeCurrentPaper') {
            const text = tool.args.selection || body.selection || body.documentContent || '';
            const clipped = text.slice(0, 6000);
            toolSummaries.push(`summarizeCurrentPaper context:\nTitle: ${body.documentTitle || ''}\n${clipped || 'No readable text available.'}`);
            if (body.documentId) {
              sources.push({ id: `doc-${body.documentId}`, title: body.documentTitle || 'Current document', snippet: clipped.slice(0, 500), url: body.documentUrl, type: 'document' });
            }
            await send('tool', { id: callId, name: tool.name, args: tool.args, status: 'done', result: clipped ? 'document context loaded' : 'no text' });
          }
        } catch (err: any) {
          await send('tool', { id: callId, name: tool.name, args: tool.args, status: 'error', result: err.message });
          toolSummaries.push(`${tool.name}: failed (${err.message})`);
        }
      }

      await send('status', { stage: 'answering' });
      const sourceContext = sources
        .map((s, i) => `[${i + 1}] ${s.title}\n${s.snippet || ''}\n${s.url || ''}`)
        .join('\n\n');

      const finalMessages = [
        {
          role: 'system',
          content: 'You are a research reading assistant. Help the user understand papers, search sources, and preserve notes. Answer in the same language as the user. Be concise but useful. Cite sources as [1], [2] when sources are available.',
        },
        {
          role: 'user',
          content: `Question: ${body.question}

Current paper: ${body.documentTitle || ''}
Selected text:
${body.selection || ''}

Document excerpt:
${(body.documentContent || '').slice(0, 3000)}

Tool results:
${toolSummaries.join('\n\n') || 'No tools used.'}

Sources:
${sourceContext}`,
        },
      ];

      const streamRes = await fetch(llmConfig.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llmConfig.apiKey}` },
        body: JSON.stringify({
          model: llmConfig.defaultModel,
          messages: finalMessages,
          temperature: 0.3,
          max_tokens: 1800,
          stream: true,
        }),
      });

      let finalAnswer = '';
      if (streamRes.ok && streamRes.body) {
        const reader = streamRes.body.getReader();
        const decoder = new TextDecoder();
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
                finalAnswer += content;
                await send('token', { content });
              }
            } catch {
              // Ignore malformed stream lines.
            }
          }
        }
      } else {
        finalAnswer = await callLLM(llmConfig.endpoint, llmConfig.apiKey, llmConfig.defaultModel, finalMessages, 1800);
        await send('token', { content: finalAnswer });
      }

      await send('done', { answer: finalAnswer, sources });
      await writer.close();
    } catch (err: any) {
      await send('done', { answer: `Agent failed: ${err.message}`, sources });
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
