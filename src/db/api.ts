import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDb, genId } from '@/db/database';
import { AppSettings, DailyStats, Priority, Task, TimeRecord, WearState } from '@/types/types';

// ==================== 任务相关（SQLite）====================

/** 将 SQLite 行（integer boolean、null 处理）转换为 Task */
function rowToTask(row: Record<string, unknown>): Task {
  const isOvertimeComplete = (row.is_overtime_complete as number) === 1;
  // completion_type：优先读 DB 字段，旧行回退兼容推导
  const rawType = row.completion_type as string | null | undefined;
  let completionType: Task['completion_type'] = null;
  if (rawType === 'on_time' || rawType === 'rush' || rawType === 'overtime') {
    completionType = rawType;
  } else if ((row.completed as number) === 1) {
    // 旧数据兼容：无 completion_type 字段时，用 is_overtime_complete 推导
    completionType = isOvertimeComplete ? 'overtime' : null;
  }

  let subtasks: Task['subtasks'] = null;
  if (typeof row.subtasks === 'string' && row.subtasks.trim()) {
    try {
      subtasks = JSON.parse(row.subtasks);
    } catch {
      subtasks = null;
    }
  }

  return {
    id:                   row.id as string,
    name:                 row.name as string,
    deadline:             row.deadline as string,
    priority:             (row.priority as number) as Task['priority'],
    status:               (row.status as Task['status']) ?? (((row.completed as number) === 1) ? 'completed' : 'active'),
    completed:            (row.completed as number) === 1,
    completed_at:         (row.completed_at as string) ?? null,
    created_at:           row.created_at as string,
    is_overtime_complete: isOvertimeComplete,
    completion_type:      completionType,
    note:                 (row.note as string) ?? null,
    category:             (row.category as string) ?? null,
    cutoff_deadline:      (row.cutoff_deadline as string) ?? null,
    reminder_offset:      row.reminder_offset !== undefined && row.reminder_offset !== null ? Number(row.reminder_offset) : null,
    subtasks:             subtasks,
    repeat_rule:          (row.repeat_rule as Task['repeat_rule']) ?? 'none',
    repeat_parent_id:     (row.repeat_parent_id as string) ?? null,
  };
}

/** 获取所有非已删除任务（按截止时间排序） */
export async function getAllTasks(): Promise<Task[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM tasks WHERE status != 'deleted' ORDER BY deadline ASC LIMIT 200`,
  );
  return rows.map(rowToTask);
}

/** 获取所有已删除任务（回收站） */
export async function getDeletedTasks(): Promise<Task[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM tasks WHERE status = 'deleted' ORDER BY deadline DESC LIMIT 100`,
  );
  return rows.map(rowToTask);
}

/** 创建任务 */
export async function createTask(
  name: string,
  deadline: string,
  priority: number,
  options?: {
    note?: string | null;
    category?: string | null;
    cutoff_deadline?: string | null;
    reminder_offset?: number | null;
    subtasks?: Task['subtasks'];
    repeat_rule?: Task['repeat_rule'];
    repeat_parent_id?: string | null;
  },
): Promise<Task> {
  const db = await getDb();
  const id = genId();
  const createdAt = new Date().toISOString();
  const subtasksJson = options?.subtasks ? JSON.stringify(options.subtasks) : null;
  const repeatRule = options?.repeat_rule ?? 'none';
  const repeatParentId = options?.repeat_parent_id ?? null;

  await db.runAsync(
    `INSERT INTO tasks (id, name, deadline, priority, completed, created_at, is_overtime_complete, status, note, category, cutoff_deadline, reminder_offset, subtasks, repeat_rule, repeat_parent_id)
     VALUES (?, ?, ?, ?, 0, ?, 0, 'active', ?, ?, ?, ?, ?, ?, ?)`,
    id,
    name,
    deadline,
    priority,
    createdAt,
    options?.note ?? null,
    options?.category ?? null,
    options?.cutoff_deadline ?? null,
    options?.reminder_offset ?? null,
    subtasksJson,
    repeatRule,
    repeatParentId,
  );
  return {
    id,
    name,
    deadline,
    priority: priority as Priority,
    status: 'active',
    completed: false,
    completed_at: null,
    created_at: createdAt,
    is_overtime_complete: false,
    completion_type: null,
    note: options?.note ?? null,
    category: options?.category ?? null,
    cutoff_deadline: options?.cutoff_deadline ?? null,
    reminder_offset: options?.reminder_offset ?? null,
    subtasks: options?.subtasks ?? null,
    repeat_rule: repeatRule,
    repeat_parent_id: repeatParentId,
  };
}

/** 根据 ID 查询单个任务详情 */
export async function getTaskById(id: string): Promise<Task | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Record<string, unknown>>(`SELECT * FROM tasks WHERE id = ?`, id);
  return row ? rowToTask(row) : null;
}

/**
 * 正常完成任务（未过期）——自动推导 completion_type（PRD §4.20）
 * 若任务配置了重复规则（daily/weekly/monthly），自动生成下一周期的新待办任务（PRD §3.3.4）
 */
export async function completeTask(id: string, deadline: string): Promise<{ task: Task; nextTask?: Task }> {
  const db = await getDb();
  const now = Date.now();
  const deadlineTs = new Date(deadline).getTime();
  // 剩余时间（ms）：正值=未过期，负值=已过期
  const remaining = deadlineTs - now;
  // 压线：未过期且剩余 <= 1h → rush；否则 on_time
  const completionType: Task['completion_type'] = remaining <= 3600_000 ? 'rush' : 'on_time';
  await db.runAsync(
    `UPDATE tasks SET completed = 1, completed_at = ?, is_overtime_complete = 0,
     status = 'completed', completion_type = ? WHERE id = ?`,
    new Date(now).toISOString(), completionType, id,
  );

  const current = await getTaskById(id);
  let nextTask: Task | undefined;

  // 检查是否配置了重复规则，若是则按周期自动衍生下一次任务
  if (current && current.repeat_rule && current.repeat_rule !== 'none') {
    const curDl = new Date(current.deadline);
    const nextDl = new Date(curDl.getTime());
    if (current.repeat_rule === 'daily') {
      nextDl.setDate(nextDl.getDate() + 1);
    } else if (current.repeat_rule === 'weekly') {
      nextDl.setDate(nextDl.getDate() + 7);
    } else if (current.repeat_rule === 'monthly') {
      nextDl.setMonth(nextDl.getMonth() + 1);
    }

    // 若有心理提前截止时间，同步位移对应差值
    let nextCutoff: string | null = null;
    if (current.cutoff_deadline) {
      const diff = curDl.getTime() - new Date(current.cutoff_deadline).getTime();
      nextCutoff = new Date(nextDl.getTime() - diff).toISOString();
    }

    // 重置子任务完成状态
    const nextSubtasks = current.subtasks?.map(st => ({
      ...st,
      id: genId(),
      completed: false,
      completed_at: null,
    })) ?? null;

    nextTask = await createTask(
      current.name,
      nextDl.toISOString(),
      current.priority,
      {
        note: current.note,
        category: current.category,
        cutoff_deadline: nextCutoff,
        reminder_offset: current.reminder_offset,
        subtasks: nextSubtasks,
        repeat_rule: current.repeat_rule,
        repeat_parent_id: current.repeat_parent_id || current.id,
      },
    );
  }

  return { task: current ?? (await getTaskById(id))!, nextTask };
}

