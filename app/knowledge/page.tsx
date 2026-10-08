'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:4000';
const API_TOKEN = process.env.NEXT_PUBLIC_API_ACCESS_TOKEN || '';
const POLL_INTERVAL_MS = 3000;
const IN_PROGRESS_STATUSES = ['pending', 'extracting', 'chunking', 'embedding'];

interface KbDocument {
  id: string;
  title: string;
  sourceFilename: string | null;
  status: string;
  errorMessage?: string | null;
  pageCount?: number | null;
  chunkCount: number;
  byteSize?: number | null;
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

interface AskResult {
  answer: string | null;
  citations: Citation[];
  notice: string | null;
  embedding?: { provider: string; model: string };
  llm?: { configured: boolean; model: string | null };
  retrieved?: number;
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  pending: { label: '排队中', className: 'bg-gray-100 text-gray-600' },
  extracting: { label: '解析中', className: 'bg-blue-50 text-blue-600' },
  chunking: { label: '分块中', className: 'bg-blue-50 text-blue-600' },
  embedding: { label: '向量化中', className: 'bg-blue-50 text-blue-600' },
  ready: { label: '就绪', className: 'bg-green-50 text-green-700' },
  failed: { label: '失败', className: 'bg-red-50 text-red-600' },
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

export default function KnowledgePage() {
  const [documents, setDocuments] = useState<KbDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDocuments = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/knowledge/documents`, {
        headers: authHeaders(),
      });
      if (!response.ok) {
        setError(await readError(response));
        return;
      }
      const payload = (await response.json()) as KbDocument[];
      setDocuments(payload);
      setError(null);
    } catch {
      setError(`无法连接学习 API（${API_BASE}）。请确认 API 已启动（npm run api:dev）。`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const hasPendingDocument = documents.some((doc) => IN_PROGRESS_STATUSES.includes(doc.status));

  useEffect(() => {
    if (!hasPendingDocument) {
      return;
    }
    const timer = window.setTimeout(loadDocuments, POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [hasPendingDocument, documents, loadDocuments]);

  const handleUpload = async (file: File) => {
    setUploading(true);
    setUploadMessage(null);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch(`${API_BASE}/api/knowledge/documents`, {
        method: 'POST',
        headers: authHeaders(),
        body: form,
      });
      if (!response.ok) {
        setError(await readError(response));
        return;
      }
      setUploadMessage(`已上传《${file.name}》，正在后台解析和向量化。`);
      await loadDocuments();
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
    setAsking(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/knowledge/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ question: trimmed, topK: 6 }),
      });
      if (!response.ok) {
        setError(await readError(response));
        return;
      }
      setResult((await response.json()) as AskResult);
    } catch {
      setError(`提问失败：无法连接学习 API（${API_BASE}）。`);
    } finally {
      setAsking(false);
    }
  };

  const handleDelete = async (id: string, title: string) => {
    if (!window.confirm(`删除《${title}》及其向量索引？`)) return;
    const response = await fetch(`${API_BASE}/api/knowledge/documents/${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (!response.ok) {
      setError(await readError(response));
      return;
    }
    await loadDocuments();
  };

  const handleReindex = async (id: string) => {
    setError(null);
    const response = await fetch(`${API_BASE}/api/knowledge/documents/${id}/reindex`, {
      method: 'POST',
      headers: authHeaders(),
    });
    if (!response.ok) {
      setError(await readError(response));
    }
    await loadDocuments();
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <p className="text-sm text-gray-500">学习资料</p>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900">知识库</h1>
        <p className="mt-2 text-sm text-gray-500">
          上传 PDF 或 Markdown 资料，系统会转换成 Markdown、切分并写入向量库，然后基于检索结果回答问题并标注出处。
        </p>
      </div>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="font-medium text-gray-900">上传资料</h2>
          <p className="mt-1 text-xs text-gray-500">支持 PDF、Markdown、纯文本，单文件默认不超过 30 MB。</p>
          <label className="mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center hover:border-blue-300 hover:bg-blue-50/40">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.md,.markdown,.txt"
              className="hidden"
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleUpload(file);
              }}
            />
            <span className="text-sm font-medium text-gray-700">
              {uploading ? '上传中…' : '点击选择文件'}
            </span>
            <span className="text-xs text-gray-500">扫描版 PDF 暂不支持（没有文本层，不做 OCR 猜测）</span>
          </label>
          {uploadMessage && <p className="mt-3 text-xs text-green-700">{uploadMessage}</p>}
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="font-medium text-gray-900">基于资料提问</h2>
          <p className="mt-1 text-xs text-gray-500">只依据知识库中已就绪的资料回答，回答会标注引用序号。</p>
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            rows={4}
            placeholder="例如：这份资料里讲解了哪些听力技巧？"
            className="mt-4 w-full resize-y rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 outline-none focus:border-blue-400"
          />
          <button
            type="button"
            onClick={() => void handleAsk()}
            disabled={asking || question.trim().length === 0}
            className="mt-3 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-400"
          >
            {asking ? '检索中…' : '提问'}
          </button>
        </div>
      </section>

