import crypto from 'crypto';
import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import fs from 'fs/promises';
import net from 'net';
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
export const MAX_AGENT_UPLOAD_BYTES = Number(process.env.SYNAPSE_AGENT_MAX_UPLOAD_BYTES || 50 * 1024 * 1024);
export const MAX_AGENT_FILES_PER_USER = Number(process.env.SYNAPSE_AGENT_MAX_FILES_PER_USER || 300);
const MAX_TEXT_PREVIEW_BYTES = Number(process.env.SYNAPSE_AGENT_MAX_TEXT_PREVIEW_BYTES || 2 * 1024 * 1024);
const MAX_COMMAND_TIMEOUT_MS = Number(process.env.SYNAPSE_SANDBOX_COMMAND_TIMEOUT_MS || 20_000);
const MAX_COMMAND_OUTPUT_CHARS = Number(process.env.SYNAPSE_SANDBOX_COMMAND_OUTPUT_CHARS || 16_000);

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

const TEXT_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cfg',
  '.conf',
  '.cpp',
  '.cs',
  '.css',
  '.csv',
  '.env',
  '.go',
  '.h',
  '.hpp',
  '.html',
  '.ini',
  '.ipynb',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.lock',
  '.log',
  '.md',
  '.markdown',
  '.mjs',
  '.py',
  '.rb',
  '.rs',
  '.sql',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

const ARCHIVE_EXTENSIONS = new Set(['.zip']);

const DEFAULT_ALLOWED_COMMANDS = [
  'pwd',
  'ls',
  'cat',
  'head',
  'tail',
  'wc',
  'grep',
  'rg',
  'find',
  'sed',
  'awk',
  'sort',
  'uniq',
  'cut',
  'tr',
  'xargs',
  'stat',
  'du',
  'file',
  'tree',
  'mkdir',
  'touch',
  'cp',
  'mv',
  'rm',
  'git',
  'jq',
  'curl',
  'wget',
  'unzip',
  'zip',
  'tar',
  'python',
  'python3',
  'pip',
  'pip3',
  'node',
  'npm',
  'npx',
  'pnpm',
  'yarn',
];

const DANGEROUS_COMMAND_PATTERNS = [
  /\bsudo\b/i,
  /\bsu\s/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bmount\b/i,
  /\bumount\b/i,
  /\bsystemctl\b/i,
  /\bservice\b/i,
  /\bpm2\b/i,
  /\bdocker\b/i,
  /\bpodman\b/i,
  /\bkubectl\b/i,
  /\bssh\b/i,
  /\bscp\b/i,
  /\brsync\b/i,
  /\brm\s+(-[^\s]*r[^\s]*f|-.[^\s]*f[^\s]*r)\b/i,
  /\brm\s+(-[^\s]*r|-[^\s]*f)\s+(\/|\*|\.{1,2})(\s|$)/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\/etc\//i,
  /\/root\//i,
  /\/home\//i,
  /\/var\/lib\//i,
  /\bcurl\b[\s\S]*\|\s*(sh|bash|zsh)/i,
  /\bwget\b[\s\S]*\|\s*(sh|bash|zsh)/i,
];

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