/** 取消完成状态（恢复为未完成任务）并返回恢复后的任务 */
export async function uncompleteTask(id: string): Promise<Task | null> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE tasks SET completed = 0, completed_at = NULL, is_overtime_complete = 0,
     status = 'active', completion_type = NULL WHERE id = ?`,
    id,
  );
  return getTaskById(id);
}

/** 撤销删除任务（恢复为活动任务或已完成任务）并返回恢复后的任务 */
export async function restoreTask(id: string): Promise<Task | null> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE tasks SET status = CASE WHEN completed = 1 THEN 'completed' ELSE 'active' END WHERE id = ?`,
    id,
  );
  return getTaskById(id);
}

/** 超时补完成任务（已过期后点击"补完成"） */
export async function overtimeCompleteTask(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE tasks SET completed = 1, completed_at = ?, is_overtime_complete = 1,
     status = 'completed', completion_type = 'overtime' WHERE id = ?`,
    new Date().toISOString(), id,
  );
}

/**
 * 快捷延期任务（延期指定毫秒数）
 * 同步将截止时间与心理提前截止时间（若有）向后平移
 */
export async function postponeTask(id: string, extendMs: number): Promise<Task | null> {
  const current = await getTaskById(id);
  if (!current) return null;

  const curDlTs = new Date(current.deadline).getTime();
  const newDl = new Date(curDlTs + extendMs).toISOString();

  let newCutoff: string | null = null;
  if (current.cutoff_deadline) {
    const curCutoffTs = new Date(current.cutoff_deadline).getTime();
    newCutoff = new Date(curCutoffTs + extendMs).toISOString();
  }

  return updateTask(id, {
    deadline: newDl,
    cutoff_deadline: newCutoff,
  });
}

/** 切换子任务完成状态 */
export async function toggleSubTask(taskId: string, subtaskId: string): Promise<Task | null> {
  const current = await getTaskById(taskId);
  if (!current || !current.subtasks) return null;

  const updatedSubtasks = current.subtasks.map(st => {
    if (st.id === subtaskId) {
      const nextCompleted = !st.completed;
      return {
        ...st,
        completed: nextCompleted,
        completed_at: nextCompleted ? new Date().toISOString() : null,
      };
    }
    return st;
  });

  return updateTask(taskId, { subtasks: updatedSubtasks });
}

/** 新增子任务 */
export async function addSubTask(taskId: string, title: string): Promise<Task | null> {
  const current = await getTaskById(taskId);
  if (!current) return null;

  const existing = current.subtasks ?? [];
  const newSubTask = {
    id: genId(),
    title: title.trim(),
    completed: false,
    completed_at: null,
  };
  const updatedSubtasks = [...existing, newSubTask];
  return updateTask(taskId, { subtasks: updatedSubtasks });
}

/** 删除子任务 */
export async function deleteSubTask(taskId: string, subtaskId: string): Promise<Task | null> {
  const current = await getTaskById(taskId);
  if (!current || !current.subtasks) return null;

  const updatedSubtasks = current.subtasks.filter(st => st.id !== subtaskId);
  return updateTask(taskId, { subtasks: updatedSubtasks });
}

/**
 * 更新任务基本信息
 * 防逃课规则（PRD §7）：已过期任务（status=expired）的 deadline 字段锁定为只读，
 * 调用方负责不传入 deadline 参数，此函数不做额外限制以保持灵活性。
 */
export async function updateTask(
  id: string,
  params: {
    name?: string;
    deadline?: string;
    priority?: number;
    note?: string | null;
    category?: string | null;
    cutoff_deadline?: string | null;
    reminder_offset?: number | null;
    subtasks?: Task['subtasks'];
    repeat_rule?: Task['repeat_rule'];
    repeat_parent_id?: string | null;
  },
): Promise<Task | null> {
  const db = await getDb();
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  if (params.name !== undefined)            { sets.push('name = ?');            vals.push(params.name); }
  if (params.deadline !== undefined)        { sets.push('deadline = ?');        vals.push(params.deadline); }
  if (params.priority !== undefined)        { sets.push('priority = ?');        vals.push(params.priority); }
  if (params.note !== undefined)            { sets.push('note = ?');            vals.push(params.note); }
  if (params.category !== undefined)        { sets.push('category = ?');        vals.push(params.category); }
  if (params.cutoff_deadline !== undefined) { sets.push('cutoff_deadline = ?'); vals.push(params.cutoff_deadline); }
  if (params.reminder_offset !== undefined) { sets.push('reminder_offset = ?'); vals.push(params.reminder_offset); }
  if (params.subtasks !== undefined)        {
    sets.push('subtasks = ?');
    vals.push(params.subtasks ? JSON.stringify(params.subtasks) : null);
  }
  if (params.repeat_rule !== undefined)     { sets.push('repeat_rule = ?');     vals.push(params.repeat_rule); }
  if (params.repeat_parent_id !== undefined){ sets.push('repeat_parent_id = ?');vals.push(params.repeat_parent_id); }
  if (sets.length === 0) return getTaskById(id);
  vals.push(id);
  await db.runAsync(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, ...vals);
  return getTaskById(id);
}

/** 软删除任务（状态标记为 deleted，支持5秒撤销与回收站随时恢复） */
export async function deleteTask(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE tasks SET status = 'deleted' WHERE id = ?`, id);
}

/** 彻底永久删除任务（物理删除） */
export async function permanentlyDeleteTask(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM tasks WHERE id = ?`, id);
}

/** 清空回收站中所有已删除任务 */
export async function clearTrash(): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM tasks WHERE status = 'deleted'`);
}

/**
 * 归档删除已完成任务（SPEC §4.1 / §6.2）
 * 仅将 status 由 'completed' 改为 'deleted'，不修改任何历史数据
 */
