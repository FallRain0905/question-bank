import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserLLMConfig, getUserResearchToolConfig } from '@/lib/user-settings';
import { runResearchRetrieval } from '@/lib/research-retrieval';
import { researchDbErrorResponse } from '@/lib/research-api-errors';
import { sanitizeForJsonb } from '@/lib/json-sanitize';
import {
  buildResearchScope,
  getDirectionCards,
  CLARIFICATION_QUESTIONS,
} from '@/lib/research-workflow';
import type { ResearchDirectionCard } from '@/types';

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

function parseJsonObject(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

async function callLLM(llmConfig: any, prompt: string, maxTokens = 900) {
  if (!llmConfig?.apiKey || !llmConfig?.endpoint || !llmConfig?.defaultModel) throw new Error('LLM config missing');
  const res = await fetch(llmConfig.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llmConfig.apiKey}` },
    body: JSON.stringify({
      model: llmConfig.defaultModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) throw new Error(`LLM error ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function getDirectionCardsWithLLM(
  llmConfig: any,
  topic: string,
  quickScanSources: any[]
): Promise<ResearchDirectionCard[]> {
  const fallback = getDirectionCards(topic, quickScanSources.length);
  const sourceTitles = quickScanSources
    .slice(0, 5)
    .map((source, index) => `[${index + 1}] ${source.title || ''} ${source.snippet || ''}`.slice(0, 260))
    .join('\n');
  const directionList = fallback
    .map(card => `${card.id}: ${card.title} - ${card.description}`)
    .join('\n');

  const prompt = `你是科研研究范围分析器。请根据用户原始主题和预检索线索，判断哪些研究方向应该推荐。

只返回 JSON：
{"recommendations":[{"id":"direction id","recommended":true,"description":"一句贴合主题的中文说明"}]}

可选方向：
${directionList}

规则：
- 只能使用上面列出的 id。
- 至少推荐 1 个，最多推荐 3 个。
- 不要因为系统内部使用研究图，就推荐“论文图结构”；只有当用户主题明确包含论文语料、图结构、知识图谱、超图、RAG 时才推荐 paper_graph。
- 对普通领域研究，例如“CCUS 重点是碳捕集”，优先考虑理论基础、领域应用、实验评估，不要改写为“构建知识图谱”。
- description 要解释为什么这个方向适合用户主题。

用户原始主题：${topic}
预检索线索：
${sourceTitles || '无'}`;

  try {
    const content = await callLLM(llmConfig, prompt);
    const parsed = parseJsonObject(content);
    const rows = Array.isArray(parsed?.recommendations) ? parsed.recommendations : [];
    const byId = new Map<string, any>(rows.map((row: any) => [String(row.id), row]));
    const merged = fallback.map(card => {
      const row = byId.get(card.id);
      return {
        ...card,
        recommended: Boolean(row?.recommended),
        description: row?.description ? String(row.description).slice(0, 160) : card.description,
      };
    });
    return merged.some(card => card.recommended) ? merged : fallback;
  } catch {
    return fallback;
  }
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

  const directionCards = await getDirectionCardsWithLLM(llmConfig, topic, quickScanSources);
  const recommendedScope = sanitizeForJsonb(buildResearchScope(topic, {
    focus: directionCards.filter(card => card.recommended).map(card => card.title),
  }));

  const { data, error } = await auth.supabase
    .from('research_sessions')
    .insert({
      user_id: auth.user.id,
      topic: sanitizeForJsonb(topic),
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
