"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { getSupabase } from "@/lib/supabase";
import { ICON_PATHS } from "@/components/icons";
import CommandPalette from "@/components/CommandPalette";
import FloatingAIButton from "@/components/FloatingAIButton";

/*
 * Liquid-glass shell — the new frontend chrome.
 *
 * Structure and motion are lifted from the weather dashboard reference: a floating
 * glass rail on the left with a white pip marking the active destination, a slim glass
 * top bar, and the same entrance beats (rail slides in, logo pops, items rise in a
 * stagger, the pip grows last). The icons are SynapFlow's own set so each destination
 * reads the same here as it does in the classic shell — see components/icons.tsx.
 * That shell is still wired up and one click away: components/UIChrome.tsx.
 */

const NAV = [
  { href: "/", label: "今日学习", icon: "home" },
  { href: "/questions", label: "题库", icon: "questions" },
  { href: "/notes", label: "笔记", icon: "notes" },
  { href: "/knowledge", label: "知识库", icon: "knowledge" },
  { href: "/review", label: "复习", icon: "review" },
  { href: "/progress", label: "学习进度", icon: "progress" },
] as const;

const TITLES: Array<[string, string]> = [
  ["/questions", "题库"],
  ["/notes", "笔记"],
  ["/knowledge", "知识库"],
  ["/review", "复习"],
  ["/progress", "学习进度"],
  ["/settings", "设置"],
  ["/me", "我的"],
  ["/notifications", "通知"],
  ["/english", "英语练习"],
];

function titleFor(pathname: string) {
  const hit = TITLES.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return hit ? hit[1] : "今日学习";
}

export default function GlassShell({
  children,
  onUseClassic,
}: {
  children: ReactNode;
  onUseClassic: () => void;
}) {
  const pathname = usePathname();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabase();
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        const url = data.session?.user?.user_metadata?.avatar_url;
        if (typeof url === "string") setAvatarUrl(url);
      } catch {
        /* signed out, or the Supabase env is absent in this environment — the
           fallback glyph in the markup stands in */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <div className="glass-sky" aria-hidden="true" />

      <div className="glass-frame">
        <aside className="glass-dock" aria-label="主导航">
          <Link className="glass-wordmark" href="/" aria-label="SynapFlow 首页">
            <svg viewBox="0 0 40 40" aria-hidden="true">
              <defs><clipPath id="glasslogoclip"><circle cx="20" cy="20" r="12.6" /></clipPath></defs>
              <rect x="0.9" y="0.9" width="38.2" height="38.2" rx="12" fill="rgba(255,255,255,.10)" stroke="rgba(255,255,255,.5)" strokeWidth="1.5" />
              <g clipPath="url(#glasslogoclip)" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round">
                <polyline points="5,14.6 11,13 17,15.4 23,13 29,15.4 35,13" />
                <polyline points="5,17.6 11,16 17,18.4 23,16 29,18.4 35,16" />
                <polyline points="5,20.6 11,19 17,21.4 23,19 29,21.4 35,19" />
                <polyline points="5,23.6 11,22 17,24.4 23,22 29,24.4 35,22" />
                <polyline points="6,26.6 11,25 17,27.4 23,25 29,27.4 34,25" />
                <polyline points="8,29.4 13,28 18,30.2 23,28 28,30.2 32,28" />
                <polyline points="11,32 15,30.8 20,32.8 25,30.8 29,32.8" />
              </g>
            </svg>
          </Link>

          <nav className="glass-nav" aria-label="功能导航">
            {NAV.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="glass-navlink"
                  aria-label={item.label}
                  aria-current={active ? "page" : undefined}
                  data-active={active ? "true" : undefined}
                >
                  {active && <span className="glass-pip" aria-hidden="true" />}
                  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    {ICON_PATHS[item.icon]}
                  </svg>
                </Link>
              );
            })}
          </nav>

          <Link className="glass-navlink glass-navlink--tail" href="/settings" aria-label="设置">
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              {ICON_PATHS.settings}
            </svg>
          </Link>
        </aside>

        <div className="glass-column">
          <header className="glass-topbar">
            <div className="glass-titles">
              <span className="glass-hello">SynapFlow</span>
              <span className="glass-section">{titleFor(pathname)}</span>
            </div>

            <div className="glass-tools">
              <Link className="glass-tool" href="/search" aria-label="搜索">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="10.6" cy="10.6" r="6.2" /><path d="m15.4 15.4 4.4 4.4" /></svg>
              </Link>
              <Link className="glass-tool" href="/notifications" aria-label="通知">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6.6 17.2V11a5.4 5.4 0 0 1 10.8 0v6.2" /><path d="M4.8 17.2h14.4" /><path d="M10.2 20a2 2 0 0 0 3.6 0" /></svg>
              </Link>
              <button className="glass-tool" type="button" onClick={onUseClassic} aria-label="切回经典外观" title="切回经典外观">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3.4 12a8.6 8.6 0 1 0 2.6-6.2" /><path d="M3.2 5.6v4h4" /></svg>
              </button>
              <Link className="glass-avatar" href="/me" aria-label="我的">
                {avatarUrl ? <img src={avatarUrl} alt="" /> : (
                  <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
                    <circle cx="12" cy="9.2" r="3.8" fillOpacity=".9" />
                    <path d="M4.6 21a7.4 7.4 0 0 1 14.8 0Z" fillOpacity=".9" />
                  </svg>
                )}
              </Link>
            </div>
          </header>

          <main className="glass-content">{children}</main>
        </div>
      </div>

      <FloatingAIButton />
      <CommandPalette />
    </>
  );
}
