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

export type RatioKey = '9:16' | '3:4' | '1:1';

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

function preloadPath(date: string, ratio: RatioKey): string {
  return `${preloadDir()}${date}_${RATIO_FILE_KEY[ratio]}.png`;
}

async function ensurePreloadDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(preloadDir());
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(preloadDir(), { intermediates: true });
  }
}

// ── LRU 内存缓存池（§5.4）──────────────────────────────────────────────────

interface CacheEntry {
  date: string;
  images: Partial<Record<RatioKey, string>>; // file:// URI
  lastAccessedAt: number;
}

const MAX_MEMORY_ENTRIES = 3;
const memoryCache = new Map<string, CacheEntry>();

function evictIfNeeded(): void {
  if (memoryCache.size <= MAX_MEMORY_ENTRIES) return;
  // LRU 淘汰：移除 lastAccessedAt 最小的
  const sorted = Array.from(memoryCache.values()).sort(
    (a, b) => a.lastAccessedAt - b.lastAccessedAt,
  );
  const oldest = sorted[0];
  if (oldest) memoryCache.delete(oldest.date);
}

/** 从内存缓存读取 */
export function getFromMemory(date: string, ratio: RatioKey): string | undefined {
  const entry = memoryCache.get(date);
  if (entry) {
    entry.lastAccessedAt = Date.now();
    return entry.images[ratio];
  }
  return undefined;
}

/** 写入内存缓存 */
export function putToMemory(date: string, ratio: RatioKey, filePath: string): void {
  let entry = memoryCache.get(date);
  if (!entry) {
    entry = { date, images: {}, lastAccessedAt: Date.now() };
    memoryCache.set(date, entry);
  }
  entry.images[ratio] = filePath;
  entry.lastAccessedAt = Date.now();
  evictIfNeeded();
}

/** 清空内存缓存（App 切后台时调用，磁盘保留） */
export function clearMemoryCache(): void {
  memoryCache.clear();
}

// ── 磁盘缓存操作 ──────────────────────────────────────────────────────────────

/**
 * 从磁盘读取预缓存路径（存在则返回 file:// URI，否则 null）
 */
export async function getFromDisk(date: string, ratio: RatioKey): Promise<string | null> {
  const path = preloadPath(date, ratio);
  const info = await FileSystem.getInfoAsync(path);
  return info.exists ? path : null;
}

/**
 * 复制 tmpfile URI 到预缓存磁盘目录（captureRef 截图后调用）
 * @param tmpUri  captureRef 返回的 tmpfile URI
 * @param date    YYYY-MM-DD
 * @param ratio   宽高比
 * @returns       持久化后的 file:// URI
 */
export async function saveToDisk(
  tmpUri: string,
  date: string,
  ratio: RatioKey,
): Promise<string> {
  await ensurePreloadDir();
  const dest = preloadPath(date, ratio);
  const info = await FileSystem.getInfoAsync(dest);
  if (info.exists) {
    // 同日同比例已存在，直接覆盖
    await FileSystem.deleteAsync(dest, { idempotent: true });
  }
  await FileSystem.copyAsync({ from: tmpUri, to: dest });
  return dest;
}

/**
 * 统一读取：优先内存 → 磁盘 → null
 */
export async function getCachedCard(
  date: string,
  ratio: RatioKey,
): Promise<string | null> {
  const mem = getFromMemory(date, ratio);
  if (mem) return mem;
  const disk = await getFromDisk(date, ratio);
  if (disk) {
    putToMemory(date, ratio, disk); // 补填内存
    return disk;
  }
  return null;
}

/**
 * 写入磁盘 + 内存
 */
export async function putCachedCard(
  tmpUri: string,
  date: string,
  ratio: RatioKey,
): Promise<string> {
  const diskPath = await saveToDisk(tmpUri, date, ratio);
  putToMemory(date, ratio, diskPath);
  return diskPath;
}

// ── AppState 监听：切后台清空内存 ────────────────────────────────────────────

AppState.addEventListener('change', (nextState) => {
  if (nextState === 'background') {
    clearMemoryCache();
  }
});
