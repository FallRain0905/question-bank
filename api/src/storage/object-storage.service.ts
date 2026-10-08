import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

/**
 * Object storage for uploaded knowledge base sources.
 *
 * The first implementation writes to a local directory (`KB_STORAGE_DIR`).
 * Keeping the original file lets the API re-run a full MinerU parse after a
 * failure or a restart instead of depending on previously extracted markdown.
 * The interface is intentionally small so a MinIO/S3 driver can replace it
 * without touching the knowledge module.
 */

export function sanitizeFilename(filename: string) {
  const cleaned = filename
    .replace(/[\\/]+/g, '_')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^\.+/, '')
    .trim();
  const limited = cleaned.slice(0, 120);
  return limited || 'document';
}

@Injectable()
export class ObjectStorageService implements OnModuleInit {
  private readonly logger = new Logger(ObjectStorageService.name);
  private readonly rootDir = resolve(
    process.env.KB_STORAGE_DIR?.trim() || join(process.cwd(), '.data', 'knowledge'),
  );
  private available = false;

  async onModuleInit() {
    try {
      await mkdir(this.rootDir, { recursive: true });
      this.available = true;
    } catch (error) {
      this.available = false;
      this.logger.warn(
        `本地文件存储不可用（${error instanceof Error ? error.message : '未知错误'}）；本次运行不会保留原始文件`,
      );
    }
  }

  get driver(): string {
    return 'local-disk';
  }

  get isAvailable(): boolean {
    return this.available;
  }

  get root(): string {
    return this.rootDir;
  }

  buildKey(documentId: string, filename: string) {
    return `${documentId}/${sanitizeFilename(filename)}`;
  }

  private resolvePath(key: string) {
    const full = resolve(this.rootDir, key);
    if (full !== this.rootDir && !full.startsWith(`${this.rootDir}${sep}`)) {
      throw new Error('非法的存储路径');
    }
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const target = this.resolvePath(key);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.tmp`;
    await writeFile(temporary, data);
    await rename(temporary, target);
    this.available = true;
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.resolvePath(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      const info = await stat(this.resolvePath(key));
      return info.isFile();
    } catch {
      return false;
    }
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolvePath(key), { force: true });
  }
}
