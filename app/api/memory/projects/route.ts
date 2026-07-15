import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ProjectMemoryService } from '@/lib/memory-service';

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

function schemaHint(error: any) {
  const message = error?.message || String(error || '');
  return `${message || 'Project memory request failed'} 请确认已执行 supabase/migration_synapse_memory_phase1.sql。`;
}

export async function GET(req: NextRequest) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;
  try {
    const service = new ProjectMemoryService(auth.supabase, auth.user.id);
    const projects = await service.listProjects(Number(req.nextUrl.searchParams.get('limit') || 30));
    return NextResponse.json({ projects });
  } catch (error: any) {
    return NextResponse.json({ error: schemaHint(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;
  try {
    const body = await req.json().catch(() => ({}));
    const service = new ProjectMemoryService(auth.supabase, auth.user.id);
    const project = await service.upsertProject({
      projectName: body.projectName || body.project_name,
      projectType: body.projectType || body.project_type,
      currentState: body.currentState || body.current_state,
      keyDecisions: body.keyDecisions || body.key_decisions,
      openQuestions: body.openQuestions || body.open_questions,
      todos: body.todos,
      artifacts: body.artifacts,
      metadata: body.metadata,
    });
    return NextResponse.json(project);
  } catch (error: any) {
    return NextResponse.json({ error: schemaHint(error) }, { status: 500 });
  }
}

