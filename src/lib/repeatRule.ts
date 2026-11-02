/**
 * 重复任务计划周期与锚点计算工具 (Repeat Task Rule Engine)
 *
 * 核心算法：
 * 1. 计划锚点保留：每月31日遇到小月（如2月28/29，4月30）收拢为月末，次月自动回弹为31日；
 * 2. 逾期与跳跃周期收拢：若错过多个周期，自动步进至未来最近的一个有效周期，避免批量堆积历史欠账。
 */

export function computeNextRepeatDeadline(
  currentDeadlineStr: string,
  repeatRule: 'none' | 'daily' | 'weekly' | 'monthly' | null | undefined,
  referenceNowMs = Date.now(),
): string {
  const cur = new Date(currentDeadlineStr);
  if (isNaN(cur.getTime()) || !repeatRule || repeatRule === 'none') {
    return currentDeadlineStr;
  }

  const target = new Date(cur.getTime());
  const originalDay = cur.getDate(); // 原始日期锚点（如 31）

  function stepOneCycle() {
    if (repeatRule === 'daily') {
      target.setDate(target.getDate() + 1);
    } else if (repeatRule === 'weekly') {
      target.setDate(target.getDate() + 7);
    } else if (repeatRule === 'monthly') {
      const curMonth = target.getMonth();
      target.setDate(1); // 设为1号防月末直接溢出到下下月
      target.setMonth(curMonth + 1);
      const daysInNextMonth = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
      target.setDate(Math.min(originalDay, daysInNextMonth));
    }
  }

  // 至少推进一个周期
  stepOneCycle();

  // 若逾期严重且步进后仍位于过去，自动跳跃收拢至未来最近周期，避免堆积历史欠账
  if (target.getTime() < referenceNowMs) {
    if (repeatRule === 'daily') {
      const diffDays = Math.ceil((referenceNowMs - target.getTime()) / 86400000);
      target.setDate(target.getDate() + diffDays);
    } else if (repeatRule === 'weekly') {
      const diffWeeks = Math.ceil((referenceNowMs - target.getTime()) / (7 * 86400000));
      target.setDate(target.getDate() + diffWeeks * 7);
    } else {
      let guard = 0;
      while (target.getTime() < referenceNowMs && guard++ < 120) {
        stepOneCycle();
      }
    }
  }

  return target.toISOString();
}