export type SandboxCommandResult = {
  command: string;
  cwd: string;
  runtime: 'docker' | 'local' | 'worker';
  containerName?: string;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
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

export function safeWorkspaceName(name: string) {
  return safeName(name);
}

function assertInside(root: string, target: string) {
  const relative = path.relative(root, target);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return;
  throw new Error('Unsafe workspace path rejected');
}

export function fileExtension(name: string) {
  return path.extname(name || '').toLowerCase();
}

export function isTextLikeFile(name: string) {
  return TEXT_EXTENSIONS.has(fileExtension(name));
}

export function isSupportedArchive(name: string) {
  return ARCHIVE_EXTENSIONS.has(fileExtension(name));
}

export function isDangerousFileName(name: string) {
  return DANGEROUS_EXTENSIONS.has(fileExtension(name));
}

export function textPreviewFromBuffer(name: string, buffer: Buffer) {
  if (!isTextLikeFile(name)) return '';
  const slice = buffer.subarray(0, Math.min(buffer.byteLength, MAX_TEXT_PREVIEW_BYTES));
  return slice.toString('utf8');
}

export async function textPreviewFromWorkspaceFile(name: string, ref: WorkspaceFileRef) {
  if (!isTextLikeFile(name)) return '';
  const handle = await fs.open(ref.absolutePath, 'r');
  try {
    const length = Math.min(ref.bytes, MAX_TEXT_PREVIEW_BYTES);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
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

export async function ensureAgentWorkspace(userId: string) {
  return ensureWorkspaceDirs(userId);
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

function isPrivateLiteralIp(hostname: string) {
  const version = net.isIP(hostname);
  if (!version) return false;
  if (version === 6) {
    const normalized = hostname.toLowerCase();
    return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80');
  }
  const parts = hostname.split('.').map(Number);
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a === 0
  );
}

function assertDownloadUrlAllowed(rawUrl: string) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http/https URLs can be downloaded into the sandbox');
  }
  const host = url.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || isPrivateLiteralIp(host)) {
    throw new Error('Refusing to download from localhost or private network addresses');
  }
  return url;
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

export async function extractWorkspaceZipForFile(userId: string, fileId: string, zipRef: WorkspaceFileRef, label = 'archive') {
  const dirs = await ensureWorkspaceDirs(userId, fileId);
  const zipPath = path.resolve(dirs.userRoot, zipRef.relativePath);
  assertInside(dirs.userRoot, zipPath);
  const extractDir = path.join(dirs.extractedRoot, safeName(label));
  assertInside(dirs.userRoot, extractDir);
  const files = await extractZip(zipPath, extractDir);
  const { markdown, markdownFile } = await readBestMarkdown(files);
  return {
    extractDir,
    extractRelativeDir: path.relative(dirs.userRoot, extractDir).replace(/\\/g, '/'),
    files,
    markdown,
    markdownFile,
  };
}

export async function downloadUrlToWorkspace(userId: string, fileId: string, rawUrl: string, rawName?: string) {
  const url = assertDownloadUrlAllowed(rawUrl);
  const dirs = await ensureWorkspaceDirs(userId, fileId);
  const nameFromUrl = decodeURIComponent(path.basename(url.pathname || '') || '');
  const fileName = safeName(rawName || nameFromUrl || `download-${Date.now()}`);
  if (isDangerousFileName(fileName)) throw new Error(`Refusing to download dangerous file type: ${fileExtension(fileName)}`);
  const target = path.join(dirs.fileRoot, fileName);
  assertInside(dirs.userRoot, target);
  const bytes = await downloadToWorkspace(url.toString(), target, DEFAULT_MAX_DOWNLOAD_BYTES);
  return {
    fileName,
    url: url.toString(),
    ref: refFor(dirs.userRoot, target, bytes),
  };
}

async function walkWorkspace(root: string, current: string, output: WorkspaceFileRef[], maxFiles: number) {
  if (output.length >= maxFiles) return;
  const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (output.length >= maxFiles) return;
    const target = path.join(current, entry.name);
    assertInside(root, target);
    if (entry.isDirectory()) {
      await walkWorkspace(root, target, output, maxFiles);
    } else if (entry.isFile()) {
      const stat = await fs.stat(target);
      output.push(refFor(root, target, stat.size));
    }
  }
}

