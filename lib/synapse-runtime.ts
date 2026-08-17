import { generateAgentDocument } from '@/lib/agent-runtime';
import {
  downloadUrlToWorkspace,
  extractWorkspaceZipForFile,
  fileExtension,
  isSupportedArchive,
  isTextLikeFile,
  listWorkspaceFiles,
  runWorkspaceCommand,
  textPreviewFromWorkspaceFile,
} from '@/lib/agent-workspace';
import { recordAgentDocumentArtifact, recordAgentFileArtifact, recordExtractedDirArtifact } from '@/lib/agent-artifacts';
import { MemoryManager, MemoryWriter, type RankedMemory } from '@/lib/memory-service';
import { appendAgentRunEvent, updateAgentRun } from '@/lib/agent-run-service';
import { normalizeResearchOptions, planResearchQueries, retrieveResearchSources } from '@/lib/research-retrieval';
import { getUserMineruConfigByUserId } from '@/lib/user-settings';
import type { AgentPlan, AgentToolCallLog, ResearchSource } from '@/types';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';

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
  tool: 'researchSearch' | 'readDocument' | 'convertDocument' | 'createDocument' | 'downloadFile' | 'downloadPaper' | 'runTerminal' | 'listSandboxFiles';
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
  runId?: string;
  onEvent?: (event: SynapseRuntimeEvent) => void | Promise<void>;
};

type SynapseConfirmedDocumentOptions = SynapseRunOptions & {
  conversationId: string;
  confirmedPlan: AgentPlan;
};

type SynapseRuntimeEvent = {
  type: 'run' | 'token' | 'node_start' | 'node_done' | 'tool_start' | 'tool_done' | 'tool_error';
  node?: string;
  tool?: SynapseToolDecision['tool'] | 'synapse';
  title?: string;
  message?: string;
  status?: AgentToolCallLog['status'];
  data?: Record<string, any>;
};

type SynapseGraphTraceEvent = {
  node: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  summary?: string;
};

type SynapseMemoryContext = {
  memories: RankedMemory[];
  contextText: string;
  error?: string;
};

type SynapseConversationContext = {
  messages: any[];
  files: any[];
  memorySummary?: string;
  memoryContext?: SynapseMemoryContext;
};

const FLASH_MODEL = 'deepseek-ai/DeepSeek-V4-Flash';

const SYNAPSE_AGENT_OPERATING_GUIDE = `
Synapse operating guide:
- Your primary mode is conversational. Answer normal questions directly; only use tools when they are actually needed.
- Side-effect actions must be confirmed before execution: createDocument, convertDocument, downloadFile, downloadPaper, runTerminal. Before confirmation, do not say the action is complete.
- The server workspace is persistent per user. Uploaded files, downloaded files, extracted archives, converted Markdown, generated documents, and sandbox command outputs may persist across conversations.
- Terminal commands run in a restricted sandbox at /workspace. Use them for explicit file inspection, code/repo operations, archive extraction, or user-requested shell work.
- Do not use terminal scripts to fake platform tools. In particular, never create random embeddings with numpy/random and never write embeddings.json as a substitute for the real knowledge-base embedding pipeline.
- Document embedding/indexing is handled by Synap's knowledge-base import and HyperRAG pipeline, not by ad-hoc terminal vectors. If no direct embed tool is available in this chat turn, explain the correct UI/tool flow instead of inventing one.
- For Python commands that need files, loops, with-statements, try/except, functions, or imports plus compound statements, prefer a heredoc:
  python3 <<'PY'
  from pathlib import Path
  text = Path("file.md").read_text()
  print(len(text))
  PY
  Do not write invalid one-liners such as: python3 -c 'import json; with open(...) as f: ...'
- For retrieval, use researchSearch. Choose academic for papers/literature/reviews, general for web/docs/news, and both for broad technical research.
- For paper download, use researchSearch first, then downloadPaper after user confirmation. Do not guess PDF URLs in terminal unless the user explicitly asks for terminal work.
- For uploaded or generated files, use readDocument/listSandboxFiles before answering about their content.
- For PDF-to-Markdown, PDF parsing, or MinerU conversion, use convertDocument after user confirmation. Do not use readDocument for an unconverted PDF and do not tell the user to manually use the UI when the conversion tool is available.
`.trim();

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
    pdfUrl: source.pdfUrl,
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
  if (override === FLASH_MODEL) return override;
  if (config?.defaultModel === FLASH_MODEL) return config.defaultModel;
  if (config?.provider && config.provider !== 'deepseek' && config.defaultModel) return config.defaultModel;
  return FLASH_MODEL;
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

async function callSynapseLLMStreaming(
  config: LLMConfig | null,
  messages: any[],
  maxTokens = 1200,
  options: { model?: string; thinkingEnabled?: boolean } = {},
  onToken?: (token: string, meta: { kind: 'content' | 'reasoning' }) => void | Promise<void>
) {
  if (!onToken || !config?.apiKey || !config?.endpoint) {
    return callSynapseLLM(config, messages, maxTokens, options);
  }

  const model = preferredModel(config, options.model);
  const endpoint = config.endpoint;
  const apiKey = config.apiKey;
  const emitToken = onToken;
  const baseBody = {
    model,
    messages,
    temperature: 0.15,
    max_tokens: maxTokens,
    stream: true,
  };

  async function postStream(body: Record<string, any>) {
    return fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
  }

  let usedThinking = false;
  let res = options.thinkingEnabled === false
    ? await postStream(baseBody)
    : await postStream({
        ...baseBody,
        enable_thinking: true,
        return_reasoning: true,
      });

  if (!res.ok && options.thinkingEnabled !== false) {
    res = await postStream(baseBody);
  } else {
    usedThinking = options.thinkingEnabled !== false;
  }

  if (!res.ok || !res.body) {
    return callSynapseLLM(config, messages, maxTokens, options);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let reasoning = '';

  async function handleLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let data: any = null;
    try {
      data = JSON.parse(payload);
    } catch {
      return;
    }
    const delta = data?.choices?.[0]?.delta || data?.choices?.[0]?.message || {};
    const reasoningToken = delta.reasoning_content || delta.reasoning || '';
    const contentToken = delta.content || '';
    if (reasoningToken) {
      reasoning += reasoningToken;
      await emitToken(reasoningToken, { kind: 'reasoning' });
    }
    if (contentToken) {
      content += contentToken;
      await emitToken(contentToken, { kind: 'content' });
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      await handleLine(line);
    }
  }
  if (buffer.trim()) await handleLine(buffer);

  return { content, reasoning, model, usedThinking };
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

function documentAsWorkspaceFile(document: any) {
  return {
    id: `doc:${document.id}`,
    conversation_id: document.conversation_id || '',
    user_id: document.user_id,
    file_name: `${document.title || 'Synapse document'}.md`,
    file_type: 'agent_document',
    file_size: String(document.content_md || '').length,
    storage_path: null,
    file_url: null,
    content_text: document.content_md || '',
    metadata: {
      ...(document.metadata || {}),
      source: 'agent_documents',
      documentId: document.id,
    },
    created_at: document.updated_at || document.created_at,
  };
}

async function loadConversationContext(supabase: SupabaseLike, userId: string, conversationId: string): Promise<SynapseConversationContext> {
  const [{ data: messages }, { data: files }, { data: documents }] = await Promise.all([
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
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30),
    supabase
      .from('agent_documents')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(20),
  ]);

  return {
    messages: (messages || []).reverse(),
    files: [...(files || []), ...(documents || []).map(documentAsWorkspaceFile)],
    memorySummary: '',
    memoryContext: { memories: [], contextText: '' },
  };
}

