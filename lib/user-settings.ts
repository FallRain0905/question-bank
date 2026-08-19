import { createClient } from '@supabase/supabase-js';

const DEFAULT_ENDPOINT = 'https://api.siliconflow.cn/v1/chat/completions';
const DEFAULT_MODEL = 'deepseek-ai/DeepSeek-V4-Flash';

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

type SystemSettingsMap = Record<string, string>;

let cachedSystemSettings: { values: SystemSettingsMap; expiresAt: number } | null = null;

async function getSystemSettingsMap(): Promise<SystemSettingsMap> {
  const now = Date.now();
  if (cachedSystemSettings && cachedSystemSettings.expiresAt > now) return cachedSystemSettings.values;

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data, error } = await supabase
      .from('system_settings')
      .select('key,value')
      .in('key', [
        'llm_provider',
        'llm_api_key',
        'llm_api_url',
        'llm_model',
        'mineru_api_key',
        'embedding_api_key',
        'embedding_api_url',
        'embedding_model',
        'embedding_dimensions',
        'hyperrag_service_url',
        'semantic_scholar_api_key',
        'tavily_api_key',
        'github_token',
      ]);

    if (error) throw error;
    const values = Object.fromEntries((data || []).map((item: any) => [item.key, item.value || '']));
    cachedSystemSettings = { values, expiresAt: now + 30_000 };
    return values;
  } catch (error) {
    console.warn('Unable to load system settings, falling back to env:', error);
    cachedSystemSettings = { values: {}, expiresAt: now + 10_000 };
    return {};
  }
}

function getSystemLLMKey(provider: string, settings: SystemSettingsMap = {}) {
  if (settings.llm_api_key) return settings.llm_api_key;
  switch (provider) {
    case 'qwen':
      return process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY || '';
    case 'kimi':
      return process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY || '';
    case 'custom':
      return process.env.OPENAI_API_KEY || '';
    case 'deepseek':
    default:
      // The deepseek provider is hosted on SiliconFlow (DEFAULT_ENDPOINT), so a
      // SiliconFlow key is a valid fallback when DEEPSEEK_API_KEY is not set.
      return process.env.DEEPSEEK_API_KEY || process.env.SILICONFLOW_API_KEY || '';
  }
}

async function getSystemLLMConfig(provider = 'deepseek') {
  const settings = await getSystemSettingsMap();
  const normalizedProvider = provider || settings.llm_provider || 'deepseek';
  return {
    apiKey: getSystemLLMKey(normalizedProvider, settings),
    endpoint: settings.llm_api_url || PROVIDER_ENDPOINTS[normalizedProvider] || DEFAULT_ENDPOINT,
    provider: normalizedProvider,
    defaultModel: settings.llm_model || PROVIDER_MODELS[normalizedProvider] || DEFAULT_MODEL,
  };
}

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

function buildLLMConfigFromSettings(settings: any, systemSettings: SystemSettingsMap) {
  const provider = settings?.llm_provider || systemSettings.llm_provider || 'deepseek';
  return {
    apiKey: settings?.llm_api_key || getSystemLLMKey(provider, systemSettings),
    endpoint: settings?.llm_api_url || systemSettings.llm_api_url || PROVIDER_ENDPOINTS[provider] || DEFAULT_ENDPOINT,
    provider,
    defaultModel: settings?.llm_model || systemSettings.llm_model || PROVIDER_MODELS[provider] || DEFAULT_MODEL,
  };
}

export async function getUserLLMConfigByUserId(userId: string) {
  if (!userId) return getSystemLLMConfig();
  try {
    const systemSettings = await getSystemSettingsMap();
    const { data: settings, error } = await serviceClient()
      .from('user_settings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return buildLLMConfigFromSettings(settings, systemSettings);
  } catch (error) {
    console.error('Error getting LLM config by user id:', error);
    return getSystemLLMConfig();
  }
}

export async function getUserLLMConfig(token: string) {
  console.log('Getting LLM config, has token:', !!token);

  if (!token) {
    const config = await getSystemLLMConfig();
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
      const config = await getSystemLLMConfig();
      console.log('Using system config (no user):', { hasKey: !!config.apiKey, endpoint: config.endpoint, provider: config.provider });
      return config;
    }

    const { data: settings } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    console.log('User settings:', settings ? 'found' : 'not found');

    const systemSettings = await getSystemSettingsMap();
    const config = buildLLMConfigFromSettings(settings, systemSettings);

    console.log('Using user config:', { provider: config.provider, endpoint: config.endpoint, hasKey: !!config.apiKey });
    return config;
  } catch (error) {
    console.error('Error getting LLM config:', error);
    return getSystemLLMConfig();
  }
}

export async function getUserMineruConfig(token: string) {
  const systemSettings = await getSystemSettingsMap();
  const envToken = systemSettings.mineru_api_key || process.env.MINERU_API_TOKEN || '';

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

    // User setting wins when provided; otherwise fall back to admin/env defaults.
    if (settings?.mineru_api_key) {
      console.log('Using user MinerU config:', {
        hasKey: 'mineru_api_key' in settings,
        isNull: settings.mineru_api_key === null,
        isEmpty: settings.mineru_api_key === '',
        length: settings.mineru_api_key?.length || 0
      });
      return { token: settings.mineru_api_key || '' };
    }

    console.log('No user MinerU setting found, using system/environment config:', !!envToken);
    return { token: envToken };
  } catch (error) {
    console.error('Error getting MinerU config:', error);
    return { token: envToken };
  }
}

