'use client';

import { useEffect, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { renderMarkdown } from '@/lib/render-markdown';
import type { AgentArtifact, AgentConversation, AgentDocument, AgentFile, AgentPlan, AgentStoredMessage, AgentToolCallLog, ResearchSource } from '@/types';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
};

type RightTab = 'tools' | 'sources' | 'files' | 'documents';

type AgentSettings = {
  model: 'deepseek-ai/DeepSeek-V4-Flash';
  thinkingEnabled: boolean;
};

type PendingEmbedAction = {
  file: AgentFile;
  kbName: string;
  indexNow: boolean;
  logs: string[];
};

type UploadPreview = {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  status: 'uploading' | 'ready' | 'failed';
  detail: string;
};

function id() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const FLASH_MODEL = 'deepseek-ai/DeepSeek-V4-Flash';
const LONG_REQUEST_TIMEOUT_MS = 30 * 60 * 1000;

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = LONG_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: init.signal || controller.signal });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error('请求耗时过长，请稍后查看结果或重试。文档解析、深度检索和嵌入任务可能需要更长时间。');
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function hasDownloadableAgentFile(file: AgentFile) {
  const workspace = file.metadata?.workspace || {};
  return Boolean(
    file.file_url ||
    file.storage_path ||
    workspace.originalFile?.relativePath ||
    workspace.markdownFile?.relativePath ||
    workspace.zip?.relativePath ||
    workspace.mineruZip?.markdownFile?.relativePath ||
    workspace.mineruZip?.zip?.relativePath ||
    workspace.archive?.markdownFile?.relativePath
  );
}

function conversionStatusLabel(file: AgentFile) {
  const status = String(file.metadata?.conversionStatus || '');
  if (status === 'processing') return 'MinerU 转换中';
  if (status === 'completed') return file.metadata?.convertedMarkdownFileId ? '已生成 Markdown/ZIP' : '已生成 ZIP';
  if (status === 'failed') return `转换失败：${file.metadata?.conversionError || '请重试'}`;
  return '';
}

function modeLabel(mode: any) {
  if (mode === 'academic') return '学术检索';
  if (mode === 'general') return 'Web 检索';
  if (mode === 'both') return '综合检索';
  return '';
}

function depthLabel(depth: any) {
  if (depth === 'fast') return '快速';
  if (depth === 'medium') return '中等';
  if (depth === 'deep') return '深度';
  return '';
}

function toolLabel(tool: any) {
  if (tool === 'researchSearch') return '检索';
  if (tool === 'readDocument') return '文档阅读';
  if (tool === 'convertDocument') return '文档转换';
  if (tool === 'createDocument') return '文档生成';
  if (tool === 'downloadFile') return '沙箱下载';
  if (tool === 'downloadPaper') return '论文下载';
  if (tool === 'runTerminal') return '沙箱终端';
  if (tool === 'listSandboxFiles') return '沙箱文件';
  if (tool === 'synapse') return '意图判断';
  return String(tool || '工具');
}

function optimisticToolCalls(message: string): AgentToolCallLog[] {
  const lower = message.toLowerCase();
  const wantsConvert = /转换|转成|转为|解析.*pdf|pdf.*解析|pdf.*markdown|mineru|convert|parse pdf|pdf to markdown/i.test(message);
  const calls: AgentToolCallLog[] = [{
    id: id(),
    tool: 'synapse',
    title: 'Synapse 正在判断意图',
    status: 'running',
    args: {},
    result: '正在判断是否需要调用检索、文档阅读、转换或文档生成工具。',
  }];
  if (/检索|搜索|联网|查找|资料|论文|文献|最新|趋势|进展|research|search|paper|web/.test(lower)) {
    calls.push({
      id: id(),
      tool: 'researchSearch',
      title: '准备检索资料',
      status: 'pending',
      args: { query: message },
      result: '等待 Synapse 选择检索模式和深度。',
    });
  }
  if (/文档|文件|附件|上传|pdf|docx|阅读|总结这份|read|file|document/.test(lower) && !wantsConvert) {
    calls.push({
      id: id(),
      tool: 'readDocument',
      title: '准备读取文档',
      status: 'pending',
      args: { query: message },
      result: '如果本会话有可读文件，Synapse 会读取它们作为上下文。',
    });
  }
  if (wantsConvert || /转换|convert|zip|mineru/.test(lower)) {
    calls.push({
      id: id(),
      tool: 'convertDocument',
      title: '准备文档转换',
      status: 'pending',
      args: {},
      result: '文档转换会使用 MinerU，完成后 ZIP 会进入文件库。',
    });
  }
  if (/下载.*https?:\/\/|download\s+https?:\/\//i.test(message)) {
    calls.push({
      id: id(),
      tool: 'downloadFile',
      title: '准备下载到沙箱',
      status: 'pending',
      args: {},
      result: '下载外部链接会写入服务器沙箱，执行前会请求确认。',
    });
  }
  if (/运行命令|执行命令|终端|命令行|shell|terminal|run command|execute command/.test(lower)) {
    calls.push({
      id: id(),
      tool: 'runTerminal',
      title: '准备运行沙箱命令',
      status: 'pending',
      args: {},
      result: '终端命令只会在服务器沙箱工作区中运行，执行前会请求确认。',
    });
  }
  if (/沙箱.*文件|工作区.*文件|列出.*文件|list.*files|ls workspace/.test(lower)) {
    calls.push({
      id: id(),
      tool: 'listSandboxFiles',
      title: '准备列出沙箱文件',
      status: 'pending',
      args: {},
      result: 'Synapse 会列出当前服务器沙箱工作区中的文件。',
    });
  }
  if (/创建|生成|写.*文档|写.*报告|保存|导出|markdown|docx|create|generate|export/.test(lower)) {
    calls.push({
      id: id(),
      tool: 'createDocument',
      title: '准备文档生成',
      status: 'pending',
      args: {},
      result: '文档生成属于副作用动作，执行前会请求确认。',
    });
  }
  return calls;
}

async function readSseResponse(
  response: Response,
  onEvent: (event: string, data: any) => void | Promise<void>
) {
  if (!response.body) throw new Error('服务器没有返回可读取的事件流。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  async function flushEvent(raw: string) {
    const lines = raw.split('\n');
    const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim() || 'message';
    const dataText = lines
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
      .join('\n');
    if (!dataText) return;
    await onEvent(event, JSON.parse(dataText));
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() || '';
    for (const chunk of chunks) {
      if (chunk.trim()) await flushEvent(chunk);
    }
  }
  if (buffer.trim()) await flushEvent(buffer);
}

function streamEventToolCall(event: string, data: any): AgentToolCallLog | null {
  if (!data?.tool) return null;
  if (!['tool_start', 'tool_done', 'tool_error', 'node_start', 'node_done'].includes(event)) return null;
  return {
    id: `${data.tool}-${data.node || data.title || 'event'}`,
    tool: data.tool,
    title: data.title || toolLabel(data.tool),
    status: event === 'tool_error' ? 'failed' : event.endsWith('_done') ? 'completed' : 'running',
    args: data.data || {},
    result: data.message,
    error: event === 'tool_error' ? data.message : undefined,
  };
}

function messagesFromStored(rows: AgentStoredMessage[]): ChatMessage[] {
  return rows
    .filter(row => row.role === 'user' || row.role === 'assistant' || row.role === 'system')
    .map(row => ({
      id: row.id,
      role: row.role as ChatMessage['role'],
      content: row.content,
    }));
}

