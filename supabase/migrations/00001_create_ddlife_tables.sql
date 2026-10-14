
-- DDL任务表
CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  deadline timestamptz NOT NULL,
  priority int NOT NULL DEFAULT 2, -- 1=低 2=中 3=高
  completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 时间记录表（每日）
CREATE TABLE IF NOT EXISTS time_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_date date NOT NULL DEFAULT CURRENT_DATE,
  study_minutes int NOT NULL DEFAULT 0,
  slack_minutes int NOT NULL DEFAULT 0,
  sleep_hours numeric(4,1) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(record_date)
);

-- 禁用RLS（无需认证）
ALTER TABLE tasks DISABLE ROW LEVEL SECURITY;
ALTER TABLE time_records DISABLE ROW LEVEL SECURITY;
