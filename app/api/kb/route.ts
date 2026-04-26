import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getClient(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

export async function GET(req: NextRequest) {
  const supabase = getClient(req);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });

  const { data, error } = await supabase
    .from('knowledge_bases')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Get document count for each KB
  const kbIds = data.map((k: any) => k.id);
  const { data: counts } = await supabase
    .from('kb_documents')
    .select('kb_id')
    .in('kb_id', kbIds);

  const countMap = new Map<string, number>();
  counts?.forEach((d: any) => countMap.set(d.kb_id, (countMap.get(d.kb_id) || 0) + 1));

  const result = data.map((kb: any) => ({ ...kb, document_count: countMap.get(kb.id) || 0 }));
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const supabase = getClient(req);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });

  const { name, description } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: '名称不能为空' }, { status: 400 });

  const { data, error } = await supabase
    .from('knowledge_bases')
    .insert({ user_id: user.id, name: name.trim(), description })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
