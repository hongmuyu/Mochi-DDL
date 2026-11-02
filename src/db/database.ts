import * as SQLite from 'expo-sqlite';

export interface DatabaseHealth {
  status: 'ok' | 'degraded_web_memory' | 'corrupted' | 'migration_failed';
  isInMemory: boolean;
  storageType: 'sqlite_file' | 'in_memory';
  schemaVersion: number;
  errorMessage?: string;
}

let _db: SQLite.SQLiteDatabase | null = null;
let _dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

let _health: DatabaseHealth = {
  status: 'ok',
  isInMemory: process.env.EXPO_OS === 'web',
  storageType: process.env.EXPO_OS === 'web' ? 'in_memory' : 'sqlite_file',
  schemaVersion: 0,
};

export function getDatabaseHealth(): DatabaseHealth {
  return { ..._health };
}

/** 目标数据架构版本 */
export const TARGET_SCHEMA_VERSION = 4;

/** 按版本顺序安全执行数据库迁移 */
async function runVersionedMigrations(db: SQLite.SQLiteDatabase): Promise<number> {
  const versionRow = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  let currentVersion = versionRow?.user_version ?? 0;

  // 检查是否已有旧表但未设置 user_version（向前兼容已运行版本）
  if (currentVersion === 0) {
    const tableRow = await db.getFirstAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='tasks';"
    );
    if (tableRow) {
      currentVersion = 3;
      await db.execAsync('PRAGMA user_version = 3;');
    }
  }

  // ── Version 1: 基础核心表 ──────────────────────────────────────
  if (currentVersion < 1) {
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
    currentVersion = 1;
    await db.execAsync('PRAGMA user_version = 1;');
  }

  // ── Version 2: 任务扩展与初版计时会话 ──────────────────────────
  if (currentVersion < 2) {
    await db.execAsync(`
      ALTER TABLE tasks ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
      ALTER TABLE tasks ADD COLUMN completion_type TEXT;
      ALTER TABLE tasks ADD COLUMN note TEXT;
      ALTER TABLE tasks ADD COLUMN category TEXT;
      ALTER TABLE tasks ADD COLUMN cutoff_deadline TEXT;
      ALTER TABLE tasks ADD COLUMN reminder_offset INTEGER;
      ALTER TABLE tasks ADD COLUMN subtasks TEXT;
      ALTER TABLE tasks ADD COLUMN repeat_rule TEXT DEFAULT 'none';
      ALTER TABLE tasks ADD COLUMN repeat_parent_id TEXT;

      CREATE TABLE IF NOT EXISTS timer_sessions (
        id                     INTEGER PRIMARY KEY AUTOINCREMENT,
        session_type           TEXT    NOT NULL,
        start_timestamp        INTEGER NOT NULL,
        end_timestamp          INTEGER,
        duration_seconds       INTEGER NOT NULL DEFAULT 0,
        is_valid               INTEGER NOT NULL DEFAULT 1,
        assigned_date          TEXT,
        split_from_session_id  INTEGER,
        settled_date           TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status_deadline ON tasks(status, deadline);
      CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
      CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category);
      CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
      CREATE INDEX IF NOT EXISTS idx_timer_sessions_start_valid ON timer_sessions(start_timestamp, is_valid, session_type);
      CREATE INDEX IF NOT EXISTS idx_timer_sessions_settled ON timer_sessions(settled_date, assigned_date);
    `).catch(() => undefined);
    currentVersion = 2;
    await db.execAsync('PRAGMA user_version = 2;');
  }

  // ── Version 3: 每日聚合、操作日志与全局配置 ────────────────────
  if (currentVersion < 3) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS daily_aggregates (
        date                        TEXT    PRIMARY KEY,
        total_study_seconds         INTEGER NOT NULL DEFAULT 0,
        total_slack_seconds         INTEGER NOT NULL DEFAULT 0,
        total_sleep_hours           REAL    NOT NULL DEFAULT 0,
        final_hp                    INTEGER NOT NULL DEFAULT 80,
        final_san                   INTEGER NOT NULL DEFAULT 80,
        final_karma                 INTEGER NOT NULL DEFAULT 0,
        wear_snapshot               REAL    NOT NULL DEFAULT 0,
        karma_snapshot              INTEGER NOT NULL DEFAULT 0,
        sleep_debt                  REAL    NOT NULL DEFAULT 0,
        streak_sleepless_days       INTEGER NOT NULL DEFAULT 0,
        red_ddl_count               INTEGER NOT NULL DEFAULT 0,
        completed_on_time           INTEGER NOT NULL DEFAULT 0,
        completed_rush              INTEGER NOT NULL DEFAULT 0,
        completed_overtime          INTEGER NOT NULL DEFAULT 0,
        slack_over_8h_flag          INTEGER NOT NULL DEFAULT 0,
        study_over_4h_flag          INTEGER NOT NULL DEFAULT 0,
        personality_title           TEXT    NOT NULL DEFAULT '未知人格',
        personality_desc            TEXT    NOT NULL DEFAULT '麻糬正在分析你的精神状态……',
        unfinished_task_weighted_sum REAL   NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS operation_log (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp    INTEGER NOT NULL,
        action_type  TEXT    NOT NULL,
        target_type  TEXT,
        target_id    INTEGER,
        details      TEXT,
        user_visible INTEGER NOT NULL DEFAULT 0,
        row_hash     TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_oplog_time ON operation_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_oplog_action ON operation_log(action_type);

      CREATE TABLE IF NOT EXISTS global_config (
        key        TEXT    PRIMARY KEY,
        value      TEXT    NOT NULL,
        value_type TEXT    NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS card_favorites (
        date         TEXT    PRIMARY KEY,
        favorited_at INTEGER NOT NULL,
        note         TEXT
      );
    `).catch(() => undefined);

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

    currentVersion = 3;
    await db.execAsync('PRAGMA user_version = 3;');
  }

  // ── Version 4: 可靠性批次新增（精准时间段记录与备份恢复点） ─────
  if (currentVersion < 4) {
    await db.execAsync(`
      -- 统一计时引擎：记录真实运行/暂停时间段
      CREATE TABLE IF NOT EXISTS timer_session_intervals (
        id            TEXT    PRIMARY KEY,
        session_id    TEXT    NOT NULL,
        interval_type TEXT    NOT NULL, -- 'run' | 'pause'
        start_ms      INTEGER NOT NULL,
        end_ms        INTEGER,          -- NULL=进行中
        duration_sec  INTEGER NOT NULL DEFAULT 0,
        created_at    INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_timer_intervals_session ON timer_session_intervals(session_id);

      -- 备份前置快照恢复点（支持原子恢复与失败回滚）
      CREATE TABLE IF NOT EXISTS backup_restore_points (
        id           TEXT    PRIMARY KEY,
        created_at   INTEGER NOT NULL,
        reason       TEXT    NOT NULL,
        snapshot_raw TEXT    NOT NULL
      );
    `);
    currentVersion = 4;
    await db.execAsync('PRAGMA user_version = 4;');
  }

  return currentVersion;
}

async function initDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  const isWeb = process.env.EXPO_OS === 'web';
  const dbName = isWeb ? ':memory:' : 'mochi_ddl.db';

  let db: SQLite.SQLiteDatabase;
  try {
    db = await SQLite.openDatabaseAsync(dbName);
  } catch (openErr) {
    if (isWeb) {
      db = await SQLite.openDatabaseAsync(':memory:');
      _health = {
        status: 'degraded_web_memory',
        isInMemory: true,
        storageType: 'in_memory',
        schemaVersion: 0,
        errorMessage: 'Web 环境使用内存临时数据库',
      };
    } else {
      // 移动端严禁静默 fallback 到 :memory:
      _health = {
        status: 'corrupted',
        isInMemory: false,
        storageType: 'sqlite_file',
        schemaVersion: 0,
        errorMessage: openErr instanceof Error ? openErr.message : String(openErr),
      };
      throw new Error(`[database] 移动端数据库打开失败: ${openErr instanceof Error ? openErr.message : String(openErr)}`);
    }
  }

  // PRD §4.10 SQLite 性能与安全配置
  if (!isWeb) {
    await db.execAsync(`PRAGMA journal_mode = WAL;`).catch(() => undefined);
    await db.execAsync(`PRAGMA synchronous = NORMAL;`).catch(() => undefined);
    await db.execAsync(`PRAGMA cache_size = -2000;`).catch(() => undefined);
  }
  await db.execAsync(`PRAGMA foreign_keys = ON;`).catch(() => undefined);

  // 执行版本化迁移
  try {
    const finalVersion = await runVersionedMigrations(db);
    _health = {
      status: isWeb ? 'degraded_web_memory' : 'ok',
      isInMemory: isWeb,
      storageType: isWeb ? 'in_memory' : 'sqlite_file',
      schemaVersion: finalVersion,
      errorMessage: isWeb ? 'Web 环境数据在刷新后不保留' : undefined,
    };
  } catch (migErr) {
    _health = {
      status: 'migration_failed',
      isInMemory: isWeb,
      storageType: isWeb ? 'in_memory' : 'sqlite_file',
      schemaVersion: 0,
      errorMessage: migErr instanceof Error ? migErr.message : String(migErr),
    };
    if (!isWeb) {
      throw new Error(`[database] 数据库迁移中断: ${migErr instanceof Error ? migErr.message : String(migErr)}`);
    }
  }

  // 冷启动维护：异步清理30天以上操作日志
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

/** 获取已初始化的 DB 实例 */
export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!_dbPromise) {
    _dbPromise = initDb().catch((err) => {
      _dbPromise = null;
      _db = null;
      throw err;
    });
  }
  return _dbPromise;
}

/** 尝试重新挂载初始化数据库 */
export async function retryDatabaseInit(): Promise<DatabaseHealth> {
  _dbPromise = null;
  _db = null;
  try {
    await getDb();
  } catch { /* 记录在 _health 中 */ }
  return getDatabaseHealth();
}

/** 清空重建数据库（灾难恢复操作） */
export async function resetAndRecreateDatabase(): Promise<void> {
  try {
    if (_db) {
      await _db.closeAsync().catch(() => undefined);
    }
  } catch {}
  _db = null;
  _dbPromise = null;

  if (process.env.EXPO_OS !== 'web') {
    try {
      await SQLite.deleteDatabaseAsync('mochi_ddl.db');
    } catch {}
  }
  await getDb();
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
