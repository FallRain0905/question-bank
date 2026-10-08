'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { renderMarkdown } from '@/lib/render-markdown';
import { stripMarkdownForDisplay } from '@/lib/markdown-plain';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:4000';
const API_TOKEN = process.env.NEXT_PUBLIC_API_ACCESS_TOKEN || '';
const POLL_INTERVAL_MS = 3000;
const IN_PROGRESS_STATUSES = ['pending', 'extracting', 'chunking', 'embedding'];
const ALL_SCOPE = 'all';

interface KnowledgeBase {
  id: string;
  name: string;
  description?: string | null;
  documentCount: number;
  readyCount: number;
  chunkCount: number;
}

interface KbDocument {
  id: string;
  collectionId?: string | null;
  title: string;
  sourceFilename: string | null;
  status: string;
  errorMessage?: string | null;
  converter?: string | null;
  hasSource?: boolean;
  pageCount?: number | null;
  chunkCount: number;
  byteSize?: number | null;
  createdAt: string;
}

interface LogLine {
  id: string;
  level: string;
  message: string;
  createdAt: string;
}

interface Citation {
  index: number;
  documentId: string;
  title: string;
  ordinal: number;
  heading: string | null;
  page: number | null;
  score: number;
  snippet: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  notice?: string | null;
  failed?: boolean;
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  pending: { label: '排队中', className: 'bg-gray-100 text-gray-600' },
  extracting: { label: '解析中', className: 'bg-blue-50 text-blue-600' },
  chunking: { label: '分块中', className: 'bg-blue-50 text-blue-600' },
  embedding: { label: '向量化中', className: 'bg-blue-50 text-blue-600' },
  ready: { label: '就绪', className: 'bg-green-50 text-green-700' },
  failed: { label: '失败', className: 'bg-red-50 text-red-600' },
};

const CONVERTER_LABELS: Record<string, string> = {
  'mineru-v4': 'MinerU 精确解析',
  'mineru-agent': 'MinerU 快速解析',
  'local-pdf-parse': '本地文本层',
  text: '纯文本',
};

const LEVEL_CLASSES: Record<string, string> = {
  info: 'text-gray-600',
  warn: 'text-amber-600',
  error: 'text-red-600',
};

function authHeaders(): Record<string, string> {
  return API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {};
}

async function readError(response: Response) {
  try {
    const payload = await response.json();
    const message = payload?.message ?? payload?.error;
    if (Array.isArray(message)) return message.join('；');
    if (typeof message === 'string') return message;
  } catch {
    // fall through to the status text
  }
  return `请求失败（HTTP ${response.status}）`;
}

function formatBytes(size?: number | null) {
  if (!size) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('zh-CN', { hour12: false });
}

