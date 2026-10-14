/**
 * 历史卡片沙盒存储管理（CARD_HISTORY_STORAGE_SPEC §2–§4）
 *
 * 目录结构：
 *   FileSystem.documentDirectory/
 *     cards/          ← 普通卡片（30天自动清理）
 *     cards_favorite/ ← 收藏卡片（永久保留）
 */
import * as FileSystem from 'expo-file-system/legacy';
import { isCardFavorite } from '@/db/api';

// ── 路径工具 ─────────────────────────────────────────────────────────────────

/** documentDirectory 保证非 null（沙盒环境下始终存在） */
function docDir(): string {
  return FileSystem.documentDirectory ?? `${FileSystem.cacheDirectory ?? ''}../Documents/`;
}

function cardsDir(): string {
  return `${docDir()}cards/`;
}

function favoriteDir(): string {
  return `${docDir()}cards_favorite/`;
}

/** 普通区文件路径 */
function cardPath(date: string): string {
  return `${cardsDir()}${date}.png`;
}

/** 收藏区文件路径 */
function favoritePath(date: string): string {
  return `${favoriteDir()}${date}.png`;
}

/** 确保目录存在 */
async function ensureDir(path: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(path, { intermediates: true });
  }
}

// ── 核心写入 ─────────────────────────────────────────────────────────────────

/**
 * 保存卡片 PNG 到 App 私有沙盒（SPEC §3.1 双写策略中的沙盒写入步骤）
 * @param tmpUri  react-native-view-shot 生成的 tmpfile URI
 * @param date    YYYY-MM-DD
 */
export async function saveCardToSandbox(tmpUri: string, date: string): Promise<void> {
  await ensureDir(cardsDir());
  const dest = cardPath(date);
  await FileSystem.copyAsync({ from: tmpUri, to: dest });
}

// ── 读取 ─────────────────────────────────────────────────────────────────────

/**
 * 获取指定日期卡片的可用 URI（先查普通区，再查收藏区）
 * @returns file:// URI 或 null（文件不存在/已过期删除）
 */
export async function getCardImageUri(date: string): Promise<string | null> {
  const normal = cardPath(date);
  const fav    = favoritePath(date);

  const [ni, fi] = await Promise.all([
    FileSystem.getInfoAsync(normal),
    FileSystem.getInfoAsync(fav),
  ]);

  if (ni.exists) return normal;
  if (fi.exists) return fav;
  return null;
}

// ── 收藏文件迁移 ──────────────────────────────────────────────────────────────

/**
 * 将图片从普通区移动到收藏区（收藏操作时调用）
 */
export async function moveToFavorite(date: string): Promise<void> {
  await ensureDir(favoriteDir());
  const src  = cardPath(date);
  const dest = favoritePath(date);
  const info = await FileSystem.getInfoAsync(src);
  if (info.exists) {
    await FileSystem.moveAsync({ from: src, to: dest });
  }
}

/**
 * 将图片从收藏区移回普通区，若已超过30天则直接删除（取消收藏时调用）
 */
export async function moveFromFavorite(date: string): Promise<void> {
  const src  = favoritePath(date);
  const info = await FileSystem.getInfoAsync(src);
  if (!info.exists) return;

  const ageDays = Math.floor((Date.now() - Date.parse(date)) / 86_400_000);
  if (ageDays > 30) {
    await FileSystem.deleteAsync(src, { idempotent: true });
  } else {
    await ensureDir(cardsDir());
    await FileSystem.moveAsync({ from: src, to: cardPath(date) });
  }
}

// ── 30 天自动清理 ─────────────────────────────────────────────────────────────

/**
 * 冷启动时异步扫描 cards/ 目录，删除超过30天的非收藏图片（SPEC §4）
 * 调用方：冷启动5秒后静默执行，不阻塞 UI
 */
export async function cleanExpiredCardImages(): Promise<void> {
  const dir     = cardsDir();
  const dirInfo = await FileSystem.getInfoAsync(dir);
  if (!dirInfo.exists) return;

  let names: string[];
  try {
    names = await FileSystem.readDirectoryAsync(dir);
  } catch {
    return;
  }

  await ensureDir(favoriteDir());

  for (const name of names) {
    if (!name.endsWith('.png')) continue;
    const date = name.replace('.png', '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const ageDays = Math.floor((Date.now() - Date.parse(date)) / 86_400_000);
    if (ageDays <= 30) continue;

    const filePath = `${dir}${name}`;
    try {
      const fav = await isCardFavorite(date);
      if (fav) {
        // 超期且已收藏 → 迁移到收藏区
        const dest     = favoritePath(date);
        const destInfo = await FileSystem.getInfoAsync(dest);
        if (!destInfo.exists) {
          await FileSystem.moveAsync({ from: filePath, to: dest });
        } else {
          await FileSystem.deleteAsync(filePath, { idempotent: true });
        }
      } else {
        await FileSystem.deleteAsync(filePath, { idempotent: true });
      }
    } catch {
      // 单文件处理失败不影响其他文件
    }
  }
}
