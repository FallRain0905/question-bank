-- System-level API defaults for admin settings.
INSERT INTO public.system_settings (key, value, category, description, is_encrypted)
VALUES
  ('llm_provider', 'deepseek', 'ai_runtime', '默认对话模型供应商', FALSE),
  ('llm_api_url', 'https://api.siliconflow.cn/v1/chat/completions', 'ai_runtime', '默认对话模型 API 地址', FALSE),
  ('llm_api_key', '', 'ai_runtime', '默认对话模型 API Key', TRUE),
  ('llm_model', 'deepseek-ai/DeepSeek-V4-Flash', 'ai_runtime', '默认对话模型名称', FALSE),
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

DO $$
BEGIN
  CREATE POLICY "Users can update own agent files"
    ON public.agent_files
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
