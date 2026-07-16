import { createClient } from '@supabase/supabase-js';
import { getUserLLMConfigByUserId, getUserResearchToolConfigByUserId } from '../lib/user-settings';
import { updateAgentRun } from '../lib/agent-run-service';
import { runConfirmedDocumentLangGraphTurn, runSynapseLangGraphTurn } from '../lib/synapse-runtime';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const POLL_INTERVAL_MS = Number(process.env.SYNAPSE_RUN_WORKER_POLL_MS || 3000);
const BATCH_SIZE = Math.max(1, Math.min(Number(process.env.SYNAPSE_RUN_WORKER_BATCH_SIZE || 1), 5));

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for Synapse run worker');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function claimRun() {
  const { data: candidates, error } = await supabase
    .from('agent_runs')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (error) throw error;
  for (const run of candidates || []) {
    const { data, error: updateError } = await supabase
      .from('agent_runs')
      .update({ status: 'running', started_at: new Date().toISOString() })
      .eq('id', run.id)
      .eq('status', 'queued')
      .select()
      .maybeSingle();
    if (updateError) throw updateError;
    if (data) return data;
  }
  return null;
}

async function executeRun(run: any) {
  const input = run.input || {};
  const message = String(input.message || '').trim();
  if (!message) throw new Error('Queued agent run is missing input.message');

  const [llmConfig, toolConfig] = await Promise.all([
    getUserLLMConfigByUserId(run.user_id),
    getUserResearchToolConfigByUserId(run.user_id),
  ]);

  const base = {
    userId: run.user_id,
    message,
    conversationId: run.conversation_id || input.conversationId || undefined,
    supabase,
    llmConfig,
    toolConfig,
    agentSettings: run.metadata?.agentSettings || input.agentSettings || {},
    runId: run.id,
  };

  if (input.confirmedPlan) {
    return runConfirmedDocumentLangGraphTurn({
      ...base,
      conversationId: base.conversationId || '',
      confirmedPlan: input.confirmedPlan,
    });
  }

  return runSynapseLangGraphTurn(base);
}

async function tick() {
  const run = await claimRun();
  if (!run) return;
  console.log(`[synapse-run-worker] claimed ${run.id}`);
  try {
    const result = await executeRun(run);
    await updateAgentRun(supabase, run.user_id, run.id, {
      conversationId: result.conversation?.id || run.conversation_id || null,
      status: 'completed',
      output: {
        type: result.type,
        conversationId: result.conversation?.id || run.conversation_id || null,
        messageId: result.assistant?.id || null,
        toolCallCount: result.toolCalls?.length || 0,
        sourceCount: result.sources?.length || 0,
      },
      finishedAt: new Date().toISOString(),
    });
    console.log(`[synapse-run-worker] completed ${run.id}`);
  } catch (error: any) {
    console.error(`[synapse-run-worker] failed ${run.id}:`, error);
    await updateAgentRun(supabase, run.user_id, run.id, {
      status: 'failed',
      error: error?.message || String(error),
      finishedAt: new Date().toISOString(),
    });
  }
}

async function main() {
  console.log('[synapse-run-worker] started');
  while (true) {
    try {
      await tick();
    } catch (error) {
      console.error('[synapse-run-worker] tick failed:', error);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch(error => {
  console.error('[synapse-run-worker] fatal:', error);
  process.exit(1);
});
