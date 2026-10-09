"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import { createTopDockController } from "@/components/threeui/src/shaders/animated-top-dock/topDockController";

/*
 * New theme — command bar.
 *
 * Borrowed from the AnimatedTopDock `modern` variant: brand left, dock centred on the
 * bar's midline, actions right, and a proximity spring so the item under the pointer
 * opens while its neighbours take part of the growth. The spring itself is the
 * vendored, copy-free controller; the bar, its labels and its palette are SynapFlow's.
 */

const NAV = [
  {
    href: "/",
    label: "今日学习",
    icon: <><rect x="2.25" y="2.25" width="4.5" height="4.5" rx=".8" /><rect x="9.25" y="2.25" width="4.5" height="4.5" rx=".8" /><rect x="2.25" y="9.25" width="4.5" height="4.5" rx=".8" /><rect x="9.25" y="9.25" width="4.5" height="4.5" rx=".8" /></>,
  },
  {
    href: "/questions",
    label: "题库",
    icon: <><path d="M3.4 2.4h5.4l3.8 3.8v7.4H3.4z" /><path d="M8.8 2.4v3.8h3.8M5.9 9h4.2M5.9 11.2h3" /></>,
  },
  {
    href: "/notes",
    label: "笔记",
    icon: <><rect x="2.4" y="2.4" width="11.2" height="11.2" rx="2" /><path d="M5.4 6.2h5.2M5.4 9.4h3.4" /></>,
  },
  {
    href: "/knowledge",
    label: "知识库",
    icon: <><path d="M8 1.9 14.4 5.6 8 9.3 1.6 5.6z" /><path d="m2.6 8 5.4 3.1L13.4 8M2.6 10.7 8 13.8l5.4-3.1" /></>,
  },
  {
    href: "/review",
    label: "复习",
    icon: <><circle cx="8" cy="8" r="5.9" /><path d="M8 4.6V8l2.4 1.5" /></>,
  },
];

export default function SynapTopDock() {
  const dockRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return undefined;
    return createTopDockController(dock, () => ({
      proximity: 122,
      spring: 0.19,
      damping: 0.7,
      widthGrowth: 17,
      heightGrowth: 16,
      drop: 3.5,
      axis: "x",
      // no track pin: the bar is centred by `justify-between`, so a growing pill
      // widens symmetrically and neither the wordmark nor the actions shift
    }));
  }, []);

  return (
    <div className="relative isolate overflow-hidden bg-[#07080c]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-[-12%] top-[-24%] z-0 h-[82%] bg-[radial-gradient(60%_120%_at_50%_0%,rgba(59,130,246,0.28),transparent_70%),radial-gradient(40%_90%_at_72%_10%,rgba(129,140,248,0.22),transparent_72%)] blur-[2px]"
      />

      {/* `data-dock-frame` + a fixed bar height keep the box the controller
          re-measures from independent of the dock's own growth. Without both, the
          magnified items resize the header, the ResizeObserver re-measures, and the
          spring is cancelled on the next frame. */}
      <header
        data-dock-frame
        className="relative z-10 mx-auto flex h-16 w-full max-w-[1240px] items-center justify-between gap-4 px-5 sm:px-8"
      >
        <Link href="/" className="flex shrink-0 items-center gap-2.5 text-[15px] font-semibold tracking-tight text-white">
          <span className="grid h-7 w-7 place-items-center rounded-[7px] bg-white text-[11px] font-bold text-[#0b1020]">S</span>
          SynapFlow
        </Link>

        <nav
          ref={dockRef}
          aria-label="主要导航"
          data-dock-state="idle"
          data-dock-max="0.00"
          className="hidden items-center gap-1 rounded-full border border-white/10 bg-white/[0.045] p-1 backdrop-blur md:flex"
        >
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              data-dock-item
              className="inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-2 text-[13px] text-white/70 transition-colors hover:text-white data-[dock-near=true]:bg-white/[0.08] data-[dock-near=true]:text-white"
            >
              <span aria-hidden="true" className="text-white/45">
                <svg viewBox="0 0 16 16" className="h-[15px] w-[15px] fill-none stroke-current" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
                  {item.icon}
                </svg>
              </span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <Link href="/login" className="rounded-full px-3 py-2 text-[13px] text-white/65 transition-colors hover:text-white">
            登录
          </Link>
          <Link
            href="/review"
            className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-[#0b1020] transition-shadow hover:shadow-[0_0_22px_rgba(125,175,255,0.45)]"
          >
            开始复习
            <svg viewBox="0 0 16 16" className="h-[13px] w-[13px] fill-none stroke-current" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3.2 8h9.1M8.6 4.3 12.4 8l-3.8 3.7" />
            </svg>
          </Link>
        </div>
      </header>

      {/* the proximity dock needs room to magnify into, so narrow screens get the
          same destinations as a plain scrollable row instead of a squeezed bar */}
      <nav aria-label="主要导航" className="relative z-10 -mt-1 flex gap-1.5 overflow-x-auto px-5 pb-5 md:hidden">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[12px] text-white/70"
          >
            <span aria-hidden="true" className="text-white/45">
              <svg viewBox="0 0 16 16" className="h-[14px] w-[14px] fill-none stroke-current" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
                {item.icon}
              </svg>
            </span>
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
