import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getClient(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  return {
    supabase: createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    ),
    token,
  };
}

export async function GET(req: NextRequest) {
  const { supabase, token } = getClient(req);
  if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });

  const kb_id = req.nextUrl.searchParams.get('kb_id');

  let query = supabase
    .from('qa_conversations')
    .select('id, title, kb_id, mode, created_at, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  if (kb_id) query = query.eq('kb_id', kb_id);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const { supabase, token } = getClient(req);
  if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });

  const { kb_id, title, mode } = await req.json();
  if (!kb_id) return NextResponse.json({ error: '缺少 kb_id' }, { status: 400 });

  const { data, error } = await supabase
    .from('qa_conversations')
    .insert({
      user_id: user.id,
      kb_id,
      title: title || '新对话',
      mode: mode || 'hyper',
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const { supabase, token } = getClient(req);
  if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });

  const { id, title, mode } = await req.json();
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 });

  const updates: any = { updated_at: new Date().toISOString() };
  if (title !== undefined) updates.title = title;
  if (mode !== undefined) updates.mode = mode;

  const { data, error } = await supabase
    .from('qa_conversations')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const { supabase, token } = getClient(req);
  if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 });

  const { error } = await supabase
    .from('qa_conversations')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
