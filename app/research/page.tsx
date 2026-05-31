'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabase';
import { renderMarkdown } from '@/lib/render-markdown';
import type {
  ResearchDirectionCard,
  ResearchEvidence,
  ResearchGraphTemplate,
  ResearchOutputType,
  ResearchScope,
  ResearchSession,
  ResearchSessionDepth,
  ResearchSource,
  ResearchSourcePreference,
} from '@/types';

const SOURCE_OPTIONS: { value: ResearchSourcePreference; label: string }[] = [
  { value: 'papers', label: '论文源' },
  { value: 'web', label: 'Web' },
  { value: 'github', label: 'GitHub' },
  { value: 'local_kb', label: '本地 HyperRAG' },
];

const OUTPUT_OPTIONS: { value: ResearchOutputType; label: string }[] = [
  { value: 'technical_report', label: '技术报告' },
  { value: 'system_design', label: '系统设计' },
  { value: 'literature_review', label: '文献综述' },
  { value: 'concise_answer', label: '简洁回答' },
  { value: 'comparison_table', label: '对比表' },
];

const DEPTH_OPTIONS: { value: ResearchSessionDepth; label: string; hint: string }[] = [
  { value: 'fast', label: '快速', hint: '1 轮，快速看方向' },
  { value: 'standard', label: '标准', hint: '2-3 轮，默认' },
  { value: 'deep', label: '深度', hint: '最多 5 轮，适合报告' },
];

function toggleInList<T extends string>(items: T[], value: T) {
  return items.includes(value) ? items.filter(item => item !== value) : [...items, value];
}

function mergeEvidenceItems(existing: ResearchEvidence[], incoming: ResearchEvidence[]) {
  const seen = new Set(existing.map(item => item.id));
  return [...incoming.filter(item => !seen.has(item.id)), ...existing];
}

function formatApiError(data: any, fallback: string) {
  return [data?.error || fallback, data?.hint].filter(Boolean).join('\n');
}

