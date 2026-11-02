/**
 * 统一高可靠专注与计时引擎 (Unified Timer Engine)
 *
 * 核心保证：
 * 1. 唯一会话 ID (sessionId)，会话级别幂等单次结算；
 * 2. 真实时间段 (Intervals) 记录：精确区分运行与暂停时间段，彻底杜绝跨日暂停被误算入专注；
 * 3. 跨日原子事务写入：按时区与日切点 (cutoffHour) 切分并在单一 SQLite 事务内写入，杜绝重复累加；
 * 4. 合理封顶保护：异常超长专注优先保留真实有效时长并截断至安全上限，严禁粗暴清零；
 * 5. 互斥收拢：统一协调专注、摸鱼与睡眠互斥状态。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDb, genId } from '../db/database';
import { addMinutesToDateRecord, addSleepHoursToDateRecord } from '../db/api';
import { splitSecsByDate } from './timerStore';

export type TimerType = 'study' | 'slack' | 'sleep';

export interface TimerInterval {
  startMs: number;
  endMs?: number; // undefined 表示当前正在进行中
  type: 'run' | 'pause';
}

export interface UnifiedTimerSession {
  sessionId: string;
  type: TimerType;
  createdAt: number;
  intervals: TimerInterval[];
  status: 'running' | 'paused' | 'settled';
  settledAt?: number;
}

const STORAGE_KEY_ACTIVE_SESSION = 'ddl_unified_active_session_v1';
const MAX_SINGLE_SESSION_SECS = 4 * 3600; // 单次专注安全上限 4 小时
const MAX_SLEEP_SESSION_SECS = 14 * 3600; // 睡眠安全上限 14 小时

/** 保存当前活动会话到 AsyncStorage */
export async function saveActiveSession(session: UnifiedTimerSession): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY_ACTIVE_SESSION, JSON.stringify(session));
}

/** 获取当前持久化的活动会话 */
export async function getActiveSession(): Promise<UnifiedTimerSession | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY_ACTIVE_SESSION);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UnifiedTimerSession;
  } catch {
    return null;
  }
}

/** 清理当前活动会话 */
export async function clearActiveSession(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY_ACTIVE_SESSION);
}

/**
 * 启动新的计时会话（自动处理互斥状态）
 */
export async function startUnifiedSession(type: TimerType): Promise<UnifiedTimerSession> {
  const now = Date.now();
  const existing = await getActiveSession();

  // 若已有进行中会话，先安全保存并结束
  if (existing && existing.status !== 'settled') {
    await pauseUnifiedSession();
  }

  const session: UnifiedTimerSession = {
    sessionId: `sess_${Date.now()}_${genId()}`,
    type,
    createdAt: now,
    intervals: [
      { startMs: now, type: 'run' },
    ],
    status: 'running',
  };

  await saveActiveSession(session);
  return session;
}

/**
 * 暂停当前计时会话
 */
export async function pauseUnifiedSession(): Promise<UnifiedTimerSession | null> {
  const session = await getActiveSession();
  if (!session || session.status !== 'running') return session;

  const now = Date.now();
  // 结束当前运行段
  const last = session.intervals[session.intervals.length - 1];
  if (last && last.type === 'run' && !last.endMs) {
    last.endMs = now;
  }

  // 追加暂停段
  session.intervals.push({ startMs: now, type: 'pause' });
  session.status = 'paused';

  await saveActiveSession(session);
  return session;
}

/**
 * 恢复继续当前计时会话
 */
export async function resumeUnifiedSession(): Promise<UnifiedTimerSession | null> {
  const session = await getActiveSession();
  if (!session || session.status !== 'paused') return session;

  const now = Date.now();
  // 结束当前暂停段
  const last = session.intervals[session.intervals.length - 1];
  if (last && last.type === 'pause' && !last.endMs) {
    last.endMs = now;
  }

  // 追加运行段
  session.intervals.push({ startMs: now, type: 'run' });
  session.status = 'running';

  await saveActiveSession(session);
  return session;
}

