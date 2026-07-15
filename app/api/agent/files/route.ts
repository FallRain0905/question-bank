import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import mammoth from 'mammoth';
import { getUserMineruConfig } from '@/lib/user-settings';
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

async function parsePdfWithMineru(fileName: string, buffer: Buffer, token: string) {
  try {
    const createRes = await fetch('https://mineru.net/api/v1/agent/parse/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_name: fileName,
        language: 'ch',
        enable_table: true,
        is_ocr: false,
        enable_formula: true,
      }),
    });

    if (createRes.ok) {
      const createData = await createRes.json();
      const taskId = createData?.data?.task_id || createData?.task_id;
      const fileUrl = createData?.data?.file_url || createData?.data?.upload_url || createData?.file_url || createData?.upload_url;
      if (taskId && fileUrl) {
        const uploadBytes = new Uint8Array(buffer.length);
        uploadBytes.set(buffer);
        const uploadRes = await fetch(fileUrl, {
          method: 'PUT',
          body: uploadBytes,
        });
        if (uploadRes.ok) {
          for (let attempt = 0; attempt < 40; attempt += 1) {
            await new Promise(resolve => setTimeout(resolve, 1500));
            const pollRes = await fetch(`https://mineru.net/api/v1/agent/parse/${taskId}`);
            if (!pollRes.ok) continue;
            const pollData = await pollRes.json();
            const state = pollData?.data?.state || pollData?.state;
            if (state === 'failed') return '';
            const markdownUrl = pollData?.data?.markdown_url || pollData?.markdown_url;
            if (state === 'done' && markdownUrl) {
              const mdRes = await fetch(markdownUrl);
              if (mdRes.ok) return await mdRes.text();
            }
          }
        }
      }
    }
  } catch (error) {
    console.warn('MinerU agent parse failed, trying legacy upload:', error);
  }

  try {
    const mineru = await getUserMineruConfig(token);
    const form = new FormData();
    const bytes = new Uint8Array(buffer.length);
    bytes.set(buffer);
    form.append('file', new Blob([bytes.buffer], { type: 'application/pdf' }), fileName);
    form.append('return_md', 'true');
    const headers: Record<string, string> = {};
    if (mineru.token) headers.Authorization = `Bearer ${mineru.token}`;
    const res = await fetch('https://mineru.net/api/v1/agent/parse/file', { method: 'POST', headers, body: form });
    if (res.ok) {
      const data = await res.json();
      return data.content || data.markdown || data.data?.content || data.data?.markdown || '';
    }
  } catch {
    return '';
  }
  return '';
}

async function parseFile(file: File, buffer: Buffer, token: string) {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return parsePdfWithMineru(file.name, buffer, token);
  if (ext === 'docx') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  }
  if (ext === 'txt' || ext === 'md' || ext === 'markdown' || ext === 'csv') {
    return new TextDecoder().decode(buffer);
  }
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
    if (file.type.startsWith('image/')) return NextResponse.json({ error: 'Synapse 暂不支持图片上传，请上传 PDF、DOCX、Markdown 或 TXT。' }, { status: 400 });

    const ext = file.name.split('.').pop()?.toLowerCase() || 'file';
    const allowed = new Set(['pdf', 'docx', 'txt', 'md', 'markdown', 'csv']);
    if (!allowed.has(ext)) {
      return NextResponse.json({ error: '暂只支持 PDF、DOCX、Markdown、TXT、CSV 文档。' }, { status: 400 });
    }

    const id = await ensureConversation(auth.supabase, auth.user.id, conversationId);
    const buffer = Buffer.from(await file.arrayBuffer());
    const contentText = sanitizeTextForPostgres(await parseFile(file, buffer, auth.token));
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

    await auth.supabase
      .from('agent_conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', auth.user.id);

    return NextResponse.json({ conversationId: id, file: row });
  } catch (error: any) {
    console.error('Synapse file upload error:', error);
    return NextResponse.json({ error: error.message || 'Upload failed' }, { status: 500 });
  }
}
