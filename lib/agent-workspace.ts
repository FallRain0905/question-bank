import crypto from 'crypto';
import { createWriteStream } from 'fs';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import * as yauzl from 'yauzl';

const DEFAULT_MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_UNZIPPED_BYTES = 300 * 1024 * 1024;
const DEFAULT_MAX_SINGLE_FILE_BYTES = 80 * 1024 * 1024;
const DEFAULT_MAX_FILES = 1000;
const MAX_MARKDOWN_BYTES = 12 * 1024 * 1024;

const DANGEROUS_EXTENSIONS = new Set([
  '.app',
  '.bat',
  '.bin',
  '.cmd',
  '.com',
  '.dll',
  '.dylib',
  '.exe',
  '.msi',
  '.ps1',
  '.scr',
  '.sh',
  '.so',
]);

export type WorkspaceFileRef = {
  absolutePath: string;
  relativePath: string;
  bytes: number;
};

export type ExtractedWorkspaceFile = WorkspaceFileRef & {
  originalName: string;
};

export type MineruZipWorkspaceResult = {
  zip: WorkspaceFileRef;
  extractDir: string;
  extractRelativeDir: string;
  files: ExtractedWorkspaceFile[];
  markdown: string;
  markdownFile: ExtractedWorkspaceFile | null;
};

function workspaceRoot() {
  const configured = process.env.SYNAPSE_AGENT_WORKSPACE_DIR || process.env.AGENT_WORKSPACE_DIR;
  if (configured) return path.resolve(/*turbopackIgnore: true*/ configured);
  return path.join(os.tmpdir(), 'synapse-agent');
}

