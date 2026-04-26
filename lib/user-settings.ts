import { createClient } from '@supabase/supabase-js';

const DEFAULT_KEY = 'sk-bb3c52688dbc43b3864f8fb07ede67dd';
const DEFAULT_ENDPOINT = 'https://api.deepseek.com/v1/chat/completions';
const DEFAULT_MODEL = 'deepseek-v4-flash';

export async function getUserLLMConfig(token: string) {
  const envKey = process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY || DEFAULT_KEY;

  if (!token) return { apiKey: envKey, endpoint: envKey === DEFAULT_KEY ? DEFAULT_ENDPOINT : 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', provider: 'deepseek', defaultModel: DEFAULT_MODEL };

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { apiKey: envKey, endpoint: envKey === DEFAULT_KEY ? DEFAULT_ENDPOINT : 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', provider: 'deepseek', defaultModel: DEFAULT_MODEL };

    const { data: settings } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!settings?.llm_api_key) {
      return { apiKey: envKey, endpoint: envKey === DEFAULT_KEY ? DEFAULT_ENDPOINT : 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', provider: 'deepseek', defaultModel: DEFAULT_MODEL };
    }

    const provider = settings.llm_provider || 'qwen';
    const endpoints: Record<string, string> = {
      qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      kimi: 'https://api.moonshot.cn/v1/chat/completions',
      deepseek: 'https://api.deepseek.com/v1/chat/completions',
    };

    const defaultModels: Record<string, string> = {
      qwen: 'qwen-plus',
      kimi: 'moonshot-v1-8k',
      deepseek: 'deepseek-v4-flash',
    };

    return {
      apiKey: settings.llm_api_key,
      endpoint: settings.llm_api_url || endpoints[provider] || endpoints.qwen,
      provider,
      defaultModel: settings.llm_model || defaultModels[provider] || DEFAULT_MODEL,
    };
  } catch {
    return { apiKey: envKey, endpoint: envKey === DEFAULT_KEY ? DEFAULT_ENDPOINT : 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', provider: 'deepseek', defaultModel: DEFAULT_MODEL };
  }
}

export async function getUserMineruConfig(token: string) {
  const envToken = process.env.MINERU_API_TOKEN || '';

  if (!token) return { token: envToken };

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { token: envToken };

    const { data: settings } = await supabase
      .from('user_settings')
      .select('mineru_api_key')
      .eq('user_id', user.id)
      .maybeSingle();

    return { token: settings?.mineru_api_key || envToken };
  } catch {
    return { token: envToken };
  }
}
