"use client";

import { usePathname } from 'next/navigation';
import Sidebar, { SidebarProvider, SidebarSpacer } from '@/components/Sidebar';
import FloatingAIButton from '@/components/FloatingAIButton';
import CommandPalette from '@/components/CommandPalette';

/*
 * Routes that carry the new frontend theme render full-bleed: they bring their own
 * background, header and navigation, so the learning-workbench chrome (sidebar,
 * floating assistant, command palette) stays out of the way. `/theme/reference` is the
 * component comparison page. Everything else keeps the existing shell untouched.
 */
const STANDALONE_ROUTES = ['/welcome', '/theme'];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const standalone = STANDALONE_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  if (standalone) return <>{children}</>;

  return (
    <>
      <SidebarProvider>
        <div className="flex min-h-screen">
          <Sidebar />
          <SidebarSpacer>
            <main className="min-h-screen pb-24 lg:pb-0">{children}</main>
          </SidebarSpacer>
        </div>
      </SidebarProvider>
      <FloatingAIButton />
      <CommandPalette />
    </>
  );
}
