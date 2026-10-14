/**
 * src/lib/deadlineUtils.ts
 * 
 * 截止时间计算、格式化、日历网格与快捷选择核心工具集
 * 纯 TypeScript 逻辑，保证 100% 离线跨平台兼容与完备单元测试
 */

export const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

export function formatDeadlineDisplay(d: Date): string {
  const now = new Date();
  const isThisYear = d.getFullYear() === now.getFullYear();
  const isPast = d.getTime() < now.getTime();

  const dYear = d.getFullYear();
  const dMonth = d.getMonth();
  const dDate = d.getDate();

  const nYear = now.getFullYear();
  const nMonth = now.getMonth();
  const nDate = now.getDate();

  const isToday = dYear === nYear && dMonth === nMonth && dDate === nDate;

  const tmr = new Date(now);
  tmr.setDate(tmr.getDate() + 1);
  const isTomorrow = dYear === tmr.getFullYear() && dMonth === tmr.getMonth() && dDate === tmr.getDate();

  const dayAfter = new Date(now);
  dayAfter.setDate(dayAfter.getDate() + 2);
  const isDayAfter = dYear === dayAfter.getFullYear() && dMonth === dayAfter.getMonth() && dDate === dayAfter.getDate();

  const yest = new Date(now);
  yest.setDate(yest.getDate() - 1);
  const isYesterday = dYear === yest.getFullYear() && dMonth === yest.getMonth() && dDate === yest.getDate();

  const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const weekLabel = WEEK_LABELS[d.getDay()];

  if (isToday) return `今天 ${timeStr} (周${weekLabel})`;
  if (isTomorrow) return `明天 ${timeStr} (周${weekLabel})`;
  if (isDayAfter) return `后天 ${timeStr} (周${weekLabel})`;
  if (isYesterday) return `昨天 ${timeStr} (已过期)`;

  const prefix = isPast ? '[已过期] ' : '';
  const dateStr = isThisYear
    ? `${dMonth + 1}月${dDate}日(周${weekLabel})`
    : `${dYear}年${dMonth + 1}月${dDate}日(周${weekLabel})`;

  return `${prefix}${dateStr} ${timeStr}`;
}

/** 修改日期时保留时分秒 (互保) */
export function setDateKeepTime(baseDate: Date, year: number, month: number, day: number): Date {
  const result = new Date(baseDate);
  result.setFullYear(year);
  // 注意：先切到目标月份第一天防止溢出，再设定目标天数
  result.setDate(1);
  result.setMonth(month);
  const maxDay = new Date(year, month + 1, 0).getDate();
  result.setDate(Math.min(day, maxDay));
  return result;
}

/** 修改时间时保留年月日 (互保) */
export function setTimeKeepDate(baseDate: Date, hour: number, minute: number): Date {
  const result = new Date(baseDate);
  result.setHours(hour, minute, 0, 0);
  return result;
}

/** 快捷日期计算 */
export function getShortcutDate(
  type: 'today' | 'tomorrow' | '3days' | '7days',
  referenceDate = new Date()
): { year: number; month: number; date: number } {
  const t = new Date(referenceDate);
  if (type === 'today') {
    // 保持当天
  } else if (type === 'tomorrow') {
    t.setDate(t.getDate() + 1);
  } else if (type === '3days') {
    t.setDate(t.getDate() + 3);
  } else if (type === '7days') {
    t.setDate(t.getDate() + 7);
  }
  return {
    year: t.getFullYear(),
    month: t.getMonth(),
    date: t.getDate(),
  };
}

export interface CalendarCell {
  dateKey: string;
  year: number;
  month: number;
  dayNum: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
}

