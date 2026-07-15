import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { MemoryManager } from '@/lib/memory-service';

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

function memorySchemaHint(error: any) {
  const message = error?.message || String(error || '');
  if (message.includes('memories') || message.includes('schema cache')) {
    return `${message} 请先执行 supabase/migration_synapse_memory_phase1.sql。`;
  }
  return message || 'Memory request failed';
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;
  try {
    const { id } = await params;
    const manager = new MemoryManager(auth.supabase, auth.user.id);
    const memory = await manager.getMemory(id);
    if (!memory) return NextResponse.json({ error: 'Memory not found' }, { status: 404 });
    return NextResponse.json(memory);
  } catch (error: any) {
    return NextResponse.json({ error: memorySchemaHint(error) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const manager = new MemoryManager(auth.supabase, auth.user.id);
    const memory = await manager.updateMemory(id, {
      memoryType: body.memoryType || body.memory_type,
      layer: body.layer,
      title: body.title,
      content: body.content,
      summary: body.summary,
      sourceType: body.sourceType || body.source_type,
      sourceId: body.sourceId || body.source_id,
      confidence: body.confidence,
      importance: body.importance,
      visibility: body.visibility,
      status: body.status,
      tags: body.tags,
      metadata: body.metadata,
      expiresAt: body.expiresAt || body.expires_at,
    }, body.reason || 'api_update_memory');
    return NextResponse.json(memory);
  } catch (error: any) {
    return NextResponse.json({ error: memorySchemaHint(error) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;
  try {
    const { id } = await params;
    const manager = new MemoryManager(auth.supabase, auth.user.id);
    const result = await manager.deleteMemory(id, req.nextUrl.searchParams.get('hard') === 'true', 'api_delete_memory');
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: memorySchemaHint(error) }, { status: 500 });
  }
}

