import { describe, expect, it } from 'vitest';
import { resolveMineruConfig } from './mineru-config';

describe('resolveMineruConfig', () => {
  it('defaults to the token-free agent flow when no token exists', () => {
    const config = resolveMineruConfig({});

    expect(config.enabled).toBe(true);
    expect(config.mode).toBe('agent');
    expect(config.baseUrl).toBe('https://mineru.net');
  });

  it('selects the batch flow when a token is configured', () => {
    const config = resolveMineruConfig({ MINERU_API_TOKEN: ' token-1 ' });

    expect(config.mode).toBe('v4-batch');
    expect(config.token).toBe('token-1');
  });

  it('honours an explicit mode override and custom endpoints', () => {
    const config = resolveMineruConfig({
      MINERU_API_TOKEN: 'token-1',
      MINERU_PARSE_MODE: 'agent',
      MINERU_BASE_URL: 'http://127.0.0.1:8080/',
    });

    expect(config.mode).toBe('agent');
    expect(config.baseUrl).toBe('http://127.0.0.1:8080');
  });

  it('supports disabling MinerU entirely', () => {
    expect(resolveMineruConfig({ MINERU_ENABLED: 'false' }).enabled).toBe(false);
  });

  it('applies OCR, language, timeout and polling overrides', () => {
    const config = resolveMineruConfig({
      MINERU_IS_OCR: 'true',
      MINERU_LANGUAGE: 'en',
      MINERU_TIMEOUT_MS: '1000',
      MINERU_POLL_INTERVAL_MS: '10',
      MINERU_MODEL_VERSION: 'vlm',
    });

    expect(config.isOcr).toBe(true);
    expect(config.language).toBe('en');
    expect(config.timeoutMs).toBe(1000);
    expect(config.pollIntervalMs).toBe(10);
    expect(config.modelVersion).toBe('vlm');
  });
});
