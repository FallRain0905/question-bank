"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import AppShell from "@/components/AppShell";
import GlassShell from "@/components/glass/GlassShell";

/*
 * Chooses which chrome wraps the app.
 *
 * The overhaul defaults to the new glass shell, but the classic one is still wired up
 * and one click away, so nothing from the previous frontend was removed — see the
 * `backup/classic-theme` branch and the `backup/classic-theme-2026-10-09` tag for the
 * frozen copy. The choice is remembered per browser.
 */

const STORAGE_KEY = "synap-ui";
const STANDALONE_ROUTES = ["/welcome", "/theme"];
type Variant = "glass" | "classic";

export default function UIChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [variant, setVariant] = useState<Variant>("glass");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "classic" || saved === "glass") setVariant(saved);
    } catch { /* private mode — keep the default */ }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.ui = variant;
  }, [variant]);

  const use = (next: Variant) => {
    setVariant(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
  };

  // the theme pages are their own surface and never take either chrome
  if (STANDALONE_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))) {
    return <>{children}</>;
  }

  if (variant === "classic") {
    return <AppShell onUseGlass={() => use("glass")}>{children}</AppShell>;
  }

  return <GlassShell onUseClassic={() => use("classic")}>{children}</GlassShell>;
}
