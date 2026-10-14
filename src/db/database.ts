import * as SQLite from 'expo-sqlite';

let _db: SQLite.SQLiteDatabase | null = null;

async function initDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  const dbName = process.env.EXPO_OS === 'web' ? ':memory:' : 'mochi_ddl.db';
  let db: SQLite.SQLiteDatabase;
  try {
    db = await SQLite.openDatabaseAsync(dbName);
  } catch {
    db = await SQLite.openDatabaseAsync(':memory:');
  }

  // ── PRD §4.10 SQLite性能配置 ──────────────────────────────────────────
  // WAL模式：避免DELETE journaling的频繁文件锁，支持高频写入（仅原生端；Web WASM/OPFS 不支持 WAL 共享内存）
  if (process.env.EXPO_OS !== 'web') {
    await db.execAsync(`PRAGMA journal_mode = WAL;`).catch(() => undefined);
    // 降低同步级别至NORMAL，在崩溃安全与写入性能间取得平衡
    await db.execAsync(`PRAGMA synchronous = NORMAL;`).catch(() => undefined);
    // 增大缓存页数（4KB页×2000页≈8MB），减少磁盘IO
    await db.execAsync(`PRAGMA cache_size = -2000;`).catch(() => undefined);
  }
  // 启用外键约束
  await db.execAsync(`PRAGMA foreign_keys = ON;`).catch(() => undefined);

  // ── 任务表（PRD §4.12.5）────────────────────────────────────────────
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS tasks (
      id                   TEXT    PRIMARY KEY,
      name                 TEXT    NOT NULL,
      deadline             TEXT    NOT NULL,
      priority             INTEGER NOT NULL DEFAULT 2,
      completed            INTEGER NOT NULL DEFAULT 0,
      completed_at         TEXT,
      created_at           TEXT    NOT NULL,
      is_overtime_complete INTEGER NOT NULL DEFAULT 0
    );
  `);
  // 兼容旧版本：若字段不存在则 ALTER TABLE 添加
  await db.execAsync(`
    ALTER TABLE tasks ADD COLUMN is_overtime_complete INTEGER NOT NULL DEFAULT 0;
  `).catch(() => undefined);
  // PRD §4.12.5 补充字段
  await db.execAsync(`ALTER TABLE tasks ADD COLUMN status TEXT NOT NULL DEFAULT 'active';`).catch(() => undefined);
  await db.execAsync(`ALTER TABLE tasks ADD COLUMN completion_type TEXT;`).catch(() => undefined);
  await db.execAsync(`ALTER TABLE tasks ADD COLUMN note TEXT;`).catch(() => undefined);
  await db.execAsync(`ALTER TABLE tasks ADD COLUMN category TEXT;`).catch(() => undefined);
  await db.execAsync(`ALTER TABLE tasks ADD COLUMN cutoff_deadline TEXT;`).catch(() => undefined);
  await db.execAsync(`ALTER TABLE tasks ADD COLUMN reminder_offset INTEGER;`).catch(() => undefined);
  // V1.0 最后一轮扩展字段（子任务、重复任务）
  await db.execAsync(`ALTER TABLE tasks ADD COLUMN subtasks TEXT;`).catch(() => undefined);
  await db.execAsync(`ALTER TABLE tasks ADD COLUMN repeat_rule TEXT DEFAULT 'none';`).catch(() => undefined);
  await db.execAsync(`ALTER TABLE tasks ADD COLUMN repeat_parent_id TEXT;`).catch(() => undefined);
  // 核心查询索引（PRD §4.12.5）
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_tasks_status_deadline ON tasks(status, deadline);`).catch(() => undefined);
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);`).catch(() => undefined);
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category);`).catch(() => undefined);
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);`).catch(() => undefined);

  // ── 每日时间记录表（手动录入，PRD §4.12.2）────────────────────────────
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS time_records (
      id                    TEXT    PRIMARY KEY,
      record_date           TEXT    NOT NULL UNIQUE,
      study_minutes         INTEGER NOT NULL DEFAULT 0,
      slack_minutes         INTEGER NOT NULL DEFAULT 0,
      sleep_hours           REAL    NOT NULL DEFAULT 0,
      late_hours            REAL    NOT NULL DEFAULT 0,
      timer_study_minutes   INTEGER NOT NULL DEFAULT 0,
      timer_slack_minutes   INTEGER NOT NULL DEFAULT 0,
      manual_study_minutes  INTEGER,
      manual_slack_minutes  INTEGER,
      is_manual_override    INTEGER NOT NULL DEFAULT 0,
      created_at            TEXT    NOT NULL
    );
  `);

  // ── 每日精神状态快照表（legacy，保留向后兼容）──────────────────────────
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS daily_stats (
      date               TEXT    PRIMARY KEY,
      hp                 REAL    NOT NULL DEFAULT 0,
      san                REAL    NOT NULL DEFAULT 0,
      wear               REAL    NOT NULL DEFAULT 0,
      karma              REAL    NOT NULL DEFAULT 0,
      personality_title  TEXT,
      personality_desc   TEXT,
      created_at         TEXT    NOT NULL
    );
  `);
  await db.execAsync(`ALTER TABLE daily_stats ADD COLUMN personality_title TEXT;`).catch(() => undefined);
  await db.execAsync(`ALTER TABLE daily_stats ADD COLUMN personality_desc  TEXT;`).catch(() => undefined);

  // ── 计时会话表（PRD §4.12.2 DB Schema 3.0）───────────────────────────
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS timer_sessions (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      session_type           TEXT    NOT NULL,         -- 'study' | 'slack'
      start_timestamp        INTEGER NOT NULL,          -- Unix 毫秒
      end_timestamp          INTEGER,                   -- Unix 毫秒，NULL=进行中
      duration_seconds       INTEGER NOT NULL DEFAULT 0,
      is_valid               INTEGER NOT NULL DEFAULT 1, -- 0=异常/超4h作废
      assigned_date          TEXT,                       -- YYYY-MM-DD，含跨天拆分
      split_from_session_id  INTEGER,                    -- 跨天拆分来源会话ID
      settled_date           TEXT                        -- 已结算日期，NULL=未结算
    );
  `);
  // 补充缺失字段（兼容旧版本）
  await db.execAsync(`ALTER TABLE timer_sessions ADD COLUMN assigned_date TEXT;`).catch(() => undefined);
  await db.execAsync(`ALTER TABLE timer_sessions ADD COLUMN split_from_session_id INTEGER;`).catch(() => undefined);
  await db.execAsync(`ALTER TABLE timer_sessions ADD COLUMN settled_date TEXT;`).catch(() => undefined);
  // 复合索引（PRD §4.12.2 性能优化）
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_timer_sessions_start_valid ON timer_sessions(start_timestamp, is_valid, session_type);`).catch(() => undefined);
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_timer_sessions_settled ON timer_sessions(settled_date, assigned_date);`).catch(() => undefined);

  // ── 每日聚合表（PRD §4.12.2，惰性结算结果落地）──────────────────────
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS daily_aggregates (
      date                        TEXT    PRIMARY KEY, -- YYYY-MM-DD
      total_study_seconds         INTEGER NOT NULL DEFAULT 0,
      total_slack_seconds         INTEGER NOT NULL DEFAULT 0,
      total_sleep_hours           REAL    NOT NULL DEFAULT 0,
      final_hp                    INTEGER NOT NULL DEFAULT 80,   -- 默认80避免NULL传播
      final_san                   INTEGER NOT NULL DEFAULT 80,   -- 默认80避免NULL传播
      final_karma                 INTEGER NOT NULL DEFAULT 0,    -- 默认0避免NULL传播
      wear_snapshot               REAL    NOT NULL DEFAULT 0,    -- 当日磨损值快照
      karma_snapshot              INTEGER NOT NULL DEFAULT 0,    -- 当日功德值快照
      sleep_debt                  REAL    NOT NULL DEFAULT 0,    -- 睡眠债
      streak_sleepless_days       INTEGER NOT NULL DEFAULT 0,    -- 连续熬夜天数
      red_ddl_count               INTEGER NOT NULL DEFAULT 0,    -- 红温DDL数量
      completed_on_time           INTEGER NOT NULL DEFAULT 0,    -- 按时完成次数
      completed_rush              INTEGER NOT NULL DEFAULT 0,    -- 压线完成次数
      completed_overtime          INTEGER NOT NULL DEFAULT 0,    -- 超时完成次数
      slack_over_8h_flag          INTEGER NOT NULL DEFAULT 0,    -- 单日摸鱼超8h标记
      study_over_4h_flag          INTEGER NOT NULL DEFAULT 0,    -- 连续学习>4h标记
      personality_title           TEXT    NOT NULL DEFAULT '未知人格',
      personality_desc            TEXT    NOT NULL DEFAULT '麻糬正在分析你的精神状态……',
      unfinished_task_weighted_sum REAL   NOT NULL DEFAULT 0     -- 未完成任务加权总和（HP公式用）
    );
  `);
  // 补充缺失字段（兼容旧版本）
  await db.execAsync(`ALTER TABLE daily_aggregates ADD COLUMN wear_snapshot REAL NOT NULL DEFAULT 0;`).catch(() => undefined);
  await db.execAsync(`ALTER TABLE daily_aggregates ADD COLUMN karma_snapshot INTEGER NOT NULL DEFAULT 0;`).catch(() => undefined);
  await db.execAsync(`ALTER TABLE daily_aggregates ADD COLUMN sleep_debt REAL NOT NULL DEFAULT 0;`).catch(() => undefined);
  await db.execAsync(`ALTER TABLE daily_aggregates ADD COLUMN streak_sleepless_days INTEGER NOT NULL DEFAULT 0;`).catch(() => undefined);
  await db.execAsync(`ALTER TABLE daily_aggregates ADD COLUMN red_ddl_count INTEGER NOT NULL DEFAULT 0;`).catch(() => undefined);
  await db.execAsync(`ALTER TABLE daily_aggregates ADD COLUMN completed_on_time INTEGER NOT NULL DEFAULT 0;`).catch(() => undefined);
  await db.execAsync(`ALTER TABLE daily_aggregates ADD COLUMN completed_rush INTEGER NOT NULL DEFAULT 0;`).catch(() => undefined);
  await db.execAsync(`ALTER TABLE daily_aggregates ADD COLUMN completed_overtime INTEGER NOT NULL DEFAULT 0;`).catch(() => undefined);
  await db.execAsync(`ALTER TABLE daily_aggregates ADD COLUMN slack_over_8h_flag INTEGER NOT NULL DEFAULT 0;`).catch(() => undefined);
  await db.execAsync(`ALTER TABLE daily_aggregates ADD COLUMN study_over_4h_flag INTEGER NOT NULL DEFAULT 0;`).catch(() => undefined);
  await db.execAsync(`ALTER TABLE daily_aggregates ADD COLUMN unfinished_task_weighted_sum REAL NOT NULL DEFAULT 0;`).catch(() => undefined);
  // personality defaults（旧行可能为NULL）
  await db.execAsync(`ALTER TABLE daily_aggregates ADD COLUMN personality_title TEXT NOT NULL DEFAULT '未知人格';`).catch(() => undefined);
  await db.execAsync(`ALTER TABLE daily_aggregates ADD COLUMN personality_desc TEXT NOT NULL DEFAULT '麻糬正在分析你的精神状态……';`).catch(() => undefined);
  // final_hp/san/karma 补充 NOT NULL DEFAULT（旧表字段已存在，仅更新NULL行）
  await db.execAsync(`UPDATE daily_aggregates SET final_hp=80 WHERE final_hp IS NULL;`).catch(() => undefined);
  await db.execAsync(`UPDATE daily_aggregates SET final_san=80 WHERE final_san IS NULL;`).catch(() => undefined);
  await db.execAsync(`UPDATE daily_aggregates SET final_karma=0 WHERE final_karma IS NULL;`).catch(() => undefined);

  // ── 操作日志表（PRD §4.12.4）──────────────────────────────────────────
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS operation_log (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp    INTEGER NOT NULL,               -- Unix timestamp（秒）
      action_type  TEXT    NOT NULL,               -- 'delete_penalty' | 'cross_day_truncated' | 'timer_abnormal' | etc.
      target_type  TEXT,                           -- 'task' | 'timer_session' | 'daily_aggregates'
      target_id    INTEGER,
      details      TEXT,                           -- JSON
      user_visible INTEGER NOT NULL DEFAULT 0,     -- 1=用户可见
      row_hash     TEXT                            -- CRC32校验和（防文件损坏和无意篡改）
    );
  `);
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_oplog_time ON operation_log(timestamp);`).catch(() => undefined);
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_oplog_action ON operation_log(action_type);`).catch(() => undefined);

  // ── 全局配置表（PRD §4.12.6）──────────────────────────────────────────
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS global_config (
      key        TEXT    PRIMARY KEY,              -- 配置项键名
      value      TEXT    NOT NULL,                 -- 配置项值（统一字符串存储）
      value_type TEXT    NOT NULL,                 -- 'int' | 'real' | 'text' | 'bool'
      updated_at INTEGER NOT NULL                  -- 最后更新时间 Unix timestamp（秒）
    );
  `);
  // 核心配置项初始化（仅首次插入，已存在则忽略）
  const nowSec = Math.floor(Date.now() / 1000);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await db.execAsync(`
    INSERT OR IGNORE INTO global_config(key, value, value_type, updated_at) VALUES
      ('last_settled_date',           '${yesterday}', 'text', ${nowSec}),
      ('last_settled_date_signature', '',              'text', ${nowSec}),
      ('wear_value',                  '0',             'real', ${nowSec}),
      ('karma_value',                 '0',             'int',  ${nowSec}),
      ('day_cutoff_hour',             '4',             'int',  ${nowSec}),
      ('last_cleanup_date',           '${yesterday}',  'text', ${nowSec}),
      ('schema_version',              '3',             'int',  ${nowSec}),
      ('formula_version',             '1',             'int',  ${nowSec});
  `);

  // ── 历史卡片收藏表（SPEC §5.2 方案一独立表）──────────────────────────
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS card_favorites (
      date         TEXT    PRIMARY KEY,   -- YYYY-MM-DD
      favorited_at INTEGER NOT NULL,      -- Unix timestamp（秒）
      note         TEXT                  -- 用户可选备注
    );
  `);

  // ── 冷启动维护：异步清理30天以上操作日志（PRD §4.10）──────────────────
  _db = db;
  setTimeout(async () => {
    try {
      const lastCleanup = await db.getFirstAsync<{ value: string }>(
        `SELECT value FROM global_config WHERE key='last_cleanup_date';`
      );
      const today = new Date().toISOString().slice(0, 10);
      if (!lastCleanup || lastCleanup.value < today) {
        await db.execAsync(
          `DELETE FROM operation_log WHERE timestamp < strftime('%s', 'now', '-30 days');`
        );
        await db.runAsync(
          `UPDATE global_config SET value=?, updated_at=? WHERE key='last_cleanup_date';`,
          today, Math.floor(Date.now() / 1000)
        );
      }
    } catch { /* 日志清理失败静默忽略 */ }
  }, 0);

  return db;
}

