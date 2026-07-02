import { normalizeResearchOptions, planResearchQueries, retrieveResearchSources } from '@/lib/research-retrieval';
import type { AgentPlan, AgentToolCallLog, ResearchSource } from '@/types';

type LLMConfig = {
  apiKey?: string;
  endpoint?: string;
  provider?: string;
  defaultModel?: string;
};

type ToolConfig = {
  tavilyApiKey?: string;
  semanticScholarApiKey?: string;
  githubToken?: string;
};

type SupabaseLike = {
  from: (table: string) => any;
};

type SynapseToolDecision = {
  tool: 'researchSearch' | 'readDocument' | 'createDocument';
  title: string;
  reason: string;
  args: Record<string, any>;
};

type SynapseDecision = {
  intent: 'answer' | 'research' | 'read' | 'write';
  responseStyle: 'concise' | 'normal' | 'detailed';
  tools: SynapseToolDecision[];
  needsConfirmation?: boolean;
};

type SynapseRunOptions = {
  userId: string;
  message: string;
  conversationId?: string;
  supabase: SupabaseLike;
  llmConfig: LLMConfig | null;
  toolConfig: ToolConfig | null;
  agentSettings?: {
    model?: string;
    thinkingEnabled?: boolean;
  };
};

function id(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function sanitizeTextForPostgres(value: string, maxLength = 120000) {
  let output = '';
  for (let index = 0; index < value.length && output.length < maxLength; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0) continue;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        output += value[index] + value[index + 1];
        index += 1;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    output += value[index];
  }
  return output;
}

export function sanitizeForPostgres<T>(value: T, depth = 0): T {
  if (depth > 8) return null as T;
  if (typeof value === 'string') return sanitizeTextForPostgres(value) as T;
  if (Array.isArray(value)) return value.map(item => sanitizeForPostgres(item, depth + 1)) as T;
  if (value && typeof value === 'object') {
    const next: Record<string, any> = {};
    for (const [key, item] of Object.entries(value as Record<string, any>)) {
      next[sanitizeTextForPostgres(key, 200)] = sanitizeForPostgres(item, depth + 1);
    }
    return next as T;
  }
  return value;
}

function compactSource(source: ResearchSource) {
  return sanitizeForPostgres({
    id: source.id,
    title: source.title,
    url: source.url,
    type: source.type,
    sourceProvider: source.sourceProvider,
    year: source.year,
    citationCount: source.citationCount,
    authors: source.authors,
    snippet: source.snippet?.slice(0, 1200),
    abstract: source.abstract?.slice(0, 1200),
    fullTextExcerpt: source.fullTextExcerpt?.slice(0, 1200),
    score: source.score,
  });
}

function titleFromMessage(message: string) {
  return sanitizeTextForPostgres(message).replace(/\s+/g, ' ').trim().slice(0, 42) || 'Synapse Conversation';
}

function parseJsonObject(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function preferredModel(config: LLMConfig | null, override?: string) {
  if (override === 'deepseek-v4-flash' || override === 'deepseek-v4-pro') return override;
  if (!config?.defaultModel || config.defaultModel === 'deepseek-v4-flash') return 'deepseek-v4-pro';
  return config.defaultModel;
}

async function callSynapseLLM(config: LLMConfig | null, messages: any[], maxTokens = 1200, options: { model?: string; thinkingEnabled?: boolean } = {}) {
  if (!config?.apiKey || !config?.endpoint) return { content: '', reasoning: '', model: preferredModel(config, options.model), usedThinking: false };

  const model = preferredModel(config, options.model);
  const endpoint = config.endpoint;
  const apiKey = config.apiKey;
  const baseBody = {
    model,
    messages,
    temperature: 0.15,
    max_tokens: maxTokens,
  };

  async function post(body: Record<string, any>) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { res, data, text };
  }

  let usedThinking = false;
  let result = options.thinkingEnabled === false
    ? await post(baseBody)
    : await post({
        ...baseBody,
        enable_thinking: true,
        return_reasoning: true,
      });

  if (!result.res.ok && options.thinkingEnabled !== false) {
    result = await post(baseBody);
  } else {
    usedThinking = options.thinkingEnabled !== false;
  }

  if (!result.res.ok) return { content: '', reasoning: '', model, usedThinking: false };

  const message = result.data?.choices?.[0]?.message || {};
  return {
    content: message.content || '',
    reasoning: message.reasoning_content || message.reasoning || '',
    model,
    usedThinking,
  };
}

