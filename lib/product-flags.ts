/**
 * Product-scope switches used while the old research workspace is being retired.
 * Keep the legacy routes in the repository; this module only controls exposure.
 */
export const PRODUCT_FLAGS = {
  /** Expose the legacy research/agent workspace to ordinary users. */
  legacyWorkspace: process.env.NEXT_PUBLIC_ENABLE_LEGACY_WORKSPACE === 'true',
} as const;

export const LEGACY_ROUTE_PREFIXES = [
  '/agent',
  '/research',
  '/search',
  '/kb',
  '/qa',
  '/reader',
  '/papers',
  '/graph',
] as const;

export function isLegacyRoute(pathname: string) {
  return LEGACY_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
