'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabase';
import { renderMarkdown } from '@/lib/render-markdown';
import type { PlannedResearchQuery, ResearchSource } from '@/types';

type Stage = 'idle' | 'planning' | 'searching' | 'generating' | 'done' | 'error';
type SearchMode = 'academic' | 'general' | 'both';
type SearchDepth = 'fast' | 'medium' | 'deep';

const SEARCH_MODES: { value: SearchMode; label: string; hint: string; color: string }[] = [
  { value: 'academic', label: '学术搜索', hint: 'Semantic Scholar', color: 'text-purple-600 bg-purple-50 hover:bg-purple-100' },
  { value: 'general', label: '全网搜索', hint: 'Tavily', color: 'text-green-600 bg-green-50 hover:bg-green-100' },
  { value: 'both', label: '综合搜索', hint: '两者都搜索', color: 'text-blue-600 bg-blue-50 hover:bg-blue-100' },
];

const SEARCH_DEPTHS: { value: SearchDepth; label: string; hint: string }[] = [
  { value: 'fast', label: '快速', hint: '2 个视角' },
  { value: 'medium', label: '中等', hint: '4 个视角，默认' },
  { value: 'deep', label: '深度', hint: '6 个视角，更多正文读取' },
];

const PROVIDER_LABELS: Record<string, string> = {
  tavily: 'Tavily',
  crawled_web: '正文读取',
  semantic_scholar: 'Semantic Scholar',
  semantic_scholar_recommendation: 'Scholar 推荐',
  openalex: 'OpenAlex',
  arxiv: 'arXiv',
  local_papers: '本地论文',
  github: 'GitHub',
  local_kb: '本地知识库',
};

