'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabase';

interface Paper {
  id: string;
  arxiv_id: string;
  title_en: string;
  title_zh: string | null;
  summary_zh: string | null;
  keywords: string[];
  arxiv_url: string | null;
  published_at: string;
}

type SearchMode = 'academic' | 'general' | 'both';
type SearchDepth = 'fast' | 'medium' | 'deep';

const SEARCH_MODES: { value: SearchMode; label: string }[] = [
  { value: 'academic', label: '学术搜索' },
  { value: 'general', label: '全网搜索' },
  { value: 'both', label: '综合搜索' },
];

const SEARCH_DEPTHS: { value: SearchDepth; label: string }[] = [
  { value: 'fast', label: '快速' },
  { value: 'medium', label: '中等' },
  { value: 'deep', label: '深度' },
];

const QUICK_ENTRIES = [
  {
    href: '/research',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 4.5l7.5 3.75-7.5 3.75-7.5-3.75 7.5-3.75z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12l7.5 3.75 7.5-3.75M3.75 15.75l7.5 3.75 7.5-3.75" />
      </svg>
    ),
    label: '深度研究',
    color: 'text-blue-600 bg-blue-50',
  },
  {
    href: '/search',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    ),
    label: '研究搜索',
    color: 'text-emerald-600 bg-emerald-50',
  },
  {
    href: '/kb',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    ),
    label: '知识库',
    color: 'text-cyan-600 bg-cyan-50',
  },
  {
    href: '/qa',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 9.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm3.75 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm3.75 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12c0 4.418-4.03 8-9 8a9.77 9.77 0 01-3.64-.68L3 21l1.68-4.48A7.39 7.39 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    ),
    label: '知识问答',
    color: 'text-rose-600 bg-rose-50',
  },
  {
    href: '/reader',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
      </svg>
    ),
    label: 'AI 阅读',
    color: 'text-violet-600 bg-violet-50',
  },
  {
    href: '/papers',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
      </svg>
    ),
    label: '论文库',
    color: 'text-amber-600 bg-amber-50',
  },
];

export default function HomePage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>('both');
  const [searchDepth, setSearchDepth] = useState<SearchDepth>('medium');
  const [focused, setFocused] = useState(false);
  const [popularTags, setPopularTags] = useState<string[]>([]);
  const [recentPapers, setRecentPapers] = useState<Paper[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const supabase = getSupabase();
    const [tagsResult, papersResult] = await Promise.all([
      supabase.from('tags').select('name').order('name'),
      fetch('/api/papers?page=1&page_size=6').then(r => r.json()).catch(() => ({ papers: [] })),
    ]);
    if (tagsResult.data) {
      setPopularTags(tagsResult.data.map((t: any) => t.name).slice(0, 10));
    }
    setRecentPapers(papersResult.papers || []);
    setLoading(false);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/search?q=${encodeURIComponent(searchQuery.trim())}&mode=${searchMode}&depth=${searchDepth}`);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 sm:py-12">
      {/* Search */}
      <form onSubmit={handleSearch} className="mb-8">
        <div
          className={`flex items-center gap-0 border rounded-xl transition-all duration-200 bg-white ${
            focused
              ? 'border-blue-500 ring-1 ring-blue-500 shadow-sm'
              : 'border-gray-200'
          }`}
        >
          <svg
            className="w-5 h-5 ml-4 text-gray-400 shrink-0"
            fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="AI 研究搜索..."
            className="flex-1 px-3 py-3 text-sm text-gray-900 placeholder-gray-400 bg-transparent border-0 outline-none focus:shadow-none focus:ring-0 focus:outline-none"
          />
          <button
            type="submit"
            className="mr-1.5 px-4 py-1.5 my-1 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-800 transition-colors"
          >
            搜索
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {SEARCH_MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              onClick={() => setSearchMode(mode.value)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                searchMode === mode.value
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-800'
              }`}
            >
              <span className={`h-3 w-3 rounded border ${
                searchMode === mode.value ? 'border-white bg-white' : 'border-gray-300'
              }`}>
                {searchMode === mode.value && (
                  <span className="block h-full w-full rounded-[2px] bg-gray-900 scale-50" />
                )}
              </span>
              {mode.label}
            </button>
          ))}
        </div>

        <div className="mt-2 flex flex-wrap gap-2">
          {SEARCH_DEPTHS.map((depth) => (
            <button
              key={depth.value}
              type="button"
              onClick={() => setSearchDepth(depth.value)}
              className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                searchDepth === depth.value
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-800'
              }`}
            >
              {depth.label}
            </button>
          ))}
        </div>

        {/* Hot tags */}
        {popularTags.length > 0 && (
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <span className="text-xs text-gray-400 shrink-0">热门:</span>
            {popularTags.slice(0, 8).map((tag) => (
              <button
                key={tag}
                onClick={() => router.push(`/search?tag=${encodeURIComponent(tag)}`)}
                className="px-2.5 py-0.5 text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-full hover:border-gray-200 hover:text-gray-700 transition-colors"
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </form>

      {/* Quick entries */}
      <div className="grid grid-cols-4 gap-3 mb-8">
        {QUICK_ENTRIES.map((entry) => (
          <Link
            key={entry.href}
            href={entry.href}
            className="flex flex-col items-center gap-2 p-4 rounded-xl bg-white border border-gray-100 hover:border-gray-200 hover:shadow-sm transition-all group"
          >
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${entry.color}`}>
              {entry.icon}
            </div>
            <span className="text-xs font-medium text-gray-600 group-hover:text-gray-900 transition-colors">
              {entry.label}
            </span>
          </Link>
        ))}
      </div>

      {/* Recent papers */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-gray-700">最新论文推送</h2>
          <Link href="/papers" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
            查看全部 →
          </Link>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
                <div className="h-4 bg-gray-100 rounded w-3/4 mb-2" />
                <div className="h-3 bg-gray-50 rounded w-1/2 mb-2" />
                <div className="h-3 bg-gray-50 rounded w-full" />
              </div>
            ))}
          </div>
        ) : recentPapers.length > 0 ? (
          <div className="space-y-3">
            {recentPapers.map(paper => {
              let points: string[] = [];
              try { points = paper.summary_zh ? JSON.parse(paper.summary_zh) : []; } catch {}
              return (
                <Link
                  key={paper.id}
                  href={paper.arxiv_url || '#'}
                  target="_blank"
                  className="block bg-white rounded-xl border border-gray-100 p-4 hover:border-blue-200 transition-all group"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs text-gray-400 font-mono">ArXiv</span>
                    <span className="text-xs text-gray-300">
                      {new Date(paper.published_at).toLocaleDateString('zh-CN')}
                    </span>
                  </div>
                  <h3 className="text-sm font-medium text-slate-800 line-clamp-1 group-hover:text-blue-600 transition-colors">
                    {paper.title_zh || paper.title_en}
                  </h3>
                  {paper.title_zh && (
                    <p className="text-xs text-gray-400 line-clamp-1 mt-0.5">{paper.title_en}</p>
                  )}
                  {points.length > 0 && (
                    <p className="text-xs text-gray-500 line-clamp-2 mt-2">
                      {points[0]}
                    </p>
                  )}
                  <div className="flex gap-1.5 mt-2">
                    {paper.keywords.slice(0, 3).map(kw => (
                      <span key={kw} className="px-1.5 py-0.5 text-xs bg-gray-50 text-gray-400 rounded">
                        {kw}
                      </span>
                    ))}
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8 text-sm text-gray-400 bg-white rounded-xl border border-gray-100">
            暂无论文推送数据
          </div>
        )}
      </div>
    </div>
  );
}
