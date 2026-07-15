import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { LearningMemoryService } from '@/lib/memory-service';

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
  return `${message || 'Learning memory request failed'} 请确认已执行 supabase/migration_synapse_memory_phase1.sql。`;
}

export async function GET(req: NextRequest) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;
  try {
    const service = new LearningMemoryService(auth.supabase, auth.user.id);
    const profiles = await service.listProfiles(Number(req.nextUrl.searchParams.get('limit') || 50));
    return NextResponse.json({ profiles });
  } catch (error: any) {
    return NextResponse.json({ error: schemaHint(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;
  try {
    const body = await req.json().catch(() => ({}));
    const service = new LearningMemoryService(auth.supabase, auth.user.id);
    const profile = await service.upsertProfile({
      subject: body.subject,
      concept: body.concept,
      problemType: body.problemType || body.problem_type,
      masteryScore: body.masteryScore ?? body.mastery_score,
      errorPatterns: body.errorPatterns || body.error_patterns,
      strengths: body.strengths,
      nextPractice: body.nextPractice || body.next_practice,
      lastPracticedAt: body.lastPracticedAt || body.last_practiced_at,
      reviewDueAt: body.reviewDueAt || body.review_due_at,
      metadata: body.metadata,
    });
    return NextResponse.json(profile);
  } catch (error: any) {
    return NextResponse.json({ error: schemaHint(error) }, { status: 500 });
  }
}

