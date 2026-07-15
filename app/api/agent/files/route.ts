import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import mammoth from 'mammoth';
import {
  extractWorkspaceZipForFile,
  isDangerousFileName,
  isSupportedArchive,
  isTextLikeFile,
  MAX_AGENT_FILES_PER_USER,
  MAX_AGENT_UPLOAD_BYTES,
  textPreviewFromBuffer,
  writeUploadedFileToWorkspace,
} from '@/lib/agent-workspace';
import { sanitizeForPostgres, sanitizeTextForPostgres } from '@/lib/synapse-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

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
  return { token, supabase, user };
}

async function ensureConversation(supabase: ReturnType<typeof clientForToken>, userId: string, conversationId?: string) {
  if (conversationId) {
    const { data, error } = await supabase
      .from('agent_conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (data?.id) return data.id;
  }

  const { data, error } = await supabase
    .from('agent_conversations')
    .insert({ user_id: userId, title: 'Document reading' })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function parseFile(file: File, buffer: Buffer) {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return '';
  if (ext === 'docx') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  }
  if (isTextLikeFile(file.name)) return textPreviewFromBuffer(file.name, buffer);
  return '';
}

function safeStorageName(name: string) {
  return sanitizeTextForPostgres(name, 180)
    .replace(/[\\/:*?"<>|#%&{}$!'@+=`]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 180) || 'document';
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const conversationId = String(formData.get('conversation_id') || '').trim() || undefined;
    if (!file) return NextResponse.json({ error: 'Missing file' }, { status: 400 });
    if (file.size > MAX_AGENT_UPLOAD_BYTES) {
      return NextResponse.json({ error: `文件过大，当前限制为 ${Math.floor(MAX_AGENT_UPLOAD_BYTES / 1024 / 1024)} MB。` }, { status: 413 });
    }
    if (isDangerousFileName(file.name)) {
      return NextResponse.json({ error: '出于安全原因，暂不允许上传可执行文件或脚本安装包。' }, { status: 400 });
    }

    const ext = file.name.split('.').pop()?.toLowerCase() || 'file';
    const allowedDocuments = new Set(['pdf', 'docx']);
    if (!allowedDocuments.has(ext) && !isTextLikeFile(file.name) && !isSupportedArchive(file.name)) {
      return NextResponse.json({ error: '暂支持 PDF、DOCX、文本/代码文件和 ZIP 压缩包。' }, { status: 400 });
    }

    const { count, error: countError } = await auth.supabase
      .from('agent_files')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', auth.user.id);
    if (countError) throw countError;
    if ((count || 0) >= MAX_AGENT_FILES_PER_USER) {
      return NextResponse.json({ error: `文件库已达到 ${MAX_AGENT_FILES_PER_USER} 个文件限制，请先删除一些文件。` }, { status: 400 });
    }

    const id = await ensureConversation(auth.supabase, auth.user.id, conversationId);
    const buffer = Buffer.from(await file.arrayBuffer());
    const contentText = sanitizeTextForPostgres(await parseFile(file, buffer));
    const storagePath = `agent/${auth.user.id}/${id}/${Date.now()}-${safeStorageName(file.name)}`;
    let fileUrl = '';
    let uploadError = '';

    const { error } = await auth.supabase.storage.from('files').upload(storagePath, buffer, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
    if (error) {
      uploadError = error.message;
    } else {
      const { data } = auth.supabase.storage.from('files').getPublicUrl(storagePath);
      fileUrl = data.publicUrl;
    }

    const { data: row, error: insertError } = await auth.supabase
      .from('agent_files')
      .insert({
        user_id: auth.user.id,
        conversation_id: id,
        file_name: sanitizeTextForPostgres(file.name, 240),
        file_type: ext,
        file_size: file.size,
        storage_path: uploadError ? null : storagePath,
        file_url: fileUrl || null,
        content_text: contentText || '',
        metadata: sanitizeForPostgres({
          mimeType: file.type,
          parseStatus: contentText ? 'ready' : 'file_only',
          uploadError,
        }),
      })
      .select()
      .single();
    if (insertError) throw insertError;

    let savedRow = row;
    let workspaceRef: any = null;
    let extraction: any = null;
    let extractionError = '';
    try {
      workspaceRef = await writeUploadedFileToWorkspace(auth.user.id, row.id, file.name, buffer);
      if (isSupportedArchive(file.name)) {
        try {
          extraction = await extractWorkspaceZipForFile(auth.user.id, row.id, workspaceRef, 'uploaded');
        } catch (error: any) {
          extractionError = error?.message || 'Archive extraction failed';
        }
      }
      const nextMetadata = sanitizeForPostgres({
        ...(row.metadata || {}),
        workspace: {
          originalFile: workspaceRef,
          storedOnServer: true,
          archive: extraction ? {
            extractionStatus: 'completed',
            extractedDir: extraction.extractRelativeDir,
            extractedFiles: (extraction.files || []).slice(0, 200).map((item: any) => ({
              relativePath: item.relativePath,
              originalName: item.originalName,
              bytes: item.bytes,
            })),
            markdownFile: extraction.markdownFile || null,
          } : isSupportedArchive(file.name) ? {
            extractionStatus: 'failed',
            extractionError,
          } : null,
        },
      });
      const { data: updated } = await auth.supabase
        .from('agent_files')
        .update({
          metadata: nextMetadata,
          content_text: sanitizeTextForPostgres(contentText || extraction?.markdown || ''),
        })
        .eq('id', row.id)
        .eq('user_id', auth.user.id)
        .select()
        .single();
      savedRow = updated || { ...row, metadata: nextMetadata };
    } catch (workspaceError: any) {
      const nextMetadata = sanitizeForPostgres({
        ...(row.metadata || {}),
        workspace: {
          storedOnServer: false,
          error: workspaceError?.message || 'Workspace write failed',
        },
      });
      const { data: updated } = await auth.supabase
        .from('agent_files')
        .update({ metadata: nextMetadata })
        .eq('id', row.id)
        .eq('user_id', auth.user.id)
        .select()
        .single();
      savedRow = updated || { ...row, metadata: nextMetadata };
    }

    await auth.supabase
      .from('agent_conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', auth.user.id);

    return NextResponse.json({ conversationId: id, file: savedRow });
  } catch (error: any) {
    console.error('Synapse file upload error:', error);
    return NextResponse.json({ error: error.message || 'Upload failed' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(req.url);
  const conversationId = searchParams.get('conversation_id') || '';
  let query = auth.supabase
    .from('agent_files')
    .select('*')
    .eq('user_id', auth.user.id)
    .order('created_at', { ascending: false })
    .limit(100);

  if (conversationId) query = query.eq('conversation_id', conversationId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}
