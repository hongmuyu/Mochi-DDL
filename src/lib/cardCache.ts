/**
 * 卡片图片缓存池（PRD §5.2 / §5.4）
 *
 * - 内存缓存：LRU，最多保留 3 条（date 维度），App 切后台即清
 * - 磁盘缓存：cards/preload/YYYY-MM-DD_9-16.png 等，不受内存限制
 * - 预生成 3 种比例（9:16 / 3:4 / 1:1）写入磁盘，切换比例瞬时响应
 * - AppState.background → 清空内存引用，磁盘保留（再次前台从磁盘读取）
 */
import { AppState } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { DataEventBus } from './dataEventBus';

export type RatioKey = '9:16' | '3:4' | '1:1';

// 全局动态数据版本号（任务/专注/修改变动时自增，使旧缓存自动失效）
let _currentDataVersion = 1;

export function incrementDataVersion(): number {
  _currentDataVersion++;
  return _currentDataVersion;
}

export function getDataVersion(): number {
  return _currentDataVersion;
}

// 比例 → 文件名安全 key
const RATIO_FILE_KEY: Record<RatioKey, string> = {
  '9:16': '9-16',
  '3:4':  '3-4',
  '1:1':  '1-1',
};

// ── 路径工具 ────────────────────────────────────────────────────────────────

function docDir(): string {
  return FileSystem.documentDirectory ?? '';
}

function preloadDir(): string {
  return `${docDir()}cards/preload/`;
}

function favoritesDir(): string {
  return `${docDir()}cards/favorites/`;
}

function preloadPath(date: string, ratio: RatioKey, version = _currentDataVersion): string {
  return `${preloadDir()}${date}_${RATIO_FILE_KEY[ratio]}_v${version}.png`;
}

async function ensureDirs(): Promise<void> {
  const pInfo = await FileSystem.getInfoAsync(preloadDir());
  if (!pInfo.exists) {
    await FileSystem.makeDirectoryAsync(preloadDir(), { intermediates: true });
  }
  const fInfo = await FileSystem.getInfoAsync(favoritesDir());
  if (!fInfo.exists) {
    await FileSystem.makeDirectoryAsync(favoritesDir(), { intermediates: true });
  }
}

// ── LRU 内存缓存池（§5.4）──────────────────────────────────────────────────

interface CacheEntry {
  date: string;
  version: number;
  images: Partial<Record<RatioKey, string>>; // file:// URI
  lastAccessedAt: number;
}

const MAX_MEMORY_ENTRIES = 5;
const memoryCache = new Map<string, CacheEntry>();

function evictIfNeeded(): void {
  if (memoryCache.size <= MAX_MEMORY_ENTRIES) return;
  const sorted = Array.from(memoryCache.values()).sort(
    (a, b) => a.lastAccessedAt - b.lastAccessedAt,
  );
  const oldest = sorted[0];
  if (oldest) memoryCache.delete(oldest.date);
}

/** 从内存缓存读取（严格匹配版本号） */
export function getFromMemory(date: string, ratio: RatioKey, version = _currentDataVersion): string | undefined {
  const entry = memoryCache.get(date);
  if (entry && entry.version === version) {
    entry.lastAccessedAt = Date.now();
    return entry.images[ratio];
  }
  return undefined;
}

/** 写入内存缓存 */
export function putToMemory(date: string, ratio: RatioKey, filePath: string, version = _currentDataVersion): void {
  let entry = memoryCache.get(date);
  if (!entry || entry.version !== version) {
    entry = { date, version, images: {}, lastAccessedAt: Date.now() };
    memoryCache.set(date, entry);
  }
  entry.images[ratio] = filePath;
  entry.lastAccessedAt = Date.now();
  evictIfNeeded();
}

/** 清空内存缓存（App 切后台或数据变更时调用） */
export function clearMemoryCache(): void {
  memoryCache.clear();
}

/**
 * 主动精准使日报动态预览缓存失效（任务/专注/修改发生时触发）
 */
export async function invalidateDailyCardCache(date?: string): Promise<void> {
  incrementDataVersion();
  if (date) {
    memoryCache.delete(date);
  } else {
    clearMemoryCache();
  }
  DataEventBus.emit('card_invalidated', { date });
}

// 监听数据事件总线，自动失效动态预览缓存
DataEventBus.subscribe('task_changed', () => {
  void invalidateDailyCardCache();
});
DataEventBus.subscribe('record_changed', (payload) => {
  void invalidateDailyCardCache(payload.date);
});
DataEventBus.subscribe('settings_changed', () => {
  void invalidateDailyCardCache();
});

// ── 磁盘缓存操作 ──────────────────────────────────────────────────────────────

/**
 * 从磁盘读取预缓存路径（存在则返回 file:// URI，否则 null）
 */
export async function getFromDisk(date: string, ratio: RatioKey, version = _currentDataVersion): Promise<string | null> {
  const path = preloadPath(date, ratio, version);
  const info = await FileSystem.getInfoAsync(path);
  return info.exists ? path : null;
}

/**
 * 复制 tmpfile URI 到预缓存磁盘目录（带版本号）
 */
export async function saveToDisk(
  tmpUri: string,
  date: string,
  ratio: RatioKey,
  version = _currentDataVersion,
): Promise<string> {
  await ensureDirs();
  const dest = preloadPath(date, ratio, version);
  const info = await FileSystem.getInfoAsync(dest);
  if (info.exists) {
    await FileSystem.deleteAsync(dest, { idempotent: true });
  }
  await FileSystem.copyAsync({ from: tmpUri, to: dest });
  return dest;
}

/**
 * 统一读取：优先内存 → 磁盘 → null（版本匹配）
 */
export async function getCachedCard(
  date: string,
  ratio: RatioKey,
  version = _currentDataVersion,
): Promise<string | null> {
  const mem = getFromMemory(date, ratio, version);
  if (mem) return mem;
  const disk = await getFromDisk(date, ratio, version);
  if (disk) {
    putToMemory(date, ratio, disk, version);
    return disk;
  }
  return null;
}

/**
 * 写入磁盘 + 内存（绑定当前数据版本）
 */
export async function putCachedCard(
  tmpUri: string,
  date: string,
  ratio: RatioKey,
  version = _currentDataVersion,
): Promise<string> {
  const diskPath = await saveToDisk(tmpUri, date, ratio, version);
  putToMemory(date, ratio, diskPath, version);
  return diskPath;
}

/**
 * 固化保存历史收藏快照（独立于普通缓存，永不被动态预览清理所删除）
 */
export async function saveFavoriteSnapshot(
  tmpUri: string,
  date: string,
  ratio: RatioKey,
): Promise<string> {
  await ensureDirs();
  const dest = `${favoritesDir()}fav_${date}_${RATIO_FILE_KEY[ratio]}_${Date.now()}.png`;
  await FileSystem.copyAsync({ from: tmpUri, to: dest });
  return dest;
}

// ── AppState 监听：切后台清空内存 ────────────────────────────────────────────

AppState.addEventListener('change', (nextState) => {
  if (nextState === 'background') {
    clearMemoryCache();
  }
});
