'use client';

import { useEffect, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { renderMarkdown } from '@/lib/render-markdown';
import type { AgentConversation, AgentDocument, AgentFile, AgentPlan, AgentStoredMessage, AgentToolCallLog, ResearchSource } from '@/types';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
};

type RightTab = 'tools' | 'sources' | 'files' | 'documents';

function id() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
  const [documents, setDocuments] = useState<AgentDocument[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<AgentDocument | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>('tools');
  const [rightOpen, setRightOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    loadConversations();
    loadDocuments();
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, pendingPlan, loading]);

  const pushMessage = (message: Omit<ChatMessage, 'id'>) => {
    setMessages(prev => [...prev, { id: id(), ...message }]);
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
      setToolCalls((data.traces || []).map((trace: any) => ({
        id: trace.id,
        tool: trace.tool_name,
        title: trace.tool_name,
        status: trace.status || 'completed',
        args: trace.input || {},
        result: trace.summary,
      })));
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
    setFiles([]);
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
    setError('');
    setLoading(true);
    try {
      const headers = await authHeaders();
      const form = new FormData();
      form.append('file', file);
      if (selectedConversationId) form.append('conversation_id', selectedConversationId);
      const res = await fetch('/api/agent/files', {
        method: 'POST',
        headers,
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      if (data.conversationId) {
        setSelectedConversationId(data.conversationId);
        await loadConversation(data.conversationId);
      }
      await loadConversations();
      pushMessage({
        role: 'assistant',
        content: data.file?.content_text
          ? `已上传并解析《${data.file.file_name}》。你可以问我总结、提取重点或基于它继续检索。`
          : `已上传《${data.file?.file_name || file.name}》，但暂时没有解析出文本。PDF 可检查 MinerU 配置后重试。`,
      });
      setRightTab('files');
      setRightOpen(true);
    } catch (err: any) {
      setError(err.message || 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  const askAgent = async () => {
    const next = input.trim();
    if (!next || loading) return;
    setInput('');
    setError('');
    setPendingPlan(null);
    setPendingMessage(next);
    pushMessage({ role: 'user', content: next });
    setLoading(true);

    try {
      const headers = await authHeaders();
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ message: next, conversationId: selectedConversationId || undefined }),
      });
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
      setError(err.message || 'Agent planning failed');
    } finally {
      setLoading(false);
    }
  };

  const confirmPlan = async () => {
    if (!pendingPlan || !pendingMessage || loading) return;
    setLoading(true);
    setError('');
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
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ message: pendingMessage, conversationId: selectedConversationId || undefined, confirmedPlan: pendingPlan }),
      });
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
    } catch (err: any) {
      setError(err.message || 'Agent execution failed');
    } finally {
      setLoading(false);
    }
  };

  const rejectPlan = () => {
    setPendingPlan(null);
    pushMessage({ role: 'assistant', content: '好的，我不会执行这个计划。你可以换一种说法重新发起任务。' });
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

  return (
    <div className="mx-auto flex h-[calc(100dvh-6rem)] max-w-[1800px] overflow-hidden bg-gray-50 lg:h-[calc(100vh-4rem)]">
      <aside className="hidden w-[280px] flex-shrink-0 border-r border-gray-200 bg-white lg:flex lg:flex-col">
        <div className="border-b border-gray-100 p-3">
          <button
            onClick={newConversation}
            className="w-full rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            新建 Synapse 对话
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

      <main className="flex min-w-0 flex-1 flex-col bg-white">
        <header className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[10px] font-medium uppercase text-gray-400">Agent Workspace</div>
            <h1 className="truncate text-base font-semibold text-gray-900">Synapse 主控 Agent</h1>
          </div>
          <div className="flex items-center gap-2">
            <label className="cursor-pointer rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:border-gray-300">
              上传文档
              <input
                type="file"
                className="hidden"
                accept=".pdf,.docx,.txt,.md,.markdown,.csv"
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
                  <div className="whitespace-pre-line leading-6">{message.content}</div>
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
                      onClick={confirmPlan}
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

            {error && <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
            {loading && <div className="text-center text-xs text-gray-400">Agent 正在工作...</div>}
            <div ref={endRef} />
          </div>
        </div>

        <div className="border-t border-gray-100 bg-white px-3 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-4 lg:pb-3">
          <div className="mx-auto flex max-w-4xl gap-2">
            <textarea
              value={input}
              onChange={event => setInput(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  askAgent();
                }
              }}
              placeholder="例如：总结我刚上传的文档，必要时联网补充资料"
              className="min-h-12 flex-1 resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-base outline-none focus:border-blue-300 sm:text-sm"
            />
            <button
              onClick={askAgent}
              disabled={loading || !input.trim()}
              className="self-end rounded-lg bg-gray-900 px-4 py-3 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              发送
            </button>
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
                ['files', '文件'],
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
                    <div className="mt-1 text-[11px] text-gray-400">{call.tool}</div>
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
              <div className="space-y-2">
                {files.length === 0 ? (
                  <div className="rounded-lg bg-gray-50 p-4 text-xs leading-5 text-gray-400">上传 PDF、DOCX、Markdown 或 TXT 后，Synapse 可以在对话中读取它们。</div>
                ) : files.map(file => (
                  <div key={file.id} className="rounded-lg bg-gray-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 truncate text-xs font-medium text-gray-700">{file.file_name}</div>
                      <span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-gray-500">{file.file_type}</span>
                    </div>
                    <div className="mt-1 text-[10px] text-gray-400">{Math.ceil((file.file_size || 0) / 1024)} KB · {file.content_text ? `${file.content_text.length} 字符` : '未解析出文本'}</div>
                    {file.content_text && <p className="mt-2 line-clamp-4 text-xs leading-5 text-gray-500">{file.content_text}</p>}
                  </div>
                ))}
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
