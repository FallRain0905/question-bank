"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/*
 * New theme — holographic pill CTA.
 *
 * Borrowed from the RakingLightPillButton's look and motion: an iridescent fill that
 * reads as light across the surface, a soft outer glow that widens on hover, and a
 * one-pixel lift. The label, link target and palette are SynapFlow's.
 */

type Tone = "primary" | "ghost";

const TONES: Record<Tone, string> = {
  primary:
    "text-[#0b1020] bg-[linear-gradient(135deg,rgba(255,255,255,0.96)_0%,rgba(228,236,255,0.92)_46%,rgba(214,238,255,0.94)_100%)] " +
    "shadow-[0_0_22px_rgba(120,170,255,0.26),inset_0_1px_0_rgba(255,255,255,0.75)] " +
    "hover:shadow-[0_0_36px_rgba(140,190,255,0.5),inset_0_1px_0_rgba(255,255,255,0.9)]",
  ghost:
    "text-white/85 border border-white/15 bg-white/[0.04] " +
    "shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] " +
    "hover:border-white/25 hover:bg-white/[0.08] hover:text-white",
};

export default function HoloButton({
  href,
  children,
  tone = "primary",
  className = "",
}: {
  href: string;
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`group relative inline-flex items-center gap-2 overflow-hidden rounded-full px-6 py-3 text-sm font-semibold transition-[transform,box-shadow,border-color,background-color] duration-300 hover:-translate-y-px ${TONES[tone]} ${className}`}
    >
      <span className="relative z-10">{children}</span>
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        className="relative z-10 h-[14px] w-[14px] fill-none stroke-current transition-transform duration-300 group-hover:translate-x-0.5"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3.2 8h9.1M8.6 4.3 12.4 8l-3.8 3.7" />
      </svg>
      {/* raked highlight: a single band of light crossing the pill on hover */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -translate-x-full bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.55),transparent)] opacity-0 transition-all duration-700 ease-out group-hover:translate-x-[420%] group-hover:opacity-100"
      />
    </Link>
  );
}