/** 全局 DB 实例 Promise 缓存（单例） */
let _dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/** 获取已初始化的 DB 实例 */
export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!_dbPromise) {
    _dbPromise = initDb().catch(async (err) => {
      console.warn('[database] initDb failed, fallback to fresh in-memory db:', err);
      _db = null;
      try {
        const fallbackDb = await SQLite.openDatabaseAsync(':memory:');
        return fallbackDb;
      } catch (e2) {
        console.error('[database] Fatal database open error:', e2);
        throw e2;
      }
    });
  }
  return _dbPromise;
}

/** 生成唯一 ID */
export function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── 全局配置辅助函数（PRD §4.12.6）──────────────────────────────────────

/** 读取全局配置项（带类型转换） */
export async function getConfig(key: string): Promise<string | number | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string; value_type: string }>(
    `SELECT value, value_type FROM global_config WHERE key=?;`, key
  );
  if (!row) return null;
  if (row.value_type === 'int') return parseInt(row.value, 10);
  if (row.value_type === 'real') return parseFloat(row.value);
  return row.value;
}

/** 写入全局配置项 */
export async function setConfig(key: string, value: string | number, type: 'int' | 'real' | 'text' | 'bool' = 'text'): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO global_config(key, value, value_type, updated_at)
     VALUES(?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, value_type=excluded.value_type, updated_at=excluded.updated_at;`,
    key, String(value), type, Math.floor(Date.now() / 1000)
  );
}

// ── 操作日志写入（PRD §4.12.4）──────────────────────────────────────────

/** 写入操作日志（含CRC32校验和） */
export async function writeOperationLog(params: {
  action_type: string;
  target_type?: string;
  target_id?: number;
  details?: object;
  user_visible?: boolean;
}): Promise<void> {
  const db = await getDb();
  const detailsJson = params.details ? JSON.stringify(params.details) : null;
  const nowSec = Math.floor(Date.now() / 1000);
  // 轻量CRC32实现（纯JS，避免阻塞UI线程）
  const payload = `${nowSec}|${params.action_type}|${params.target_type ?? ''}|${params.target_id ?? ''}|${detailsJson ?? ''}`;
  const hash = crc32(payload).toString(16);
  await db.runAsync(
    `INSERT INTO operation_log(timestamp, action_type, target_type, target_id, details, user_visible, row_hash)
     VALUES(?, ?, ?, ?, ?, ?, ?);`,
    nowSec,
    params.action_type,
    params.target_type ?? null,
    params.target_id ?? null,
    detailsJson,
    params.user_visible ? 1 : 0,
    hash
  );
}

/** 简单CRC32实现（PRD §4.12.4：轻量级，避免阻塞UI） */
function crc32(str: string): number {
  let crc = -1;
  for (let i = 0; i < str.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ str.charCodeAt(i)) & 0xFF];
  }
  return (crc ^ -1) >>> 0;
}

const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
