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
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
  },
});
