/**
 * 自定义语录数据库（本地 SQLite）
 * 表结构：quotes(id, text, is_active, is_builtin, season_tag, valid_from, valid_until, is_seasonal)
 * PRD §4.12.1：季节限定语录支持（season_tag/valid_from/valid_until/is_seasonal）
 */
import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Quote {
  id: number;
  text: string;
  is_active: boolean;
  is_builtin: boolean;
  /** 季节标签（如 'finals', 'valentine'），null 表示常驻语录 */
  season_tag: string | null;
  /** 生效日期 YYYY-MM-DD，null 表示永久生效 */
  valid_from: string | null;
  /** 失效日期 YYYY-MM-DD，null 表示永久生效 */
  valid_until: string | null;
  /** 0=常驻，1=季节限定（PRD §4.12.1） */
  is_seasonal: boolean;
}

// 10 条内置默认语录
const BUILTIN_QUOTES = [
  '再写两行，我就能光明正大地摸鱼了——战术性努力。',
  '今天只要打开文档，就算我对这个DDL有过诚意。',
  '先做五分钟，不行就逃——但万一我停不下来呢？',
  '这个DDL很难，但我的临时抱佛脚技能可是 Lv.99。',
  "摸鱼够了，现在让'限时版高效的我'上线5分钟。",
  '写完这一part，奖励自己刷一个短视频——就一个。',
  '我不一定会做完，但我一定会开始（大概）。',
  '能爬起来面对今天，已经很对得起昨晚熬夜的自己了。',
  "不需要完美，只需要'算了先交一版'。",
  '管他结果如何，做完就是英雄。',
];

// 数据库初始化 Promise（单例，Web 环境优先使用 :memory: 避免 OPFS 权限错误）
let _dbPromise: Promise<SQLite.SQLiteDatabase | null> | null = null;

