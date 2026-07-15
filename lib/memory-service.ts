export type MemoryLayer = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
export type MemoryStatus = 'candidate' | 'active' | 'archived' | 'disabled' | 'deleted';
export type MemoryVisibility = 'private' | 'agent_only' | 'disabled';

type SupabaseLike = {
  from: (table: string) => any;
};

export type MemoryRecord = {
  id: string;
  user_id: string;
  memory_type: string;
  layer: MemoryLayer;
  title: string;
  content: string;
  summary: string;
  source_type: string;
  source_id: string | null;
  confidence: number;
  importance: number;
  visibility: MemoryVisibility;
  status: MemoryStatus;
  tags: string[];
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
  last_accessed_at: string | null;
  expires_at: string | null;
};

export type MemoryCreateInput = {
  memoryType?: string;
  layer?: MemoryLayer;
  title?: string;
  content: string;
  summary?: string;
  sourceType?: string;
  sourceId?: string;
  confidence?: number;
  importance?: number;
  visibility?: MemoryVisibility;
  status?: MemoryStatus;
  tags?: string[];
  metadata?: Record<string, any>;
  expiresAt?: string | null;
};

export type MemorySearchOptions = {
  query?: string;
  layers?: MemoryLayer[];
  memoryTypes?: string[];
  statuses?: MemoryStatus[];
  tags?: string[];
  limit?: number;
  includeExpired?: boolean;
};

export type RankedMemory = MemoryRecord & {
  relevanceScore: number;
  matchedTerms: string[];
};

export type LearningProfileInput = {
  subject: string;
  concept: string;
  problemType?: string;
  masteryScore?: number;
  errorPatterns?: string[];
  strengths?: string[];
  nextPractice?: string[];
  lastPracticedAt?: string;
  reviewDueAt?: string;
  metadata?: Record<string, any>;
};

export type ProjectMemoryInput = {
  projectName: string;
  projectType?: string;
  currentState?: Record<string, any>;
  keyDecisions?: any[];
  openQuestions?: any[];
  todos?: any[];
  artifacts?: any[];
  metadata?: Record<string, any>;
};

export type ExtractMemoryInput = {
  userMessage: string;
  assistantMessage?: string;
  sourceType?: string;
  sourceId?: string;
};

export const MEMORY_LAYER_DESCRIPTIONS: Record<MemoryLayer, string> = {
  L0: '当前会话短期记忆',
  L1: '任务工作记忆',
  L2: '用户长期档案',
  L3: '学习画像记忆',
  L4: '科研语义记忆',
  L5: '流程与技能记忆',
};

const DEFAULT_SEARCH_LIMIT = 12;
const MAX_FETCH_FOR_TEXT_RANK = 250;
const SENSITIVE_PATTERN = /身份证|护照|银行卡|密码|口令|token|api[_ -]?key|secret|私钥|住址|手机号|电话|email|邮箱/i;

function clamp01(value: unknown, fallback: number) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, num));
}

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
  return output.trim();
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

function normalizeTags(tags: string[] | undefined) {
  return Array.from(new Set((tags || [])
    .map(tag => sanitizeText(tag, 40).toLowerCase())
    .filter(Boolean)))
    .slice(0, 24);
}

function titleFromContent(content: string) {
  return sanitizeText(content.replace(/\s+/g, ' '), 80) || 'Untitled memory';
}

function summaryFromContent(content: string) {
  return sanitizeText(content.replace(/\s+/g, ' '), 300);
}

function textTokens(text: string) {
  const lower = text.toLowerCase();
  const words = lower.match(/[\p{L}\p{N}_-]{2,}/gu) || [];
  const cjk = Array.from(lower.matchAll(/[\u4e00-\u9fff]{2,}/g)).flatMap(match => {
    const value = match[0];
    const grams: string[] = [];
    for (let index = 0; index < value.length - 1; index += 1) {
      grams.push(value.slice(index, index + 2));
    }
    return grams;
  });
  return Array.from(new Set([...words, ...cjk])).slice(0, 80);
}

