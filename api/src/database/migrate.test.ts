import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveMigrationsFolder, runMigrations } from './migrate';

const originalUrl = process.env.DATABASE_URL;

afterEach(() => {
  if (originalUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalUrl;
  }
});

describe('resolveMigrationsFolder', () => {
  it('defaults to the drizzle folder inside the api workspace', () => {
    expect(resolveMigrationsFolder({})).toBe(join(process.cwd(), 'api', 'drizzle'));
  });

  it('honours MIGRATIONS_DIR when set', () => {
    expect(resolveMigrationsFolder({ MIGRATIONS_DIR: '/srv/synap/api/drizzle' })).toBe(
      '/srv/synap/api/drizzle',
    );
  });
});

describe('runMigrations', () => {
  it('fails fast with a clear message when DATABASE_URL is missing', async () => {
    delete process.env.DATABASE_URL;

    await expect(runMigrations()).rejects.toThrow('DATABASE_URL 未配置');
  });
});
