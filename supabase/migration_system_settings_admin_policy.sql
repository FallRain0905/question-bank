-- Allow both the fixed super-admin email and auth user_metadata admins
-- to manage system_settings. This keeps browser-auth fallback usable while
-- server routes should still prefer SUPABASE_SERVICE_ROLE_KEY.
DROP POLICY IF EXISTS "Only super admins can view settings" ON public.system_settings;
DROP POLICY IF EXISTS "Only super admins can insert settings" ON public.system_settings;
DROP POLICY IF EXISTS "Only super admins can update settings" ON public.system_settings;
DROP POLICY IF EXISTS "Only super admins can delete settings" ON public.system_settings;

CREATE POLICY "Only super admins can view settings"
  ON public.system_settings FOR SELECT
  USING (
    auth.email() = '3283254551@qq.com'
    OR COALESCE((auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean, false)
  );

CREATE POLICY "Only super admins can insert settings"
  ON public.system_settings FOR INSERT
  WITH CHECK (
    auth.email() = '3283254551@qq.com'
    OR COALESCE((auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean, false)
  );

CREATE POLICY "Only super admins can update settings"
  ON public.system_settings FOR UPDATE
  USING (
    auth.email() = '3283254551@qq.com'
    OR COALESCE((auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean, false)
  )
  WITH CHECK (
    auth.email() = '3283254551@qq.com'
    OR COALESCE((auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean, false)
  );

CREATE POLICY "Only super admins can delete settings"
  ON public.system_settings FOR DELETE
  USING (
    auth.email() = '3283254551@qq.com'
    OR COALESCE((auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean, false)
  );

UPDATE public.system_settings
SET value = 'https://api.siliconflow.cn/v1/chat/completions'
WHERE key = 'llm_api_url'
  AND (value IS NULL OR value = '' OR value = 'https://api.deepseek.com/v1/chat/completions');

UPDATE public.system_settings
SET value = 'deepseek-ai/DeepSeek-V4-Flash'
WHERE key = 'llm_model'
  AND (value IS NULL OR value = '' OR value = 'deepseek-v4-flash');