function scoreMemory(memory: MemoryRecord, query: string) {
  const cleanQuery = sanitizeText(query, 500).toLowerCase();
  if (!cleanQuery) {
    return { score: Number(memory.importance || 0.5) * 0.35 + Number(memory.confidence || 0.5) * 0.25, terms: [] };
  }
  const haystack = `${memory.title}\n${memory.summary}\n${memory.content}\n${(memory.tags || []).join(' ')}`.toLowerCase();
  const terms = textTokens(cleanQuery);
  const matched = terms.filter(term => haystack.includes(term));
  const exact = haystack.includes(cleanQuery) ? 0.45 : 0;
  const tokenScore = terms.length ? matched.length / terms.length : 0;
  const score = exact
    + tokenScore * 0.35
    + Number(memory.importance || 0.5) * 0.12
    + Number(memory.confidence || 0.5) * 0.08;
  return { score: Math.min(1, score), terms: matched.slice(0, 12) };
}

function compactMemory(memory: RankedMemory) {
  return `- [${memory.layer}/${memory.memory_type}] ${memory.title}: ${memory.summary || memory.content.slice(0, 180)} (score=${memory.relevanceScore.toFixed(2)})`;
}

export class MemoryManager {
  constructor(private supabase: SupabaseLike, private userId: string) {}

