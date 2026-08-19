'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabase';
import Flashcard from '@/components/review/Flashcard';
import {
  nextSchedule,
  dueAtFor,
  computeStreak,
  DEFAULT_EASE,
  type Grade,
} from '@/lib/review';
import { ListSkeleton } from '@/components/Skeleton';

interface DueCard {
  scheduleId: string;
  questionId: string;
  ease: number;
  intervalDays: number;
  reps: number;
  front: string;
  back: string;
  frontImageUrl: string | null;
  backImageUrl: string | null;
}

interface Candidate {
  id: string;
  question_text: string | null;
  answer_text: string | null;
  question_image_url: string | null;
  answer_image_url: string | null;
}

export default function ReviewPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState<DueCard[]>([]);
  const [todayDone, setTodayDone] = useState(0);
  const [streak, setStreak] = useState(0);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [grading, setGrading] = useState(false);

  const loadQueue = useCallback(async (uid: string) => {
    const now = new Date();
    const { data: scheds } = await getSupabase()
      .from('review_schedule')
      .select('*')
      .eq('user_id', uid)
      .lte('due_at', now.toISOString())
      .order('due_at', { ascending: true });

    const schedList = scheds || [];
    const qMap: Record<string, Candidate> = {};
    if (schedList.length) {
      const ids = schedList.map(s => s.question_id);
      const { data: qs } = await getSupabase()
        .from('questions')
        .select('id, question_text, answer_text, question_image_url, answer_image_url')
        .in('id', ids);
      for (const q of qs || []) qMap[q.id] = q;
    }

    const cards: DueCard[] = schedList
      .filter(s => qMap[s.question_id])
      .map(s => ({
        scheduleId: s.id,
        questionId: s.question_id,
        ease: s.ease,
        intervalDays: s.interval_days,
        reps: s.reps,
        front: qMap[s.question_id].question_text || '',
        back: qMap[s.question_id].answer_text || '',
        frontImageUrl: qMap[s.question_id].question_image_url,
        backImageUrl: qMap[s.question_id].answer_image_url,
      }));
    setQueue(cards);
  }, []);

  const loadStats = useCallback(async (uid: string) => {
    const { data: logs } = await getSupabase()
      .from('review_logs')
      .select('reviewed_at')
      .eq('user_id', uid)
      .order('reviewed_at', { ascending: false })
      .limit(1000);

    const logList = logs || [];
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayCount = logList.filter(l => new Date(l.reviewed_at) >= startOfToday).length;
    setTodayDone(todayCount);
    setStreak(computeStreak(logList.map(l => l.reviewed_at), now));
  }, []);

  const loadCandidates = useCallback(async (uid: string) => {
    const [ownRes, schedRes] = await Promise.all([
      getSupabase()
        .from('questions')
        .select('id, question_text, answer_text, question_image_url, answer_image_url')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .limit(100),
      getSupabase().from('review_schedule').select('question_id').eq('user_id', uid),
    ]);

    const scheduled = new Set((schedRes.data || []).map(r => r.question_id));
    const own = (ownRes.data || []) as Candidate[];
    setCandidates(own.filter(q => !scheduled.has(q.id)));
  }, []);

  useEffect(() => {
    (async () => {
      const supabase = getSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      setUserId(user.id);
      await Promise.all([loadQueue(user.id), loadStats(user.id)]);
      setLoading(false);
    })();
  }, [loadQueue, loadStats]);

  useEffect(() => {
    if (addOpen && userId) loadCandidates(userId);
  }, [addOpen, userId, loadCandidates]);

  const handleGrade = async (grade: Grade) => {
    if (!userId || queue.length === 0 || grading) return;
    const card = queue[0];
    setGrading(true);

    const now = new Date();
    const next = nextSchedule(grade, {
      ease: card.ease,
      intervalDays: card.intervalDays,
      reps: card.reps,
    });
    const dueAt = dueAtFor(next.intervalDays, now).toISOString();

    try {
      const supabase = getSupabase();
      await supabase.from('review_schedule')
        .update({
          ease: next.ease,
          interval_days: next.intervalDays,
          reps: next.reps,
          due_at: dueAt,
          last_reviewed_at: now.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq('id', card.scheduleId);

      await supabase.from('review_logs').insert({
        user_id: userId,
        schedule_id: card.scheduleId,
        question_id: card.questionId,
        grade,
        ease: next.ease,
        interval_days: next.intervalDays,
        reviewed_at: now.toISOString(),
      });

      // 答错立即进入重做队列（本轮再次出现）
      setQueue(prev => {
        const rest = prev.slice(1);
        if (grade === 'again') {
          return [...rest, { ...card, ease: next.ease, intervalDays: next.intervalDays, reps: next.reps }];
        }
        return rest;
      });
      setTodayDone(d => d + 1);
    } catch {
      /* 网络失败时保持原状态，允许重试 */
    } finally {
      setGrading(false);
    }
  };

  const addOne = async (q: Candidate) => {
    if (!userId) return;
    setAdding(true);
    try {
      const { data, error } = await getSupabase()
        .from('review_schedule')
        .insert({ user_id: userId, question_id: q.id })
        .select()
        .single();
      if (error) {
        alert('加入失败: ' + error.message);
        return;
      }
      setCandidates(prev => prev.filter(c => c.id !== q.id));
      setQueue(prev => [
        ...prev,
        {
          scheduleId: data.id,
          questionId: q.id,
          ease: DEFAULT_EASE,
          intervalDays: 0,
          reps: 0,
          front: q.question_text || '',
          back: q.answer_text || '',
          frontImageUrl: q.question_image_url,
          backImageUrl: q.answer_image_url,
        },
      ]);
    } catch {
      alert('加入失败');
    } finally {
      setAdding(false);
    }
  };

  const addAll = async () => {
    if (!userId || candidates.length === 0) return;
    setAdding(true);
    try {
      const rows = candidates.map(q => ({ user_id: userId, question_id: q.id }));
      const { error } = await getSupabase().from('review_schedule').insert(rows);
      if (error) {
        alert('加入失败: ' + error.message);
        return;
      }
      setCandidates([]);
      await loadQueue(userId);
    } catch {
      alert('加入失败');
    } finally {
      setAdding(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-4 sm:py-6">
        <ListSkeleton count={2} />
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <div className="text-5xl mb-4">📖</div>
        <p className="text-gray-500 mb-1">请先登录后再复习</p>
        <p className="text-sm text-gray-400 mb-6">登录后可加入题目，按记忆曲线安排复习。</p>
        <Link
          href="/login"
          className="inline-flex px-5 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
        >
          前往登录
        </Link>
      </div>
    );
  }

  const total = todayDone + queue.length;
  const progressPct = total === 0 ? 0 : Math.round((todayDone / total) * 100);
  const current = queue[0];

  return (
    <div className="max-w-3xl mx-auto px-4 py-4 sm:py-6">
      {/* Header + stats */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-gray-400">Spaced Repetition</div>
          <h1 className="text-xl font-bold text-slate-800">复习</h1>
        </div>
        <button
          onClick={() => setAddOpen(o => !o)}
          className="inline-flex items-center gap-1 px-4 py-2 text-sm font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
        >
          {addOpen ? '收起' : '＋ 添加题目'}
        </button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-white border border-gray-100 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-slate-800">{queue.length}</div>
          <div className="text-xs text-gray-400 mt-1">待复习</div>
        </div>
        <div className="bg-white border border-gray-100 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-emerald-600">{todayDone}</div>
          <div className="text-xs text-gray-400 mt-1">今日已复习</div>
        </div>
        <div className="bg-white border border-gray-100 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-orange-500">{streak}</div>
          <div className="text-xs text-gray-400 mt-1">连续打卡（天）</div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-gray-400">今日进度</span>
          <span className="text-xs font-medium text-gray-500">{progressPct}%</span>
        </div>
        <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Add panel */}
      {addOpen && (
        <div className="bg-white border border-gray-100 rounded-xl p-4 sm:p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-700">从题库添加（未加入的题目）</h2>
            {candidates.length > 0 && (
              <button
                onClick={addAll}
                disabled={adding}
                className="text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50"
              >
                {adding ? '加入中…' : '全部加入'}
              </button>
            )}
          </div>

          {candidates.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">
              所有题目都已加入复习，或题库还没有你自己的题目。
            </p>
          ) : (
            <div className="max-h-64 overflow-y-auto divide-y divide-gray-50">
              {candidates.map(q => (
                <div key={q.id} className="flex items-center justify-between gap-3 py-2.5">
                  <p className="flex-1 text-sm text-gray-700 line-clamp-2 min-w-0">
                    {q.question_text || '（无题干）'}
                  </p>
                  <button
                    onClick={() => addOne(q)}
                    disabled={adding}
                    className="shrink-0 px-3 py-1.5 text-xs font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors disabled:opacity-50"
                  >
                    加入
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Main area */}
      {current ? (
        <Flashcard
          key={current.scheduleId}
          front={current.front}
          back={current.back}
          frontImageUrl={current.frontImageUrl}
          backImageUrl={current.backImageUrl}
          onGrade={handleGrade}
          disabled={grading}
        />
      ) : (
        <div className="bg-white border border-gray-100 rounded-xl p-10 text-center">
          <div className="text-5xl mb-4">🎉</div>
          <p className="text-gray-600 mb-1">{todayDone > 0 ? '今日复习已完成' : '暂无待复习的题目'}</p>
          <p className="text-sm text-gray-400 mb-6">
            {todayDone > 0 ? '按记忆曲线，答对的题目会延后到到期日再出现。' : '点击「添加题目」把题库里的题目加入复习队列。'}
          </p>
          <button
            onClick={() => setAddOpen(true)}
            className="inline-flex px-5 py-2.5 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 transition-colors"
          >
            ＋ 添加题目
          </button>
        </div>
      )}
    </div>
  );
}
