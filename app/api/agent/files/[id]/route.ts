import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';
import { getAgentWorkspaceInfo, removeWorkspaceReferences } from '@/lib/agent-workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clientForToken(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

async function getAuthedClient(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  if (!token) return { error: NextResponse.json({ error: 'Please log in first' }, { status: 401 }) };
  const supabase = clientForToken(token);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Please log in first' }, { status: 401 }) };
  return { supabase, user };
}

function firstWorkspaceRef(metadata: any) {
  const workspace = metadata?.workspace || {};
  const candidates = [
    workspace.originalFile,
    workspace.markdownFile,
    workspace.zip,
    workspace.mineruZip?.markdownFile,
    workspace.mineruZip?.zip,
    workspace.archive?.markdownFile,
    workspace.extractedFiles?.[0],
  ];
  return candidates.find(ref => ref?.relativePath);
}

function contentTypeFor(file: any) {
  const ext = String(file.file_type || '').toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'zip') return 'application/zip';
  if (ext === 'md' || ext === 'markdown') return 'text/markdown; charset=utf-8';
  if (ext === 'json') return 'application/json; charset=utf-8';
  if (ext === 'csv') return 'text/csv; charset=utf-8';
  if (['txt', 'log', 'py', 'js', 'ts', 'tsx', 'jsx', 'html', 'css', 'xml', 'yaml', 'yml'].includes(ext)) {
    return 'text/plain; charset=utf-8';
  }
  return 'application/octet-stream';
}

function downloadHeaders(file: any) {
  const name = String(file.file_name || 'download');
  return {
    'Content-Type': contentTypeFor(file),
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Cache-Control': 'private, no-store',
  };
}

function resolveWorkspacePath(userId: string, relativePath: string) {
  const { userRoot } = getAgentWorkspaceInfo(userId);
  const target = path.resolve(userRoot, relativePath);
  const relative = path.relative(userRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Unsafe workspace path rejected');
  }
  return target;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;
  const { id } = await params;

  const { data: file, error } = await auth.supabase
    .from('agent_files')
    .select('*')
    .eq('id', id)
    .eq('user_id', auth.user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 });

  try {
    const workspaceRef = firstWorkspaceRef(file.metadata);
    if (workspaceRef?.relativePath) {
      const target = resolveWorkspacePath(auth.user.id, workspaceRef.relativePath);
      const buffer = await fs.readFile(target);
      return new NextResponse(buffer, { headers: downloadHeaders(file) });
    }

    if (file.storage_path) {
      const { data, error: downloadError } = await auth.supabase.storage.from('files').download(file.storage_path);
      if (downloadError) throw downloadError;
      const buffer = Buffer.from(await data.arrayBuffer());
      return new NextResponse(buffer, { headers: downloadHeaders(file) });
    }

    if (file.file_url) {
      return NextResponse.redirect(file.file_url);
    }

    return NextResponse.json({ error: 'No downloadable artifact found for this file' }, { status: 404 });
  } catch (downloadError: any) {
    return NextResponse.json({ error: downloadError.message || 'Download failed' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;
  const { id } = await params;

  const { data: file, error: loadError } = await auth.supabase
    .from('agent_files')
    .select('*')
    .eq('id', id)
    .eq('user_id', auth.user.id)
    .maybeSingle();
  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 });
  if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 });

  if (file.storage_path) {
    await auth.supabase.storage.from('files').remove([file.storage_path]);
  }
  try {
    await removeWorkspaceReferences(auth.user.id, file.metadata);
  } catch (error) {
    console.warn('Synapse workspace cleanup failed:', error);
  }

  const { error } = await auth.supabase
    .from('agent_files')
    .delete()
    .eq('id', id)
    .eq('user_id', auth.user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
