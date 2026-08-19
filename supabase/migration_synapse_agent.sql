-- Synapse main agent memory, tool traces, and uploaded reading files.
CREATE TABLE IF NOT EXISTS agent_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New Synapse Conversation',
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_conversations_user_updated
  ON agent_conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_conversation_created
  ON agent_messages(conversation_id, created_at ASC);

CREATE TABLE IF NOT EXISTS agent_tool_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  message_id UUID REFERENCES agent_messages(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  input JSONB NOT NULL DEFAULT '{}',
  output JSONB NOT NULL DEFAULT '{}',
  summary TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_tool_traces_conversation_created
  ON agent_tool_traces(conversation_id, created_at ASC);

CREATE TABLE IF NOT EXISTS agent_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL DEFAULT 'file',
  file_size BIGINT NOT NULL DEFAULT 0,
  storage_path TEXT,
  file_url TEXT,
  content_text TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_files_conversation_created
  ON agent_files(conversation_id, created_at DESC);

ALTER TABLE agent_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_tool_traces ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own agent conversations" ON agent_conversations;
CREATE POLICY "Users can read own agent conversations" ON agent_conversations
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can create own agent conversations" ON agent_conversations;
CREATE POLICY "Users can create own agent conversations" ON agent_conversations
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own agent conversations" ON agent_conversations;
CREATE POLICY "Users can update own agent conversations" ON agent_conversations
  FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own agent conversations" ON agent_conversations;
CREATE POLICY "Users can delete own agent conversations" ON agent_conversations
  FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can read own agent messages" ON agent_messages;
CREATE POLICY "Users can read own agent messages" ON agent_messages
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can create own agent messages" ON agent_messages;
CREATE POLICY "Users can create own agent messages" ON agent_messages
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own agent messages" ON agent_messages;
CREATE POLICY "Users can delete own agent messages" ON agent_messages
  FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can read own agent tool traces" ON agent_tool_traces;
CREATE POLICY "Users can read own agent tool traces" ON agent_tool_traces
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can create own agent tool traces" ON agent_tool_traces;
CREATE POLICY "Users can create own agent tool traces" ON agent_tool_traces
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own agent tool traces" ON agent_tool_traces;
CREATE POLICY "Users can update own agent tool traces" ON agent_tool_traces
  FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own agent tool traces" ON agent_tool_traces;
CREATE POLICY "Users can delete own agent tool traces" ON agent_tool_traces
  FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can read own agent files" ON agent_files;
CREATE POLICY "Users can read own agent files" ON agent_files
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can create own agent files" ON agent_files;
CREATE POLICY "Users can create own agent files" ON agent_files
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own agent files" ON agent_files;
CREATE POLICY "Users can delete own agent files" ON agent_files
  FOR DELETE USING (auth.uid() = user_id);