export async function archiveDeleteTask(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE tasks SET status = 'deleted' WHERE id = ? AND status = 'completed'`,
    id,
  );
}

// ──────── Anti-Cheat: 红温惩罚性调整（PRD §3 任务删除惩罚）─────────────
const PENALTY_KEY = 'ddlife_delete_penalty_v1';
interface PenaltyStore { karmaDeduct: number; hpDeduct: number }

/** 读取已累积的删除惩罚量（扣减值为正数） */
export async function loadPenaltyAdjustments(): Promise<PenaltyStore> {
  try {
    const raw = await AsyncStorage.getItem(PENALTY_KEY);
    if (raw) return JSON.parse(raw) as PenaltyStore;
  } catch { /* 忽略 */ }
  return { karmaDeduct: 0, hpDeduct: 0 };
}

/**
 * 累加一次红温任务惩罚性删除的扣减量
 * karma-10 / HP-5（PRD §3: 任务删除惩罚）
 */
export async function addDeletePenalty(karmaDeduct = 10, hpDeduct = 5): Promise<void> {
  const prev = await loadPenaltyAdjustments();
  await AsyncStorage.setItem(PENALTY_KEY, JSON.stringify({
    karmaDeduct: prev.karmaDeduct + karmaDeduct,
    hpDeduct:    prev.hpDeduct    + hpDeduct,
  }));
}

/**
 * 撤销删除时回退惩罚扣减量
 */
export async function reverseDeletePenalty(karmaDeduct = 10, hpDeduct = 5): Promise<void> {
  try {
    const prev = await loadPenaltyAdjustments();
    await AsyncStorage.setItem(PENALTY_KEY, JSON.stringify({
      karmaDeduct: Math.max(0, prev.karmaDeduct - karmaDeduct),
      hpDeduct:    Math.max(0, prev.hpDeduct    - hpDeduct),
    }));
  } catch { /* 忽略 */ }
}

// ──────── Anti-Cheat: 计时器锁定（PRD 3.4.2 §5）──────────────────────────
const TIMER_LOCK_KEY         = 'ddlife_timer_lock_date';    // 锁定日期
const TIMER_DAILY_ABNORMAL   = 'ddlife_timer_abnormal_secs'; // 当日异常累计秒数

/** 检查今日计时器是否被锁定 */
export async function isTimerLockedToday(todayStr: string): Promise<boolean> {
  const lockDate = await AsyncStorage.getItem(TIMER_LOCK_KEY);
  return lockDate === todayStr;
}

/** 累计当日异常秒数；若超过 12h 则锁定计时器，返回是否已锁定 */
export async function recordAbnormalSecs(secs: number, todayStr: string): Promise<boolean> {
  const raw = await AsyncStorage.getItem(TIMER_DAILY_ABNORMAL);
  const prev = raw ? JSON.parse(raw) : { date: '', total: 0 };
  const total = prev.date === todayStr ? prev.total + secs : secs;
  await AsyncStorage.setItem(TIMER_DAILY_ABNORMAL, JSON.stringify({ date: todayStr, total }));
  if (total >= 12 * 3600) {
    await AsyncStorage.setItem(TIMER_LOCK_KEY, todayStr);
    return true;
  }
  return false;
}

// ==================== 时间记录相关（SQLite）====================

/** 根据日切点将时间戳转换为日期字符串 */
export function dateStringByCutoff(ts: number, cutoffHour: number): string {
  const d = new Date(ts);
  if (d.getHours() < cutoffHour) {
    d.setDate(d.getDate() - 1);
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 将 SQLite 行转换为 TimeRecord（补齐新字段默认值） */
function rowToTimeRecord(row: Record<string, unknown>): TimeRecord {
  const studyMin = (row.study_minutes as number) ?? 0;
  const slackMin = (row.slack_minutes as number) ?? 0;
  return {
    id:                   row.id as string,
    record_date:          row.record_date as string,
    study_minutes:        studyMin,
    slack_minutes:        slackMin,
    sleep_hours:          (row.sleep_hours as number) ?? 0,
    late_hours:           (row.late_hours as number) ?? 0,
    timer_study_minutes:  (row.timer_study_minutes as number) ?? studyMin,
    timer_slack_minutes:  (row.timer_slack_minutes as number) ?? slackMin,
    manual_study_minutes: row.manual_study_minutes !== null ? (row.manual_study_minutes as number) : null,
    manual_slack_minutes: row.manual_slack_minutes !== null ? (row.manual_slack_minutes as number) : null,
    is_manual_override:   (row.is_manual_override as number) === 1,
    created_at:           (row.created_at as string) ?? '',
  };
}

/** 获取今日时间记录（按日切点） */
export async function getTodayRecord(cutoffHour = 4): Promise<TimeRecord | null> {
  const today = dateStringByCutoff(Date.now(), cutoffHour);
  const db = await getDb();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM time_records WHERE record_date = ?`, today,
  );
  return row ? rowToTimeRecord(row) : null;
}

/** 获取最近N天记录 */
export async function getRecentRecords(days = 7): Promise<TimeRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM time_records ORDER BY record_date DESC LIMIT ?`, days,
  );
  return rows.map(rowToTimeRecord);
}

/** 获取指定日期的时间记录 */
export async function getRecordByDate(date: string): Promise<TimeRecord | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM time_records WHERE record_date = ?`, date,
  );
  return row ? rowToTimeRecord(row) : null;
}

/** 修正指定时间记录（PRD §3.4.2 专注记录修正） */
export async function updateTimeRecord(
  id: string,
  params: {
    study_minutes?: number;
    slack_minutes?: number;
    sleep_hours?: number;
    late_hours?: number;
    timer_study_minutes?: number;
    timer_slack_minutes?: number;
  },
): Promise<TimeRecord | null> {
  const db = await getDb();
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  if (params.study_minutes !== undefined) {
    sets.push('study_minutes = ?', 'manual_study_minutes = ?', 'is_manual_override = 1');
    const v = Math.min(Math.max(0, params.study_minutes), 1440);
    vals.push(v, v);
  }
  if (params.slack_minutes !== undefined) {
    sets.push('slack_minutes = ?', 'manual_slack_minutes = ?', 'is_manual_override = 1');
    const v = Math.min(Math.max(0, params.slack_minutes), 1440);
    vals.push(v, v);
  }
  if (params.sleep_hours !== undefined) {
    sets.push('sleep_hours = ?');
    vals.push(Math.min(Math.max(0, params.sleep_hours), 24));
  }
  if (params.late_hours !== undefined) {
    sets.push('late_hours = ?');
    vals.push(Math.min(Math.max(0, params.late_hours), 24));
  }
  if (params.timer_study_minutes !== undefined) {
    sets.push('timer_study_minutes = ?');
    vals.push(Math.max(0, params.timer_study_minutes));
  }
  if (params.timer_slack_minutes !== undefined) {
    sets.push('timer_slack_minutes = ?');
    vals.push(Math.max(0, params.timer_slack_minutes));
  }
  if (sets.length === 0) return null;
  vals.push(id);
  await db.runAsync(`UPDATE time_records SET ${sets.join(', ')} WHERE id = ?`, ...vals);
  const row = await db.getFirstAsync<Record<string, unknown>>(`SELECT * FROM time_records WHERE id = ?`, id);
  return row ? rowToTimeRecord(row) : null;
}

