'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabase';

interface ProgressData {
  totalQuestions: number;
  totalNotes: number;
  totalReviews: number;
  reviewsThisWeek: number;
  activeDays: number;
}

const EMPTY_PROGRESS: ProgressData = {
  totalQuestions: 0,
  totalNotes: 0,
  totalReviews: 0,
  reviewsThisWeek: 0,
  activeDays: 0,
};

function startOfWeek() {
  const date = new Date();
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

export default function ProgressPage() {
  const [progress, setProgress] = useState<ProgressData>(EMPTY_PROGRESS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProgress();
  }, []);

  const loadProgress = async () => {
    try {
      const supabase = getSupabase();
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) return;

      const week = startOfWeek();
      const [questions, notes, reviews, weekReviews] = await Promise.all([
        supabase.from('questions').select('id', { count: 'exact', head: true }).eq('user_id', authData.user.id),
        supabase.from('notes').select('id', { count: 'exact', head: true }).eq('user_id', authData.user.id),
        supabase.from('review_logs').select('reviewed_at').eq('user_id', authData.user.id).order('reviewed_at', { ascending: false }).limit(1000),
        supabase.from('review_logs').select('id', { count: 'exact', head: true }).eq('user_id', authData.user.id).gte('reviewed_at', week),
      ]);

      const activeDays = new Set(
        (reviews.data || []).map((row) => new Date(row.reviewed_at).toLocaleDateString('zh-CN')),
      ).size;
      setProgress({
        totalQuestions: questions.count || 0,
        totalNotes: notes.count || 0,
        totalReviews: reviews.data?.length || 0,
        reviewsThisWeek: weekReviews.count || 0,
        activeDays,
      });
    } finally {
      setLoading(false);
    }
  };

  const stats = [
    { label: '累计练习', value: progress.totalQuestions, suffix: ' 道题', href: '/questions' },
    { label: '累计复习', value: progress.totalReviews, suffix: ' 次', href: '/review' },
    { label: '本周复习', value: progress.reviewsThisWeek, suffix: ' 次', href: '/review' },
    { label: '学习天数', value: progress.activeDays, suffix: ' 天', href: '/review' },
  ];

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="text-sm text-gray-500">学习反馈</p>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900">学习进度</h1>
          <p className="mt-2 text-sm text-gray-500">从练习记录和复习日志观察自己的学习节奏。</p>
        </div>
        <Link href="/" className="text-sm text-blue-600 hover:text-blue-700">回到今日学习 →</Link>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.href} className="rounded-xl border border-gray-200 bg-white p-5 hover:shadow-sm">
            <p className="text-xs text-gray-500">{stat.label}</p>
            <p className="mt-3 text-3xl font-semibold text-gray-900">{loading ? '—' : stat.value}<span className="ml-1 text-xs font-normal text-gray-400">{stat.suffix}</span></p>
          </Link>
        ))}
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="font-medium text-gray-900">当前学习闭环</h2>
          <div className="mt-5 space-y-4">
            {[
              ['整理资料', '把课程内容沉淀为笔记和题目'],
              ['主动练习', '先作答，再查看答案并自评'],
              ['间隔复习', '让到期内容重新进入记忆'],
            ].map(([title, description], index) => (
              <div key={title} className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-600">{index + 1}</span>
                <div><p className="text-sm font-medium text-gray-800">{title}</p><p className="mt-1 text-xs text-gray-500">{description}</p></div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-5">
          <h2 className="font-medium text-gray-900">下一步</h2>
          <p className="mt-2 text-sm leading-6 text-gray-500">学习进度会随着题目练习和复习日志逐步丰富。先完成一次练习或复习，系统就能开始记录你的学习轨迹。</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/questions" className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800">去题库练习</Link>
            <Link href="/notes/new" className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">写一篇笔记</Link>
          </div>
        </div>
      </section>

      <p className="mt-6 text-xs text-gray-400">当前统计基于已有练习和复习日志；课程、主题和薄弱知识点将在后续数据模型完成后加入。</p>
    </main>
  );
}
