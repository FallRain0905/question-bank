import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadApiEnv } from './load-env';

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

function writeEnvFile(content: string) {
  const dir = mkdtempSync(join(tmpdir(), 'api-env-'));
  const file = join(dir, '.env.api');
  writeFileSync(file, content);
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return file;
}

describe('loadApiEnv', () => {
  it('returns false when the env file does not exist', () => {
    expect(loadApiEnv(join(tmpdir(), 'definitely-missing-.env.api'))).toBe(false);
  });

  it('loads variables from the given file', () => {
    const file = writeEnvFile('LOAD_ENV_TEST_VALUE=from-file\n');
    cleanups.push(() => {
      delete process.env.LOAD_ENV_TEST_VALUE;
    });

    expect(loadApiEnv(file)).toBe(true);
    expect(process.env.LOAD_ENV_TEST_VALUE).toBe('from-file');
  });

  it('does not overwrite variables that are already set', () => {
    const file = writeEnvFile('LOAD_ENV_PRESET=from-file\n');
    process.env.LOAD_ENV_PRESET = 'from-process';
    cleanups.push(() => {
      delete process.env.LOAD_ENV_PRESET;
    });

    loadApiEnv(file);
    expect(process.env.LOAD_ENV_PRESET).toBe('from-process');
  });
});
