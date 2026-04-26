'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import Link from 'next/link';
import type { KBDocument, QuestionData } from '@/types';

export default function GeneratorPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const docId = searchParams.get('doc');
  const prefillText = searchParams.get('text');

  const [sourceText, setSourceText] = useState(prefillText || '');
  const [requirement, setRequirement] = useState('');
  const [questionType, setQuestionType] = useState('choice');
  const [generating, setGenerating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<QuestionData | null>(null);
  const [batchResults, setBatchResults] = useState<QuestionData[]>([]);
  const [batchMode, setBatchMode] = useState(false);
  const [batchCount, setBatchCount] = useState(3);
  const [syncedId, setSyncedId] = useState<string | null>(null);
  const [syncedIds, setSyncedIds] = useState<string[]>([]);
  const [docs, setDocs] = useState<KBDocument[]>([]);

  useEffect(() => {
    const init = async () => {
      const supabase = getSupabase();
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) { router.push('/login'); return; }

      const { data } = await supabase
        .from('kb_documents')
        .select('id, title')
        .eq('user_id', u.id)
        .order('created_at', { ascending: false })
        .limit(10);
      if (data) setDocs(data as KBDocument[]);
    };
    init();
  }, []);

  const handleSelectDoc = async (selectedDocId: string) => {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('kb_documents')
      .select('content_md')
      .eq('id', selectedDocId)
      .single();
    if (data?.content_md) {
      setSourceText(data.content_md.slice(0, 3000));
    }
  };

  const handleGenerate = async () => {
    if (!sourceText.trim() || !requirement.trim()) {
      alert('请输入源文本和出题要求');
      return;
    }
    setGenerating(true);
    setResult(null);
    setBatchResults([]);
    setSyncedId(null);
    setSyncedIds([]);
    try {
      const endpoint = batchMode ? '/api/generator/batch' : '/api/generator/question';
      const body = batchMode
        ? { source_text: sourceText, requirement, question_type: questionType, count: batchCount }
        : { source_text: sourceText, requirement, question_type: questionType };

      const supabase = getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        if (batchMode && data.questions) {
          setBatchResults(data.questions);
        } else {
          setResult(data.question);
        }
      } else {
        alert(data.error || '生成失败');
      }
    } catch {
      alert('网络错误');
    } finally {
      setGenerating(false);
    }
  };

  const handleSyncBatch = async (questionData: QuestionData, index: number) => {
    setSyncing(true);
    try {
      const supabase = getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch('/api/generator/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ question_data: questionData, source_doc_id: docId || null, source_text: sourceText, question_type: questionType }),
      });
      const data = await res.json();
      if (data.success) {
        setSyncedIds((prev) => { const next = [...prev]; next[index] = data.question_id; return next; });
      }
    } catch { /* ignore */ }
    finally { setSyncing(false); }
  };

  const handleSync = async () => {
    if (!result) return;
    setSyncing(true);
    try {
      const supabase = getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch('/api/generator/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          question_data: result,
          source_doc_id: docId || null,
          source_text: sourceText,
          question_type: questionType,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSyncedId(data.question_id);
      } else {
        alert(data.error || '同步失败');
      }
    } catch {
      alert('网络错误');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 sm:py-10">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">出题机</h1>
      <p className="text-sm text-gray-500 mb-8">输入文段，AI 自动生成结构化题目，一键同步到题库</p>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: Input */}
        <div className="space-y-4">
          {/* Source document selector */}
          {docs.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">从知识库选择</label>
              <select
                value={docId || ''}
                onChange={(e) => {
                  if (e.target.value) {
                    router.push(`/generator?doc=${e.target.value}`);
                    handleSelectDoc(e.target.value);
                  }
                }}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none"
              >
                <option value="">手动输入</option>
                {docs.map((d) => (
                  <option key={d.id} value={d.id}>{d.title}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">源文本</label>
            <textarea
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              placeholder="粘贴或从知识库选择文本..."
              rows={8}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-gray-400 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">出题要求</label>
            <input
              type="text"
              value={requirement}
              onChange={(e) => setRequirement(e.target.value)}
              placeholder="例如：生成一道关于牛顿第二定律的选择题，中等难度"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-gray-400"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">题型</label>
            <select
              value={questionType}
              onChange={(e) => setQuestionType(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none"
            >
              <option value="choice">选择题</option>
              <option value="fill_blank">填空题</option>
              <option value="short_answer">简答题</option>
            </select>
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input type="checkbox" checked={batchMode} onChange={(e) => setBatchMode(e.target.checked)} className="rounded" />
              批量生成
            </label>
            {batchMode && (
              <select
                value={batchCount}
                onChange={(e) => setBatchCount(Number(e.target.value))}
                className="px-2 py-1 border border-gray-200 rounded text-sm outline-none"
              >
                {[2,3,5,10].map((n) => <option key={n} value={n}>{n} 道</option>)}
              </select>
            )}
          </div>

          <button
            onClick={handleGenerate}
            disabled={generating}
            className="w-full py-2.5 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            {generating ? '生成中...' : 'AI 生成题目'}
          </button>
        </div>

        {/* Right: Results */}
        <div className="space-y-4">
          {batchMode && batchResults.length > 0 ? (
            batchResults.map((q, i) => (
              <QuestionResultCard
                key={i}
                index={i}
                question={q}
                syncedId={syncedIds[i] || null}
                syncing={syncing}
                onSync={() => handleSyncBatch(q, i)}
              />
            ))
          ) : result ? (
            <QuestionResultCard
              question={result}
              syncedId={syncedId || null}
              syncing={syncing}
              onSync={handleSync}
            />
          ) : (
            <div className="bg-white border border-gray-100 rounded-xl p-8 text-center">
              <p className="text-gray-400 text-sm">输入源文本和要求后，点击生成</p>
              <p className="text-xs text-gray-300 mt-1">{batchMode ? 'AI 将批量生成题目' : 'AI 将按 JSON 格式输出结构化题目'}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function QuestionResultCard({
  index,
  question,
  syncedId,
  syncing,
  onSync,
}: {
  index?: number;
  question: QuestionData;
  syncedId: string | null;
  syncing: boolean;
  onSync: () => void;
}) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {index !== undefined && <span className="text-xs font-bold text-gray-300">#{index + 1}</span>}
          <span className="text-xs font-medium text-gray-400 uppercase">
            {question.question_type === 'choice' ? '选择题' : question.question_type === 'fill_blank' ? '填空题' : '简答题'}
          </span>
        </div>
        {syncedId ? (
          <span className="text-xs text-green-600 font-medium">已同步</span>
        ) : (
          <button onClick={onSync} disabled={syncing} className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {syncing ? '...' : '同步到题库'}
          </button>
        )}
      </div>

      <h3 className="font-medium text-gray-900 mb-3 text-sm">{question.question_text}</h3>

      {question.options && question.options.length > 0 && (
        <div className="space-y-1.5 mb-4">
          {question.options.map((opt, i) => (
            <div key={i} className={`px-3 py-2 rounded-lg text-sm ${
              opt.startsWith(question.answer) ? 'bg-blue-50 text-blue-700 font-medium' : 'bg-gray-50 text-gray-600'
            }`}>
              {opt}
            </div>
          ))}
        </div>
      )}

      {!question.options && (
        <div className="mb-4">
          <div className="px-3 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm">
            <span className="font-medium">答案：</span>{question.answer}
          </div>
        </div>
      )}

      {question.explanation && (
        <div className="p-3 bg-gray-50 rounded-lg">
          <p className="text-xs font-medium text-gray-500 mb-1">解析</p>
          <p className="text-sm text-gray-600">{question.explanation}</p>
        </div>
      )}

      {syncedId && (
        <Link href={`/questions/${syncedId}`} className="block mt-4 text-center text-sm text-blue-600 hover:text-blue-700">
          在题库中查看 →
        </Link>
      )}
    </div>
  );
}