async function ensureConversation(supabase: SupabaseLike, userId: string, conversationId: string | undefined, message: string) {
  if (conversationId) {
    const { data, error } = await supabase
      .from('agent_conversations')
      .select('*')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }

  const { data, error } = await supabase
    .from('agent_conversations')
    .insert({ user_id: userId, title: titleFromMessage(message) })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function loadConversationContext(supabase: SupabaseLike, userId: string, conversationId: string) {
  const [{ data: messages }, { data: files }] = await Promise.all([
    supabase
      .from('agent_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(16),
    supabase
      .from('agent_files')
      .select('*')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(8),
  ]);

  return {
    messages: (messages || []).reverse(),
    files: files || [],
    memorySummary: '',
  };
}

async function maybeCompressMemory(
  options: SynapseRunOptions,
  conversation: any,
  context: { messages: any[]; files: any[]; memorySummary?: string }
) {
  const historyText = context.messages
    .map((row: any) => `${row.role}: ${sanitizeTextForPostgres(String(row.content || ''), 1200)}`)
    .join('\n');
  const existingSummary = sanitizeTextForPostgres(String(conversation.metadata?.memorySummary || ''), 3000);

  if (context.messages.length < 12 && historyText.length < 10000) {
    return existingSummary;
  }

  const llm = await callSynapseLLM(options.llmConfig, [
    {
      role: 'system',
      content: 'You summarize long Synapse agent conversations into durable memory. Keep user goals, preferences, key facts, uploaded document context, unfinished tasks, and tool results. Do not invent facts.',
    },
    {
      role: 'user',
      content: `Existing memory:
${existingSummary || 'None'}

Recent conversation:
${historyText}

Write an updated memory summary in Chinese, under 1200 Chinese characters.`,
    },
  ], 900, options.agentSettings);

  const memorySummary = sanitizeTextForPostgres(llm.content || existingSummary, 3000);
  if (memorySummary) {
    await options.supabase
      .from('agent_conversations')
      .update({
        metadata: sanitizeForPostgres({
          ...(conversation.metadata || {}),
          memorySummary,
          memoryUpdatedAt: new Date().toISOString(),
          memorySource: 'synapse_compaction',
        }),
      })
      .eq('id', conversation.id)
      .eq('user_id', options.userId);
  }
  return memorySummary;
}

async function insertMessage(supabase: SupabaseLike, userId: string, conversationId: string, role: string, content: string, metadata: Record<string, any> = {}) {
  const { data, error } = await supabase
    .from('agent_messages')
    .insert({
      user_id: userId,
      conversation_id: conversationId,
      role,
      content: sanitizeTextForPostgres(content),
      metadata: sanitizeForPostgres(metadata),
    })
    .select()
    .single();
  if (error) throw error;
  await supabase
    .from('agent_conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId)
    .eq('user_id', userId);
  return data;
}

async function insertToolTrace(
  supabase: SupabaseLike,
  userId: string,
  conversationId: string,
  toolName: string,
  input: Record<string, any>,
  output: Record<string, any>,
  summary: string,
  messageId?: string
) {
  await supabase.from('agent_tool_traces').insert({
    user_id: userId,
    conversation_id: conversationId,
    message_id: messageId || null,
    tool_name: toolName,
    status: 'completed',
    input: sanitizeForPostgres(input),
    output: sanitizeForPostgres(output),
    summary: sanitizeTextForPostgres(summary),
  });
}

function heuristicDecision(message: string, files: any[]): SynapseDecision {
  const lower = message.toLowerCase();
  const wantsSearch = /检索|搜索|联网|查找|查一下|搜一下|资料|论文|文献|综述|最新|趋势|进展|research|search|paper|literature|source|web/.test(lower);
  const wantsRead = /文件|文档|附件|上传|pdf|docx|阅读|总结这份|分析这份|file|document|attachment|read|summarize/.test(lower) && files.length > 0;
  const wantsWrite = /创建|生成|写.*文档|写.*报告|写.*简报|整理成|保存|下载|导出|markdown|docx|create|generate|write|document|report|export/.test(lower);
  const tools: SynapseToolDecision[] = [];

  if (wantsRead) {
    tools.push({
      tool: 'readDocument',
      title: '读取会话文档',
      reason: '用户提到了已上传文件或文档，需要先读取文档内容。',
      args: { query: message },
    });
  }

  if (wantsSearch) {
    const mode = /论文|文献|综述|学术|paper|literature|semantic scholar|openalex|arxiv/.test(lower)
      ? 'academic'
      : /网页|官网|新闻|博客|产业|项目|github|web|news|blog|official|docs/.test(lower)
        ? 'general'
        : 'both';
    tools.push({
      tool: 'researchSearch',
      title: mode === 'academic' ? '学术检索' : mode === 'general' ? 'Web 检索' : '综合检索',
      reason: '用户需要外部资料支持回答。',
      args: { query: message, mode, depth: /深度|全面|详细|deep/.test(lower) ? 'deep' : 'medium' },
    });
  }

  if (wantsWrite) {
    tools.push({
      tool: 'createDocument',
      title: '创建文档',
      reason: '创建或导出文档属于副作用动作，需要用户确认。',
      args: { title: titleFromMessage(message), documentType: 'synapse_document' },
    });
  }

  return {
    intent: wantsWrite ? 'write' : wantsSearch ? 'research' : wantsRead ? 'read' : 'answer',
    responseStyle: /简短|简单|brief|short/.test(lower) ? 'concise' : /详细|全面|deep|detailed/.test(lower) ? 'detailed' : 'normal',
    tools,
    needsConfirmation: wantsWrite,
  };
}

async function decideTools(
  message: string,
  context: { messages: any[]; files: any[]; memorySummary?: string },
  llmConfig: LLMConfig | null,
  agentSettings?: SynapseRunOptions['agentSettings']
) {
  const system = `You are Synapse, the main agent controller for Synap.
Choose tools only when useful. Return strict JSON only.

Available tools:
- researchSearch: external retrieval pipeline. Args: query, mode academic|general|both, depth fast|medium|deep.
- readDocument: read uploaded conversation files. Args: query, fileIds optional.
- createDocument: create a saved Markdown document. This is a side-effect and needs user confirmation.

Rules:
- Conversation is primary. If the user asks a normal question, answer without tools.
- If external facts/latest papers/web info are needed, use researchSearch.
- If the user asks about uploaded files, use readDocument.
- If the user asks to create/save/export a document, include createDocument and set needsConfirmation true.
- Do not include createDocument for simple capability/model questions.

JSON shape:
{"intent":"answer|research|read|write","responseStyle":"concise|normal|detailed","needsConfirmation":false,"tools":[{"tool":"researchSearch|readDocument|createDocument","title":"...","reason":"...","args":{}}]}`;

  const history = context.messages
    .slice(-8)
    .map((row: any) => `${row.role}: ${sanitizeTextForPostgres(String(row.content || ''), 600)}`)
    .join('\n');
  const files = context.files.map((file: any) => `${file.id}: ${sanitizeTextForPostgres(file.file_name || '', 200)} (${file.file_type}, ${file.content_text?.length || 0} chars)`).join('\n') || 'No uploaded files.';
  const llm = await callSynapseLLM(llmConfig, [
    { role: 'system', content: system },
    { role: 'user', content: `Durable memory:\n${context.memorySummary || 'None'}\n\nRecent conversation:\n${history || 'None'}\n\nFiles:\n${files}\n\nUser message:\n${message}` },
  ], 700, agentSettings);

  const parsed = parseJsonObject(llm.content);
  if (!parsed || !Array.isArray(parsed.tools)) return heuristicDecision(message, context.files);

  const validTools = parsed.tools
    .filter((tool: any) => tool?.tool === 'researchSearch' || tool?.tool === 'readDocument' || tool?.tool === 'createDocument')
    .slice(0, 4)
    .map((tool: any) => ({
      tool: tool.tool,
      title: String(tool.title || tool.tool).slice(0, 80),
      reason: String(tool.reason || '').slice(0, 240),
      args: typeof tool.args === 'object' && tool.args ? tool.args : {},
    })) as SynapseToolDecision[];

  return {
    intent: parsed.intent === 'research' || parsed.intent === 'read' || parsed.intent === 'write' ? parsed.intent : 'answer',
    responseStyle: parsed.responseStyle === 'concise' || parsed.responseStyle === 'detailed' ? parsed.responseStyle : 'normal',
    needsConfirmation: Boolean(parsed.needsConfirmation || validTools.some(tool => tool.tool === 'createDocument')),
    tools: validTools,
  } satisfies SynapseDecision;
}

function sourcesContext(sources: ResearchSource[]) {
  return sources.slice(0, 10).map((source, index) => {
    const text = sanitizeTextForPostgres(source.fullTextExcerpt || source.abstract || source.snippet || '', 900);
    return `[S${index + 1}] ${sanitizeTextForPostgres(source.title || '', 300)}
Provider: ${source.sourceProvider || source.type}
Year: ${source.year || ''}
URL: ${source.url || ''}
Excerpt: ${text}`;
  }).join('\n\n');
}

function filesContext(files: any[]) {
  return files.slice(0, 6).map((file, index) => {
    return `[F${index + 1}] ${sanitizeTextForPostgres(file.file_name || '', 300)}
Type: ${file.file_type}
Excerpt: ${sanitizeTextForPostgres(String(file.content_text || ''), 1800)}`;
  }).join('\n\n');
}

async function runResearchTool(decision: SynapseToolDecision, options: SynapseRunOptions, conversationId: string) {
  const selected = normalizeResearchOptions(decision.args.mode, decision.args.depth);
  const query = String(decision.args.query || options.message).trim();
  const retrievalOptions = {
    query,
    mode: selected.mode,
    depth: selected.depth,
    llmConfig: {
      apiKey: options.llmConfig?.apiKey || '',
      endpoint: options.llmConfig?.endpoint || '',
      defaultModel: preferredModel(options.llmConfig, options.agentSettings?.model),
    },
    toolConfig: {
      tavilyApiKey: options.toolConfig?.tavilyApiKey || '',
      semanticScholarApiKey: options.toolConfig?.semanticScholarApiKey || '',
      githubToken: options.toolConfig?.githubToken || '',
    },
    supabase: options.supabase,
    includeGithub: decision.args.includeGithub === true,
  };
  const plan = await planResearchQueries(retrievalOptions);
  const sources = await retrieveResearchSources({ ...retrievalOptions, plan });
  const summary = `${selected.mode === 'academic' ? '学术检索' : selected.mode === 'general' ? 'Web 检索' : '综合检索'}完成：${sources.length} 个来源。`;
  await insertToolTrace(options.supabase, options.userId, conversationId, 'researchSearch', { query, mode: selected.mode, depth: selected.depth }, { sourceCount: sources.length, plannedQueries: plan, sources: sources.slice(0, 12).map(compactSource) }, summary);
  return {
    call: {
      id: id('tool'),
      tool: 'researchSearch',
      title: decision.title || '检索资料',
      status: 'completed',
      args: { query, mode: selected.mode, depth: selected.depth, reason: decision.reason },
      result: summary,
    } as AgentToolCallLog,
    sources,
  };
}

async function runReadDocumentTool(decision: SynapseToolDecision, options: SynapseRunOptions, conversationId: string) {
  let query = options.supabase
    .from('agent_files')
    .select('*')
    .eq('conversation_id', conversationId)
    .eq('user_id', options.userId)
    .order('created_at', { ascending: false })
    .limit(8);

  if (Array.isArray(decision.args.fileIds) && decision.args.fileIds.length) {
    query = query.in('id', decision.args.fileIds);
  }

  const { data: files, error } = await query;
  if (error) throw error;
  const readable = (files || []).filter((file: any) => String(file.content_text || '').trim());
  const summary = readable.length
    ? `已读取 ${readable.length} 个会话文档。`
    : '没有找到可读取文本的会话文档。';
  await insertToolTrace(options.supabase, options.userId, conversationId, 'readDocument', { fileIds: decision.args.fileIds || [], query: decision.args.query || options.message }, { files: readable.map((file: any) => ({ id: file.id, file_name: file.file_name, chars: file.content_text?.length || 0 })) }, summary);
  return {
    call: {
      id: id('tool'),
      tool: 'readDocument',
      title: decision.title || '读取文档',
      status: 'completed',
      args: { query: decision.args.query || options.message, reason: decision.reason },
      result: summary,
    } as AgentToolCallLog,
    files: readable,
  };
}

async function generateAnswer(
  options: SynapseRunOptions,
  conversation: any,
  context: { messages: any[]; files: any[]; memorySummary?: string },
  decision: SynapseDecision,
  toolCalls: AgentToolCallLog[],
  sources: ResearchSource[],
  readFiles: any[]
) {
  const sourceBlock = sourcesContext(sources);
  const fileBlock = filesContext(readFiles);
  const history = context.messages
    .slice(-10)
    .map((row: any) => `${row.role}: ${sanitizeTextForPostgres(String(row.content || ''), 900)}`)
    .join('\n');
  const pendingWrite = decision.tools.find(tool => tool.tool === 'createDocument');

  const system = `You are Synapse, the main conversational research agent for Synap.
Answer in the user's language. Be direct and useful.
If sources are available, cite them as [S1], [S2]. If uploaded files are used, cite them as [F1], [F2].
Always briefly mention what tools you used when tools were called.
If a createDocument action is pending, do not claim it has been created; say it needs confirmation.`;

  const prompt = `Conversation:
${history || 'None'}

Durable memory:
${context.memorySummary || 'None'}

User message:
${options.message}

Tool calls:
${toolCalls.map(call => `- ${call.title}: ${call.result || call.error || ''}`).join('\n') || 'No tools called.'}

Retrieved sources:
${sourceBlock || 'None'}

Uploaded file excerpts:
${fileBlock || 'None'}

Pending side-effect:
${pendingWrite ? `${pendingWrite.title}: ${pendingWrite.reason}` : 'None'}

Write the final assistant response now.`;

  const llm = await callSynapseLLM(options.llmConfig, [
    { role: 'system', content: system },
    { role: 'user', content: prompt },
  ], decision.responseStyle === 'detailed' ? 2200 : decision.responseStyle === 'concise' ? 800 : 1400, options.agentSettings);

  if (llm.content.trim()) {
    return {
      content: llm.content.trim(),
      reasoning: llm.reasoning,
      model: llm.model,
      usedThinking: llm.usedThinking,
    };
  }

  const fallback = toolCalls.length
    ? `我已完成工具调用：${toolCalls.map(call => call.result || call.title).join('；')}\n\n${sources.length ? `检索到了 ${sources.length} 个来源。你可以在右侧来源栏查看，我也可以继续基于这些来源生成文档或进一步分析。` : ''}${readFiles.length ? `已读取 ${readFiles.length} 个上传文档。` : ''}`
    : '我可以直接回答这个问题；如果你希望我检索资料、读取上传文档或创建文档，可以直接告诉我。';
  return { content: fallback, reasoning: '', model: preferredModel(options.llmConfig, options.agentSettings?.model), usedThinking: false };
}

function confirmationPlan(message: string, decision: SynapseDecision): AgentPlan | null {
  const writeTool = decision.tools.find(tool => tool.tool === 'createDocument');
  if (!writeTool) return null;
  return {
    id: id('plan'),
    title: '创建文档',
    summary: '创建或保存文档属于副作用动作，需要你确认后再执行。',
    steps: [{
      id: id('step'),
      tool: 'createDocument',
      title: writeTool.title || '创建 Markdown 文档',
      description: writeTool.reason || '基于本轮对话、工具结果和用户要求创建文档。',
      args: {
        title: writeTool.args.title || titleFromMessage(message),
        documentType: writeTool.args.documentType || 'synapse_document',
      },
    }],
    requiresConfirmation: true,
    createdAt: new Date().toISOString(),
  };
}

export async function runSynapseTurn(options: SynapseRunOptions) {
  const conversation = await ensureConversation(options.supabase, options.userId, options.conversationId, options.message);
  const beforeContext = await loadConversationContext(options.supabase, options.userId, conversation.id);
  beforeContext.memorySummary = await maybeCompressMemory(options, conversation, beforeContext);
  await insertMessage(options.supabase, options.userId, conversation.id, 'user', options.message);

  const decision = await decideTools(options.message, beforeContext, options.llmConfig, options.agentSettings);
  const executableTools = decision.tools.filter(tool => tool.tool !== 'createDocument');
  const pendingPlan = confirmationPlan(options.message, decision);
  const toolCalls: AgentToolCallLog[] = [];
  const allSources: ResearchSource[] = [];
  const readFiles: any[] = [];

  for (const tool of executableTools) {
    try {
      if (tool.tool === 'researchSearch') {
        const result = await runResearchTool(tool, options, conversation.id);
        toolCalls.push(result.call);
        allSources.push(...result.sources);
      }
      if (tool.tool === 'readDocument') {
        const result = await runReadDocumentTool(tool, options, conversation.id);
        toolCalls.push(result.call);
        readFiles.push(...result.files);
      }
    } catch (error: any) {
      toolCalls.push({
        id: id('tool'),
        tool: tool.tool,
        title: tool.title,
        status: 'failed',
        args: tool.args || {},
        error: error.message || 'Tool failed',
      } as AgentToolCallLog);
    }
  }

  const answer = await generateAnswer(options, conversation, beforeContext, decision, toolCalls, allSources, readFiles);
  const assistant = await insertMessage(options.supabase, options.userId, conversation.id, 'assistant', answer.content, {
    agent: 'synapse',
    decision,
    toolCalls,
    sources: allSources.slice(0, 12).map(compactSource),
    readFiles: readFiles.map(file => ({ id: file.id, file_name: file.file_name })),
    reasoning: answer.reasoning,
    model: answer.model,
    usedThinking: answer.usedThinking,
    agentSettings: options.agentSettings || {},
    pendingPlan,
  });

  const refreshed = await loadConversationContext(options.supabase, options.userId, conversation.id);
  return {
    conversation,
    assistant,
    messages: refreshed.messages,
    type: pendingPlan ? 'plan' : 'result',
    message: answer.content,
    plan: pendingPlan,
    toolCalls,
    sources: allSources,
    files: readFiles,
    reasoning: answer.reasoning,
    model: answer.model,
    usedThinking: answer.usedThinking,
  };
}

export async function loadRecentResearchSources(supabase: SupabaseLike, userId: string, conversationId: string) {
  const { data } = await supabase
    .from('agent_tool_traces')
    .select('output')
    .eq('user_id', userId)
    .eq('conversation_id', conversationId)
    .eq('tool_name', 'researchSearch')
    .order('created_at', { ascending: false })
    .limit(5);

  return (data || []).flatMap((row: any) => Array.isArray(row.output?.sources) ? row.output.sources : []) as ResearchSource[];
}
