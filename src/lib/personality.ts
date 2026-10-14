import { Personality, Task, TimeRecord } from '../types/types';
import { getDangerLevel, getTimeRemaining } from './ddl';

/** PRD §4.4 人格检测输入（来自结算快照或实时精算） */
export interface PersonalityInput {
  /** 生命值 0-100 */
  hp: number;
  /** 理智值 0-100 */
  san: number;
  /** 功德值（可为负） */
  karma: number;
  /** 连续熬夜天数（sleep_hours < 6 的连续天） */
  sleeplessDays: number;
  /** 今日摸鱼秒数 */
  slackSecs: number;
  /** 今日学习秒数 */
  studySecs: number;
  /** 红温 DDL 数量（critical / dying 级） */
  redDdlCount: number;
}

/**
 * PRD §4.4 完整人格决策矩阵（10 条规则 + 默认，优先级降序，命中即返回）
 */
export function generatePersonalityFromStats(input: PersonalityInput): Personality {
  const { hp, san, karma, sleeplessDays, slackSecs, studySecs, redDdlCount } = input;
  const slackH  = slackSecs  / 3600;
  const studyH  = studySecs  / 3600;

  // 规则 1：HP < 10 且 SAN < 20
  if (hp < 10 && san < 20) {
    return {
      title: '濒危脆皮大学生',
      description: `生命值${hp}%且理智值${san}%，身体和精神双双崩盘。建议直接冬眠，明天再努力。`,
    };
  }
  // 规则 2：HP < 10
  if (hp < 10) {
    return {
      title: '极限求生者',
      description: `生命值${hp}%，在死亡边缘反复横跳。先活下去，其他再说。`,
    };
  }
  // 规则 3：连续熬夜 >= 3 天 且 SAN < 30
  if (sleeplessDays >= 3 && san < 30) {
    return {
      title: '阴间作息生物',
      description: `连续熬夜${sleeplessDays}天，SAN值跌破30。太阳见过你吗？`,
    };
  }
  // 规则 4：红温 DDL >= 3 且 SAN < 40
  if (redDdlCount >= 3 && san < 40) {
    return {
      title: '极限施法大师',
      description: `同时面对${redDdlCount}个红温DDL，SAN值<40。你是时间管理鬼才，可惜管的是倒计时。`,
    };
  }
  // 规则 5：摸鱼 > 4h 且 学习 < 1h
  if (slackH > 4 && studyH < 1) {
    return {
      title: '战略性摆烂专家',
      description: `摸鱼${slackH.toFixed(1)}h但学习不足1h，摆得很彻底。摸鱼这么努力，学习怎么不跟进？`,
    };
  }
  // 规则 6：功德值 < -50
  if (karma < -50) {
    return {
      title: '功德负数人',
      description: `功德值${karma}，麻糬头上的功德-∞在闪烁。多完成任务积德吧。`,
    };
  }
  // 规则 7：HP > 80 且 SAN > 80 且 学习 >= 2h
  if (hp > 80 && san > 80 && studyH >= 2) {
    return {
      title: '高效自律卷王',
      description: `HP/SAN双高且学习时长${studyH.toFixed(1)}h，状态极佳。保持住，你已经是大学生天花板了。`,
    };
  }
  // 规则 8：学习 >= 4h
  if (studyH >= 4) {
    return {
      title: '图书馆钉子户',
      description: `学习时长${studyH.toFixed(1)}h，今日专注度拉满。注意休息，别学傻了。`,
    };
  }
  // 规则 9：摸鱼 > 2h 且 学习 >= 2h
  if (slackH > 2 && studyH >= 2) {
    return {
      title: '劳逸结合表演艺术家',
      description: `学习${studyH.toFixed(1)}h和摸鱼${slackH.toFixed(1)}h都超过2h，平衡大师。你是懂生活的。`,
    };
  }
  // 规则 10：有红温 DDL
  if (redDdlCount >= 1) {
    return {
      title: '火烧屁股赶Due人',
      description: `有${redDdlCount}个DDL正在红温。关掉手机，现在开始还来得及。`,
    };
  }
  // 默认
  return {
    title: '普通大学生',
    description: '今日状态平稳，无极端特征。平平淡淡才是真。',
  };
}

/**
 * 首页 / 卡片页实时人格计算（PRD §4.4，基于当前 spirit + todayRecord + 活跃DDL）
 */
export function calculatePersonality(
  tasks: Task[],
  records: TimeRecord[],
): Personality {
  const todayRecord = records[0] ?? null;

  // 取今日学习/摸鱼秒数
  const studySecs = (todayRecord
    ? (todayRecord.manual_study_minutes !== null
      ? todayRecord.manual_study_minutes
      : todayRecord.timer_study_minutes)
    : 0) * 60;
  const slackSecs = (todayRecord
    ? (todayRecord.manual_slack_minutes !== null
      ? todayRecord.manual_slack_minutes
      : todayRecord.timer_slack_minutes)
    : 0) * 60;

  // 连续熬夜天数：最近 records 中连续 sleep_hours < 6 的天数
  let sleeplessDays = 0;
  for (const r of records) {
    if (r.sleep_hours < 6) sleeplessDays++;
    else break;
  }

  // 红温 DDL 数
  const redDdlCount = tasks.filter(
    t => !t.completed &&
      getTimeRemaining(t.deadline) > 0 &&
      ['critical', 'dying'].includes(getDangerLevel(t.deadline, t.priority)),
  ).length;

  // HP / SAN / karma 使用简化估算（首页实时，不依赖结算快照）
  // 这里仅用于驱动人格规则，精确值在结算时存入 daily_stats
  const hp    = Math.max(0, 100 - tasks.filter(t => !t.completed && getTimeRemaining(t.deadline) <= 0).length * 15);
  const san   = Math.max(0, 100 - sleeplessDays * 20 - redDdlCount * 10);
  const karma = -tasks.filter(t => !t.completed && getTimeRemaining(t.deadline) <= 0).length * 10;

  return generatePersonalityFromStats({ hp, san, karma, sleeplessDays, slackSecs, studySecs, redDdlCount });
}

/**
 * 根据精神状态获取状态标题
 */
export function getStateTitle(lifePoints: number): string {
  if (lifePoints <= 10) return '【系统崩溃】';
  if (lifePoints <= 20) return '【濒死告警】';
  if (lifePoints <= 40) return '【红温预警】';
  if (lifePoints <= 60) return '【勉强苟活】';
  if (lifePoints <= 80) return '【状态正常】';
  return '【满血复活】';
}
