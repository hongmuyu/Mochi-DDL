import AsyncStorage from '@react-native-async-storage/async-storage';
import { Task, TimeRecord } from '../types/types';

// 成就定义
export interface Achievement {
  id: string;
  emoji: string;       // 贴纸emoji
  title: string;       // 成就名称
  condition: string;   // 解锁说明
  unlocked: boolean;
  unlockedAt?: string;
}

const STORAGE_KEY = 'ddlife_achievements_v1';

// 全部成就定义
export const ACHIEVEMENT_DEFS: Omit<Achievement, 'unlocked' | 'unlockedAt'>[] = [
  {
    id: 'night_owl',
    emoji: '🌙',
    title: '阴间作息',
    condition: '连续3天熬夜（睡眠不足6小时）',
  },
  {
    id: 'last_minute',
    emoji: '⚡',
    title: '极限施法',
    condition: '所有任务均在红温状态下完成',
  },
  {
    id: 'slack_god',
    emoji: '📦',
    title: '工位流浪汉',
    condition: '单日摸鱼时间超过8小时',
  },
  {
    id: 'full_lay_flat',
    emoji: '🛋️',
    title: '战略性摆烂',
    condition: '连续一周无任务完成',
  },
  {
    id: 'midnight_coder',
    emoji: '🦇',
    title: '深夜赶稿侠',
    condition: '凌晨3点后仍有未完成DDL',
  },
  {
    id: 'ddl_collector',
    emoji: '💀',
    title: 'DDL收藏家',
    condition: '同时持有5个及以上待处理DDL',
  },
  {
    id: 'zero_sleep',
    emoji: '☕',
    title: '续命咖啡桶',
    condition: '记录睡眠时间为0小时',
  },
  {
    id: 'speed_run',
    emoji: '🏃',
    title: '人形加速器',
    condition: '在1小时内完成所有DDL',
  },
  {
    id: 'endless_demerit',
    emoji: '📿',
    title: '修不完的功德',
    condition: '功德值低于 -100，业力已失控',
  },
];

// 加载成就状态
export async function loadAchievements(): Promise<Achievement[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const saved: Record<string, { unlockedAt: string }> = raw ? JSON.parse(raw) : {};
    return ACHIEVEMENT_DEFS.map(def => ({
      ...def,
      unlocked: !!saved[def.id],
      unlockedAt: saved[def.id]?.unlockedAt,
    }));
  } catch {
    return ACHIEVEMENT_DEFS.map(def => ({ ...def, unlocked: false }));
  }
}

// 解锁成就
async function unlock(id: string): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const saved: Record<string, { unlockedAt: string }> = raw ? JSON.parse(raw) : {};
    if (saved[id]) return false; // 已解锁
    saved[id] = { unlockedAt: new Date().toISOString() };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    return true;
  } catch {
    return false;
  }
}

// 检查并解锁所有成就，返回新解锁的成就列表
export async function checkAndUnlockAchievements(
  tasks: Task[],
  recentRecords: TimeRecord[],
  currentHour?: number,
  meritPoints?: number,
): Promise<Achievement[]> {
  const newlyUnlocked: Achievement[] = [];
  const activeTasks = tasks.filter(t => !t.completed);
  const completedTasks = tasks.filter(t => t.completed);

  // 工位流浪汉：单日摸鱼>8小时
  const todayRec = recentRecords[0];
  if (todayRec && todayRec.slack_minutes >= 480) {
    if (await unlock('slack_god')) {
      newlyUnlocked.push({ ...ACHIEVEMENT_DEFS.find(a => a.id === 'slack_god')!, unlocked: true, unlockedAt: new Date().toISOString() });
    }
  }

  // 阴间作息：最近3天睡眠均<6h
  if (recentRecords.length >= 3 && recentRecords.slice(0, 3).every(r => r.sleep_hours < 6)) {
    if (await unlock('night_owl')) {
      newlyUnlocked.push({ ...ACHIEVEMENT_DEFS.find(a => a.id === 'night_owl')!, unlocked: true, unlockedAt: new Date().toISOString() });
    }
  }

  // 续命咖啡桶：睡眠=0
  if (todayRec && todayRec.sleep_hours === 0 && todayRec.study_minutes + todayRec.slack_minutes > 60) {
    if (await unlock('zero_sleep')) {
      newlyUnlocked.push({ ...ACHIEVEMENT_DEFS.find(a => a.id === 'zero_sleep')!, unlocked: true, unlockedAt: new Date().toISOString() });
    }
  }

  // DDL收藏家：同时5个+待处理任务
  if (activeTasks.length >= 5) {
    if (await unlock('ddl_collector')) {
      newlyUnlocked.push({ ...ACHIEVEMENT_DEFS.find(a => a.id === 'ddl_collector')!, unlocked: true, unlockedAt: new Date().toISOString() });
    }
  }

  // 深夜赶稿侠：凌晨3点后有未完成DDL
  if ((currentHour ?? new Date().getHours()) >= 3 && (currentHour ?? new Date().getHours()) <= 5 && activeTasks.length > 0) {
    if (await unlock('midnight_coder')) {
      newlyUnlocked.push({ ...ACHIEVEMENT_DEFS.find(a => a.id === 'midnight_coder')!, unlocked: true, unlockedAt: new Date().toISOString() });
    }
  }

  // 战略性摆烂：7天内无任务完成（有任务但全部active）
  if (recentRecords.length >= 7 && completedTasks.length === 0 && activeTasks.length > 0) {
    if (await unlock('full_lay_flat')) {
      newlyUnlocked.push({ ...ACHIEVEMENT_DEFS.find(a => a.id === 'full_lay_flat')!, unlocked: true, unlockedAt: new Date().toISOString() });
    }
  }

  // 修不完的功德：功德值低于 -100
  if ((meritPoints ?? 0) < -100) {
    if (await unlock('endless_demerit')) {
      newlyUnlocked.push({ ...ACHIEVEMENT_DEFS.find(a => a.id === 'endless_demerit')!, unlocked: true, unlockedAt: new Date().toISOString() });
    }
  }

  // 极限施法：所有已完成任务均为压线完成（completed_at 在 deadline 前1小时内，或已过期后补完成）
  if (completedTasks.length >= 2) {
    const rushOrOvertime = completedTasks.filter(t => {
      if (!t.completed_at) return false;
      const deadlineTs = new Date(t.deadline).getTime();
      const completedTs = new Date(t.completed_at).getTime();
      // 压线：完成时距 deadline 不足 1 小时，或超期后补完成
      return completedTs > deadlineTs - 3600 * 1000;
    });
    if (rushOrOvertime.length === completedTasks.length) {
      if (await unlock('last_minute')) {
        newlyUnlocked.push({ ...ACHIEVEMENT_DEFS.find(a => a.id === 'last_minute')!, unlocked: true, unlockedAt: new Date().toISOString() });
      }
    }
  }

  // 人形加速器：在最近1小时内完成了至少2个任务
  const oneHourAgo = Date.now() - 3600 * 1000;
  const recentCompleted = completedTasks.filter(t => t.completed_at && new Date(t.completed_at).getTime() >= oneHourAgo);
  if (recentCompleted.length >= 2) {
    if (await unlock('speed_run')) {
      newlyUnlocked.push({ ...ACHIEVEMENT_DEFS.find(a => a.id === 'speed_run')!, unlocked: true, unlockedAt: new Date().toISOString() });
    }
  }

  return newlyUnlocked;
}