/** 删除/作废指定时间记录 */
export async function deleteTimeRecord(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM time_records WHERE id = ?`, id);
}

/** 更新或创建今日时间记录（手动覆盖时使用） */
export async function upsertTodayRecord(params: {
  study_minutes?: number;
  slack_minutes?: number;
  sleep_hours?: number;
  late_hours?: number;
  manual_override?: boolean;
}, cutoffHour = 4): Promise<void> {
  const today = dateStringByCutoff(Date.now(), cutoffHour);
  const isOverride = params.manual_override === true;
  const existing = await getTodayRecord(cutoffHour);
  const db = await getDb();

  if (existing) {
    // 动态拼 SET 子句，避免覆盖未传入的字段
    const sets: string[] = [];
    const vals: (string | number | null)[] = [];

    if (params.sleep_hours !== undefined) { sets.push('sleep_hours = ?'); vals.push(params.sleep_hours); }
    if (params.late_hours  !== undefined) { sets.push('late_hours = ?');  vals.push(params.late_hours);  }

    if (isOverride) {
      if (params.study_minutes !== undefined) {
        const v = Math.min(params.study_minutes, 1440);
        sets.push('manual_study_minutes = ?', 'study_minutes = ?', 'is_manual_override = 1');
        vals.push(v, v);
      }
      if (params.slack_minutes !== undefined) {
        const v = Math.min(params.slack_minutes, 1440);
        sets.push('manual_slack_minutes = ?', 'slack_minutes = ?', 'is_manual_override = 1');
        vals.push(v, v);
      }
    } else {
      if (params.study_minutes !== undefined) { sets.push('study_minutes = ?'); vals.push(Math.min(params.study_minutes, 1440)); }
      if (params.slack_minutes !== undefined) { sets.push('slack_minutes = ?'); vals.push(Math.min(params.slack_minutes, 1440)); }
    }

    if (sets.length === 0) return;
    vals.push(existing.id);
    await db.runAsync(`UPDATE time_records SET ${sets.join(', ')} WHERE id = ?`, ...vals);
  } else {
    const studyMin = Math.min(params.study_minutes ?? 0, 1440);
    const slackMin = Math.min(params.slack_minutes ?? 0, 1440);
    await db.runAsync(
      `INSERT INTO time_records
         (id, record_date, study_minutes, slack_minutes, sleep_hours, late_hours,
          timer_study_minutes, timer_slack_minutes,
          manual_study_minutes, manual_slack_minutes, is_manual_override, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`,
      genId(), today, studyMin, slackMin,
      params.sleep_hours ?? 0, params.late_hours ?? 0,
      isOverride ? studyMin : null,
      isOverride ? slackMin : null,
      isOverride ? 1 : 0,
      new Date().toISOString(),
    );
  }
}

/**
 * 增量累加计时器时长到指定日期（timer 字段）
 * 跨天拆分后每个日期调用一次
 * PRD 4.14：跨天拆分累加时，如果导致某日总时长溢出 1440 分钟则截断
 */
export async function addMinutesToDateRecord(
  date: string,
  type: 'study' | 'slack',
  minutesToAdd: number,
): Promise<void> {
  if (minutesToAdd <= 0) return;
  const db = await getDb();

  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM time_records WHERE record_date = ?`, date,
  );

  if (row) {
    const rec = rowToTimeRecord(row);
    const timerField = type === 'study' ? 'timer_study_minutes' : 'timer_slack_minutes';
    const baseField  = type === 'study' ? 'study_minutes'       : 'slack_minutes';

    // 24h 截断兜底（PRD 4.14 §8）：当日总分钟数不超过 1440
    const currentTotal = rec.timer_study_minutes + rec.timer_slack_minutes;
    const headroom = Math.max(0, 1440 - currentTotal);
    const safeMinutes = Math.min(minutesToAdd, headroom);
    if (safeMinutes <= 0) return; // 当日已满 24h，丢弃剩余

    const newTimer = rec[timerField] + safeMinutes;
    const hasOverride = type === 'study' ? rec.manual_study_minutes !== null : rec.manual_slack_minutes !== null;

    if (hasOverride) {
      await db.runAsync(
        `UPDATE time_records SET ${timerField} = ? WHERE id = ?`,
        newTimer, rec.id,
      );
    } else {
      await db.runAsync(
        `UPDATE time_records SET ${timerField} = ?, ${baseField} = ? WHERE id = ?`,
        newTimer, newTimer, rec.id,
      );
    }
  } else {
    const safeMinutes = Math.min(minutesToAdd, 1440);
    const timerStudy = type === 'study' ? safeMinutes : 0;
    const timerSlack = type === 'slack' ? safeMinutes : 0;
    await db.runAsync(
      `INSERT INTO time_records
         (id, record_date, study_minutes, slack_minutes, sleep_hours, late_hours,
          timer_study_minutes, timer_slack_minutes,
          manual_study_minutes, manual_slack_minutes, is_manual_override, created_at)
       VALUES (?, ?, ?, ?, 0, 0, ?, ?, NULL, NULL, 0, ?)`,
      genId(), date, timerStudy, timerSlack, timerStudy, timerSlack, new Date().toISOString(),
    );
  }
}

/**
 * 睡眠计时器专用：累加睡眠小时数到指定日期记录（§3.1）
 * - 14h 硬上限（Anti-Cheat 睡眠规则）
 * - 跨天拆分后每段单独写入
 */
export async function addSleepHoursToDateRecord(
  date: string,
  hoursToAdd: number,
): Promise<void> {
  if (hoursToAdd <= 0) return;
  const clamped = Math.min(hoursToAdd, 14); // 单段最多 14h
  const db = await getDb();

  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM time_records WHERE record_date = ?`, date,
  );

  if (row) {
    const rec = rowToTimeRecord(row);
    // 累加到 sleep_hours，上限 14h
    const newSleep = Math.min(rec.sleep_hours + clamped, 14);
    await db.runAsync(
      `UPDATE time_records SET sleep_hours = ? WHERE id = ?`,
      newSleep, rec.id,
    );
  } else {
    await db.runAsync(
      `INSERT INTO time_records
         (id, record_date, study_minutes, slack_minutes, sleep_hours, late_hours,
          timer_study_minutes, timer_slack_minutes,
          manual_study_minutes, manual_slack_minutes, is_manual_override, created_at)
       VALUES (?, ?, 0, 0, ?, 0, 0, 0, NULL, NULL, 0, ?)`,
      genId(), date, clamped, new Date().toISOString(),
    );
  }
}

/** 获取指定日期区间内的记录（含两端，按日期升序，最多93天） */
export async function getRecordsInRange(startDate: string, endDate: string): Promise<TimeRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM time_records
     WHERE record_date >= ? AND record_date <= ?
     ORDER BY record_date ASC LIMIT 93`,
    startDate, endDate,
  );
  return rows.map(rowToTimeRecord);
}

/** 更新历史记录（stats 页修改窗口期内使用） */
export async function updateHistoricalRecord(
  recordId: string,
  params: {
    sleep_hours?: number;
    study_minutes?: number;
    slack_minutes?: number;
  },
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];

  if (params.sleep_hours !== undefined) {
    sets.push('sleep_hours = ?');
    vals.push(params.sleep_hours);
  }
  if (params.study_minutes !== undefined) {
    const v = Math.min(params.study_minutes, 1440);
    sets.push('study_minutes = ?', 'manual_study_minutes = ?', 'is_manual_override = 1');
    vals.push(v, v);
  }
  if (params.slack_minutes !== undefined) {
    const v = Math.min(params.slack_minutes, 1440);
    sets.push('slack_minutes = ?', 'manual_slack_minutes = ?', 'is_manual_override = 1');
    vals.push(v, v);
  }

  if (sets.length === 0) return;
  vals.push(recordId);
  await db.runAsync(`UPDATE time_records SET ${sets.join(', ')} WHERE id = ?`, ...vals);
}

// ==================== 每日精神状态快照（daily_stats）====================

/** 保存每日精神状态快照（含人格，PRD 4.22 §3 补丁） */
export async function saveDailyStats(stats: DailyStats): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO daily_stats
       (date, hp, san, wear, karma, personality_title, personality_desc, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    stats.date, stats.hp, stats.san, stats.wear, stats.karma,
    stats.personality_title ?? null, stats.personality_desc ?? null,
    stats.created_at,
  );
}

/** 获取最近的精神状态快照 */
export async function getLatestDailyStats(): Promise<DailyStats | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<DailyStats>(
    `SELECT * FROM daily_stats ORDER BY date DESC LIMIT 1`,
  );
  return row ?? null;
}

/** 获取指定日期的精神状态快照 */
export async function getDailyStatsByDate(date: string): Promise<DailyStats | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<DailyStats>(
    `SELECT * FROM daily_stats WHERE date = ?`, date,
  );
  return row ?? null;
}

