import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEEPSEEK_URL,
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_LLM_URL,
  resolveEmbeddingConfig,
  resolveLlmConfig,
} from './ai-config';

describe('resolveEmbeddingConfig', () => {
  it('falls back to local-hash without an API key', () => {
    const config = resolveEmbeddingConfig({});

    expect(config.provider).toBe('local-hash');
    expect(config.dimensions).toBe(DEFAULT_EMBEDDING_DIMENSIONS);
  });

  it('uses the OpenAI-compatible provider when EMBEDDING_API_KEY exists', () => {
    const config = resolveEmbeddingConfig({ EMBEDDING_API_KEY: 'sk-test' });

    expect(config.provider).toBe('openai-compatible');
    expect(config.apiKey).toBe('sk-test');
  });

  it('accepts SILICONFLOW_API_KEY as an embedding key', () => {
    expect(resolveEmbeddingConfig({ SILICONFLOW_API_KEY: 'sk-sf' }).apiKey).toBe('sk-sf');
  });

  it('honours an explicit provider override and dimensions', () => {
    const config = resolveEmbeddingConfig({
      EMBEDDING_PROVIDER: 'local-hash',
      EMBEDDING_API_KEY: 'sk-test',
      EMBEDDING_DIMENSIONS: '1024',
    });

    expect(config.provider).toBe('local-hash');
    expect(config.dimensions).toBe(1024);
  });
});

describe('resolveLlmConfig', () => {
  it('returns null when nothing is configured', () => {
    expect(resolveLlmConfig({})).toBeNull();
  });

  it('prefers LLM_API_KEY and builds the chat URL from LLM_BASE_URL', () => {
    const config = resolveLlmConfig({ LLM_API_KEY: 'sk-llm', LLM_BASE_URL: 'https://example.com/v1/' });

    expect(config?.apiUrl).toBe('https://example.com/v1/chat/completions');
    expect(config?.apiKey).toBe('sk-llm');
  });

  it('does not build a chat URL when only LLM_BASE_URL is missing', () => {
    expect(resolveLlmConfig({ LLM_API_KEY: 'sk-llm' })?.apiUrl).toBe(DEFAULT_LLM_URL);
  });

  it('falls back to DEEPSEEK_API_KEY with the DeepSeek endpoint', () => {
    const config = resolveLlmConfig({ DEEPSEEK_API_KEY: 'sk-ds' });

    expect(config?.apiUrl).toBe(DEFAULT_DEEPSEEK_URL);
    expect(config?.model).toBe('deepseek-chat');
  });
});
