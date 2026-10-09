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

const LOOP_STEPS = [
  { title: '导入资料', desc: '上传文档或录入题目' },
  { title: '整理笔记', desc: '提炼要点，形成自己的表达' },
  { title: '主动练习', desc: '做题并检验理解' },
  { title: '间隔复习', desc: '在遗忘之前回顾' },
];

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

  const stats = [
    { label: '待复习', value: data.dueReviews, href: '/review', unit: '张卡片', tone: 'text-blue-600 bg-blue-50' },
    { label: '今日已复习', value: data.reviewsToday, href: '/review', unit: '张卡片', tone: 'text-emerald-600 bg-emerald-50' },
    { label: '本周新增题目', value: data.questionsThisWeek, href: '/questions', unit: '道题', tone: 'text-violet-600 bg-violet-50' },
  ];

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <section className="relative mb-8 overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 via-blue-600 to-indigo-600 px-6 py-7 text-white shadow-lg shadow-blue-600/20 sm:px-8">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-20 right-24 h-40 w-40 rounded-full bg-indigo-300/20 blur-2xl" aria-hidden="true" />
        <div className="relative">
          <p className="text-sm text-blue-100">{new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">{userName ? `${userName}，今天学点什么？` : '今天学点什么？'}</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-blue-100">从一次复习开始，把资料、练习和笔记串成持续学习的闭环。</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/review" className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-blue-700 shadow-sm transition-colors hover:bg-blue-50">
              开始复习{data.dueReviews > 0 ? `（${data.dueReviews}）` : ''}
            </Link>
            <Link href="/questions" className="rounded-lg border border-white/30 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/10">
              进入题库
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3" aria-label="学习概览">
        {stats.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="group flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
          >
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${item.tone}`}>
              <span className="h-2.5 w-2.5 rounded-full bg-current" />
            </span>
            <div className="min-w-0">
              <p className="text-xs text-gray-500">{item.label}</p>
              <p className="mt-0.5 text-2xl font-semibold tabular-nums text-gray-900">
                {loading ? <span className="text-gray-300">—</span> : item.value}
                <span className="ml-1 text-xs font-normal text-gray-400">{item.unit}</span>
              </p>
            </div>
          </Link>
        ))}
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">最近题目</h2>
            <Link href="/questions" className="text-xs font-medium text-blue-600 hover:text-blue-700">查看题库 →</Link>
          </div>
          {data.recentQuestions.length ? (
            <ul className="space-y-2">
              {data.recentQuestions.map((question) => (
                <li key={question.id}>
                  <Link href={`/questions/${question.id}`} className="block truncate rounded-lg border border-transparent bg-gray-50 px-3 py-2.5 text-sm text-gray-700 transition-colors hover:border-blue-100 hover:bg-blue-50 hover:text-blue-700">
                    {question.question_text || '未命名题目'}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg bg-gray-50 px-3 py-6 text-center text-sm text-gray-400">还没有题目，先去创建一道题吧。</p>
          )}
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">最近笔记</h2>
            <Link href="/notes" className="text-xs font-medium text-blue-600 hover:text-blue-700">查看笔记 →</Link>
          </div>
          {data.recentNotes.length ? (
            <ul className="space-y-2">
              {data.recentNotes.map((note) => (
                <li key={note.id}>
                  <Link href={`/notes/${note.id}`} className="block truncate rounded-lg border border-transparent bg-gray-50 px-3 py-2.5 text-sm text-gray-700 transition-colors hover:border-blue-100 hover:bg-blue-50 hover:text-blue-700">
                    {note.title || '未命名笔记'}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg bg-gray-50 px-3 py-6 text-center text-sm text-gray-400">还没有笔记，记录今天学到的内容。</p>
          )}
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-gray-900">学习闭环</h2>
        <p className="mt-1 text-xs text-gray-500">每一步都会为下一步提供素材。</p>
        <ol className="mt-4 grid gap-3 sm:grid-cols-4">
          {LOOP_STEPS.map((step, index) => (
            <li key={step.title} className="relative rounded-lg bg-gray-50 p-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white shadow-sm">{index + 1}</span>
              <p className="mt-2 text-sm font-medium text-gray-900">{step.title}</p>
              <p className="mt-0.5 text-xs leading-5 text-gray-500">{step.desc}</p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
