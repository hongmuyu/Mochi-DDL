// 任务优先级
export type Priority = 1 | 2 | 3;

/** 子任务模型（PRD §3.3.3） */
export interface SubTask {
  id: string;
  title: string;
  completed: boolean;
  completed_at?: string | null;
}

/** 重复规则（PRD §3.3.4） */
export type RepeatRule = 'none' | 'daily' | 'weekly' | 'monthly';

// DDL任务
export interface Task {
  id: string;
  name: string;
  deadline: string; // ISO datetime string
  priority: Priority;
  /** 任务主状态（PRD §4.20 双字段设计） */
  status: 'active' | 'completed' | 'deleted';
  completed: boolean;
  completed_at: string | null;
  created_at: string;
  /** 是否为超时补完成（任务过期后点"补完成"） */
  is_overtime_complete: boolean;
  /**
   * 完成子类型（PRD §4.20）：
   * - on_time：按时完成（剩余 > 1h）
   * - rush：压线完成（未过期且剩余 <= 1h）
   * - overtime：超时补完成（已过期后补完）
   * - null：未完成或旧数据
   */
  completion_type: 'on_time' | 'rush' | 'overtime' | null;
  /** 任务备注说明 */
  note?: string | null;
  /** 任务分类（学习/工作/生活/考研等） */
  category?: string | null;
  /** 心理提前截止时间（ISO 字符串） */
  cutoff_deadline?: string | null;
  /** 提醒提前分钟数（如 60=提前1h, 1440=提前1天） */
  reminder_offset?: number | null;
  /** 子任务列表（PRD §3.3.3） */
  subtasks?: SubTask[] | null;
  /** 重复规则（PRD §3.3.4） */
  repeat_rule?: RepeatRule | null;
  /** 重复任务源 ID */
  repeat_parent_id?: string | null;
}

/** 计时器恢复操作 */
export type TimerRecoveryAction = 'record' | 'discard' | 'continue';

/** 每日统计快照（用于惰性结算存储） */
export interface DailyStats {
  date: string;          // YYYY-MM-DD
  hp: number;            // 生命值 0-100
  san: number;           // 理智值 0-100
  wear: number;          // 磨损值（累积）
  karma: number;         // 功德值（可负）
  personality_title?: string | null;  // 每日人格称号（PRD 4.22 §3）
  personality_desc?: string | null;   // 每日人格描述
  created_at: string;
}

// 时间记录（每日）
export interface TimeRecord {
  id: string;
  record_date: string;
  // 兼容旧字段（显示时使用 effectiveStudyMinutes / effectiveSlackMinutes）
  study_minutes: number;
  slack_minutes: number;
  sleep_hours: number;
  late_hours: number;
  // 新增：计时器/手动 分字段
  timer_study_minutes: number;
  timer_slack_minutes: number;
  manual_study_minutes: number | null; // null 表示未手动覆盖，取 timer 值
  manual_slack_minutes: number | null;
  is_manual_override: boolean;
  created_at: string;
}

/** 取有效学习时长（手动覆盖 > 计时器累加） */
export function effectiveStudyMinutes(r: TimeRecord): number {
  return r.manual_study_minutes !== null ? r.manual_study_minutes : r.timer_study_minutes;
}

/** 取有效摸鱼时长（手动覆盖 > 计时器累加） */
export function effectiveSlackMinutes(r: TimeRecord): number {
  return r.manual_slack_minutes !== null ? r.manual_slack_minutes : r.timer_slack_minutes;
}

// 磨损值记录（本地存储）
export interface WearState {
  wearValue: number;        // 当前累计磨损值（越大越危险）
  lastLowHpDays: number;    // 累计低生命值天数
  lastSettleDate: string;   // 上次跨日结算的日期字符串
}

// 日切点设置
export interface CutoffSettings {
  cutoffHour: number; // 0-6，默认4
}

// 危险等级
export type DangerLevel = 'safe' | 'warning' | 'danger' | 'critical' | 'dying';

// 精神状态
export interface SpiritState {
  lifePoints: number; // 生命值 0-100
  sanityPoints: number; // 理智值 0-100
  sleepDebt: number; // 睡眠债 小时数
  meritPoints: number; // 功德值（可为负）
  madnessLevel: number; // 发疯浓度 0-100
}

// 人格称号
export interface Personality {
  title: string;
  description: string;
}

// 应用设置
export interface AppSettings {
  soundEnabled: boolean;
  customSoundUri: string | null;
  cutoffHour: number; // 日切点（0-6）
}
