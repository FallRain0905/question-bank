'use client';

import { usePathname, useRouter } from 'next/navigation';

interface TabItem {
  id: string;
  label: string;
  icon: (active: boolean) => React.ReactNode;
  path: string;
}

const tabs: TabItem[] = [
  {
    id: 'home',
    label: '首页',
    icon: (active) => (
      <svg className={`w-5 h-5 transition-colors ${active ? 'text-gray-500' : 'text-gray-400'}`} fill={active ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
    path: '/'
  },
  {
    id: 'search',
    label: '题库',
    icon: (active) => (
      <svg className={`w-5 h-5 transition-colors ${active ? 'text-gray-500' : 'text-gray-400'}`} fill={active ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
    path: '/search'
  },
  {
    id: 'upload',
    label: '上传',
    icon: (active) => (
      <div className={`w-11 h-11 -mt-5 rounded-full flex items-center justify-center transition-all ${
        active
          ? 'bg-gray-500 shadow-lg shadow-gray-500/30'
          : 'bg-gray-600 shadow-md'
      }`}>
        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </div>
    ),
    path: '/upload'
  },
  {
    id: 'notes',
    label: '笔记',
    icon: (active) => (
      <svg className={`w-5 h-5 transition-colors ${active ? 'text-gray-500' : 'text-gray-400'}`} fill={active ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
    path: '/notes'
  },
  {
    id: 'me',
    label: '我的',
    icon: (active) => (
      <svg className={`w-5 h-5 transition-colors ${active ? 'text-gray-500' : 'text-gray-400'}`} fill={active ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
    path: '/me'
  },
];

export default function MobileTabBar() {
  const pathname = usePathname();
  const router = useRouter();

  const isActive = (tab: TabItem) => {
    if (tab.id === 'home') return pathname === '/';
    return pathname.startsWith(tab.path);
  };

  return (
    <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-50">
      {/* 毛玻璃背景 */}
      <div className="bg-white/80 backdrop-blur-xl border-t border-gray-200/50">
        <div className="flex items-center justify-around py-2 px-2 safe-area-inset-bottom">
          {tabs.map((tab) => {
            const active = isActive(tab);
            return (
              <button
                key={tab.id}
                onClick={() => router.push(tab.path)}
                className={`flex flex-col items-center justify-center min-w-[48px] py-1 transition-all duration-200 ${
                  active ? 'scale-105' : ''
                }`}
              >
                {tab.icon(active)}
                {tab.id !== 'upload' && (
                  <span className={`text-[10px] font-medium mt-0.5 transition-colors ${
                    active ? 'text-gray-600' : 'text-gray-400'
                  }`}>
                    {tab.label}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {/* iOS安全区域 */}
        <div className="h-[env(safe-area-inset-bottom,0px)]" />
      </div>
    </nav>
  );
}
