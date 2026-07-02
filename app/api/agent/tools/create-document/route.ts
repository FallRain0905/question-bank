import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  return { supabase, user };
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;
  const body = await req.json().catch(() => ({}));
  const title = String(body.title || 'Agent 生成文档').trim();
  const content = String(body.markdown || body.content_md || '').trim();
  if (!content) return NextResponse.json({ error: 'Missing document markdown' }, { status: 400 });

  const { data, error } = await auth.supabase
    .from('agent_documents')
    .insert({
      user_id: auth.user.id,
      title,
      content_md: content,
      source: String(body.source || 'agent'),
      metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ document: data });
}
