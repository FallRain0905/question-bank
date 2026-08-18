-- 修复 class_members 缺失的 status / message 列
-- 应用代码（app/api/classes/join/route.ts、app/classes/page.tsx）与
-- ultimate_fix.sql 的 RLS 策略和函数都依赖这两列，但 class_system.sql 的
-- CREATE TABLE 从未创建它们，导致新部署时插入加入申请会失败。
-- 本脚本幂等，可安全重复执行。

ALTER TABLE class_members
    ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected'));

ALTER TABLE class_members
    ADD COLUMN IF NOT EXISTS message TEXT;
