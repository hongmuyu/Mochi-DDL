import { SpiritState, Task, TimeRecord, WearState, effectiveSlackMinutes, effectiveStudyMinutes } from '../types/types';
import { getDangerLevel, getTimeRemaining } from './ddl';

/**
 * 优先级权重系数：影响未完成DDL对HP的扣减力度
 * 低优先级×1.0 / 中×1.5 / 高×2.0
 */
export function getPriorityWeight(priority: 1 | 2 | 3): number {
  if (priority === 3) return 2.0; // 高优先级
  if (priority === 2) return 1.5; // 中优先级
  return 1.0;                    // 低优先级
}

/**
 * 计算今日生命值（不含磨损）
 * 公式：80 - lateHours×5 - Σ(未完成DDL×8×优先级权重) - slackHours×2 + studyHours×3
 * lateHours = max(0, 8 - sleep_hours)（PRD §4.21 精算表：8小时以下才算熬夜）
 */
export function calcDailyHP(
  tasks: Task[],
  record: TimeRecord | null,
): number {
  const activeTasks = tasks.filter(t => !t.completed);
  const sleepHours  = record?.sleep_hours ?? 7;
  const slackHours  = (record ? effectiveSlackMinutes(record) : 0) / 60;
  const studyHours  = (record ? effectiveStudyMinutes(record) : 0) / 60;
  // PRD §4.21：熬夜小时 = max(0, 8 - sleep_hours)，8h以下才算熬夜
  const lateHours   = Math.max(0, 8 - sleepHours);
  const ddlPenalty  = activeTasks.reduce((sum, t) => sum + 8 * getPriorityWeight(t.priority), 0);
  return 80 - lateHours * 5 - ddlPenalty - slackHours * 2 + studyHours * 3;
}

/**
 * 计算今日磨损值（PRD §4.21 精算表）
 * - todayRawHP < 30 → wear 增加 (30 - hp)，上限 clamp 0-100
 * - todayRawHP >= 80 → wear 衰减 0.9，下限 0
 */
export function calcDailyWear(prevWear: number, todayRawHP: number): number {
  if (todayRawHP < 30) return Math.min(100, prevWear + (30 - todayRawHP));
  if (todayRawHP >= 80) return Math.max(0, prevWear * 0.9);
  return prevWear;
}

/**
 * 计算理智值（当日）
 * 公式：80 - sleeplessDays×8 - redDdlCount×12 - slackHours×1.5 + studyHours×2，clamp 0-100
 */
export function calcDailySAN(
  tasks: Task[],
  record: TimeRecord | null,
  sleeplessDays: number,
): number {
  const activeTasks = tasks.filter(t => !t.completed && getTimeRemaining(t.deadline) > 0);
  const redTasks    = activeTasks.filter(t => ['critical', 'dying'].includes(getDangerLevel(t.deadline)));
  const slackHours  = (record ? effectiveSlackMinutes(record) : 0) / 60;
  const studyHours  = (record ? effectiveStudyMinutes(record) : 0) / 60;
  const raw = 80 - sleeplessDays * 8 - redTasks.length * 12 - slackHours * 1.5 + studyHours * 2;
  return Math.max(0, Math.min(100, raw));
}

/**
 * 计算当日功德值增量（非累计）PRD §4.21 精算表
 *
 * 三种完成类型互斥（completion_type 优先，旧字段兜底）：
 *   on_time  → +5（按时完成，剩余 > 1h）
 *   rush     → -3（压线完成，剩余 ≤ 1h，不叠加 on_time 的 +5）
 *   overtime → -10（超时补完成）
 *
 * 其他：摸鱼 > 8h → -20；学习 > 4h → +2
 */
