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

export async function GET(req: NextRequest) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;
  try {
    const manager = new MemoryManager(auth.supabase, auth.user.id);
    const settings = await manager.ensureSettings();
    return NextResponse.json(settings);
  } catch (error: any) {
    return NextResponse.json({ error: `${error?.message || error} 请确认已执行 supabase/migration_synapse_memory_phase1.sql。` }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;
  try {
    await new MemoryManager(auth.supabase, auth.user.id).ensureSettings();
    const body = await req.json().catch(() => ({}));
    const payload: Record<string, any> = {};
    if (typeof body.autoWriteEnabled === 'boolean' || typeof body.auto_write_enabled === 'boolean') {
      payload.auto_write_enabled = body.autoWriteEnabled ?? body.auto_write_enabled;
    }
    if (typeof body.sensitiveAutoSave === 'boolean' || typeof body.sensitive_auto_save === 'boolean') {
      payload.sensitive_auto_save = body.sensitiveAutoSave ?? body.sensitive_auto_save;
    }
    if (body.enabledLayers || body.enabled_layers) payload.enabled_layers = body.enabledLayers || body.enabled_layers;
    if (Array.isArray(body.disabledMemoryTypes) || Array.isArray(body.disabled_memory_types)) {
      payload.disabled_memory_types = body.disabledMemoryTypes || body.disabled_memory_types;
    }
    if (body.metadata) payload.metadata = body.metadata;

    const { data, error } = await auth.supabase
      .from('memory_settings')
      .update(payload)
      .eq('user_id', auth.user.id)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: `${error?.message || error} 请确认已执行 supabase/migration_synapse_memory_phase1.sql。` }, { status: 500 });
  }
}

