-- 为 kb_documents 表添加 outline 字段，保存 AI 生成的目录
ALTER TABLE kb_documents ADD COLUMN IF NOT EXISTS outline_md TEXT;
ALTER TABLE kb_documents ADD COLUMN IF NOT EXISTS outline_summary TEXT;