// ==================== 磨损值（AsyncStorage 本地）====================

const WEAR_KEY     = 'ddlife_wear_state_v1';
const SETTINGS_KEY = 'ddlife_settings';
const CUTOFF_KEY   = 'ddlife_cutoff_hour';
const LAST_SETTLE_KEY    = 'ddlife_last_settle_date';
const LAST_CLEANUP_KEY   = 'ddlife_last_cleanup_date';
const NOTIF_DENY_COUNT   = 'ddlife_notif_deny_count';

/** 读取磨损状态 */
export async function loadWearState(): Promise<WearState> {
  try {
    const raw = await AsyncStorage.getItem(WEAR_KEY);
    if (raw) return JSON.parse(raw) as WearState;
  } catch { /* 忽略 */ }
  return { wearValue: 0, lastLowHpDays: 0, lastSettleDate: '' };
}

/** 保存磨损状态 */
export async function saveWearState(state: WearState): Promise<void> {
  await AsyncStorage.setItem(WEAR_KEY, JSON.stringify(state));
}

/**
 * 执行跨日结算：
 * - HP < 30：磨损值增加 (30 - HP)
 * - HP >= 80：磨损值衰减 10%
 */
export async function runDailySettlement(
  yesterdayHp: number,
  todayDateStr: string,
): Promise<WearState> {
  const wear = await loadWearState();
  let newWear    = wear.wearValue;
  let newLowDays = wear.lastLowHpDays;

  if (yesterdayHp < 30) {
    newWear    += 30 - yesterdayHp;
    newLowDays += 1;
  } else if (yesterdayHp >= 80) {
    newWear = Math.max(0, newWear * 0.9);
  }

  const newState: WearState = {
    wearValue:     Math.round(newWear),
    lastLowHpDays: newLowDays,
    lastSettleDate: todayDateStr,
  };
  await saveWearState(newState);
  return newState;
}

// ==================== 跨日惰性结算（PRD 4.22）====================

/** 读取上次结算日期 */
export async function loadLastSettleDate(): Promise<string> {
  return (await AsyncStorage.getItem(LAST_SETTLE_KEY)) ?? '';
}

/** 保存上次结算日期 */
export async function saveLastSettleDate(date: string): Promise<void> {
  await AsyncStorage.setItem(LAST_SETTLE_KEY, date);
}

/**
 * 生成从 startDate 到 endDate 之间的日期列表（不含两端）
 * 最多返回 30 天
 */
function buildDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  let cur = new Date(startDate + 'T12:00:00');
  const end = new Date(endDate + 'T12:00:00');
  cur.setDate(cur.getDate() + 1); // 不含 start
  let maxDays = 30;
  while (cur < end && maxDays-- > 0) {
    const d = cur;
    dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    cur = new Date(cur.getTime() + 86400 * 1000);
  }
  return dates;
}

/**
 * 执行跨日惰性结算（PRD 4.22 完整状态机）
 * calcFn: 外部传入当日结算函数（避免循环依赖 state.ts）
 * personalityFn: 可选，生成人格称号（PRD 4.4 完整决策矩阵）
 * 返回是否执行了结算
 */