export async function getUserMineruConfigByUserId(userId: string) {
  const systemSettings = await getSystemSettingsMap();
  const envToken = systemSettings.mineru_api_key || process.env.MINERU_API_TOKEN || '';
  if (!userId) return { token: envToken };

  try {
    const { data: settings, error } = await serviceClient()
      .from('user_settings')
      .select('mineru_api_key')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return { token: settings?.mineru_api_key || envToken };
  } catch (error) {
    console.error('Error getting MinerU config by user id:', error);
    return { token: envToken };
  }
}

// Default embedding config. API keys must come from user settings or environment variables.
const DEFAULT_EMBEDDING_URL = 'https://api.siliconflow.cn/v1/embeddings';
const DEFAULT_EMBEDDING_MODEL = 'Qwen/Qwen3-Embedding-4B';
const DEFAULT_EMBEDDING_DIMENSIONS = 2560;

function getSystemEmbeddingKey(settings: SystemSettingsMap = {}) {
  return settings.embedding_api_key || process.env.EMBEDDING_API_KEY || process.env.SILICONFLOW_API_KEY || '';
}

export async function getUserEmbeddingConfig(token: string) {
  const systemSettings = await getSystemSettingsMap();
  const systemEmbeddingConfig = {
    apiKey: getSystemEmbeddingKey(systemSettings),
    apiUrl: systemSettings.embedding_api_url || DEFAULT_EMBEDDING_URL,
    model: systemSettings.embedding_model || DEFAULT_EMBEDDING_MODEL,
    dimensions: Number(systemSettings.embedding_dimensions || DEFAULT_EMBEDDING_DIMENSIONS),
    hyperragServiceUrl: systemSettings.hyperrag_service_url || process.env.HYPERRAG_SERVICE_URL || 'http://localhost:8001',
  };

  if (!token) return systemEmbeddingConfig;

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return systemEmbeddingConfig;

    const { data: settings } = await supabase
      .from('user_settings')
      .select('embedding_api_key, embedding_api_url, embedding_model, embedding_dimensions, hyperrag_service_url')
      .eq('user_id', user.id)
      .maybeSingle();

    // Use user config if available, otherwise fallback to environment defaults.
    const apiKey = settings?.embedding_api_key || systemEmbeddingConfig.apiKey;
    const model = settings?.embedding_model || DEFAULT_EMBEDDING_MODEL;

    return {
      apiKey,
      apiUrl: settings?.embedding_api_url || systemEmbeddingConfig.apiUrl,
      model: settings?.embedding_model || systemEmbeddingConfig.model || model,
      dimensions: settings?.embedding_dimensions || systemEmbeddingConfig.dimensions || DEFAULT_EMBEDDING_DIMENSIONS,
      hyperragServiceUrl: settings?.hyperrag_service_url || systemEmbeddingConfig.hyperragServiceUrl,
    };
  } catch (error) {
    console.error('Error getting embedding config:', error);
    return systemEmbeddingConfig;
  }
}

export function getHyperRagServiceUrl(settings?: { hyperrag_service_url?: string } | null): string {
  return settings?.hyperrag_service_url || process.env.HYPERRAG_SERVICE_URL || 'http://localhost:8001';
}

export async function getUserResearchToolConfig(token: string) {
  const systemSettings = await getSystemSettingsMap();
  const envSemanticScholarKey = systemSettings.semantic_scholar_api_key || process.env.SEMANTIC_SCHOLAR_API_KEY || '';
  const envTavilyKey = systemSettings.tavily_api_key || process.env.TAVILY_API_KEY || '';
  const envGithubToken = systemSettings.github_token || process.env.GITHUB_TOKEN || '';

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

export async function getUserResearchToolConfigByUserId(userId: string) {
  const systemSettings = await getSystemSettingsMap();
  const envSemanticScholarKey = systemSettings.semantic_scholar_api_key || process.env.SEMANTIC_SCHOLAR_API_KEY || '';
  const envTavilyKey = systemSettings.tavily_api_key || process.env.TAVILY_API_KEY || '';
  const envGithubToken = systemSettings.github_token || process.env.GITHUB_TOKEN || '';

  if (!userId) {
    return {
      semanticScholarApiKey: envSemanticScholarKey,
      tavilyApiKey: envTavilyKey,
      githubToken: envGithubToken,
    };
  }

  try {
    const { data: settings, error } = await serviceClient()
      .from('user_settings')
      .select('semantic_scholar_api_key')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return {
      semanticScholarApiKey: settings?.semantic_scholar_api_key || envSemanticScholarKey,
      tavilyApiKey: envTavilyKey,
      githubToken: envGithubToken,
    };
  } catch (error) {
    console.error('Error getting research tool config by user id:', error);
    return {
      semanticScholarApiKey: envSemanticScholarKey,
      tavilyApiKey: envTavilyKey,
      githubToken: envGithubToken,
    };
  }
}
