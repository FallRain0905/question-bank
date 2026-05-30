-- Private reading notes for the research reader workspace
CREATE TABLE IF NOT EXISTS reading_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id UUID REFERENCES kb_documents(id) ON DELETE CASCADE,
  paper_id UUID REFERENCES daily_papers(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT 'Untitled note',
  content TEXT NOT NULL DEFAULT '',
  selected_text TEXT,
  source_url TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reading_notes_user_document
  ON reading_notes(user_id, document_id, updated_at DESC);

ALTER TABLE reading_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own reading notes" ON reading_notes
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own reading notes" ON reading_notes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own reading notes" ON reading_notes
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own reading notes" ON reading_notes
  FOR DELETE USING (auth.uid() = user_id);

