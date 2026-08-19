'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabase';
import { ListSkeleton } from '@/components/Skeleton';

type AgentRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

interface AgentRun {
  id: string;
  user_id: string;
  conversation_id: string | null;
  status: AgentRunStatus;
  input: Record<string, any> | null;
  output: Record<string, any> | null;
  error: string;
  metadata: Record<string, any> | null;
  started_at: string;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_META: Record<AgentRunStatus, { label: string; badge: string; dot: string }> = {
  completed: { label: '已完成', badge: 'bg-emerald-50 text-emerald-600 border-emerald-200', dot: 'bg-emerald-500' },
  running: { label: '运行中', badge: 'bg-blue-50 text-blue-600 border-blue-200', dot: 'bg-blue-500' },
  queued: { label: '排队中', badge: 'bg-amber-50 text-amber-600 border-amber-200', dot: 'bg-amber-500' },
  failed: { label: '失败', badge: 'bg-red-50 text-red-600 border-red-200', dot: 'bg-red-500' },
  cancelled: { label: '已取消', badge: 'bg-gray-100 text-gray-500 border-gray-200', dot: 'bg-gray-400' },
};

function formatDateTime(dateStr: string): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(startStr: string, endStr: string | null): string {
  const start = new Date(startStr).getTime();
  if (!Number.isFinite(start)) return '';
  const end = endStr ? new Date(endStr).getTime() : Date.now();
  if (!Number.isFinite(end) || end <= start) return '';
  const diffMs = end - start;
  if (diffMs < 1000) return `${Math.max(1, Math.round(diffMs))} 毫秒`;
  if (diffMs < 60_000) return `${(diffMs / 1000).toFixed(1)} 秒`;
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)} 分 ${Math.round((diffMs % 60_000) / 1000)} 秒`;
  return `${Math.floor(diffMs / 3_600_000)} 小时 ${Math.floor((diffMs % 3_600_000) / 60_000)} 分`;
}

export default function AgentHistoryPage() {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [token, setToken] = useState('');

  const headers = useCallback(
    (): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {}),
    [token]
  );

  useEffect(() => {
    const init = async () => {
      const supabase = getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) setToken(session.access_token);
    };
    init();
  }, []);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError('');
    fetch('/api/agent/runs?limit=50', { headers: headers() })
      .then(async res => {
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error || '加载失败');
        }
        return res.json();
      })
      .then((data: AgentRun[]) => setRuns(Array.isArray(data) ? data : []))
      .catch((err: Error) => setError(err.message || '加载失败'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-4 sm:py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-gray-400">Agent Workspace</div>
          <h1 className="text-xl font-bold text-slate-800">Synapse 运行历史</h1>
        </div>
        <Link
          href="/agent"
          className="inline-flex items-center gap-1 text-sm text-blue-500 hover:text-blue-600 transition-colors"
        >
          ← 返回 Agent
        </Link>
      </div>

      {/* States */}
      {loading ? (
        <ListSkeleton count={3} />
      ) : error ? (
        <div className="bg-white border border-gray-100 rounded-xl p-10 text-center">
          <p className="text-gray-400 mb-4">{error}</p>
          <Link href="/agent" className="text-sm text-blue-500 hover:text-blue-600">
            ← 返回 Agent
          </Link>
        </div>
      ) : runs.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-xl p-10 text-center">
          <div className="text-5xl mb-4">🗂️</div>
          <p className="text-gray-500 mb-1">暂无运行记录</p>
          <p className="text-sm text-gray-400 mb-6">在 Synapse Agent 中发起一次对话后，运行记录会出现在这里。</p>
          <Link
            href="/agent"
            className="inline-flex px-5 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
          >
            前往 Agent
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {runs.map(run => {
            const meta = STATUS_META[run.status] || STATUS_META.cancelled;
            const message = typeof run.input?.message === 'string' ? run.input.message : '';
            const toolCalls = run.output?.toolCallCount;
            const sourceCount = run.output?.sourceCount;
            const documentId = run.output?.documentId;
            const isActive = run.status === 'running' || run.status === 'queued';

            return (
              <div key={run.id} className="bg-white border border-gray-100 rounded-xl p-4 sm:p-5 hover:border-gray-200 transition-colors">
                {/* Status + time */}
                <div className="flex items-center justify-between mb-3">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border ${meta.badge}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${meta.dot} ${isActive ? 'animate-pulse' : ''}`} />
                    {meta.label}
                  </span>
                  <span className="text-xs text-gray-400">{formatDateTime(run.created_at)}</span>
                </div>

                {/* Prompt */}
                {message && (
                  <p className="text-sm text-slate-700 leading-relaxed mb-3 line-clamp-2">
                    {message}
                  </p>
                )}

                {/* Output summary chips */}
                {(toolCalls !== undefined || sourceCount !== undefined || documentId) && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {toolCalls !== undefined && (
                      <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded-full">
                        {toolCalls} 次工具调用
                      </span>
                    )}
                    {sourceCount !== undefined && (
                      <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded-full">
                        {sourceCount} 个来源
                      </span>
                    )}
                    {documentId && (
                      <span className="px-2 py-0.5 text-xs bg-blue-50 text-blue-600 rounded-full">
                        生成文档
                      </span>
                    )}
                  </div>
                )}

                {/* Error */}
                {run.error && (
                  <div className="mb-3 rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-600 leading-relaxed break-words">
                    {run.error}
                  </div>
                )}

                {/* Footer: duration + link */}
                <div className="flex items-center justify-between border-t border-gray-100 pt-3 text-xs">
                  <span className="text-gray-400">
                    {formatDuration(run.started_at || run.created_at, run.finished_at)}
                  </span>
                  {run.conversation_id && (
                    <Link
                      href="/agent"
                      className="text-blue-500 hover:text-blue-600"
                      title="打开对应会话"
                    >
                      查看会话 ↗
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