export default function KnowledgePage() {
  const [collections, setCollections] = useState<KnowledgeBase[]>([]);
  const [activeScope, setActiveScope] = useState<string>(ALL_SCOPE);
  const [documents, setDocuments] = useState<KbDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [logsByDoc, setLogsByDoc] = useState<Record<string, LogLine[]>>({});
  const [openLogs, setOpenLogs] = useState<Record<string, boolean>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [topK, setTopK] = useState(6);
  const [asking, setAsking] = useState(false);
  const [expandedCitations, setExpandedCitations] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeCollection = collections.find((collection) => collection.id === activeScope) ?? null;

  const loadCollections = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/knowledge/collections`, {
        headers: authHeaders(),
      });
      if (!response.ok) {
        setError(await readError(response));
        return [];
      }
      const rows = (await response.json()) as KnowledgeBase[];
      setCollections(rows);
      setError(null);
      return rows;
    } catch {
      setError(`无法连接学习 API（${API_BASE}）。请确认 API 已启动。`);
      return [];
    }
  }, []);

  const loadDocuments = useCallback(async (scope: string) => {
    try {
      const query = scope === ALL_SCOPE ? '' : `?collectionId=${encodeURIComponent(scope)}`;
      const response = await fetch(`${API_BASE}/api/knowledge/documents${query}`, {
        headers: authHeaders(),
      });
      if (!response.ok) {
        setError(await readError(response));
        return;
      }
      setDocuments((await response.json()) as KbDocument[]);
    } catch {
      setError(`无法连接学习 API（${API_BASE}）。`);
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  const loadLogs = useCallback(async (documentId: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/knowledge/documents/${documentId}/logs`, {
        headers: authHeaders(),
      });
      if (!response.ok) return;
      const lines = (await response.json()) as LogLine[];
      setLogsByDoc((previous) => ({ ...previous, [documentId]: lines }));
    } catch {
      // keep the previously loaded log lines
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const rows = await loadCollections();
      const initialScope = rows.length > 0 ? rows[0].id : ALL_SCOPE;
      setActiveScope(initialScope);
      await loadDocuments(initialScope);
    })();
  }, [loadCollections, loadDocuments]);

  const hasPendingDocument = documents.some((doc) => IN_PROGRESS_STATUSES.includes(doc.status));

  useEffect(() => {
    if (!hasPendingDocument) return;
    const timer = window.setTimeout(async () => {
      await Promise.all([loadDocuments(activeScope), loadCollections()]);
      const openIds = Object.entries(openLogs)
        .filter(([, open]) => open)
        .map(([id]) => id);
      await Promise.all(openIds.map((id) => loadLogs(id)));
    }, POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [hasPendingDocument, documents, openLogs, activeScope, loadDocuments, loadCollections, loadLogs]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, asking]);

  const switchScope = async (scope: string) => {
    setActiveScope(scope);
    setLoadingDocs(true);
    await loadDocuments(scope);
  };

  const toggleLogs = async (documentId: string) => {
    const next = !openLogs[documentId];
    setOpenLogs((previous) => ({ ...previous, [documentId]: next }));
    if (next && !logsByDoc[documentId]) {
      await loadLogs(documentId);
    }
  };

  const handleCreateCollection = async () => {
    const name = window.prompt('新知识库名称（例如：雅思写作、六级词汇、专业课）');
    if (!name?.trim()) return;
    setError(null);
    const response = await fetch(`${API_BASE}/api/knowledge/collections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (!response.ok) {
      setError(await readError(response));
      return;
    }
    const created = (await response.json()) as KnowledgeBase;
    await loadCollections();
    await switchScope(created.id);
  };

  const handleRenameCollection = async (collection: KnowledgeBase) => {
    const name = window.prompt('重命名知识库', collection.name);
    if (!name?.trim() || name.trim() === collection.name) return;
    setError(null);
    const response = await fetch(`${API_BASE}/api/knowledge/collections/${collection.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (!response.ok) {
      setError(await readError(response));
      return;
    }
    await loadCollections();
  };

  const handleDeleteCollection = async (collection: KnowledgeBase) => {
    const hasDocuments = collection.documentCount > 0;
    const confirmed = window.confirm(
      hasDocuments
        ? `知识库「${collection.name}」中有 ${collection.documentCount} 篇资料，删除会连同资料和向量一起移除，是否继续？`
        : `删除空知识库「${collection.name}」？`,
    );
    if (!confirmed) return;
    setError(null);
    const response = await fetch(
      `${API_BASE}/api/knowledge/collections/${collection.id}${hasDocuments ? '?force=true' : ''}`,
      { method: 'DELETE', headers: authHeaders() },
    );
    if (!response.ok) {
      setError(await readError(response));
      return;
    }
    const rows = await loadCollections();
    const nextScope = rows.length > 0 ? rows[0].id : ALL_SCOPE;
    await switchScope(nextScope);
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const query = activeScope === ALL_SCOPE ? '' : `?collectionId=${encodeURIComponent(activeScope)}`;
      const response = await fetch(`${API_BASE}/api/knowledge/documents${query}`, {
        method: 'POST',
        headers: authHeaders(),
        body: form,
      });
      if (!response.ok) {
        setError(await readError(response));
        return;
      }
      const created = (await response.json()) as KbDocument;
      if (created.collectionId && activeScope !== created.collectionId) {
        setActiveScope(created.collectionId);
      }
      setOpenLogs((previous) => ({ ...previous, [created.id]: true }));
      await Promise.all([
        loadDocuments(created.collectionId ?? activeScope),
        loadCollections(),
        loadLogs(created.id),
      ]);
    } catch {
      setError(`上传失败：无法连接学习 API（${API_BASE}）。`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleAsk = async () => {
    const trimmed = question.trim();
    if (!trimmed || asking) return;

    setMessages((previous) => [...previous, { id: `u-${Date.now()}`, role: 'user', content: trimmed }]);
    setQuestion('');
    setAsking(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/knowledge/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          question: trimmed,
          topK,
          ...(activeScope === ALL_SCOPE ? {} : { collectionId: activeScope }),
        }),
      });
      if (!response.ok) {
        const message = await readError(response);
        setMessages((previous) => [
          ...previous,
          { id: `a-${Date.now()}`, role: 'assistant', content: message, failed: true },
        ]);
        return;
      }
      const payload = await response.json();
      setMessages((previous) => [
        ...previous,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: payload.answer ?? '',
          citations: payload.citations ?? [],
          notice: payload.notice ?? null,
        },
      ]);
    } catch {
      setMessages((previous) => [
        ...previous,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: `无法连接学习 API（${API_BASE}）。`,
          failed: true,
        },
      ]);
    } finally {
      setAsking(false);
    }
  };

  const handleDeleteDocument = async (documentId: string, title: string) => {
    if (!window.confirm(`删除《${title}》及其向量索引？`)) return;
    const response = await fetch(`${API_BASE}/api/knowledge/documents/${documentId}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (!response.ok) {
      setError(await readError(response));
      return;
    }
    await Promise.all([loadDocuments(activeScope), loadCollections()]);
  };

  const handleReindex = async (documentId: string, fromSource: boolean) => {
    setError(null);
    const response = await fetch(`${API_BASE}/api/knowledge/documents/${documentId}/reindex`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ fromSource }),
    });
    if (!response.ok) {
      setError(await readError(response));
    }
    await Promise.all([loadDocuments(activeScope), loadLogs(documentId)]);
  };

  const scopeLabel = activeCollection ? `知识库「${activeCollection.name}」` : '全部资料';
  const readyCount = activeCollection
    ? activeCollection.readyCount
    : collections.reduce((sum, item) => sum + item.readyCount, 0);

  return (
    <main className="mx-auto max-w-6xl px-3 py-6 sm:px-6 lg:px-8">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-gray-500">学习资料</p>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900">知识库问答</h1>
          <p className="mt-1 text-sm text-gray-500">
            按知识库分开管理资料，提问只检索当前知识库，回答附带引用序号。
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>
            {collections.length} 个知识库 · 当前范围 {scopeLabel} · 就绪 {readyCount} 篇
          </span>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:bg-gray-400"
          >
            {uploading ? '上传中…' : activeCollection ? `上传到「${activeCollection.name}」` : '上传资料'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.md,.markdown,.txt"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleUpload(file);
            }}
          />
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="flex min-h-[520px] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white lg:h-[calc(100vh-14rem)] lg:flex-row">
        <aside className="flex max-h-80 w-full shrink-0 flex-col border-b border-gray-100 lg:max-h-none lg:w-80 lg:border-b-0 lg:border-r">
          {/* 知识库列表 */}
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2.5">
            <span className="text-sm font-medium text-gray-700">知识库</span>
            <button
              type="button"
              onClick={() => void handleCreateCollection()}
              className="text-[11px] text-blue-600 hover:text-blue-700"
            >
              + 新建
            </button>
          </div>
          <div className="max-h-44 overflow-y-auto border-b border-gray-100">
            <button
              type="button"
              onClick={() => void switchScope(ALL_SCOPE)}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors ${
                activeScope === ALL_SCOPE ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <span>全部资料</span>
              <span className="text-gray-400">{collections.reduce((sum, item) => sum + item.documentCount, 0)} 篇</span>
            </button>
            {collections.map((collection) => (
              <div
                key={collection.id}
                className={`group flex items-center justify-between px-3 py-2 text-xs ${
                  activeScope === collection.id ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <button type="button" onClick={() => void switchScope(collection.id)} className="min-w-0 flex-1 truncate text-left">
                  {collection.name}
                  <span className="ml-1 text-gray-400">
                    {collection.documentCount} 篇 · {collection.chunkCount} 块
                  </span>
                </button>
                <span className="ml-2 flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    title="重命名"
                    onClick={() => void handleRenameCollection(collection)}
                    className="text-gray-400 hover:text-blue-600"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    title="删除知识库"
                    onClick={() => void handleDeleteCollection(collection)}
                    className="text-gray-400 hover:text-red-500"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              </div>
            ))}
          </div>

          {/* 资料列表 */}
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2.5">
            <span className="text-sm font-medium text-gray-700">资料与索引日志</span>
            <button
              type="button"
              onClick={() => void loadDocuments(activeScope)}
              className="text-[11px] text-blue-600 hover:text-blue-700"
            >
              刷新
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loadingDocs ? (
              <p className="px-3 py-6 text-center text-xs text-gray-400">加载中…</p>
            ) : documents.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-gray-400">
                {activeCollection
                  ? `「${activeCollection.name}」还没有资料，上传一份 PDF 或 Markdown`
                  : '还没有资料，先新建知识库并上传文件'}
              </p>
            ) : (
              documents.map((doc) => {
                const status = STATUS_LABELS[doc.status] ?? { label: doc.status, className: 'bg-gray-100 text-gray-600' };
                const logs = logsByDoc[doc.id] ?? [];
                return (
                  <div key={doc.id} className="border-b border-gray-50">
                    <div className="px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm text-gray-700">{doc.title}</span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${status.className}`}>{status.label}</span>
                      </div>
                      <p className="mt-1 truncate text-[10px] text-gray-400">
                        {doc.sourceFilename}
                        {doc.byteSize ? ` · ${formatBytes(doc.byteSize)}` : ''}
                        {doc.converter ? ` · ${CONVERTER_LABELS[doc.converter] ?? doc.converter}` : ''}
                        {doc.chunkCount ? ` · ${doc.chunkCount} 块` : ''}
                      </p>
                      {doc.status === 'failed' && doc.errorMessage && (
                        <p className="mt-1 text-[11px] leading-5 text-red-600">{doc.errorMessage}</p>
                      )}
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                        <button type="button" onClick={() => void toggleLogs(doc.id)} className="text-blue-600 hover:text-blue-700">
                          {openLogs[doc.id] ? '收起日志' : `日志${logs.length ? `（${logs.length}）` : ''}`}
                        </button>
                        {doc.status === 'failed' && doc.hasSource && (
                          <button type="button" onClick={() => void handleReindex(doc.id, true)} className="text-gray-600 hover:text-gray-900">
                            重新解析
                          </button>
                        )}
                        {(doc.status === 'failed' || doc.status === 'ready') && (
                          <button type="button" onClick={() => void handleReindex(doc.id, false)} className="text-gray-600 hover:text-gray-900">
                            重新索引
                          </button>
                        )}
                        <button type="button" onClick={() => void handleDeleteDocument(doc.id, doc.title)} className="text-red-500 hover:text-red-600">
                          删除
                        </button>
                      </div>
                    </div>

                    {openLogs[doc.id] && (
                      <div className="max-h-44 overflow-y-auto border-t border-gray-50 bg-gray-50/60 px-3 py-2 font-mono text-[11px] leading-5">
                        {logs.length === 0 ? (
                          <p className="text-gray-400">暂无日志</p>
                        ) : (
                          logs.map((line) => (
                            <div key={line.id} className={LEVEL_CLASSES[line.level] ?? 'text-gray-600'}>
                              <span className="text-gray-400">{formatTime(line.createdAt)} </span>
                              {line.message}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* 对话区 */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2.5">
            <span className="text-xs text-gray-500">
              检索范围：{scopeLabel} · 引用 {topK} 段
            </span>
            <div className="flex items-center gap-2">
              <select
                value={topK}
                onChange={(event) => setTopK(Number(event.target.value))}
                className="rounded-lg border border-gray-200 px-2 py-1 text-xs outline-none"
              >
                <option value={3}>引用 3 段</option>
                <option value={6}>引用 6 段</option>
                <option value={10}>引用 10 段</option>
              </select>
              <button
                type="button"
                onClick={() => setMessages([])}
                disabled={messages.length === 0}
                className="text-xs text-gray-500 hover:text-gray-700 disabled:text-gray-300"
              >
                清空对话
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-4">
            <div className="mx-auto max-w-3xl space-y-4">
              {messages.length === 0 && (
                <div className="py-14 text-center text-gray-400">
                  <p className="text-lg font-medium text-gray-300">知识库问答</p>
                  <p className="mt-2 text-sm">
                    {activeCollection
                      ? `当前只检索「${activeCollection.name}」，切换知识库可换范围`
                      : '当前检索全部资料，建议先建知识库按主题分开'}
                  </p>
                  <p className="mt-1 text-xs text-gray-300">
                    索引进度和报错可以在左侧每篇资料的「日志」里查看
                  </p>
                </div>
              )}

              {messages.map((message) => (
                <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[92%] rounded-xl px-4 py-3 sm:max-w-[85%] ${
                      message.role === 'user'
                        ? 'bg-gray-900 text-white'
                        : message.failed
                          ? 'border border-red-200 bg-red-50'
                          : 'border border-gray-100 bg-white'
                    }`}
                  >
                    {message.role === 'user' ? (
                      <p className="whitespace-pre-wrap text-sm">{message.content}</p>
                    ) : (
                      <>
                        {message.content ? (
                          <div
                            className={`prose prose-sm max-w-none break-words text-sm ${
                              message.failed
                                ? 'text-red-700'
                                : 'prose-headings:mt-3 prose-headings:mb-1 prose-headings:text-gray-900 prose-p:my-2 prose-p:leading-7 prose-li:my-0.5 prose-li:leading-7 prose-strong:text-gray-900 prose-code:rounded prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-pre:bg-gray-900 prose-table:text-xs'
                            }`}
                            dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
                          />
                        ) : null}
                        {message.notice && <p className="mt-2 text-xs text-gray-500">{message.notice}</p>}

                        {message.citations && message.citations.length > 0 && (
                          <div className="mt-3 border-t border-gray-100 pt-3">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedCitations((previous) => ({
                                  ...previous,
                                  [message.id]: !previous[message.id],
                                }))
                              }
                              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
                            >
                              <svg
                                className={`h-3 w-3 transition-transform ${expandedCitations[message.id] ? 'rotate-90' : ''}`}
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={2}
                                viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                              </svg>
                              引用资料
                              <span className="ml-1 rounded-full bg-green-50 px-1.5 py-0.5 text-[10px] text-green-600">
                                {message.citations.length} 段
                              </span>
                            </button>

                            {expandedCitations[message.id] && (
                              <div className="mt-2 max-h-80 space-y-2 overflow-y-auto">
                                {message.citations.map((citation) => (
                                  <div key={`${message.id}-${citation.index}`} className="rounded-lg bg-gray-50 p-2.5">
                                    <p className="text-[11px] text-gray-500">
                                      [{citation.index}] 《{citation.title}》
                                      {citation.heading ? ` · ${citation.heading}` : ''}
                                      {citation.page ? ` · 第 ${citation.page} 页` : ''}
                                      <span className="ml-2 text-gray-400">相似度 {citation.score.toFixed(3)}</span>
                                    </p>
                                    <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-gray-700">
                                      {stripMarkdownForDisplay(citation.snippet)}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}

              {asking && (
                <div className="flex justify-start">
                  <div className="rounded-xl border border-gray-100 bg-white px-4 py-3">
                    <div className="flex gap-1">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '0ms' }} />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '150ms' }} />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          <div className="border-t border-gray-100 bg-white px-3 py-3">
            <div className="mx-auto flex max-w-3xl gap-2">
              <input
                type="text"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void handleAsk();
                  }
                }}
                placeholder={readyCount > 0 ? `在${scopeLabel}中提问…` : '先上传并等待资料索引完成'}
                disabled={asking}
                className="flex-1 rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-gray-400 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => void handleAsk()}
                disabled={asking || question.trim().length === 0}
                className="rounded-xl bg-gray-900 px-4 py-3 text-sm text-white transition-colors hover:bg-gray-800 disabled:opacity-50 sm:px-6"
              >
                发送
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
