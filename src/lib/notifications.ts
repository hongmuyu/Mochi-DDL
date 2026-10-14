import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Task } from '@/types/types';
import { getDangerLabel, getDangerLevel } from './ddl';
import { getNotifDenyCount, incrementNotifDenyCount } from '@/db/api';

// Android 8+ 必须显式创建 NotificationChannel，否则推送静默失败
const ANDROID_CHANNEL_ID = 'ddl_alerts';
if (Platform.OS === 'android') {
  Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'DDL 预警',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#FF003C',
  }).catch(() => undefined); // 静默处理（channel 已存在时无副作用）
}

// 通知显示配置
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * 请求通知权限，返回是否已获得授权。
 * PRD §4.19 Level 2：连续3次拒绝后不再主动弹窗，静默返回 false。
 */
export async function requestNotificationPermission(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  // Level 2：累计拒绝 ≥3 次，不再弹窗
  const denyCount = await getNotifDenyCount();
  if (denyCount >= 3) return false;
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') {
    // 每次拒绝后递增计数
    await incrementNotifDenyCount();
  }
  return status === 'granted';
}

/**
 * 检查通知权限状态
 */
export async function getNotificationPermissionStatus(): Promise<string> {
  const { status } = await Notifications.getPermissionsAsync();
  return status;
}

/**
 * 为单个 DDL 任务调度多级本地推送通知（含心理截止与自定义提醒）
 * 通知 identifier 格式：ddl_{taskId}_{label}
 */
export async function scheduleTaskNotifications(task: Task): Promise<{ scheduledCount: number }> {
  const deadlineMs = new Date(task.deadline).getTime();
  const now = Date.now();
  let scheduledCount = 0;

  // 1. 标准多级预警检查点
  const checkpoints: Array<{ label: string; triggerMs: number; title: string; body: string }> = [
    {
      label: '24h',
      triggerMs: deadlineMs - 24 * 60 * 60 * 1000,
      title: 'DDLife ⚠️ 明日截止提醒',
      body: `📅 命运预告｜【${task.name}】距离最终死线还有 24 小时，做好冲刺准备！`,
    },
    {
      label: '6h',
      triggerMs: deadlineMs - 6 * 60 * 60 * 1000,
      title: 'DDLife 🔥 紧急预警',
      body: `⚡ 命运预告｜【${task.name}】还有 6 小时！已进入紧急戒备状态，快开启专注吧！`,
    },
    {
      label: '1h',
      triggerMs: deadlineMs - 1 * 60 * 60 * 1000,
      title: 'DDLife 🚨 致命最后1小时',
      body: `💀 命运预告｜【${task.name}】只剩最后 1 小时！死线大魔王正在靠近，冲鸭！`,
    },
  ];

  // 2. 自定义提醒检查点
  if (task.reminder_offset && task.reminder_offset > 0) {
    const customOffsetMs = task.reminder_offset * 60 * 1000;
    const offsetDesc = task.reminder_offset >= 1440
      ? `${Math.floor(task.reminder_offset / 1440)} 天`
      : task.reminder_offset >= 60
      ? `${Math.floor(task.reminder_offset / 60)} 小时`
      : `${task.reminder_offset} 分钟`;
    checkpoints.push({
      label: `custom_${task.reminder_offset}m`,
      triggerMs: deadlineMs - customOffsetMs,
      title: 'DDLife ⏰ 自定义提醒',
      body: `⏰ 准时提醒｜【${task.name}】距离死线还有 ${offsetDesc}，按计划执行哦！`,
    });
  }

  // 3. 心理提前截止检查点
  if (task.cutoff_deadline) {
    const cutoffMs = new Date(task.cutoff_deadline).getTime();
    if (cutoffMs > now && cutoffMs < deadlineMs) {
      checkpoints.push({
        label: 'cutoff',
        triggerMs: cutoffMs,
        title: 'DDLife 🎯 心理提前截止到了',
        body: `🎯 目标达成提醒｜【${task.name}】你设定的心理截止时间到了！提前交卷不熬夜～`,
      });
    }
  }

  for (const cp of checkpoints) {
    if (cp.triggerMs <= now) continue; // 时间已过，跳过

    const identifier = `ddl_${task.id}_${cp.label}`;
    // 先取消旧通知（避免重复）
    await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => undefined);

    await Notifications.scheduleNotificationAsync({
      identifier,
      content: {
        title: cp.title,
        body: cp.body,
        sound: true,
        data: { taskId: task.id },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(cp.triggerMs),
        channelId: ANDROID_CHANNEL_ID,
      },
    }).catch(() => undefined);

    scheduledCount++;
  }

  return { scheduledCount };
}

/**
 * 取消某个任务的所有待推送通知（任务完成/删除/取消时调用）
 */
export async function cancelTaskNotifications(taskId: string): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const prefix = `ddl_${taskId}_`;
    const targetIds = scheduled
      .map(n => n.identifier)
      .filter(id => id.startsWith(prefix));

    await Promise.all(
      targetIds.map(id => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined))
    );
  } catch {
    // 降级硬取消常见 ID
    await Promise.all([
      Notifications.cancelScheduledNotificationAsync(`ddl_${taskId}_24h`).catch(() => undefined),
      Notifications.cancelScheduledNotificationAsync(`ddl_${taskId}_6h`).catch(() => undefined),
      Notifications.cancelScheduledNotificationAsync(`ddl_${taskId}_1h`).catch(() => undefined),
      Notifications.cancelScheduledNotificationAsync(`ddl_${taskId}_cutoff`).catch(() => undefined),
    ]);
  }
}

/**
 * 批量同步所有任务的通知（启动时/任务变更时调用）
 */
export async function syncAllNotifications(tasks: Task[]): Promise<void> {
  const permitted = await requestNotificationPermission();
  if (!permitted) return;

  const activeTasks = tasks.filter(t => !t.completed && new Date(t.deadline).getTime() > Date.now());

  // 完成的任务：取消通知
  const completedTasks = tasks.filter(t => t.completed);
  for (const task of completedTasks) {
    await cancelTaskNotifications(task.id);
  }

  // 活跃任务：调度/更新通知
  for (const task of activeTasks) {
    await scheduleTaskNotifications(task);
  }
}
