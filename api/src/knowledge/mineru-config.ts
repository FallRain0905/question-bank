/**
 * MinerU (mineru.net) parsing configuration.
 *
 * MinerU provides two different flows for local files:
 *
 *  - `v4-batch` — the official "precise" API: request signed upload URLs from
 *    `POST /api/v4/file-urls/batch`, PUT the bytes, then poll
 *    `GET /api/v4/extract-results/batch/{batch_id}` and download `full_zip_url`.
 *    Requires an API token.
 *  - `agent` — the lightweight agent API: `POST /api/v1/agent/parse/file`
 *    returns a signed upload URL, then `GET /api/v1/agent/parse/{task_id}`
 *    exposes `markdown_url` directly (no zip, no token required).
 *
 * Without an explicit `MINERU_PARSE_MODE`, the token decides: a configured
 * token selects `v4-batch`, otherwise the token-free `agent` flow is used.
 */

export type MineruParseMode = 'v4-batch' | 'agent';

export interface MineruConfig {
  enabled: boolean;
  mode: MineruParseMode;
  baseUrl: string;
  token: string;
  timeoutMs: number;
  pollIntervalMs: number;
  language: string;
  isOcr: boolean;
  modelVersion: string | null;
}

type Env = Record<string, string | undefined>;

function positiveInt(raw: string | undefined, fallback: number) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function resolveMineruConfig(env: Env = process.env): MineruConfig {
  const token = env.MINERU_API_TOKEN?.trim() ?? '';
  const explicitMode = env.MINERU_PARSE_MODE?.trim();

  return {
    enabled: env.MINERU_ENABLED !== 'false',
    mode:
      explicitMode === 'v4-batch' || explicitMode === 'agent'
        ? explicitMode
        : token
          ? 'v4-batch'
          : 'agent',
    baseUrl: (env.MINERU_BASE_URL?.trim() || 'https://mineru.net').replace(/\/+$/, ''),
    token,
    timeoutMs: positiveInt(env.MINERU_TIMEOUT_MS, 300_000),
    pollIntervalMs: positiveInt(env.MINERU_POLL_INTERVAL_MS, 3_000),
    language: env.MINERU_LANGUAGE?.trim() || 'ch',
    isOcr: env.MINERU_IS_OCR === 'true',
    modelVersion: env.MINERU_MODEL_VERSION?.trim() || null,
  };
}
