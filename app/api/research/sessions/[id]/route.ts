import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { evidenceRowsToTyped } from '@/lib/research-workflow';
import { researchDbErrorResponse } from '@/lib/research-api-errors';

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

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;
  const { id } = await params;

  const { data: session, error } = await auth.supabase
    .from('research_sessions')
    .select('*')
    .eq('id', id)
    .eq('user_id', auth.user.id)
    .maybeSingle();

  if (error) return researchDbErrorResponse(error);
  if (!session) return NextResponse.json({ error: 'Research session not found' }, { status: 404 });

  const { data: evidence, error: evidenceError } = await auth.supabase
    .from('research_evidence')
    .select('*')
    .eq('session_id', id)
    .eq('user_id', auth.user.id)
    .order('created_at', { ascending: false });

  if (evidenceError) return researchDbErrorResponse(evidenceError);
  return NextResponse.json({ session, evidence: evidenceRowsToTyped(evidence || []) });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const topic = String(body.topic || '').trim();
  if (!topic) return NextResponse.json({ error: 'Missing session title' }, { status: 400 });

  const { data: session, error } = await auth.supabase
    .from('research_sessions')
    .update({ topic, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', auth.user.id)
    .select('*')
    .maybeSingle();

  if (error) return researchDbErrorResponse(error);
  if (!session) return NextResponse.json({ error: 'Research session not found' }, { status: 404 });
  return NextResponse.json({ session });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;
  const { id } = await params;

  const { data: session, error: sessionError } = await auth.supabase
    .from('research_sessions')
    .select('id')
    .eq('id', id)
    .eq('user_id', auth.user.id)
    .maybeSingle();

  if (sessionError) return researchDbErrorResponse(sessionError);
  if (!session) return NextResponse.json({ error: 'Research session not found' }, { status: 404 });

  const { error: evidenceError } = await auth.supabase
    .from('research_evidence')
    .delete()
    .eq('session_id', id)
    .eq('user_id', auth.user.id);

  if (evidenceError) return researchDbErrorResponse(evidenceError);

  const { error: deleteError } = await auth.supabase
    .from('research_sessions')
    .delete()
    .eq('id', id)
    .eq('user_id', auth.user.id);

  if (deleteError) return researchDbErrorResponse(deleteError);
  return NextResponse.json({ ok: true });
}
