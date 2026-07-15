type SupabaseLike = {
  from: (table: string) => any;
};

export type AgentRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

function sanitizeText(value: unknown, maxLength = 120000) {
  let output = '';
  const input = String(value || '');
  for (let index = 0; index < input.length && output.length < maxLength; index += 1) {
    const code = input.charCodeAt(index);
    if (code === 0) continue;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = input.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        output += input[index] + input[index + 1];
        index += 1;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    output += input[index];
  }
  return output;
}

function sanitizeJson<T>(value: T, depth = 0): T {
  if (depth > 8) return null as T;
  if (typeof value === 'string') return sanitizeText(value) as T;
  if (Array.isArray(value)) return value.map(item => sanitizeJson(item, depth + 1)) as T;
  if (value && typeof value === 'object') {
    const next: Record<string, any> = {};
    for (const [key, item] of Object.entries(value as Record<string, any>)) {
      next[sanitizeText(key, 200)] = sanitizeJson(item, depth + 1);
    }
    return next as T;
  }
  return value;
}

export async function createAgentRun(
  supabase: SupabaseLike,
  userId: string,
  input: {
    conversationId?: string;
    input?: Record<string, any>;
    metadata?: Record<string, any>;
    status?: AgentRunStatus;
  }
) {
  const payload = sanitizeJson({
    user_id: userId,
    conversation_id: input.conversationId || null,
    status: input.status || 'running',
    input: input.input || {},
    metadata: input.metadata || {},
  });

  const { data, error } = await supabase
    .from('agent_runs')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateAgentRun(
  supabase: SupabaseLike,
  userId: string,
  runId: string,
  patch: {
    conversationId?: string | null;
    status?: AgentRunStatus;
    output?: Record<string, any>;
    error?: string;
    metadata?: Record<string, any>;
    finishedAt?: string | null;
  }
) {
  const payload: Record<string, any> = {};
  if ('conversationId' in patch) payload.conversation_id = patch.conversationId || null;
  if (patch.status) payload.status = patch.status;
  if (patch.output) payload.output = patch.output;
  if (typeof patch.error === 'string') payload.error = patch.error;
  if (patch.metadata) payload.metadata = patch.metadata;
  if ('finishedAt' in patch) payload.finished_at = patch.finishedAt;

  const { data, error } = await supabase
    .from('agent_runs')
    .update(sanitizeJson(payload))
    .eq('id', runId)
    .eq('user_id', userId)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function appendAgentRunEvent(
  supabase: SupabaseLike,
  userId: string,
  runId: string,
  eventType: string,
  payload: Record<string, any>,
  conversationId?: string | null
) {
  const { data, error } = await supabase
    .from('agent_run_events')
    .insert(sanitizeJson({
      run_id: runId,
      user_id: userId,
      conversation_id: conversationId || payload?.data?.conversationId || null,
      event_type: eventType,
      payload,
    }))
    .select()
    .single();
  if (error) throw error;
  return data;
}
