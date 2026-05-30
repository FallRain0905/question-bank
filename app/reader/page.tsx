'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import type { KBDocument, KnowledgeBase } from '@/types';

type ImportMode = 'upload' | 'kb';

export default function ReaderEntryPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<ImportMode>('upload');
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [documents, setDocuments] = useState<KBDocument[]>([]);
  const [selectedDocId, setSelectedDocId] = useState('');
  const [targetKbId, setTargetKbId] = useState('');
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push('/login');
      return;
    }

    const [{ data: kbs }, { data: docs }] = await Promise.all([
      supabase
        .from('knowledge_bases')
        .select('id,user_id,name,description,created_at,updated_at')
        .order('created_at', { ascending: false }),
      supabase
        .from('kb_documents')
        .select('id,kb_id,user_id,title,file_url,file_name,file_type,file_size,status,created_at,updated_at')
        .order('created_at', { ascending: false }),
    ]);

    setKnowledgeBases((kbs || []) as KnowledgeBase[]);
    setDocuments((docs || []) as KBDocument[]);
    setSelectedDocId((docs || [])[0]?.id || '');
    setTargetKbId((kbs || [])[0]?.id || '');
    setLoading(false);
  };

  const selectedDoc = useMemo(
    () => documents.find(doc => doc.id === selectedDocId),
    [documents, selectedDocId]
  );

  const groupedDocuments = useMemo(() => {
    return documents.map((doc) => {
      const kb = knowledgeBases.find(item => item.id === doc.kb_id);
      return {
        ...doc,
        kbName: kb?.name || 'Knowledge base',
      };
    });
  }, [documents, knowledgeBases]);

  const handleUpload = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file || uploading) return;

    setUploading(true);
    setError('');

    try {
      const supabase = getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      const formData = new FormData();
      formData.append('file', file);
      if (targetKbId) formData.append('kb_id', targetKbId);

      const res = await fetch('/api/reader/import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      router.push(`/reader/${data.document.id}`);
    } catch (err: any) {
      setError(err.message || 'Import failed');
      setUploading(false);
    }
  };

  if (loading) {
    return <div className="mx-auto max-w-5xl px-4 py-10 text-center text-gray-400">加载中...</div>;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:py-10">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">AI 阅读</h1>
          <p className="mt-1 text-sm text-gray-500">直接导入论文或从知识库选择文档，进入三栏研究阅读工作台。</p>
        </div>
        <Link href="/kb" className="text-sm text-gray-500 hover:text-gray-900">
          管理知识库
        </Link>
      </div>

      <div className="mb-5 inline-flex rounded-lg border border-gray-200 bg-white p-1">
        <button
          type="button"
          onClick={() => setMode('upload')}
          className={`rounded-md px-4 py-2 text-sm transition-colors ${mode === 'upload' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
        >
          直接导入
        </button>
        <button
          type="button"
          onClick={() => setMode('kb')}
          className={`rounded-md px-4 py-2 text-sm transition-colors ${mode === 'kb' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
        >
          从知识库选择
        </button>
      </div>

      {mode === 'upload' ? (
        <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-xl border border-gray-100 bg-white p-5 sm:p-6">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.md,.markdown,.docx,.txt"
              className="hidden"
              onChange={(e) => setFileName(e.target.files?.[0]?.name || '')}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex min-h-48 w-full flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 text-center transition-colors hover:bg-gray-100"
            >
              <svg className="mb-3 h-8 w-8 text-gray-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0 4 4m-4-4-4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
              </svg>
              <span className="text-sm font-medium text-gray-800">{fileName || '选择 PDF / Markdown / DOCX / TXT'}</span>
              <span className="mt-1 text-xs text-gray-400">PDF 会优先作为原文预览；若解析失败仍可阅读原 PDF。</span>
            </button>

            <div className="mt-4">
              <label className="mb-1 block text-xs font-medium text-gray-500">保存到知识库</label>
              <select
                value={targetKbId}
                onChange={(e) => setTargetKbId(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400"
              >
                <option value="">AI Reading（自动创建）</option>
                {knowledgeBases.map(kb => (
                  <option key={kb.id} value={kb.id}>{kb.name}</option>
                ))}
              </select>
            </div>

            {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
            <button
              type="button"
              onClick={handleUpload}
              disabled={!fileName || uploading}
              className="mt-4 w-full rounded-lg bg-gray-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
            >
              {uploading ? '导入中...' : '导入并开始阅读'}
            </button>
          </div>

          <div className="rounded-xl border border-gray-100 bg-white p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-gray-900">当前入口做了什么</h2>
            <div className="mt-4 space-y-3 text-sm text-gray-500">
              <p>上传后的文档会保存为私有知识库文档，然后直接跳到阅读工作台。</p>
              <p>PDF 不再强依赖知识库解析成功；有原文件链接就可以进入 PDF 预览。</p>
              <p>Markdown/DOCX/TXT 会生成可选中文本，方便翻译、解释、总结和保存随手笔记。</p>
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-xl border border-gray-100 bg-white p-5 sm:p-6">
          {documents.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm text-gray-400">还没有可阅读的知识库文档。</p>
              <button
                type="button"
                onClick={() => setMode('upload')}
                className="mt-3 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800"
              >
                先导入一份文档
              </button>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">选择文档</label>
                <select
                  value={selectedDocId}
                  onChange={(e) => setSelectedDocId(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400"
                >
                  {groupedDocuments.map(doc => (
                    <option key={doc.id} value={doc.id}>
                      {doc.kbName} / {doc.title}
                    </option>
                  ))}
                </select>
                {selectedDoc && (
                  <p className="mt-2 text-xs text-gray-400">
                    {selectedDoc.file_type?.toUpperCase() || 'DOC'} · {selectedDoc.file_name || selectedDoc.title}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => selectedDocId && router.push(`/reader/${selectedDocId}`)}
                disabled={!selectedDocId}
                className="rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
              >
                进入 AI 阅读
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
