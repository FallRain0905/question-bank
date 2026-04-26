'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabase';
import type { KBDocument } from '@/types';

export default function KnowledgeBaseDetailPage() {
  const router = useRouter();
  const params = useParams();
  const kbId = params.id as string;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [docs, setDocs] = useState<KBDocument[]>([]);
  const [kbName, setKbName] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const userIdRef = useRef<string | null>(null);

  useEffect(() => {
    const init = async () => {
      const supabase = getSupabase();
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) { router.push('/login'); return; }
      userIdRef.current = u.id;
      loadDocs(u.id);
    };
    init();
  }, [kbId]);

  const loadDocs = async (uid?: string) => {
    const currentUserId = uid || userIdRef.current;
    if (!currentUserId) return;
    const supabase = getSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return;

    const res = await fetch('/api/kb', { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      const kbs = await res.json();
      const kb = kbs.find((k: any) => k.id === kbId);
      if (kb) setKbName(kb.name);
    }

    const { data, error } = await supabase
      .from('kb_documents')
      .select('*')
      .eq('kb_id', kbId)
      .eq('user_id', currentUserId)
      .order('created_at', { ascending: false });

    if (!error && data) setDocs(data as KBDocument[]);
    setLoading(false);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const supabase = getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const form = new FormData();
      form.append('file', file);

      const res = await fetch(`/api/kb/${kbId}/documents`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      if (res.ok) {
        loadDocs(userIdRef.current || undefined);
      } else {
        const err = await res.json();
        alert(err.error || '上传失败');
      }
    } catch {
      alert('上传失败');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (docId: string) => {
    if (!confirm('确定删除此文档？')) return;
    const supabase = getSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    await fetch(`/api/kb/documents/${docId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    setDocs(docs.filter((d) => d.id !== docId));
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 sm:py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <Link href="/kb" className="text-sm text-gray-400 hover:text-gray-600 transition-colors mb-1 inline-block">← 知识库</Link>
          <h1 className="text-2xl font-bold text-gray-900">{kbName || '加载中...'}</h1>
        </div>
        <div>
          <input ref={fileInputRef} type="file" accept=".pdf,.docx,.md,.txt" onChange={handleUpload} className="hidden" />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            {uploading ? '上传中...' : '上传文档'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">加载中...</div>
      ) : docs.length === 0 ? (
        <div className="text-center py-16 bg-white border border-gray-100 rounded-xl">
          <p className="text-gray-400 mb-2">还没有文档</p>
          <p className="text-xs text-gray-300">支持 PDF、DOCX、Markdown、TXT</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {docs.map((doc) => (
            <div key={doc.id} className="bg-white border border-gray-100 rounded-xl p-4 hover:border-gray-200 hover:shadow-sm transition-all flex items-center justify-between">
              <Link href={`/kb/${kbId}/doc/${doc.id}`} className="flex-1 min-w-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500 text-xs font-medium uppercase">
                    {doc.file_type || 'md'}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-medium text-gray-900 truncate">{doc.title}</h3>
                    <p className="text-xs text-gray-400">
                      {doc.content_md ? `${doc.content_md.length} 字符` : ''}
                      {doc.file_size ? ` · ${(doc.file_size / 1024).toFixed(1)} KB` : ''}
                    </p>
                  </div>
                </div>
              </Link>
              <div className="flex items-center gap-2 ml-3">
                <Link href={`/generator?doc=${doc.id}`} className="text-xs text-blue-600 hover:text-blue-700 px-2 py-1">出题</Link>
                <button onClick={() => handleDelete(doc.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
