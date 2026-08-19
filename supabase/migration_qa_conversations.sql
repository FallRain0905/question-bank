-- QA Conversations and Messages
CREATE TABLE IF NOT EXISTS qa_conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kb_id UUID NOT NULL,
  title TEXT NOT NULL DEFAULT '新对话',
  mode TEXT DEFAULT 'hyper',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS qa_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES qa_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  sources JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qa_conversations_user ON qa_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_qa_messages_conv ON qa_messages(conversation_id);

-- Enable RLS
ALTER TABLE qa_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own conversations" ON qa_conversations;
CREATE POLICY "Users can manage their own conversations" ON qa_conversations
  FOR ALL USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can manage their own messages" ON qa_messages;
CREATE POLICY "Users can manage their own messages" ON qa_messages
  FOR ALL USING (
    conversation_id IN (SELECT id FROM qa_conversations WHERE user_id = auth.uid())
  );
