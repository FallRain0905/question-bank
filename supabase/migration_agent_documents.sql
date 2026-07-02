-- Agent-created private documents
CREATE TABLE IF NOT EXISTS agent_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Untitled document',
  content_md TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'agent',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_documents_user_updated
  ON agent_documents(user_id, updated_at DESC);

ALTER TABLE agent_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own agent documents" ON agent_documents
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own agent documents" ON agent_documents
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own agent documents" ON agent_documents
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own agent documents" ON agent_documents
  FOR DELETE USING (auth.uid() = user_id);
