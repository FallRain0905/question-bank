-- ============================================
-- Hyper-RAG 集成 - 数据库迁移
-- ============================================

-- 1. user_settings 新增嵌入模型配置
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS embedding_api_key TEXT DEFAULT '';
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS embedding_api_url TEXT DEFAULT '';
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS embedding_model TEXT DEFAULT '';
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS embedding_dimensions INTEGER DEFAULT 1024;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS hyperrag_service_url TEXT DEFAULT '';

-- 2. kb_documents 新增索引状态
ALTER TABLE kb_documents ADD COLUMN IF NOT EXISTS index_status TEXT DEFAULT 'not_indexed';
ALTER TABLE kb_documents ADD COLUMN IF NOT EXISTS indexed_at TIMESTAMPTZ;