export async function listWorkspaceFiles(userId: string, maxFiles = 120) {
  const { userRoot } = await ensureWorkspaceDirs(userId);
  const output: WorkspaceFileRef[] = [];
  await walkWorkspace(userRoot, userRoot, output, maxFiles);
  return output.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function commandBase(command: string) {
  const trimmed = command.trim();
  const first = trimmed.match(/^([A-Za-z0-9_.-]+)/)?.[1] || '';
  return first.toLowerCase();
}

function allowedCommands() {
  const raw = process.env.SYNAPSE_SANDBOX_ALLOWED_COMMANDS || '';
  const configured = raw.split(',').map(item => item.trim()).filter(Boolean);
  return new Set(configured.length ? configured : DEFAULT_ALLOWED_COMMANDS);
}

function assertCommandAllowed(command: string) {
  const trimmed = command.trim();
  if (!trimmed) throw new Error('Missing sandbox command');
  const base = commandBase(trimmed);
  if (!allowedCommands().has(base)) {
    throw new Error(`Command "${base || '(unknown)'}" is not allowed in the sandbox`);
  }
  for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
    if (pattern.test(trimmed)) throw new Error('Command rejected by sandbox safety policy');
  }
}

function sandboxRuntime(): 'docker' | 'local' {
  const configured = String(process.env.SYNAPSE_SANDBOX_RUNTIME || '').trim().toLowerCase();
  if (configured === 'docker' || configured === 'local') return configured;
  return process.env.NODE_ENV === 'production' ? 'docker' : 'local';
}

function sandboxWorkerUrl() {
  return String(process.env.SYNAPSE_SANDBOX_WORKER_URL || '').trim().replace(/\/+$/, '');
}

function boundedCommandTimeout(timeoutMs: number) {
  return Math.min(Math.max(timeoutMs || MAX_COMMAND_TIMEOUT_MS, 1000), MAX_COMMAND_TIMEOUT_MS);
}

function sandboxUidGid() {
  const configured = String(process.env.SYNAPSE_SANDBOX_USER || '').trim();
  if (configured) return configured;
  const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;
  const gid = typeof process.getgid === 'function' ? process.getgid() : 1000;
  return `${uid}:${gid}`;
}

function dockerRuntimeHint(stderr: string) {
  if (/docker\.sock|permission denied while trying to connect to the docker api/i.test(stderr)) {
    return [
      stderr,
      '',
      'Synapse could not talk to the host Docker daemon. This is a server permission issue, not a sandbox command restriction.',
      'Fix on the server: add the PM2 user to the docker group, log out and back in, then restart PM2 with --update-env.',
      'Commands: sudo usermod -aG docker deploy && exit',
    ].join('\n').trim();
  }
  if (/Cannot connect to the Docker daemon|Is the docker daemon running/i.test(stderr)) {
    return `${stderr}\n\nDocker daemon is not reachable. Start Docker on the server and restart the Synapse PM2 process.`;
  }
  if (/pull access denied|not found|No such image/i.test(stderr)) {
    return `${stderr}\n\nSandbox image is missing. Build it with: docker build -t synapse-sandbox:latest docker/synapse-sandbox`;
  }
  return stderr;
}

async function prepareCommandWorkspace(userId: string, cwd = '.') {
  const { userRoot } = await ensureWorkspaceDirs(userId);
  const workingDirectory = path.resolve(userRoot, cwd || '.');
  assertInside(userRoot, workingDirectory);
  await fs.mkdir(workingDirectory, { recursive: true, mode: 0o700 });
  return { userRoot, workingDirectory };
}