export function calcDailyKarmaDelta(
  tasks: Task[],
  record: TimeRecord | null,
): number {
  const completedToday = tasks.filter(t => {
    if (!t.completed || !t.completed_at) return false;
    if (!record) return false;
    return t.completed_at.startsWith(record.record_date);
  });

  let onTimeCount  = 0;
  let rushCount    = 0;
  let overtimeCount = 0;

  for (const t of completedToday) {
    if (t.completion_type === 'on_time') {
      onTimeCount++;
    } else if (t.completion_type === 'rush') {
      rushCount++;
    } else if (t.completion_type === 'overtime' || t.is_overtime_complete) {
      overtimeCount++;
    } else {
      // 旧数据无 completion_type：用时间差兼容推导
      if (!t.is_overtime_complete && t.completed_at) {
        const diff = new Date(t.deadline).getTime() - new Date(t.completed_at).getTime();
        if (diff >= 0 && diff <= 3600 * 1000) {
          rushCount++;
        } else if (diff > 3600 * 1000) {
          onTimeCount++;
        }
      }
    }
  }

  const heavySlack = record && effectiveSlackMinutes(record) > 8 * 60 ? 1 : 0;
  const longStudy  = record && effectiveStudyMinutes(record) > 4 * 60 ? 1 : 0;

  return onTimeCount * 5
    - rushCount * 3
    - overtimeCount * 10
    - heavySlack * 20
    + longStudy * 2;
}

/**
 * 组合：单日完整结算，供惰性结算 / 增量重算共用
 * 返回 { hp, san, newWear, karma(增量) }
 */
export function calcDayFull(
  record: TimeRecord | null,
  tasks: Task[],
  prevWear: number,
  sleeplessDays: number,
): { hp: number; san: number; newWear: number; karma: number } {
  const rawHP   = calcDailyHP(tasks, record);
  const newWear = calcDailyWear(prevWear, rawHP);
  const wearPenalty = Math.min(40, newWear * 0.5);
  const hp  = Math.max(0, Math.min(100, rawHP - wearPenalty));
  const san = calcDailySAN(tasks, record, sleeplessDays);
  const karma = calcDailyKarmaDelta(tasks, record);
  return { hp: Math.round(hp), san: Math.round(san), newWear: Math.round(newWear * 10) / 10, karma };
}

/**
 * 计算精神状态数值（双轨制：磨损值 + 今日值）
 *
 * 生命值（今日）= 80 - (熬夜小时×5) - Σ(未完成DDL × 8 × 优先级权重) - (摸鱼小时×2) + (学习小时×3)
 *   熬夜小时 = max(0, 8 - sleep_hours)（PRD §4.21）
 * 生命值（含磨损）= 今日生命值 - max(0, wearValue × 0.5)，限制 0-100
 * 理智值 = 80 - (连续熬夜天数×8) - (红温DDL数×12) - (摸鱼小时×1.5) + (学习小时×2)，限制 0-100
 *   连续熬夜天数：sleep < 8h 才算熬夜（PRD §4.2.3）
 * 功德值 = Σ历史贡献（可为负）
 * 睡眠债 = max(0, 8 - 今日睡眠)
 * 发疯浓度 = (生命值损失 + 理智值损失) / 2，限制 0-100
 */
