import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { MemoryManager, type MemoryLayer } from '@/lib/memory-service';

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
  try {
    const body = await req.json().catch(() => ({}));
    const manager = new MemoryManager(auth.supabase, auth.user.id);
    const result = await manager.getMemoryContext(String(body.query || ''), {
      layers: body.layers as MemoryLayer[] | undefined,
      memoryTypes: Array.isArray(body.memoryTypes) ? body.memoryTypes : undefined,
      tags: Array.isArray(body.tags) ? body.tags : undefined,
      limit: Number(body.limit || 10),
    });
    return NextResponse.json(result);
  } catch (error: any) {
    const message = error?.message || String(error || '');
    return NextResponse.json({ error: `${message} 请确认已执行 supabase/migration_synapse_memory_phase1.sql。` }, { status: 500 });
  }
}

