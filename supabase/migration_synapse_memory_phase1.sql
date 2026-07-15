-- Synapse Memory Phase 1: structured, inspectable, text-retrievable memory.
-- Run after supabase/migration_synapse_agent.sql.

CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  memory_type TEXT NOT NULL DEFAULT 'fact',
  layer TEXT NOT NULL DEFAULT 'L2' CHECK (layer IN ('L0', 'L1', 'L2', 'L3', 'L4', 'L5')),
  title TEXT NOT NULL DEFAULT 'Untitled memory',
  content TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_id TEXT,
  confidence NUMERIC(4,3) NOT NULL DEFAULT 0.6 CHECK (confidence >= 0 AND confidence <= 1),
  importance NUMERIC(4,3) NOT NULL DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'agent_only', 'disabled')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('candidate', 'active', 'archived', 'disabled', 'deleted')),
  tags TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_memories_user_status_updated
  ON memories(user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_user_layer_type
  ON memories(user_id, layer, memory_type);
CREATE INDEX IF NOT EXISTS idx_memories_tags
  ON memories USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_memories_metadata
  ON memories USING GIN(metadata);

CREATE TABLE IF NOT EXISTS memory_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  embedding_model TEXT NOT NULL DEFAULT '',
  embedding_vector JSONB,
  embedding_text TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_embeddings_memory
  ON memory_embeddings(memory_id);

CREATE TABLE IF NOT EXISTS memory_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  target_memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL DEFAULT 'related',
  weight NUMERIC(4,3) NOT NULL DEFAULT 0.5 CHECK (weight >= 0 AND weight <= 1),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT memory_links_no_self_link CHECK (source_memory_id <> target_memory_id)
);

CREATE INDEX IF NOT EXISTS idx_memory_links_user_source
  ON memory_links(user_id, source_memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_links_user_target
  ON memory_links(user_id, target_memory_id);

CREATE TABLE IF NOT EXISTS user_learning_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL DEFAULT '',
  concept TEXT NOT NULL DEFAULT '',
  problem_type TEXT NOT NULL DEFAULT '',
  mastery_score NUMERIC(4,3) NOT NULL DEFAULT 0.5 CHECK (mastery_score >= 0 AND mastery_score <= 1),
  error_patterns JSONB NOT NULL DEFAULT '[]',
  strengths JSONB NOT NULL DEFAULT '[]',
  next_practice JSONB NOT NULL DEFAULT '[]',
  metadata JSONB NOT NULL DEFAULT '{}',
  last_practiced_at TIMESTAMPTZ,
  review_due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, subject, concept, problem_type)
);

CREATE INDEX IF NOT EXISTS idx_learning_profiles_user_review
  ON user_learning_profiles(user_id, review_due_at ASC NULLS LAST, updated_at DESC);

CREATE TABLE IF NOT EXISTS project_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_name TEXT NOT NULL,
  project_type TEXT NOT NULL DEFAULT 'general',
  current_state JSONB NOT NULL DEFAULT '{}',
  key_decisions JSONB NOT NULL DEFAULT '[]',
  open_questions JSONB NOT NULL DEFAULT '[]',
  todos JSONB NOT NULL DEFAULT '[]',
  artifacts JSONB NOT NULL DEFAULT '[]',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, project_name)
);

CREATE INDEX IF NOT EXISTS idx_project_memories_user_updated
  ON project_memories(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS memory_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  memory_id UUID REFERENCES memories(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  reason TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_events_user_created
  ON memory_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_events_memory
  ON memory_events(memory_id, created_at DESC);

CREATE TABLE IF NOT EXISTS memory_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  auto_write_enabled BOOLEAN NOT NULL DEFAULT true,
  sensitive_auto_save BOOLEAN NOT NULL DEFAULT false,
  enabled_layers JSONB NOT NULL DEFAULT '{"L0": true, "L1": true, "L2": true, "L3": true, "L4": true, "L5": true}',
  disabled_memory_types TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION synapse_memory_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_memories_touch_updated_at ON memories;
CREATE TRIGGER trg_memories_touch_updated_at
  BEFORE UPDATE ON memories
  FOR EACH ROW EXECUTE FUNCTION synapse_memory_touch_updated_at();

DROP TRIGGER IF EXISTS trg_memory_links_touch_updated_at ON memory_links;
CREATE TRIGGER trg_memory_links_touch_updated_at
  BEFORE UPDATE ON memory_links
  FOR EACH ROW EXECUTE FUNCTION synapse_memory_touch_updated_at();

DROP TRIGGER IF EXISTS trg_learning_profiles_touch_updated_at ON user_learning_profiles;
CREATE TRIGGER trg_learning_profiles_touch_updated_at
  BEFORE UPDATE ON user_learning_profiles
  FOR EACH ROW EXECUTE FUNCTION synapse_memory_touch_updated_at();

DROP TRIGGER IF EXISTS trg_project_memories_touch_updated_at ON project_memories;
CREATE TRIGGER trg_project_memories_touch_updated_at
  BEFORE UPDATE ON project_memories
  FOR EACH ROW EXECUTE FUNCTION synapse_memory_touch_updated_at();

DROP TRIGGER IF EXISTS trg_memory_settings_touch_updated_at ON memory_settings;
CREATE TRIGGER trg_memory_settings_touch_updated_at
  BEFORE UPDATE ON memory_settings
  FOR EACH ROW EXECUTE FUNCTION synapse_memory_touch_updated_at();

ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_learning_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own memories" ON memories;
CREATE POLICY "Users can read own memories" ON memories
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can create own memories" ON memories;
CREATE POLICY "Users can create own memories" ON memories
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own memories" ON memories;
CREATE POLICY "Users can update own memories" ON memories
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own memories" ON memories;
CREATE POLICY "Users can delete own memories" ON memories
  FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own memory embeddings" ON memory_embeddings;
CREATE POLICY "Users can manage own memory embeddings" ON memory_embeddings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own memory links" ON memory_links;
CREATE POLICY "Users can manage own memory links" ON memory_links
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own learning profiles" ON user_learning_profiles;
CREATE POLICY "Users can manage own learning profiles" ON user_learning_profiles
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own project memories" ON project_memories;
CREATE POLICY "Users can manage own project memories" ON project_memories
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can read own memory events" ON memory_events;
CREATE POLICY "Users can read own memory events" ON memory_events
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can create own memory events" ON memory_events;
CREATE POLICY "Users can create own memory events" ON memory_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own memory settings" ON memory_settings;
CREATE POLICY "Users can manage own memory settings" ON memory_settings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

