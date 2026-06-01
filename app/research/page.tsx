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
  { value: 'papers', label: '\u8bba\u6587\u6e90' },
  { value: 'web', label: 'Web' },
  { value: 'github', label: 'GitHub' },
  { value: 'local_kb', label: '\u672c\u5730\u77e5\u8bc6\u5e93' },
];

const OUTPUT_OPTIONS: { value: ResearchOutputType; label: string }[] = [
  { value: 'technical_report', label: '\u6280\u672f\u62a5\u544a' },
  { value: 'system_design', label: '\u7cfb\u7edf\u8bbe\u8ba1' },
  { value: 'literature_review', label: '\u6587\u732e\u7efc\u8ff0' },
  { value: 'concise_answer', label: '\u7b80\u6d01\u56de\u7b54' },
  { value: 'comparison_table', label: '\u5bf9\u6bd4\u8868' },
];

const DEPTH_OPTIONS: { value: ResearchSessionDepth; label: string; hint: string }[] = [
  { value: 'fast', label: '\u5feb\u901f', hint: '1 \u8f6e\uff0c\u5feb\u901f\u770b\u65b9\u5411' },
  { value: 'standard', label: '\u6807\u51c6', hint: '2-3 \u8f6e\uff0c\u9ed8\u8ba4' },
  { value: 'deep', label: '\u6df1\u5ea6', hint: '\u6700\u591a 5 \u8f6e\uff0c\u9002\u5408\u62a5\u544a' },
];

type TimelineEvent = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  title: string;
  body?: string;
  meta?: string;
};

type RightPanelTab = 'evidence' | 'graph' | 'sources' | 'report';

type GateSample = {
  sourceId: string;
  title: string;
  provider: string;
  url?: string;
  snippet?: string;
  reason: string;
  relevanceScore?: number;
};

type GateDiagnostics = {
  accepted: number;
  rejected: number;
  fallback: boolean;
  fallbackReason?: string;
  acceptedSamples: GateSample[];
  rejectedSamples: GateSample[];
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

function MenuIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
    </svg>
  );
}

function PanelIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 6.75h15M4.5 12h15m-15 5.25h15" />
    </svg>
  );
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
  const [constraints, setConstraints] = useState('Prefer citable evidence\nEvery round should fill a research graph gap');
  const [quickScanSources, setQuickScanSources] = useState<ResearchSource[]>([]);
  const [graph, setGraph] = useState<ResearchGraphTemplate | null>(null);
  const [evidence, setEvidence] = useState<ResearchEvidence[]>([]);
  const [roundSources, setRoundSources] = useState<ResearchSource[]>([]);
  const [roundPlan, setRoundPlan] = useState<PlannedResearchQuery[]>([]);
  const [gateDiagnostics, setGateDiagnostics] = useState<GateDiagnostics | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [draft, setDraft] = useState('');
  const [statusText, setStatusText] = useState('');
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [error, setError] = useState('');
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('evidence');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const selectedFocus = useMemo(
    () => cards.filter(card => selectedCards.includes(card.id)).map(card => card.title),
    [cards, selectedCards]
  );

  const openGaps = useMemo(
    () => graph?.gaps.filter(gap => gap.status !== 'filled') || [],
    [graph]
  );

  const contextSources = useMemo(
    () => [...roundSources, ...quickScanSources],
    [roundSources, quickScanSources]
  );

  const pushTimeline = (event: Omit<TimelineEvent, 'id'>) => {
    setTimeline(prev => [...prev, { id: timelineId(), ...event }]);
  };

  useEffect(() => {
    loadSessions();
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setLeftSidebarOpen(false);
      setRightSidebarOpen(false);
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [timeline, roundPlan, draft, running]);

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
    setGateDiagnostics(null);
    setRoundPlan([]);
    setGraph(null);
    setTimeline([{ id: timelineId(), role: 'user', title: nextTopic, body: '\u65b0\u7684\u7814\u7a76\u4e3b\u9898' }]);
    setStatusText('\u6b63\u5728\u505a\u8f7b\u91cf\u9884\u68c0\u7d22\uff0c\u5e76\u751f\u6210\u7814\u7a76\u65b9\u5411\u5361\u7247...');

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
      if (!res.ok) throw new Error(formatApiError(data, '确认研究范围失败'));

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
      setError(err.message || '确认研究范围失败');
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
            title: executeSearch ? 'I will search with this plan' : 'Next-round search plan is ready',
            body: data.plannedQueries
              .flatMap((item: PlannedResearchQuery) => item.queries)
              .slice(0, 8)
              .join('\n'),
            meta: 'query planner',
          });
        }
        if (eventType === 'source' && data.source) {
          setRoundSources(prev => [...prev, data.source]);
          pushTimeline({
            role: 'system',
            title: `Found source: ${data.source.title}`,
            body: [
              data.source.query ? `query: ${data.source.query}` : '',
              (data.source.fullTextExcerpt || data.source.snippet || '').slice(0, 260),
            ].filter(Boolean).join('\n'),
            meta: data.source.sourceProvider || data.source.type,
          });
        }
        if (eventType === 'gate') {
          const diagnostics: GateDiagnostics = {
            accepted: data.accepted || 0,
            rejected: data.rejected || 0,
            fallback: data.fallback === true,
            fallbackReason: data.fallbackReason || '',
            acceptedSamples: data.acceptedSamples || [],
            rejectedSamples: data.rejectedSamples || [],
          };
          setGateDiagnostics(diagnostics);
          setRightPanelTab('sources');
          setRightSidebarOpen(true);
          pushTimeline({
            role: 'assistant',
            title: 'Evidence gate completed',
            body: [
              `Passed ${diagnostics.accepted} sources, rejected ${diagnostics.rejected} sources.`,
              diagnostics.fallback ? `Rule fallback was used: ${diagnostics.fallbackReason || 'reason unavailable'}` : 'LLM evidence gate was used.',
              diagnostics.acceptedSamples.length ? `Accepted samples:\n${diagnostics.acceptedSamples.map(item => `- ${item.title}: ${item.reason}`).join('\n')}` : '',
              diagnostics.rejectedSamples.length ? `Rejected samples:\n${diagnostics.rejectedSamples.slice(0, 4).map(item => `- ${item.title}: ${item.reason}`).join('\n')}` : '',
            ].filter(Boolean).join('\n\n'),
            meta: 'evidence gate',
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
              title: 'Search round completed',
              body: `Found ${data.sources.length} candidate sources. Evidence and graph updates now follow the gate result.`,
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
    setGateDiagnostics(null);
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
      setEvidence(data.evidence || evidence);
      setGraph(data.session?.graph_template || graph);
      setStatusText('草稿文件已生成。');
      setRightPanelTab('report');
      setRightSidebarOpen(true);
      pushTimeline({
        role: 'assistant',
        title: '报告草稿已生成',
        body: '默认作为文件产物交付。你可以下载 Markdown 或 DOCX，也可以在右侧报告面板预览。',
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
    setGateDiagnostics(null);
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
      if (typeof window !== 'undefined' && window.innerWidth < 1024) setLeftSidebarOpen(false);
    } catch (err: any) {
      setError(err.message || '加载研究会话失败');
    } finally {
      setLoading(false);
    }
  };

  const renderLeftSidebar = () => (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-medium text-gray-900">研究控制台</h2>
          {session && <p className="mt-0.5 text-[10px] text-gray-400">{session.status}</p>}
        </div>
        <button
          onClick={() => setLeftSidebarOpen(false)}
          className="rounded-lg px-2 py-1 text-xs text-gray-400 hover:bg-gray-50 hover:text-gray-600"
        >
          收起
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <section>
          <textarea
            value={topic}
            onChange={e => setTopic(e.target.value)}
            placeholder="例如：我想研究 CCUS，重点是碳捕集"
            className="min-h-28 w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
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
          <section className="border-t border-gray-100 pt-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium text-gray-800">范围确认</h3>
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
                    <h4 className="text-sm font-medium text-gray-800">{card.title}</h4>
                    {card.recommended && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700">推荐</span>}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-gray-500">{card.description}</p>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="border-t border-gray-100 pt-4">
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
        </section>

        <section className="grid gap-3 border-t border-gray-100 pt-4">
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
        </section>

        {sessions.length > 0 && (
          <section className="border-t border-gray-100 pt-4">
            <h3 className="text-sm font-medium text-gray-800">最近研究</h3>
            <div className="mt-3 space-y-2">
              {sessions.slice(0, 8).map(item => (
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
      </div>
    </div>
  );

  const renderRightPanel = () => (
    <div className="flex h-full flex-col bg-white">
      <div className="border-b border-gray-100 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-gray-900">研究上下文</h2>
          <button
            onClick={() => setRightSidebarOpen(false)}
            className="rounded-lg px-2 py-1 text-xs text-gray-400 hover:bg-gray-50 hover:text-gray-600"
          >
            收起
          </button>
        </div>
        <div className="mt-3 grid grid-cols-4 rounded-lg bg-gray-100 p-1 text-xs">
          {[
            ['evidence', '证据'],
            ['graph', '图谱'],
            ['sources', '来源'],
            ['report', '报告'],
          ].map(([value, label]) => (
            <button
              key={value}
              onClick={() => setRightPanelTab(value as RightPanelTab)}
              className={`rounded-md px-2 py-1.5 ${rightPanelTab === value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {rightPanelTab === 'evidence' && (
          <div>
            <p className="text-xs text-gray-500">按 claim 聚合证据，最终报告会优先使用这里的内容。</p>
            <div className="mt-3 space-y-3">
              {evidence.length === 0 ? (
                <div className="rounded-lg bg-gray-50 p-4 text-xs text-gray-400">运行一轮检索后会出现证据。</div>
              ) : evidence.slice(0, 18).map(item => (
                <div key={`${item.id}-${item.source_id}`} className="rounded-lg border border-gray-100 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600">
                      {Math.round(item.confidence * 100)}%
                    </span>
                    <span className="text-[10px] text-gray-400">{item.metadata?.provider || 'source'}</span>
                  </div>
                  <p className="mt-2 text-xs font-medium leading-5 text-gray-700">{item.claim}</p>
                  <p className="mt-1 line-clamp-4 text-xs leading-5 text-gray-500">{item.snippet}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {rightPanelTab === 'graph' && (
          <div className="space-y-3">
            {!graph ? (
              <div className="rounded-lg bg-gray-50 p-4 text-xs text-gray-400">确认研究范围后会生成图谱。</div>
            ) : (
              <>
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
                  {openGaps.length === 0 ? (
                    <div className="rounded-lg bg-green-50 p-3 text-xs text-green-700">当前开放缺口已初步填充。</div>
                  ) : openGaps.map(gap => (
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
              </>
            )}
          </div>
        )}

        {rightPanelTab === 'sources' && (
          <div className="space-y-2">
            {gateDiagnostics && (
              <div className="mb-3 rounded-lg border border-amber-100 bg-amber-50 p-3">
                <div className="text-xs font-medium text-amber-800">
                  Gate: {gateDiagnostics.accepted} accepted / {gateDiagnostics.rejected} rejected
                </div>
                <div className="mt-1 text-[11px] text-amber-700">
                  {gateDiagnostics.fallback ? `Rule fallback: ${gateDiagnostics.fallbackReason || 'reason unavailable'}` : 'LLM evidence gate was used.'}
                </div>
                <div className="mt-3 space-y-2">
                  {gateDiagnostics.acceptedSamples.slice(0, 4).map(item => (
                    <div key={`accepted-${item.sourceId}`} className="rounded-md bg-white/80 p-2 text-[11px] text-green-800">
                      <div className="font-medium">Accepted: {item.title}</div>
                      <div className="mt-1">{item.reason}</div>
                    </div>
                  ))}
                  {gateDiagnostics.rejectedSamples.slice(0, 5).map(item => (
                    <div key={`rejected-${item.sourceId}`} className="rounded-md bg-white/80 p-2 text-[11px] text-red-800">
                      <div className="font-medium">Rejected: {item.title}</div>
                      <div className="mt-1">{item.reason}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {contextSources.length === 0 ? (
              <div className="rounded-lg bg-gray-50 p-4 text-xs text-gray-400">预检索或运行检索后会显示来源。</div>
            ) : contextSources.slice(0, 24).map(source => (
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
                <p className="mt-1 line-clamp-3 text-xs text-gray-500">{source.fullTextExcerpt || source.snippet}</p>
              </a>
            ))}
          </div>
        )}

        {rightPanelTab === 'report' && (
          <div>
            {!draft ? (
              <div className="rounded-lg bg-gray-50 p-4 text-xs text-gray-400">生成报告后可在这里预览。</div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => downloadArtifact('markdown')} className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-800">
                    下载 Markdown
                  </button>
                  <button onClick={() => downloadArtifact('docx')} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 hover:border-gray-300">
                    下载 DOCX
                  </button>
                </div>
                <article
                  className="prose prose-sm max-w-none break-words prose-headings:text-gray-900 prose-p:leading-7 prose-p:text-gray-700 prose-li:leading-7 prose-li:marker:text-gray-300 prose-code:break-words prose-pre:whitespace-pre-wrap"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(draft) }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="relative mx-auto flex h-[calc(100dvh-6rem)] max-w-[1800px] overflow-hidden bg-gray-50 lg:h-[calc(100vh-4rem)]">
      {leftSidebarOpen && (
        <>
          <button
            type="button"
            aria-label="关闭研究控制台"
            className="fixed inset-0 z-30 bg-black/30 lg:hidden"
            onClick={() => setLeftSidebarOpen(false)}
          />
          <aside className="fixed inset-y-0 left-0 z-40 w-80 max-w-[86vw] border-r border-gray-200 shadow-xl lg:static lg:z-auto lg:w-[280px] lg:max-w-none lg:flex-shrink-0 lg:shadow-none">
            {renderLeftSidebar()}
          </aside>
        </>
      )}

      <main className="flex min-w-0 flex-1 flex-col bg-white">
        <header className="flex flex-col gap-3 border-b border-gray-100 px-3 py-3 sm:px-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-2">
            <button
              onClick={() => setLeftSidebarOpen(prev => !prev)}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-50 hover:text-gray-600"
              aria-label="切换研究控制台"
            >
              <MenuIcon />
            </button>
            <div className="min-w-0">
              <div className="text-[10px] font-medium uppercase text-gray-400">Research Chat</div>
              <h1 className="mt-0.5 truncate text-base font-semibold text-gray-900">{session?.topic || '从一个研究问题开始'}</h1>
              <p className="mt-0.5 text-xs text-gray-500">
                {graph
                  ? `${graph.nodes.length} 节点 / ${graph.edges.length} 超边 / ${openGaps.length} 个开放缺口 / ${evidence.length} 条证据`
                  : '确认范围后，检索计划会作为对话卡片出现在这里。'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {sources.map(source => (
              <span key={source} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">{source}</span>
            ))}
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs text-blue-600">{depth}</span>
            <button
              onClick={() => setRightSidebarOpen(prev => !prev)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-50 hover:text-gray-600"
              aria-label="切换研究上下文"
            >
              <PanelIcon />
            </button>
            <Link href="/search" className="hidden rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:border-gray-300 sm:inline-flex">
              轻量搜索
            </Link>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto bg-gray-50/60 px-3 py-4 sm:px-4">
          <div className="mx-auto max-w-4xl space-y-4">
            {!session && (
              <div className="mx-auto mt-12 max-w-2xl rounded-lg border border-dashed border-gray-200 bg-white p-8 text-center">
                <h3 className="text-base font-medium text-gray-800">输入研究主题，然后让 Synap 先做预检索</h3>
                <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-gray-500">
                  它会生成研究方向卡片，你确认范围后，再进入多轮检索、证据填充和报告生成。
                </p>
                {!leftSidebarOpen && (
                  <button
                    onClick={() => setLeftSidebarOpen(true)}
                    className="mt-4 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
                  >
                    打开研究控制台
                  </button>
                )}
              </div>
            )}

            {timeline.map(item => (
              <div key={item.id} className={`flex ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[92%] rounded-lg px-3 py-2 text-sm shadow-sm sm:max-w-[86%] ${
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

            {gateDiagnostics && (
              <div className="rounded-lg border border-amber-100 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-gray-900">Evidence Gate Diagnostics</h3>
                    <p className="mt-1 text-xs text-gray-500">Passed {gateDiagnostics.accepted}, rejected {gateDiagnostics.rejected}. {gateDiagnostics.fallback ? `Rule fallback: ${gateDiagnostics.fallbackReason || 'reason unavailable'}` : 'LLM gate was used.'}</p>
                  </div>
                  <button
                    onClick={() => { setRightPanelTab('sources'); setRightSidebarOpen(true); }}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 hover:border-gray-300"
                  >
                    View sources
                  </button>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div>
                    <div className="text-xs font-medium text-green-700">Accepted samples</div>
                    <div className="mt-2 space-y-2">
                      {(gateDiagnostics.acceptedSamples.length ? gateDiagnostics.acceptedSamples : []).slice(0, 4).map(item => (
                        <div key={item.sourceId} className="rounded-lg bg-green-50 p-2 text-xs text-green-800">
                          <div className="font-medium">{item.title}</div>
                          <div className="mt-1 opacity-80">{item.reason}</div>
                        </div>
                      ))}
                      {gateDiagnostics.acceptedSamples.length === 0 && <div className="rounded-lg bg-gray-50 p-2 text-xs text-gray-400">No samples yet</div>}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-red-700">Rejected samples</div>
                    <div className="mt-2 space-y-2">
                      {gateDiagnostics.rejectedSamples.slice(0, 4).map(item => (
                        <div key={item.sourceId} className="rounded-lg bg-red-50 p-2 text-xs text-red-800">
                          <div className="font-medium">{item.title}</div>
                          <div className="mt-1 opacity-80">{item.reason}</div>
                        </div>
                      ))}
                      {gateDiagnostics.rejectedSamples.length === 0 && <div className="rounded-lg bg-gray-50 p-2 text-xs text-gray-400">No samples yet</div>}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {graph && (
              <div className="rounded-lg border border-blue-100 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-gray-900">下一轮检索计划</h3>
                    <p className="mt-1 text-xs text-gray-500">
                      这里是可交互修改区。先规划下一轮，改掉不准确的 query，再按当前计划检索。
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
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-gray-900">报告文件已生成</h3>
                    <p className="mt-1 text-xs text-gray-500">可以下载文件，或在右侧“报告”面板预览。</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => downloadArtifact('markdown')} className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800">下载 Markdown</button>
                    <button onClick={() => downloadArtifact('docx')} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:border-gray-300">下载 DOCX</button>
                    <button
                      onClick={() => {
                        setRightPanelTab('report');
                        setRightSidebarOpen(true);
                      }}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:border-gray-300"
                    >
                      查看报告
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {graph && (
          <div className="border-t border-gray-100 bg-white px-3 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-4 lg:pb-3">
            <div className="mx-auto flex max-w-4xl flex-wrap gap-2">
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
        )}
      </main>

      {rightSidebarOpen && (
        <>
          <button
            type="button"
            aria-label="关闭研究上下文"
            className="fixed inset-0 z-30 bg-black/30 lg:hidden"
            onClick={() => setRightSidebarOpen(false)}
          />
          <aside className="fixed inset-y-0 right-0 z-40 w-[360px] max-w-[90vw] border-l border-gray-200 shadow-xl lg:static lg:z-auto lg:w-[360px] lg:flex-shrink-0 lg:shadow-none">
            {renderRightPanel()}
          </aside>
        </>
      )}
    </div>
  );
}
