'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';
import type { UserProfile } from '@/types';
import { getSupabase, clearSupabaseCache } from '@/lib/supabase';
import { themes, getCurrentTheme, setCurrentTheme, initTheme, type Theme } from '@/lib/theme';

// Sidebar context: shares collapsed state with layout
interface SidebarContextValue {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}
const SidebarContext = createContext<SidebarContextValue>({ collapsed: false, setCollapsed: () => {} });
export function useSidebar() {
  return useContext(SidebarContext);
}
export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <SidebarContext.Provider value={{ collapsed, setCollapsed }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function SidebarSpacer({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();
  return (
    <div className={`min-w-0 flex-1 transition-all duration-200 ${collapsed ? 'lg:ml-16' : 'lg:ml-60'}`}>
      {children}
    </div>
  );
}

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

// Outline SVG icons
const Icons = {
  home: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  ),
  research: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 4.5l7.5 3.75-7.5 3.75-7.5-3.75 7.5-3.75z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12l7.5 3.75 7.5-3.75M3.75 15.75l7.5 3.75 7.5-3.75" />
    </svg>
  ),
  search: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  ),
  notes: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  papers: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
    </svg>
  ),
  classes: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
  ),
  upload: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
    </svg>
  ),
  parse: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  admin: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  notifications: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  ),
  user: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  ),
  heart: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
    </svg>
  ),
  logout: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  ),
  kb: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  ),
  graph: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 7.5a2.25 2.25 0 100-4.5 2.25 2.25 0 000 4.5zM18 21a2.25 2.25 0 100-4.5 2.25 2.25 0 000 4.5zM18 7.5a2.25 2.25 0 100-4.5 2.25 2.25 0 000 4.5zM6 7.5v3.75A2.25 2.25 0 008.25 13.5h7.5A2.25 2.25 0 0118 15.75v.75M18 7.5v3.75a2.25 2.25 0 01-2.25 2.25H12" />
    </svg>
  ),
  qa: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 9.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm3.75 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm3.75 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12c0 4.418-4.03 8-9 8a9.77 9.77 0 01-3.64-.68L3 21l1.68-4.48A7.39 7.39 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  ),
  settings: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  review: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 12a8 8 0 11-2.343-5.657L13 9" />
    </svg>
  ),
  more: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm6 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm6 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
    </svg>
  ),
};

