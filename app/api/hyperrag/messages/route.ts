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

  const conversation_id = req.nextUrl.searchParams.get('conversation_id');
  if (!conversation_id) return NextResponse.json({ error: '缺少 conversation_id' }, { status: 400 });

  const { data, error } = await supabase
    .from('qa_messages')
    .select('id, role, content, sources, created_at')
    .eq('conversation_id', conversation_id)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const { supabase, token } = getClient(req);
  if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });

  const { conversation_id, role, content, sources } = await req.json();
  if (!conversation_id || !role || !content) {
    return NextResponse.json({ error: '缺少必要字段' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('qa_messages')
    .insert({
      conversation_id,
      role,
      content,
      sources: sources || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
