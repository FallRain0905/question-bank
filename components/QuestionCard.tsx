'use client';

import { useState } from 'react';
import type { QuestionWithTags } from '@/types';
import { getSupabase } from '@/lib/supabase';
import { renderLatexText } from '@/lib/render-markdown';

interface QuestionCardProps {
  question: QuestionWithTags;
  showAnswer?: boolean;
  canDelete?: boolean;
  onDelete?: (id: string) => void;
}

export default function QuestionCard({
  question,
  showAnswer = false,
  canDelete = false,
  onDelete
}: QuestionCardProps) {
  const [show, setShow] = useState(showAnswer);

  const handleDelete = async () => {
    if (!confirm('确定要删除这道题目吗？')) return;

    const { error } = await getSupabase()
      .from('questions')
      .delete()
      .eq('id', question.id);

    if (error) {
      alert('删除失败: ' + error.message);
    } else {
      onDelete?.(question.id);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition">
      {/* 题目区域 */}
      <div className="p-5 border-b border-gray-100">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h3 className="font-medium text-gray-900 mb-2">题目</h3>
            {question.question_text && (
              <div className="text-gray-700 whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: renderLatexText(question.question_text || '') }} />
            )}
            {question.question_image_url && (
              <img
                src={question.question_image_url}
                alt="题目图片"
                className="mt-3 max-w-full h-auto rounded-lg border border-gray-200"
              />
            )}
          </div>
        </div>
      </div>

      {/* 答案区域 */}
      <div className="p-5 bg-gray-50">
        <button
          onClick={() => setShow(!show)}
          className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-blue-600 transition"
        >
          <span className={`transform transition ${show ? 'rotate-90' : ''}`}>▶</span>
          {show ? '隐藏答案' : '查看答案'}
        </button>

        {show && (
          <div className="mt-4 animate-in fade-in slide-in-from-top-2 duration-200">
            {question.answer_text && (
              <div className="text-gray-700 whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: renderLatexText(question.answer_text || '') }} />
            )}
            {question.answer_image_url && (
              <img
                src={question.answer_image_url}
                alt="答案图片"
                className="mt-3 max-w-full h-auto rounded-lg border border-gray-200"
              />
            )}
          </div>
        )}
      </div>

      {/* 底部信息 */}
      <div className="px-5 py-3 bg-white border-t border-gray-100 flex items-center justify-between">
        {/* 标签 */}
        <div className="flex items-center gap-2 flex-wrap">
          {question.tags?.map((tag) => (
            <span
              key={tag.id}
              className="px-2.5 py-1 text-xs font-medium bg-blue-50 text-blue-600 rounded-full"
            >
              {tag.name}
            </span>
          ))}
        </div>

        {/* 操作 */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">
            {new Date(question.created_at).toLocaleDateString('zh-CN')}
          </span>
          {canDelete && (
            <button
              onClick={handleDelete}
              className="text-xs text-red-500 hover:text-red-700 transition"
            >
              删除
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
