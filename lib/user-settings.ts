import { createClient } from '@supabase/supabase-js';

const DEFAULT_ENDPOINT = 'https://api.deepseek.com/v1/chat/completions';
const DEFAULT_MODEL = 'deepseek-v4-flash';

const PROVIDER_ENDPOINTS: Record<string, string> = {
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  kimi: 'https://api.moonshot.cn/v1/chat/completions',
  deepseek: DEFAULT_ENDPOINT,
};

const PROVIDER_MODELS: Record<string, string> = {
  qwen: 'qwen-plus',
  kimi: 'moonshot-v1-8k',
  deepseek: DEFAULT_MODEL,
};

function getSystemLLMKey(provider: string) {
  switch (provider) {
    case 'qwen':
      return process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY || '';
    case 'kimi':
      return process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY || '';
    case 'custom':
      return process.env.OPENAI_API_KEY || '';
    case 'deepseek':
    default:
      return process.env.DEEPSEEK_API_KEY || '';
  }
}

function getSystemLLMConfig(provider = 'deepseek') {
  const normalizedProvider = provider || 'deepseek';
  return {
    apiKey: getSystemLLMKey(normalizedProvider),
    endpoint: PROVIDER_ENDPOINTS[normalizedProvider] || DEFAULT_ENDPOINT,
    provider: normalizedProvider,
    defaultModel: PROVIDER_MODELS[normalizedProvider] || DEFAULT_MODEL,
  };
}

export async function getUserLLMConfig(token: string) {
  console.log('Getting LLM config, has token:', !!token);

  if (!token) {
    const config = getSystemLLMConfig();
    console.log('Using system config (no token):', { hasKey: !!config.apiKey, endpoint: config.endpoint, provider: config.provider });
    return config;
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      const config = getSystemLLMConfig();
      console.log('Using system config (no user):', { hasKey: !!config.apiKey, endpoint: config.endpoint, provider: config.provider });
      return config;
    }

    const { data: settings } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    console.log('User settings:', settings ? 'found' : 'not found');

    const provider = settings.llm_provider || 'deepseek';

    const config = {
      apiKey: settings.llm_api_key || getSystemLLMKey(provider),
      endpoint: settings.llm_api_url || PROVIDER_ENDPOINTS[provider] || DEFAULT_ENDPOINT,
      provider,
      defaultModel: settings.llm_model || PROVIDER_MODELS[provider] || DEFAULT_MODEL,
    };

    console.log('Using user config:', { provider, endpoint: config.endpoint, hasKey: !!config.apiKey });
    return config;
  } catch (error) {
    console.error('Error getting LLM config:', error);
    return getSystemLLMConfig();
  }
}

export async function getUserMineruConfig(token: string) {
  const envToken = process.env.MINERU_API_TOKEN || '';

  console.log('getUserMineruConfig called, has token:', !!token);

  if (!token) {
    console.log('No token provided, using environment config');
    return { token: envToken };
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) {
      console.error('Error getting user:', userError);
      return { token: envToken };
    }
    if (!user) {
      console.log('No user found, using environment config');
      return { token: envToken };
    }

    console.log('User found:', user.id);

    const { data: settings, error: settingsError } = await supabase
      .from('user_settings')
      .select('mineru_api_key')
      .eq('user_id', user.id)
      .maybeSingle();

    if (settingsError) {
      console.error('Error getting user settings:', settingsError);
      return { token: envToken };
    }

    console.log('User settings found:', !!settings);

    // 如果用户有设置记录，使用用户的配置（即使是空字符串）
    if (settings !== null) {
      console.log('Using user MinerU config:', {
        hasKey: 'mineru_api_key' in settings,
        isNull: settings.mineru_api_key === null,
        isEmpty: settings.mineru_api_key === '',
        length: settings.mineru_api_key?.length || 0
      });
      return { token: settings.mineru_api_key || '' };
    }

    console.log('No user settings found, using environment config:', !!envToken);
    return { token: envToken };
  } catch (error) {
    console.error('Error getting MinerU config:', error);
    return { token: envToken };
  }
}

// Default embedding config. API keys must come from user settings or environment variables.
const DEFAULT_EMBEDDING_URL = 'https://api.siliconflow.cn/v1/embeddings';
const DEFAULT_EMBEDDING_MODEL = 'Qwen/Qwen3-Embedding-4B';
const DEFAULT_EMBEDDING_DIMENSIONS = 2560;

function getSystemEmbeddingKey() {
  return process.env.EMBEDDING_API_KEY || process.env.SILICONFLOW_API_KEY || '';
}

export async function getUserEmbeddingConfig(token: string) {
  if (!token) return null;

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: settings } = await supabase
      .from('user_settings')
      .select('embedding_api_key, embedding_api_url, embedding_model, embedding_dimensions, hyperrag_service_url')
      .eq('user_id', user.id)
      .maybeSingle();

    // Use user config if available, otherwise fallback to environment defaults.
    const apiKey = settings?.embedding_api_key || getSystemEmbeddingKey();
    const model = settings?.embedding_model || DEFAULT_EMBEDDING_MODEL;

    return {
      apiKey,
      apiUrl: settings?.embedding_api_url || DEFAULT_EMBEDDING_URL,
      model,
      dimensions: settings?.embedding_dimensions || DEFAULT_EMBEDDING_DIMENSIONS,
      hyperragServiceUrl: settings?.hyperrag_service_url || process.env.HYPERRAG_SERVICE_URL || 'http://localhost:8001',
    };
  } catch (error) {
    console.error('Error getting embedding config:', error);
    return null;
  }
}

export function getHyperRagServiceUrl(settings?: { hyperrag_service_url?: string } | null): string {
  return settings?.hyperrag_service_url || process.env.HYPERRAG_SERVICE_URL || 'http://localhost:8001';
}

export async function getUserResearchToolConfig(token: string) {
  const envSemanticScholarKey = process.env.SEMANTIC_SCHOLAR_API_KEY || '';
  const envTavilyKey = process.env.TAVILY_API_KEY || '';
  const envGithubToken = process.env.GITHUB_TOKEN || '';

  if (!token) {
    return {
      semanticScholarApiKey: envSemanticScholarKey,
      tavilyApiKey: envTavilyKey,
      githubToken: envGithubToken,
    };
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return {
        semanticScholarApiKey: envSemanticScholarKey,
        tavilyApiKey: envTavilyKey,
        githubToken: envGithubToken,
      };
    }

    const { data: settings } = await supabase
      .from('user_settings')
      .select('semantic_scholar_api_key')
      .eq('user_id', user.id)
      .maybeSingle();

    return {
      semanticScholarApiKey: settings?.semantic_scholar_api_key || envSemanticScholarKey,
      tavilyApiKey: envTavilyKey,
      githubToken: envGithubToken,
    };
  } catch (error) {
    console.error('Error getting research tool config:', error);
    return {
      semanticScholarApiKey: envSemanticScholarKey,
      tavilyApiKey: envTavilyKey,
      githubToken: envGithubToken,
    };
  }
}
