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
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { data } = await supabase
    .from('user_settings')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  return NextResponse.json(data || {
    llm_provider: 'deepseek',
    llm_api_key: '',
    llm_api_url: '',
    llm_model: '',
    mineru_api_key: '',
  });
}

export async function PUT(req: NextRequest) {
  const supabase = getClient(req);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const body = await req.json();
  const { llm_provider, llm_api_key, llm_api_url, llm_model, mineru_api_key } = body;

  const { data, error } = await supabase
    .from('user_settings')
    .upsert({
      user_id: user.id,
      llm_provider: llm_provider || 'deepseek',
      llm_api_key: llm_api_key || '',
      llm_api_url: llm_api_url || '',
      llm_model: llm_model || '',
      mineru_api_key: mineru_api_key || '',
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
