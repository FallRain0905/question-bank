'use client';

import { useState } from 'react';
import { renderLatexText } from '@/lib/render-markdown';
import type { Grade } from '@/lib/review';

interface FlashcardProps {
  /** 正面：题干 / 单词 */
  front: string;
  /** 背面：答案 / 释义 */
  back: string;
  frontImageUrl?: string | null;
  backImageUrl?: string | null;
  /** 翻卡判分回调：答对 / 答错 / 重来 */
  onGrade: (grade: Grade) => void;
  disabled?: boolean;
}

const GRADE_BUTTONS: { grade: Grade; label: string; className: string }[] = [
  { grade: 'again', label: '答错', className: 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100' },
  { grade: 'hard', label: '重来', className: 'bg-amber-50 text-amber-600 border-amber-200 hover:bg-amber-100' },
  { grade: 'good', label: '答对', className: 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100' },
];

export default function Flashcard({
  front,
  back,
  frontImageUrl,
  backImageUrl,
  onGrade,
  disabled = false,
}: FlashcardProps) {
  const [flipped, setFlipped] = useState(false);

  return (
    <div className="w-full max-w-xl mx-auto">
      {/* 翻转卡片 */}
      <div
        className="relative w-full cursor-pointer select-none [perspective:1200px]"
        onClick={() => !disabled && setFlipped(f => !f)}
      >
        <div
          className={`relative h-72 sm:h-80 w-full transition-transform duration-500 [transform-style:preserve-3d] ${
            flipped ? '[transform:rotateY(180deg)]' : ''
          }`}
        >
          {/* 正面 */}
          <div className="absolute inset-0 flex flex-col rounded-2xl border border-gray-200 bg-white shadow-sm [backface-visibility:hidden]">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <span className="text-xs font-medium text-gray-400">问题</span>
              <span className="text-xs text-gray-300">点击翻面查看答案</span>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 text-gray-800">
              {front ? (
                <div
                  className="text-lg leading-relaxed whitespace-pre-wrap"
                  dangerouslySetInnerHTML={{ __html: renderLatexText(front) }}
                />
              ) : (
                <span className="text-gray-400">（无题干）</span>
              )}
              {frontImageUrl && (
                <img
                  src={frontImageUrl}
                  alt="题目图片"
                  className="mt-3 max-w-full max-h-40 mx-auto rounded-lg border border-gray-200 object-contain"
                />
              )}
            </div>
          </div>

          {/* 背面 */}
          <div className="absolute inset-0 flex flex-col rounded-2xl border border-blue-200 bg-blue-50/60 shadow-sm [backface-visibility:hidden] [transform:rotateY(180deg)]">
            <div className="flex items-center justify-between px-5 py-3 border-b border-blue-100">
              <span className="text-xs font-medium text-blue-600">答案</span>
              <span className="text-xs text-blue-300">点击返回题目</span>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 text-slate-800">
              {back ? (
                <div
                  className="text-lg leading-relaxed whitespace-pre-wrap"
                  dangerouslySetInnerHTML={{ __html: renderLatexText(back) }}
                />
              ) : (
                <span className="text-gray-400">（无答案）</span>
              )}
              {backImageUrl && (
                <img
                  src={backImageUrl}
                  alt="答案图片"
                  className="mt-3 max-w-full max-h-40 mx-auto rounded-lg border border-blue-200 object-contain"
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 判分按钮（翻面后显示） */}
      <div className={`mt-4 grid grid-cols-3 gap-3 transition-opacity ${flipped ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        {GRADE_BUTTONS.map(({ grade, label, className }) => (
          <button
            key={grade}
            type="button"
            disabled={disabled}
            onClick={() => onGrade(grade)}
            className={`py-3 text-sm font-semibold rounded-xl border transition-colors disabled:opacity-50 ${className}`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
