-- Deep research sessions and evidence board
CREATE TABLE IF NOT EXISTS research_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'CREATED',
  scope JSONB,
  graph_template JSONB,
  depth TEXT NOT NULL DEFAULT 'standard',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_research_sessions_user_updated
  ON research_sessions(user_id, updated_at DESC);

ALTER TABLE research_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own research sessions" ON research_sessions;
CREATE POLICY "Users can read own research sessions" ON research_sessions
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own research sessions" ON research_sessions;
CREATE POLICY "Users can create own research sessions" ON research_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own research sessions" ON research_sessions;
CREATE POLICY "Users can update own research sessions" ON research_sessions
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own research sessions" ON research_sessions;
CREATE POLICY "Users can delete own research sessions" ON research_sessions
  FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS research_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  claim TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  node_refs TEXT[] DEFAULT ARRAY[]::TEXT[],
  edge_refs TEXT[] DEFAULT ARRAY[]::TEXT[],
  confidence NUMERIC DEFAULT 0.6,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_research_evidence_session_created
  ON research_evidence(session_id, created_at DESC);

ALTER TABLE research_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own research evidence" ON research_evidence;
CREATE POLICY "Users can read own research evidence" ON research_evidence
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own research evidence" ON research_evidence;
CREATE POLICY "Users can create own research evidence" ON research_evidence
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own research evidence" ON research_evidence;
CREATE POLICY "Users can update own research evidence" ON research_evidence
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own research evidence" ON research_evidence;
CREATE POLICY "Users can delete own research evidence" ON research_evidence
  FOR DELETE USING (auth.uid() = user_id);
