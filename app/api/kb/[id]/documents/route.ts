import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import mammoth from 'mammoth';
import { getUserMineruConfig } from '@/lib/user-settings';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: any) {
  const { id } = await params;
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Please log in first' }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'Missing file' }, { status: 400 });

  const fileName = file.name;
  const fileType = fileName.split('.').pop()?.toLowerCase() || '';
  let contentMd = '';

  try {
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    if (fileType === 'pdf') {
      try {
        const minerForm = new FormData();
        const pdfBytes = new Uint8Array(buffer.length);
        pdfBytes.set(buffer);
        minerForm.append('file', new Blob([pdfBytes.buffer], { type: 'application/pdf' }), fileName);
        minerForm.append('return_md', 'true');

        const mineru = await getUserMineruConfig(token);
        const headers: Record<string, string> = {};
        if (mineru.token) headers.Authorization = `Bearer ${mineru.token}`;

        const minerRes = await fetch('https://mineru.net/api/v1/agent/parse/file', {
          method: 'POST',
          headers,
          body: minerForm,
        });

        if (minerRes.ok) {
          const data = await minerRes.json();
          contentMd = data.content || data.markdown || '';
        }
      } catch (pdfError) {
        console.warn('PDF parse failed; storing original PDF only.', pdfError);
      }
    } else if (fileType === 'docx') {
      const result = await mammoth.extractRawText({ buffer });
      contentMd = result.value || '';
    } else if (fileType === 'md' || fileType === 'markdown' || fileType === 'txt') {
      contentMd = new TextDecoder().decode(buffer);
    } else {
      contentMd = new TextDecoder().decode(buffer);
    }

    if (!contentMd.trim() && fileType !== 'pdf') {
      return NextResponse.json({ error: 'Unable to parse file content' }, { status: 400 });
    }

    const filePath = `kb/${user.id}/${Date.now()}-${fileName}`;
    const { error: uploadError } = await supabase.storage.from('files').upload(filePath, buffer, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
    if (uploadError) throw uploadError;

    const { data: publicData } = supabase.storage.from('files').getPublicUrl(filePath);

    const { data: doc, error } = await supabase
      .from('kb_documents')
      .insert({
        kb_id: id,
        user_id: user.id,
        title: fileName.replace(/\.[^/.]+$/, ''),
        content_md: contentMd,
        file_url: publicData.publicUrl,
        file_name: fileName,
        file_type: fileType,
        file_size: file.size,
        status: contentMd.trim() ? 'ready' : 'file_only',
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, document: doc });
  } catch (error: any) {
    console.error('Document upload error:', error);
    return NextResponse.json({ error: error.message || 'Upload failed' }, { status: 500 });
  }
}