const mainNavItems: NavItem[] = [
  { href: '/agent', label: 'Agent', icon: Icons.qa },
  { href: '/research', label: '研究', icon: Icons.research },
  { href: '/search', label: '搜索', icon: Icons.search },
  { href: '/kb', label: '知识库', icon: Icons.kb },
  { href: '/qa', label: '知识问答', icon: Icons.qa },
  { href: '/reader', label: 'AI 阅读', icon: Icons.papers },
  { href: '/papers', label: '论文库', icon: Icons.papers },
  { href: '/graph', label: '研究图谱', icon: Icons.graph },
  { href: '/questions', label: '题库', icon: Icons.search },
  { href: '/review', label: '复习', icon: Icons.review },
  { href: '/notes', label: '笔记', icon: Icons.notes },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { collapsed, setCollapsed } = useSidebar();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [reviewDueCount, setReviewDueCount] = useState(0);
  const [isClassModerator, setIsClassModerator] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [currentTheme, setCurrentThemeState] = useState<Theme>(getCurrentTheme());
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    initTheme();
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
      if (window.innerWidth < 1024) setCollapsed(true);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    const supabase = getSupabase();
    const loadUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUser({
          id: session.user.id,
          email: session.user.email || '',
          username: session.user.user_metadata?.username || session.user.user_metadata?.display_name || '',
          is_admin: session.user.user_metadata?.is_admin === true,
        });
        loadUnreadCount(session.user.id);
        checkClassModerator(session.user.id);
        loadReviewDueCount(session.user.id);
      }
    };
    loadUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        setUser({
          id: session.user.id,
          email: session.user.email || '',
          username: session.user.user_metadata?.username || session.user.user_metadata?.display_name || '',
          is_admin: session.user.user_metadata?.is_admin === true,
        });
        loadUnreadCount(session.user.id);
        checkClassModerator(session.user.id);
        loadReviewDueCount(session.user.id);
      } else {
        setUser(null);
        setUnreadCount(0);
        setReviewDueCount(0);
        setIsClassModerator(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const checkClassModerator = async (userId: string) => {
    try {
      const { data } = await getSupabase()
        .from('class_members')
        .select('role')
        .eq('user_id', userId)
        .in('role', ['creator', 'moderator'])
        .limit(1);
      setIsClassModerator(!!data && data.length > 0);
    } catch {
      setIsClassModerator(false);
    }
  };

  const loadUnreadCount = async (userId: string) => {
    try {
      const { count } = await getSupabase()
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_read', false);
      setUnreadCount(count || 0);
    } catch {
      // ignore
    }
  };

  const loadReviewDueCount = async (userId: string) => {
    try {
      const { count } = await getSupabase()
        .from('review_schedule')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .lte('due_at', new Date().toISOString());
      setReviewDueCount(count || 0);
    } catch {
      // ignore
    }
  };

  const handleLogout = async () => {
    const { error } = await getSupabase().auth.signOut();
    if (!error) {
      clearSupabaseCache();
      window.location.href = '/';
    }
  };

  const toggleTheme = () => {
    const next = currentTheme.id === 'light' ? 'dark' : 'light';
    setCurrentTheme(next);
    setCurrentThemeState(themes[next]);
  };

  const isActive = (href: string) =>
    pathname === href || (href !== '/' && pathname.startsWith(href));

  useEffect(() => {
    setMoreMenuOpen(false);
    setUserMenuOpen(false);
  }, [pathname]);

  const mobileNavItems: NavItem[] = [
    { href: '/research', label: '研究', icon: Icons.research },
    { href: '/search', label: '搜索', icon: Icons.search },
    { href: '/kb', label: '知识库', icon: Icons.kb },
    { href: '/qa', label: '问答', icon: Icons.qa },
    { href: '/reader', label: '阅读', icon: Icons.papers },
  ];

  const mobileMoreItems: NavItem[] = [
    { href: '/', label: '首页', icon: Icons.home },
    { href: '/papers', label: '论文库', icon: Icons.papers },
    { href: '/graph', label: '研究图谱', icon: Icons.graph },
    { href: '/questions', label: '题库', icon: Icons.search },
    { href: '/review', label: '复习', icon: Icons.review },
    { href: '/notes', label: '笔记', icon: Icons.notes },
    { href: '/settings', label: '设置', icon: Icons.settings },
    { href: '/convert', label: '文档转换', icon: Icons.parse },
    { href: '/english', label: '英语训练', icon: Icons.qa },
    { href: '/generator', label: '智能出题', icon: Icons.admin },
    { href: '/classes', label: '团队', icon: Icons.classes },
    { href: '/me', label: '个人中心', icon: Icons.user },
    { href: '/notifications', label: '通知', icon: Icons.notifications },
    ...(user?.is_admin || isClassModerator ? [{ href: '/admin', label: '管理后台', icon: Icons.admin }] : []),
  ];

  return (
    <>
      {/* Mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-200 bg-white/95 backdrop-blur lg:hidden">
        <div className="grid grid-cols-6 pb-[env(safe-area-inset-bottom)]">
          {mobileNavItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`touch-target flex flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px] transition-colors ${
                isActive(item.href)
                  ? 'text-blue-600'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              {item.icon}
              <span className="leading-none">{item.label}</span>
            </Link>
          ))}
          <button
            type="button"
            onClick={() => setMoreMenuOpen(true)}
            className={`touch-target flex flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px] transition-colors ${
              moreMenuOpen ? 'text-blue-600' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            {Icons.more}
            <span className="leading-none">更多</span>
          </button>
        </div>
      </nav>

      {moreMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="关闭菜单"
            className="absolute inset-0 bg-black/30"
            onClick={() => setMoreMenuOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[82vh] overflow-hidden rounded-t-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <img src="/logo.png" alt="" className="h-7 w-7 rounded-md" />
                <span className="text-sm font-semibold text-gray-900">SynapFlow</span>
              </div>
              <button
                type="button"
                onClick={() => setMoreMenuOpen(false)}
                className="touch-target flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-50 hover:text-gray-600"
                aria-label="关闭"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="max-h-[calc(82vh-7rem)] overflow-y-auto px-3 py-3">
              <div className="grid grid-cols-2 gap-2">
                {mobileMoreItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`touch-target flex items-center gap-3 rounded-xl px-3 py-3 text-sm transition-colors ${
                      isActive(item.href)
                        ? 'bg-blue-50 text-blue-600 font-medium'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                  >
                    {item.icon}
                    <span className="min-w-0 truncate">{item.label}</span>
                  </Link>
                ))}
              </div>
              <div className="mt-3 border-t border-gray-100 pt-3">
                <button
                  type="button"
                  onClick={toggleTheme}
                  className="touch-target flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-gray-600 hover:bg-gray-50"
                >
                  {currentTheme.id === 'light' ? (
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                    </svg>
                  ) : (
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  )}
                  <span>{currentTheme.id === 'light' ? '深色模式' : '浅色模式'}</span>
                </button>
                {user ? (
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="touch-target mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-gray-500 hover:bg-red-50 hover:text-red-600"
                  >
                    {Icons.logout}
                    <span>退出登录</span>
                  </button>
                ) : (
                  <Link
                    href="/login"
                    className="touch-target mt-1 flex items-center gap-3 rounded-xl bg-gray-900 px-3 py-3 text-sm font-medium text-white"
                  >
                    {Icons.user}
                    <span>登录</span>
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <aside
        className={`fixed left-0 top-0 z-50 hidden h-full flex-col border-r border-gray-100 bg-white transition-all duration-200 lg:flex ${
          collapsed ? 'w-16' : 'w-60'
        }`}
      >
        {/* Logo */}
        <div className="flex items-center h-14 px-3 border-b border-gray-100 shrink-0">
          {!collapsed ? (
            <Link href="/" className="flex items-center gap-2.5">
              <img src="/logo.png" alt="" className="w-7 h-7 rounded-md" />
              <span className="text-sm font-semibold text-gray-900">SynapFlow</span>
            </Link>
          ) : null}
          {!isMobile && (
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="ml-auto p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
            >
              <svg
                className={`w-4 h-4 transition-transform ${collapsed ? '' : 'rotate-180'}`}
                fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            </button>
          )}
        </div>

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {!collapsed && (
            <div className="px-2 mb-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
              导航
            </div>
          )}
          {mainNavItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-colors ${
                isActive(item.href)
                  ? 'bg-blue-50 text-blue-600 font-medium'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              } ${collapsed ? 'justify-center' : ''}`}
            >
              {item.icon}
              {!collapsed && <span>{item.label}</span>}
              {item.href === '/review' && reviewDueCount > 0 && (
                collapsed ? (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-blue-600" />
                ) : (
                  <span className="ml-auto min-w-[16px] h-4 bg-blue-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                    {reviewDueCount > 99 ? '99+' : reviewDueCount}
                  </span>
                )
              )}
            </Link>
          ))}

          {user && (
            <>
              {!collapsed && (
                <div className="px-2 mt-4 mb-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
                  资料
                </div>
              )}
              <Link
                href="/convert"
                className={`flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-colors ${
                  isActive('/convert') ? 'bg-blue-50 text-blue-600 font-medium' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                } ${collapsed ? 'justify-center' : ''}`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                {!collapsed && <span>文档转换</span>}
              </Link>
              <Link
                href="/english"
                className={`flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-colors ${
                  isActive('/english') ? 'bg-blue-50 text-blue-600 font-medium' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                } ${collapsed ? 'justify-center' : ''}`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
                </svg>
                {!collapsed && <span>英语训练</span>}
              </Link>

              {(user.is_admin || isClassModerator) && (
                <>
                  {!collapsed && (
                    <div className="px-2 mt-4 mb-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
                      管理
                    </div>
                  )}
                  <Link
                    href="/admin"
                    className={`flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-colors ${
                      isActive('/admin') ? 'bg-blue-50 text-blue-600 font-medium' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    } ${collapsed ? 'justify-center' : ''}`}
                  >
                    {Icons.admin}
                    {!collapsed && <span>管理后台</span>}
                  </Link>
                </>
              )}
            </>
          )}
        </nav>

        {/* Bottom section */}
        <div className="shrink-0 border-t border-gray-100 px-2 py-2 space-y-1">
          {/* Settings */}
          <Link
            href="/settings"
            className={`flex items-center w-full p-2 text-gray-500 hover:bg-gray-50 rounded-lg transition-colors ${
              collapsed ? 'justify-center' : 'gap-2.5'
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {!collapsed && <span className="text-xs">设置</span>}
          </Link>

          {/* 主题切换按钮 */}
          <button
            onClick={toggleTheme}
            className={`flex items-center w-full p-2 text-gray-500 hover:bg-gray-50 rounded-lg transition-colors ${
              collapsed ? 'justify-center' : 'gap-2.5'
            }`}
            title={currentTheme.id === 'light' ? '切换深色模式' : '切换浅色模式'}
          >
            {currentTheme.id === 'light' ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            )}
            {!collapsed && <span className="text-xs">{currentTheme.id === 'light' ? '深色模式' : '浅色模式'}</span>}
          </button>

          {user ? (
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className={`flex items-center w-full p-2 hover:bg-gray-50 rounded-lg transition-colors ${
                  collapsed ? 'justify-center' : 'gap-2.5'
                }`}
              >
                <div className="w-7 h-7 rounded-full bg-gray-900 flex items-center justify-center text-white text-xs font-medium shrink-0">
                  {user.username?.[0] || user.email?.[0]?.toUpperCase() || '?'}
                </div>
                {!collapsed && (
                  <div className="flex-1 min-w-0 text-left">
                    <div className="text-xs font-medium text-gray-700 truncate">
                      {user.username || '用户'}
                    </div>
                    <div className="text-[10px] text-gray-400 truncate">{user.email}</div>
                  </div>
                )}
              </button>

              {userMenuOpen && !collapsed && (
                <div className="absolute bottom-full left-0 mb-1 w-full bg-white border border-gray-100 rounded-lg shadow-lg py-1 z-50">
                  <Link
                    href="/notifications"
                    onClick={() => setUserMenuOpen(false)}
                    className="flex items-center justify-between px-3 py-2 text-xs text-gray-600 hover:bg-gray-50"
                  >
                    <span>通知</span>
                    {unreadCount > 0 && (
                      <span className="min-w-[16px] h-4 bg-blue-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </span>
                    )}
                  </Link>
                  <Link
                    href="/me"
                    onClick={() => setUserMenuOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50"
                  >
                    {Icons.user}
                    个人中心
                  </Link>
                  <Link
                    href="/me?tab=favorites"
                    onClick={() => setUserMenuOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50"
                  >
                    {Icons.heart}
                    我的收藏
                  </Link>
                  <div className="border-t border-gray-100 my-1" />
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                  >
                    {Icons.logout}
                    退出登录
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link
              href="/login"
              className={`flex items-center p-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors ${
                collapsed ? 'justify-center' : 'gap-2.5'
              }`}
            >
              {Icons.user}
              {!collapsed && <span className="text-xs font-medium">登录</span>}
            </Link>
          )}
        </div>
      </aside>
    </>
  );
}
