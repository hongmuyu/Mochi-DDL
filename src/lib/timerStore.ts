/**
 * 计时器持久化存储（AsyncStorage）
 * 实现后台运行 + App被杀后恢复的"差值法"
 *
 * 存储结构：
 *   TIMER_TYPE         "study" | "slack"
 *   TIMER_START_TS     毫秒级 Unix 时间戳（最近一次开始/恢复的时刻）
 *   TIMER_ACCUM_SECS   在当前段开始前已经累计的秒数（暂停后继续时累积）
 *   TIMER_PAUSED       "1" = 暂停中，此时 START_TS 无意义
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const K_TYPE  = 'ddl_timer_type';
const K_START = 'ddl_timer_start_ts';
const K_ACCUM = 'ddl_timer_accum_secs';
const K_PAUSED = 'ddl_timer_paused';

export type ActiveTimerType = 'study' | 'slack' | 'sleep';

export interface TimerSession {
  type: ActiveTimerType;
  /** 最近一次按下「开始/继续」时的毫秒时间戳 */
  startTs: number;
  /** 本次会话在当前段开始前已累计的秒数（暂停后继续时累积） */
  accumSecs: number;
  paused: boolean;
}

/** 保存计时会话到 AsyncStorage */
export async function saveTimerSession(session: TimerSession): Promise<void> {
  await AsyncStorage.multiSet([
    [K_TYPE,   session.type],
    [K_START,  String(session.startTs)],
    [K_ACCUM,  String(session.accumSecs)],
    [K_PAUSED, session.paused ? '1' : '0'],
  ]);
}

/** 从 AsyncStorage 恢复计时会话，不存在则返回 null */
export async function restoreTimerSession(): Promise<TimerSession | null> {
  const pairs = await AsyncStorage.multiGet([K_TYPE, K_START, K_ACCUM, K_PAUSED]);
  const map = Object.fromEntries(pairs.map(([k, v]) => [k, v]));

  const type = map[K_TYPE] as ActiveTimerType | null;
  if (!type || (type !== 'study' && type !== 'slack' && type !== 'sleep')) return null;

  const startTs  = Number(map[K_START]  ?? '0');
  const accumSecs = Number(map[K_ACCUM]  ?? '0');
  const paused   = map[K_PAUSED] === '1';

  if (!startTs && !paused) return null; // 无有效会话

  return { type, startTs, accumSecs, paused };
}

/** 清除计时会话（停止后调用） */
export async function clearTimerSession(): Promise<void> {
  await AsyncStorage.multiRemove([K_TYPE, K_START, K_ACCUM, K_PAUSED]);
}

/**
 * 根据会话数据计算当前总已过秒数
 * - 若暂停中：直接返回 accumSecs
 * - 若运行中：accumSecs + (now - startTs) / 1000
 */
export function calcElapsedSecs(session: TimerSession, nowMs = Date.now()): number {
  if (session.paused) return session.accumSecs;
  return session.accumSecs + Math.floor((nowMs - session.startTs) / 1000);
}

/**
 * 将一段时长（秒）按日期边界拆分，支持自定义日切点（cutoffHour 0-6）
 * 例如 cutoffHour=4，则每天的"日期"从凌晨4:00开始
 * 从 2026-05-13 23:50 开始跑了 20 分钟（cutoff=4），
 * 则返回 [{ date: '2026-05-13', secs: 600 }, { date: '2026-05-14', secs: 600 }]
 */
export function splitSecsByDate(
  startTs: number,
  totalSecs: number,
  cutoffHour = 4,
): Array<{ date: string; secs: number }> {
  const result: Array<{ date: string; secs: number }> = [];
  let remaining = totalSecs;
  let cursor = startTs;

  while (remaining > 0) {
    const d = new Date(cursor);
    const h = d.getHours();

    // 当前时间所属的"逻辑日期"（cutoffHour之前归前一天）
    let logicDate: Date;
    if (h < cutoffHour) {
      logicDate = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
    } else {
      logicDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
    const dateStr = `${logicDate.getFullYear()}-${String(logicDate.getMonth() + 1).padStart(2, '0')}-${String(logicDate.getDate()).padStart(2, '0')}`;

    // 下一个日切点时刻（次日 cutoffHour:00:00）
    const nextCutoff = new Date(
      logicDate.getFullYear(),
      logicDate.getMonth(),
      logicDate.getDate() + 1,
      cutoffHour,
      0,
      0,
      0,
    ).getTime();

    const secsUntilCutoff = Math.floor((nextCutoff - cursor) / 1000);
    const secsThisDay = Math.min(remaining, secsUntilCutoff);

    if (secsThisDay > 0) {
      const existing = result.find(r => r.date === dateStr);
      if (existing) existing.secs += secsThisDay;
      else result.push({ date: dateStr, secs: secsThisDay });
    }

    remaining -= secsThisDay;
    cursor = nextCutoff;
  }

  return result;
}
