import { DangerLevel, Priority, Task } from '../types/types';

/**
 * 计算任务剩余时间（毫秒）
 */
export function getTimeRemaining(deadline: string): number {
  return new Date(deadline).getTime() - Date.now();
}

/**
 * 计算基础危险等级（不含优先级加成）
 * >48h 安全 | 24-48h 注意 | 12-24h 危险 | <12h 红温 | <3h 濒死
 */
export function getDangerLevel(deadline: string, priority?: Priority): DangerLevel {
  const remainingMs = getTimeRemaining(deadline);
  const hours = remainingMs / (1000 * 60 * 60);

  if (hours <= 0) return 'dying';
  if (hours < 3) return 'dying';

  // 基础等级
  let base: DangerLevel;
  if (hours < 12) base = 'critical';
  else if (hours < 24) base = 'danger';
  else if (hours < 48) base = 'warning';
  else base = 'safe';

  // 优先级加成：高优先级任务提前一级告警
  if (priority === 3) {
    const LEVELS: DangerLevel[] = ['safe', 'warning', 'danger', 'critical', 'dying'];
    const idx = LEVELS.indexOf(base);
    if (idx < LEVELS.length - 1) return LEVELS[idx + 1];
  }

  return base;
}

/**
 * 计算血条进度（0-100）
 * 公式（PRD §4.1）：血条% = min(100, max(0, (due - now) / (due - created_at) × 100))
 * 分母缺失（旧数据迁移）默认为 72h（PRD §4.1 原文）
 */
export function getHealthBarPercent(deadline: string, createdAt?: string): number {
  const remainingMs = getTimeRemaining(deadline);
  // PRD §4.1：若 created_at 缺失，默认分母为 72h（非 48h）
  const totalMs = createdAt
    ? new Date(deadline).getTime() - new Date(createdAt).getTime()
    : 72 * 60 * 60 * 1000;
  const safeTotalMs = Math.max(totalMs, 1);
  const percent = (remainingMs / safeTotalMs) * 100;
  return Math.min(100, Math.max(0, percent));
}

/**
 * 格式化剩余时间毫秒数（PRD §4.1b 智能分级格式）
 */
export function formatTimeRemainingMs(remainingMs: number): string {
  if (remainingMs <= 0) return '已过期';

  const totalSeconds = Math.floor(remainingMs / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const totalHours   = Math.floor(totalSeconds / 3600);
  const totalDays    = Math.floor(totalSeconds / 86400);

  // < 1 分钟
  if (totalMinutes < 1) return '即将到期';

  // < 1 小时 → "X 分钟"
  if (totalHours < 1) return `${totalMinutes} 分钟`;

  // 1h ~ 24h → "XhXm"（向下取整，PRD §4.1b）
  if (totalHours < 24) {
    const h = totalHours;
    const m = totalMinutes - h * 60;
    return m > 0 ? `${h}h${m}m` : `${h}h`;
  }

  // 24h ~ 48h → "X 小时"（不显示天数，PRD §4.1b）
  if (totalDays < 2) return `${totalHours} 小时`;

  // 2 天 ~ 7 天 → "X 天 X 小时"
  if (totalDays < 7) {
    const remHours = totalHours - totalDays * 24;
    return remHours > 0 ? `${totalDays} 天 ${remHours} 小时` : `${totalDays} 天`;
  }

  // ≥ 7 天 → "X 周 X 天"
  const weeks = Math.floor(totalDays / 7);
  const remDays = totalDays - weeks * 7;
  return remDays > 0 ? `${weeks} 周 ${remDays} 天` : `${weeks} 周`;
}

/**
 * 格式化剩余时间（PRD §4.1b 智能分级格式）
 * 支持传入截止时间 ISO 字符串或剩余时间毫秒数
 *
 * | 剩余时间范围   | 显示格式    | 示例      |
 * |-------------|-----------|---------|
 * | ≥ 7 天      | X 周 X 天  | 3 周 2 天 |
 * | 2 天 ~ 7 天  | X 天 X 小时 | 5 天 6 小时|
 * | 24h ~ 48h   | X 小时     | 36 小时   |
 * | 1h ~ 24h    | XhXm      | 13h28m  |
 * | < 1 小时     | X 分钟     | 45 分钟   |
 * | < 1 分钟     | 即将到期    | 即将到期  |
 *
 * 所有时间向下取整（§4.1b 规则说明）
 */
export function formatTimeRemaining(deadline: string | number): string {
  const remainingMs = typeof deadline === 'number' ? deadline : getTimeRemaining(deadline);
  return formatTimeRemainingMs(remainingMs);
}

/**
 * 智能日期解析（PDF 7.1）
 * 支持格式：5-20 / 5.20 / 5/20 / 5月20 / 5月20日 / 2026-5-20 / 明天 / 后天
 * 年份缺省时自动补当前年；解析出的日期早于今天则自动加一年
 * 成功返回 Date，失败返回 null
 */
export function parseDeadlineInput(input: string): Date | null {
  const raw = input.trim();
  if (!raw) return null;

  const now = new Date();
  const currentYear = now.getFullYear();

  // ─── 自然语言 ───────────────────────────────────────────────
  if (raw === '明天') {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(23, 59, 0, 0);
    return d;
  }
  if (raw === '后天') {
    const d = new Date(now);
    d.setDate(d.getDate() + 2);
    d.setHours(23, 59, 0, 0);
    return d;
  }

  // ─── 带时间的完整格式（年-月-日 时:分 / 年-月-日T时:分）───
  const fullWithTime = raw.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})[T ](\d{1,2}):(\d{2})$/);
  if (fullWithTime) {
    const [, y, mo, d, h, mi] = fullWithTime.map(Number);
    return new Date(y, mo - 1, d, h, mi, 0);
  }

  // ─── 不带时间：统一解析月日，时间默认 23:59 ─────────────────
  let month = 0;
  let day   = 0;
  let year  = 0;  // 0 = 待自动推断

  // 完整年-月-日
  const fullDate = raw.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
  if (fullDate) {
    [, year, month, day] = fullDate.map(Number);
  }

  // 月.日 / 月-日 / 月/日
  const shortSep = !fullDate && raw.match(/^(\d{1,2})[.\-/](\d{1,2})$/);
  if (shortSep) {
    [, month, day] = shortSep.map(Number);
  }

  // 月月日日 中文格式（5月20 / 5月20日）
  const zhDate = !fullDate && !shortSep && raw.match(/^(\d{1,2})月(\d{1,2})(?:日)?$/);
  if (zhDate) {
    [, month, day] = zhDate.map(Number);
  }

  if (!month || !day) return null;

  // 推断年份
  if (!year) {
    year = currentYear;
    const candidate = new Date(year, month - 1, day, 23, 59, 0);
    // 已过去 → 自动顺延至明年
    if (candidate.getTime() < now.getTime()) {
      year += 1;
    }
  }

  const result = new Date(year, month - 1, day, 23, 59, 0);
  if (Number.isNaN(result.getTime())) return null;
  return result;
}