export default function ResearchSearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState('');
  const [summary, setSummary] = useState('');
  const [sources, setSources] = useState<ResearchSource[]>([]);
  const [plannedQueries, setPlannedQueries] = useState<PlannedResearchQuery[]>([]);
  const [stage, setStage] = useState<Stage>('idle');
  const [resultMode, setResultMode] = useState<SearchMode>('both');
  const [resultDepth, setResultDepth] = useState<SearchDepth>('medium');
  const [searchMode, setSearchMode] = useState<SearchMode>('both');
  const [searchDepth, setSearchDepth] = useState<SearchDepth>('medium');
  const inputRef = useRef<HTMLInputElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = searchParams.get('q');
    const m = searchParams.get('mode') as SearchMode | null;
    const d = searchParams.get('depth') as SearchDepth | null;
    if (q) {
      setQuery(q);
      const nextMode = m && ['academic', 'general', 'both'].includes(m) ? m : 'both';
      const nextDepth = d && ['fast', 'medium', 'deep'].includes(d) ? d : 'medium';
      setSearchMode(nextMode);
      setSearchDepth(nextDepth);
      performSearch(q, nextMode, nextDepth);
    }
  }, [searchParams]);

  const performSearch = useCallback(async (q: string, mode?: SearchMode, depth?: SearchDepth) => {
    setStage('planning');
    setSummary('');
    setSources([]);
    setPlannedQueries([]);
    setResultMode(mode || searchMode);
    setResultDepth(depth || searchDepth);

    const effectiveMode = mode || searchMode;
    const effectiveDepth = depth || searchDepth;

    const supabase = getSupabase();
    const { data: { session } } = await supabase.auth.getSession();

    try {
      const res = await fetch('/api/research-search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ query: q, mode: effectiveMode, depth: effectiveDepth }),
      });

      if (!res.ok) {
        const err = await res.json();
        setStage('error');
        setSummary(err.error || '搜索失败');
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const lines = part.split('\n');
          let eventType = '';
          let dataStr = '';

          for (const line of lines) {
            if (line.startsWith('event: ')) eventType = line.slice(7);
            if (line.startsWith('data: ')) dataStr = line.slice(6);
          }

          if (!dataStr) continue;

          try {
            const data = JSON.parse(dataStr);

            if (eventType === 'status') {
              setStage(data.stage as Stage);
            } else if (eventType === 'plannedQueries') {
              setPlannedQueries(data.plannedQueries || []);
            } else if (eventType === 'source' && data.source) {
              setSources(prev => prev.some(source => source.id === data.source.id) ? prev : [...prev, data.source]);
            } else if (eventType === 'token') {
              setSummary(prev => prev + data.content);
            } else if (eventType === 'done') {
              setSources(data.sources || []);
              if (data.plannedQueries) setPlannedQueries(data.plannedQueries);
              setResultMode(data.mode || effectiveMode);
              setResultDepth(data.depth || effectiveDepth);
              setStage('done');
              if (data.summary) {
                setSummary(data.summary);
              }
            }
          } catch { /* skip */ }
        }
      }
    } catch (err: any) {
      setStage('error');
      setSummary(err.message || '网络错误');
    }
  }, [searchDepth, searchMode]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    router.push(`/search?q=${encodeURIComponent(q)}&mode=${searchMode}&depth=${searchDepth}`);
  };

  const stageLabel: Record<string, string> = {
    planning: '规划检索视角...',
    searching: '搜索相关来源...',
    generating: '生成总结...',
  };

  const sourceHost = (url: string) => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  };

  // Replace [1], [2] with clickable badges in summary HTML
  const renderSummaryHtml = (md: string) => {
    const html = renderMarkdown(md);
    return html.replace(
      /\[(\d+)\]/g,
      (_, num) =>
        `<sup><a href="#source-${num}" class="inline-flex items-center justify-center w-4 h-4 text-[10px] bg-blue-100 text-blue-700 rounded-full font-medium no-underline hover:bg-blue-200 cursor-pointer">${num}</a></sup>`
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-40 px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <Link href="/" className="text-gray-400 hover:text-gray-600 transition-colors shrink-0">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <form onSubmit={handleSearch} className="flex-1 flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="搜索任何问题..."
              className="flex-1 px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-all"
            />
            <button
              type="submit"
              disabled={stage !== 'idle' && stage !== 'done' && stage !== 'error'}
              className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors shrink-0"
            >
              搜索
            </button>
          </form>
        </div>
        <div className="max-w-3xl mx-auto mt-2 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1">
            {SEARCH_MODES.map(opt => (
              <button
                key={opt.value}
                onClick={() => setSearchMode(opt.value)}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full transition-colors ${
                  searchMode === opt.value
                    ? `${opt.color.split(' ').slice(0, 2).join(' ')} ring-1 ring-current font-medium`
                    : 'text-gray-400 bg-white hover:bg-gray-50'
                }`}
              >
                <span className={`h-3 w-3 rounded border ${
                  searchMode === opt.value ? 'border-current bg-current' : 'border-gray-300'
                }`} />
                {opt.label}
              </button>
            ))}
          </div>
          <div className="h-4 w-px bg-gray-200 hidden sm:block" />
          <div className="flex flex-wrap items-center gap-1">
            {SEARCH_DEPTHS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setSearchDepth(opt.value)}
                title={opt.hint}
                className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                  searchDepth === opt.value
                    ? 'bg-gray-900 text-white font-medium'
                    : 'text-gray-400 bg-white hover:bg-gray-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-gray-400">
            {SEARCH_MODES.find(item => item.value === searchMode)?.hint} / {SEARCH_DEPTHS.find(item => item.value === searchDepth)?.hint}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* Stage indicator */}
        {stage !== 'idle' && stage !== 'done' && stage !== 'error' && (
          <div className="flex items-center gap-2 mb-6 text-sm text-gray-500">
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span>{stageLabel[stage] || '处理中...'}</span>
          </div>
        )}

        {plannedQueries.length > 0 && (
          <details className="mb-6 rounded-xl border border-gray-200 bg-white p-4" open={stage !== 'done'}>
            <summary className="cursor-pointer text-sm font-medium text-gray-700">
              研究视角 ({plannedQueries.length})
            </summary>
            <div className="mt-3 space-y-3">
              {plannedQueries.map((item, index) => (
                <div key={`${item.perspective}-${index}`} className="border-t border-gray-100 pt-3 first:border-t-0 first:pt-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-gray-800">{item.perspective}</span>
                    {item.preferredSources?.slice(0, 3).map(provider => (
                      <span key={provider} className="rounded bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-400">
                        {PROVIDER_LABELS[provider] || provider}
                      </span>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-gray-500">{item.reason}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {item.queries.map(q => (
                      <span key={q} className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] text-blue-600">
                        {q}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}

        {/* Summary */}
        {summary && (
          <div ref={summaryRef} className="mb-8">
            <div className="bg-white border border-gray-200 rounded-xl p-5 sm:p-6">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-5 h-5 bg-blue-100 rounded flex items-center justify-center">
                  <svg className="w-3 h-3 text-blue-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                  </svg>
                </div>
                <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">AI 总结</span>
                {resultMode && (
                  <span className={`ml-auto px-2 py-0.5 text-xs rounded-full ${
                    resultMode === 'academic' ? 'bg-purple-50 text-purple-600' :
                    resultMode === 'general' ? 'bg-green-50 text-green-600' :
                    'bg-gray-100 text-gray-500'
                  }`}>
                    {resultMode === 'academic' ? '学术搜索' : resultMode === 'general' ? '全网搜索' : '综合搜索'} / {SEARCH_DEPTHS.find(item => item.value === resultDepth)?.label}
                  </span>
                )}
              </div>
              <div
                className="prose prose-sm max-w-none prose-p:text-slate-700 prose-headings:text-slate-800 prose-a:text-blue-600"
                dangerouslySetInnerHTML={{ __html: renderSummaryHtml(summary) }}
              />
              {stage === 'generating' && (
                <span className="inline-block w-1.5 h-4 bg-blue-500 animate-pulse ml-0.5 align-text-bottom" />
              )}
            </div>
          </div>
        )}

        {/* Error */}
        {stage === 'error' && !sources.length && (
          <div className="text-center py-12">
            <p className="text-gray-500 text-sm">{summary || '搜索出错，请稍后重试'}</p>
          </div>
        )}

        {/* Sources */}
        {sources.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <h3 className="text-sm font-medium text-gray-700">来源</h3>
              <span className="text-xs text-gray-400">({sources.length})</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {sources.map((source, idx) => (
                <a
                  key={source.id}
                  id={`source-${idx + 1}`}
                  href={source.url || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block bg-white border border-gray-200 rounded-xl p-4 hover:border-blue-300 hover:shadow-sm transition-all group"
                >
                  <div className="flex items-start gap-3">
                    {/* Type icon */}
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      source.type === 'paper' ? 'bg-purple-50' : 'bg-green-50'
                    }`}>
                      {source.type === 'paper' ? (
                        <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-medium text-gray-800 line-clamp-2 group-hover:text-blue-600 transition-colors">
                        {source.title}
                      </h4>
                      <p className="text-xs text-gray-500 line-clamp-2 mt-1">
                        {source.fullTextExcerpt || source.snippet}
                      </p>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {source.sourceProvider && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">
                            {PROVIDER_LABELS[source.sourceProvider] || source.sourceProvider}
                          </span>
                        )}
                        {source.fullTextExcerpt && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-green-50 text-green-600 rounded">
                            已读正文
                          </span>
                        )}
                        {source.perspective && (
                          <span className="text-[10px] text-gray-400 line-clamp-1">
                            {source.perspective}
                          </span>
                        )}
                        {source.type === 'paper' && source.authors && (
                          <span className="text-[10px] text-gray-400">
                            {source.authors.slice(0, 2).join(', ')}{source.authors.length > 2 ? ' et al.' : ''}
                          </span>
                        )}
                        {source.year && (
                          <span className="text-[10px] text-gray-400">{source.year}</span>
                        )}
                        {source.citationCount !== undefined && (
                          <span className="text-[10px] text-gray-400">引用 {source.citationCount}</span>
                        )}
                        {source.venue && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-purple-50 text-purple-500 rounded">
                            {source.venue}
                          </span>
                        )}
                        {source.type === 'web' && (
                          <span className="text-[10px] text-gray-400">
                            {sourceHost(source.url)}
                          </span>
                        )}
                        {source.query && (
                          <span className="text-[10px] text-gray-300 line-clamp-1">
                            query: {source.query}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {stage === 'idle' && (
          <div className="text-center py-16">
            <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <h3 className="text-base font-medium text-gray-600 mb-1">AI 研究搜索</h3>
            <p className="text-sm text-gray-400">输入任何问题，AI 将从学术论文和全网为你搜索并总结</p>
          </div>
        )}
      </div>
    </div>
  );
}
