'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('页面错误:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="text-center max-w-md">
        <div className="text-4xl mb-4">!</div>
        <h2 className="text-xl font-semibold text-gray-700 mb-2">页面加载出错</h2>
        <p className="text-sm text-gray-500 mb-6">
          {error.message || '页面发生了未知错误，请稍后再试。'}
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-6 py-2.5 bg-gray-500 text-white rounded-full hover:bg-gray-600 transition text-sm font-medium"
          >
            重试
          </button>
          <Link
            href="/"
            className="px-6 py-2.5 bg-white text-gray-600 border border-gray-200 rounded-full hover:bg-gray-50 transition text-sm font-medium inline-block"
          >
            返回首页
          </Link>
        </div>
      </div>
    </div>
  );
}
