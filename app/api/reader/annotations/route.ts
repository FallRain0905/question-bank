import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });

  const document_id = req.nextUrl.searchParams.get('document_id');
  if (!document_id) return NextResponse.json({ error: '缺少 document_id' }, { status: 400 });

  const { data, error } = await supabase
    .from('document_annotations')
    .select('*')
    .eq('document_id', document_id)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });

  const body = await req.json();
  const { document_id, action_type, selected_text, ai_response, save_to_notes, doc_title } = body;

  if (!document_id || !action_type || !selected_text || !ai_response) {
    return NextResponse.json({ error: '参数不完整' }, { status: 400 });
  }

  let saved_as_note_id: string | null = null;

  // 保存为笔记
  if (save_to_notes) {
    const actionLabels: Record<string, string> = {
      explain: '解释', translate: '翻译', polish: '润色', qa: '问答', note: '笔记',
    };
    const { data: noteData, error: noteError } = await supabase
      .from('notes')
      .insert({
        user_id: user.id,
        title: `${doc_title || '文档'} - ${actionLabels[action_type] || action_type}`,
        description: `## 原文\n${selected_text}\n\n## AI 回答\n${ai_response}`,
        status: 'pending',
        visibility: 'public',
      })
      .select('id')
      .single();

    if (!noteError && noteData) saved_as_note_id = noteData.id;
  }

  const { data, error } = await supabase
    .from('document_annotations')
    .insert({
      document_id,
      user_id: user.id,
      action_type,
      selected_text,
      ai_response,
      saved_as_note_id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 });

  const { error } = await supabase
    .from('document_annotations')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
