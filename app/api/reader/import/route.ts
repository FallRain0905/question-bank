import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import mammoth from 'mammoth';
import { getUserMineruConfig } from '@/lib/user-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function supabaseForToken(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

async function getOrCreateReaderKb(supabase: ReturnType<typeof supabaseForToken>, userId: string, requestedKbId?: string) {
  if (requestedKbId) {
    const { data, error } = await supabase
      .from('knowledge_bases')
      .select('id')
      .eq('id', requestedKbId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (data?.id) return data.id;
    throw new Error('Selected knowledge base was not found.');
  }

  const { data: existing, error: existingError } = await supabase
    .from('knowledge_bases')
    .select('id')
    .eq('user_id', userId)
    .eq('name', 'AI Reading')
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing?.id) return existing.id;

  const { data: created, error: createError } = await supabase
    .from('knowledge_bases')
    .insert({
      user_id: userId,
      name: 'AI Reading',
      description: 'Documents imported directly from the AI reader entry.',
    })
    .select('id')
    .single();
  if (createError) throw createError;
  return created.id;
}

async function parseFile(file: File, buffer: Buffer, token: string) {
  const fileName = file.name;
  const fileType = fileName.split('.').pop()?.toLowerCase() || '';

  if (fileType === 'pdf') {
    try {
      const mineru = await getUserMineruConfig(token);
      const minerForm = new FormData();
      const pdfBytes = new Uint8Array(buffer.length);
      pdfBytes.set(buffer);
      minerForm.append('file', new Blob([pdfBytes.buffer], { type: 'application/pdf' }), fileName);
      minerForm.append('return_md', 'true');

      const headers: Record<string, string> = {};
      if (mineru.token) headers.Authorization = `Bearer ${mineru.token}`;

      const minerRes = await fetch('https://mineru.net/api/v1/agent/parse/file', {
        method: 'POST',
        headers,
        body: minerForm,
      });

      if (minerRes.ok) {
        const data = await minerRes.json();
        return data.content || data.markdown || '';
      }
    } catch (error) {
      console.warn('PDF parse failed; importing as PDF-only document.', error);
    }
    return '';
  }

  if (fileType === 'docx') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  }

  if (fileType === 'md' || fileType === 'markdown' || fileType === 'txt') {
    return new TextDecoder().decode(buffer);
  }

  return '';
}

export async function POST(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Please log in first' }, { status: 401 });

  const supabase = supabaseForToken(token);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Please log in first' }, { status: 401 });

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const requestedKbId = String(formData.get('kb_id') || '').trim() || undefined;
    if (!file) return NextResponse.json({ error: 'Missing file' }, { status: 400 });

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const fileType = file.name.split('.').pop()?.toLowerCase() || 'file';
    const contentMd = await parseFile(file, buffer, token);
    const kbId = await getOrCreateReaderKb(supabase, user.id, requestedKbId);

    const filePath = `reader/${user.id}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from('files').upload(filePath, buffer, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
    if (uploadError) throw uploadError;

    const { data: publicData } = supabase.storage.from('files').getPublicUrl(filePath);
    const { data: doc, error } = await supabase
      .from('kb_documents')
      .insert({
        kb_id: kbId,
        user_id: user.id,
        title: file.name.replace(/\.[^/.]+$/, ''),
        content_md: contentMd,
        file_url: publicData.publicUrl,
        file_name: file.name,
        file_type: fileType,
        file_size: file.size,
        status: contentMd.trim() ? 'ready' : 'file_only',
      })
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({ document: doc });
  } catch (error: any) {
    console.error('Reader import error:', error);
    return NextResponse.json({ error: error.message || 'Import failed' }, { status: 500 });
  }
}
