import { createClient } from '@supabase/supabase-js';

// DeepSeek 官方 API 配置
const DEFAULT_KEY = 'sk-bb3c52688dbc43b3864f8fb07ede67dd';
const DEFAULT_ENDPOINT = 'https://api.deepseek.com/v1/chat/completions';
const DEFAULT_MODEL = 'deepseek-v4-flash';

export async function getUserLLMConfig(token: string) {
  console.log('Getting LLM config, has token:', !!token);

  // 优先使用 DeepSeek API Key（硬编码）
  const deepseekKey = process.env.DEEPSEEK_API_KEY || DEFAULT_KEY;

  if (!token) {
    console.log('Using default config (no token):', { hasKey: !!deepseekKey, endpoint: DEFAULT_ENDPOINT, provider: 'deepseek' });
    return { apiKey: deepseekKey, endpoint: DEFAULT_ENDPOINT, provider: 'deepseek', defaultModel: DEFAULT_MODEL };
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.log('Using default config (no user):', { hasKey: !!deepseekKey, endpoint: DEFAULT_ENDPOINT, provider: 'deepseek' });
      return { apiKey: deepseekKey, endpoint: DEFAULT_ENDPOINT, provider: 'deepseek', defaultModel: DEFAULT_MODEL };
    }

    const { data: settings } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    console.log('User settings:', settings ? 'found' : 'not found');

    if (!settings?.llm_api_key) {
      console.log('Using default config (no user settings):', { hasKey: !!deepseekKey, endpoint: DEFAULT_ENDPOINT, provider: 'deepseek' });
      return { apiKey: deepseekKey, endpoint: DEFAULT_ENDPOINT, provider: 'deepseek', defaultModel: DEFAULT_MODEL };
    }

    const provider = settings.llm_provider || 'deepseek';
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

    const config = {
      apiKey: settings.llm_api_key,
      endpoint: settings.llm_api_url || endpoints[provider] || endpoints.deepseek,
      provider,
      defaultModel: settings.llm_model || defaultModels[provider] || DEFAULT_MODEL,
    };

    console.log('Using user config:', { provider, endpoint: config.endpoint, hasKey: !!config.apiKey });
    return config;
  } catch (error) {
    console.error('Error getting LLM config:', error);
    return { apiKey: deepseekKey, endpoint: DEFAULT_ENDPOINT, provider: 'deepseek', defaultModel: DEFAULT_MODEL };
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

    console.log('MinerU user settings:', settings ? { hasKey: !!settings.mineru_api_key } : 'not found');

    // 优先使用用户配置（即使为空字符串），只有在用户没有设置记录时才使用环境变量
    if (settings && 'mineru_api_key' in settings) {
      console.log('Using user MinerU config:', !!settings.mineru_api_key);
      return { token: settings.mineru_api_key };
    }

    console.log('Using environment MinerU config:', !!envToken);
    return { token: envToken };
  } catch (error) {
    console.error('Error getting MinerU config:', error);
    return { token: envToken };
  }
}
