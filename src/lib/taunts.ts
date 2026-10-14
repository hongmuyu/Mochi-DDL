/**
 * 吐槽文案系统
 * 根据当前状态随机生成搞笑互联网梗文案
 */

// 熬夜文案
const NIGHT_TAUNTS = [
  '你已进入阴间时区。',
  '凌晨了，你的大脑已离场，身体还在硬撑。',
  '此时此刻，世界只剩下你和你的作业。',
  '深夜里，熬夜才是你的本职工作。',
  '你已经不算熬夜，这叫提前进入明天。',
];

// 摸鱼太久文案
const SLACK_TAUNTS = [
  '你甚至摸出了工伤。',
  '你的摸鱼时长已超过你的学习时长，恭喜成就达成。',
  '你已经是一条被职业化的鱼了。',
  '这不叫摸鱼，这叫用休息换效率的战略布局。',
  '摸鱼冠军，实至名归。',
];

// DDL剩余<1小时
const DYING_TAUNTS = [
  '你的作业正在提刀赶来。',
  '倒计时归零，人生归零。',
  '此刻，你就是那道DDL。',
  '建议直接跑路，或者——开始。',
  '生死边缘，方显英雄本色。',
];

// DDL剩余1-3小时
const CRITICAL_TAUNTS = [
  '现在开始做，还有概率创造奇迹。',
  '三小时，奇迹与垃圾只有一步之遥。',
  '你不是在赶作业，你是在挑战人类极限。',
  '此刻的你，拥有超凡入圣的专注力。（迫真）',
  '全力以赴，神来之笔，就在今晚。',
];

// 完成任务
const COMPLETE_TAUNTS = [
  '居然真的活下来了？',
  '奇迹！你居然做完了！',
  '你成功了，虽然我也没想到。',
  '活人，人活着，这很重要。',
  '下次一定不拖延。（你不会的）',
];

// 普通状态
const NORMAL_TAUNTS = [
  '该学习了，你在看什么呢。',
  '距离崩溃还有若干步，加油。',
  '享受这片刻的平静，DDL已在路上。',
  '大学生的快乐，就是偶尔短暂地清醒一下。',
  '你的生产力还在，还没有离开。',
  '现在开始做，说不定能正常睡觉。',
];

// 多个DDL同时进行
const MULTI_DDL_TAUNTS = [
  '同时赶N个DDL，才能体现出你的价值。',
  '并发崩溃，才是大学生的高端操作。',
  '你现在有好几个截止日期，它们都在对你招手。',
  '分身乏术，但你还是用了全力。',
];

export type TauntContext =
  | 'night' // 熬夜中（凌晨0-5点）
  | 'slack' // 摸鱼时间过长
  | 'dying' // DDL<1h
  | 'critical' // DDL 1-3h
  | 'complete' // 完成任务
  | 'multi' // 多个危险DDL
  | 'normal'; // 普通状态

/**
 * 随机获取吐槽文案
 */
function random<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * 根据上下文获取吐槽
 */
export function getTaunt(context: TauntContext): string {
  switch (context) {
    case 'night': return random(NIGHT_TAUNTS);
    case 'slack': return random(SLACK_TAUNTS);
    case 'dying': return random(DYING_TAUNTS);
    case 'critical': return random(CRITICAL_TAUNTS);
    case 'complete': return random(COMPLETE_TAUNTS);
    case 'multi': return random(MULTI_DDL_TAUNTS);
    default: return random(NORMAL_TAUNTS);
  }
}

/**
 * 根据当前状态自动判断并返回文案
 */
export function getAutoTaunt(params: {
  hour: number; // 当前小时 0-23
  slackMinutes: number; // 今日摸鱼分钟
  dangerousCount: number; // 危险DDL数量
  dyingCount: number; // 濒死DDL数量
  sleepHours: number; // 睡眠时间
}): string {
  const { hour, slackMinutes, dangerousCount, dyingCount, sleepHours } = params;

  // 优先判断最紧急的
  if (dyingCount > 0) return getTaunt('dying');
  if (hour >= 0 && hour < 5) return getTaunt('night');
  if (slackMinutes > 120) return getTaunt('slack');
  if (dangerousCount >= 2) return getTaunt('multi');
  if (dangerousCount >= 1) return getTaunt('critical');

  return getTaunt('normal');
}