export function calculateSpiritState(
  tasks: Task[],
  todayRecord: TimeRecord | null,
  recentRecords: TimeRecord[],
  wearState?: WearState,
  penaltyAdjust?: { karmaDeduct: number; hpDeduct: number },
): SpiritState {
  const activeTasks = tasks.filter(t => !t.completed && getTimeRemaining(t.deadline) > 0);
  // 红温 = critical 或 dying
  const redTasks = activeTasks.filter(t => ['critical', 'dying'].includes(getDangerLevel(t.deadline)));

  // 今日数据（优先取有效值：manual > timer）
  const sleepHours   = todayRecord?.sleep_hours ?? 7;
  const slackMinutes = todayRecord ? effectiveSlackMinutes(todayRecord) : 0;
  const studyMinutes = todayRecord ? effectiveStudyMinutes(todayRecord) : 0;
  const slackHours   = slackMinutes / 60;
  const studyHours   = studyMinutes / 60;

  // 连续熬夜天数（睡眠 < 8h 视为熬夜，与 PRD §4.2.3 一致）
  const nightCount = recentRecords.filter(r => r.sleep_hours < 8).length;
  // 熬夜小时（PRD §4.21：max(0, 8 - sleep_hours)）
  const lateHours = Math.max(0, 8 - sleepHours);

  // 未完成DDL扣减（含优先级权重）
  const ddlPenalty = activeTasks.reduce((sum, t) => sum + 8 * getPriorityWeight(t.priority), 0);

  // 今日生命值（不含磨损）
  const todayLifeRaw = 80
    - lateHours * 5
    - ddlPenalty
    - slackHours * 2
    + studyHours * 3;

  // 磨损值衰减：磨损值越大，今日上限越低
  const wearPenalty = wearState ? Math.min(40, wearState.wearValue * 0.5) : 0;
  const lifePoints = Math.max(0, Math.min(100, todayLifeRaw - wearPenalty));

  // 理智值
  const sanityPoints = Math.max(0, Math.min(100,
    80 - nightCount * 8 - redTasks.length * 12 - slackHours * 1.5 + studyHours * 2
  ));

  // 睡眠债（今日）
  const sleepDebt = Math.max(0, 8 - sleepHours);

  // 功德值：基于历史记录累积（completion_type 优先，旧数据兼容推导）
  const completedTasks = tasks.filter(t => t.completed);
  let onTimeCount  = 0;
  let rushCount    = 0;
  let overdueCompletions = 0;
  for (const t of completedTasks) {
    if (t.completion_type === 'on_time') {
      onTimeCount++;
    } else if (t.completion_type === 'rush') {
      rushCount++;
    } else if (t.completion_type === 'overtime' || t.is_overtime_complete) {
      overdueCompletions++;
    } else if (!t.is_overtime_complete && t.completed_at) {
      // 旧数据：无 completion_type，按时间差推导
      const diff = new Date(t.deadline).getTime() - new Date(t.completed_at).getTime();
      if (diff >= 0 && diff <= 3600000) rushCount++;
      else if (diff > 3600000) onTimeCount++;
      else overdueCompletions++;
    }
  }
  const heavySlackDays = recentRecords.filter(r => effectiveSlackMinutes(r) > 480).length;
  const longStudyDays  = recentRecords.filter(r => effectiveStudyMinutes(r) > 240).length;

  const meritPoints = onTimeCount * 5
    - rushCount * 3
    - overdueCompletions * 10
    - heavySlackDays * 20
    + longStudyDays * 2;

  // 发疯浓度（含磨损加成）
  const lifePointsLoss = 100 - lifePoints;
  const sanityLoss     = 100 - sanityPoints;
  const madnessLevel   = Math.max(0, Math.min(100, (lifePointsLoss + sanityLoss) / 2));

  return {
    lifePoints:    Math.round(Math.max(0, lifePoints  - (penaltyAdjust?.hpDeduct    ?? 0))),
    sanityPoints:  Math.round(sanityPoints),
    sleepDebt:     Math.round(sleepDebt * 10) / 10,
    meritPoints:   Math.round(meritPoints - (penaltyAdjust?.karmaDeduct ?? 0)),
    madnessLevel:  Math.round(madnessLevel),
  };
}

/**
 * 获取UI崩坏等级（0=正常, 1=轻度, 2=红温, 3=濒死, 4=通宵）
 */
export function getGlitchLevel(spirit: SpiritState, isNight: boolean): number {
  if (spirit.lifePoints <= 10) return 4;
  if (spirit.lifePoints <= 20) return 3;
  if (spirit.lifePoints <= 40) return 2;
  if (spirit.lifePoints <= 60 || isNight) return 1;
  return 0;
}

