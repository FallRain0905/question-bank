import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import mammoth from 'mammoth';

export async function POST(req: NextRequest, { params }: any) {
  const id = params.id as string;
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: '请上传文件' }, { status: 400 });

  const fileName = file.name;
  const fileType = fileName.split('.').pop()?.toLowerCase() || '';
  let contentMd = '';

  try {
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    if (fileType === 'pdf') {
      // Use MinerU v1 agent API (direct file upload, no auth needed)
      const minerForm = new FormData();
      minerForm.append('file', new Blob([buffer], { type: 'application/pdf' }), fileName);
      minerForm.append('return_md', 'true');

      const minerRes = await fetch('https://mineru.net/api/v1/agent/parse/file', {
        method: 'POST',
        body: minerForm,
      });

      if (minerRes.ok) {
        const data = await minerRes.json();
        contentMd = data.content || data.markdown || '';
      } else {
        // Fallback: try pdf-parse for text extraction
        const pdfParse = require('pdf-parse');
        const pdfData = await pdfParse(buffer);
        contentMd = pdfData.text || '';
      }
    } else if (fileType === 'docx') {
      const result = await mammoth.extractRawText({ buffer });
      contentMd = result.value || '';
    } else if (fileType === 'md' || fileType === 'markdown') {
      contentMd = new TextDecoder().decode(buffer);
    } else {
      // Plain text
      contentMd = new TextDecoder().decode(buffer);
    }

    if (!contentMd.trim()) {
      return NextResponse.json({ error: '无法解析文件内容' }, { status: 400 });
    }

    // Upload file to Supabase Storage
    const filePath = `kb/${user.id}/${Date.now()}-${fileName}`;
    await supabase.storage.from('files').upload(filePath, buffer, {
      contentType: file.type,
      upsert: false,
    });

    const { data: publicData } = supabase.storage.from('files').getPublicUrl(filePath);

    // Save document record
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
        status: 'ready',
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, document: doc });
  } catch (error: any) {
    console.error('Document upload error:', error);
    return NextResponse.json({ error: error.message || '上传失败' }, { status: 500 });
  }
}
