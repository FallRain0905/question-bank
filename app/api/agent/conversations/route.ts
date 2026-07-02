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

export async function GET(req: NextRequest) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;

  const { data, error } = await auth.supabase
    .from('agent_conversations')
    .select('*')
    .eq('user_id', auth.user.id)
    .order('updated_at', { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;
  const body = await req.json().catch(() => ({}));
  const title = String(body.title || 'New Synapse Conversation').trim().slice(0, 80) || 'New Synapse Conversation';

  const { data, error } = await auth.supabase
    .from('agent_conversations')
    .insert({ user_id: auth.user.id, title })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