export async function performLazySettlement(
  todayStr: string,
  calcFn: (record: TimeRecord | null, tasks: Task[], prevWear: number, sleeplessDays: number) => { hp: number; san: number; newWear: number; karma: number },
  personalityFn?: (input: { hp: number; san: number; karma: number; sleeplessDays: number; slackSecs: number; studySecs: number; redDdlCount: number }) => { title: string; description: string },
): Promise<boolean> {
  try {
    const lastSettle = await loadLastSettleDate();
    if (lastSettle >= todayStr) return false; // 已是最新

    const fromDate = lastSettle || (() => {
      // 首次安装：从昨天开始
      const d = new Date(todayStr + 'T12:00:00');
      d.setDate(d.getDate() - 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();

    if (fromDate >= todayStr) {
      await saveLastSettleDate(todayStr);
      return false;
    }

    const datesToSettle = buildDateRange(fromDate, todayStr);
    if (datesToSettle.length === 0) {
      await saveLastSettleDate(todayStr);
      return false;
    }

    const db = await getDb();
    // 读取所有相关任务（快照）
    const allTasks = await getAllTasks();
    // 读取 D-1 的快照作为初始磨损值
    const prevStats = await getDailyStatsByDate(fromDate);
    let rollingWear  = prevStats?.wear  ?? (await loadWearState()).wearValue;
    let rollingKarma = prevStats?.karma ?? 0;
    let sleeplessDays = 0;

    for (const date of datesToSettle) {
      const record = await getRecordByDate(date);
      // 统计截至当日的连续熬夜天数（最近 7 天，PRD §4.2.3：sleep_hours < 8 才算熬夜）
      if (record && record.sleep_hours < 8) sleeplessDays = Math.min(sleeplessDays + 1, 7);
      else sleeplessDays = Math.max(0, sleeplessDays - 1);

      const { hp, san, newWear, karma } = calcFn(record, allTasks, rollingWear, sleeplessDays);

      rollingWear  = newWear;
      rollingKarma = rollingKarma + karma; // karma 为当日增量

      // PRD §4.4：生成每日人格称号（传入精算后数值）
      let personalityTitle: string | null = null;
      let personalityDesc: string | null = null;
      if (personalityFn) {
        const slackSecs  = record ? ((record.manual_slack_minutes  !== null ? record.manual_slack_minutes  : record.timer_slack_minutes)  * 60) : 0;
        const studySecs  = record ? ((record.manual_study_minutes  !== null ? record.manual_study_minutes  : record.timer_study_minutes)  * 60) : 0;
        const redDdlCount = allTasks.filter(t => !t.completed).length; // 简化：活跃任务数作为代理
        const p = personalityFn({ hp, san, karma: rollingKarma, sleeplessDays, slackSecs, studySecs, redDdlCount });
        personalityTitle = p.title;
        personalityDesc  = p.description;
      }

      await db.runAsync(
        `INSERT OR REPLACE INTO daily_stats
           (date, hp, san, wear, karma, personality_title, personality_desc, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        date, hp, san, rollingWear, rollingKarma,
        personalityTitle, personalityDesc, new Date().toISOString(),
      );
    }

    // 更新持久化磨损状态
    const latest = datesToSettle[datesToSettle.length - 1];
    const latestStats = await getDailyStatsByDate(latest);
    if (latestStats) {
      const wear = await loadWearState();
      await saveWearState({ ...wear, wearValue: latestStats.wear, lastSettleDate: latest });
    }
    await saveLastSettleDate(todayStr);
    return true;
  } catch {
    return false;
  }
}

// ==================== 增量重算（PRD 4.23）====================

/**
 * 增量重算：从 fromDate 到 toDate（最多7天），重算 HP/SAN/磨损值/功德值/人格
 * 参数同 performLazySettlement
 */
export async function runIncrementalRecalc(
  fromDate: string,
  toDate: string,
  calcFn: (record: TimeRecord | null, tasks: Task[], prevWear: number, sleeplessDays: number) => { hp: number; san: number; newWear: number; karma: number },
  personalityFn?: (input: { hp: number; san: number; karma: number; sleeplessDays: number; slackSecs: number; studySecs: number; redDdlCount: number }) => { title: string; description: string },
): Promise<void> {
  try {
    const db = await getDb();
    const allTasks = await getAllTasks();

    // D-1 快照作为滚动初值
    const prevDate = (() => {
      const d = new Date(fromDate + 'T12:00:00');
      d.setDate(d.getDate() - 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();
    const prevStats = await getDailyStatsByDate(prevDate);
    let rollingWear  = prevStats?.wear  ?? (await loadWearState()).wearValue;
    let rollingKarma = prevStats?.karma ?? 0;
    let sleeplessDays = 0;

    // 生成 fromDate..toDate 闭区间（最多 7 天）
    const dates: string[] = [];
    let cur = new Date(fromDate + 'T12:00:00');
    const end = new Date(toDate + 'T12:00:00');
    let maxDays = 7;
    while (cur <= end && maxDays-- > 0) {
      const d = cur;
      dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
      cur = new Date(cur.getTime() + 86400 * 1000);
    }

    for (const date of dates) {
      const record = await getRecordByDate(date);
      if (record && record.sleep_hours < 8) sleeplessDays = Math.min(sleeplessDays + 1, 7);  // PRD §4.2.3：< 8h 算熬夜
      else sleeplessDays = Math.max(0, sleeplessDays - 1);

      const { hp, san, newWear, karma } = calcFn(record, allTasks, rollingWear, sleeplessDays);
      rollingWear  = newWear;
      rollingKarma = rollingKarma + karma;

      // 生成每日人格（PRD §4.4 完整决策矩阵）
      let personalityTitle: string | null = null;
      let personalityDesc: string | null = null;
      if (personalityFn) {
        const slackSecs  = record ? ((record.manual_slack_minutes  !== null ? record.manual_slack_minutes  : record.timer_slack_minutes)  * 60) : 0;
        const studySecs  = record ? ((record.manual_study_minutes  !== null ? record.manual_study_minutes  : record.timer_study_minutes)  * 60) : 0;
        const redDdlCount = allTasks.filter(t => !t.completed).length;
        const p = personalityFn({ hp, san, karma: rollingKarma, sleeplessDays, slackSecs, studySecs, redDdlCount });
        personalityTitle = p.title;
        personalityDesc  = p.description;
      }

      await db.runAsync(
        `INSERT OR REPLACE INTO daily_stats
           (date, hp, san, wear, karma, personality_title, personality_desc, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        date, hp, san, rollingWear, rollingKarma,
        personalityTitle, personalityDesc, new Date().toISOString(),
      );
    }

    // 更新持久化磨损状态
    const latestDate = dates[dates.length - 1];
    const latestStats = await getDailyStatsByDate(latestDate);
    if (latestStats) {
      const wear = await loadWearState();
      await saveWearState({ ...wear, wearValue: latestStats.wear });
    }
  } catch {
    /* 静默处理 */
  }
}

// ==================== 日志清理（PRD 4.10）====================

/**
 * 清理过期操作日志（每周最多执行一次）
 * 注意：此 App 暂无 operation_log 表，此函数预留接口以便未来扩展
 * 实际执行：清理 30 天前的 daily_stats 记录（保留最近90天）
 */
export async function cleanupOldData(): Promise<void> {
  try {
    const lastCleanup = await AsyncStorage.getItem(LAST_CLEANUP_KEY);
    const now = new Date();
    const nowStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    if (lastCleanup) {
      const last = new Date(lastCleanup);
      const diffDays = (now.getTime() - last.getTime()) / (1000 * 86400);
      if (diffDays < 7) return; // 每周只清理一次
    }

    const db = await getDb();
    // 清理 90 天以前的 daily_stats（保留最近 90 天）
    const cutoffDate = new Date(now.getTime() - 90 * 86400 * 1000);
    const cutoffStr = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}-${String(cutoffDate.getDate()).padStart(2, '0')}`;
    await db.runAsync(`DELETE FROM daily_stats WHERE date < ?`, cutoffStr);

    await AsyncStorage.setItem(LAST_CLEANUP_KEY, nowStr);
  } catch {
    /* 静默处理 */
  }
}

// ==================== 通知权限拒绝次数（PRD 12 降级策略）====================

export async function getNotifDenyCount(): Promise<number> {
  const v = await AsyncStorage.getItem(NOTIF_DENY_COUNT);
  return v ? parseInt(v, 10) : 0;
}

export async function incrementNotifDenyCount(): Promise<number> {
  const count = (await getNotifDenyCount()) + 1;
  await AsyncStorage.setItem(NOTIF_DENY_COUNT, String(count));
  return count;
}

// ==================== 日切点设置（AsyncStorage 本地）====================

export async function loadCutoffHour(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(CUTOFF_KEY);
    if (raw !== null) {
      const v = parseInt(raw, 10);
      if (!Number.isNaN(v) && v >= 0 && v <= 6) return v;
    }
  } catch { /* 忽略 */ }
  return 4;
}

export async function saveCutoffHour(hour: number): Promise<void> {
  await AsyncStorage.setItem(CUTOFF_KEY, String(Math.max(0, Math.min(6, hour))));
}

// ==================== 应用设置（AsyncStorage 本地）====================

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      return { soundEnabled: true, customSoundUri: null, cutoffHour: 4, ...parsed };
    }
  } catch { /* 忽略 */ }
  return { soundEnabled: true, customSoundUri: null, cutoffHour: 4 };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// ==================== HC-08 时光倒流防御（PRD §4.17）====================

const LAST_KNOWN_TS_KEY = 'ddlife_last_known_ts'; // 上次记录的可信时间戳（ms）

/** 保存当前时间戳为"最近可信时间"，每次 App 获得焦点时调用 */
export async function saveLastKnownTs(): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_KNOWN_TS_KEY, String(Date.now()));
  } catch { /* 静默 */ }
}

/** 读取上次保存的可信时间戳，不存在则返回 0 */
export async function loadLastKnownTs(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(LAST_KNOWN_TS_KEY);
    if (raw !== null) {
      const v = Number(raw);
      if (Number.isFinite(v) && v > 0) return v;
    }
  } catch { /* 静默 */ }
  return 0;
}

// ==================== PRD §3.8.5 timer_sessions 原始未截断总时长（彩蛋）====================

/**
 * 从 timer_sessions 表读取所有有效会话的原始未截断总秒数。
 * PRD §3.8.5：该数值不受 time_records 每日截断影响，作为「真实摸鱼/学习时长」彩蛋展示。
 */
export async function getTotalRawTimerSeconds(): Promise<{ studySecs: number; slackSecs: number }> {
  try {
    const db = await getDb();
    const rows = await db.getAllAsync<{ session_type: string; total: number }>(
      `SELECT session_type, SUM(duration_seconds) AS total
       FROM timer_sessions
       WHERE is_valid = 1 AND end_timestamp IS NOT NULL
       GROUP BY session_type`,
    );
    let studySecs = 0;
    let slackSecs = 0;
    for (const row of rows) {
      if (row.session_type === 'study') studySecs = row.total ?? 0;
      if (row.session_type === 'slack') slackSecs = row.total ?? 0;
    }
    return { studySecs, slackSecs };
  } catch {
    return { studySecs: 0, slackSecs: 0 };
  }
}

// ==================== 数据备份：导出 / 导入 ====================

import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as Device from 'expo-device';

/** §7.2 当前 Schema 版本 */
const CURRENT_SCHEMA_VERSION = 3;

const SALT_KEY = 'ddl_backup_salt_v1';

/** §7.1 获取（或首次创建）设备级签名盐值 */
async function getOrCreateSalt(): Promise<string> {
  try {
    const existing = await SecureStore.getItemAsync(SALT_KEY);
    if (existing) return existing;
    // 首次生成：UUID + 时间戳
    const newSalt = `${Math.random().toString(36).slice(2)}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await SecureStore.setItemAsync(SALT_KEY, newSalt);
    return newSalt;
  } catch {
    // SecureStore 不可用时降级为固定前缀（仍优于无签名）
    return 'ddl-fallback-salt-v1';
  }
}

/** §7.1 SHA256 签名：SHA256(salt "|" jsonStr) */
async function computeSignature(jsonStr: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${salt}|${jsonStr}`,
    { encoding: Crypto.CryptoEncoding.HEX },
  );
}

/** 脱敏设备指纹（SHA256 截取前 16 字符） */
async function getDeviceFingerprint(): Promise<string> {
  const raw = `${Device.modelName ?? 'unknown'}-${Device.osName ?? 'rn'}-${Device.osVersion ?? '0'}`;
  const full = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
  return full.slice(0, 16);
}

export interface BackupData {
  version: number;          // 保留字段（向后兼容旧备份）
  schema_version: number;   // §7.2 数据库 Schema 版本
  exportedAt: string;       // ISO 字符串
  device_fingerprint: string; // §7.1 脱敏设备指纹（换机检测）
  signature: string;        // §7.1 SHA256 签名
  tables: {
    tasks: Record<string, unknown>[];
    time_records: Record<string, unknown>[];
    timer_sessions: Record<string, unknown>[];
    custom_quotes: Record<string, unknown>[];
    achievements_state: Record<string, unknown>[];
  };
  asyncStorage: {
    wear: string | null;
    settings: string | null;
    penalties: string | null;
  };
  /** 兼容旧版 checksum 字段（不校验，仅忽略） */
  checksum?: number;
}

// ── §7.2 Migration 链 ─────────────────────────────────────────
const MIGRATIONS: Record<number, (data: BackupData['tables']) => BackupData['tables']> = {
  // v1 → v2：确保 timer_sessions 表存在
  1: (d) => ({ ...d, timer_sessions: d.timer_sessions ?? [] }),
  // v2 → v3：确保 custom_quotes / achievements_state 存在
  2: (d) => ({
    ...d,
    custom_quotes: d.custom_quotes ?? [],
    achievements_state: d.achievements_state ?? [],
  }),
};

function migrateData(
  tables: BackupData['tables'],
  fromVersion: number,
  toVersion: number,
): BackupData['tables'] {
  let current = tables;
  for (let v = fromVersion; v < toVersion; v++) {
    if (MIGRATIONS[v]) current = MIGRATIONS[v](current);
  }
  return current;
}

// ── §7.3 字段截断 ─────────────────────────────────────────────
const FIELD_LIMITS: Record<string, number> = {
  name: 200, title: 200, note: 1000, category: 50, text: 50, personality_title: 50,
  personality_desc: 200, assigned_date: 10,
};
const GLOBAL_LIMIT = 10 * 1024; // 10KB

function truncateStr(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return value.slice(0, maxChars - 1) + '…';
}

function sanitizeRow(row: Record<string, unknown>): { row: Record<string, unknown>; truncated: number } {
  const out: Record<string, unknown> = {};
  let truncated = 0;
  for (const [k, v] of Object.entries(row)) {
    if (typeof v !== 'string') { out[k] = v; continue; }
    const limit = FIELD_LIMITS[k] ?? GLOBAL_LIMIT;
    if (v.length > limit) {
      out[k] = truncateStr(v, limit);
      truncated++;
    } else {
      out[k] = v;
    }
  }
  return { row: out, truncated };
}

function sanitizeTables(tables: BackupData['tables']): { tables: BackupData['tables']; totalTruncated: number } {
  let totalTruncated = 0;
  const sanitize = (rows: Record<string, unknown>[]) => rows.map(r => {
    const { row, truncated } = sanitizeRow(r);
    totalTruncated += truncated;
    return row;
  });
  return {
    tables: {
      tasks: sanitize(tables.tasks),
      time_records: sanitize(tables.time_records),
      timer_sessions: sanitize(tables.timer_sessions),
      custom_quotes: sanitize(tables.custom_quotes),
      achievements_state: sanitize(tables.achievements_state),
    },
    totalTruncated,
  };
}

/** §7.4 导出任务类型 */
export type ImportConflictStrategy = 'overwrite' | 'skip' | 'rename';

/** §7.4 扫描同名冲突任务（name 匹配且未删除） */
export async function scanTitleConflicts(backup: BackupData): Promise<string[]> {
  const db = await getDb();
  const existing = await db.getAllAsync<{ name: string }>(
    `SELECT name FROM tasks WHERE completed = 0 OR completed = 1`,
  );
  const existingNames = new Set(existing.map(r => r.name));
  const backupTasks = backup.tables.tasks ?? [];
  const backupNames = backupTasks.map(t => (t.name ?? t.title) as string).filter(Boolean);
  return backupNames.filter(t => existingNames.has(t));
}

/** §7.1 导出全量数据，包含 SHA256 签名 */
export async function exportAllData(): Promise<string> {
  const db = await getDb();
  const [tasks, timeRecords, timerSessions, customQuotes, achState] = await Promise.all([
    db.getAllAsync<Record<string, unknown>>('SELECT * FROM tasks'),
    db.getAllAsync<Record<string, unknown>>('SELECT * FROM time_records'),
    db.getAllAsync<Record<string, unknown>>('SELECT * FROM timer_sessions'),
    db.getAllAsync<Record<string, unknown>>('SELECT * FROM custom_quotes').catch(() => []),
    db.getAllAsync<Record<string, unknown>>('SELECT * FROM achievements_state').catch(() => []),
  ]);

  const [wear, settings, penalties, salt, fingerprint] = await Promise.all([
    AsyncStorage.getItem('ddlife_wear_state_v1'),
    AsyncStorage.getItem('ddlife_settings'),
    AsyncStorage.getItem('ddlife_penalty_adjustments'),
    getOrCreateSalt(),
    getDeviceFingerprint(),
  ]);

  const payload: Omit<BackupData, 'signature'> = {
    version: 2,
    schema_version: CURRENT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    device_fingerprint: fingerprint,
    tables: { tasks, time_records: timeRecords, timer_sessions: timerSessions, custom_quotes: customQuotes, achievements_state: achState },
    asyncStorage: { wear, settings, penalties },
  };

  const jsonForSig = JSON.stringify(payload);
  const signature = await computeSignature(jsonForSig, salt);
  const backup: BackupData = { ...payload, signature };
  return JSON.stringify(backup, null, 2);
}

/** §7.1/§7.2 验证备份 JSON 签名 + Schema 版本，返回解析后的 BackupData 或抛出错误 */
export async function parseAndVerifyBackup(jsonStr: string): Promise<BackupData> {
  let data: BackupData;
  try {
    data = JSON.parse(jsonStr) as BackupData;
  } catch {
    throw new Error('JSON 格式错误，无法解析备份文件');
  }
  if (!data.exportedAt || !data.tables) {
    throw new Error('备份文件格式不正确，缺少必要字段');
  }

  // §7.2 Schema 版本校验
  const backupSchema = data.schema_version ?? data.version ?? 1;
  if (backupSchema > CURRENT_SCHEMA_VERSION) {
    throw new Error(`备份版本过新（v${backupSchema}），请升级 App 后重试`);
  }

  // §7.1 签名校验（旧版 checksum 备份跳过签名校验）
  if (data.signature) {
    const currentFingerprint = await getDeviceFingerprint();
    const isSameDevice = data.device_fingerprint === currentFingerprint;
    if (isSameDevice) {
      // 同设备：严格签名校验
      const salt = await getOrCreateSalt();
      const { signature, ...rest } = data;
      const expected = await computeSignature(JSON.stringify(rest), salt);
      if (signature !== expected) {
        throw new Error('备份文件可能已被篡改或损坏，麻糬不敢导入哦~ 🍡');
      }
    }
    // 换机：跳过签名，仅做格式校验（salt 不同，无法验证）
  }

  return data;
}

/**
 * §7.4 将备份数据导入数据库
 * strategy:
 *   'overwrite' — 同名任务用备份版本替换（按 title 匹配）
 *   'skip'      — 跳过同名任务，保留现有
 *   'rename'    — 同名任务加日期后缀后导入
 */
export async function importAllData(
  backup: BackupData,
  strategy: ImportConflictStrategy = 'overwrite',
): Promise<{ imported: number; skipped: number; truncated: number }> {
  const db = await getDb();
  let imported = 0;
  let skipped = 0;

  // §7.2 Migration
  const backupSchema = backup.schema_version ?? backup.version ?? 1;
  const migratedTables = migrateData(backup.tables, backupSchema, CURRENT_SCHEMA_VERSION);

  // §7.3 字段截断
  const { tables, totalTruncated } = sanitizeTables(migratedTables);

  // §7.4 同名任务集合（name → existing row）
  const existingTasks = await db.getAllAsync<{ id: string; name: string }>(
    'SELECT id, name FROM tasks',
  );
  const existingByName = new Map(existingTasks.map(t => [t.name, t.id]));

  const suffix = `_备份_${backup.exportedAt.slice(0, 10).replace(/-/g, '')}`;

  /** 通用 upsert */
  async function upsertRows(table: string, rows: Record<string, unknown>[]) {
    for (const row of rows) {
      try {
        const cols = Object.keys(row);
        if (cols.length === 0) continue;
        const placeholders = cols.map(() => '?').join(', ');
        const updates = cols.map(c => `${c} = excluded.${c}`).join(', ');
        const values = cols.map(c => row[c]) as import('expo-sqlite').SQLiteBindValue[];
        await db.runAsync(
          `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})
           ON CONFLICT(id) DO UPDATE SET ${updates}`,
          values,
        );
        imported++;
      } catch { skipped++; }
    }
  }

  // §7.4 按策略处理 tasks（SQLite 事务包裹保证原子性）
  await db.execAsync('BEGIN TRANSACTION');
  try {
    for (const rawRow of tables.tasks) {
      const row = { ...rawRow };
      const taskName = (row.name ?? row.title ?? '未命名任务') as string;
      row.name = taskName;
      delete row.title;
      const conflictId = existingByName.get(taskName);

      if (conflictId) {
        if (strategy === 'skip') {
          skipped++;
          continue;
        } else if (strategy === 'overwrite') {
          // 保留现有 id，更新其他字段
          row.id = conflictId;
        } else if (strategy === 'rename') {
          const maxBase = 200 - suffix.length;
          row.name = (taskName.length > maxBase ? taskName.slice(0, maxBase) + '…' : taskName) + suffix;
          // 新 id，避免与任何行冲突
          row.id = `${String(row.id ?? '')}_ren_${Date.now()}`;
        }
      }

      try {
        const cols = Object.keys(row);
        const ph = cols.map(() => '?').join(', ');
        const vals = cols.map(c => row[c]) as import('expo-sqlite').SQLiteBindValue[];
        await db.runAsync(
          `INSERT INTO tasks (${cols.join(', ')}) VALUES (${ph})
           ON CONFLICT(id) DO UPDATE SET ${cols.filter(c => c !== 'id').map(c => `${c} = excluded.${c}`).join(', ')}`,
          vals,
        );
        imported++;
      } catch { skipped++; }
    }

    await upsertRows('time_records', tables.time_records);
    await upsertRows('timer_sessions', tables.timer_sessions);
    await upsertRows('custom_quotes', tables.custom_quotes);
    await upsertRows('achievements_state', tables.achievements_state);

    await db.execAsync('COMMIT');
  } catch (e) {
    await db.execAsync('ROLLBACK');
    throw e;
  }

  // 恢复 AsyncStorage
  const { wear, settings, penalties } = backup.asyncStorage;
  if (wear)      await AsyncStorage.setItem('ddlife_wear_state_v1', wear);
  if (settings)  await AsyncStorage.setItem('ddlife_settings', settings);
  if (penalties) await AsyncStorage.setItem('ddlife_penalty_adjustments', penalties);

  return { imported, skipped, truncated: totalTruncated };
}

/**
 * 检测系统时间是否被倒拨（PRD §4.17 时光倒流防御）
 * 逻辑：当前时间 < 上次记录时间 - TOLERANCE_MS 即视为时间倒退
 * @returns true = 检测到时光倒流，需阻断写入
 */
const TIME_REVERSE_TOLERANCE_MS = 60_000; // 60 秒容差，处理小幅时钟漂移

export async function detectTimeReversal(): Promise<boolean> {
  try {
    const lastKnown = await loadLastKnownTs();
    if (lastKnown === 0) {
      // 首次启动，无历史记录，直接写入当前时间并放行
      await saveLastKnownTs();
      return false;
    }
    const now = Date.now();
    if (now < lastKnown - TIME_REVERSE_TOLERANCE_MS) {
      return true; // 时光倒流！
    }
    // 时间正常：更新最近可信时间戳
    await saveLastKnownTs();
    return false;
  } catch {
    return false; // 出错时放行，不影响正常使用
  }
}

// ==================== 历史卡片收藏（SPEC §5.2）====================

/** 查询某日卡片是否已收藏 */
export async function isCardFavorite(date: string): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ date: string }>(
    `SELECT date FROM card_favorites WHERE date = ?`, date,
  );
  return !!row;
}

/** 收藏卡片 */
export async function addCardFavorite(date: string, note?: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR IGNORE INTO card_favorites(date, favorited_at, note) VALUES(?, ?, ?)`,
    date, Math.floor(Date.now() / 1000), note ?? null,
  );
}

/** 取消收藏 */
export async function removeCardFavorite(date: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM card_favorites WHERE date = ?`, date);
}

/** 切换收藏状态，返回操作后的状态（true = 已收藏） */
export async function toggleCardFavorite(date: string): Promise<boolean> {
  const fav = await isCardFavorite(date);
  if (fav) {
    await removeCardFavorite(date);
    return false;
  } else {
    await addCardFavorite(date);
    return true;
  }
}

/** 获取所有收藏日期列表（降序） */
export async function getAllCardFavorites(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ date: string }>(
    `SELECT date FROM card_favorites ORDER BY favorited_at DESC`,
  );
  return rows.map(r => r.date);
}
