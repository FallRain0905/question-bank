-- Synapse unified artifact registry.
-- Apply after migration_synapse_agent.sql, migration_agent_documents.sql, and migration_agent_runs.sql.

CREATE TABLE IF NOT EXISTS agent_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES agent_conversations(id) ON DELETE SET NULL,
  run_id UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
  step_id TEXT,
  parent_artifact_id UUID REFERENCES agent_artifacts(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'file',
    'document',
    'archive',
    'extracted_dir',
    'markdown',
    'image',
    'command_output',
    'web_page',
    'report',
    'dataset',
    'other'
  )),
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN (
    'pending',
    'processing',
    'ready',
    'failed',
    'deleted'
  )),
  name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  uri TEXT,
  storage_path TEXT,
  workspace_ref JSONB NOT NULL DEFAULT '{}',
  source_tool TEXT,
  source_table TEXT,
  source_id UUID,
  content_preview TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_artifacts_source_kind
  ON agent_artifacts(user_id, source_table, source_id, kind);

CREATE INDEX IF NOT EXISTS idx_agent_artifacts_user_created
  ON agent_artifacts(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_artifacts_conversation_created
  ON agent_artifacts(conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_artifacts_run_created
  ON agent_artifacts(run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_artifacts_parent
  ON agent_artifacts(parent_artifact_id);

CREATE INDEX IF NOT EXISTS idx_agent_artifacts_kind_status
  ON agent_artifacts(kind, status);

CREATE OR REPLACE FUNCTION set_agent_artifacts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agent_artifacts_updated_at ON agent_artifacts;
CREATE TRIGGER trg_agent_artifacts_updated_at
  BEFORE UPDATE ON agent_artifacts
  FOR EACH ROW
  EXECUTE FUNCTION set_agent_artifacts_updated_at();

ALTER TABLE agent_artifacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own agent artifacts" ON agent_artifacts;
CREATE POLICY "Users can read own agent artifacts" ON agent_artifacts
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own agent artifacts" ON agent_artifacts;
CREATE POLICY "Users can create own agent artifacts" ON agent_artifacts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own agent artifacts" ON agent_artifacts;
CREATE POLICY "Users can update own agent artifacts" ON agent_artifacts
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own agent artifacts" ON agent_artifacts;
CREATE POLICY "Users can delete own agent artifacts" ON agent_artifacts
  FOR DELETE USING (auth.uid() = user_id);
