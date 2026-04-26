-- 用户设置表 — 允许用户自定义 API Key
CREATE TABLE IF NOT EXISTS user_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  llm_provider TEXT DEFAULT 'deepseek',
  llm_api_key TEXT DEFAULT '',
  llm_api_url TEXT DEFAULT '',
  llm_model TEXT DEFAULT '',
  mineru_api_key TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 如果表已存在，补加 llm_model 列
DO $$ BEGIN
  ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS llm_model TEXT DEFAULT '';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings_select_own" ON user_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "settings_insert_own" ON user_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "settings_update_own" ON user_settings FOR UPDATE USING (auth.uid() = user_id);
