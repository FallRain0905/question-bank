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

function missingArtifactsTable(error: any) {
  const message = String(error?.message || error?.details || error?.hint || '');
  return error?.code === '42P01' || /agent_artifacts|schema cache|could not find/i.test(message);
}

export async function GET(req: NextRequest) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(req.url);
  const conversationId = searchParams.get('conversation_id') || '';
  const runId = searchParams.get('run_id') || '';
  const kind = searchParams.get('kind') || '';
  const limit = Math.min(Math.max(Number(searchParams.get('limit') || 100), 1), 300);

  try {
    let query = auth.supabase
      .from('agent_artifacts')
      .select('*')
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (conversationId) query = query.eq('conversation_id', conversationId);
    if (runId) query = query.eq('run_id', runId);
    if (kind) query = query.eq('kind', kind);

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json(data || []);
  } catch (error: any) {
    if (missingArtifactsTable(error)) return NextResponse.json([]);
    return NextResponse.json({ error: error.message || 'Failed to load artifacts' }, { status: 500 });
  }
}