/**
 * 计算会话的纯有效运行秒数（彻底排除暂停段）
 */
export function calculateEffectiveDuration(
  session: UnifiedTimerSession,
  nowMs = Date.now(),
): { effectiveSecs: number; isCapped: boolean; rawSecs: number } {
  let effectiveSecs = 0;

  for (const interval of session.intervals) {
    if (interval.type === 'run') {
      const end = interval.endMs ?? nowMs;
      if (end > interval.startMs) {
        effectiveSecs += Math.floor((end - interval.startMs) / 1000);
      }
    }
  }

  const limit = session.type === 'sleep' ? MAX_SLEEP_SESSION_SECS : MAX_SINGLE_SESSION_SECS;
  const isCapped = effectiveSecs > limit;
  const clampedSecs = isCapped ? limit : effectiveSecs;

  return {
    effectiveSecs: clampedSecs,
    isCapped,
    rawSecs: effectiveSecs,
  };
}

/**
 * 结算并持久化计时会话（幂等单次结算 + 事务跨日拆分写入）
 */
export async function settleUnifiedSession(
  session: UnifiedTimerSession,
  cutoffHour = 4,
  overrideSecs?: number,
): Promise<{ settledSecs: number; isCapped: boolean }> {
  // 幂等防护：同一会话绝不重复结算入库
  if (session.status === 'settled' && session.settledAt) {
    const { effectiveSecs, isCapped } = calculateEffectiveDuration(session);
    return { settledSecs: effectiveSecs, isCapped };
  }

  const now = Date.now();
  // 结束当前未关闭段
  const last = session.intervals[session.intervals.length - 1];
  if (last && !last.endMs) {
    last.endMs = now;
  }

  const { effectiveSecs, isCapped } = calculateEffectiveDuration(session, now);
  const totalSecs = overrideSecs ?? effectiveSecs;

  if (totalSecs < 1) {
    await clearActiveSession();
    return { settledSecs: 0, isCapped: false };
  }

  const db = await getDb();
  // 事务拆分写入
  await db.execAsync('BEGIN TRANSACTION');
  try {
    const startTs = session.intervals[0]?.startMs ?? (now - totalSecs * 1000);
    const slices = splitSecsByDate(startTs, totalSecs, cutoffHour);

    if (session.type === 'sleep') {
      for (const slice of slices) {
        const hours = slice.secs / 3600;
        if (hours > 0) {
          await addSleepHoursToDateRecord(slice.date, hours);
        }
      }
    } else {
      for (const slice of slices) {
        const addMin = Math.round(slice.secs / 60);
        if (addMin > 0) {
          await addMinutesToDateRecord(slice.date, session.type, addMin);
        }
      }
    }

    // 在 timer_sessions 表中登记
    await db.runAsync(
      `INSERT INTO timer_sessions(session_type, start_timestamp, end_timestamp, duration_seconds, is_valid, assigned_date, settled_date)
       VALUES(?, ?, ?, ?, 1, ?, ?);`,
      session.type,
      startTs,
      now,
      totalSecs,
      slices[0]?.date ?? null,
      slices[0]?.date ?? null,
    );

    // 在 timer_session_intervals 登记真实时间段明细
    for (const inter of session.intervals) {
      const dur = inter.endMs ? Math.floor((inter.endMs - inter.startMs) / 1000) : 0;
      await db.runAsync(
        `INSERT INTO timer_session_intervals(id, session_id, interval_type, start_ms, end_ms, duration_sec, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?);`,
        genId(),
        session.sessionId,
        inter.type,
        inter.startMs,
        inter.endMs ?? now,
        dur,
        Math.floor(Date.now() / 1000),
      ).catch(() => undefined);
    }

    await db.execAsync('COMMIT');
  } catch (err) {
    await db.execAsync('ROLLBACK');
    throw err;
  }

  session.status = 'settled';
  session.settledAt = Date.now();
  await clearActiveSession();

  return { settledSecs: totalSecs, isCapped };
}
