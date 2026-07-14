import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUPER_ADMIN_EMAIL = '3283254551@qq.com';
const FLASH_MODEL = 'deepseek-ai/DeepSeek-V4-Flash';

const SETTING_DEFINITIONS = [
  { key: 'llm_provider', category: 'ai_runtime', description: '默认对话模型供应商', is_encrypted: false, defaultValue: 'deepseek' },
  { key: 'llm_api_url', category: 'ai_runtime', description: '默认对话模型 API 地址', is_encrypted: false, defaultValue: 'https://api.siliconflow.cn/v1/chat/completions' },
  { key: 'llm_api_key', category: 'ai_runtime', description: '默认对话模型 API Key', is_encrypted: true, defaultValue: '' },
  { key: 'llm_model', category: 'ai_runtime', description: '默认对话模型名称', is_encrypted: false, defaultValue: FLASH_MODEL },
  { key: 'embedding_api_url', category: 'ai_runtime', description: '默认嵌入模型 API 地址', is_encrypted: false, defaultValue: 'https://api.siliconflow.cn/v1/embeddings' },
  { key: 'embedding_api_key', category: 'ai_runtime', description: '默认嵌入模型 API Key', is_encrypted: true, defaultValue: '' },
  { key: 'embedding_model', category: 'ai_runtime', description: '默认嵌入模型名称', is_encrypted: false, defaultValue: 'Qwen/Qwen3-Embedding-4B' },
  { key: 'embedding_dimensions', category: 'ai_runtime', description: '默认嵌入向量维度', is_encrypted: false, defaultValue: '2560' },
  { key: 'hyperrag_service_url', category: 'ai_runtime', description: 'HyperRAG 服务地址', is_encrypted: false, defaultValue: 'http://localhost:8001' },
  { key: 'mineru_api_key', category: 'ai_tools', description: 'MinerU API Token', is_encrypted: true, defaultValue: '' },
  { key: 'semantic_scholar_api_key', category: 'ai_tools', description: 'Semantic Scholar API Key', is_encrypted: true, defaultValue: '' },
  { key: 'tavily_api_key', category: 'ai_tools', description: 'Tavily API Key', is_encrypted: true, defaultValue: '' },
  { key: 'github_token', category: 'ai_tools', description: 'GitHub Token', is_encrypted: true, defaultValue: '' },
  { key: 'nextcloud_url', category: 'nextcloud', description: 'Nextcloud 服务器 URL', is_encrypted: false, defaultValue: '' },
  { key: 'nextcloud_user', category: 'nextcloud', description: 'Nextcloud 用户名', is_encrypted: false, defaultValue: '' },
  { key: 'nextcloud_password', category: 'nextcloud', description: 'Nextcloud 密码', is_encrypted: true, defaultValue: '' },
  { key: 'nextcloud_public_url', category: 'nextcloud', description: 'Nextcloud 公共访问 URL', is_encrypted: false, defaultValue: '' },
] as const;

type SettingKey = typeof SETTING_DEFINITIONS[number]['key'];

function clientForToken(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

function adminClient(token: string) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return clientForToken(token);
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

async function requireAdmin(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  if (!token) return { error: NextResponse.json({ error: '请先登录' }, { status: 401 }) };
  const supabase = clientForToken(token);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: '请先登录' }, { status: 401 }) };

  const isAdmin = user.user_metadata?.is_admin === true || user.email === SUPER_ADMIN_EMAIL;
  if (!isAdmin) return { error: NextResponse.json({ error: '没有管理员权限' }, { status: 403 }) };
  return { user, token };
}

function sanitizeValue(key: SettingKey, value: unknown) {
  const text = String(value ?? '').trim();
  if (key === 'llm_model') return FLASH_MODEL;
  if (key === 'llm_provider') return text || 'deepseek';
  if (key === 'embedding_dimensions') {
    const parsed = Number(text);
    return Number.isFinite(parsed) && parsed > 0 ? String(Math.floor(parsed)) : '2560';
  }
  return text;
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const supabase = adminClient(auth.token);
  const { data, error } = await supabase
    .from('system_settings')
    .select('key,value,category,description,is_encrypted,updated_at')
    .in('key', SETTING_DEFINITIONS.map(item => item.key));

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const map = new Map((data || []).map((item: any) => [item.key, item]));
  const settings = Object.fromEntries(
    SETTING_DEFINITIONS.map(item => [item.key, map.get(item.key)?.value ?? item.defaultValue])
  );

  return NextResponse.json({ settings, definitions: SETTING_DEFINITIONS });
}

export async function PUT(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => ({}));
  const settings = body.settings && typeof body.settings === 'object' ? body.settings : body;
  const now = new Date().toISOString();
  const rows = SETTING_DEFINITIONS.map(definition => ({
    key: definition.key,
    value: sanitizeValue(definition.key, settings[definition.key]),
    category: definition.category,
    description: definition.description,
    is_encrypted: definition.is_encrypted,
    updated_at: now,
    updated_by: auth.user.id,
  }));

  const supabase = adminClient(auth.token);
  const { error } = await supabase
    .from('system_settings')
    .upsert(rows, { onConflict: 'key' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    settings: Object.fromEntries(rows.map(row => [row.key, row.value])),
  });
}
