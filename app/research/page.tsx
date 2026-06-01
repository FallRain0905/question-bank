'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabase';
import { renderMarkdown } from '@/lib/render-markdown';
import type {
  PlannedResearchQuery,
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
  { value: 'local_kb', label: '本地知识库' },
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

type TimelineEvent = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  title: string;
  body?: string;
  meta?: string;
};

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

function timelineId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
  const [roundPlan, setRoundPlan] = useState<PlannedResearchQuery[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [draft, setDraft] = useState('');
  const [showDraftPreview, setShowDraftPreview] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [error, setError] = useState('');
  const draftRef = useRef<HTMLElement | null>(null);

  const selectedFocus = useMemo(
    () => cards.filter(card => selectedCards.includes(card.id)).map(card => card.title),
    [cards, selectedCards]
  );

  const openGaps = useMemo(
    () => graph?.gaps.filter(gap => gap.status !== 'filled') || [],
    [graph]
  );

  const pushTimeline = (event: Omit<TimelineEvent, 'id'>) => {
    setTimeline(prev => [...prev, { id: timelineId(), ...event }]);
  };

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      const headers = await authHeaders();
      if (!('Authorization' in headers)) return;
      const res = await fetch('/api/research/sessions', { headers });
      if (!res.ok) return;
      setSessions(await res.json());
    } catch {
      // Keep the workspace usable even if the sidebar history fails.
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
    setRoundPlan([]);
    setGraph(null);
    setTimeline([{ id: timelineId(), role: 'user', title: nextTopic, body: '新的研究主题' }]);
    setStatusText('正在做轻量预检索，并生成研究方向卡片...');

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
      setSelectedCards((data.directionCards || [])
        .filter((card: ResearchDirectionCard) => card.recommended)
        .map((card: ResearchDirectionCard) => card.id));
      setQuickScanSources(data.quickScanSources || []);

      const recommended = data.recommendedScope as ResearchScope;
      if (recommended) {
        setSources(recommended.sources);
        setOutputType(recommended.outputType);
        setDepth(recommended.depth);
        setConstraints((recommended.constraints || []).join('\n'));
      }

      setStatusText('请在左侧确认研究方向和输出目标。');
      pushTimeline({
        role: 'assistant',
        title: '我已经完成预检索和范围初判',
        body: `推荐方向：${(data.directionCards || [])
          .filter((card: ResearchDirectionCard) => card.recommended)
          .map((card: ResearchDirectionCard) => card.title)
          .join('、') || '请手动选择'}`,
      });
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
      setStatusText('研究超图模板已生成，可以在对话流中规划下一轮检索。');
      pushTimeline({
        role: 'assistant',
        title: '研究范围已确认',
        body: `接下来我会围绕 ${selectedFocus.join('、') || '当前选定方向'} 推进检索。检索计划会出现在这里，你可以先改问题再执行。`,
      });
      loadSessions();
    } catch (err: any) {
      setError(err.message || '确认 scope 失败');
    } finally {
      setLoading(false);
    }
  };

  const updatePlanField = (planIndex: number, field: 'perspective' | 'reason', value: string) => {
    setRoundPlan(prev => prev.map((item, index) => index === planIndex ? { ...item, [field]: value } : item));
  };

  const updatePlanQuery = (planIndex: number, queryIndex: number, value: string) => {
    setRoundPlan(prev => prev.map((item, index) => index === planIndex
      ? { ...item, queries: item.queries.map((query, qIndex) => qIndex === queryIndex ? value : query) }
      : item
    ));
  };

  const addPlanItem = () => {
    setRoundPlan(prev => [
      ...prev,
      {
        perspective: '自定义检索',
        reason: '用户在对话流中补充的检索方向。',
        queries: [session?.topic || topic],
        preferredSources: sources,
      },
    ]);
  };

  const removePlanItem = (planIndex: number) => {
    setRoundPlan(prev => prev.filter((_, index) => index !== planIndex));
  };

  const planNextRound = async () => {
    if (!session) return;
    setRunning(true);
    setError('');
    setRoundPlan([]);
    setStatusText('正在规划下一轮检索问题...');
    pushTimeline({
      role: 'assistant',
      title: '我正在规划下一轮检索',
      body: '会根据当前缺口生成可编辑的问题。你可以删改这些 query，再让我按计划检索。',
    });

    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/research/sessions/${session.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ includeGithub: sources.includes('github'), sources, depth, planOnly: true }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(formatApiError(data, '规划检索失败'));
      }
      await consumeRunStream(res.body, false);
      setStatusText('本轮检索计划已生成，可以编辑后开始检索。');
    } catch (err: any) {
      setError(err.message || '规划检索失败');
      setStatusText('');
    } finally {
      setRunning(false);
    }
  };

  const consumeRunStream = async (body: ReadableStream<Uint8Array>, executeSearch = true) => {
    const reader = body.getReader();
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
        if (eventType === 'status') {
          setStatusText(data.message || data.stage);
          pushTimeline({ role: 'assistant', title: data.message || data.stage, meta: data.stage });
        }
        if (eventType === 'tasks' && data.plannedQueries) {
          setRoundPlan(data.plannedQueries);
          pushTimeline({
            role: 'assistant',
            title: executeSearch ? '我准备按这些问题开始检索' : '下一轮检索计划已生成',
            body: data.plannedQueries
              .flatMap((item: PlannedResearchQuery) => item.queries)
              .slice(0, 6)
              .join('\n'),
          });
        }
        if (eventType === 'source' && data.source) {
          setRoundSources(prev => [...prev, data.source]);
          pushTimeline({
            role: 'system',
            title: `找到来源：${data.source.title}`,
            meta: data.source.sourceProvider || data.source.type,
          });
        }
        if (eventType === 'graph' && data.graph) setGraph(data.graph);
        if (eventType === 'evidence' && data.evidence) setEvidence(prev => mergeEvidenceItems(prev, data.evidence));
        if (eventType === 'done') {
          if (data.error) throw new Error(data.error);
          if (data.session) setSession(data.session);
          if (data.graph) setGraph(data.graph);
          if (data.evidence) setEvidence(prev => mergeEvidenceItems(prev, data.evidence));
          if (data.plannedQueries) setRoundPlan(data.plannedQueries);
          if (executeSearch && data.sources) {
            pushTimeline({
              role: 'assistant',
              title: '本轮检索完成',
              body: `新增来源 ${data.sources.length} 个，证据板和研究图谱已经更新。`,
            });
          }
        }
      }
    }
  };

  const runRound = async (override?: Partial<ResearchScope>, planOverride?: PlannedResearchQuery[]) => {
    if (!session) return;
    const effectiveSources = override?.sources || sources;
    const effectiveDepth = override?.depth || depth;
    setRunning(true);
    setError('');
    setRoundSources([]);
    if (!planOverride) setRoundPlan([]);
    setStatusText('正在启动一轮图谱驱动检索...');
    pushTimeline({
      role: 'assistant',
      title: planOverride ? '我会按你确认的计划开始检索' : '我会先规划并执行一轮检索',
      body: planOverride?.flatMap(item => item.queries).join('\n'),
    });

    try {
      if (override) {
        setDepth(effectiveDepth);
        setSources(effectiveSources);
      }
      const headers = await authHeaders();
      const res = await fetch(`/api/research/sessions/${session.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          includeGithub: effectiveSources.includes('github'),
          sources: effectiveSources,
          depth: effectiveDepth,
          planOverride,
        }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(formatApiError(data, '运行检索失败'));
      }

      await consumeRunStream(res.body, true);
      setStatusText('本轮检索完成，已回到等待调整状态。');
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
    setStatusText('正在基于研究图谱和 evidence board 生成草稿文件...');
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
      setShowDraftPreview(false);
      setEvidence(data.evidence || evidence);
      setGraph(data.session?.graph_template || graph);
      setStatusText('草稿文件已生成。');
      pushTimeline({
        role: 'assistant',
        title: '报告草稿已生成',
        body: '默认作为文件产物交付。你可以下载 Markdown 或 DOCX，也可以展开页面预览。',
      });
      loadSessions();
    } catch (err: any) {
      setError(err.message || '生成草稿失败');
    } finally {
      setLoading(false);
    }
  };

  const autoContinue = async () => {
    if (!session || !graph) return;
    setAutoRunning(true);
    setError('');
    const rounds = depth === 'deep' ? 4 : depth === 'standard' ? 2 : 1;
    pushTimeline({
      role: 'assistant',
      title: '我将自动推进研究',
      body: `计划连续运行 ${rounds} 轮，然后生成报告文件。`,
    });

    try {
      for (let i = 0; i < rounds; i += 1) {
        await runRound();
      }
      await generateDraft();
    } finally {
      setAutoRunning(false);
    }
  };

  const downloadArtifact = async (format: 'markdown' | 'docx') => {
    if (!session) return;
    setError('');
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/research/sessions/${session.id}/artifact?format=${format}`, { headers });
      const blob = await res.blob();
      if (!res.ok) {
        const text = await blob.text().catch(() => '');
        throw new Error(text || '下载失败');
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${session.topic.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, '-').slice(0, 60) || 'research-report'}.${format === 'docx' ? 'docx' : 'md'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || '下载失败');
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
      setRoundPlan([]);
      setRoundSources([]);
      setDraft(data.session.graph_template?.reportDraft || '');
      setTimeline([
        { id: timelineId(), role: 'user', title: data.session.topic, body: '已恢复的研究主题' },
        { id: timelineId(), role: 'assistant', title: '研究会话已恢复', body: '你可以继续规划下一轮检索，或直接生成报告文件。' },
      ]);

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
        <div className="mx-auto flex max-w-[1600px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Research</h1>
            <p className="mt-1 text-sm text-gray-500">交互式深度研究：对话规划、图谱检索、证据沉淀和报告产物。</p>
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

      <div className="mx-auto grid max-w-[1600px] gap-4 px-4 py-4 xl:grid-cols-[300px_minmax(0,1fr)_360px]">
        <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <section className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-gray-800">研究控制台</h2>
              {session && <span className="rounded bg-gray-100 px-2 py-1 text-[10px] text-gray-500">{session.status}</span>}
            </div>
            <textarea
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder="例如：我想研究 CCUS，重点是碳捕集"
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

          {cards.length > 0 && !graph && (
            <section className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium text-gray-800">范围确认</h2>
                <button
                  onClick={confirmScope}
                  disabled={loading || !session}
                  className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  生成图谱
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {cards.map(card => (
                  <button
                    key={card.id}
                    onClick={() => setSelectedCards(prev => toggleInList(prev, card.id))}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${
                      selectedCards.includes(card.id)
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-medium text-gray-800">{card.title}</h3>
                      {card.recommended && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700">推荐</span>}
                    </div>
                    <p className="mt-2 text-xs leading-5 text-gray-500">{card.description}</p>
                  </button>
                ))}
              </div>

              <div className="mt-4 border-t border-gray-100 pt-4">
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

              <div className="mt-4 grid gap-3">
                <label className="text-xs font-medium text-gray-500">
                  输出形式
                  <select
                    value={outputType}
                    onChange={e => setOutputType(e.target.value as ResearchOutputType)}
                    className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                  >
                    {OUTPUT_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </label>
                <label className="text-xs font-medium text-gray-500">
                  检索深度
                  <select
                    value={depth}
                    onChange={e => setDepth(e.target.value as ResearchSessionDepth)}
                    className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                  >
                    {DEPTH_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label} - {opt.hint}</option>)}
                  </select>
                </label>
                <textarea
                  value={constraints}
                  onChange={e => setConstraints(e.target.value)}
                  className="min-h-20 w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none"
                  placeholder="补充约束，每行一条"
                />
              </div>
            </section>
          )}

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

        <main className="min-w-0">
          <section className="flex min-h-[calc(100vh-132px)] flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-4 py-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="text-[10px] font-medium uppercase text-gray-400">Research Chat</div>
                  <h2 className="mt-1 truncate text-base font-semibold text-gray-900">
                    {session?.topic || '从一个研究问题开始'}
                  </h2>
                  <p className="mt-1 text-xs text-gray-500">
                    {graph
                      ? `${graph.nodes.length} 节点 / ${graph.edges.length} 超边 / ${openGaps.length} 个开放缺口 / ${evidence.length} 条证据`
                      : '确认范围后，检索计划会作为对话卡片出现在这里。'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {sources.map(source => (
                    <span key={source} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">{source}</span>
                  ))}
                  <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs text-blue-600">{depth}</span>
                </div>
              </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto bg-gray-50/60 px-4 py-4">
              {!session && (
                <div className="mx-auto mt-12 max-w-2xl rounded-lg border border-dashed border-gray-200 bg-white p-8 text-center">
                  <h3 className="text-base font-medium text-gray-800">输入研究主题，然后让 Synap 先做预检索</h3>
                  <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-gray-500">
                    它会生成研究方向卡片，你确认范围后，再进入多轮检索、证据填充和报告生成。
                  </p>
                </div>
              )}

              {timeline.map(item => (
                <div key={item.id} className={`flex ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[88%] rounded-lg px-3 py-2 text-sm shadow-sm ${
                    item.role === 'user'
                      ? 'bg-gray-900 text-white'
                      : item.role === 'system'
                        ? 'border border-gray-200 bg-white text-gray-600'
                        : 'bg-blue-50 text-gray-800'
                  }`}>
                    <div className="font-medium">{item.title}</div>
                    {item.body && <div className="mt-1 whitespace-pre-line text-xs leading-5 opacity-80">{item.body}</div>}
                    {item.meta && <div className="mt-1 text-[10px] opacity-60">{item.meta}</div>}
                  </div>
                </div>
              ))}

              {graph && (
                <div className="rounded-lg border border-blue-100 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <h3 className="text-sm font-medium text-gray-900">下一轮检索计划</h3>
                      <p className="mt-1 text-xs text-gray-500">
                        这里就是可交互修改区。先“只规划下一轮”，改掉不准确的 query，再按当前计划检索。
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={planNextRound}
                        disabled={running}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:border-gray-300 disabled:opacity-50"
                      >
                        只规划下一轮
                      </button>
                      <button
                        onClick={() => runRound(undefined, roundPlan.length ? roundPlan : undefined)}
                        disabled={running}
                        className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                      >
                        {running ? '检索中...' : roundPlan.length ? '按当前计划检索' : '规划并检索'}
                      </button>
                      <button
                        onClick={autoContinue}
                        disabled={running || autoRunning}
                        className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {autoRunning ? '自动研究中...' : '自动跑完'}
                      </button>
                      <button
                        onClick={generateDraft}
                        disabled={loading || evidence.length === 0}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:border-gray-300 disabled:opacity-50"
                      >
                        生成报告文件
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 rounded-lg bg-gray-50 p-3 md:grid-cols-[1fr_220px]">
                    <div>
                      <h4 className="text-xs font-medium text-gray-500">本轮来源偏好</h4>
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
                    <label className="text-xs font-medium text-gray-500">
                      本轮深度
                      <select
                        value={depth}
                        onChange={e => setDepth(e.target.value as ResearchSessionDepth)}
                        className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                      >
                        {DEPTH_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </select>
                    </label>
                  </div>

                  <div className="mt-4 space-y-3">
                    {(roundPlan.length ? roundPlan : [{
                      perspective: '等待规划',
                      reason: '点击“只规划下一轮”后，这里会出现可编辑的检索问题。',
                      queries: graph.nextSearchTasks?.slice(0, 2) || [],
                      preferredSources: sources,
                    }]).map((item, index) => (
                      <div key={`${item.perspective}-${index}`} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                        <div className="flex items-start gap-2">
                          {roundPlan.length ? (
                            <input
                              value={item.perspective}
                              onChange={event => updatePlanField(index, 'perspective', event.target.value)}
                              className="min-w-0 flex-1 rounded border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 outline-none focus:border-blue-300"
                            />
                          ) : (
                            <div className="min-w-0 flex-1 text-xs font-medium text-gray-700">{item.perspective}</div>
                          )}
                          {roundPlan.length > 0 && (
                            <button
                              onClick={() => removePlanItem(index)}
                              className="rounded border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-500 hover:border-red-200 hover:text-red-600"
                            >
                              删除
                            </button>
                          )}
                        </div>
                        {roundPlan.length ? (
                          <textarea
                            value={item.reason}
                            onChange={event => updatePlanField(index, 'reason', event.target.value)}
                            className="mt-2 min-h-14 w-full resize-none rounded border border-gray-200 bg-white px-2 py-1 text-[11px] leading-5 text-gray-600 outline-none focus:border-blue-300"
                          />
                        ) : (
                          <p className="mt-1 text-[11px] leading-5 text-gray-500">{item.reason}</p>
                        )}
                        <div className="mt-2 space-y-2">
                          {item.queries.slice(0, 2).map((query, queryIndex) => (
                            roundPlan.length ? (
                              <input
                                key={`${index}-${queryIndex}`}
                                value={query}
                                onChange={event => updatePlanQuery(index, queryIndex, event.target.value)}
                                className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 outline-none focus:border-blue-300"
                              />
                            ) : (
                              <div key={query} className="rounded bg-white px-2 py-1.5 text-xs text-gray-600">{query}</div>
                            )
                          ))}
                        </div>
                      </div>
                    ))}
                    {roundPlan.length > 0 && (
                      <button
                        onClick={addPlanItem}
                        className="rounded-lg border border-dashed border-gray-300 bg-white px-3 py-2 text-xs text-gray-500 hover:border-blue-300 hover:text-blue-600"
                      >
                        添加自定义检索问题
                      </button>
                    )}
                  </div>
                </div>
              )}

              {draft && (
                <section ref={draftRef} className="rounded-lg border border-gray-200 bg-white shadow-sm">
                  <div className="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-sm font-medium text-gray-900">报告文件已生成</h2>
                      <p className="mt-1 text-xs text-gray-500">默认以文件产物交付，页面预览保持折叠。</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => downloadArtifact('markdown')} className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800">下载 Markdown</button>
                      <button onClick={() => downloadArtifact('docx')} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:border-gray-300">下载 DOCX</button>
                      <button onClick={() => setShowDraftPreview(prev => !prev)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:border-gray-300">
                        {showDraftPreview ? '收起预览' : '预览'}
                      </button>
                    </div>
                  </div>
                  {showDraftPreview && (
                    <article
                      className="prose prose-sm max-w-none break-words px-5 py-5 prose-headings:scroll-mt-20 prose-headings:text-gray-900 prose-p:leading-7 prose-p:text-gray-700 prose-li:leading-7 prose-li:marker:text-gray-300 prose-code:break-words prose-pre:whitespace-pre-wrap"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(draft) }}
                    />
                  )}
                </section>
              )}
            </div>
          </section>
        </main>

        <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <details open className="rounded-lg border border-gray-200 bg-white p-4">
            <summary className="cursor-pointer text-sm font-medium text-gray-800">Evidence Board</summary>
            <p className="mt-2 text-xs text-gray-500">按 claim 聚合证据，最终报告会优先使用这里的内容。</p>
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
          </details>

          {graph && (
            <details className="rounded-lg border border-gray-200 bg-white p-4">
              <summary className="cursor-pointer text-sm font-medium text-gray-800">研究图谱</summary>
              <div className="mt-3 space-y-3">
                <div className="rounded-lg bg-gray-50 p-3">
                  <h3 className="text-xs font-medium text-gray-500">节点类型</h3>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {graph.nodeTypes.map(type => (
                      <span key={type} className="rounded bg-white px-2 py-1 text-[10px] text-gray-600">{type}</span>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg bg-gray-50 p-3">
                  <h3 className="text-xs font-medium text-gray-500">待填 slots</h3>
                  <div className="mt-2 space-y-1">
                    {graph.requiredSlots.map(slot => (
                      <div key={slot} className="text-xs text-gray-600">{slot}</div>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  {openGaps.map(gap => (
                    <div key={gap.id} className="rounded-lg border border-gray-100 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-xs font-medium text-gray-800">{gap.label}</h3>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] ${
                          gap.status === 'partial' ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600'
                        }`}>
                          {gap.status}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-gray-500">{gap.reason}</p>
                    </div>
                  ))}
                </div>
              </div>
            </details>
          )}

          {(roundSources.length > 0 || quickScanSources.length > 0) && (
            <details className="rounded-lg border border-gray-200 bg-white p-4">
              <summary className="cursor-pointer text-sm font-medium text-gray-800">来源</summary>
              <div className="mt-3 space-y-2">
                {[...roundSources, ...quickScanSources].slice(0, 12).map(source => (
                  <a
                    key={`${source.id}-${source.url}`}
                    href={source.url || '#'}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-lg bg-gray-50 p-3 hover:bg-gray-100"
                  >
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-gray-500">{source.sourceProvider || source.type}</span>
                      {source.year && <span className="text-[10px] text-gray-400">{source.year}</span>}
                    </div>
                    <div className="mt-1 line-clamp-2 text-xs font-medium text-gray-700">{source.title}</div>
                    <p className="mt-1 line-clamp-2 text-xs text-gray-500">{source.fullTextExcerpt || source.snippet}</p>
                  </a>
                ))}
              </div>
            </details>
          )}
        </aside>
      </div>
    </div>
  );
}
