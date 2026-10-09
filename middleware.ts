import { NextRequest, NextResponse } from 'next/server';
import { isLegacyRoute, PRODUCT_FLAGS } from '@/lib/product-flags';

/* Supabase SSR keeps the session in cookies named sb-<project-ref>-auth-token,
   chunked with a numeric suffix once it outgrows one cookie. */
const SUPABASE_SESSION_COOKIE = /^sb-.*-auth-token/;

export function middleware(request: NextRequest) {
  if (!PRODUCT_FLAGS.legacyWorkspace && isLegacyRoute(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // Signed-out visitors get the public entry page; the dashboard is for sessions.
  // This is routing, not authorisation — the dashboard still guards its own data.
  if (request.nextUrl.pathname === '/') {
    const hasSession = request.cookies.getAll().some((cookie) => SUPABASE_SESSION_COOKIE.test(cookie.name));
    if (!hasSession) {
      const url = request.nextUrl.clone();
      url.pathname = '/welcome';
      url.search = '';
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/',
    '/agent/:path*',
    '/research/:path*',
    '/search/:path*',
    '/kb/:path*',
    '/qa/:path*',
    '/reader/:path*',
    '/papers/:path*',
    '/graph/:path*',
  ],
};
