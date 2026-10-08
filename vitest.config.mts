import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Minimal vitest config: resolve the `@/*` path alias used across the codebase
// (lib/synapse-planning.ts imports '@/types' and '@/lib/synapse-sanitize').
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(process.cwd()),
    },
  },
  // NestJS services use decorators. `api/tsconfig.json` enables them so the
  // transform (oxc) can parse API services imported by unit tests.
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'api/**/*.test.ts'],
  },
});
