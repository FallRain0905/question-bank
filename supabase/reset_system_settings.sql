-- 完全重置 system_settings 表和策略
-- 如果遇到权限问题，执行此脚本

-- 1. 删除现有的策略（如果存在）
DROP POLICY IF EXISTS "Only super admins can view settings" ON public.system_settings;
DROP POLICY IF EXISTS "Only super admins can insert settings" ON public.system_settings;
DROP POLICY IF EXISTS "Only super admins can update settings" ON public.system_settings;
DROP POLICY IF EXISTS "Only super admins can delete settings" ON public.system_settings;

-- 2. 删除现有的表（如果存在）
DROP TABLE IF EXISTS public.system_settings CASCADE;

-- 3. 重新创建表
CREATE TABLE public.system_settings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    value TEXT,
    category TEXT NOT NULL,
    description TEXT,
    is_encrypted BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. 创建索引
CREATE INDEX idx_system_settings_key ON public.system_settings(key);
CREATE INDEX idx_system_settings_category ON public.system_settings(category);

-- 5. 启用 RLS
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- 6. 创建简化的 RLS 策略（使用 auth.email() 而不是查询 auth.users）
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

-- 7. 插入默认配置
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

-- 8. 验证结果
SELECT '✅ 系统设置表创建成功' as status;
SELECT '✅ RLS 策略创建完成' as status;
SELECT COUNT(*) as settings_count FROM public.system_settings;
