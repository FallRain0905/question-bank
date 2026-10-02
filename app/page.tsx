'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabase';

interface RecentQuestion {
  id: string;
  question_text: string | null;
  created_at: string;
}

interface RecentNote {
  id: string;
  title: string;
  updated_at: string;
}

interface TodayData {
  dueReviews: number;
  questionsThisWeek: number;
  reviewsToday: number;
  recentQuestions: RecentQuestion[];
  recentNotes: RecentNote[];
}

const EMPTY_DATA: TodayData = {
  dueReviews: 0,
  questionsThisWeek: 0,
  reviewsToday: 0,
  recentQuestions: [],
  recentNotes: [],
};

function startOfWeek() {
  const date = new Date();
  const day = date.getDay();
  const diff = day === 0 ? 6 : day - 1;
  date.setDate(date.getDate() - diff);
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

export default function HomePage() {
  const [userName, setUserName] = useState('');
  const [data, setData] = useState<TodayData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadToday();
  }, []);

  const loadToday = async () => {
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { data: authData } = await supabase.auth.getUser();
      const user = authData.user;
      if (!user) return;

      setUserName(user.user_metadata?.display_name || user.user_metadata?.username || '同学');
      const today = startOfToday();
      const week = startOfWeek();

      const [due, weekQuestions, todayReviews, questions, notes] = await Promise.all([
        supabase.from('review_schedule').select('id', { count: 'exact', head: true }).eq('user_id', user.id).lte('due_at', new Date().toISOString()),
        supabase.from('questions').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', week),
        supabase.from('review_logs').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('reviewed_at', today),
        supabase.from('questions').select('id, question_text, created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(3),
        supabase.from('notes').select('id, title, updated_at').eq('user_id', user.id).order('updated_at', { ascending: false }).limit(3),
      ]);

      setData({
        dueReviews: due.count || 0,
        questionsThisWeek: weekQuestions.count || 0,
        reviewsToday: todayReviews.count || 0,
        recentQuestions: (questions.data || []) as RecentQuestion[],
        recentNotes: (notes.data || []) as RecentNote[],
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <section className="mb-8 rounded-2xl bg-slate-900 px-6 py-7 text-white sm:px-8">
        <p className="text-sm text-slate-300">{new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">{userName ? `${userName}，今天学点什么？` : '今天学点什么？'}</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">从一次复习开始，把资料、练习和笔记串成持续学习的闭环。</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/review" className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-100">开始复习{data.dueReviews > 0 ? `（${data.dueReviews}）` : ''}</Link>
          <Link href="/questions" className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">进入题库</Link>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3" aria-label="学习概览">
        {[
          { label: '待复习', value: data.dueReviews, href: '/review', suffix: ' 张卡片' },
          { label: '今日已复习', value: data.reviewsToday, href: '/review', suffix: ' 张卡片' },
          { label: '本周新增题目', value: data.questionsThisWeek, href: '/questions', suffix: ' 道题' },
        ].map((item) => (
          <Link key={item.label} href={item.href} className="rounded-xl border border-gray-200 bg-white p-4 transition-shadow hover:shadow-sm">
            <p className="text-xs text-gray-500">{item.label}</p>
            <p className="mt-2 text-2xl font-semibold text-gray-900">{loading ? '—' : item.value}<span className="ml-1 text-xs font-normal text-gray-400">{item.suffix}</span></p>
          </Link>
        ))}
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between"><h2 className="font-medium text-gray-900">最近题目</h2><Link href="/questions" className="text-xs text-blue-600 hover:text-blue-700">查看题库 →</Link></div>
          {data.recentQuestions.length ? <div className="space-y-3">{data.recentQuestions.map((question) => <Link key={question.id} href={`/questions/${question.id}`} className="block rounded-lg bg-gray-50 px-3 py-3 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700">{question.question_text || '未命名题目'}</Link>)}</div> : <p className="rounded-lg bg-gray-50 px-3 py-6 text-center text-sm text-gray-400">还没有题目，先去创建一道题吧。</p>}
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between"><h2 className="font-medium text-gray-900">最近笔记</h2><Link href="/notes" className="text-xs text-blue-600 hover:text-blue-700">查看笔记 →</Link></div>
          {data.recentNotes.length ? <div className="space-y-3">{data.recentNotes.map((note) => <Link key={note.id} href={`/notes/${note.id}`} className="block rounded-lg bg-gray-50 px-3 py-3 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700">{note.title || '未命名笔记'}</Link>)}</div> : <p className="rounded-lg bg-gray-50 px-3 py-6 text-center text-sm text-gray-400">还没有笔记，记录今天学到的内容。</p>}
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-5">
        <h2 className="font-medium text-gray-900">学习闭环</h2>
        <div className="mt-4 grid gap-3 text-sm text-gray-600 sm:grid-cols-4">
          {['导入资料', '整理笔记', '主动练习', '间隔复习'].map((step, index) => <div key={step} className="flex items-center gap-2"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-blue-600 shadow-sm">{index + 1}</span>{step}</div>)}
        </div>
      </section>
    </main>
  );
}
