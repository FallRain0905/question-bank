-- AI research tool settings.
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS semantic_scholar_api_key TEXT DEFAULT '';
