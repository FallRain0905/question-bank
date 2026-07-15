import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { MemoryManager, type MemoryLayer, type MemoryStatus } from '@/lib/memory-service';

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

function listParam(req: NextRequest, key: string) {
  const value = req.nextUrl.searchParams.get(key);
  return value ? value.split(',').map(item => item.trim()).filter(Boolean) : undefined;
}

function memorySchemaHint(error: any) {
  const message = error?.message || String(error || '');
  if (message.includes('memories') || message.includes('memory_settings') || message.includes('schema cache')) {
    return `${message} 请先执行 supabase/migration_synapse_memory_phase1.sql。`;
  }
  return message || 'Memory request failed';
}

export async function GET(req: NextRequest) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;
  try {
    const manager = new MemoryManager(auth.supabase, auth.user.id);
    const memories = await manager.searchMemories({
      query: req.nextUrl.searchParams.get('query') || '',
      layers: listParam(req, 'layers') as MemoryLayer[] | undefined,
      memoryTypes: listParam(req, 'types'),
      statuses: listParam(req, 'statuses') as MemoryStatus[] | undefined,
      tags: listParam(req, 'tags'),
      limit: Number(req.nextUrl.searchParams.get('limit') || 20),
    });
    return NextResponse.json({ memories });
  } catch (error: any) {
    return NextResponse.json({ error: memorySchemaHint(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;
  try {
    const body = await req.json().catch(() => ({}));
    const manager = new MemoryManager(auth.supabase, auth.user.id);
    const memory = await manager.createMemory({
      memoryType: body.memoryType || body.memory_type,
      layer: body.layer,
      title: body.title,
      content: body.content,
      summary: body.summary,
      sourceType: body.sourceType || body.source_type || 'manual',
      sourceId: body.sourceId || body.source_id,
      confidence: body.confidence,
      importance: body.importance,
      visibility: body.visibility,
      status: body.status || 'active',
      tags: body.tags,
      metadata: body.metadata,
      expiresAt: body.expiresAt || body.expires_at || null,
    }, 'api_create_memory');
    return NextResponse.json(memory);
  } catch (error: any) {
    return NextResponse.json({ error: memorySchemaHint(error) }, { status: 500 });
  }
}