async function authHeaders(): Promise<Record<string, string>> {
  const supabase = getSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

export default function ResearchPage() {
  const [topic, setTopic] = useState('');
  const [sessions, setSessions] = useState<ResearchSession[]>([]);
  const [session, setSession] = useState<ResearchSession | null>(null);
  const [cards, setCards] = useState<ResearchDirectionCard[]>([]);
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [sources, setSources] = useState<ResearchSourcePreference[]>(['papers', 'web', 'github', 'local_kb']);
  const [outputType, setOutputType] = useState<ResearchOutputType>('technical_report');
  const [depth, setDepth] = useState<ResearchSessionDepth>('standard');
  const [constraints, setConstraints] = useState('优先保留可引用证据\n每轮检索都服务于补全研究图谱缺口');
  const [quickScanSources, setQuickScanSources] = useState<ResearchSource[]>([]);
  const [graph, setGraph] = useState<ResearchGraphTemplate | null>(null);
  const [evidence, setEvidence] = useState<ResearchEvidence[]>([]);
  const [roundSources, setRoundSources] = useState<ResearchSource[]>([]);
  const [draft, setDraft] = useState('');
  const [statusText, setStatusText] = useState('');
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const draftRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    loadSessions();
  }, []);

  const selectedFocus = useMemo(
    () => cards.filter(card => selectedCards.includes(card.id)).map(card => card.title),
    [cards, selectedCards]
  );

  const loadSessions = async () => {
    try {
      const headers = await authHeaders();
      if (!('Authorization' in headers)) return;
      const res = await fetch('/api/research/sessions', { headers });
      if (!res.ok) return;
      setSessions(await res.json());
    } catch {
      // ignore
    }
  };

  const createSession = async () => {
    const nextTopic = topic.trim();
    if (!nextTopic) return;
    setLoading(true);
    setError('');
    setDraft('');
    setEvidence([]);
    setRoundSources([]);
    setGraph(null);
    setStatusText('正在做轻量预检索并生成研究方向...');

    try {
      const headers = await authHeaders();
      const res = await fetch('/api/research/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ topic: nextTopic }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(formatApiError(data, '创建研究会话失败'));
      setSession(data.session);
      setCards(data.directionCards || []);
      setSelectedCards((data.directionCards || []).filter((card: ResearchDirectionCard) => card.recommended).map((card: ResearchDirectionCard) => card.id));
      setQuickScanSources(data.quickScanSources || []);
      const recommended = data.recommendedScope as ResearchScope;
      if (recommended) {
        setSources(recommended.sources);
        setOutputType(recommended.outputType);
        setDepth(recommended.depth);
        setConstraints((recommended.constraints || []).join('\n'));
      }
      setStatusText('请确认研究方向和输出目标。');
      loadSessions();
    } catch (err: any) {
      setError(err.message || '创建研究会话失败');
      setStatusText('');
    } finally {
      setLoading(false);
    }
  };

  const confirmScope = async () => {
    if (!session) return;
    setLoading(true);
    setError('');
    setStatusText('正在生成研究超图模板...');
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/research/sessions/${session.id}/scope`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          focus: selectedFocus.length ? selectedFocus : ['系统架构', '论文图结构'],
          sources,
          outputType,
          timeRange: 'recent_3_years',
          depth,
          constraints: constraints.split('\n').map(item => item.trim()).filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(formatApiError(data, '确认 scope 失败'));
      setSession(data.session);
      setGraph(data.graphTemplate);
      setStatusText('研究超图模板已生成，可以开始第一轮检索。');
      loadSessions();
    } catch (err: any) {
      setError(err.message || '确认 scope 失败');
    } finally {
      setLoading(false);
    }
  };

  const runRound = async (override?: Partial<ResearchScope>) => {
    if (!session) return;
    setRunning(true);
    setError('');
    setRoundSources([]);
    setStatusText('正在启动一轮图谱驱动检索...');
    try {
      if (override) {
        setDepth(override.depth || depth);
        if (override.sources) setSources(override.sources);
      }
      const headers = await authHeaders();
      const res = await fetch(`/api/research/sessions/${session.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ includeGithub: sources.includes('github'), sources, depth }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(formatApiError(data, '运行检索失败'));
      }

      const reader = res.body.getReader();
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
          const data = JSON.parse(dataStr);
          if (eventType === 'status') setStatusText(data.message || data.stage);
          if (eventType === 'source' && data.source) setRoundSources(prev => [...prev, data.source]);
          if (eventType === 'graph' && data.graph) setGraph(data.graph);
          if (eventType === 'evidence' && data.evidence) setEvidence(prev => mergeEvidenceItems(prev, data.evidence));
          if (eventType === 'done') {
            if (data.error) throw new Error(data.error);
            setSession(data.session || session);
            if (data.graph) setGraph(data.graph);
            if (data.evidence) setEvidence(prev => mergeEvidenceItems(prev, data.evidence));
            setStatusText('本轮检索完成，已回到等待调整状态。');
          }
        }
      }
      loadSessions();
    } catch (err: any) {
      setError(err.message || '运行检索失败');
      setStatusText('');
    } finally {
      setRunning(false);
    }
  };

  const generateDraft = async () => {
    if (!session) return;
    setLoading(true);
    setError('');
    setStatusText('正在基于研究图谱和 evidence board 生成草稿...');
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/research/sessions/${session.id}/draft`, {
        method: 'POST',
        headers,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(formatApiError(data, '生成草稿失败'));
      setSession(data.session);
      setDraft(data.draft || '');
      setEvidence(data.evidence || evidence);
      setGraph(data.session?.graph_template || graph);
      setStatusText('草稿已生成。');
      setTimeout(() => draftRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
      loadSessions();
    } catch (err: any) {
      setError(err.message || '生成草稿失败');
    } finally {
      setLoading(false);
    }
  };

  const loadSession = async (id: string) => {
    setLoading(true);
    setError('');
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/research/sessions/${id}`, { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(formatApiError(data, '加载研究会话失败'));
      setSession(data.session);
      setTopic(data.session.topic);
      setGraph(data.session.graph_template || null);
      setEvidence(data.evidence || []);
      setDraft(data.session.graph_template?.reportDraft || '');
      const scope = data.session.scope as ResearchScope | null;
      if (scope) {
        setSources(scope.sources);
        setOutputType(scope.outputType);
        setDepth(scope.depth);
        setConstraints((scope.constraints || []).join('\n'));
      }
      setStatusText('已恢复研究会话。');
    } catch (err: any) {
      setError(err.message || '加载研究会话失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="border-b border-gray-200 bg-white px-4 py-4">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Research</h1>
            <p className="mt-1 text-sm text-gray-500">交互式深度研究：范围确认、检索超图、证据板和报告草稿。</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/search" className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:border-gray-300">
              轻量搜索
            </Link>
            <Link href="/reader" className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:border-gray-300">
              AI 阅读
            </Link>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-4 lg:grid-cols-[300px_minmax(0,1fr)_320px]">
        <aside className="space-y-4">
          <section className="rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-medium text-gray-800">研究主题</h2>
            <textarea
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder="例如：我想研究面向论文语料的超图 RAG"
              className="mt-3 min-h-28 w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            />
            <button
              onClick={createSession}
              disabled={loading || !topic.trim()}
              className="mt-3 w-full rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              开始范围确认
            </button>
            {statusText && <p className="mt-3 text-xs text-blue-600">{statusText}</p>}
            {error && <p className="mt-3 whitespace-pre-line text-xs text-red-600">{error}</p>}
          </section>

          {sessions.length > 0 && (
            <section className="rounded-lg border border-gray-200 bg-white p-4">
              <h2 className="text-sm font-medium text-gray-800">最近研究</h2>
              <div className="mt-3 space-y-2">
                {sessions.slice(0, 6).map(item => (
                  <button
                    key={item.id}
                    onClick={() => loadSession(item.id)}
                    className={`block w-full rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                      session?.id === item.id ? 'bg-blue-50 text-blue-700' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    <span className="line-clamp-2 font-medium">{item.topic}</span>
                    <span className="mt-1 block text-[10px] text-gray-400">{item.status}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </aside>

        <main className="space-y-4">
          {cards.length > 0 && !graph && (
            <section className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-medium text-gray-800">研究方向确认</h2>
                  <p className="mt-1 text-xs text-gray-500">先选范围，再生成检索超图。这样每轮检索都会更贴合目标。</p>
                </div>
                <button
                  onClick={confirmScope}
                  disabled={loading || !session}
                  className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  生成研究超图
                </button>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {cards.map(card => (
                  <button
                    key={card.id}
                    onClick={() => setSelectedCards(prev => toggleInList(prev, card.id))}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      selectedCards.includes(card.id)
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-medium text-gray-800">{card.title}</h3>
                      {card.recommended && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700">推荐</span>}
                    </div>
                    <p className="mt-2 text-xs leading-5 text-gray-500">{card.description}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {card.graphFocus.slice(0, 3).map(item => (
                        <span key={item} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">{item}</span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>

              <div className="mt-4 grid gap-4 border-t border-gray-100 pt-4 md:grid-cols-3">
                <div>
                  <h3 className="text-xs font-medium text-gray-500">信息源</h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {SOURCE_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setSources(prev => toggleInList(prev, opt.value))}
                        className={`rounded-full border px-3 py-1.5 text-xs ${
                          sources.includes(opt.value) ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-500'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="text-xs font-medium text-gray-500">输出形式</h3>
                  <select
                    value={outputType}
                    onChange={e => setOutputType(e.target.value as ResearchOutputType)}
                    className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                  >
                    {OUTPUT_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
                <div>
                  <h3 className="text-xs font-medium text-gray-500">检索深度</h3>
                  <select
                    value={depth}
                    onChange={e => setDepth(e.target.value as ResearchSessionDepth)}
                    className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                  >
                    {DEPTH_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label} - {opt.hint}</option>)}
                  </select>
                </div>
              </div>

              <textarea
                value={constraints}
                onChange={e => setConstraints(e.target.value)}
                className="mt-4 min-h-20 w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none"
                placeholder="补充约束，每行一条"
              />
            </section>
          )}

          {draft && (
            <section ref={draftRef} className="rounded-lg border border-gray-200 bg-white">
              <div className="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-sm font-medium text-gray-900">报告草稿</h2>
                  <p className="mt-1 text-xs text-gray-500">基于当前 Evidence Board 生成。继续检索后可以重新生成。</p>
                </div>
                <button
                  onClick={generateDraft}
                  disabled={loading || evidence.length === 0}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:border-gray-300 disabled:opacity-50"
                >
                  重新生成
                </button>
              </div>
              <article
                className="prose prose-sm max-w-none break-words px-5 py-5 prose-headings:scroll-mt-20 prose-headings:text-gray-900 prose-p:leading-7 prose-p:text-gray-700 prose-li:leading-7 prose-li:marker:text-gray-300 prose-code:break-words prose-pre:whitespace-pre-wrap"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(draft) }}
              />
            </section>
          )}

          {graph && (
            <section className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-sm font-medium text-gray-800">Session Research Hypergraph</h2>
                  <p className="mt-1 text-xs text-gray-500">
                    {graph.nodes.length} 节点 / {graph.edges.length} 超边 / {graph.gaps.filter(gap => gap.status !== 'filled').length} 个开放缺口
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => runRound()}
                    disabled={running}
                    className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                  >
                    {running ? '检索中...' : '运行一轮检索'}
                  </button>
                  <button
                    onClick={generateDraft}
                    disabled={loading || evidence.length === 0}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:border-gray-300 disabled:opacity-50"
                  >
                    生成草稿
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-3 rounded-lg bg-gray-50 p-3 md:grid-cols-[1fr_220px]">
                <div>
                  <h3 className="text-xs font-medium text-gray-500">本轮来源偏好</h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {SOURCE_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setSources(prev => toggleInList(prev, opt.value))}
                        className={`rounded-full border px-3 py-1.5 text-xs ${
                          sources.includes(opt.value) ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-500'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="text-xs font-medium text-gray-500">本轮深度</h3>
                  <select
                    value={depth}
                    onChange={e => setDepth(e.target.value as ResearchSessionDepth)}
                    className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                  >
                    {DEPTH_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-lg bg-gray-50 p-3">
                  <h3 className="text-xs font-medium text-gray-500">节点类型</h3>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {graph.nodeTypes.map(type => (
                      <span key={type} className="rounded bg-white px-2 py-1 text-[10px] text-gray-600">{type}</span>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg bg-gray-50 p-3">
                  <h3 className="text-xs font-medium text-gray-500">待填补 slots</h3>
                  <div className="mt-2 space-y-1">
                    {graph.requiredSlots.map(slot => (
                      <div key={slot} className="text-xs text-gray-600">{slot}</div>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg bg-gray-50 p-3">
                  <h3 className="text-xs font-medium text-gray-500">下一轮检索</h3>
                  <div className="mt-2 space-y-1">
                    {(graph.nextSearchTasks || []).slice(0, 5).map(task => (
                      <div key={task} className="line-clamp-2 text-xs text-gray-600">{task}</div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {graph.gaps.map(gap => (
                  <div key={gap.id} className="rounded-lg border border-gray-100 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-medium text-gray-800">{gap.label}</h3>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] ${
                        gap.status === 'filled' ? 'bg-green-50 text-green-600' :
                        gap.status === 'partial' ? 'bg-amber-50 text-amber-600' :
                        'bg-red-50 text-red-600'
                      }`}>
                        {gap.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-gray-500">{gap.reason}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {roundSources.length > 0 && (
            <section className="rounded-lg border border-gray-200 bg-white p-4">
              <h2 className="text-sm font-medium text-gray-800">本轮来源</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {roundSources.slice(0, 8).map(source => (
                  <a key={`${source.id}-${source.url}`} href={source.url || '#'} target="_blank" rel="noreferrer" className="rounded-lg border border-gray-100 p-3 hover:border-blue-200">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">{source.sourceProvider || source.type}</span>
                      {source.year && <span className="text-[10px] text-gray-400">{source.year}</span>}
                    </div>
                    <h3 className="mt-2 line-clamp-2 text-sm font-medium text-gray-800">{source.title}</h3>
                    <p className="mt-1 line-clamp-2 text-xs text-gray-500">{source.fullTextExcerpt || source.snippet}</p>
                  </a>
                ))}
              </div>
            </section>
          )}

          {!session && (
            <section className="rounded-lg border border-dashed border-gray-200 bg-white p-8 text-center">
              <h2 className="text-base font-medium text-gray-700">从一个研究问题开始</h2>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-gray-500">
                Synap 会先做轻量预检索，生成研究方向卡片；你确认范围后，它会生成一个临时研究超图，并在每轮检索后更新证据和缺口。
              </p>
            </section>
          )}
        </main>

        <aside className="space-y-4">
          <section className="rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-medium text-gray-800">Evidence Board</h2>
            <p className="mt-1 text-xs text-gray-500">按 claim 聚合证据，最终报告会优先使用这里的内容。</p>
            <div className="mt-3 space-y-3">
              {evidence.length === 0 ? (
                <div className="rounded-lg bg-gray-50 p-4 text-xs text-gray-400">运行一轮检索后会出现证据。</div>
              ) : evidence.slice(0, 12).map(item => (
                <div key={`${item.id}-${item.source_id}`} className="rounded-lg border border-gray-100 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600">
                      {Math.round(item.confidence * 100)}%
                    </span>
                    <span className="text-[10px] text-gray-400">{item.metadata?.provider || 'source'}</span>
                  </div>
                  <p className="mt-2 text-xs font-medium leading-5 text-gray-700">{item.claim}</p>
                  <p className="mt-1 line-clamp-3 text-xs leading-5 text-gray-500">{item.snippet}</p>
                </div>
              ))}
            </div>
          </section>

          {quickScanSources.length > 0 && (
            <section className="rounded-lg border border-gray-200 bg-white p-4">
              <h2 className="text-sm font-medium text-gray-800">预检索来源</h2>
              <div className="mt-3 space-y-2">
                {quickScanSources.map(source => (
                  <a key={source.id} href={source.url || '#'} target="_blank" rel="noreferrer" className="block rounded-lg bg-gray-50 p-3">
                    <div className="text-[10px] text-gray-400">{source.sourceProvider || source.type}</div>
                    <div className="mt-1 line-clamp-2 text-xs font-medium text-gray-700">{source.title}</div>
                  </a>
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
