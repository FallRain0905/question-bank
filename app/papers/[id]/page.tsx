'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import PaperCard, { Paper } from '@/components/PaperCard';
import { CardSkeleton } from '@/components/Skeleton';

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function PaperDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [paper, setPaper] = useState<Paper | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [related, setRelated] = useState<Paper[]>([]);
  const [kbs, setKbs] = useState<{ id: string; name: string }[]>([]);
  const [importKbId, setImportKbId] = useState<string>('');
  const [token, setToken] = useState('');
  const [importing, setImporting] = useState(false);

  const headers = useCallback(
    (): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {}),
    [token]
  );

  useEffect(() => {
    const init = async () => {
      const supabase = getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        setToken(session.access_token);
        const res = await fetch('/api/kb', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const list = await res.json();
          if (Array.isArray(list)) setKbs(list);
        }
      }
    };
    init();
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setNotFound(false);

    fetch(`/api/papers/${id}`, { headers: headers() })
      .then(async res => {
        if (res.status === 404) {
          setNotFound(true);
          return null;
        }
        return res.json();
      })
      .then(data => {
        if (data?.paper) {
          const p: Paper = data.paper;
          setPaper(p);
          loadRelated(p);
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);

  const loadRelated = async (p: Paper) => {
    try {
      const res = await fetch('/api/papers?page_size=8', { headers: headers() });
      const data = await res.json();
      const others: Paper[] = (data.papers || []).filter((x: Paper) => x.id !== p.id);

      // Rank by shared categories/keywords for a genuine "related" feel
      const set = new Set([...(p.categories || []), ...(p.keywords || [])]);
      const ranked = others
        .map(x => {
          const overlap = [...(x.categories || []), ...(x.keywords || [])].filter(v => set.has(v)).length;
          return { x, overlap };
        })
        .sort((a, b) => b.overlap - a.overlap)
        .map(r => r.x);

      setRelated(ranked.slice(0, 4));
    } catch {
      setRelated([]);
    }
  };

  const handleFavorite = async () => {
    if (!paper || !token) return;
    const favorited = !paper.is_favorited;
    try {
      await fetch('/api/papers/favorite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ paper_id: paper.id, action: favorited ? 'favorite' : 'unfavorite' }),
      });
      setPaper({ ...paper, is_favorited: favorited });
    } catch {
      /* ignore */
    }
  };

  const handleImport = async () => {
    if (!paper || !token) return;
    if (kbs.length === 0) {
      alert('请先创建知识库');
      return;
    }
    const kb = kbs.find(k => k.id === importKbId) || kbs[0];
    setImporting(true);
    try {
      const res = await fetch('/api/papers/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ paper_id: paper.id, kb_id: kb.id }),
      });
      const data = await res.json();
      if (data.success) alert(`已导入知识库「${kb.name}」`);
      else alert(`导入失败: ${data.error}`);
    } catch {
      alert('导入失败');
    } finally {
      setImporting(false);
    }
  };

  let points: string[] = [];
  if (paper?.summary_zh) {
    try {
      points = JSON.parse(paper.summary_zh);
    } catch {
      /* ignore */
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-4 sm:py-6">
        <CardSkeleton />
      </div>
    );
  }

  if (notFound || !paper) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <p className="text-gray-400 mb-4">论文不存在或已删除</p>
        <Link href="/papers" className="text-sm text-blue-500 hover:text-blue-600">
          ← 返回论文库
        </Link>
      </div>
    );
  }

  const mainCategory = paper.categories[0] || 'cs.AI';

  return (
    <div className="max-w-3xl mx-auto px-4 py-4 sm:py-6">
      {/* Back */}
      <button
        onClick={() => router.back()}
        className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 mb-4 transition-colors"
      >
        ← 返回
      </button>

      {/* Header card */}
      <div className="bg-white border border-gray-100 rounded-xl p-5 sm:p-6">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-gray-400 font-mono">ArXiv {mainCategory}</span>
          <span className="text-xs text-gray-400">{formatDate(paper.published_at)}</span>
        </div>

        <h1 className="text-xl sm:text-2xl font-bold text-slate-800 leading-snug mb-2">
          {paper.title_zh || paper.title_en}
        </h1>
        {paper.title_zh && (
          <p className="text-sm text-gray-500 leading-snug mb-4">{paper.title_en}</p>
        )}

        {/* Authors */}
        {paper.authors.length > 0 && (
          <div className="mb-4">
            <p className="text-xs text-gray-400 mb-1">作者</p>
            <p className="text-sm text-gray-600 leading-relaxed">{paper.authors.join(', ')}</p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <button
            onClick={handleImport}
            disabled={importing}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors disabled:opacity-50"
          >
            {importing ? '导入中…' : '导入知识库'}
          </button>
          <button
            onClick={handleFavorite}
            className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${
              paper.is_favorited
                ? 'text-yellow-600 border-yellow-300 bg-yellow-50'
                : 'text-gray-500 border-gray-200 hover:border-gray-300'
            }`}
          >
            {paper.is_favorited ? '★ 已收藏' : '☆ 收藏'}
          </button>
          <Link
            href="/graph"
            className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
          >
            相关论文图谱
          </Link>
        </div>

        {/* KB selector (shown only when importing makes sense) */}
        {kbs.length > 0 && (
          <div className="mb-5">
            <select
              value={importKbId}
              onChange={e => setImportKbId(e.target.value)}
              className="w-full sm:w-auto px-3 py-2 text-sm border border-blue-200 rounded-lg bg-blue-50 text-blue-700"
            >
              <option value="">导入到: {kbs[0].name}</option>
              {kbs.map(kb => (
                <option key={kb.id} value={kb.id}>{kb.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* AI Summary (full) */}
        {points.length > 0 && (
          <div className="bg-blue-50/60 border border-blue-100 rounded-lg p-4 mb-4">
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-xs font-medium text-blue-600">AI 总结</span>
            </div>
            <ul className="space-y-1.5">
              {points.map((point, idx) => (
                <li key={idx} className="text-sm text-slate-700 leading-relaxed flex gap-2">
                  <span className="text-blue-400 shrink-0">•</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* English abstract */}
        {paper.abstract_en && (
          <div className="mb-4">
            <p className="text-xs text-gray-400 mb-1.5">摘要</p>
            <p className="text-sm text-gray-600 leading-relaxed">{paper.abstract_en}</p>
          </div>
        )}

        {/* Keywords */}
        {paper.keywords.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {paper.keywords.map(kw => (
              <span key={kw} className="px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded-full">
                {kw}
              </span>
            ))}
          </div>
        )}

        {/* Metadata / links */}
        <div className="border-t border-gray-100 pt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <span className="text-gray-400 font-mono text-xs">arXiv ID: {paper.arxiv_id}</span>
          {paper.arxiv_url && (
            <a
              href={paper.arxiv_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:text-blue-600"
            >
              查看 arXiv 页面 ↗
            </a>
          )}
          {paper.pdf_url && (
            <a
              href={paper.pdf_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:text-blue-600"
            >
              原始 PDF ↗
            </a>
          )}
        </div>
      </div>

      {/* Related papers */}
      {related.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">相关论文推荐</h2>
          <div className="space-y-4">
            {related.map(p => (
              <PaperCard key={p.id} paper={p} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
