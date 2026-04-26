'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabase';
import type { KnowledgeBase } from '@/types';

export default function KnowledgeBaseListPage() {
  const router = useRouter();
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const init = async () => {
      const supabase = getSupabase();
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) { router.push('/login'); return; }
      loadKBs();
    };
    init();
  }, []);

  const loadKBs = async () => {
    const supabase = getSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return;

    const res = await fetch('/api/kb', { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      setKbs(await res.json());
    }
    setLoading(false);
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    const supabase = getSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return;

    const res = await fetch('/api/kb', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, description: desc }),
    });
    if (res.ok) {
      setShowCreate(false);
      setName('');
      setDesc('');
      loadKBs();
    } else {
      alert('创建失败');
    }
    setCreating(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此知识库？所有文档将被删除。')) return;
    const supabase = getSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    await fetch(`/api/kb/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    loadKBs();
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 sm:py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">知识库</h1>
          <p className="text-sm text-gray-500 mt-1">上传文档，AI 解析，智能出题</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 transition-colors"
        >
          新建知识库
        </button>
      </div>

      {showCreate && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">新建知识库</h2>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="知识库名称"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-gray-400 mb-3"
          />
          <input
            type="text"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="描述（可选）"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-gray-400 mb-4"
          />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">取消</button>
            <button onClick={handleCreate} disabled={creating} className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 disabled:opacity-50">
              {creating ? '创建中...' : '创建'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-400">加载中...</div>
      ) : kbs.length === 0 ? (
        <div className="text-center py-12 bg-white border border-gray-100 rounded-xl">
          <p className="text-gray-400 mb-2">还没有知识库</p>
          <button onClick={() => setShowCreate(true)} className="text-blue-600 text-sm hover:text-blue-700">创建第一个</button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {kbs.map((kb) => (
            <div key={kb.id} className="bg-white border border-gray-100 rounded-xl p-5 hover:border-gray-200 hover:shadow-sm transition-all group">
              <div className="flex items-start justify-between">
                <Link href={`/kb/${kb.id}`} className="flex-1 min-w-0">
                  <h3 className="font-medium text-gray-900 truncate group-hover:text-blue-600 transition-colors">{kb.name}</h3>
                  {kb.description && <p className="text-sm text-gray-500 mt-1 line-clamp-2">{kb.description}</p>}
                  <p className="text-xs text-gray-400 mt-2">{kb.document_count ?? 0} 个文档</p>
                </Link>
                <button
                  onClick={(e) => { e.preventDefault(); handleDelete(kb.id); }}
                  className="text-gray-300 hover:text-red-500 transition-colors ml-2 shrink-0"
                >
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
