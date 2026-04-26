import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="text-center max-w-md">
        <div className="text-6xl font-bold text-gray-300 mb-4">404</div>
        <h2 className="text-xl font-semibold text-gray-700 mb-2">页面未找到</h2>
        <p className="text-sm text-gray-500 mb-6">
          你访问的页面不存在或已被移除。
        </p>
        <Link
          href="/"
          className="inline-block px-6 py-2.5 bg-gray-500 text-white rounded-full hover:bg-gray-600 transition text-sm font-medium"
        >
          返回首页
        </Link>
      </div>
    </div>
  );
}
