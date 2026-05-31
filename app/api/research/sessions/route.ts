import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserLLMConfig, getUserResearchToolConfig } from '@/lib/user-settings';
import { runResearchRetrieval } from '@/lib/research-retrieval';
import { researchDbErrorResponse } from '@/lib/research-api-errors';
import {
  buildResearchScope,
  getDirectionCards,
  CLARIFICATION_QUESTIONS,
} from '@/lib/research-workflow';

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
  return { token, supabase, user };
}

export async function GET(req: NextRequest) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;

  const { data, error } = await auth.supabase
    .from('research_sessions')
    .select('*')
    .eq('user_id', auth.user.id)
    .order('updated_at', { ascending: false })
    .limit(20);

  if (error) return researchDbErrorResponse(error);
  return NextResponse.json(data || []);
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;

  const body = await req.json();
  const topic = String(body.topic || '').trim();
  if (!topic) return NextResponse.json({ error: 'Missing research topic' }, { status: 400 });

  const [llmConfig, toolConfig] = await Promise.all([
    getUserLLMConfig(auth.token),
    getUserResearchToolConfig(auth.token),
  ]);

  let quickScanSources: any[] = [];
  try {
    const quickScan = await runResearchRetrieval({
      query: topic,
      mode: 'both',
      depth: 'fast',
      llmConfig,
      toolConfig,
      supabase: auth.supabase,
    });
    quickScanSources = quickScan.sources.slice(0, 6);
  } catch {
    quickScanSources = [];
  }

  const directionCards = getDirectionCards(topic, quickScanSources.length);
  const recommendedScope = buildResearchScope(topic, {
    focus: directionCards.filter(card => card.recommended).map(card => card.title),
  });

  const { data, error } = await auth.supabase
    .from('research_sessions')
    .insert({
      user_id: auth.user.id,
      topic,
      status: 'WAITING_USER_CONFIRMATION',
      scope: recommendedScope,
      graph_template: null,
      depth: recommendedScope.depth,
    })
    .select()
    .single();

  if (error) return researchDbErrorResponse(error);

  return NextResponse.json({
    session: data,
    directionCards,
    clarificationQuestions: CLARIFICATION_QUESTIONS,
    recommendedScope,
    quickScanSources,
  });
}