      {error && (
        <p className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      {result && (
        <section className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="font-medium text-gray-900">回答</h2>
          {result.answer ? (
            <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-gray-800">{result.answer}</p>
          ) : (
            <p className="mt-3 text-sm text-gray-500">{result.notice || '没有得到回答。'}</p>
          )}

          {result.citations.length > 0 && (
            <div className="mt-5">
              <p className="text-xs font-medium text-gray-500">
                引用资料（{result.citations.length} 条）
              </p>
              <ol className="mt-3 space-y-3">
                {result.citations.map((citation) => (
                  <li key={`${citation.documentId}-${citation.ordinal}`} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <p className="text-xs text-gray-600">
                      [{citation.index}] 《{citation.title}》
                      {citation.heading ? ` · ${citation.heading}` : ''}
                      {citation.page ? ` · 第 ${citation.page} 页` : ''}
                      <span className="ml-2 text-gray-400">相似度 {citation.score.toFixed(3)}</span>
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{citation.snippet}</p>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <p className="mt-4 text-xs text-gray-400">
            嵌入模型：{result.embedding?.provider} / {result.embedding?.model}
            {' · '}
            LLM：{result.llm?.configured ? result.llm?.model : '未配置，仅返回检索结果'}
          </p>
        </section>
      )}

      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-gray-900">资料列表</h2>
          <button
            type="button"
            onClick={() => void loadDocuments()}
            className="text-xs text-blue-600 hover:text-blue-700"
          >
            刷新
          </button>
        </div>

        {loading ? (
          <p className="mt-4 text-sm text-gray-500">加载中…</p>
        ) : documents.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">还没有资料。上传一份 PDF 或 Markdown 开始构建知识库。</p>
        ) : (
          <ul className="mt-4 divide-y divide-gray-100">
            {documents.map((doc) => {
              const status = STATUS_LABELS[doc.status] ?? { label: doc.status, className: 'bg-gray-100 text-gray-600' };
              return (
                <li key={doc.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium text-gray-800">{doc.title}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${status.className}`}>{status.label}</span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      {doc.sourceFilename}
                      {doc.byteSize ? ` · ${formatBytes(doc.byteSize)}` : ''}
                      {doc.pageCount ? ` · ${doc.pageCount} 页` : ''}
                      {doc.chunkCount ? ` · ${doc.chunkCount} 个分块` : ''}
                      {` · ${new Date(doc.createdAt).toLocaleString('zh-CN')}`}
                    </p>
                    {doc.status === 'failed' && doc.errorMessage && (
                      <p className="mt-1 text-xs text-red-600">{doc.errorMessage}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {(doc.status === 'failed' || doc.status === 'ready') && (
                      <button
                        type="button"
                        onClick={() => void handleReindex(doc.id)}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                      >
                        重新索引
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleDelete(doc.id, doc.title)}
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
                    >
                      删除
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="mt-6 text-xs text-gray-400">
        知识库由独立学习 API 提供（当前地址 {API_BASE}），资料和向量仅保存在自建 PostgreSQL + pgvector 中。
      </p>
    </main>
  );
}
