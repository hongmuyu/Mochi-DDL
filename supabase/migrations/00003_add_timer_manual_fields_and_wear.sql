
-- time_records 新增 timer/manual 分字段
ALTER TABLE time_records
  ADD COLUMN IF NOT EXISTS timer_study_minutes INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS timer_slack_minutes INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS manual_study_minutes INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS manual_slack_minutes INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_manual_override BOOLEAN NOT NULL DEFAULT FALSE;

-- 将旧数据迁移：把已有的 study_minutes 当做 timer 值
UPDATE time_records
SET timer_study_minutes = study_minutes,
    timer_slack_minutes = slack_minutes
WHERE timer_study_minutes = 0 AND timer_slack_minutes = 0;