function hashId(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function safeName(name: string) {
  return (name || 'file')
    .replace(/[\\/:*?"<>|#%&{}$!'@+=`\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 180) || 'file';
}

function assertInside(root: string, target: string) {
  const relative = path.relative(root, target);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return;
  throw new Error('Unsafe workspace path rejected');
}

function userWorkspaceRoot(userId: string) {
  return path.join(workspaceRoot(), 'workspaces', `u_${hashId(userId)}`);
}

export function getAgentWorkspaceInfo(userId: string) {
  const root = workspaceRoot();
  const userRoot = userWorkspaceRoot(userId);
  return {
    root,
    userRoot,
    relativeUserRoot: path.relative(root, userRoot),
  };
}

async function ensureWorkspaceDirs(userId: string, fileId?: string) {
  const root = workspaceRoot();
  const userRoot = userWorkspaceRoot(userId);
  const dirs = {
    root,
    userRoot,
    files: path.join(userRoot, 'files'),
    converted: path.join(userRoot, 'converted'),
    extracted: path.join(userRoot, 'extracted'),
    tmp: path.join(userRoot, 'tmp'),
    fileRoot: fileId ? path.join(userRoot, 'files', safeName(fileId)) : '',
    convertedRoot: fileId ? path.join(userRoot, 'converted', safeName(fileId)) : '',
    extractedRoot: fileId ? path.join(userRoot, 'extracted', safeName(fileId)) : '',
  };

  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await fs.mkdir(userRoot, { recursive: true, mode: 0o700 });
  await Promise.all([
    fs.mkdir(dirs.files, { recursive: true, mode: 0o700 }),
    fs.mkdir(dirs.converted, { recursive: true, mode: 0o700 }),
    fs.mkdir(dirs.extracted, { recursive: true, mode: 0o700 }),
    fs.mkdir(dirs.tmp, { recursive: true, mode: 0o700 }),
  ]);
  if (fileId) {
    await Promise.all([
      fs.mkdir(dirs.fileRoot, { recursive: true, mode: 0o700 }),
      fs.mkdir(dirs.convertedRoot, { recursive: true, mode: 0o700 }),
      fs.mkdir(dirs.extractedRoot, { recursive: true, mode: 0o700 }),
    ]);
  }
  return dirs;
}

function refFor(root: string, absolutePath: string, bytes: number): WorkspaceFileRef {
  assertInside(root, absolutePath);
  return {
    absolutePath,
    relativePath: path.relative(root, absolutePath).replace(/\\/g, '/'),
    bytes,
  };
}

export async function writeUploadedFileToWorkspace(userId: string, fileId: string, fileName: string, buffer: Buffer) {
  const dirs = await ensureWorkspaceDirs(userId, fileId);
  const target = path.join(dirs.fileRoot, safeName(fileName));
  assertInside(dirs.userRoot, target);
  await fs.writeFile(target, buffer, { mode: 0o600 });
  return refFor(dirs.userRoot, target, buffer.byteLength);
}

async function downloadToWorkspace(url: string, target: string, maxBytes = DEFAULT_MAX_DOWNLOAD_BYTES) {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download workspace artifact (${res.status})`);
  }

  const declaredLength = Number(res.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) {
    throw new Error(`Artifact is too large: ${Math.ceil(declaredLength / 1024 / 1024)} MB`);
  }

  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  let written = 0;
  const readable = Readable.fromWeb(res.body as any);
  readable.on('data', (chunk: Buffer) => {
    written += chunk.length;
    if (written > maxBytes) {
      readable.destroy(new Error(`Artifact exceeded ${Math.ceil(maxBytes / 1024 / 1024)} MB limit`));
    }
  });
  await pipeline(readable, createWriteStream(target, { mode: 0o600 }));
  return written;
}

function openZip(zipPath: string) {
  return new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, validateEntrySizes: true }, (error, zipFile) => {
      if (error || !zipFile) reject(error || new Error('Unable to open ZIP'));
      else resolve(zipFile);
    });
  });
}

function openEntryStream(zipFile: yauzl.ZipFile, entry: yauzl.Entry) {
  return new Promise<NodeJS.ReadableStream>((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) reject(error || new Error('Unable to read ZIP entry'));
      else resolve(stream);
    });
  });
}

function safeZipTarget(extractDir: string, fileName: string) {
  const normalized = fileName.replace(/\\/g, '/');
  if (!normalized || normalized.includes('\u0000') || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error(`Unsafe ZIP entry rejected: ${fileName}`);
  }
  const target = path.resolve(extractDir, normalized);
  assertInside(extractDir, target);
  return target;
}

function isLikelySymlink(entry: yauzl.Entry) {
  const mode = (entry.externalFileAttributes >> 16) & 0o170000;
  return mode === 0o120000;
}

function rejectDangerousEntry(entry: yauzl.Entry) {
  if (isLikelySymlink(entry)) throw new Error(`ZIP symlink rejected: ${entry.fileName}`);
  const extension = path.extname(entry.fileName).toLowerCase();
  if (DANGEROUS_EXTENSIONS.has(extension)) throw new Error(`Dangerous ZIP entry rejected: ${entry.fileName}`);
}

async function extractZip(zipPath: string, extractDir: string) {
  await fs.rm(extractDir, { recursive: true, force: true });
  await fs.mkdir(extractDir, { recursive: true, mode: 0o700 });

  const zipFile = await openZip(zipPath);
  const files: ExtractedWorkspaceFile[] = [];
  let fileCount = 0;
  let totalBytes = 0;

  return await new Promise<ExtractedWorkspaceFile[]>((resolve, reject) => {
    const fail = (error: any) => {
      try {
        zipFile.close();
      } catch {
        // Ignore close failures while rejecting extraction.
      }
      reject(error);
    };

    zipFile.on('error', fail);
    zipFile.on('end', () => resolve(files));
    zipFile.on('entry', async entry => {
      try {
        const isDirectory = /\/$/.test(entry.fileName);
        const target = safeZipTarget(extractDir, entry.fileName);
        if (isDirectory) {
          await fs.mkdir(target, { recursive: true, mode: 0o700 });
          zipFile.readEntry();
          return;
        }

        rejectDangerousEntry(entry);
        fileCount += 1;
        totalBytes += entry.uncompressedSize || 0;
        if (fileCount > DEFAULT_MAX_FILES) throw new Error(`ZIP contains too many files (${fileCount})`);
        if ((entry.uncompressedSize || 0) > DEFAULT_MAX_SINGLE_FILE_BYTES) throw new Error(`ZIP entry is too large: ${entry.fileName}`);
        if (totalBytes > DEFAULT_MAX_TOTAL_UNZIPPED_BYTES) throw new Error('ZIP expands beyond the workspace limit');

        await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        const stream = await openEntryStream(zipFile, entry);
        await pipeline(stream, createWriteStream(target, { mode: 0o600 }));
        files.push({
          ...refFor(extractDir, target, entry.uncompressedSize || 0),
          originalName: entry.fileName,
        });
        zipFile.readEntry();
      } catch (error) {
        fail(error);
      }
    });
    zipFile.readEntry();
  });
}

async function readBestMarkdown(files: ExtractedWorkspaceFile[]) {
  const markdownFiles = files
    .filter(file => ['.md', '.markdown', '.mmd'].includes(path.extname(file.relativePath).toLowerCase()))
    .sort((a, b) => b.bytes - a.bytes);
  const markdownFile = markdownFiles[0] || null;
  if (!markdownFile || markdownFile.bytes > MAX_MARKDOWN_BYTES) return { markdown: '', markdownFile: null };
  return { markdown: await fs.readFile(markdownFile.absolutePath, 'utf8'), markdownFile };
}

export async function materializeMineruZip(userId: string, sourceFileId: string, sourceName: string, zipUrl: string): Promise<MineruZipWorkspaceResult> {
  const dirs = await ensureWorkspaceDirs(userId, sourceFileId);
  const zipPath = path.join(dirs.convertedRoot, safeName(`${sourceName.replace(/\.[^/.]+$/, '') || sourceFileId}-mineru.zip`));
  assertInside(dirs.userRoot, zipPath);
  const zipBytes = await downloadToWorkspace(zipUrl, zipPath);
  const extractDir = path.join(dirs.extractedRoot, 'mineru');
  assertInside(dirs.userRoot, extractDir);
  const files = await extractZip(zipPath, extractDir);
  const { markdown, markdownFile } = await readBestMarkdown(files);
  return {
    zip: refFor(dirs.userRoot, zipPath, zipBytes),
    extractDir,
    extractRelativeDir: path.relative(dirs.userRoot, extractDir).replace(/\\/g, '/'),
    files,
    markdown,
    markdownFile,
  };
}

function collectWorkspaceRelativePaths(value: any, paths: Set<string>) {
  if (!value || typeof value !== 'object') return;
  if (typeof value.relativePath === 'string' && value.relativePath.trim()) {
    paths.add(value.relativePath);
  }
  if (typeof value.extractedDir === 'string' && value.extractedDir.trim()) {
    paths.add(value.extractedDir);
  }
  if (typeof value.extractRelativeDir === 'string' && value.extractRelativeDir.trim()) {
    paths.add(value.extractRelativeDir);
  }
  for (const nested of Object.values(value)) {
    if (Array.isArray(nested)) {
      for (const item of nested) collectWorkspaceRelativePaths(item, paths);
    } else {
      collectWorkspaceRelativePaths(nested, paths);
    }
  }
}

export async function removeWorkspaceReferences(userId: string, metadata: Record<string, any> | null | undefined) {
  const workspace = metadata?.workspace;
  if (!workspace) return;
  const { userRoot } = getAgentWorkspaceInfo(userId);
  const paths = new Set<string>();
  collectWorkspaceRelativePaths(workspace, paths);

  for (const relativePath of paths) {
    const target = path.resolve(userRoot, relativePath);
    assertInside(userRoot, target);
    if (target === userRoot) continue;
    await fs.rm(target, { recursive: true, force: true });
  }
}