async function runLocalWorkspaceCommand(userId: string, command: string, cwd = '.', timeoutMs = MAX_COMMAND_TIMEOUT_MS): Promise<SandboxCommandResult> {
  const { userRoot, workingDirectory } = await prepareCommandWorkspace(userId, cwd);

  assertCommandAllowed(command);

  const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/bash';
  const args = process.platform === 'win32'
    ? ['-NoProfile', '-Command', command]
    : ['-lc', command];
  const startedAt = Date.now();

  return await new Promise<SandboxCommandResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const child = spawn(shell, args, {
      cwd: workingDirectory,
      env: {
        PATH: process.env.PATH || '',
        HOME: userRoot,
        TMPDIR: path.join(userRoot, 'tmp'),
        NODE_ENV: process.env.NODE_ENV || 'production',
      },
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, Math.min(Math.max(timeoutMs || MAX_COMMAND_TIMEOUT_MS, 1000), MAX_COMMAND_TIMEOUT_MS));

    child.stdout.on('data', chunk => {
      stdout = (stdout + String(chunk)).slice(-MAX_COMMAND_OUTPUT_CHARS);
    });
    child.stderr.on('data', chunk => {
      stderr = (stderr + String(chunk)).slice(-MAX_COMMAND_OUTPUT_CHARS);
    });
    child.on('error', error => {
      clearTimeout(timer);
      resolve({
        command,
        cwd: path.relative(userRoot, workingDirectory).replace(/\\/g, '/') || '.',
        runtime: 'local',
        exitCode: null,
        timedOut,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim().slice(-MAX_COMMAND_OUTPUT_CHARS),
        durationMs: Date.now() - startedAt,
      });
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({
        command,
        cwd: path.relative(userRoot, workingDirectory).replace(/\\/g, '/') || '.',
        runtime: 'local',
        exitCode: code,
        timedOut,
        stdout: stdout.slice(-MAX_COMMAND_OUTPUT_CHARS),
        stderr: stderr.slice(-MAX_COMMAND_OUTPUT_CHARS),
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

async function runDockerWorkspaceCommand(userId: string, command: string, cwd = '.', timeoutMs = MAX_COMMAND_TIMEOUT_MS): Promise<SandboxCommandResult> {
  const { userRoot, workingDirectory } = await prepareCommandWorkspace(userId, cwd);

  assertCommandAllowed(command);

  const relativeCwd = path.relative(userRoot, workingDirectory).replace(/\\/g, '/');
  const containerCwd = relativeCwd ? `/workspace/${relativeCwd}` : '/workspace';
  const image = process.env.SYNAPSE_SANDBOX_IMAGE || 'synapse-sandbox:latest';
  const dockerBin = process.env.SYNAPSE_SANDBOX_DOCKER_BIN || 'docker';
  const network = process.env.SYNAPSE_SANDBOX_NETWORK || 'none';
  const memory = process.env.SYNAPSE_SANDBOX_MEMORY || '512m';
  const cpus = process.env.SYNAPSE_SANDBOX_CPUS || '1';
  const pidsLimit = process.env.SYNAPSE_SANDBOX_PIDS_LIMIT || '128';
  const readOnly = process.env.SYNAPSE_SANDBOX_READ_ONLY !== '0';
  const containerName = `synapse-sandbox-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const startedAt = Date.now();
  const args = [
    'run',
    '--rm',
    '--name', containerName,
    '--network', network,
    '--cpus', cpus,
    '--memory', memory,
    '--pids-limit', pidsLimit,
    '--security-opt', 'no-new-privileges',
    '--cap-drop', 'ALL',
    '--stop-timeout', '1',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=128m',
    '-e', 'HOME=/workspace',
    '-e', 'TMPDIR=/tmp',
    '-v', `${userRoot}:/workspace:rw`,
    '-w', containerCwd,
    '--user', sandboxUidGid(),
  ];
  if (readOnly) args.push('--read-only');
  args.push(image, '/bin/bash', '-lc', command);

  return await new Promise<SandboxCommandResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const child = spawn(dockerBin, args, { windowsHide: true });

    const finish = (result: SandboxCommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
      spawn(dockerBin, ['rm', '-f', containerName], { windowsHide: true }).on('error', () => {});
    }, boundedCommandTimeout(timeoutMs));

    child.stdout.on('data', chunk => {
      stdout = (stdout + String(chunk)).slice(-MAX_COMMAND_OUTPUT_CHARS);
    });
    child.stderr.on('data', chunk => {
      stderr = (stderr + String(chunk)).slice(-MAX_COMMAND_OUTPUT_CHARS);
    });
    child.on('error', error => {
      const hint = (error as any)?.code === 'ENOENT'
        ? 'Docker is not available to the Synapse process. Install Docker, build the sandbox image, and make sure the PM2 user can run docker.'
        : error.message;
      finish({
        command,
        cwd: relativeCwd || '.',
        runtime: 'docker',
        containerName,
        exitCode: null,
        timedOut,
        stdout,
        stderr: `${stderr}\n${hint}`.trim().slice(-MAX_COMMAND_OUTPUT_CHARS),
        durationMs: Date.now() - startedAt,
      });
    });
    child.on('close', code => {
      const finalStderr = dockerRuntimeHint(stderr.slice(-MAX_COMMAND_OUTPUT_CHARS));
      finish({
        command,
        cwd: relativeCwd || '.',
        runtime: 'docker',
        containerName,
        exitCode: code,
        timedOut,
        stdout: stdout.slice(-MAX_COMMAND_OUTPUT_CHARS),
        stderr: finalStderr.slice(-MAX_COMMAND_OUTPUT_CHARS),
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

async function runWorkerWorkspaceCommand(userId: string, command: string, cwd = '.', timeoutMs = MAX_COMMAND_TIMEOUT_MS): Promise<SandboxCommandResult> {
  const { userRoot, workingDirectory } = await prepareCommandWorkspace(userId, cwd);
  assertCommandAllowed(command);

  const workerUrl = sandboxWorkerUrl();
  const relativeCwd = path.relative(userRoot, workingDirectory).replace(/\\/g, '/') || '.';
  const controller = new AbortController();
  const timeout = boundedCommandTimeout(timeoutMs) + 5000;
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  const startedAt = Date.now();

  try {
    const token = String(process.env.SYNAPSE_SANDBOX_WORKER_TOKEN || '').trim();
    const res = await fetch(`${workerUrl}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        userId,
        command,
        cwd: relativeCwd,
        timeoutMs: boundedCommandTimeout(timeoutMs),
        workspaceRoot: userRoot,
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      return {
        command,
        cwd: relativeCwd,
        runtime: 'worker',
        exitCode: null,
        timedOut: false,
        stdout: '',
        stderr: (data?.error || text || `Sandbox worker returned HTTP ${res.status}`).slice(-MAX_COMMAND_OUTPUT_CHARS),
        durationMs: Date.now() - startedAt,
      };
    }
    return {
      command: String(data?.command || command),
      cwd: String(data?.cwd || relativeCwd),
      runtime: 'worker',
      containerName: data?.containerName,
      exitCode: Number.isFinite(Number(data?.exitCode)) ? Number(data.exitCode) : null,
      timedOut: Boolean(data?.timedOut),
      stdout: String(data?.stdout || '').slice(-MAX_COMMAND_OUTPUT_CHARS),
      stderr: String(data?.stderr || '').slice(-MAX_COMMAND_OUTPUT_CHARS),
      durationMs: Number.isFinite(Number(data?.durationMs)) ? Number(data.durationMs) : Date.now() - startedAt,
    };
  } catch (error: any) {
    return {
      command,
      cwd: relativeCwd,
      runtime: 'worker',
      exitCode: null,
      timedOut: error?.name === 'AbortError',
      stdout: '',
      stderr: `Sandbox worker request failed: ${error?.message || String(error)}`.slice(-MAX_COMMAND_OUTPUT_CHARS),
      durationMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function runWorkspaceCommand(userId: string, command: string, cwd = '.', timeoutMs = MAX_COMMAND_TIMEOUT_MS): Promise<SandboxCommandResult> {
  if (sandboxWorkerUrl()) {
    return runWorkerWorkspaceCommand(userId, command, cwd, timeoutMs);
  }
  if (sandboxRuntime() === 'docker') {
    return runDockerWorkspaceCommand(userId, command, cwd, timeoutMs);
  }
  return runLocalWorkspaceCommand(userId, command, cwd, timeoutMs);
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
