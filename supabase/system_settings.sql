-- 系统设置表
-- 用于存储系统级配置，如 Nextcloud、AI 助手等配置

-- 创建系统设置表
CREATE TABLE IF NOT EXISTS public.system_settings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    key TEXT NOT NULL UNIQUE, -- 配置键，如 'nextcloud_url', 'qwen_api_key'
    value TEXT, -- 配置值（敏感信息应该加密存储）
    category TEXT NOT NULL, -- 配置分类：'nextcloud', 'ai_assistant', 'general'
    description TEXT, -- 配置项描述
    is_encrypted BOOLEAN DEFAULT FALSE, -- 是否加密存储
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- 最后更新者
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_system_settings_key ON public.system_settings(key);
CREATE INDEX IF NOT EXISTS idx_system_settings_category ON public.system_settings(category);

-- 启用行级安全
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- 删除已存在的策略（如果存在）
DROP POLICY IF EXISTS "Only super admins can view settings" ON public.system_settings;
DROP POLICY IF EXISTS "Only super admins can insert settings" ON public.system_settings;
DROP POLICY IF EXISTS "Only super admins can update settings" ON public.system_settings;
DROP POLICY IF EXISTS "Only super admins can delete settings" ON public.system_settings;

-- RLS 策略：只有超级管理员可以读取和修改系统设置
CREATE POLICY "Only super admins can view settings"
    ON public.system_settings FOR SELECT
    USING (auth.email() = '3283254551@qq.com');

CREATE POLICY "Only super admins can insert settings"
    ON public.system_settings FOR INSERT
    WITH CHECK (auth.email() = '3283254551@qq.com');

CREATE POLICY "Only super admins can update settings"
    ON public.system_settings FOR UPDATE
    USING (auth.email() = '3283254551@qq.com')
    WITH CHECK (auth.email() = '3283254551@qq.com');

CREATE POLICY "Only super admins can delete settings"
    ON public.system_settings FOR DELETE
    USING (auth.email() = '3283254551@qq.com');

-- 插入默认配置（占位符）
INSERT INTO public.system_settings (key, value, category, description, is_encrypted)
VALUES
    ('nextcloud_url', '', 'nextcloud', 'Nextcloud 服务器 URL', FALSE),
    ('nextcloud_user', '', 'nextcloud', 'Nextcloud 用户名', FALSE),
    ('nextcloud_password', '', 'nextcloud', 'Nextcloud 密码', TRUE),
    ('nextcloud_public_url', '', 'nextcloud', 'Nextcloud 公共访问 URL', FALSE),
    ('qwen_api_key', '', 'ai_assistant', '千问 AI API 密钥', TRUE),
    ('qwen_model', 'qwen-turbo', 'ai_assistant', 'AI 模型名称', FALSE),
    ('llm_provider', 'deepseek', 'ai_runtime', '默认对话模型供应商', FALSE),
    ('llm_api_url', 'https://api.deepseek.com/v1/chat/completions', 'ai_runtime', '默认对话模型 API 地址', FALSE),
    ('llm_api_key', '', 'ai_runtime', '默认对话模型 API Key', TRUE),
    ('llm_model', 'deepseek-v4-flash', 'ai_runtime', '默认对话模型名称', FALSE),
    ('embedding_api_url', 'https://api.siliconflow.cn/v1/embeddings', 'ai_runtime', '默认嵌入模型 API 地址', FALSE),
    ('embedding_api_key', '', 'ai_runtime', '默认嵌入模型 API Key', TRUE),
    ('embedding_model', 'Qwen/Qwen3-Embedding-4B', 'ai_runtime', '默认嵌入模型名称', FALSE),
    ('embedding_dimensions', '2560', 'ai_runtime', '默认嵌入向量维度', FALSE),
    ('hyperrag_service_url', 'http://localhost:8001', 'ai_runtime', 'HyperRAG 服务地址', FALSE),
    ('mineru_api_key', '', 'ai_tools', 'MinerU API Token', TRUE),
    ('semantic_scholar_api_key', '', 'ai_tools', 'Semantic Scholar API Key', TRUE),
    ('tavily_api_key', '', 'ai_tools', 'Tavily API Key', TRUE),
    ('github_token', '', 'ai_tools', 'GitHub Token', TRUE)
ON CONFLICT (key) DO NOTHING;

-- 创建获取系统设置的函数
CREATE OR REPLACE FUNCTION public.get_system_setting(setting_key TEXT)
RETURNS TEXT AS $$
BEGIN
    RETURN (
        SELECT value FROM public.system_settings
        WHERE key = setting_key
        LIMIT 1
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 创建获取系统设置的函数（JSON 格式）
CREATE OR REPLACE FUNCTION public.get_system_settings(category TEXT DEFAULT NULL)
RETURNS JSONB AS $$
BEGIN
    RETURN (
        SELECT jsonb_object_agg(key, value)
        FROM public.system_settings
        WHERE (category = $1 OR $1 IS NULL)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
