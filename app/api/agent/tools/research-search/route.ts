import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserLLMConfig, getUserResearchToolConfig } from '@/lib/user-settings';
import { normalizeResearchOptions, planResearchQueries, retrieveResearchSources } from '@/lib/research-retrieval';

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

export async function POST(req: NextRequest) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;
  const body = await req.json().catch(() => ({}));
  const query = String(body.query || '').trim();
  if (!query) return NextResponse.json({ error: 'Missing search query' }, { status: 400 });

  const selected = normalizeResearchOptions(body.mode, body.depth);
  const [llmConfig, toolConfig] = await Promise.all([
    getUserLLMConfig(auth.token),
    getUserResearchToolConfig(auth.token),
  ]);

  const retrievalOptions = {
    query,
    mode: selected.mode,
    depth: selected.depth,
    llmConfig,
    toolConfig,
    supabase: auth.supabase,
    includeGithub: body.includeGithub === true,
  };
  const plan = Array.isArray(body.planOverride) && body.planOverride.length
    ? body.planOverride
    : await planResearchQueries(retrievalOptions);
  const sources = await retrieveResearchSources({ ...retrievalOptions, plan });

  return NextResponse.json({
    query,
    mode: selected.mode,
    depth: selected.depth,
    plannedQueries: plan,
    sources,
  });
}