async function authHeaders(): Promise<Record<string, string>> {
  const supabase = getSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

export default function AgentPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: id(),
      role: 'assistant',
      content: '我是 Synapse，Synap 的主控 Agent。普通问题我会直接回答；需要资料时我会自己调用检索或文档阅读工具；创建/保存文档这类副作用动作会先请你确认。',
    },
  ]);
  const [input, setInput] = useState('');
  const [conversations, setConversations] = useState<AgentConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState('');
  const [pendingPlan, setPendingPlan] = useState<AgentPlan | null>(null);
  const [pendingMessage, setPendingMessage] = useState('');
  const [toolCalls, setToolCalls] = useState<AgentToolCallLog[]>([]);
  const [sources, setSources] = useState<ResearchSource[]>([]);
  const [files, setFiles] = useState<AgentFile[]>([]);
  const [artifacts, setArtifacts] = useState<AgentArtifact[]>([]);
  const [documents, setDocuments] = useState<AgentDocument[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<AgentDocument | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>('tools');
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [agentSettings, setAgentSettings] = useState<AgentSettings>({
    model: FLASH_MODEL,
    thinkingEnabled: true,
  });
  const [pendingEmbed, setPendingEmbed] = useState<PendingEmbedAction | null>(null);
  const [uploadPreviews, setUploadPreviews] = useState<UploadPreview[]>([]);
  const [loading, setLoading] = useState(false);
  const [activityText, setActivityText] = useState('');
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);
  const conversionPollsRef = useRef<Set<string>>(new Set());
  const streamProgressRef = useRef<Set<string>>(new Set());
  const activeStreamConversationRef = useRef('');
  const streamingAssistantIdRef = useRef('');
  const currentRunIdRef = useRef('');
  const lastRunEventSequenceRef = useRef(0);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('synapse-agent-settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        setAgentSettings({
          model: FLASH_MODEL,
          thinkingEnabled: parsed.thinkingEnabled !== false,
        });
      }
    } catch {
      // Local settings are optional.
    }
    loadConversations();
    loadDocuments();
    loadFiles();
    loadArtifacts();
  }, []);

  useEffect(() => {
    window.localStorage.setItem('synapse-agent-settings', JSON.stringify(agentSettings));
  }, [agentSettings]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, pendingPlan, loading]);

  useEffect(() => {
    for (const file of files) {
      const taskId = String(file.metadata?.conversionTaskId || '');
      if (file.metadata?.conversionStatus === 'processing' && taskId && !conversionPollsRef.current.has(file.id)) {
        conversionPollsRef.current.add(file.id);
        const callId = `conversion-${file.id}`;
        setToolCalls(prev => prev.some(call => call.id === callId) ? prev : [{
          id: callId,
          tool: 'convertDocument',
          title: '后台转换文档',
          status: 'running',
          args: { fileId: file.id, fileName: file.file_name },
          result: '正在继续轮询 MinerU 转换结果。',
        }, ...prev]);
        pollConversion(file.id, taskId, callId).finally(() => {
          conversionPollsRef.current.delete(file.id);
        });
      }
    }
  }, [files]);

  const pushMessage = (message: Omit<ChatMessage, 'id'>) => {
    setMessages(prev => [...prev, { id: id(), ...message }]);
  };

  const appendStreamingAssistantToken = (token: string) => {
    if (!token) return;
    setMessages(prev => {
      const existingId = streamingAssistantIdRef.current;
      if (existingId && prev.some(message => message.id === existingId)) {
        return prev.map(message => message.id === existingId
          ? { ...message, content: `${message.content}${token}` }
          : message);
      }
      const nextId = id();
      streamingAssistantIdRef.current = nextId;
      return [...prev, { id: nextId, role: 'assistant', content: token }];
    });
  };

  const loadDocuments = async () => {
    try {
      const headers = await authHeaders();
      if (!headers.Authorization) return;
      const res = await fetch('/api/agent/documents', { headers });
      if (!res.ok) return;
      const data = await res.json();
      setDocuments(data || []);
      if (!selectedDocument && data?.[0]) setSelectedDocument(data[0]);
    } catch {
      // Keep the chat usable if document history fails.
    }
  };

  const loadConversations = async () => {
    try {
      const headers = await authHeaders();
      if (!headers.Authorization) return;
      const res = await fetch('/api/agent/conversations', { headers });
      if (!res.ok) return;
      const data = await res.json();
      setConversations(data || []);
    } catch {
      // Conversation history is helpful, but the chat can still run without it.
    }
  };

  const loadFiles = async () => {
    try {
      const headers = await authHeaders();
      if (!headers.Authorization) return;
      const res = await fetch('/api/agent/files', { headers });
      if (!res.ok) return;
      const data = await res.json();
      setFiles(data || []);
    } catch {
      // File library is useful context, but the chat can still run without it.
    }
  };

  const loadConversation = async (conversationId: string) => {
    try {
      const headers = await authHeaders();
      if (!headers.Authorization) return;
      const res = await fetch(`/api/agent/conversations/${conversationId}`, { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load conversation');
      setSelectedConversationId(conversationId);
      setMessages(messagesFromStored(data.messages || []));
      setFiles(data.files || []);
      loadFiles();
      loadArtifacts();
      const traceToolCalls = (data.traces || []).map((trace: any) => ({
        id: trace.id,
        tool: trace.tool_name,
        title: trace.tool_name,
        status: trace.status || 'completed',
        args: trace.input || {},
        result: trace.summary,
      }));
      setToolCalls(Array.isArray(data.toolCalls) && data.toolCalls.length ? data.toolCalls : traceToolCalls);
      setSources((data.traces || []).flatMap((trace: any) => Array.isArray(trace.output?.sources) ? trace.output.sources : []));
      setPendingPlan(null);
      setPendingMessage('');
    } catch (err: any) {
      setError(err.message || 'Failed to load conversation');
    }
  };

  const newConversation = () => {
    setSelectedConversationId('');
    setPendingPlan(null);
    setPendingMessage('');
    setToolCalls([]);
    setSources([]);
    setActivityText('');
    setMessages([{
      id: id(),
      role: 'assistant',
      content: '新的 Synapse 对话已准备好。你可以直接提问，也可以先上传文档让我阅读。',
    }]);
  };

  const renameConversation = async (conversation: AgentConversation) => {
    const title = window.prompt('重命名会话', conversation.title)?.trim();
    if (!title) return;
    const headers = await authHeaders();
    const res = await fetch(`/api/agent/conversations/${conversation.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ title }),
    });
    if (res.ok) loadConversations();
  };

  const deleteConversation = async (conversation: AgentConversation) => {
    if (!window.confirm(`删除会话「${conversation.title}」？`)) return;
    const headers = await authHeaders();
    const res = await fetch(`/api/agent/conversations/${conversation.id}`, {
      method: 'DELETE',
      headers,
    });
    if (res.ok) {
      if (selectedConversationId === conversation.id) newConversation();
      loadConversations();
    }
  };

  const uploadFile = async (file: File) => {
    const previewId = id();
    setError('');
    setActivityText(`正在上传并解析 ${file.name}...`);
    setUploadPreviews(prev => [{
      id: previewId,
      fileName: file.name,
      fileType: file.name.split('.').pop()?.toUpperCase() || 'FILE',
      fileSize: file.size,
      status: 'uploading',
      detail: '正在上传并解析',
    }, ...prev.slice(0, 4)]);
    setLoading(true);
    try {
      const headers = await authHeaders();
      const form = new FormData();
      form.append('file', file);
      if (selectedConversationId) form.append('conversation_id', selectedConversationId);
      const res = await fetchWithTimeout('/api/agent/files', {
        method: 'POST',
        headers,
        body: form,
      }, LONG_REQUEST_TIMEOUT_MS);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      if (data.conversationId) {
        setSelectedConversationId(data.conversationId);
        await loadConversation(data.conversationId);
      }
      await loadFiles();
      await loadArtifacts();
      await loadConversations();
      if (data.file?.content_text) {
        setPendingEmbed({
          file: data.file,
          kbName: 'Synapse Agent Files',
          indexNow: true,
          logs: ['文件已解析为 Markdown，等待你确认是否写入知识库。'],
        });
      }
      setUploadPreviews(prev => prev.map(item => item.id === previewId
        ? {
            ...item,
            status: 'ready',
            detail: data.file?.content_text ? `${data.file.content_text.length} 字符已解析` : '已加入文件库，PDF 可继续执行 MinerU 转换',
          }
        : item));
      pushMessage({
        role: 'assistant',
        content: data.file?.content_text
          ? `已上传并解析《${data.file.file_name}》。如果你希望后续通过知识库检索这份文档，可以确认下方导入卡片。`
          : `已上传《${data.file?.file_name || file.name}》，但暂时没有解析出文本。PDF 可检查 MinerU 配置后重试。`,
      });
      setRightTab('files');
      setRightOpen(true);
    } catch (err: any) {
      setUploadPreviews(prev => prev.map(item => item.id === previewId
        ? { ...item, status: 'failed', detail: err.message || '上传失败' }
        : item));
      setError(err.message || 'Upload failed');
    } finally {
      setActivityText('');
      setLoading(false);
    }
  };

  const convertFile = async (file: AgentFile) => {
    setError('');
    setActivityText(`正在调用 MinerU 转换 ${file.file_name}...`);
    const callId = id();
    setToolCalls(prev => [{
      id: callId,
      tool: 'convertDocument',
      title: '正在转换文档',
      status: 'running',
      args: { fileId: file.id, fileName: file.file_name },
      result: '正在提交 MinerU 转换任务。提交后会在后台继续处理，你可以继续对话。',
    }, ...prev]);
    try {
      const headers = await authHeaders();
      const res = await fetchWithTimeout(`/api/agent/files/${file.id}/convert`, {
        method: 'POST',
        headers,
      }, 60_000);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '转换失败');
      if (data.file) {
        setFiles(prev => prev.map(item => item.id === data.file.id ? data.file : item));
      }
      setToolCalls(prev => prev.map(call => call.id === callId
        ? { ...call, id: call.id || callId, result: `MinerU 转换任务已提交：${data.taskId || '等待任务号'}。正在后台轮询结果。` }
        : call));
      setRightTab('files');
      setRightOpen(true);
      loadConversations();
      if (data.async && data.taskId) {
        pollConversion(file.id, data.taskId, callId);
      } else if (data.status === 'completed') {
        await loadFiles();
        await loadArtifacts();
      }
    } catch (err: any) {
      setToolCalls(prev => prev.map(call => call.id === callId
        ? { ...call, status: 'failed', error: err.message || '转换失败' }
        : call));
      setError(err.message || '转换失败');
    } finally {
      setActivityText('');
    }
  };

  async function pollConversion(fileId: string, taskId: string, callId: string) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await new Promise(resolve => window.setTimeout(resolve, 5000));
      try {
        const headers = await authHeaders();
        const res = await fetch(`/api/agent/files/${fileId}/convert?task_id=${encodeURIComponent(taskId)}`, { headers });
        const data = await res.json();

        if (data.file) {
          setFiles(prev => prev.map(item => item.id === data.file.id ? data.file : item));
        }

        if (!res.ok || data.status === 'failed') {
          throw new Error(data.error || '转换失败');
        }

        if (data.status === 'completed') {
          setFiles(prev => {
            const next = [...prev];
            if (data.file) {
              const index = next.findIndex(item => item.id === data.file.id);
              if (index >= 0) next[index] = data.file;
              else next.unshift(data.file);
            }
            for (const generated of [data.markdownFile, data.zipFile].filter(Boolean)) {
              if (!next.some(item => item.id === generated.id)) next.unshift(generated);
            }
            return next;
          });
          setToolCalls(prev => prev.map(call => call.id === callId
            ? {
                ...call,
                status: 'completed',
                result: data.markdownFile
                  ? `MinerU 转换完成，Markdown 和 ZIP 已加入文件库：${data.markdownFile.file_name}`
                  : `MinerU 转换完成，ZIP 已加入文件库：${data.zipFile?.file_name || '转换结果'}`,
              }
            : call));
          await loadFiles();
          await loadArtifacts();
          await loadConversations();
          return;
        }

        setToolCalls(prev => prev.map(call => call.id === callId
          ? { ...call, result: `MinerU 正在处理：第 ${attempt + 1} 次检查，状态 ${data.state || data.status || 'processing'}。` }
          : call));
      } catch (err: any) {
        setToolCalls(prev => prev.map(call => call.id === callId
          ? { ...call, status: 'failed', error: err.message || '转换失败' }
          : call));
        setError(err.message || '转换失败');
        return;
      }
    }

    setToolCalls(prev => prev.map(call => call.id === callId
      ? { ...call, status: 'failed', error: '转换仍在后台处理中，请稍后在文件库刷新查看。' }
      : call));
  }

  const confirmEmbedFile = async () => {
    if (!pendingEmbed || loading) return;
    const action = pendingEmbed;
    setError('');
    setActivityText(`正在把 ${action.file.file_name} 写入知识库...`);
    setToolCalls(prev => [{
      id: id(),
      tool: 'readDocument',
      title: '正在建立知识库并嵌入文档',
      status: 'running',
      args: { fileId: action.file.id, kbName: action.kbName, indexNow: action.indexNow },
      result: '正在创建/复用知识库、写入 Markdown 文档，并按你的选择启动 HyperRAG 嵌入。',
    }, ...prev]);
    setPendingEmbed(prev => prev ? { ...prev, logs: [...prev.logs, '开始创建/复用知识库。'] } : prev);
    setLoading(true);

    try {
      const headers = await authHeaders();
      const res = await fetchWithTimeout(`/api/agent/files/${action.file.id}/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          kbName: action.kbName,
          indexNow: action.indexNow,
        }),
      }, LONG_REQUEST_TIMEOUT_MS);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '知识库导入失败');

      setFiles(prev => prev.map(file => file.id === data.file?.id ? data.file : file));
      setToolCalls(prev => prev.map(call => call.title === '正在建立知识库并嵌入文档' && call.status === 'running'
        ? { ...call, status: data.sync?.ok === false ? 'failed' : 'completed', result: (data.logs || []).join('\n') }
        : call));
      setPendingEmbed(null);
      pushMessage({
        role: 'assistant',
        content: [
          `已将《${action.file.file_name}》写入知识库《${data.knowledgeBase?.name || action.kbName}》。`,
          data.sync?.ok === false ? `嵌入未完成：${data.sync.error}` : action.indexNow ? 'HyperRAG 嵌入同步已完成。' : '你选择了暂不立即嵌入。',
        ].join('\n'),
      });
      setRightTab('files');
      setRightOpen(true);
      await loadConversations();
      await loadArtifacts();
    } catch (err: any) {
      setToolCalls(prev => prev.map(call => call.title === '正在建立知识库并嵌入文档' && call.status === 'running'
        ? { ...call, status: 'failed', error: err.message || '知识库导入失败' }
        : call));
      setPendingEmbed(prev => prev ? { ...prev, logs: [...prev.logs, `失败：${err.message || '知识库导入失败'}`] } : prev);
      setError(err.message || '知识库导入失败');
    } finally {
      setActivityText('');
      setLoading(false);
    }
  };

  const mergeStreamToolCall = (event: string, data: any) => {
    const call = streamEventToolCall(event, data);
    if (!call) return;
    setToolCalls(prev => {
      const index = prev.findIndex(item => item.id === call.id || item.tool === call.tool);
      if (index < 0) return [call, ...prev];
      const next = [...prev];
      next[index] = { ...next[index], ...call };
      return next;
    });
  };

  const handleStreamEvent = async (event: string, data: any) => {
    if (event === 'ping') return;
    if (event === 'error') throw new Error(data.error || 'Agent execution failed');
    if (event === 'run') {
      currentRunIdRef.current = data?.runId || '';
      if (data?.runId) setActivityText(`Synapse run ${String(data.runId).slice(0, 8)} is running...`);
      return;
    }
    if (event === 'token') {
      if (data?.kind === 'reasoning') {
        setActivityText('Synapse is thinking...');
        return;
      }
      appendStreamingAssistantToken(String(data?.token || data?.message || ''));
      return;
    }
    if (data?.conversationId) {
      activeStreamConversationRef.current = data.conversationId;
      setSelectedConversationId(data.conversationId);
    }
    if (data?.message) setActivityText(data.message);
    mergeStreamToolCall(event, data);
    if (
      data?.message
      && ['node_start', 'node_done', 'tool_start', 'tool_done', 'tool_error'].includes(event)
      && data.tool
    ) {
      const key = `${event}:${data.tool}:${data.node || data.title || ''}:${data.message}`;
      if (!streamProgressRef.current.has(key)) {
        streamProgressRef.current.add(key);
        pushMessage({ role: 'system', content: data.message });
      }
    }
  };

  const replayRunEvents = async (runId: string) => {
    if (!runId) return false;
    const headers = await authHeaders();
    if (!headers.Authorization) return false;

    const after = lastRunEventSequenceRef.current;
    const eventsRes = await fetch(`/api/agent/runs/${runId}/events?after=${after}`, { headers });
    if (eventsRes.ok) {
      const rows = await eventsRes.json();
      for (const row of rows || []) {
        const sequence = Number(row.sequence || 0);
        if (sequence > lastRunEventSequenceRef.current) lastRunEventSequenceRef.current = sequence;
        if (row.event_type === 'token') continue;
        await handleStreamEvent(row.event_type, row.payload || {});
      }
    }

    const runRes = await fetch(`/api/agent/runs/${runId}`, { headers });
    if (!runRes.ok) return false;
    const run = await runRes.json();
    if (run.conversation_id) {
      activeStreamConversationRef.current = run.conversation_id;
      setSelectedConversationId(run.conversation_id);
    }
    if (run.status === 'completed' && run.conversation_id) {
      await loadConversation(run.conversation_id);
      return true;
    }
    if (run.status === 'failed') {
      throw new Error(run.error || 'Agent run failed');
    }
    setActivityText(`Synapse run ${String(runId).slice(0, 8)} is still ${run.status || 'running'}...`);
    return false;
  };

  const applyAgentResult = (data: any, options: { pushFallback?: boolean } = {}) => {
    streamingAssistantIdRef.current = '';
    if (data.conversation?.id) setSelectedConversationId(data.conversation.id);
    if (data.messages) setMessages(messagesFromStored(data.messages));
    if (data.toolCalls) setToolCalls(data.toolCalls);
    if (data.sources) setSources(data.sources);
    if (data.files) setFiles(data.files);
    if (data.document) {
      setSelectedDocument(data.document);
      setRightTab('documents');
      setRightOpen(true);
    } else if (data.sources?.length) {
      setRightTab('sources');
    }

    if (data.type === 'plan' && data.plan) {
      setPendingPlan(data.plan);
      if (options.pushFallback && !data.messages) {
        pushMessage({ role: 'assistant', content: data.message || '需要你确认后我再执行这个动作。' });
      }
      return;
    }

    setPendingPlan(null);
    if (data.type === 'response') setPendingMessage('');
    if (options.pushFallback && !data.messages) {
      pushMessage({ role: 'assistant', content: data.message || '执行完成。' });
    }
  };

  const askAgent = async () => {
    const next = input.trim();
    if (!next || loading) return;
    setInput('');
    setError('');
    setPendingPlan(null);
    setPendingMessage(next);
    streamProgressRef.current.clear();
    streamingAssistantIdRef.current = '';
    currentRunIdRef.current = '';
    lastRunEventSequenceRef.current = 0;
    activeStreamConversationRef.current = selectedConversationId || '';
    setToolCalls(optimisticToolCalls(next));
    setActivityText('Synapse 正在判断意图...');
    pushMessage({ role: 'user', content: next });
    setLoading(true);

    try {
      const headers = await authHeaders();
      const res = await fetchWithTimeout('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ message: next, conversationId: selectedConversationId || undefined, agentSettings }),
      }, LONG_REQUEST_TIMEOUT_MS);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Agent planning failed');
      if (data.conversation?.id) setSelectedConversationId(data.conversation.id);
      if (data.messages) setMessages(messagesFromStored(data.messages));
      if (data.toolCalls) setToolCalls(data.toolCalls);
      if (data.sources) setSources(data.sources);
      if (data.files) setFiles(data.files);
      if (data.type === 'response') {
        setPendingPlan(null);
        setPendingMessage('');
        if (!data.messages) pushMessage({ role: 'assistant', content: data.message || '我可以直接回答这个问题。' });
        return;
      }
      if (data.type === 'plan' && data.plan) {
        setPendingPlan(data.plan);
        if (!data.messages) pushMessage({ role: 'assistant', content: data.message || '需要你确认后我再执行这个动作。' });
      } else {
        setPendingPlan(null);
        if (!data.messages) pushMessage({ role: 'assistant', content: data.message || '执行完成。' });
      }
      loadConversations();
    } catch (err: any) {
      const recoverId = activeStreamConversationRef.current || selectedConversationId;
      if (recoverId) {
        await loadConversation(recoverId).catch(() => {});
      }
      setError(err.message || 'Agent planning failed');
    } finally {
      setActivityText('');
      setLoading(false);
    }
  };

  const askAgentStream = async () => {
    const next = input.trim();
    if (!next || loading) return;
    setInput('');
    setError('');
    setPendingPlan(null);
    setPendingMessage(next);
    streamProgressRef.current.clear();
    streamingAssistantIdRef.current = '';
    currentRunIdRef.current = '';
    lastRunEventSequenceRef.current = 0;
    activeStreamConversationRef.current = selectedConversationId || '';
    setToolCalls(optimisticToolCalls(next));
    setActivityText('Synapse 正在判断意图...');
    pushMessage({ role: 'user', content: next });
    setLoading(true);

    try {
      const headers = await authHeaders();
      const res = await fetchWithTimeout('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...headers },
        body: JSON.stringify({ message: next, conversationId: selectedConversationId || undefined, agentSettings, stream: true }),
      }, LONG_REQUEST_TIMEOUT_MS);
      if (!res.ok) throw new Error('Agent planning failed');

      let finalData: any = null;
      await readSseResponse(res, async (event, data) => {
        await handleStreamEvent(event, data);
        if (event === 'result') {
          finalData = data;
          applyAgentResult(data, { pushFallback: true });
        }
      });
      if (!finalData) throw new Error('Agent did not return a final result.');
      loadConversations();
    } catch (err: any) {
      const recoverId = activeStreamConversationRef.current || selectedConversationId;
      if (recoverId) {
        await loadConversation(recoverId).catch(() => {});
      }
      if (currentRunIdRef.current) {
        await replayRunEvents(currentRunIdRef.current).catch(() => {});
      }
      setError(err.message || 'Agent planning failed');
    } finally {
      setActivityText('');
      setLoading(false);
    }
  };

  const confirmPlanStream = async () => {
    if (!pendingPlan || !pendingMessage || loading) return;
    setLoading(true);
    setError('');
    streamProgressRef.current.clear();
    streamingAssistantIdRef.current = '';
    currentRunIdRef.current = '';
    lastRunEventSequenceRef.current = 0;
    activeStreamConversationRef.current = selectedConversationId || '';
    setActivityText('正在执行已确认的文档生成...');
    pushMessage({ role: 'user', content: '确认执行这个计划。' });
    setToolCalls(pendingPlan.steps.map(step => ({
      id: step.id,
      tool: step.tool,
      title: step.title,
      status: 'pending',
      args: step.args,
    })));

    try {
      const headers = await authHeaders();
      const res = await fetchWithTimeout('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...headers },
        body: JSON.stringify({ message: pendingMessage, conversationId: selectedConversationId || undefined, confirmedPlan: pendingPlan, agentSettings, stream: true }),
      }, LONG_REQUEST_TIMEOUT_MS);
      if (!res.ok) throw new Error('Agent execution failed');

      let finalData: any = null;
      await readSseResponse(res, async (event, data) => {
        await handleStreamEvent(event, data);
        if (event === 'result') {
          finalData = data;
          setPendingPlan(null);
          applyAgentResult(data, { pushFallback: true });
        }
      });
      if (!finalData) throw new Error('Agent did not return a final result.');
      loadConversations();
      loadDocuments();
      loadFiles();
      loadArtifacts();
      loadArtifacts();
    } catch (err: any) {
      const recoverId = activeStreamConversationRef.current || selectedConversationId;
      if (recoverId) {
        await loadConversation(recoverId).catch(() => {});
      }
      if (currentRunIdRef.current) {
        await replayRunEvents(currentRunIdRef.current).catch(() => {});
      }
      setError(err.message || 'Agent execution failed');
    } finally {
      setActivityText('');
      setLoading(false);
    }
  };

  const confirmPlan = async () => {
    if (!pendingPlan || !pendingMessage || loading) return;
    setLoading(true);
    setError('');
    setActivityText('正在执行已确认的文档生成...');
    pushMessage({ role: 'user', content: '确认执行这个计划。' });
    setToolCalls(pendingPlan.steps.map(step => ({
      id: step.id,
      tool: step.tool,
      title: step.title,
      status: 'pending',
      args: step.args,
    })));

    try {
      const headers = await authHeaders();
      const res = await fetchWithTimeout('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ message: pendingMessage, conversationId: selectedConversationId || undefined, confirmedPlan: pendingPlan, agentSettings }),
      }, LONG_REQUEST_TIMEOUT_MS);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Agent execution failed');
      setPendingPlan(null);
      setToolCalls(data.toolCalls || []);
      setSources(data.sources || []);
      if (data.conversation?.id) setSelectedConversationId(data.conversation.id);
      if (data.document) {
        setSelectedDocument(data.document);
        setRightTab('documents');
        setRightOpen(true);
      } else if (data.sources?.length) {
        setRightTab('sources');
      }
      pushMessage({ role: 'assistant', content: data.message || '执行完成。' });
      loadConversations();
      loadDocuments();
      loadFiles();
    } catch (err: any) {
      setError(err.message || 'Agent execution failed');
    } finally {
      setActivityText('');
      setLoading(false);
    }
  };

  const rejectPlan = () => {
    setPendingPlan(null);
    pushMessage({ role: 'assistant', content: '好的，我不会执行这个计划。你可以换一种说法重新发起任务。' });
  };

  void askAgent;
  void confirmPlan;

  const downloadUrl = (url: string, name: string) => {
    const a = window.document.createElement('a');
    a.href = url;
    a.download = name;
    a.target = '_blank';
    window.document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const loadArtifacts = async () => {
    try {
      const headers = await authHeaders();
      if (!headers.Authorization) return;
      const res = await fetch('/api/agent/artifacts?limit=120', { headers });
      if (!res.ok) return;
      const data = await res.json();
      setArtifacts(data || []);
    } catch {
      // Artifact registry is additive; keep the chat usable if it is not migrated yet.
    }
  };

  const downloadAgentFile = async (file: AgentFile) => {
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/agent/files/${file.id}`, { headers });
      if (res.redirected) {
        downloadUrl(res.url, file.file_name);
        return;
      }
      const blob = await res.blob();
      if (!res.ok) throw new Error(await blob.text().catch(() => '下载失败'));
      const url = URL.createObjectURL(blob);
      downloadUrl(url, file.file_name);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || '下载失败');
    }
  };

  const downloadDocument = async (document: AgentDocument, format: 'markdown' | 'docx') => {
    const headers = await authHeaders();
    const res = await fetch(`/api/agent/documents/${document.id}/artifact?format=${format}`, { headers });
    const blob = await res.blob();
    if (!res.ok) {
      setError(await blob.text().catch(() => '下载失败'));
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = `${document.title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, '-').slice(0, 60)}.${format === 'docx' ? 'docx' : 'md'}`;
    window.document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const deleteFile = async (file: AgentFile) => {
    if (!window.confirm(`删除文件「${file.file_name}」？`)) return;
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/agent/files/${file.id}`, { method: 'DELETE', headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '删除失败');
      setFiles(prev => prev.filter(item => item.id !== file.id));
      await loadFiles();
    } catch (err: any) {
      setError(err.message || '删除失败');
    }
  };

  const deleteDocument = async (document: AgentDocument) => {
    if (!window.confirm(`删除文档「${document.title}」？`)) return;
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/agent/documents/${document.id}`, { method: 'DELETE', headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '删除失败');
      setDocuments(prev => prev.filter(item => item.id !== document.id));
      if (selectedDocument?.id === document.id) setSelectedDocument(null);
      await loadDocuments();
    } catch (err: any) {
      setError(err.message || '删除失败');
    }
  };

  return (
    <div className="mx-auto flex h-[calc(100dvh-6rem)] max-w-[1800px] overflow-hidden bg-gray-50 lg:h-[calc(100vh-4rem)]">
      {leftOpen && (
      <aside className="hidden w-[280px] flex-shrink-0 border-r border-gray-200 bg-white lg:flex lg:flex-col">
        <div className="flex gap-2 border-b border-gray-100 p-3">
          <button
            onClick={newConversation}
            className="flex-1 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            新建 Synapse 对话
          </button>
          <button
            onClick={() => setLeftOpen(false)}
            className="rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-sm text-gray-500 hover:border-gray-300 hover:text-gray-700"
            title="收起会话栏"
          >
            ←
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {conversations.length === 0 ? (
            <div className="rounded-lg bg-gray-50 p-3 text-xs leading-5 text-gray-400">暂无历史会话。发送第一条消息后会自动保存。</div>
          ) : conversations.map(conversation => (
            <div
              key={conversation.id}
              className={`group mb-1 rounded-lg p-2 ${selectedConversationId === conversation.id ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
            >
              <button
                onClick={() => loadConversation(conversation.id)}
                className={`block w-full truncate text-left text-sm ${selectedConversationId === conversation.id ? 'font-medium text-blue-700' : 'text-gray-700'}`}
              >
                {conversation.title}
              </button>
              <div className="mt-1 flex items-center justify-between text-[10px] text-gray-400">
                <span>{new Date(conversation.updated_at).toLocaleString()}</span>
                <span className="hidden gap-1 group-hover:flex">
                  <button onClick={() => renameConversation(conversation)} className="hover:text-gray-700">重命名</button>
                  <button onClick={() => deleteConversation(conversation)} className="hover:text-red-600">删除</button>
                </span>
              </div>
            </div>
          ))}
        </div>
      </aside>
      )}

      <main className="flex min-w-0 flex-1 flex-col bg-white">
        <header className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[10px] font-medium uppercase text-gray-400">Agent Workspace</div>
            <h1 className="truncate text-base font-semibold text-gray-900">Synapse 主控 Agent</h1>
          </div>
          <div className="flex items-center gap-2">
            {!leftOpen && (
              <button
                onClick={() => setLeftOpen(true)}
                className="hidden rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:border-gray-300 lg:inline-flex"
              >
                会话
              </button>
            )}
            <div className="relative">
              <button
                onClick={() => setSettingsOpen(prev => !prev)}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:border-gray-300"
              >
                设置
              </button>
              {settingsOpen && (
                <div className="absolute right-0 z-20 mt-2 w-72 rounded-lg border border-gray-200 bg-white p-3 text-sm shadow-lg">
                  <div className="text-xs font-medium text-gray-500">主控 Agent 管理</div>
                  <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                    <div className="text-xs font-medium text-gray-800">DeepSeek V4 Flash</div>
                    <div className="mt-1 text-[11px] leading-5 text-gray-400">
                      Pro 已停用以控制成本。API Key 会优先读取个人设置，未配置时使用后台系统默认值。
                    </div>
                  </div>
                  <label className="mt-3 flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                    <span>
                      <span className="block font-medium text-gray-700">Thinking 模式</span>
                      <span className="mt-0.5 block text-gray-400">请求模型返回 reasoning 字段，若不支持会自动回退。</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={agentSettings.thinkingEnabled}
                      onChange={event => setAgentSettings(prev => ({ ...prev, thinkingEnabled: event.target.checked }))}
                      className="h-4 w-4"
                    />
                  </label>
                  <div className="mt-2 text-[11px] leading-5 text-gray-400">
                    当前设置只影响 Synapse 主控 Agent，不会覆盖全站设置页里的 API Key。
                  </div>
                </div>
              )}
            </div>
            <label className="cursor-pointer rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:border-gray-300">
              上传文件
              <input
                type="file"
                className="hidden"
                accept=".pdf,.docx,.txt,.md,.markdown,.csv,.json,.yaml,.yml,.js,.jsx,.ts,.tsx,.py,.ipynb,.java,.c,.cpp,.h,.hpp,.cs,.go,.rs,.rb,.html,.css,.sql,.xml,.toml,.ini,.zip"
                onChange={event => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) uploadFile(file);
                }}
              />
            </label>
            <button
              onClick={() => setRightOpen(prev => !prev)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:border-gray-300"
            >
              {rightOpen ? '收起信息栏' : '打开信息栏'}
            </button>
          </div>
        </header>

        <div className="border-b border-gray-100 bg-white px-4 py-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium text-gray-500">工具状态</span>
            {[
              ['researchSearch', '检索'],
              ['readDocument', '文档阅读'],
              ['convertDocument', '文档转换'],
              ['createDocument', '文档生成'],
              ['downloadFile', '沙箱下载'],
              ['runTerminal', '终端'],
              ['listSandboxFiles', '文件列表'],
            ].map(([tool, label]) => {
              const active = toolCalls.find(call => call.tool === tool);
              const status = active?.status || 'ready';
              return (
                <span
                  key={tool}
                  className={`rounded-full px-2 py-1 ${
                    status === 'running'
                      ? 'bg-blue-50 text-blue-700'
                      : status === 'pending'
                        ? 'bg-amber-50 text-amber-700'
                        : status === 'failed'
                          ? 'bg-red-50 text-red-700'
                          : status === 'completed'
                            ? 'bg-green-50 text-green-700'
                            : 'bg-gray-50 text-gray-500'
                  }`}
                >
                  {label} · {status === 'ready' ? '可用' : status}
                </span>
              );
            })}
            {activityText && <span className="ml-auto text-blue-600">{activityText}</span>}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-gray-50/60 px-3 py-4 sm:px-4">
          <div className="mx-auto max-w-4xl space-y-4">
            {messages.map(message => (
              <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[92%] rounded-lg px-3 py-2 text-sm shadow-sm sm:max-w-[84%] ${
                  message.role === 'user'
                    ? 'bg-gray-900 text-white'
                    : message.role === 'system'
                      ? 'border border-gray-200 bg-white text-gray-600'
                      : 'bg-blue-50 text-gray-800'
                }`}>
                  {message.role === 'user' ? (
                    <div className="whitespace-pre-line leading-6">{message.content}</div>
                  ) : (
                    <article
                      className="prose prose-sm max-w-none break-words prose-headings:text-gray-900 prose-p:my-2 prose-p:leading-6 prose-li:my-0 prose-li:leading-6 prose-code:rounded prose-code:bg-white/70 prose-code:px-1 prose-code:py-0.5"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
                    />
                  )}
                </div>
              </div>
            ))}

            {pendingPlan && (
              <div className="rounded-lg border border-blue-100 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-[10px] font-medium uppercase text-blue-500">Plan preview</div>
                    <h2 className="mt-1 text-sm font-medium text-gray-900">{pendingPlan.title}</h2>
                    <p className="mt-1 text-xs leading-5 text-gray-500">{pendingPlan.summary}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={confirmPlanStream}
                      disabled={loading}
                      className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                    >
                      {loading ? '执行中...' : '确认执行'}
                    </button>
                    <button
                      onClick={rejectPlan}
                      disabled={loading}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:border-gray-300 disabled:opacity-50"
                    >
                      取消
                    </button>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  {pendingPlan.steps.map((step, index) => (
                    <div key={step.id} className="rounded-lg bg-gray-50 p-3">
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] text-gray-500">{index + 1}</span>
                        <span className="text-xs font-medium text-gray-800">{step.title}</span>
                        <span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-gray-500">{step.tool}</span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-gray-500">{step.description}</p>
                      {step.tool === 'researchSearch' && (
                        <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-gray-500">
                          {modeLabel(step.args?.mode) && <span className="rounded bg-white px-1.5 py-0.5">{modeLabel(step.args?.mode)}</span>}
                          {depthLabel(step.args?.depth) && <span className="rounded bg-white px-1.5 py-0.5">{depthLabel(step.args?.depth)}</span>}
                        </div>
                      )}
                      {step.args?.query && <div className="mt-2 rounded bg-white px-2 py-1 text-xs text-gray-600">{step.args.query}</div>}
                      {step.args?.routingReason && <p className="mt-2 text-[11px] leading-5 text-gray-400">{step.args.routingReason}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {pendingEmbed && (
              <div className="rounded-lg border border-emerald-100 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-[10px] font-medium uppercase text-emerald-600">Document skill</div>
                    <h2 className="mt-1 text-sm font-medium text-gray-900">是否导入知识库并完成嵌入？</h2>
                    <p className="mt-1 text-xs leading-5 text-gray-500">
                      《{pendingEmbed.file.file_name}》已经解析出 {pendingEmbed.file.content_text.length} 个字符。确认后 Synapse 会创建/复用知识库、写入 Markdown 文档，并按设置启动 HyperRAG 同步。
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={confirmEmbedFile}
                      disabled={loading || !pendingEmbed.kbName.trim()}
                      className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                    >
                      {loading ? '执行中...' : '确认导入'}
                    </button>
                    <button
                      onClick={() => setPendingEmbed(null)}
                      disabled={loading}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:border-gray-300 disabled:opacity-50"
                    >
                      暂不导入
                    </button>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
                  <label className="block">
                    <span className="text-xs font-medium text-gray-600">知识库名称</span>
                    <input
                      value={pendingEmbed.kbName}
                      onChange={event => setPendingEmbed(prev => prev ? { ...prev, kbName: event.target.value } : prev)}
                      className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-emerald-300"
                    />
                  </label>
                  <label className="flex items-end gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                    <input
                      type="checkbox"
                      checked={pendingEmbed.indexNow}
                      onChange={event => setPendingEmbed(prev => prev ? { ...prev, indexNow: event.target.checked } : prev)}
                      className="h-4 w-4"
                    />
                    <span>立即嵌入索引</span>
                  </label>
                </div>
                <div className="mt-3 space-y-1 rounded-lg bg-gray-50 p-3">
                  {pendingEmbed.logs.map((log, index) => (
                    <div key={`${log}-${index}`} className="text-[11px] leading-5 text-gray-500">• {log}</div>
                  ))}
                </div>
              </div>
            )}

            {error && <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
            {loading && <div className="text-center text-xs text-gray-400">Agent 正在工作...</div>}
            <div ref={endRef} />
          </div>
        </div>

        <div className="border-t border-gray-100 bg-white px-3 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-4 lg:pb-3">
          <div className="mx-auto max-w-4xl">
            {uploadPreviews.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {uploadPreviews.map(file => (
                  <div
                    key={file.id}
                    className={`flex max-w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-xs shadow-sm ${
                      file.status === 'failed'
                        ? 'border-red-100 bg-red-50 text-red-700'
                        : file.status === 'ready'
                          ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                          : 'border-gray-200 bg-gray-50 text-gray-600'
                    }`}
                  >
                    <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-500">{file.fileType}</span>
                    <span className="max-w-[220px] truncate font-medium">{file.fileName}</span>
                    <span className="text-[10px] opacity-70">{formatFileSize(file.fileSize)}</span>
                    <span className="text-[10px] opacity-80">{file.detail}</span>
                    <button
                      onClick={() => setUploadPreviews(prev => prev.filter(item => item.id !== file.id))}
                      className="rounded px-1 text-[11px] opacity-70 hover:bg-white hover:opacity-100"
                      aria-label="移除文件预览"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <textarea
                value={input}
                onChange={event => setInput(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    askAgentStream();
                  }
                }}
                placeholder="例如：总结我刚上传的文档，必要时联网补充资料"
                className="min-h-12 flex-1 resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-base outline-none focus:border-blue-300 sm:text-sm"
              />
              <button
                onClick={askAgentStream}
                disabled={loading || !input.trim()}
                className="self-end rounded-lg bg-gray-900 px-4 py-3 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              >
                发送
              </button>
            </div>
          </div>
        </div>
      </main>

      {rightOpen && (
        <aside className="hidden w-[380px] flex-shrink-0 border-l border-gray-200 bg-white lg:flex lg:flex-col">
          <div className="border-b border-gray-100 px-4 py-3">
            <div className="grid grid-cols-4 rounded-lg bg-gray-100 p-1 text-xs">
              {[
                ['tools', '工具'],
                ['sources', '来源'],
                ['files', '文件库'],
                ['documents', '文档'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setRightTab(value as RightTab)}
                  className={`rounded-md px-2 py-1.5 ${rightTab === value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {rightTab === 'tools' && (
              <div className="space-y-2">
                {toolCalls.length === 0 ? (
                  <div className="rounded-lg bg-gray-50 p-4 text-xs text-gray-400">确认计划后会显示工具调用。</div>
                ) : toolCalls.map(call => (
                  <div key={call.id} className="rounded-lg border border-gray-100 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-xs font-medium text-gray-800">{call.title}</h3>
                      <span className="rounded bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-500">{call.status}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-gray-400">{toolLabel(call.tool)}</div>
                    {call.tool === 'researchSearch' && (
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-gray-500">
                        {modeLabel(call.args?.mode) && <span className="rounded bg-gray-50 px-1.5 py-0.5">{modeLabel(call.args?.mode)}</span>}
                        {depthLabel(call.args?.depth) && <span className="rounded bg-gray-50 px-1.5 py-0.5">{depthLabel(call.args?.depth)}</span>}
                      </div>
                    )}
                    {call.args?.query && <div className="mt-2 rounded bg-gray-50 px-2 py-1 text-xs text-gray-600">{call.args.query}</div>}
                    {call.args?.routingReason && <p className="mt-2 text-[11px] leading-5 text-gray-400">{call.args.routingReason}</p>}
                    {call.result && <p className="mt-2 text-xs leading-5 text-gray-600">{call.result}</p>}
                    {call.error && <p className="mt-2 text-xs leading-5 text-red-600">{call.error}</p>}
                  </div>
                ))}
              </div>
            )}

            {rightTab === 'sources' && (
              <div className="space-y-2">
                {sources.length === 0 ? (
                  <div className="rounded-lg bg-gray-50 p-4 text-xs text-gray-400">检索后会显示来源。</div>
                ) : sources.slice(0, 30).map(source => (
                  <a
                    key={`${source.id}-${source.url}`}
                    href={source.url || '#'}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-lg bg-gray-50 p-3 hover:bg-gray-100"
                  >
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-gray-500">{source.sourceProvider || source.type}</span>
                      {source.year && <span className="text-[10px] text-gray-400">{source.year}</span>}
                    </div>
                    <div className="mt-1 line-clamp-2 text-xs font-medium text-gray-700">{source.title}</div>
                    <p className="mt-1 line-clamp-3 text-xs leading-5 text-gray-500">{source.fullTextExcerpt || source.abstract || source.snippet}</p>
                  </a>
                ))}
              </div>
            )}

            {rightTab === 'files' && (
              <div className="space-y-4">
                <section>
                  <div className="mb-2 text-[11px] font-medium uppercase text-gray-400">文件库</div>
                  {files.length === 0 ? (
                    <div className="rounded-lg bg-gray-50 p-4 text-xs leading-5 text-gray-400">上传 PDF、DOCX、Markdown、代码文件或 ZIP 后，Synapse 可以在任意对话中读取文本内容；ZIP 会安全解压到服务器沙箱。</div>
                  ) : (
                    <div className="space-y-2">
                      {files.map(file => (
                        <div key={file.id} className="rounded-lg bg-gray-50 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 truncate text-xs font-medium text-gray-700">{file.file_name}</div>
                            <span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-gray-500">{file.file_type}</span>
                          </div>
                          <div className="mt-1 text-[10px] text-gray-400">{file.file_size ? `${Math.ceil((file.file_size || 0) / 1024)} KB · ` : ''}{file.content_text ? `${file.content_text.length} 字符` : file.file_type === 'zip' ? 'MinerU 转换结果' : '未解析出文本'}</div>
                          {conversionStatusLabel(file) && (
                            <div className={`mt-1 text-[10px] ${file.metadata?.conversionStatus === 'failed' ? 'text-red-600' : 'text-blue-600'}`}>
                              {conversionStatusLabel(file)}
                            </div>
                          )}
                          {file.metadata?.workspace?.archive?.extractionStatus && (
                            <div className={`mt-1 text-[10px] ${file.metadata.workspace.archive.extractionStatus === 'completed' ? 'text-blue-600' : 'text-red-600'}`}>
                              ZIP {file.metadata.workspace.archive.extractionStatus === 'completed'
                                ? `已安全解压 ${file.metadata.workspace.archive.extractedFiles?.length || 0} 个文件`
                                : `解压失败：${file.metadata.workspace.archive.extractionError || '未知错误'}`}
                            </div>
                          )}
                          {file.metadata?.embeddingStatus && (
                            <div className="mt-1 text-[10px] text-emerald-600">
                              知识库：{file.metadata.kbName || '已导入'} · {file.metadata.embeddingStatus}
                            </div>
                          )}
                          {file.content_text && <p className="mt-2 line-clamp-4 text-xs leading-5 text-gray-500">{file.content_text}</p>}
                          <div className="mt-2 flex flex-wrap gap-2">
                            {hasDownloadableAgentFile(file) && (
                              <button
                                onClick={() => downloadAgentFile(file)}
                                className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600 hover:border-gray-300"
                              >
                                下载
                              </button>
                            )}
                            <button
                              onClick={() => deleteFile(file)}
                              className="rounded-lg border border-red-100 bg-white px-2 py-1.5 text-xs text-red-600 hover:border-red-200"
                            >
                              删除
                            </button>
                            {file.content_text && !file.metadata?.kbDocumentId && (
                              <button
                                onClick={() => setPendingEmbed({
                                  file,
                                  kbName: 'Synapse Agent Files',
                                  indexNow: true,
                                  logs: ['文件已解析为 Markdown，等待你确认是否写入知识库。'],
                                })}
                                className="rounded-lg border border-emerald-200 bg-white px-2 py-1.5 text-xs text-emerald-700 hover:border-emerald-300"
                              >
                                导入知识库
                              </button>
                            )}
                            {file.file_type === 'pdf' && (
                              <button
                                onClick={() => convertFile(file)}
                                disabled={file.metadata?.conversionStatus === 'processing'}
                                className="rounded-lg bg-gray-900 px-2 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                              >
                                {file.metadata?.conversionStatus === 'processing' ? '转换中' : 'MinerU 转换'}
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section>
                  <div className="mb-2 text-[11px] font-medium uppercase text-gray-400">Artifacts</div>
                  {artifacts.length === 0 ? (
                    <div className="rounded-lg bg-gray-50 p-4 text-xs leading-5 text-gray-400">
                      上传、下载、转换、解压或生成文档后，Artifact Registry 会在这里显示统一产物索引。
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {artifacts.slice(0, 40).map(artifact => {
                        const linkedFile = artifact.source_table === 'agent_files'
                          ? files.find(file => file.id === artifact.source_id)
                          : null;
                        return (
                          <div key={artifact.id} className="rounded-lg border border-gray-100 bg-white p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0 truncate text-xs font-medium text-gray-700">{artifact.name}</div>
                              <span className="rounded bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-500">{artifact.kind}</span>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-gray-400">
                              <span>{artifact.status}</span>
                              {artifact.source_tool && <span>{artifact.source_tool}</span>}
                              {artifact.size_bytes > 0 && <span>{formatFileSize(artifact.size_bytes)}</span>}
                            </div>
                            {artifact.content_preview && (
                              <p className="mt-2 line-clamp-3 text-xs leading-5 text-gray-500">{artifact.content_preview}</p>
                            )}
                            {linkedFile && hasDownloadableAgentFile(linkedFile) && (
                              <button
                                onClick={() => downloadAgentFile(linkedFile)}
                                className="mt-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600 hover:border-gray-300"
                              >
                                下载关联文件
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                <section>
                  <div className="mb-2 text-[11px] font-medium uppercase text-gray-400">生成文档</div>
                  {documents.length === 0 ? (
                    <div className="rounded-lg bg-gray-50 p-4 text-xs leading-5 text-gray-400">Synapse 生成的 Markdown / DOCX 会出现在这里。</div>
                  ) : (
                    <div className="space-y-2">
                      {documents.map(document => (
                        <div key={document.id} className="rounded-lg bg-gray-50 p-3">
                          <button
                            onClick={() => {
                              setSelectedDocument(document);
                              setRightTab('documents');
                            }}
                            className="block w-full truncate text-left text-xs font-medium text-gray-700"
                          >
                            {document.title}
                          </button>
                          <div className="mt-1 text-[10px] text-gray-400">{new Date(document.updated_at).toLocaleString()}</div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button onClick={() => downloadDocument(document, 'markdown')} className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600 hover:border-gray-300">
                              Markdown
                            </button>
                            <button onClick={() => downloadDocument(document, 'docx')} className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600 hover:border-gray-300">
                              DOCX
                            </button>
                            <button onClick={() => deleteDocument(document)} className="rounded-lg border border-red-100 bg-white px-2 py-1.5 text-xs text-red-600 hover:border-red-200">
                              删除
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}

            {rightTab === 'documents' && (
              <div className="space-y-3">
                <div className="space-y-2">
                  {documents.length === 0 ? (
                    <div className="rounded-lg bg-gray-50 p-4 text-xs text-gray-400">Agent 创建文档后会显示在这里。</div>
                  ) : documents.map(document => (
                    <button
                      key={document.id}
                      onClick={() => setSelectedDocument(document)}
                      className={`block w-full rounded-lg p-3 text-left text-xs ${
                        selectedDocument?.id === document.id ? 'bg-blue-50 text-blue-700' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      <span className="line-clamp-2 font-medium">{document.title}</span>
                      <span className="mt-1 block text-[10px] text-gray-400">{new Date(document.updated_at).toLocaleString()}</span>
                    </button>
                  ))}
                </div>
                {selectedDocument && (
                  <div className="rounded-lg border border-gray-100 p-3">
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => downloadDocument(selectedDocument, 'markdown')} className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-800">
                        下载 Markdown
                      </button>
                      <button onClick={() => downloadDocument(selectedDocument, 'docx')} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 hover:border-gray-300">
                        下载 DOCX
                      </button>
                      <button onClick={() => deleteDocument(selectedDocument)} className="rounded-lg border border-red-100 bg-white px-3 py-2 text-xs text-red-600 hover:border-red-200">
                        删除
                      </button>
                    </div>
                    <article
                      className="prose prose-sm mt-3 max-w-none break-words prose-headings:text-gray-900 prose-p:leading-7 prose-p:text-gray-700 prose-li:leading-7 prose-li:marker:text-gray-300"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(selectedDocument.content_md) }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