function getQuotesDb(): Promise<SQLite.SQLiteDatabase | null> {
  if (_dbPromise) return _dbPromise;
  _dbPromise = (async () => {
    try {
      const dbName = process.env.EXPO_OS === 'web' ? ':memory:' : 'quotes.db';
      let db: SQLite.SQLiteDatabase;
      try {
        db = await SQLite.openDatabaseAsync(dbName);
      } catch {
        db = await SQLite.openDatabaseAsync(':memory:');
      }
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS quotes (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          text        TEXT    NOT NULL,
          is_active   INTEGER NOT NULL DEFAULT 1,
          is_builtin  INTEGER NOT NULL DEFAULT 0,
          season_tag  TEXT    DEFAULT NULL,
          valid_from  TEXT    DEFAULT NULL,
          valid_until TEXT    DEFAULT NULL,
          is_seasonal INTEGER NOT NULL DEFAULT 0
        );
      `);
      // 兼容旧版本：若季节字段不存在则 ALTER TABLE 添加（PRD §4.12.1）
      await db.execAsync(`ALTER TABLE quotes ADD COLUMN season_tag  TEXT    DEFAULT NULL;`).catch(() => undefined);
      await db.execAsync(`ALTER TABLE quotes ADD COLUMN valid_from  TEXT    DEFAULT NULL;`).catch(() => undefined);
      await db.execAsync(`ALTER TABLE quotes ADD COLUMN valid_until TEXT    DEFAULT NULL;`).catch(() => undefined);
      await db.execAsync(`ALTER TABLE quotes ADD COLUMN is_seasonal INTEGER NOT NULL DEFAULT 0;`).catch(() => undefined);

      // 内置语录仅初始化一次
      const rows = await db.getAllAsync<{ cnt: number }>('SELECT COUNT(*) as cnt FROM quotes WHERE is_builtin = 1;');
      if (rows[0]?.cnt === 0) {
        for (const text of BUILTIN_QUOTES) {
          await db.runAsync(
            'INSERT INTO quotes (text, is_active, is_builtin) VALUES (?, 1, 1);',
            [text],
          );
        }
      }
      return db;
    } catch (e) {
      console.warn('[quotesDb] init failed, falling back to built-in quotes:', e);
      return null;
    }
  })();
  return _dbPromise;
}

/** 将数据库行转换为 Quote 对象 */
function rowToQuote(r: {
  id: number; text: string; is_active: number; is_builtin: number;
  season_tag: string | null; valid_from: string | null;
  valid_until: string | null; is_seasonal: number;
}): Quote {
  return {
    id:          r.id,
    text:        r.text,
    is_active:   r.is_active === 1,
    is_builtin:  r.is_builtin === 1,
    season_tag:  r.season_tag ?? null,
    valid_from:  r.valid_from ?? null,
    valid_until: r.valid_until ?? null,
    is_seasonal: r.is_seasonal === 1,
  };
}

/** 获取所有语录（含季节字段） */
export async function getAllQuotes(): Promise<Quote[]> {
  const db = await getQuotesDb();
  if (!db) {
    return BUILTIN_QUOTES.map((text, idx) => ({
      id: idx + 1,
      text,
      is_active: true,
      is_builtin: true,
      season_tag: null,
      valid_from: null,
      valid_until: null,
      is_seasonal: false,
    }));
  }
  const rows = await db.getAllAsync<{
    id: number; text: string; is_active: number; is_builtin: number;
    season_tag: string | null; valid_from: string | null; valid_until: string | null; is_seasonal: number;
  }>(
    'SELECT id, text, is_active, is_builtin, season_tag, valid_from, valid_until, is_seasonal FROM quotes ORDER BY id ASC;',
  );
  return rows.map(rowToQuote);
}

/**
 * 获取随机一条激励语录
 * @param onlyMine  若 true，只从用户自定义（非内置）中抽取
 * @param today     当前日期 YYYY-MM-DD（用于过滤已失效的季节限定语录）
 * @returns 语录文本或降级文案
 */
export async function getRandomQuote(onlyMine = false, today?: string): Promise<string> {
  const db = await getQuotesDb();
  if (!db) {
    if (onlyMine) return '暂无自定义语录~';
    return BUILTIN_QUOTES[Math.floor(Math.random() * BUILTIN_QUOTES.length)];
  }
  const dateStr = today ?? localDateStr();
  // 过滤：激活 + (常驻 OR (季节限定 AND 在有效期内))
  let query = `
    SELECT text FROM quotes
    WHERE is_active = 1
      AND (
        is_seasonal = 0
        OR (
          is_seasonal = 1
          AND (valid_from IS NULL OR valid_from <= ?)
          AND (valid_until IS NULL OR valid_until >= ?)
        )
      )
  `;
  const params: (string | number)[] = [dateStr, dateStr];
  if (onlyMine) {
    query += ' AND is_builtin = 0';
  }
  query += ';';
  const rows = await db.getAllAsync<{ text: string }>(query, params);
  if (rows.length === 0) return '麻糬暂时词穷了，快去添加新语录吧~';
  return rows[Math.floor(Math.random() * rows.length)].text;
}

// ── 今日语录（当日固定，不随刷新/切页变化） ────────────────────

const TODAY_QUOTE_KEY = 'ddlife_daily_quote_cache';

/** 本地日期字符串 YYYY-MM-DD（避免 toISOString 的 UTC 跨日偏移） */
function localDateStr(d = new Date()): string {
  const yyyy = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${MM}-${dd}`;
}

/**
 * 获取"今日激励语录"：当天首次调用时抽取一条并持久化缓存，
 * 之后无论刷新页面/切换标签多少次，同一天内始终返回同一条；
 * 跨天或"仅使用我的语录"开关变化时才重新抽取。
 */
export async function getTodayQuote(onlyMine = false): Promise<string> {
  const today = localDateStr();
  try {
    const raw = await AsyncStorage.getItem(TODAY_QUOTE_KEY);
    if (raw) {
      const cached = JSON.parse(raw) as { date: string; onlyMine: boolean; text: string };
      if (cached.date === today && cached.onlyMine === onlyMine && cached.text) {
        return cached.text;
      }
    }
  } catch {
    // 缓存读取失败时忽略，走重新抽取
  }
  const text = await getRandomQuote(onlyMine, today);
  try {
    await AsyncStorage.setItem(TODAY_QUOTE_KEY, JSON.stringify({ date: today, onlyMine, text }));
  } catch {
    // 缓存写入失败不影响返回
  }
  return text;
}

/** 添加用户自定义语录 */
export async function addQuote(text: string): Promise<void> {
  const db = await getQuotesDb();
  if (!db) return;
  await db.runAsync('INSERT INTO quotes (text, is_active, is_builtin) VALUES (?, 1, 0);', [text.trim()]);
}

/**
 * 添加季节限定语录（PRD §4.12.1）
 */
export async function addSeasonalQuote(
  text: string,
  seasonTag: string,
  validFrom?: string,
  validUntil?: string,
): Promise<void> {
  const db = await getQuotesDb();
  if (!db) return;
  await db.runAsync(
    `INSERT INTO quotes (text, is_active, is_builtin, season_tag, valid_from, valid_until, is_seasonal)
     VALUES (?, 1, 0, ?, ?, ?, 1);`,
    [text.trim(), seasonTag, validFrom ?? null, validUntil ?? null],
  );
}

/** 编辑语录文本 */
export async function updateQuoteText(id: number, text: string): Promise<void> {
  const db = await getQuotesDb();
  if (!db) return;
  await db.runAsync('UPDATE quotes SET text = ? WHERE id = ?;', [text.trim(), id]);
}

/** 切换激活状态 */
export async function toggleQuoteActive(id: number, active: boolean): Promise<void> {
  const db = await getQuotesDb();
  if (!db) return;
  await db.runAsync('UPDATE quotes SET is_active = ? WHERE id = ?;', [active ? 1 : 0, id]);
}

/** 删除语录 */
export async function deleteQuote(id: number): Promise<void> {
  const db = await getQuotesDb();
  if (!db) return;
  await db.runAsync('DELETE FROM quotes WHERE id = ?;', [id]);
}

// ── 导入/导出 ──────────────────────────────────────────────

/** 导出用户自定义语录为 JSON 文件，返回文件 URI */
export async function exportUserQuotes(): Promise<string> {
  const db = await getQuotesDb();
  if (!db) throw new Error('数据库暂不可用');
  const rows = await db.getAllAsync<{ text: string }>(
    'SELECT text FROM quotes WHERE is_builtin = 0;',
  );
  const texts = rows.map(r => r.text);
  const today = new Date();
  const yyyy = today.getFullYear();
  const MM = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const filename = `mochi_quotes_${yyyy}${MM}${dd}.json`;
  const uri = FileSystem.documentDirectory + filename;
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(texts, null, 2), {
    encoding: FileSystem.EncodingType.UTF8,
  });
  return uri;
}

/** 从 JSON 文件导入语录（合并模式，重复文本自动去重）*/
export async function importQuotesFromFile(): Promise<{ added: number; skipped: number }> {
  const result = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
  if (result.canceled) return { added: 0, skipped: 0 };

  const asset = result.assets[0];
  const content = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.UTF8 });
  const texts: unknown = JSON.parse(content);
  if (!Array.isArray(texts)) throw new Error('文件格式错误，需要 JSON 数组');

  const db = await getQuotesDb();
  if (!db) return { added: 0, skipped: texts.length };
  let added = 0;
  let skipped = 0;
  for (const t of texts) {
    if (typeof t !== 'string' || !t.trim()) { skipped++; continue; }
    const text = t.trim();
    const existing = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM quotes WHERE text = ?;', [text],
    );
    if (existing) { skipped++; continue; }
    await db.runAsync('INSERT INTO quotes (text, is_active, is_builtin) VALUES (?, 1, 0);', [text]);
    added++;
  }
  return { added, skipped };
}

/** 读取"仅使用我的语录"开关（AsyncStorage） */
const ONLY_MINE_KEY = 'ddlife_quotes_only_mine';

export async function getOnlyMine(): Promise<boolean> {
  const v = await AsyncStorage.getItem(ONLY_MINE_KEY);
  return v === '1';
}

export async function setOnlyMine(v: boolean): Promise<void> {
  await AsyncStorage.setItem(ONLY_MINE_KEY, v ? '1' : '0');
}