async function maybeCompressMemory(
  options: SynapseRunOptions,
  conversation: any,
  context: SynapseConversationContext
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

function compactMemory(memory: RankedMemory | any) {
  return sanitizeForPostgres({
    id: memory.id,
    layer: memory.layer,
    memoryType: memory.memory_type,
    title: memory.title,
    summary: memory.summary || memory.content?.slice(0, 240) || '',
    relevanceScore: memory.relevanceScore ?? null,
    matchedTerms: memory.matchedTerms || [],
    tags: memory.tags || [],
  });
}

async function retrieveSynapseMemoryContext(options: SynapseRunOptions, conversation: any, context: SynapseConversationContext): Promise<SynapseMemoryContext> {
  try {
    const manager = new MemoryManager(options.supabase, options.userId);
    const query = [
      options.message,
      conversation?.title || '',
      context.memorySummary || '',
      context.messages.slice(-4).map((row: any) => `${row.role}: ${String(row.content || '').slice(0, 500)}`).join('\n'),
    ].filter(Boolean).join('\n');
    const result = await manager.getMemoryContext(query, { limit: 8 });
    return {
      memories: result.memories,
      contextText: result.contextText,
    };
  } catch (error: any) {
    const message = error?.message || String(error || '');
    console.warn('Synapse memory retrieval skipped:', message);
    return {
      memories: [],
      contextText: '',
      error: message,
    };
  }
}

async function writeSynapseTurnMemories(
  options: SynapseRunOptions,
  conversationId: string,
  userMessage: string,
  assistantMessage: string
) {
  try {
    const manager = new MemoryManager(options.supabase, options.userId);
    const settings = await manager.ensureSettings();
    if (settings?.auto_write_enabled === false) {
      return { written: [], skipped: 'auto_write_disabled' };
    }
    const writer = new MemoryWriter(manager);
    const written = await writer.writeCandidates({
      userMessage,
      assistantMessage,
      sourceType: 'agent_conversation',
      sourceId: conversationId,
    });
    return { written, skipped: '' };
  } catch (error: any) {
    const message = error?.message || String(error || '');
    console.warn('Synapse memory write skipped:', message);
    return { written: [], skipped: message };
  }
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

function cleanHeuristicDecision(message: string, files: any[]): SynapseDecision {
  const lower = message.toLowerCase();
  const wantsConvert = /转换|转成|转为|解析.*pdf|pdf.*解析|pdf.*markdown|mineru|convert|parse pdf|pdf to markdown/i.test(message);
  const wantsSearch = /检索|搜索|联网|查找|查一下|搜一下|资料|论文|文献|综述|最新|趋势|进展|research|search|paper|literature|source|web/.test(lower);
  const wantsRead = /文件|文档|附件|上传|pdf|docx|阅读|总结这份|分析这份|file|document|attachment|read|summarize/.test(lower) && files.length > 0;
  const wantsWrite = /创建|生成|写.*文档|写.*报告|写.*简报|整理成.*文档|保存.*文档|导出|markdown|docx|create|generate|write|document|report|export/.test(lower);
  const wantsDownload = /(下载|抓取|保存).*(https?:\/\/\S+)|download\s+https?:\/\/\S+/i.test(message);
  const wantsPaperDownload = /(下载|保存|获取|抓取).*(论文|文献|paper|pdf)|(paper|pdf).*(download|save)/i.test(message);
  const wantsTerminal = /运行命令|执行命令|终端|命令行|shell|terminal|run command|execute command/.test(lower);
  const wantsListSandbox = /沙箱.*文件|工作区.*文件|列出.*文件|list.*files|ls workspace/.test(lower);
  const tools: SynapseToolDecision[] = [];

  if (wantsRead) {
    tools.push({
      tool: 'readDocument',
      title: '读取会话文档',
      reason: '用户提到了已上传文件或文档，需要先读取文档内容。',
      args: { query: message },
    });
  }

  if (wantsSearch || wantsPaperDownload) {
    const mode = /论文|文献|综述|学术|paper|literature|semantic scholar|openalex|arxiv/.test(lower)
      ? 'academic'
      : /网页|官网|新闻|博客|产业|项目|github|web|news|blog|official|docs/.test(lower)
        ? 'general'
        : 'both';
    tools.push({
      tool: 'researchSearch',
      title: mode === 'academic' ? '学术检索' : mode === 'general' ? 'Web 检索' : '综合检索',
      reason: '用户需要外部资料支撑回答。',
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

  if (wantsListSandbox) {
    tools.push({
      tool: 'listSandboxFiles',
      title: '列出沙箱文件',
      reason: '用户想查看服务器沙箱/工作区内的文件。',
      args: { maxFiles: 80 },
    });
  }

  if (wantsDownload) {
    const url = message.match(/https?:\/\/[^\s"'<>]+/)?.[0] || '';
    tools.push({
      tool: 'downloadFile',
      title: '下载文件到沙箱',
      reason: '从外部链接下载文件会改变服务器工作区，需要用户确认。',
      args: { url },
    });
  }

  if (wantsPaperDownload) {
    tools.push({
      tool: 'downloadPaper',
      title: '下载论文 PDF',
      reason: '用户希望下载检索到的论文 PDF，需要先解析可访问 PDF 链接并在确认后保存到工作区。',
      args: { title: message, rank: 1 },
    });
  }

  if (wantsTerminal) {
    tools.push({
      tool: 'runTerminal',
      title: '运行沙箱终端命令',
      reason: '终端命令会在服务器 Docker 沙箱中执行，需要用户确认。',
      args: { command: message.replace(/^(运行命令|执行命令|终端|命令行)[:：]?\s*/i, '').trim() },
    });
  }

  if (wantsConvert) {
    const remainingTools = tools.filter(tool => tool.tool !== 'readDocument' && tool.tool !== 'createDocument' && tool.tool !== 'convertDocument');
    tools.length = 0;
    tools.push({
      tool: 'convertDocument',
      title: '转换 PDF 为 Markdown',
      reason: '用户要求解析或转换 PDF，应该使用 MinerU 转换工具，而不是直接读取未转换 PDF。',
      args: { query: message },
    }, ...remainingTools);
  }

  return {
    intent: (wantsWrite || wantsConvert || wantsDownload || wantsPaperDownload || wantsTerminal) ? 'write' : wantsSearch ? 'research' : wantsRead ? 'read' : 'answer',
    responseStyle: /简短|简洁|brief|short/.test(lower) ? 'concise' : /详细|全面|deep|detailed/.test(lower) ? 'detailed' : 'normal',
    tools,
    needsConfirmation: wantsWrite || wantsConvert || wantsDownload || wantsPaperDownload || wantsTerminal,
  };
}

function heuristicDecision(message: string, files: any[]): SynapseDecision {
  return cleanHeuristicDecision(message, files);
  const lower = message.toLowerCase();
  const wantsSearch = /检索|搜索|联网|查找|查一下|搜一下|资料|论文|文献|综述|最新|趋势|进展|research|search|paper|literature|source|web/.test(lower);
  const wantsRead = /文件|文档|附件|上传|pdf|docx|阅读|总结这份|分析这份|file|document|attachment|read|summarize/.test(lower) && files.length > 0;
  const wantsWrite = /创建|生成|写.*文档|写.*报告|写.*简报|整理成.*文档|保存.*文档|导出|markdown|docx|create|generate|write|document|report|export/.test(lower);
  const wantsDownload = /(下载|抓取|保存).*(https?:\/\/\S+)|download\s+https?:\/\/\S+/i.test(message);
  const wantsTerminal = /运行命令|执行命令|终端|命令行|shell|terminal|run command|execute command/.test(lower);
  const wantsListSandbox = /沙箱.*文件|工作区.*文件|列出.*文件|list.*files|ls workspace/.test(lower);
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

  if (wantsListSandbox) {
    tools.push({
      tool: 'listSandboxFiles',
      title: '列出沙箱文件',
      reason: '用户想查看服务器沙箱/工作区内的文件。',
      args: { maxFiles: 80 },
    });
  }

  if (wantsDownload) {
    const url = message.match(/https?:\/\/[^\s"'<>]+/)?.[0] || '';
    tools.push({
      tool: 'downloadFile',
      title: '下载文件到沙箱',
      reason: '从外部链接下载文件会改变服务器工作区，需要用户确认。',
      args: { url },
    });
  }

  if (wantsTerminal) {
    tools.push({
      tool: 'runTerminal',
      title: '运行沙箱终端命令',
      reason: '终端命令会在服务器沙箱中执行，需要用户确认。',
      args: { command: message.replace(/^(运行命令|执行命令|终端|命令行)[:：]?\s*/i, '').trim() },
    });
  }

  return {
    intent: (wantsWrite || wantsDownload || wantsTerminal) ? 'write' : wantsSearch ? 'research' : wantsRead ? 'read' : 'answer',
    responseStyle: /简短|简单|brief|short/.test(lower) ? 'concise' : /详细|全面|deep|detailed/.test(lower) ? 'detailed' : 'normal',
    tools,
    needsConfirmation: wantsWrite || wantsDownload || wantsTerminal,
  };
}

async function decideTools(
  message: string,
  context: SynapseConversationContext,
  llmConfig: LLMConfig | null,
  agentSettings?: SynapseRunOptions['agentSettings']
) {
  const system = `You are Synapse, the main agent controller for Synap.
Your job is to decide whether the next assistant reply should answer directly or call tools first.
Return strict JSON only. Do not write prose outside JSON.

Runtime facts:
- Synapse has a persistent per-user server workspace. Uploaded files, downloaded files, extracted archives, converted Markdown, and generated documents can persist across conversations.
- Terminal commands, when confirmed by the user, run in a restricted Docker sandbox mounted at /workspace. The sandbox is not arbitrary host access.
- When the user asks what workspace you have, choose no tools so the answer generator can explain these facts. Only call listSandboxFiles if they ask to inspect actual files.

${SYNAPSE_AGENT_OPERATING_GUIDE}

Think step by step before returning JSON:

1. Task analysis: classify the intent (answer / research / read / write) and complexity (simple question vs multi-step task). Note which resources matter: workspace files, long-term memory, or external sources.

2. Goal decomposition: for a multi-step request (e.g. "retrieve X then write a report"), break it into ordered sub-goals and express them as an ordered tools array. For a simple question, keep the array empty and use no tools.

3. Tool selection: for each sub-goal pick the single most fitting tool from the list below. Prefer fewer, higher-leverage tools over calling many.

4. Execution order: place non side-effect tools (researchSearch, readDocument, listSandboxFiles) before side-effect tools (createDocument, convertDocument, downloadFile, downloadPaper, runTerminal). Express dependencies as array order; keep researchSearch before downloadPaper or createDocument when they depend on search results.

5. Output JSON: emit only the JSON object with intent, responseStyle, needsConfirmation, and an ordered tools array. Give every tool a short title, a one-line reason, and concrete args (specific query, explicit mode/depth, real fileIds/urls when known).

Available tools:
- researchSearch: Synap unified retrieval pipeline. Args: query, mode academic|general|both, depth fast|medium|deep.
- readDocument: read the user's Synapse workspace files, including uploaded files, converted Markdown, and generated documents. Args: query, fileIds optional.
- convertDocument: submit an uploaded or downloaded PDF to MinerU for Markdown/ZIP conversion. Args: fileId optional, fileName optional, query optional. This is a side-effect and needs user confirmation.
- createDocument: create a saved Markdown document. This is a side-effect and needs user confirmation.
- listSandboxFiles: list files in the user's server sandbox workspace. Args: maxFiles optional.
- downloadFile: download a public http/https URL into the user's server sandbox workspace. Args: url, fileName optional. This is a side-effect and needs user confirmation.
- downloadPaper: resolve and download a PDF for a paper from recent search results. Args: title optional, sourceId optional, rank optional. This is a side-effect and needs user confirmation. Use it after researchSearch when the user asks to download papers found by search.
- runTerminal: run a restricted terminal command inside the user's server sandbox workspace. Args: command, cwd optional. This is a side-effect and needs user confirmation.

Routing rules:
- Normal questions, capability questions, model/settings questions, or conversational follow-ups should use no tools.
- Use researchSearch only when the user needs external facts, latest information, papers, web evidence, project docs, or citations.
- Choose academic for papers/literature/reviews/arXiv/Semantic Scholar/OpenAlex; general for web/news/docs/products/tutorials; both for broad research briefs or technical landscape questions.
- Use readDocument when the user refers to uploaded files, converted files, generated documents, "this document", "the PDF", attachments, or asks to summarize/analyze workspace content.
- Use convertDocument when the user asks to convert, parse, or extract a PDF with MinerU or asks for PDF to Markdown. Mark needsConfirmation true. Do not use readDocument for an unconverted PDF.
- Use createDocument only when the user explicitly wants to create/save/export/generate a document/report/markdown/docx. Mark needsConfirmation true.
- If createDocument depends on external facts, include researchSearch before createDocument.
- If the user asks to embed/index/import a document into a knowledge base, do not use runTerminal to generate fake embeddings. If this turn has no direct embed tool, answer with the proper file-library/import flow or use readDocument if analysis is requested.
- Use listSandboxFiles when the user asks what files are in the sandbox/workspace.
- Use downloadFile when the user asks to download/save/fetch a URL into the sandbox. Mark needsConfirmation true.
- Use downloadPaper when the user asks to download a paper/PDF from search results or asks to find and download a paper. Usually include researchSearch before downloadPaper so the paper source exists.
- Use runTerminal when the user explicitly asks to run a command or use terminal/shell. Mark needsConfirmation true.
- Do not call tools just to say what tools are available.

JSON shape:
{"intent":"answer|research|read|write","responseStyle":"concise|normal|detailed","needsConfirmation":false,"tools":[{"tool":"researchSearch|readDocument|convertDocument|createDocument|listSandboxFiles|downloadFile|downloadPaper|runTerminal","title":"...","reason":"...","args":{}}]}`;

  const history = context.messages
    .slice(-8)
    .map((row: any) => `${row.role}: ${sanitizeTextForPostgres(String(row.content || ''), 600)}`)
    .join('\n');
  const files = context.files.map((file: any) => `${file.id}: ${sanitizeTextForPostgres(file.file_name || '', 200)} (${file.file_type}, ${file.content_text?.length || 0} chars)`).join('\n') || 'No workspace files.';
  const llm = await callSynapseLLM(llmConfig, [
    { role: 'system', content: system },
    { role: 'user', content: `Conversation summary memory:\n${context.memorySummary || 'None'}\n\nStructured long-term memory:\n${context.memoryContext?.contextText || 'None'}\n\nRecent conversation:\n${history || 'None'}\n\nFiles:\n${files}\n\nUser message:\n${message}` },
  ], 700, agentSettings);

  const parsed = parseJsonObject(llm.content);
  if (!parsed || !Array.isArray(parsed.tools)) return heuristicDecision(message, context.files);

  const validTools = parsed.tools
    .filter((tool: any) => tool?.tool === 'researchSearch' || tool?.tool === 'readDocument' || tool?.tool === 'convertDocument' || tool?.tool === 'createDocument' || tool?.tool === 'listSandboxFiles' || tool?.tool === 'downloadFile' || tool?.tool === 'downloadPaper' || tool?.tool === 'runTerminal')
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
    needsConfirmation: Boolean(parsed.needsConfirmation || validTools.some(tool => tool.tool === 'createDocument' || tool.tool === 'convertDocument' || tool.tool === 'downloadFile' || tool.tool === 'downloadPaper' || tool.tool === 'runTerminal')),
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
PDF: ${source.pdfUrl || ''}
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

function isSideEffectTool(tool: SynapseToolDecision | { tool: string }) {
  return tool.tool === 'createDocument' || tool.tool === 'convertDocument' || tool.tool === 'downloadFile' || tool.tool === 'downloadPaper' || tool.tool === 'runTerminal';
}

async function runResearchTool(decision: SynapseToolDecision, options: SynapseRunOptions, conversationId: string) {
  const selected = normalizeResearchOptions(decision.args.mode, decision.args.depth);
  const query = String(decision.args.query || options.message).trim();
  await emitSynapseEvent(options, {
    type: 'tool_start',
    tool: 'researchSearch',
    title: decision.title || '检索资料',
    status: 'running',
    message: `正在检索：${query}`,
    data: { query, mode: selected.mode, depth: selected.depth },
  });
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
  await emitSynapseEvent(options, {
    type: 'tool_done',
    tool: 'researchSearch',
    title: decision.title || '检索资料',
    status: 'completed',
    message: `检索完成，获得 ${sources.length} 个来源。`,
    data: { query, mode: selected.mode, depth: selected.depth, sourceCount: sources.length },
  });
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
  await emitSynapseEvent(options, {
    type: 'tool_start',
    tool: 'readDocument',
    title: decision.title || '读取文档',
    status: 'running',
    message: '正在读取你的 Synapse 文件库...',
    data: { fileIds: decision.args.fileIds || [] },
  });
  const requestedIds = Array.isArray(decision.args.fileIds)
    ? decision.args.fileIds.map((item: any) => String(item)).filter(Boolean)
    : [];
  const requestedFileIds = requestedIds.filter((item: string) => !item.startsWith('doc:'));
  const requestedDocumentIds = requestedIds
    .filter((item: string) => item.startsWith('doc:'))
    .map((item: string) => item.slice(4));

  let fileQuery = options.supabase
    .from('agent_files')
    .select('*')
    .eq('user_id', options.userId)
    .order('created_at', { ascending: false })
    .limit(30);

  if (requestedFileIds.length) {
    fileQuery = fileQuery.in('id', requestedFileIds);
  } else if (requestedIds.length) {
    fileQuery = fileQuery.limit(0);
  }

  let documentQuery = options.supabase
    .from('agent_documents')
    .select('*')
    .eq('user_id', options.userId)
    .order('updated_at', { ascending: false })
    .limit(20);

  if (requestedDocumentIds.length) {
    documentQuery = documentQuery.in('id', requestedDocumentIds);
  } else if (requestedIds.length) {
    documentQuery = documentQuery.limit(0);
  }

  const [{ data: files, error: fileError }, { data: documents, error: documentError }] = await Promise.all([
    fileQuery,
    documentQuery,
  ]);
  if (fileError) throw fileError;
  if (documentError) throw documentError;
  const workspaceFiles = [...(files || []), ...(documents || []).map(documentAsWorkspaceFile)];
  const readable = workspaceFiles.filter((file: any) => String(file.content_text || '').trim());
  const summary = readable.length
    ? `已读取 ${readable.length} 个文件库文档。`
    : '没有在文件库中找到可读取文本的文档。PDF 需要先完成 MinerU 转换，ZIP 结果本身不可直接作为文本读取。';
  await insertToolTrace(options.supabase, options.userId, conversationId, 'readDocument', { fileIds: decision.args.fileIds || [], query: decision.args.query || options.message }, { files: readable.map((file: any) => ({ id: file.id, file_name: file.file_name, chars: file.content_text?.length || 0 })) }, summary);
  await emitSynapseEvent(options, {
    type: 'tool_done',
    tool: 'readDocument',
    title: decision.title || '读取文档',
    status: readable.length ? 'completed' : 'failed',
    message: readable.length ? `已读取 ${readable.length} 个文件。` : '没有找到可读取文本的文件。',
    data: { fileCount: readable.length },
  });
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

async function createMineruTaskForSynapse(fileUrl: string, mineruToken: string) {
  const res = await fetch('https://mineru.net/api/v4/extract/task', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mineruToken}`,
    },
    body: JSON.stringify({
      url: fileUrl,
      model_version: 'vlm',
      enable_formula: true,
      enable_table: true,
      language: 'ch',
      extra_formats: ['docx', 'html'],
    }),
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok || data?.code !== 0) {
    throw new Error(data?.msg || text || `MinerU task failed (${res.status})`);
  }
  const taskId = data?.data?.task_id || data?.task_id;
  if (!taskId) throw new Error('MinerU did not return task_id');
  return taskId;
}

async function findConvertiblePdfFile(decision: SynapseToolDecision, options: SynapseRunOptions) {
  const explicitIds = [
    decision.args.fileId,
    decision.args.id,
    ...(Array.isArray(decision.args.fileIds) ? decision.args.fileIds : []),
  ].map((item: any) => String(item || '').trim()).filter(Boolean);

  let query = options.supabase
    .from('agent_files')
    .select('*')
    .eq('user_id', options.userId)
    .order('created_at', { ascending: false })
    .limit(explicitIds.length ? 20 : 60);

  if (explicitIds.length) query = query.in('id', explicitIds);

  const { data, error } = await query;
  if (error) throw error;
  const files = data || [];
  const pdfs = files.filter((file: any) => {
    const type = String(file.file_type || '').toLowerCase();
    const name = String(file.file_name || '').toLowerCase();
    return type === 'pdf' || name.endsWith('.pdf');
  });
  if (!pdfs.length) return null;

  const request = [
    decision.args.fileName,
    decision.args.title,
    decision.args.query,
    options.message,
  ].map(item => String(item || '').toLowerCase()).join('\n');
  const byName = pdfs.find((file: any) => {
    const name = String(file.file_name || '').toLowerCase();
    const base = name.replace(/\.pdf$/i, '');
    return request.includes(name) || (base.length > 4 && request.includes(base));
  });
  return byName || pdfs[0];
}

async function runConvertDocumentTool(decision: SynapseToolDecision, options: SynapseRunOptions, conversationId: string) {
  await emitSynapseEvent(options, {
    type: 'tool_start',
    tool: 'convertDocument',
    title: decision.title || '转换 PDF 为 Markdown',
    status: 'running',
    message: '正在查找 PDF 并提交 MinerU 转换任务...',
    data: { fileId: decision.args.fileId || '', query: decision.args.query || options.message },
  });

  const file = await findConvertiblePdfFile(decision, options);
  if (!file) {
    throw new Error('没有在文件库中找到可转换的 PDF。请先上传或下载 PDF。');
  }

  const existingStatus = String(file.metadata?.conversionStatus || '');
  if (existingStatus === 'processing' && file.metadata?.conversionTaskId) {
    const summary = `MinerU 转换任务已在后台运行：${file.metadata.conversionTaskId}`;
    await emitSynapseEvent(options, {
      type: 'tool_done',
      tool: 'convertDocument',
      title: decision.title || '转换 PDF 为 Markdown',
      status: 'running',
      message: summary,
      data: { fileId: file.id, taskId: file.metadata.conversionTaskId },
    });
    return {
      call: {
        id: id('tool'),
        tool: 'convertDocument',
        title: decision.title || '转换 PDF 为 Markdown',
        status: 'running',
        args: { fileId: file.id, fileName: file.file_name },
        result: summary,
      } as AgentToolCallLog,
      file,
    };
  }

  if (existingStatus === 'completed') {
    const summary = file.metadata?.convertedMarkdownFileId
      ? `该 PDF 已完成 MinerU 转换，Markdown 文件已在文件库中：${file.metadata.convertedMarkdownFileId}`
      : `该 PDF 已完成 MinerU 转换，ZIP 文件已在文件库中：${file.metadata?.convertedZipFileId || 'converted zip'}`;
    await insertToolTrace(options.supabase, options.userId, conversationId, 'convertDocument', { fileId: file.id, fileName: file.file_name }, { file }, summary);
    await emitSynapseEvent(options, {
      type: 'tool_done',
      tool: 'convertDocument',
      title: decision.title || '转换 PDF 为 Markdown',
      status: 'completed',
      message: summary,
      data: { fileId: file.id },
    });
    return {
      call: {
        id: id('tool'),
        tool: 'convertDocument',
        title: decision.title || '转换 PDF 为 Markdown',
        status: 'completed',
        args: { fileId: file.id, fileName: file.file_name },
        result: summary,
      } as AgentToolCallLog,
      file,
    };
  }

  if (!file.file_url) {
    throw new Error('该 PDF 没有可访问 URL，无法提交 MinerU 转换。请重新上传，或检查 Supabase Storage/public URL 配置。');
  }

  const { token: mineruToken } = await getUserMineruConfigByUserId(options.userId);
  if (!mineruToken) {
    throw new Error('MinerU API Token 未配置，请先在设置或后台 API 管理中填写。');
  }

  const taskId = await createMineruTaskForSynapse(file.file_url, mineruToken);
  const runningMetadata = sanitizeForPostgres({
    ...(file.metadata || {}),
    conversionStatus: 'processing',
    conversionTaskId: taskId,
    conversionStartedAt: new Date().toISOString(),
    conversionRequestedBy: 'synapse',
    conversionError: '',
  });
  const { data: updatedSource, error: updateError } = await options.supabase
    .from('agent_files')
    .update({ metadata: runningMetadata })
    .eq('id', file.id)
    .eq('user_id', options.userId)
    .select()
    .single();
  if (updateError) throw updateError;

  try {
    await recordAgentFileArtifact(options.supabase, updatedSource || { ...file, metadata: runningMetadata }, {
      sourceTool: 'convertDocument',
      status: 'processing',
      metadata: { conversionTaskId: taskId },
    });
  } catch (artifactError) {
    console.warn('Synapse artifact write failed after conversion submit:', artifactError);
  }

  await options.supabase.from('agent_tool_traces').insert({
    user_id: options.userId,
    conversation_id: conversationId,
    tool_name: 'convertDocument',
    status: 'running',
    input: sanitizeForPostgres({ fileId: file.id, fileName: file.file_name, query: decision.args.query || options.message }),
    output: sanitizeForPostgres({ taskId }),
    summary: sanitizeTextForPostgres(`MinerU 转换任务已提交：${taskId}`),
  });

  const summary = `已提交 MinerU 转换任务：${taskId}。转换会在后台继续，完成后 Markdown/ZIP 会出现在右侧文件库。`;
  await emitSynapseEvent(options, {
    type: 'tool_done',
    tool: 'convertDocument',
    title: decision.title || '转换 PDF 为 Markdown',
    status: 'completed',
    message: summary,
    data: { fileId: file.id, taskId },
  });

  return {
    call: {
      id: id('tool'),
      tool: 'convertDocument',
      title: decision.title || '转换 PDF 为 Markdown',
      status: 'completed',
      args: { fileId: file.id, fileName: file.file_name },
      result: summary,
    } as AgentToolCallLog,
    file: updatedSource || { ...file, metadata: runningMetadata },
  };
}

async function runListSandboxFilesTool(decision: SynapseToolDecision, options: SynapseRunOptions, conversationId: string) {
  await emitSynapseEvent(options, {
    type: 'tool_start',
    tool: 'listSandboxFiles',
    title: decision.title || '列出沙箱文件',
    status: 'running',
    message: '正在列出服务器沙箱文件...',
  });
  const maxFiles = Math.min(Number(decision.args.maxFiles || 80), 200);
  const files = await listWorkspaceFiles(options.userId, maxFiles);
  const summary = files.length
    ? `沙箱中找到 ${files.length} 个文件。\n${files.slice(0, 30).map(file => `- ${file.relativePath} (${file.bytes} bytes)`).join('\n')}`
    : '沙箱中暂时没有文件。';
  await insertToolTrace(options.supabase, options.userId, conversationId, 'listSandboxFiles', { maxFiles }, { files: files.slice(0, maxFiles) }, summary);
  await emitSynapseEvent(options, {
    type: 'tool_done',
    tool: 'listSandboxFiles',
    title: decision.title || '列出沙箱文件',
    status: 'completed',
    message: `已列出 ${files.length} 个文件。`,
    data: { fileCount: files.length },
  });
  return {
    call: {
      id: id('tool'),
      tool: 'listSandboxFiles',
      title: decision.title || '列出沙箱文件',
      status: 'completed',
      args: { maxFiles },
      result: summary,
    } as AgentToolCallLog,
    files,
  };
}

function normalizeArxivPdfUrl(value: string) {
  const url = String(value || '').trim();
  if (!url) return '';
  if (/arxiv\.org\/pdf\//i.test(url)) return url.endsWith('.pdf') ? url : `${url}.pdf`;
  if (/arxiv\.org\/abs\//i.test(url)) return url.replace('/abs/', '/pdf/') + '.pdf';
  const idMatch = url.match(/(?:arxiv:)?(\d{4}\.\d{4,5}(?:v\d+)?)/i);
  if (idMatch) return `https://arxiv.org/pdf/${idMatch[1]}.pdf`;
  return '';
}

function safePaperFileName(title: string) {
  return `${sanitizeTextForPostgres(title || 'paper', 120)
    .replace(/[\\/:*?"<>|#%&{}$!'@+=`\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 120) || 'paper'}.pdf`;
}

function paperIdFromSource(source: ResearchSource) {
  return source.externalIds?.semanticScholarPaperId
    || source.id.replace(/^semantic_scholar_recommendation-/, '').replace(/^semantic_scholar-/, '');
}

async function resolveSemanticScholarPdf(source: ResearchSource, apiKey?: string) {
  const paperId = paperIdFromSource(source);
  if (!paperId || !source.sourceProvider?.startsWith('semantic_scholar')) return '';
  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers['x-api-key'] = apiKey;
    const res = await fetch(`https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(paperId)}?fields=openAccessPdf,title,url,externalIds`, { headers });
    if (!res.ok) return '';
    const data = await res.json();
    return data?.openAccessPdf?.url || '';
  } catch {
    return '';
  }
}

async function resolveOpenAlexPdf(source: ResearchSource) {
  const doi = source.doi || source.externalIds?.doi || '';
  const openAlex = source.externalIds?.openAlex || '';
  const target = openAlex || (doi ? `https://doi.org/${doi.replace(/^https?:\/\/doi\.org\//i, '')}` : '');
  if (!target) return '';
  try {
    const res = await fetch(`https://api.openalex.org/works/${encodeURIComponent(target)}?select=primary_location,best_oa_location,open_access`);
    if (!res.ok) return '';
    const data = await res.json();
    return data?.primary_location?.pdf_url || data?.best_oa_location?.pdf_url || data?.open_access?.oa_url || '';
  } catch {
    return '';
  }
}

async function resolvePaperPdfUrl(source: ResearchSource, options: SynapseRunOptions) {
  const direct = source.pdfUrl || (/\.pdf(?:$|\?)/i.test(source.url || '') ? source.url : '');
  if (direct) return direct;
  const arxiv = normalizeArxivPdfUrl(source.externalIds?.arxiv || source.url || '');
  if (arxiv) return arxiv;
  const semantic = await resolveSemanticScholarPdf(source, options.toolConfig?.semanticScholarApiKey);
  if (semantic) return semantic;
  const openAlex = await resolveOpenAlexPdf(source);
  if (openAlex) return openAlex;
  return '';
}

function sourceMatchesDownloadRequest(source: ResearchSource, decision: SynapseToolDecision, index: number) {
  const sourceId = String(decision.args.sourceId || '').trim();
  if (sourceId && source.id === sourceId) return 1000 - index;
  const rank = Number(decision.args.rank || 0);
  if (rank > 0 && index === rank - 1) return 900 - index;
  const needle = String(decision.args.title || decision.args.query || '').toLowerCase();
  if (!needle) return 100 - index;
  const title = String(source.title || '').toLowerCase();
  const terms = needle.match(/[\p{L}\p{N}_-]{3,}/gu) || [];
  const hits = terms.filter(term => title.includes(term)).length;
  return hits * 20 + (source.pdfUrl ? 10 : 0) + Math.max(0, 20 - index);
}

async function runDownloadPaperTool(decision: SynapseToolDecision, options: SynapseRunOptions, conversationId: string) {
  await emitSynapseEvent(options, {
    type: 'tool_start',
    tool: 'downloadPaper',
    title: decision.title || '下载论文 PDF',
    status: 'running',
    message: '正在从最近的论文检索结果中解析 PDF 链接...',
    data: { title: decision.args.title || '', sourceId: decision.args.sourceId || '', rank: decision.args.rank || 1 },
  });

  const recentSources = await loadRecentResearchSources(options.supabase, options.userId, conversationId);
  const paperSources = recentSources
    .filter(source => source.type === 'paper')
    .map((source, index) => ({ source, score: sourceMatchesDownloadRequest(source, decision, index) }))
    .sort((a, b) => b.score - a.score)
    .map(item => item.source);

  if (!paperSources.length) {
    throw new Error('No recent paper sources found. Run an academic search first, then confirm paper download.');
  }

  let selected: ResearchSource | null = null;
  let pdfUrl = '';
  for (const source of paperSources.slice(0, 8)) {
    const resolved = await resolvePaperPdfUrl(source, options);
    if (resolved) {
      selected = source;
      pdfUrl = resolved;
      break;
    }
  }
  if (!selected || !pdfUrl) {
    throw new Error('Could not resolve an open PDF URL from recent paper sources. The paper may not be open access.');
  }

  const fileName = safePaperFileName(String(decision.args.fileName || selected.title || 'paper'));
  const result = await runDownloadFileTool({
    tool: 'downloadFile',
    title: decision.title || '下载论文 PDF',
    reason: decision.reason || 'Resolved an open paper PDF URL from recent search results.',
    args: { url: pdfUrl, fileName },
  }, options, conversationId);

  const summary = [
    `已解析论文：${selected.title}`,
    `PDF：${pdfUrl}`,
    result.call.result || '',
  ].filter(Boolean).join('\n');

  await insertToolTrace(options.supabase, options.userId, conversationId, 'downloadPaper', {
    decision: decision.args,
    selectedSource: compactSource(selected),
  }, {
    pdfUrl,
    file: result.file,
  }, summary);

  await emitSynapseEvent(options, {
    type: 'tool_done',
    tool: 'downloadPaper',
    title: decision.title || '下载论文 PDF',
    status: 'completed',
    message: `论文 PDF 已保存：${fileName}`,
    data: { fileId: result.file.id, pdfUrl, sourceId: selected.id },
  });

  return {
    call: {
      ...result.call,
      id: id('tool'),
      tool: 'downloadPaper',
      title: decision.title || '下载论文 PDF',
      args: { ...decision.args, resolvedUrl: pdfUrl, sourceId: selected.id },
      result: summary,
    } as AgentToolCallLog,
    file: result.file,
  };
}

async function runDownloadFileTool(decision: SynapseToolDecision, options: SynapseRunOptions, conversationId: string) {
  const url = String(decision.args.url || '').trim();
  const fileName = sanitizeTextForPostgres(String(decision.args.fileName || ''), 180);
  if (!url) throw new Error('Missing URL for downloadFile');
  await emitSynapseEvent(options, {
    type: 'tool_start',
    tool: 'downloadFile',
    title: decision.title || '下载文件到沙箱',
    status: 'running',
    message: `正在下载：${url}`,
    data: { url, fileName },
  });

  const placeholderId = id('download').replace(/^download-/, '');
  const downloaded = await downloadUrlToWorkspace(options.userId, placeholderId, url, fileName || undefined);
  const ext = fileExtension(downloaded.fileName).replace('.', '') || 'file';
  const contentText = isTextLikeFile(downloaded.fileName)
    ? sanitizeTextForPostgres(await textPreviewFromWorkspaceFile(downloaded.fileName, downloaded.ref).catch(() => ''))
    : '';

  const { data: file, error } = await options.supabase
    .from('agent_files')
    .insert({
      user_id: options.userId,
      conversation_id: conversationId,
      file_name: sanitizeTextForPostgres(downloaded.fileName, 240),
      file_type: ext,
      file_size: downloaded.ref.bytes,
      storage_path: null,
      file_url: downloaded.url,
      content_text: contentText,
      metadata: sanitizeForPostgres({
        source: 'sandbox_download',
        downloadUrl: downloaded.url,
        workspace: {
          originalFile: downloaded.ref,
          storedOnServer: true,
        },
      }),
    })
    .select()
    .single();
  if (error) throw error;

  let extraction: any = null;
  let artifactFile: any = file;
  if (isSupportedArchive(downloaded.fileName)) {
    try {
      extraction = await extractWorkspaceZipForFile(options.userId, file.id, downloaded.ref, 'downloaded');
      const metadata = sanitizeForPostgres({
        ...(file.metadata || {}),
        workspace: {
          ...(file.metadata?.workspace || {}),
          archive: {
            extractionStatus: 'completed',
            extractedDir: extraction.extractRelativeDir,
            extractedFiles: (extraction.files || []).slice(0, 200).map((item: any) => ({
              relativePath: item.relativePath,
              originalName: item.originalName,
              bytes: item.bytes,
            })),
          },
        },
      });
      await options.supabase
        .from('agent_files')
        .update({
          metadata,
          content_text: sanitizeTextForPostgres(extraction.markdown || contentText || ''),
        })
        .eq('id', file.id)
        .eq('user_id', options.userId);
      artifactFile = {
        ...file,
        metadata,
        content_text: sanitizeTextForPostgres(extraction.markdown || contentText || ''),
      };
    } catch {
      // Keep the downloaded file even if archive extraction fails.
    }
  }

  const summary = `已下载到沙箱：${downloaded.ref.relativePath}${extraction ? `，并解压 ${extraction.files.length} 个文件。` : ''}`;
  try {
    const fileArtifact = await recordAgentFileArtifact(options.supabase, artifactFile, {
      sourceTool: 'downloadFile',
      metadata: { downloadUrl: downloaded.url },
    });
    if (extraction) {
      await recordExtractedDirArtifact(options.supabase, artifactFile, extraction, {
        parentArtifactId: fileArtifact?.id || null,
        sourceTool: 'extractArchive',
      });
    }
  } catch (artifactError) {
    console.warn('Synapse artifact write failed after download:', artifactError);
  }

  await insertToolTrace(options.supabase, options.userId, conversationId, 'downloadFile', { url, fileName }, { file, workspace: downloaded.ref, extraction }, summary);
  await emitSynapseEvent(options, {
    type: 'tool_done',
    tool: 'downloadFile',
    title: decision.title || '下载文件到沙箱',
    status: 'completed',
    message: summary,
    data: { fileId: file.id, relativePath: downloaded.ref.relativePath },
  });
  return {
    call: {
      id: id('tool'),
      tool: 'downloadFile',
      title: decision.title || '下载文件到沙箱',
      status: 'completed',
      args: { url, fileName },
      result: summary,
    } as AgentToolCallLog,
    file,
  };
}

async function runTerminalTool(decision: SynapseToolDecision, options: SynapseRunOptions, conversationId: string) {
  const command = String(decision.args.command || '').trim();
  const cwd = String(decision.args.cwd || '.').trim() || '.';
  if (!command) throw new Error('Missing terminal command');
  await emitSynapseEvent(options, {
    type: 'tool_start',
    tool: 'runTerminal',
    title: decision.title || '运行沙箱终端',
    status: 'running',
    message: `正在沙箱中运行：${command}`,
    data: { command, cwd },
  });
  const result = await runWorkspaceCommand(options.userId, command, cwd);
  const summary = [
    `命令：${result.command}`,
    `工作目录：${result.cwd}`,
    `退出码：${result.exitCode}${result.timedOut ? '（超时终止）' : ''}`,
    result.stdout ? `stdout:\n${result.stdout}` : '',
    result.stderr ? `stderr:\n${result.stderr}` : '',
  ].filter(Boolean).join('\n');
  void summary;
  const sandboxSummary = [
    `命令：${result.command}`,
    `运行环境：${result.runtime}${result.containerName ? ` (${result.containerName})` : ''}`,
    `工作目录：${result.cwd}`,
    `退出码：${result.exitCode}${result.timedOut ? '（超时终止）' : ''}`,
    result.stdout ? `stdout:\n${result.stdout}` : '',
    result.stderr ? `stderr:\n${result.stderr}` : '',
  ].filter(Boolean).join('\n');
  await insertToolTrace(options.supabase, options.userId, conversationId, 'runTerminal', { command, cwd }, result as any, sandboxSummary);
  await emitSynapseEvent(options, {
    type: 'tool_done',
    tool: 'runTerminal',
    title: decision.title || '运行沙箱终端',
    status: result.exitCode === 0 ? 'completed' : 'failed',
    message: `命令结束，退出码 ${result.exitCode}${result.timedOut ? '，已超时终止' : ''}。`,
    data: { exitCode: result.exitCode, timedOut: result.timedOut, runtime: result.runtime, containerName: result.containerName },
  });
  return {
    call: {
      id: id('tool'),
      tool: 'runTerminal',
      title: decision.title || '运行沙箱终端',
      status: result.exitCode === 0 ? 'completed' : 'failed',
      args: { command, cwd },
      result: sandboxSummary,
    } as AgentToolCallLog,
  };
}

async function generateAnswer(
  options: SynapseRunOptions,
  conversation: any,
  context: SynapseConversationContext,
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
  const pendingSideEffects = decision.tools.filter(isSideEffectTool);

  if (pendingSideEffects.length) {
    const preface = toolCalls.length
      ? `我已经完成了无需确认的前置步骤，例如检索或读取上下文；但下面这些会改变工作区的操作还没有执行。`
      : `我已经准备好下一步，但下面这些会改变工作区的操作还没有执行。`;
    const actionLines = pendingSideEffects
      .map((tool, index) => `${index + 1}. ${tool.title || tool.tool}: ${tool.reason || '需要你确认后再执行。'}`)
      .join('\n');
    return {
      content: `${preface}\n\n请确认后我再执行：\n${actionLines}`,
      reasoning: '',
      model: preferredModel(options.llmConfig, options.agentSettings?.model),
      usedThinking: false,
    };
  }

  const system = `You are Synapse, the main conversational research agent for Synap.
Answer in the user's language. Be direct, useful, and grounded in the provided context.
You have a persistent per-user Synapse server workspace. Uploaded files, downloaded artifacts, extracted ZIP contents, converted Markdown, generated documents, and sandbox command outputs can persist across conversations.
You do not have arbitrary host access. Confirmed terminal commands run through a restricted Docker sandbox mounted at /workspace.
If the user asks about your workspace or capabilities, explain this accurately instead of saying you have no persistent folder.
If research sources are available, synthesize them into an actual answer and cite them as [S1], [S2].
If uploaded files are used, cite them as [F1], [F2].
Use structured long-term memories only as user/task context. They are not external factual citations.
If tools were called, briefly mention the tool result only after answering the user; do not stop at "I searched".
If evidence is thin or sources are noisy, say so plainly and suggest the next best action.
If a side-effect action is pending, do not claim it has been completed; explain that it needs user confirmation.
Before writing, assess task completion: fully achieved / partially achieved / failed. If partial or failed, name what is missing and give the single most useful next step instead of hiding gaps.
If tools were called, end with a compact execution summary (in the user's language): which tools ran, how many sources/files were used, and the completion status. Skip this summary when no tools were called.

${SYNAPSE_AGENT_OPERATING_GUIDE}`;

  const prompt = `Conversation:
${history || 'None'}

Durable memory:
${context.memorySummary || 'None'}

Structured long-term memory:
${context.memoryContext?.contextText || 'None'}

User message:
${options.message}

Tool calls:
${toolCalls.map(call => `- ${call.title}: ${call.result || call.error || ''}`).join('\n') || 'No tools called.'}

Retrieved sources:
${sourceBlock || 'None'}

Uploaded file excerpts:
${fileBlock || 'None'}

Pending side-effect:
None

Write the final assistant response now.`;

  const llm = await callSynapseLLMStreaming(options.llmConfig, [
    { role: 'system', content: system },
    { role: 'user', content: prompt },
  ], decision.responseStyle === 'detailed' ? 2200 : decision.responseStyle === 'concise' ? 800 : 1400, options.agentSettings, async (token, meta) => {
    await emitSynapseEvent(options, {
      type: 'token',
      tool: 'synapse',
      title: meta.kind === 'reasoning' ? 'Synapse thinking' : 'Synapse answer',
      message: token,
      data: { token, kind: meta.kind },
    });
  });

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
  const sideEffectTools = decision.tools.filter(isSideEffectTool);
  if (!sideEffectTools.length) return null;
  return {
    id: id('plan'),
    title: sideEffectTools.length === 1 ? sideEffectTools[0].title : '确认沙箱操作',
    summary: '这些操作会修改服务器沙箱、运行命令或创建文档，需要你确认后再执行。',
    steps: sideEffectTools.map(tool => ({
      id: id('step'),
      tool: tool.tool,
      title: tool.title || (
        tool.tool === 'createDocument' ? '创建 Markdown 文档' :
        tool.tool === 'convertDocument' ? '转换 PDF 为 Markdown' :
        tool.tool === 'downloadFile' ? '下载文件到沙箱' :
        tool.tool === 'downloadPaper' ? '下载论文 PDF' :
        '运行沙箱终端命令'
      ),
      description: tool.reason || '该操作会改变服务器工作区状态。',
      args: tool.tool === 'createDocument'
        ? {
            title: tool.args.title || titleFromMessage(message),
            documentType: tool.args.documentType || 'synapse_document',
          }
        : tool.args,
    })),
    requiresConfirmation: true,
    createdAt: new Date().toISOString(),
  };
}

export async function runSynapseTurn(options: SynapseRunOptions) {
  const conversation = await ensureConversation(options.supabase, options.userId, options.conversationId, options.message);
  const beforeContext = await loadConversationContext(options.supabase, options.userId, conversation.id);
  beforeContext.memorySummary = await maybeCompressMemory(options, conversation, beforeContext);
  beforeContext.memoryContext = await retrieveSynapseMemoryContext(options, conversation, beforeContext);
  await insertMessage(options.supabase, options.userId, conversation.id, 'user', options.message);

  const decision = await decideTools(options.message, beforeContext, options.llmConfig, options.agentSettings);
  const executableTools = decision.tools.filter(tool => !isSideEffectTool(tool));
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
      if (tool.tool === 'listSandboxFiles') {
        const result = await runListSandboxFilesTool(tool, options, conversation.id);
        toolCalls.push(result.call);
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
  const memoryWrite = await writeSynapseTurnMemories(options, conversation.id, options.message, answer.content);
  const assistant = await insertMessage(options.supabase, options.userId, conversation.id, 'assistant', answer.content, {
    agent: 'synapse',
    decision,
    toolCalls,
    sources: allSources.slice(0, 12).map(compactSource),
    readFiles: readFiles.map(file => ({ id: file.id, file_name: file.file_name })),
    usedMemories: (beforeContext.memoryContext?.memories || []).map(compactMemory),
    memoryWrite: {
      written: memoryWrite.written.map(compactMemory),
      skipped: memoryWrite.skipped,
    },
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
    usedMemories: beforeContext.memoryContext?.memories || [],
    writtenMemories: memoryWrite.written,
    memoryWriteSkipped: memoryWrite.skipped,
    reasoning: answer.reasoning,
    model: answer.model,
    usedThinking: answer.usedThinking,
  };
}

type MultiStepSubGoal = {
  id: string;
  title: string;
  description: string;
  tools: SynapseToolDecision[];
  critical: boolean;
};

type MultiStepPlan = {
  id: string;
  title: string;
  summary: string;
  subGoals: MultiStepSubGoal[];
  createdAt: string;
};

type SynapseGraphTask = {
  currentStep: number;
  totalSteps: number;
  status: 'planning' | 'executing' | 'completed' | 'failed' | 'needs_confirmation';
  observation: string;
  executed: Array<{ stepId: string; toolCalls: AgentToolCallLog[]; ok: boolean }>;
  replans: number;
};

type SynapseEval = {
  done: boolean;
  replan: boolean;
  reason: string;
};

const MAX_ITERATIONS = 6;
const MAX_REPLANS = 2;

const SynapseGraphState = Annotation.Root({
  options: Annotation<SynapseRunOptions>,
  conversation: Annotation<any>,
  beforeContext: Annotation<SynapseConversationContext>,
  decision: Annotation<SynapseDecision>,
  pendingPlan: Annotation<AgentPlan | null>,
  toolCalls: Annotation<AgentToolCallLog[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  sources: Annotation<ResearchSource[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  readFiles: Annotation<any[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  plan: Annotation<MultiStepPlan | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  task: Annotation<SynapseGraphTask | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  eval: Annotation<SynapseEval | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  iteration: Annotation<number>({
    reducer: (_left, right) => right,
    default: () => 0,
  }),
  accumulatedSources: Annotation<ResearchSource[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  accumulatedFiles: Annotation<any[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  answer: Annotation<{ content: string; reasoning: string; model: string; usedThinking: boolean }>,
  memoryWrite: Annotation<{ written: any[]; skipped?: string }>({
    reducer: (_left, right) => right,
    default: () => ({ written: [], skipped: '' }),
  }),
  assistant: Annotation<any>,
  messages: Annotation<any[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  graphTrace: Annotation<SynapseGraphTraceEvent[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  response: Annotation<any>,
});

function graphTraceEvent(node: string, startedAtMs: number, summary?: string): SynapseGraphTraceEvent {
  return {
    node,
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAtMs,
    summary,
  };
}

async function emitSynapseEvent(
  options: Pick<SynapseRunOptions, 'onEvent' | 'supabase' | 'userId' | 'runId' | 'conversationId'> | undefined,
  event: SynapseRuntimeEvent
) {
  try {
    await options?.onEvent?.(event);
  } catch (error) {
    console.warn('Synapse runtime event listener failed:', error);
  }
  if (options?.runId && options.supabase && options.userId) {
    try {
      await appendAgentRunEvent(
        options.supabase,
        options.userId,
        options.runId,
        event.type,
        sanitizeForPostgres(event),
        event.data?.conversationId || options.conversationId || null
      );
    } catch (error) {
      console.warn('Synapse run event persistence failed:', error);
    }
  }
}

function shouldPlanMultiStep(decision: SynapseDecision) {
  if (decision.intent !== 'research' && decision.intent !== 'write') return false;
  const tools = decision.tools;
  if (tools.length < 2) return false;
  const firstSideEffect = tools.findIndex(isSideEffectTool);
  if (firstSideEffect <= 0) return false;
  return tools.slice(0, firstSideEffect).some(tool => !isSideEffectTool(tool));
}

function effectiveSources(state: typeof SynapseGraphState.State): ResearchSource[] {
  return state.accumulatedSources.length ? state.accumulatedSources : state.sources;
}

function effectiveFiles(state: typeof SynapseGraphState.State): any[] {
  return state.accumulatedFiles.length ? state.accumulatedFiles : state.readFiles;
}

function graphRouteAfterDecision(state: typeof SynapseGraphState.State) {
  if (shouldPlanMultiStep(state.decision)) return 'plan_tasks';
  return state.decision.tools.some(tool => !isSideEffectTool(tool))
    ? 'execute_tools'
    : 'generate_answer';
}

function synapseControllerCall(state: typeof SynapseGraphState.State): AgentToolCallLog {
  const route = state.graphTrace.map(event => `${event.node} ${event.durationMs}ms`).join(' -> ');
  const executableCount = state.decision.tools.filter(tool => !isSideEffectTool(tool)).length;
  const pendingWrite = state.pendingPlan ? '；有待确认的沙箱/文档操作' : '';

  return {
    id: id('graph'),
    tool: 'synapse',
    title: 'LangGraph 控制器',
    status: 'completed',
    args: {
      intent: state.decision.intent,
      responseStyle: state.decision.responseStyle,
      executableTools: executableCount,
      usedMemories: state.beforeContext.memoryContext?.memories.length || 0,
      writtenMemories: state.memoryWrite?.written?.length || 0,
      route: state.graphTrace.map(event => event.node),
    },
    result: `路由：${route || '未记录'}。意图：${state.decision.intent}；执行工具数：${executableCount}${pendingWrite}。`,
  };
}

async function loadSynapseGraphContext(state: typeof SynapseGraphState.State) {
  const startedAt = Date.now();
  const options = state.options;
  await emitSynapseEvent(options, {
    type: 'node_start',
    node: 'load_context',
    tool: 'synapse',
    title: '加载上下文',
    message: '正在加载会话、历史消息和文件上下文...',
  });
  const conversation = await ensureConversation(options.supabase, options.userId, options.conversationId, options.message);
  if (options.runId) {
    updateAgentRun(options.supabase, options.userId, options.runId, {
      conversationId: conversation.id,
      status: 'running',
    }).catch(error => console.warn('Synapse run conversation update failed:', error));
  }
  await emitSynapseEvent(options, {
    type: 'node_done',
    node: 'ensure_conversation',
    tool: 'synapse',
    title: '会话已建立',
    message: '已创建或恢复当前 Synapse 会话。',
    data: { conversationId: conversation.id },
  });
  const beforeContext = await loadConversationContext(options.supabase, options.userId, conversation.id);
  beforeContext.memorySummary = await maybeCompressMemory(options, conversation, beforeContext);
  await emitSynapseEvent(options, {
    type: 'node_start',
    node: 'load_memory',
    tool: 'synapse',
    title: '检索长期记忆',
    message: '正在检索与你当前问题相关的长期记忆...',
  });
  beforeContext.memoryContext = await retrieveSynapseMemoryContext(options, conversation, beforeContext);
  await emitSynapseEvent(options, {
    type: 'node_done',
    node: 'load_memory',
    tool: 'synapse',
    title: '长期记忆检索完成',
    message: `找到 ${beforeContext.memoryContext.memories.length} 条相关记忆。`,
    data: {
      memoryCount: beforeContext.memoryContext.memories.length,
      memoryError: beforeContext.memoryContext.error || '',
      memories: beforeContext.memoryContext.memories.slice(0, 5).map(compactMemory),
    },
  });
  await insertMessage(options.supabase, options.userId, conversation.id, 'user', options.message);

  await emitSynapseEvent(options, {
    type: 'node_done',
    node: 'load_context',
    tool: 'synapse',
    title: '上下文已加载',
    message: `已加载 ${beforeContext.messages.length} 条历史消息和 ${beforeContext.files.length} 个文件。`,
  });

  return {
    conversation,
    beforeContext,
    graphTrace: [graphTraceEvent('load_context', startedAt, `${beforeContext.messages.length} history messages, ${beforeContext.files.length} files, ${beforeContext.memoryContext?.memories.length || 0} memories`)],
  };
}

async function decideSynapseGraphTools(state: typeof SynapseGraphState.State) {
  const startedAt = Date.now();
  await emitSynapseEvent(state.options, {
    type: 'node_start',
    node: 'decide_tools',
    tool: 'synapse',
    title: '判断意图',
    message: 'Synapse 正在判断是否需要调用检索、文档阅读或文档生成工具...',
  });
  const decision = await decideTools(
    state.options.message,
    state.beforeContext,
    state.options.llmConfig,
    state.options.agentSettings
  );
  await emitSynapseEvent(state.options, {
    type: 'node_done',
    node: 'decide_tools',
    tool: 'synapse',
    title: '意图判断完成',
    message: `意图：${decision.intent}；计划工具数：${decision.tools.length}。`,
    data: { decision },
  });

  return {
    decision,
    pendingPlan: confirmationPlan(state.options.message, decision),
    graphTrace: [graphTraceEvent('decide_tools', startedAt, `${decision.intent}, ${decision.tools.length} planned tools`)],
  };
}

async function executeSynapseGraphTools(state: typeof SynapseGraphState.State) {
  const startedAt = Date.now();
  const executableTools = state.decision.tools.filter(tool => !isSideEffectTool(tool));
  await emitSynapseEvent(state.options, {
    type: 'node_start',
    node: 'execute_tools',
    tool: 'synapse',
    title: '执行工具',
    message: executableTools.length ? `准备执行 ${executableTools.length} 个工具...` : '本轮不需要执行外部工具。',
  });
  const toolCalls: AgentToolCallLog[] = [];
  const allSources: ResearchSource[] = [];
  const readFiles: any[] = [];

  for (const tool of executableTools) {
    try {
      if (tool.tool === 'researchSearch') {
        const result = await runResearchTool(tool, state.options, state.conversation.id);
        toolCalls.push(result.call);
        allSources.push(...result.sources);
      }
      if (tool.tool === 'readDocument') {
        const result = await runReadDocumentTool(tool, state.options, state.conversation.id);
        toolCalls.push(result.call);
        readFiles.push(...result.files);
      }
      if (tool.tool === 'listSandboxFiles') {
        const result = await runListSandboxFilesTool(tool, state.options, state.conversation.id);
        toolCalls.push(result.call);
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

  await emitSynapseEvent(state.options, {
    type: 'node_done',
    node: 'execute_tools',
    tool: 'synapse',
    title: '工具执行完成',
    message: `完成 ${toolCalls.length} 个工具调用，获得 ${allSources.length} 个来源，读取 ${readFiles.length} 个文件。`,
  });

  return {
    toolCalls,
    sources: allSources,
    readFiles,
    graphTrace: [graphTraceEvent('execute_tools', startedAt, `${toolCalls.length} calls, ${allSources.length} sources, ${readFiles.length} files`)],
  };
}

async function planSynapseGraphTasks(state: typeof SynapseGraphState.State) {
  const startedAt = Date.now();
  await emitSynapseEvent(state.options, {
    type: 'node_start',
    node: 'plan_tasks',
    tool: 'synapse',
    title: '规划多步任务',
    message: '正在把复杂任务拆解为有序子目标...',
  });

  // Deterministic decomposition from the already-LLM-generated decision.tools.
  // decideTools already ordered tools with non side-effect steps first; here each
  // executable (non side-effect) tool becomes one sub-goal. Side-effect tools
  // (createDocument / convertDocument / downloadFile / downloadPaper / runTerminal)
  // are intentionally left out of the loop — generate_answer still collects them
  // into a confirmation plan as before.
  const executableTools = state.decision.tools.filter(tool => !isSideEffectTool(tool));
  const subGoals: MultiStepSubGoal[] = executableTools.map(tool => ({
    id: id('goal'),
    title: tool.title || (
      tool.tool === 'researchSearch' ? '检索资料' :
      tool.tool === 'readDocument' ? '读取文档' :
      '检查沙箱文件'
    ),
    description: tool.reason || '',
    tools: [tool],
    critical: tool.tool === 'researchSearch' || tool.tool === 'readDocument',
  }));

  const plan: MultiStepPlan = {
    id: id('plan'),
    title: state.decision.intent === 'write' ? '检索并创建文档' : '多步检索任务',
    summary: subGoals.map((goal, index) => `${index + 1}. ${goal.title}`).join('；'),
    subGoals,
    createdAt: new Date().toISOString(),
  };

  const task: SynapseGraphTask = {
    currentStep: 0,
    totalSteps: subGoals.length,
    status: subGoals.length ? 'executing' : 'completed',
    observation: '',
    executed: [],
    replans: 0,
  };

  await emitSynapseEvent(state.options, {
    type: 'node_done',
    node: 'plan_tasks',
    tool: 'synapse',
    title: '任务规划完成',
    message: `已拆解为 ${subGoals.length} 个子目标。`,
    data: { plan, totalSteps: subGoals.length },
  });

  return {
    plan,
    task,
    iteration: 0,
    graphTrace: [graphTraceEvent('plan_tasks', startedAt, `${subGoals.length} sub-goals`)],
  };
}

async function executeSynapseGraphStep(state: typeof SynapseGraphState.State) {
  const startedAt = Date.now();
  const plan = state.plan;
  const task = state.task;
  if (!plan || !task || task.currentStep >= task.totalSteps) {
    return { graphTrace: [graphTraceEvent('execute_step', startedAt, 'no-op')] };
  }
  const goal = plan.subGoals[task.currentStep];
  await emitSynapseEvent(state.options, {
    type: 'node_start',
    node: 'execute_step',
    tool: 'synapse',
    title: `执行第 ${task.currentStep + 1}/${task.totalSteps} 步`,
    message: `正在执行：${goal.title}...`,
    data: { currentStep: task.currentStep, totalSteps: task.totalSteps, goal },
  });

  const stepCalls: AgentToolCallLog[] = [];
  const stepSources: ResearchSource[] = [];
  const stepFiles: any[] = [];

  for (const tool of goal.tools) {
    try {
      if (tool.tool === 'researchSearch') {
        const result = await runResearchTool(tool, state.options, state.conversation.id);
        stepCalls.push(result.call);
        stepSources.push(...result.sources);
      }
      if (tool.tool === 'readDocument') {
        const result = await runReadDocumentTool(tool, state.options, state.conversation.id);
        stepCalls.push(result.call);
        stepFiles.push(...result.files);
      }
      if (tool.tool === 'listSandboxFiles') {
        const result = await runListSandboxFilesTool(tool, state.options, state.conversation.id);
        stepCalls.push(result.call);
      }
    } catch (error: any) {
      stepCalls.push({
        id: id('tool'),
        tool: tool.tool,
        title: tool.title,
        status: 'failed',
        args: tool.args || {},
        error: error.message || 'Tool failed',
      } as AgentToolCallLog);
    }
  }

  const ok = stepCalls.every(call => call.status !== 'failed') &&
    (goal.tools.some(tool => tool.tool === 'researchSearch') ? stepSources.length > 0 : true);
  const observation = stepCalls
    .map(call => `${call.title}: ${call.status === 'failed' ? (call.error || 'failed') : (call.result || 'ok')}`)
    .join('；');

  await emitSynapseEvent(state.options, {
    type: 'node_done',
    node: 'execute_step',
    tool: 'synapse',
    title: `第 ${task.currentStep + 1}/${task.totalSteps} 步完成`,
    message: observation || '无输出',
    data: { ok, sourceCount: stepSources.length, fileCount: stepFiles.length },
  });

  return {
    toolCalls: [...state.toolCalls, ...stepCalls],
    accumulatedSources: stepSources,
    accumulatedFiles: stepFiles,
    task: {
      ...task,
      observation,
      executed: [...task.executed, { stepId: goal.id, toolCalls: stepCalls, ok }],
    },
    graphTrace: [graphTraceEvent('execute_step', startedAt, `${stepCalls.length} calls, ${stepSources.length} sources`)],
  };
}

function broadenPlanStep(plan: MultiStepPlan, stepIndex: number): MultiStepPlan {
  const subGoals = plan.subGoals.map((goal, index) => {
    if (index !== stepIndex) return goal;
    return {
      ...goal,
      tools: goal.tools.map(tool => tool.tool === 'researchSearch'
        ? { ...tool, title: `${tool.title}（放宽重试）`, args: { ...tool.args, mode: 'both', depth: 'fast' } }
        : tool),
    };
  });
  return { ...plan, subGoals };
}

async function evaluateSynapseGraphProgress(state: typeof SynapseGraphState.State) {
  const startedAt = Date.now();
  const plan = state.plan;
  const task = state.task;
  if (!plan || !task) {
    return {
      eval: { done: true, replan: false, reason: 'no active plan' },
      graphTrace: [graphTraceEvent('evaluate_progress', startedAt, 'no plan')],
    };
  }

  const lastOk = task.executed[task.executed.length - 1]?.ok ?? true;

  let evalResult: SynapseEval;
  let nextTask: SynapseGraphTask = task;
  let nextPlan: MultiStepPlan = plan;

  if (!lastOk) {
    if (task.replans < MAX_REPLANS) {
      nextPlan = broadenPlanStep(plan, task.currentStep);
      nextTask = { ...task, replans: task.replans + 1 };
      evalResult = { done: false, replan: true, reason: '检索结果为空或步骤失败，放宽条件重试。' };
    } else {
      nextTask = { ...task, status: 'failed' };
      evalResult = { done: true, replan: false, reason: '多次重试仍无有效结果，转入回答阶段并说明缺口。' };
    }
  } else if (task.currentStep + 1 < task.totalSteps) {
    nextTask = { ...task, currentStep: task.currentStep + 1 };
    evalResult = { done: false, replan: false, reason: `继续第 ${task.currentStep + 2} 步。` };
  } else {
    nextTask = { ...task, status: 'completed' };
    evalResult = { done: true, replan: false, reason: '全部子目标执行完成。' };
  }

  await emitSynapseEvent(state.options, {
    type: 'node_done',
    node: 'evaluate_progress',
    tool: 'synapse',
    title: '校验进度',
    message: evalResult.reason,
    data: { ...evalResult, currentStep: nextTask.currentStep, totalSteps: nextTask.totalSteps, replans: nextTask.replans },
  });

  return {
    eval: evalResult,
    task: nextTask,
    plan: nextPlan,
    iteration: (state.iteration || 0) + 1,
    graphTrace: [graphTraceEvent('evaluate_progress', startedAt, evalResult.reason)],
  };
}

function routeAfterEvaluate(state: typeof SynapseGraphState.State) {
  if ((state.iteration || 0) >= MAX_ITERATIONS) return 'generate_answer';
  if (!state.eval?.done && (state.task?.currentStep ?? 0) < (state.task?.totalSteps ?? 0)) return 'execute_step';
  return 'generate_answer';
}

async function generateSynapseGraphAnswer(state: typeof SynapseGraphState.State) {
  const startedAt = Date.now();
  await emitSynapseEvent(state.options, {
    type: 'node_start',
    node: 'generate_answer',
    tool: 'synapse',
    title: '生成回答',
    message: '正在压缩工具结果并生成最终回复...',
  });
  const answer = await generateAnswer(
    state.options,
    state.conversation,
    state.beforeContext,
    state.decision,
    state.toolCalls,
    effectiveSources(state),
    effectiveFiles(state)
  );
  await emitSynapseEvent(state.options, {
    type: 'node_done',
    node: 'generate_answer',
    tool: 'synapse',
    title: '回答生成完成',
    message: `已生成 ${answer.content.length} 个字符的回复。`,
  });

  return {
    answer,
    graphTrace: [graphTraceEvent('generate_answer', startedAt, `${answer.content.length} chars`)],
  };
}

async function persistSynapseGraphTurn(state: typeof SynapseGraphState.State) {
  const startedAt = Date.now();
  await emitSynapseEvent(state.options, {
    type: 'node_start',
    node: 'persist_turn',
    tool: 'synapse',
    title: '保存对话',
    message: '正在保存回答、工具轨迹和图执行记录...',
  });
  const controllerCall = synapseControllerCall(state);
  const responseToolCalls = [controllerCall, ...state.toolCalls];
  await emitSynapseEvent(state.options, {
    type: 'node_start',
    node: 'write_memory',
    tool: 'synapse',
    title: '提取候选记忆',
    message: '正在判断本轮对话是否有值得保存的长期记忆...',
  });
  const memoryWrite = await writeSynapseTurnMemories(
    state.options,
    state.conversation.id,
    state.options.message,
    state.answer.content
  );
  await emitSynapseEvent(state.options, {
    type: 'node_done',
    node: 'write_memory',
    tool: 'synapse',
    title: '候选记忆处理完成',
    message: memoryWrite.skipped
      ? `记忆写入已跳过：${memoryWrite.skipped}`
      : `写入/更新 ${memoryWrite.written.length} 条记忆。`,
    data: {
      writtenCount: memoryWrite.written.length,
      skipped: memoryWrite.skipped || '',
      memories: memoryWrite.written.slice(0, 5).map(compactMemory),
    },
  });
  const assistant = await insertMessage(state.options.supabase, state.options.userId, state.conversation.id, 'assistant', state.answer.content, {
    agent: 'synapse',
    runtime: 'langgraph',
    graphVersion: 2,
    graphTrace: state.graphTrace,
    decision: state.decision,
    toolCalls: responseToolCalls,
    sources: effectiveSources(state).slice(0, 12).map(compactSource),
    readFiles: effectiveFiles(state).map(file => ({ id: file.id, file_name: file.file_name })),
    usedMemories: (state.beforeContext.memoryContext?.memories || []).map(compactMemory),
    memoryWrite: {
      written: memoryWrite.written.map(compactMemory),
      skipped: memoryWrite.skipped,
    },
    reasoning: state.answer.reasoning,
    model: state.answer.model,
    usedThinking: state.answer.usedThinking,
    agentSettings: state.options.agentSettings || {},
    pendingPlan: state.pendingPlan,
    multiStep: state.plan
      ? { plan: sanitizeForPostgres(state.plan), task: sanitizeForPostgres(state.task) }
      : null,
  });

  const refreshed = await loadConversationContext(state.options.supabase, state.options.userId, state.conversation.id);
  const response = {
    conversation: state.conversation,
    assistant,
    messages: refreshed.messages,
    type: state.pendingPlan ? 'plan' : 'result',
    message: state.answer.content,
    plan: state.pendingPlan,
    toolCalls: responseToolCalls,
    sources: effectiveSources(state),
    files: effectiveFiles(state),
    usedMemories: state.beforeContext.memoryContext?.memories || [],
    writtenMemories: memoryWrite.written,
    memoryWriteSkipped: memoryWrite.skipped,
    reasoning: state.answer.reasoning,
    model: state.answer.model,
    usedThinking: state.answer.usedThinking,
    runtime: 'langgraph',
    graphTrace: [...state.graphTrace, graphTraceEvent('persist_turn', startedAt, 'response persisted')],
  };

  await emitSynapseEvent(state.options, {
    type: 'node_done',
    node: 'persist_turn',
    tool: 'synapse',
    title: '保存完成',
    message: '本轮对话已保存。',
  });

  if (state.options.runId) {
    updateAgentRun(state.options.supabase, state.options.userId, state.options.runId, {
      conversationId: state.conversation.id,
      status: 'completed',
      output: {
        conversationId: state.conversation.id,
        messageId: assistant.id,
        type: response.type,
        toolCallCount: responseToolCalls.length,
        sourceCount: state.sources.length,
      },
      finishedAt: new Date().toISOString(),
    }).catch(error => console.warn('Synapse run completion update failed:', error));
  }

  return {
    assistant,
    messages: refreshed.messages,
    memoryWrite,
    graphTrace: [graphTraceEvent('persist_turn', startedAt, 'response persisted')],
    response,
  };
}

const synapseGraph = new StateGraph(SynapseGraphState)
  .addNode('load_context', loadSynapseGraphContext)
  .addNode('decide_tools', decideSynapseGraphTools)
  .addNode('plan_tasks', planSynapseGraphTasks)
  .addNode('execute_tools', executeSynapseGraphTools)
  .addNode('execute_step', executeSynapseGraphStep)
  .addNode('evaluate_progress', evaluateSynapseGraphProgress)
  .addNode('generate_answer', generateSynapseGraphAnswer)
  .addNode('persist_turn', persistSynapseGraphTurn)
  .addEdge(START, 'load_context')
  .addEdge('load_context', 'decide_tools')
  .addConditionalEdges('decide_tools', graphRouteAfterDecision, {
    plan_tasks: 'plan_tasks',
    execute_tools: 'execute_tools',
    generate_answer: 'generate_answer',
  })
  .addEdge('plan_tasks', 'execute_step')
  .addEdge('execute_step', 'evaluate_progress')
  .addConditionalEdges('evaluate_progress', routeAfterEvaluate, {
    execute_step: 'execute_step',
    generate_answer: 'generate_answer',
  })
  .addEdge('execute_tools', 'generate_answer')
  .addEdge('generate_answer', 'persist_turn')
  .addEdge('persist_turn', END)
  .compile();

export async function runSynapseLangGraphTurn(options: SynapseRunOptions) {
  const result = await synapseGraph.invoke(
    { options },
    {
      configurable: {
        thread_id: options.conversationId || `synapse-${options.userId}-${Date.now()}`,
      },
      tags: ['synapse', 'langgraph'],
      metadata: {
        userId: options.userId,
        conversationId: options.conversationId || null,
      },
    }
  );

  return result.response;
}

const SynapseConfirmedDocumentState = Annotation.Root({
  options: Annotation<SynapseConfirmedDocumentOptions>,
  sources: Annotation<ResearchSource[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  document: Annotation<any>,
  toolCalls: Annotation<AgentToolCallLog[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  answer: Annotation<string>,
  graphTrace: Annotation<SynapseGraphTraceEvent[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  response: Annotation<any>,
});

function confirmedControllerCall(state: typeof SynapseConfirmedDocumentState.State): AgentToolCallLog {
  const route = state.graphTrace.map(event => `${event.node} ${event.durationMs}ms`).join(' -> ');
  return {
    id: id('graph'),
    tool: 'synapse',
    title: 'LangGraph 控制器',
    status: 'completed',
    args: {
      intent: 'write',
      responseStyle: 'normal',
      executableTools: 1,
      route: state.graphTrace.map(event => event.node),
    },
    result: `路由：${route || '未记录'}。确认后的沙箱/文档操作已由 LangGraph 执行。`,
  };
}

async function loadConfirmedDocumentSources(state: typeof SynapseConfirmedDocumentState.State) {
  const startedAt = Date.now();
  await emitSynapseEvent(state.options, {
    type: 'node_start',
    node: 'load_recent_sources',
    tool: 'synapse',
    title: '加载来源',
    message: '正在读取本会话最近检索来源...',
  });
  const sources = await loadRecentResearchSources(
    state.options.supabase,
    state.options.userId,
    state.options.conversationId
  );
  await emitSynapseEvent(state.options, {
    type: 'node_done',
    node: 'load_recent_sources',
    tool: 'synapse',
    title: '来源已加载',
    message: `已加载 ${sources.length} 个最近来源。`,
  });

  return {
    sources,
    graphTrace: [graphTraceEvent('load_recent_sources', startedAt, `${sources.length} recent sources`)],
  };
}

async function executeConfirmedActions(state: typeof SynapseConfirmedDocumentState.State) {
  const startedAt = Date.now();
  await emitSynapseEvent(state.options, {
    type: 'tool_start',
    node: 'execute_confirmed_actions',
    tool: 'synapse',
    title: '执行确认操作',
    status: 'running',
    message: `正在执行 ${state.options.confirmedPlan.steps.length} 个已确认操作...`,
  });

  const toolCalls: AgentToolCallLog[] = [];
  let document: any = null;
  const answerParts: string[] = [];

  for (const step of state.options.confirmedPlan.steps) {
    const decision: SynapseToolDecision = {
      tool: step.tool as SynapseToolDecision['tool'],
      title: step.title,
      reason: step.description,
      args: step.args || {},
    };

    if (step.tool === 'downloadFile') {
      const result = await runDownloadFileTool(decision, state.options, state.options.conversationId);
      toolCalls.push({ ...result.call, id: step.id || result.call.id });
      answerParts.push(result.call.result || '下载完成。');
    } else if (step.tool === 'downloadPaper') {
      const result = await runDownloadPaperTool(decision, state.options, state.options.conversationId);
      toolCalls.push({ ...result.call, id: step.id || result.call.id });
      answerParts.push(result.call.result || '论文 PDF 下载完成。');
    } else if (step.tool === 'runTerminal') {
      const result = await runTerminalTool(decision, state.options, state.options.conversationId);
      toolCalls.push({ ...result.call, id: step.id || result.call.id });
      answerParts.push(result.call.result || '终端命令已执行。');
    } else if (step.tool === 'convertDocument') {
      const result = await runConvertDocumentTool(decision, state.options, state.options.conversationId);
      toolCalls.push({ ...result.call, id: step.id || result.call.id });
      answerParts.push(result.call.result || 'PDF 转换任务已提交。');
    } else if (step.tool === 'createDocument') {
      const effectiveLLMConfig = {
        ...state.options.llmConfig,
        defaultModel: state.options.agentSettings?.model || state.options.llmConfig?.defaultModel,
      };
      const draft = await generateAgentDocument({
        userId: state.options.userId,
        message: state.options.message,
        plan: state.options.confirmedPlan,
        sources: state.sources,
        llmConfig: effectiveLLMConfig,
      });

      const { data, error } = await state.options.supabase
        .from('agent_documents')
        .insert({
          user_id: state.options.userId,
          title: sanitizeTextForPostgres(draft.title, 240),
          content_md: sanitizeTextForPostgres(draft.markdown),
          source: 'synapse',
          metadata: sanitizeForPostgres({
            runtime: draft.runtime,
            agent: 'synapse',
            graphRuntime: 'langgraph',
            conversationId: state.options.conversationId,
            plan: state.options.confirmedPlan,
            sourceCount: state.sources.length,
            warnings: draft.warnings || [],
          }),
        })
        .select()
        .single();
      if (error) throw error;
      document = data;

      try {
        await recordAgentDocumentArtifact(state.options.supabase, document, {
          conversationId: state.options.conversationId,
          runId: state.options.runId || null,
          stepId: step.id || null,
          sourceTool: 'createDocument',
          metadata: {
            stepTitle: step.title,
            sourceCount: state.sources.length,
          },
        });
      } catch (artifactError) {
        console.warn('Synapse artifact write failed after document creation:', artifactError);
      }

      const call: AgentToolCallLog = {
        id: step.id || id('tool'),
        tool: 'createDocument',
        title: step.title || '创建文档',
        status: 'completed',
        args: step.args || {},
        result: [
          `已创建文档：${document.title}`,
          draft.warnings?.length ? `注意：${draft.warnings.join('；')}` : '',
        ].filter(Boolean).join('\n'),
      };
      toolCalls.push(call);
      answerParts.push(`已创建文档《${document.title}》。你可以在右侧“文档”面板预览或下载 Markdown / DOCX。`);
      await state.options.supabase.from('agent_tool_traces').insert({
        user_id: state.options.userId,
        conversation_id: state.options.conversationId,
        tool_name: 'createDocument',
        status: 'completed',
        input: sanitizeForPostgres({ message: state.options.message, plan: state.options.confirmedPlan }),
        output: sanitizeForPostgres({ document, sourceCount: state.sources.length }),
        summary: sanitizeTextForPostgres(call.result || ''),
      });
    }
  }

  await emitSynapseEvent(state.options, {
    type: 'tool_done',
    node: 'execute_confirmed_actions',
    tool: 'synapse',
    title: '确认操作已执行',
    status: 'completed',
    message: `已完成 ${toolCalls.length} 个操作。`,
    data: { toolCount: toolCalls.length, documentId: document?.id },
  });

  return {
    document,
    toolCalls,
    answer: answerParts.join('\n\n') || '已完成确认操作。',
    graphTrace: [graphTraceEvent('execute_confirmed_actions', startedAt, `${toolCalls.length} confirmed actions`)],
  };
}

async function persistConfirmedDocumentTurn(state: typeof SynapseConfirmedDocumentState.State) {
  const startedAt = Date.now();
  await emitSynapseEvent(state.options, {
    type: 'node_start',
    node: 'persist_confirmed_document',
    tool: 'synapse',
    title: '保存文档结果',
    message: '正在保存文档创建记录和工具轨迹...',
  });
  const controllerCall = confirmedControllerCall(state);
  const responseToolCalls = [controllerCall, ...state.toolCalls];

  await Promise.all([
    state.options.supabase.from('agent_messages').insert({
      user_id: state.options.userId,
      conversation_id: state.options.conversationId,
      role: 'assistant',
      content: sanitizeTextForPostgres(state.answer),
      metadata: sanitizeForPostgres({
        agent: 'synapse',
        runtime: 'langgraph',
        graphVersion: 2,
        graphTrace: state.graphTrace,
        toolCalls: responseToolCalls,
        document: state.document,
      }),
    }),
    state.options.supabase
      .from('agent_conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', state.options.conversationId)
      .eq('user_id', state.options.userId),
  ]);
  await emitSynapseEvent(state.options, {
    type: 'node_done',
    node: 'persist_confirmed_document',
    tool: 'synapse',
    title: '文档结果已保存',
    message: '文档创建结果已写入会话。',
  });

  const response = {
    type: 'result',
    conversation: { id: state.options.conversationId },
    message: state.answer,
    plan: state.options.confirmedPlan,
    toolCalls: responseToolCalls,
    sources: state.sources,
    document: state.document,
    runtime: 'langgraph',
    graphTrace: [...state.graphTrace, graphTraceEvent('persist_confirmed_document', startedAt, 'confirmed document response persisted')],
  };

  return {
    graphTrace: [graphTraceEvent('persist_confirmed_document', startedAt, 'confirmed document response persisted')],
    response,
  };
}

const confirmedDocumentGraph = new StateGraph(SynapseConfirmedDocumentState)
  .addNode('load_recent_sources', loadConfirmedDocumentSources)
  .addNode('execute_confirmed_actions', executeConfirmedActions)
  .addNode('persist_confirmed_document', persistConfirmedDocumentTurn)
  .addEdge(START, 'load_recent_sources')
  .addEdge('load_recent_sources', 'execute_confirmed_actions')
  .addEdge('execute_confirmed_actions', 'persist_confirmed_document')
  .addEdge('persist_confirmed_document', END)
  .compile();

export async function runConfirmedDocumentLangGraphTurn(options: SynapseConfirmedDocumentOptions) {
  const result = await confirmedDocumentGraph.invoke(
    { options },
    {
      configurable: {
        thread_id: options.conversationId,
      },
      tags: ['synapse', 'langgraph', 'confirmed-document'],
      metadata: {
        userId: options.userId,
        conversationId: options.conversationId,
      },
    }
  );

  return result.response;
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
