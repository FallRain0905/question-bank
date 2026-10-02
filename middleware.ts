import { NextRequest, NextResponse } from 'next/server';
import { isLegacyRoute, PRODUCT_FLAGS } from '@/lib/product-flags';

export function middleware(request: NextRequest) {
  if (!PRODUCT_FLAGS.legacyWorkspace && isLegacyRoute(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
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