/**
 * 生成字符血条
 * 例：██████░░░░ 61%
 */
export function renderHealthBar(percent: number, length = 12): string {
  const filled = Math.round((percent / 100) * length);
  const empty = length - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * 获取最危险的任务（未完成且最近到期）
 */
export function getMostDangerousTask(tasks: Task[]): Task | null {
  const active = tasks.filter(t => !t.completed && getTimeRemaining(t.deadline) > 0);
  if (active.length === 0) return null;
  return active.sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime())[0];
}

/**
 * 获取危险等级颜色
 */
export function getDangerColor(level: DangerLevel): string {
  switch (level) {
    case 'safe': return '#39FF14';
    case 'warning': return '#FFD700';
    case 'danger': return '#FF8C00';
    case 'critical': return '#FF003C';
    case 'dying': return '#FF003C';
    default: return '#39FF14';
  }
}

/**
 * 获取危险等级文字
 */
export function getDangerLabel(level: DangerLevel): string {
  switch (level) {
    case 'safe': return '安全';
    case 'warning': return '注意';
    case 'danger': return '危险';
    case 'critical': return '红温';
    case 'dying': return '濒死';
    default: return '安全';
  }
}

/**
 * 获取优先级文字
 */
export function getPriorityLabel(priority: number): string {
  switch (priority) {
    case 1: return '低';
    case 2: return '中';
    case 3: return '高';
    default: return '中';
  }
}

/** 格式化日期为 YYYY-MM-DD 本地字符串（避免 UTC 跨天） */
export function formatLocalDateKey(date: Date | string | number): string {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 获取指定周的周一至周日 7 天日期 */
export function getWeekDates(baseDate = new Date()): Date[] {
  const d = new Date(baseDate);
  const day = d.getDay(); // 0 is Sunday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);

  const week: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const next = new Date(monday);
    next.setDate(monday.getDate() + i);
    week.push(next);
  }
  return week;
}

/** 生成 ICS 日历标准格式（纯本地生成，RFC 5545） */
export function generateICS(tasks: Task[]): string {
  const activeTasks = tasks.filter(t => t.status !== 'deleted');
  if (activeTasks.length === 0) return '';

  const formatIcsDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  };

  const escapeIcs = (str: string) => {
    return (str || '')
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  };

  const nowIcs = formatIcsDate(new Date().toISOString());

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//麻糬研究所//麻糬のDDL//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:麻糬のDDL清单',
  ];

  for (const t of activeTasks) {
    const deadlineIcs = formatIcsDate(t.deadline);
    // 开始时间默认为截止前 1 小时
    const startIcs = formatIcsDate(new Date(new Date(t.deadline).getTime() - 60 * 60 * 1000).toISOString());

    // 子任务描述格式化
    let description = t.note || '';
    if (t.subtasks && t.subtasks.length > 0) {
      const subtaskLines = t.subtasks.map(st => `[${st.completed ? 'x' : ' '}] ${st.title}`);
      description += (description ? '\n\n' : '') + '子任务：\n' + subtaskLines.join('\n');
    }

    // 优先级映射 (RFC 5545: 1=高, 5=中, 9=低)
    const icsPriority = t.priority === 3 ? 1 : t.priority === 1 ? 9 : 5;

    lines.push(
      'BEGIN:VEVENT',
      `UID:mochi_${t.id}@local`,
      `DTSTAMP:${nowIcs}`,
      `DTSTART:${startIcs}`,
      `DTEND:${deadlineIcs}`,
      `SUMMARY:${escapeIcs(t.name)}`,
      `DESCRIPTION:${escapeIcs(description)}`,
      `PRIORITY:${icsPriority}`,
      t.category ? `CATEGORIES:${escapeIcs(t.category)}` : 'CATEGORIES:待办',
      t.completed ? 'STATUS:COMPLETED' : 'STATUS:CONFIRMED',
    );

    // 提醒规则转换 VALARM
    if (t.reminder_offset && t.reminder_offset > 0) {
      lines.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:DDL提醒: ${escapeIcs(t.name)}`,
        `TRIGGER:-PT${t.reminder_offset}M`,
        'END:VALARM',
      );
    }

    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
