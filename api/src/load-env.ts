import { existsSync } from 'node:fs';
import { config } from 'dotenv';

/**
 * Server-side environment file for the learning API.
 *
 * PM2 starts the API with a plain `node dist/api/main.js`, so secrets must not
 * live in `ecosystem.config.js` (a committed file). This module loads
 * `.env.api` (or `API_ENV_FILE`) before any service reads configuration.
 * Values already present in `process.env` win, so PM2/unit tests can override.
 */
export function loadApiEnv(envFile = process.env.API_ENV_FILE || '.env.api') {
  if (!existsSync(envFile)) {
    return false;
  }
  const result = config({ path: envFile, quiet: true });
  return !result.error;
}

loadApiEnv();
