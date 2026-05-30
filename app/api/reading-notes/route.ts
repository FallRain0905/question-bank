import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

  const documentId = req.nextUrl.searchParams.get('document_id');
  let query = auth.supabase
    .from('reading_notes')
    .select('*')
    .eq('user_id', auth.user.id)
    .order('updated_at', { ascending: false });

  if (documentId) query = query.eq('document_id', documentId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data || []);
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;

  const body = await req.json();
  const title = (body.title || '').trim() || 'Untitled note';
  const content = (body.content || '').trim();

  const { data, error } = await auth.supabase
    .from('reading_notes')
    .insert({
      user_id: auth.user.id,
      document_id: body.document_id || null,
      paper_id: body.paper_id || null,
      title,
      content,
      selected_text: body.selected_text || null,
      source_url: body.source_url || null,
      metadata: body.metadata || {},
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;

  const body = await req.json();
  if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  for (const key of ['title', 'content', 'selected_text', 'source_url', 'metadata']) {
    if (key in body) patch[key] = body[key];
  }

  const { data, error } = await auth.supabase
    .from('reading_notes')
    .update(patch)
    .eq('id', body.id)
    .eq('user_id', auth.user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const { error } = await auth.supabase
    .from('reading_notes')
    .delete()
    .eq('id', id)
    .eq('user_id', auth.user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

