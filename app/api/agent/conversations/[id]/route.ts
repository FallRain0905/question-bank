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

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;
  const { id } = await params;

  const [{ data: conversation, error }, { data: messages }, { data: files }, { data: traces }] = await Promise.all([
    auth.supabase
      .from('agent_conversations')
      .select('*')
      .eq('id', id)
      .eq('user_id', auth.user.id)
      .maybeSingle(),
    auth.supabase
      .from('agent_messages')
      .select('*')
      .eq('conversation_id', id)
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: true }),
    auth.supabase
      .from('agent_files')
      .select('*')
      .eq('conversation_id', id)
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false }),
    auth.supabase
      .from('agent_tool_traces')
      .select('*')
      .eq('conversation_id', id)
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: true })
      .limit(100),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!conversation) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  const latestAssistantWithTools = [...(messages || [])]
    .reverse()
    .find((message: any) => message.role === 'assistant' && Array.isArray(message.metadata?.toolCalls));

  return NextResponse.json({
    conversation,
    messages: messages || [],
    files: files || [],
    traces: traces || [],
    toolCalls: latestAssistantWithTools?.metadata?.toolCalls || null,
    graphTrace: latestAssistantWithTools?.metadata?.graphTrace || null,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const title = String(body.title || '').trim().slice(0, 80);
  if (!title) return NextResponse.json({ error: 'Missing title' }, { status: 400 });

  const { data, error } = await auth.supabase
    .from('agent_conversations')
    .update({ title, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', auth.user.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;
  const { id } = await params;
  const { error } = await auth.supabase
    .from('agent_conversations')
    .delete()
    .eq('id', id)
    .eq('user_id', auth.user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