/** 构造单月日历展示网格 */
export function generateCalendarGrid(
  viewMonthDate: Date,
  selectedDate: Date,
  now = new Date()
): CalendarCell[] {
  const year = viewMonthDate.getFullYear();
  const month = viewMonthDate.getMonth();

  const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0(周日)-6(周六)
  const mondayOffset = (firstDayOfWeek + 6) % 7; // 周一为 0

  const daysInCurrentMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const grid: CalendarCell[] = [];

  const isSameDay = (y: number, m: number, d: number, target: Date) => {
    return (
      y === target.getFullYear() &&
      m === target.getMonth() &&
      d === target.getDate()
    );
  };

  // 1. 上月余留天数填充
  for (let i = mondayOffset - 1; i >= 0; i--) {
    const dayNum = daysInPrevMonth - i;
    const prevDate = new Date(year, month - 1, dayNum);
    grid.push({
      dateKey: `prev-${dayNum}`,
      year: prevDate.getFullYear(),
      month: prevDate.getMonth(),
      dayNum,
      isCurrentMonth: false,
      isToday: isSameDay(prevDate.getFullYear(), prevDate.getMonth(), dayNum, now),
      isSelected: isSameDay(prevDate.getFullYear(), prevDate.getMonth(), dayNum, selectedDate),
    });
  }

  // 2. 当月天数
  for (let d = 1; d <= daysInCurrentMonth; d++) {
    grid.push({
      dateKey: `cur-${d}`,
      year,
      month,
      dayNum: d,
      isCurrentMonth: true,
      isToday: isSameDay(year, month, d, now),
      isSelected: isSameDay(year, month, d, selectedDate),
    });
  }

  // 3. 下月补齐至 7 的倍数（至少满 35 或 42 格）
  const totalRows = Math.ceil(grid.length / 7);
  const targetTotal = Math.max(35, totalRows * 7);
  const remaining = targetTotal - grid.length;
  for (let n = 1; n <= remaining; n++) {
    const nextDate = new Date(year, month + 1, n);
    grid.push({
      dateKey: `next-${n}`,
      year: nextDate.getFullYear(),
      month: nextDate.getMonth(),
      dayNum: n,
      isCurrentMonth: false,
      isToday: isSameDay(nextDate.getFullYear(), nextDate.getMonth(), n, now),
      isSelected: isSameDay(nextDate.getFullYear(), nextDate.getMonth(), n, selectedDate),
    });
  }

  return grid;
}

// ──────────────────────────────────────────────────────────────
// 空状态与历史任务展示辅助逻辑
// ──────────────────────────────────────────────────────────────

/** 空状态类型定义 */
export type EmptyStateType =
  | 'all-empty'        // 完全没有任务
  | 'active-empty'     // 进行中为空
  | 'completed-empty'  // 已完成为空
  | 'expired-empty'    // 已过期为空
  | 'search-empty'     // 搜索无结果
  | 'category-empty';  // 分类筛选为空

/** 根据当前筛选条件计算空状态类型 */
export function getEmptyStateType(params: {
  statusTab: 'active' | 'expired' | 'completed' | 'all';
  searchQuery: string;
  selectedCategory: string;
  tasks: { completed: boolean; deadline: string }[];
}): EmptyStateType {
  const { statusTab, searchQuery, selectedCategory, tasks } = params;

  // 搜索无结果优先
  if (searchQuery.trim()) return 'search-empty';

  // 分类筛选为空
  if (selectedCategory !== '全部') return 'category-empty';

  // 状态筛选为空
  if (statusTab === 'active') return 'active-empty';
  if (statusTab === 'completed') return 'completed-empty';
  if (statusTab === 'expired') return 'expired-empty';

  // 全部为空（没有任何任务）
  return 'all-empty';
}

/** 空状态展示配置 */
export function getEmptyStateConfig(type: EmptyStateType, category?: string): {
  emoji: string;
  title: string;
  subtitle: string;
  showViewCompleted: boolean;
  showCreateButton: boolean;
} {
  switch (type) {
    case 'all-empty':
      return {
        emoji: '🌈',
        title: '欢迎加入 DDL 战场',
        subtitle: '还没有任何任务，点击右下角 + 创建第一个 DDL 吧！',
        showViewCompleted: false,
        showCreateButton: true,
      };
    case 'active-empty':
      return {
        emoji: '🎉',
        title: '暂时没有待办 DDL',
        subtitle: '所有任务都完成了，享受这片刻的平静~',
        showViewCompleted: true,
        showCreateButton: false,
      };
    case 'completed-empty':
      return {
        emoji: '📝',
        title: '还没有完成记录',
        subtitle: '完成第一个 DDL 任务，让麻糬为你盖章庆祝吧！',
        showViewCompleted: false,
        showCreateButton: true,
      };
    case 'expired-empty':
      return {
        emoji: '⏰',
        title: '没有已过期的任务',
        subtitle: '太好了，没有遗漏的 DDL！继续保持~',
        showViewCompleted: false,
        showCreateButton: false,
      };
    case 'search-empty':
      return {
        emoji: '🔍',
        title: '没有找到符合条件的任务',
        subtitle: '试试更换关键词，或清除搜索条件',
        showViewCompleted: false,
        showCreateButton: false,
      };
    case 'category-empty':
      return {
        emoji: '📂',
        title: `「${category}」分类暂无任务`,
        subtitle: '切换到其他分类，或创建一个新任务',
        showViewCompleted: false,
        showCreateButton: true,
      };
  }
}

/** 已完成任务按完成时间倒序排序 */
export function sortCompletedTasksByTime<T extends { completed_at?: string | null }>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    const timeA = a.completed_at ? new Date(a.completed_at).getTime() : 0;
    const timeB = b.completed_at ? new Date(b.completed_at).getTime() : 0;
    return timeB - timeA; // 倒序，最新的在前
  });
}
