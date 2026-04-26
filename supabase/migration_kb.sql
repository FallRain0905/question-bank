-- =============================================
-- 知识库 + 出题机 数据库迁移
-- 可重复执行（幂等）
-- =============================================

-- 1. 知识库表
CREATE TABLE IF NOT EXISTS knowledge_bases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE knowledge_bases ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "kb_select_own" ON knowledge_bases FOR SELECT USING (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "kb_insert_own" ON knowledge_bases FOR INSERT WITH CHECK (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "kb_update_own" ON knowledge_bases FOR UPDATE USING (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "kb_delete_own" ON knowledge_bases FOR DELETE USING (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. 知识库文档表
CREATE TABLE IF NOT EXISTS kb_documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  kb_id UUID REFERENCES knowledge_bases(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  content_md TEXT DEFAULT '',
  file_url TEXT,
  file_name TEXT,
  file_type TEXT DEFAULT 'md',
  file_size INTEGER DEFAULT 0,
  status TEXT DEFAULT 'ready',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE kb_documents ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "kbdoc_select_own" ON kb_documents FOR SELECT USING (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "kbdoc_insert_own" ON kb_documents FOR INSERT WITH CHECK (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "kbdoc_update_own" ON kb_documents FOR UPDATE USING (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "kbdoc_delete_own" ON kb_documents FOR DELETE USING (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. 生成题目表
CREATE TABLE IF NOT EXISTS generated_questions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  source_doc_id UUID REFERENCES kb_documents(id) ON DELETE SET NULL,
  source_text TEXT NOT NULL DEFAULT '',
  question_type TEXT DEFAULT 'choice',
  question_data JSONB NOT NULL DEFAULT '{}',
  synced_to_bank BOOLEAN DEFAULT false,
  synced_question_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE generated_questions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "genq_select_own" ON generated_questions FOR SELECT USING (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "genq_insert_own" ON generated_questions FOR INSERT WITH CHECK (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "genq_update_own" ON generated_questions FOR UPDATE USING (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "genq_delete_own" ON generated_questions FOR DELETE USING (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