  async ensureSettings() {
    const payload = { user_id: this.userId };
    const { data, error } = await this.supabase
      .from('memory_settings')
      .upsert(payload, { onConflict: 'user_id' })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async createMemory(input: MemoryCreateInput, reason = 'create_memory') {
    const content = sanitizeText(input.content);
    if (!content) throw new Error('Memory content is required');
    const payload = {
      user_id: this.userId,
      memory_type: sanitizeText(input.memoryType || 'fact', 80),
      layer: input.layer || 'L2',
      title: sanitizeText(input.title || titleFromContent(content), 160),
      content,
      summary: sanitizeText(input.summary || summaryFromContent(content), 600),
      source_type: sanitizeText(input.sourceType || 'manual', 80),
      source_id: input.sourceId ? sanitizeText(input.sourceId, 160) : null,
      confidence: clamp01(input.confidence, 0.6),
      importance: clamp01(input.importance, 0.5),
      visibility: input.visibility || 'private',
      status: input.status || 'active',
      tags: normalizeTags(input.tags),
      metadata: sanitizeJson(input.metadata || {}),
      expires_at: input.expiresAt || null,
    };

    const mergeTarget = await this.findObviousDuplicate(payload);
    if (mergeTarget) {
      return this.updateMemory(mergeTarget.id, {
        content: payload.content.length > mergeTarget.content.length ? payload.content : mergeTarget.content,
        summary: payload.summary || mergeTarget.summary,
        confidence: Math.max(Number(mergeTarget.confidence || 0), Number(payload.confidence || 0)),
        importance: Math.max(Number(mergeTarget.importance || 0), Number(payload.importance || 0)),
        tags: Array.from(new Set([...(mergeTarget.tags || []), ...payload.tags])),
        metadata: {
          ...(mergeTarget.metadata || {}),
          mergedFrom: [...(mergeTarget.metadata?.mergedFrom || []), payload.source_id || payload.source_type],
        },
      }, 'merge_duplicate_memory');
    }

    const { data, error } = await this.supabase
      .from('memories')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    await this.recordEvent(data.id, 'created', null, data, reason);
    return data as MemoryRecord;
  }

  async updateMemory(id: string, patch: Partial<MemoryCreateInput & { status: MemoryStatus; tags: string[] }>, reason = 'update_memory') {
    const before = await this.getMemory(id);
    if (!before) throw new Error('Memory not found');
    const payload: Record<string, any> = {};
    if (patch.memoryType !== undefined) payload.memory_type = sanitizeText(patch.memoryType, 80);
    if (patch.layer !== undefined) payload.layer = patch.layer;
    if (patch.title !== undefined) payload.title = sanitizeText(patch.title, 160);
    if (patch.content !== undefined) payload.content = sanitizeText(patch.content);
    if (patch.summary !== undefined) payload.summary = sanitizeText(patch.summary, 600);
    if (patch.sourceType !== undefined) payload.source_type = sanitizeText(patch.sourceType, 80);
    if (patch.sourceId !== undefined) payload.source_id = patch.sourceId ? sanitizeText(patch.sourceId, 160) : null;
    if (patch.confidence !== undefined) payload.confidence = clamp01(patch.confidence, before.confidence);
    if (patch.importance !== undefined) payload.importance = clamp01(patch.importance, before.importance);
    if (patch.visibility !== undefined) payload.visibility = patch.visibility;
    if (patch.status !== undefined) payload.status = patch.status;
    if (patch.tags !== undefined) payload.tags = normalizeTags(patch.tags);
    if (patch.metadata !== undefined) payload.metadata = sanitizeJson(patch.metadata);
    if (patch.expiresAt !== undefined) payload.expires_at = patch.expiresAt;

    const { data, error } = await this.supabase
      .from('memories')
      .update(payload)
      .eq('id', id)
      .eq('user_id', this.userId)
      .select()
      .single();
    if (error) throw error;
    await this.recordEvent(id, 'updated', before, data, reason);
    return data as MemoryRecord;
  }

  async deleteMemory(id: string, hard = false, reason = 'delete_memory') {
    const before = await this.getMemory(id);
    if (!before) return { ok: true };
    if (hard) {
      const { error } = await this.supabase
        .from('memories')
        .delete()
        .eq('id', id)
        .eq('user_id', this.userId);
      if (error) throw error;
      await this.recordEvent(id, 'hard_deleted', before, null, reason);
      return { ok: true };
    }
    await this.updateMemory(id, { status: 'deleted' }, reason);
    return { ok: true };
  }

  async getMemory(id: string) {
    const { data, error } = await this.supabase
      .from('memories')
      .select('*')
      .eq('id', id)
      .eq('user_id', this.userId)
      .maybeSingle();
    if (error) throw error;
    return data as MemoryRecord | null;
  }

  async searchMemories(options: MemorySearchOptions = {}) {
    const limit = Math.min(Math.max(Number(options.limit || DEFAULT_SEARCH_LIMIT), 1), 50);
    const statuses = options.statuses?.length ? options.statuses : ['active'];
    let query = this.supabase
      .from('memories')
      .select('*')
      .eq('user_id', this.userId)
      .in('status', statuses)
      .order('updated_at', { ascending: false })
      .limit(MAX_FETCH_FOR_TEXT_RANK);

    if (options.layers?.length) query = query.in('layer', options.layers);
    if (options.memoryTypes?.length) query = query.in('memory_type', options.memoryTypes);

    const { data, error } = await query;
    if (error) throw error;

    const now = Date.now();
    const wantedTags = normalizeTags(options.tags);
    const ranked = ((data || []) as MemoryRecord[])
      .filter(memory => options.includeExpired || !memory.expires_at || Date.parse(memory.expires_at) > now)
      .filter(memory => !wantedTags.length || wantedTags.some(tag => (memory.tags || []).includes(tag)))
      .map(memory => {
        const result = scoreMemory(memory, options.query || '');
        return { ...memory, relevanceScore: result.score, matchedTerms: result.terms };
      })
      .filter(memory => !options.query || memory.relevanceScore > 0.08)
      .sort((a, b) => b.relevanceScore - a.relevanceScore || Date.parse(b.updated_at) - Date.parse(a.updated_at))
      .slice(0, limit);

    if (ranked.length) {
      await this.supabase
        .from('memories')
        .update({ last_accessed_at: new Date().toISOString() })
        .in('id', ranked.map(memory => memory.id))
        .eq('user_id', this.userId);
    }
    return ranked;
  }

  async getMemoryContext(query: string, options: Omit<MemorySearchOptions, 'query'> = {}) {
    const memories = await this.searchMemories({ ...options, query });
    if (!memories.length) return { memories, contextText: '' };
    const grouped = memories.reduce<Record<string, RankedMemory[]>>((acc, memory) => {
      const key = `${memory.layer} ${MEMORY_LAYER_DESCRIPTIONS[memory.layer]}`;
      acc[key] = acc[key] || [];
      acc[key].push(memory);
      return acc;
    }, {});
    const contextText = Object.entries(grouped)
      .map(([group, items]) => `${group}\n${items.map(compactMemory).join('\n')}`)
      .join('\n\n');
    return { memories, contextText };
  }

  async linkMemories(sourceMemoryId: string, targetMemoryId: string, relationType = 'related', weight = 0.5, metadata: Record<string, any> = {}) {
    const payload = {
      user_id: this.userId,
      source_memory_id: sourceMemoryId,
      target_memory_id: targetMemoryId,
      relation_type: sanitizeText(relationType, 80),
      weight: clamp01(weight, 0.5),
      metadata: sanitizeJson(metadata),
    };
    const { data, error } = await this.supabase
      .from('memory_links')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    await this.recordEvent(sourceMemoryId, 'linked', null, data, `link:${relationType}`);
    return data;
  }

  private async findObviousDuplicate(payload: Record<string, any>) {
    const { data, error } = await this.supabase
      .from('memories')
      .select('*')
      .eq('user_id', this.userId)
      .eq('status', 'active')
      .eq('layer', payload.layer)
      .eq('memory_type', payload.memory_type)
      .order('updated_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    const title = String(payload.title || '').toLowerCase();
    const content = String(payload.content || '').toLowerCase();
    return ((data || []) as MemoryRecord[]).find(memory => {
      const oldTitle = String(memory.title || '').toLowerCase();
      const oldContent = String(memory.content || '').toLowerCase();
      return oldTitle === title || (content.length > 20 && (oldContent.includes(content) || content.includes(oldContent)));
    }) || null;
  }

  private async recordEvent(memoryId: string | null, eventType: string, oldValue: any, newValue: any, reason: string) {
    const { error } = await this.supabase
      .from('memory_events')
      .insert({
        user_id: this.userId,
        memory_id: memoryId,
        event_type: sanitizeText(eventType, 80),
        old_value: sanitizeJson(oldValue),
        new_value: sanitizeJson(newValue),
        reason: sanitizeText(reason, 400),
      });
    if (error) console.warn('Failed to record memory event:', error.message || error);
  }
}

export class MemoryExtractor {
  extractCandidates(input: ExtractMemoryInput): MemoryCreateInput[] {
    const userMessage = sanitizeText(input.userMessage, 4000);
    const assistantMessage = sanitizeText(input.assistantMessage || '', 4000);
    const combined = `${userMessage}\n${assistantMessage}`.trim();
    if (!combined) return [];

    const explicit = userMessage.match(/(?:记住|帮我记住|remember(?: that)?)([:：]?\s*)([\s\S]{4,800})/i);
    if (explicit) {
      const content = explicit[2].trim();
      return [{
        layer: inferLayer(content),
        memoryType: inferMemoryType(content),
        title: titleFromContent(content),
        content,
        summary: summaryFromContent(content),
        sourceType: input.sourceType || 'conversation',
        sourceId: input.sourceId,
        confidence: 0.9,
        importance: 0.75,
        status: 'active',
        tags: inferTags(content),
        metadata: { extractor: 'explicit_remember' },
      }];
    }

    if (SENSITIVE_PATTERN.test(combined)) return [];

    const candidates: MemoryCreateInput[] = [];
    const preference = userMessage.match(/(?:我希望|我喜欢|我更喜欢|以后|默认|请尽量)([\s\S]{4,240})/);
    if (preference) {
      candidates.push({
        layer: 'L2',
        memoryType: 'preference',
        title: titleFromContent(preference[0]),
        content: preference[0],
        sourceType: input.sourceType || 'conversation',
        sourceId: input.sourceId,
        confidence: 0.55,
        importance: 0.55,
        status: 'candidate',
        tags: ['preference'],
        metadata: { extractor: 'preference_heuristic' },
      });
    }

    const project = userMessage.match(/(?:项目|课题|研究|实验|benchmark|论文|报告)([\s\S]{8,260})/i);
    if (project) {
      candidates.push({
        layer: 'L4',
        memoryType: 'research_context',
        title: titleFromContent(project[0]),
        content: project[0],
        sourceType: input.sourceType || 'conversation',
        sourceId: input.sourceId,
        confidence: 0.5,
        importance: 0.6,
        status: 'candidate',
        tags: inferTags(project[0]),
        metadata: { extractor: 'project_heuristic' },
      });
    }

    return candidates.slice(0, 4);
  }
}

export class MemoryWriter {
  constructor(private manager: MemoryManager, private extractor = new MemoryExtractor()) {}

  async writeCandidates(input: ExtractMemoryInput) {
    const candidates = this.extractor.extractCandidates(input);
    const written: MemoryRecord[] = [];
    for (const candidate of candidates) {
      written.push(await this.manager.createMemory(candidate, `extractor:${candidate.metadata?.extractor || 'unknown'}`));
    }
    return written;
  }
}

export class LearningMemoryService {
  constructor(private supabase: SupabaseLike, private userId: string) {}

  async upsertProfile(input: LearningProfileInput) {
    const payload = {
      user_id: this.userId,
      subject: sanitizeText(input.subject, 120),
      concept: sanitizeText(input.concept, 160),
      problem_type: sanitizeText(input.problemType || '', 160),
      mastery_score: clamp01(input.masteryScore, 0.5),
      error_patterns: sanitizeJson(input.errorPatterns || []),
      strengths: sanitizeJson(input.strengths || []),
      next_practice: sanitizeJson(input.nextPractice || []),
      metadata: sanitizeJson(input.metadata || {}),
      last_practiced_at: input.lastPracticedAt || new Date().toISOString(),
      review_due_at: input.reviewDueAt || null,
    };
    const { data, error } = await this.supabase
      .from('user_learning_profiles')
      .upsert(payload, { onConflict: 'user_id,subject,concept,problem_type' })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async listProfiles(limit = 50) {
    const { data, error } = await this.supabase
      .from('user_learning_profiles')
      .select('*')
      .eq('user_id', this.userId)
      .order('updated_at', { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 100));
    if (error) throw error;
    return data || [];
  }
}

export class ProjectMemoryService {
  constructor(private supabase: SupabaseLike, private userId: string) {}

  async upsertProject(input: ProjectMemoryInput) {
    const payload = {
      user_id: this.userId,
      project_name: sanitizeText(input.projectName, 160),
      project_type: sanitizeText(input.projectType || 'general', 80),
      current_state: sanitizeJson(input.currentState || {}),
      key_decisions: sanitizeJson(input.keyDecisions || []),
      open_questions: sanitizeJson(input.openQuestions || []),
      todos: sanitizeJson(input.todos || []),
      artifacts: sanitizeJson(input.artifacts || []),
      metadata: sanitizeJson(input.metadata || {}),
    };
    const { data, error } = await this.supabase
      .from('project_memories')
      .upsert(payload, { onConflict: 'user_id,project_name' })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async listProjects(limit = 30) {
    const { data, error } = await this.supabase
      .from('project_memories')
      .select('*')
      .eq('user_id', this.userId)
      .order('updated_at', { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 100));
    if (error) throw error;
    return data || [];
  }
}

function inferLayer(content: string): MemoryLayer {
  if (/题|知识点|错|掌握|复习|练习|课程/.test(content)) return 'L3';
  if (/研究|论文|实验|指标|benchmark|Hyper|RAG|图谱|项目/.test(content)) return 'L4';
  if (/流程|步骤|怎么做|方法论|规范/.test(content)) return 'L5';
  if (/正在|当前|下一步|待办|todo/i.test(content)) return 'L1';
  return 'L2';
}

function inferMemoryType(content: string) {
  if (/喜欢|希望|默认|风格|偏好/.test(content)) return 'preference';
  if (/错|掌握|复习|题型|知识点/.test(content)) return 'learning';
  if (/项目|研究|论文|实验|指标|benchmark/i.test(content)) return 'project';
  if (/流程|步骤|规范|怎么做/.test(content)) return 'process';
  return 'fact';
}

function inferTags(content: string) {
  const tags = new Set<string>();
  if (/Hyper|RAG|图谱|论文|研究|实验|benchmark/i.test(content)) tags.add('research');
  if (/题|知识点|复习|掌握|课程/.test(content)) tags.add('learning');
  if (/偏好|喜欢|希望|默认|风格/.test(content)) tags.add('preference');
  if (/服务器|部署|Docker|Linux|pm2|nginx/i.test(content)) tags.add('ops');
  return Array.from(tags);
}

