import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ObjectStorageService, sanitizeFilename } from './object-storage.service';

describe('sanitizeFilename', () => {
  it('strips path separators and leading dots so keys cannot escape the storage root', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(sanitizeFilename('a\\b/c.pdf')).toBe('a_b_c.pdf');
    expect(sanitizeFilename('..hidden.pdf')).toBe('hidden.pdf');
  });

  it('keeps CJK names and trims control characters', () => {
    expect(sanitizeFilename('雅思词汇\u0000表.pdf')).toBe('雅思词汇表.pdf');
  });

  it('falls back when nothing usable remains', () => {
    expect(sanitizeFilename('   ')).toBe('document');
  });
});

describe('ObjectStorageService', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kb-storage-'));
    process.env.KB_STORAGE_DIR = dir;
  });

  afterEach(async () => {
    delete process.env.KB_STORAGE_DIR;
    await rm(dir, { recursive: true, force: true });
  });

  it('writes, reads, checks and removes objects', async () => {
    const storage = new ObjectStorageService();
    await storage.onModuleInit();

    const key = storage.buildKey('doc-1', '资料.pdf');
    expect(key).toBe('doc-1/资料.pdf');

    await storage.put(key, Buffer.from('pdf-bytes'));
    expect(await storage.exists(key)).toBe(true);
    expect((await storage.read(key)).toString()).toBe('pdf-bytes');

    await storage.remove(key);
    expect(await storage.exists(key)).toBe(false);
  });

  it('removes the per-document folder once its last file is deleted', async () => {
    const storage = new ObjectStorageService();
    await storage.onModuleInit();

    const first = storage.buildKey('doc-2', 'a.pdf');
    const second = storage.buildKey('doc-2', 'b.pdf');
    await storage.put(first, Buffer.from('a'));
    await storage.put(second, Buffer.from('b'));

    await storage.remove(first);
    expect(await storage.exists(second)).toBe(true);

    await storage.remove(second);
    expect(await storage.exists(second)).toBe(false);
    expect(existsSync(join(dir, 'doc-2'))).toBe(false);
  });

  it('rejects keys that escape the storage root', async () => {
    const storage = new ObjectStorageService();
    await storage.onModuleInit();

    await expect(storage.put('../escape.txt', Buffer.from('x'))).rejects.toThrow('非法的存储路径');
  });
});
