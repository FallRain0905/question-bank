/**
 * AI provider configuration resolved from environment variables.
 *
 * Naming follows the existing project convention: the same variables that the
 * Next.js app already uses for LLM and embedding providers keep working here.
 * Keys are only read on the server; never expose them through NEXT_PUBLIC_*.
 */

export const DEFAULT_EMBEDDING_URL = 'https://api.siliconflow.cn/v1/embeddings';
export const DEFAULT_EMBEDDING_MODEL = 'Qwen/Qwen3-Embedding-4B';
export const DEFAULT_EMBEDDING_DIMENSIONS = 2560;

export const DEFAULT_LLM_URL = 'https://api.siliconflow.cn/v1/chat/completions';
export const DEFAULT_LLM_MODEL = 'deepseek-ai/DeepSeek-V4-Flash';
export const DEFAULT_DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat';

export type EmbeddingProvider = 'openai-compatible' | 'local-hash';

export interface EmbeddingConfig {
  provider: EmbeddingProvider;
  apiUrl: string;
  apiKey: string;
  model: string;
  dimensions: number;
  sendDimensions: boolean;
  batchSize: number;
}

export interface LlmConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
}

type Env = Record<string, string | undefined>;

function positiveInt(raw: string | undefined, fallback: number) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/** `LLM_BASE_URL` accepts an API root such as `https://host/v1`; the chat path is appended. */
function resolveChatUrl(env: Env, fallback: string) {
  if (env.LLM_API_URL) {
    return env.LLM_API_URL;
  }
  const base = env.LLM_BASE_URL?.replace(/\/+$/, '');
  return base ? `${base}/chat/completions` : fallback;
}

/**
 * Resolve the embedding provider.
 *
 * - An explicit `EMBEDDING_PROVIDER` always wins.
 * - Otherwise an OpenAI-compatible provider is used when an API key exists.
 * - Without any key the deterministic `local-hash` provider keeps the pipeline
 *   testable offline. It is a development fallback with poor retrieval quality,
 *   not a production embedding model.
 */
export function resolveEmbeddingConfig(env: Env = process.env): EmbeddingConfig {
  const apiKey = env.EMBEDDING_API_KEY || env.SILICONFLOW_API_KEY || '';
  const explicitProvider = env.EMBEDDING_PROVIDER?.trim() as EmbeddingProvider | undefined;
  const provider: EmbeddingProvider =
    explicitProvider === 'local-hash' || explicitProvider === 'openai-compatible'
      ? explicitProvider
      : apiKey
        ? 'openai-compatible'
        : 'local-hash';

  return {
    provider,
    apiUrl: env.EMBEDDING_API_URL || DEFAULT_EMBEDDING_URL,
    apiKey,
    model: env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL,
    dimensions: positiveInt(env.EMBEDDING_DIMENSIONS, DEFAULT_EMBEDDING_DIMENSIONS),
    sendDimensions: env.EMBEDDING_SEND_DIMENSIONS === 'true',
    batchSize: positiveInt(env.EMBEDDING_BATCH_SIZE, 16),
  };
}

/** Resolve the chat model used for RAG synthesis. Returns null when unconfigured. */
export function resolveLlmConfig(env: Env = process.env): LlmConfig | null {
  const explicitKey = env.LLM_API_KEY;
  if (explicitKey) {
    return {
      apiUrl: resolveChatUrl(env, DEFAULT_LLM_URL),
      apiKey: explicitKey,
      model: env.LLM_MODEL || DEFAULT_LLM_MODEL,
    };
  }

  if (env.SILICONFLOW_API_KEY) {
    return {
      apiUrl: resolveChatUrl(env, DEFAULT_LLM_URL),
      apiKey: env.SILICONFLOW_API_KEY,
      model: env.LLM_MODEL || DEFAULT_LLM_MODEL,
    };
  }

  if (env.DEEPSEEK_API_KEY) {
    return {
      apiUrl: resolveChatUrl(env, DEFAULT_DEEPSEEK_URL),
      apiKey: env.DEEPSEEK_API_KEY,
      model: env.LLM_MODEL || DEFAULT_DEEPSEEK_MODEL,
    };
  }

  return null;
}
