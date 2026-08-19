-- 间隔重复（spaced repetition）复习模块
-- review_schedule: 每道题/每个词对每个用户一条排期记录
-- review_logs: 每次复习打分的历史，用于连续打卡与今日进度统计

CREATE TABLE IF NOT EXISTS review_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  ease DOUBLE PRECISION NOT NULL DEFAULT 2.5,
  interval_days INTEGER NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  due_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS review_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  schedule_id UUID NOT NULL REFERENCES review_schedule(id) ON DELETE CASCADE,
  question_id UUID,
  grade TEXT NOT NULL,
  ease DOUBLE PRECISION NOT NULL,
  interval_days INTEGER NOT NULL,
  reviewed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_schedule_user_due ON review_schedule(user_id, due_at);
CREATE INDEX IF NOT EXISTS idx_review_logs_user_reviewed ON review_logs(user_id, reviewed_at DESC);

ALTER TABLE review_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own review schedule" ON review_schedule FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own review schedule" ON review_schedule FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own review schedule" ON review_schedule FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own review schedule" ON review_schedule FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can read own review logs" ON review_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own review logs" ON review_logs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own review logs" ON review_logs FOR DELETE USING (auth.uid() = user_id);
