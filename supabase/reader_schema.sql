-- AI 阅读器相关表
-- 在 Supabase Dashboard SQL Editor 中执行

-- 文档高亮表
CREATE TABLE IF NOT EXISTS document_highlights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  selected_text TEXT NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  color TEXT DEFAULT 'yellow',
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 文档批注表
CREATE TABLE IF NOT EXISTS document_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  highlight_id UUID REFERENCES document_highlights(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  selected_text TEXT NOT NULL,
  ai_response TEXT NOT NULL,
  saved_as_note_id UUID REFERENCES notes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_highlights_doc_user ON document_highlights(document_id, user_id);
CREATE INDEX IF NOT EXISTS idx_annotations_doc_user ON document_annotations(document_id, user_id);

-- RLS 策略
ALTER TABLE document_highlights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own highlights" ON document_highlights
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE document_annotations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own annotations" ON document_annotations
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
