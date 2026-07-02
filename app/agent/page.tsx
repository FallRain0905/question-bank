'use client';

import { useEffect, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { renderMarkdown } from '@/lib/render-markdown';
import type { AgentDocument, AgentPlan, AgentToolCallLog, ResearchSource } from '@/types';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
};

type RightTab = 'tools' | 'sources' | 'documents';

function id() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
      content: '我是 Synap Agent 调试台。你可以让我先检索资料，再创建一份 Markdown 文档。我会先给出计划，确认后再调用工具。',
    },
  ]);
  const [input, setInput] = useState('');
  const [pendingPlan, setPendingPlan] = useState<AgentPlan | null>(null);
  const [pendingMessage, setPendingMessage] = useState('');
  const [toolCalls, setToolCalls] = useState<AgentToolCallLog[]>([]);
  const [sources, setSources] = useState<ResearchSource[]>([]);
  const [documents, setDocuments] = useState<AgentDocument[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<AgentDocument | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>('tools');
  const [rightOpen, setRightOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
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
        body: JSON.stringify({ message: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Agent planning failed');
      setPendingPlan(data.plan);
      pushMessage({ role: 'assistant', content: data.message || '我拟定了一个执行计划。' });
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
        body: JSON.stringify({ message: pendingMessage, confirmedPlan: pendingPlan }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Agent execution failed');
      setPendingPlan(null);
      setToolCalls(data.toolCalls || []);
      setSources(data.sources || []);
      if (data.document) {
        setSelectedDocument(data.document);
        setRightTab('documents');
        setRightOpen(true);
      } else if (data.sources?.length) {
        setRightTab('sources');
      }
      pushMessage({ role: 'assistant', content: data.message || '执行完成。' });
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
      <main className="flex min-w-0 flex-1 flex-col bg-white">
        <header className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[10px] font-medium uppercase text-gray-400">Agent Workspace</div>
            <h1 className="truncate text-base font-semibold text-gray-900">Synap Agent 调试台</h1>
          </div>
          <button
            onClick={() => setRightOpen(prev => !prev)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:border-gray-300"
          >
            {rightOpen ? '收起信息栏' : '打开信息栏'}
          </button>
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
                      {step.args?.query && <div className="mt-2 rounded bg-white px-2 py-1 text-xs text-gray-600">{step.args.query}</div>}
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
              placeholder="例如：联网检索 MOF 材料近三年趋势，并创建一份简短研究文档"
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
            <div className="grid grid-cols-3 rounded-lg bg-gray-100 p-1 text-xs">
              {[
                ['tools', '工具'],
                ['sources', '来源'],
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
