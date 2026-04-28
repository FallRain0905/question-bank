'use client';

import { useState, useEffect } from 'react';
import { getSupabase } from '@/lib/supabase';
import PaperCard, { Paper } from '@/components/PaperCard';

export default function PapersPage() {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [date, setDate] = useState<string>('');
  const [keyword, setKeyword] = useState<string>('');
  const [token, setToken] = useState('');
  const [kbs, setKbs] = useState<{ id: string; name: string }[]>([]);
  const [importKbId, setImportKbId] = useState<string>('');

  useEffect(() => {
    const init = async () => {
      const supabase = getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        setToken(session.access_token);
        // Load knowledge bases for import
        const res = await fetch('/api/kb', { headers: { Authorization: `Bearer ${session.access_token}` } });
        if (res.ok) setKbs(await res.json());
      }
    };
    init();
  }, []);

  useEffect(() => {
    loadPapers();
  }, [token, page, date, keyword]);

  const loadPapers = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: '20' });
      if (date) params.set('date', date);
      if (keyword) params.set('keyword', keyword);

      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(`/api/papers?${params}`, { headers });
      const data = await res.json();
      setPapers(data.papers || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error('Failed to load papers:', err);
    }
    setLoading(false);
  };

  const handleFavorite = async (paperId: string, favorited: boolean) => {
    if (!token) return;
    try {
      await fetch('/api/papers/favorite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ paper_id: paperId, action: favorited ? 'favorite' : 'unfavorite' }),
      });
      setPapers(prev => prev.map(p => p.id === paperId ? { ...p, is_favorited: favorited } : p));
    } catch (err) {
      console.error('Favorite failed:', err);
    }
  };

  const handleImport = async (paper: Paper) => {
    if (!token || kbs.length === 0) {
      alert('请先创建知识库');
      return;
    }
    const kbId = importKbId || kbs[0].id;
    const kb = kbs.find(k => k.id === kbId) || kbs[0];
    try {
      const res = await fetch('/api/papers/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ paper_id: paper.id, kb_id: kb.id }),
      });
      const data = await res.json();
      if (data.success) {
        alert(`已导入知识库「${kb.name}」`);
      } else {
        alert(`导入失败: ${data.error}`);
      }
    } catch (err) {
      alert('导入失败');
    }
  };

  const totalPages = Math.ceil(total / 20);

  // Today's date for header
  const today = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">论文推送</h1>
          <p className="text-sm text-gray-400 mt-1">{today} · {total} 篇精选论文</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input
          type="date"
          value={date}
          onChange={e => { setDate(e.target.value); setPage(1); }}
          className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white"
        />
        <select
          value={keyword}
          onChange={e => { setKeyword(e.target.value); setPage(1); }}
          className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white"
        >
          <option value="">全部关键词</option>
          <option value="RAG">RAG</option>
          <option value="Knowledge Graph">Knowledge Graph</option>
          <option value="LLM">LLM</option>
          <option value="Agent">Agent</option>
          <option value="Reasoning">Reasoning</option>
          <option value="Embedding">Embedding</option>
        </select>
        {kbs.length > 0 && (
          <select
            value={importKbId}
            onChange={e => setImportKbId(e.target.value)}
            className="px-3 py-1.5 text-sm border border-blue-200 rounded-lg bg-blue-50 text-blue-700"
          >
            <option value="">导入到: {kbs[0].name}</option>
            {kbs.map(kb => (
              <option key={kb.id} value={kb.id}>{kb.name}</option>
            ))}
          </select>
        )}
        {(date || keyword) && (
          <button
            onClick={() => { setDate(''); setKeyword(''); setPage(1); }}
            className="text-xs text-gray-400 hover:text-gray-600"
          >清除筛选</button>
        )}
      </div>

      {/* Paper list */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white border border-gray-100 rounded-xl p-5 animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-1/4 mb-3" />
              <div className="h-6 bg-gray-100 rounded w-3/4 mb-2" />
              <div className="h-4 bg-gray-100 rounded w-1/2 mb-4" />
              <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                <div className="h-3 bg-gray-100 rounded" />
                <div className="h-3 bg-gray-100 rounded w-5/6" />
                <div className="h-3 bg-gray-100 rounded w-4/6" />
              </div>
            </div>
          ))}
        </div>
      ) : papers.length === 0 ? (
        <div className="text-center py-16 bg-white border border-gray-100 rounded-xl">
          <p className="text-gray-400 mb-2">暂无论文数据</p>
          <p className="text-xs text-gray-300">每日自动从 arXiv 抓取精选论文</p>
        </div>
      ) : (
        <div className="space-y-4">
          {papers.map(paper => (
            <PaperCard
              key={paper.id}
              paper={paper}
              onFavorite={handleFavorite}
              onImport={kbs.length > 0 ? handleImport : undefined}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-6">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-4 py-2 text-sm border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-gray-50"
          >上一页</button>
          <span className="text-sm text-gray-400">{page} / {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-4 py-2 text-sm border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-gray-50"
          >下一页</button>
        </div>
      )}

    </div>
  );
}
