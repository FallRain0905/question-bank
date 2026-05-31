'use client';

import Link from 'next/link';

export default function ResearchGraphPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="rounded-lg border border-gray-200 bg-white p-8">
        <span className="rounded bg-blue-50 px-2 py-1 text-xs font-medium text-blue-600">Research Graph</span>
        <h1 className="mt-4 text-2xl font-semibold text-gray-900">长期研究图谱</h1>
        <p className="mt-3 text-sm leading-6 text-gray-500">
          这里将用于沉淀完成后的研究会话，把临时检索超图写入长期科研图谱。第一阶段先在每个 Research Session 内维护临时图谱和 Evidence Board。
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/research" className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800">
            进入深度研究
          </Link>
          <Link href="/papers" className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-600 hover:border-gray-300">
            查看论文库
          </Link>
        </div>
      </div>
    </div>
  );
}
