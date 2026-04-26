'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabase';
import type { QuestionWithTags } from '@/types';

const QUICK_ENTRIES = [
  {
    href: '/search',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    ),
    label: '题库',
    color: 'text-blue-600 bg-blue-50',
  },
  {
    href: '/notes',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
    label: '笔记',
    color: 'text-emerald-600 bg-emerald-50',
  },
  {
    href: '/classes',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
      </svg>
    ),
    label: '班级',
    color: 'text-violet-600 bg-violet-50',
  },
  {
    href: '/ai',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
    label: 'AI',
    color: 'text-amber-600 bg-amber-50',
  },
];

export default function HomePage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [popularTags, setPopularTags] = useState<string[]>([]);
  const [recentQuestions, setRecentQuestions] = useState<QuestionWithTags[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const supabase = getSupabase();
    const [tagsResult, questionsResult] = await Promise.all([
      supabase.from('tags').select('name').order('name'),
      supabase
        .from('questions')
        .select('*, tags(id, name)')
        .eq('status', 'approved')
        .order('created_at', { ascending: false })
        .limit(8),
    ]);
    if (tagsResult.data) {
      setPopularTags(tagsResult.data.map((t) => t.name).slice(0, 10));
    }
    if (questionsResult.data) {
      setRecentQuestions(questionsResult.data as QuestionWithTags[]);
    }
    setLoading(false);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
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
            placeholder="搜索题目、笔记..."
            className="flex-1 px-3 py-3 text-sm text-gray-900 placeholder-gray-400 bg-transparent border-0 outline-none"
          />
          <button
            type="submit"
            className="mr-1.5 px-4 py-1.5 my-1 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-800 transition-colors"
          >
            搜索
          </button>
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

      {/* Recent questions */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-gray-700">最近更新</h2>
          <Link href="/search" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
            查看全部 →
          </Link>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
                <div className="h-4 bg-gray-100 rounded w-3/4 mb-2" />
                <div className="h-3 bg-gray-50 rounded w-full mb-3" />
                <div className="flex gap-2">
                  <div className="h-5 bg-gray-50 rounded-full w-12" />
                  <div className="h-5 bg-gray-50 rounded-full w-16" />
                </div>
              </div>
            ))}
          </div>
        ) : recentQuestions.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {recentQuestions.map((q) => (
              <Link
                key={q.id}
                href={`/questions/${q.id}`}
                className="bg-white rounded-xl border border-gray-100 p-4 hover:border-gray-200 hover:shadow-sm transition-all group"
              >
                <p className="text-sm text-gray-700 line-clamp-2 mb-3 group-hover:text-gray-900 transition-colors">
                  {q.question_text || '（图片题目）'}
                </p>
                <div className="flex items-center justify-between">
                  <div className="flex gap-1.5 flex-wrap">
                    {q.tags?.slice(0, 3).map((tag) => (
                      <span key={tag.id} className="px-2 py-0.5 bg-gray-50 text-gray-500 rounded-full text-xs">
                        {tag.name}
                      </span>
                    ))}
                  </div>
                  <span className="text-xs text-gray-300">
                    {new Date(q.created_at).toLocaleDateString('zh-CN')}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-sm text-gray-400 bg-white rounded-xl border border-gray-100">
            还没有题目，成为第一个
            <Link href="/upload" className="text-blue-600 hover:text-blue-700 ml-1 font-medium">
              上传题目
            </Link>
            的人吧
          </div>
        )}
      </div>
    </div>
  );
}
