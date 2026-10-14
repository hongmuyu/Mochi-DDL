/**
 * 设备性能分级模块（PRD §7.3 / §14.3）
 *
 * 四个等级：
 *  - high       ：高端机（≥6GB RAM 或 deviceYearClass≥2021）
 *  - mid        ：中端机（≥3GB RAM 或 deviceYearClass≥2018）
 *  - low_end    ：低端机（<3GB RAM 或 deviceYearClass<2018）
 *  - power_save ：省电模式（最高优先级，覆盖其他等级）
 *
 * 判定结果写入 AsyncStorage 缓存（key: device_tier_cache），
 * 每次冷启动复用缓存，不重复检测。
 */
import * as Device from 'expo-device';
import * as Battery from 'expo-battery';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type DeviceTier = 'high' | 'mid' | 'low_end' | 'power_save';

const CACHE_KEY = 'device_tier_cache';
const GB = 1024 * 1024 * 1024;

/**
 * 检测省电模式（不缓存，实时读取）
 */
export async function isPowerSaveMode(): Promise<boolean> {
  if (process.env.EXPO_OS === 'web') return false;
  try {
    const state = await Battery.getPowerStateAsync();
    return state.lowPowerMode === true;
  } catch {
    return false;
  }
}

/**
 * 检测并返回设备等级
 * 省电模式 > 内存/年份检测 > 默认 mid
 */
export async function detectDeviceTier(skipCache = false): Promise<DeviceTier> {
  // 1. 省电模式（最高优先级，不缓存）
  const powerSave = await isPowerSaveMode();
  if (powerSave) return 'power_save';

  // 2. 读缓存
  if (!skipCache) {
    const cached = await AsyncStorage.getItem(CACHE_KEY);
    if (cached === 'high' || cached === 'mid' || cached === 'low_end') {
      return cached as DeviceTier;
    }
  }

  // 3. 运行时检测
  let tier: DeviceTier = 'mid';
  try {
    const totalRam = Device.totalMemory ?? 0;
    const yearClass = Device.deviceYearClass ?? 0;

    if (totalRam >= 6 * GB || yearClass >= 2021) {
      tier = 'high';
    } else if (totalRam >= 3 * GB || yearClass >= 2018) {
      tier = 'mid';
    } else if (totalRam > 0 && (totalRam < 3 * GB || (yearClass > 0 && yearClass < 2018))) {
      tier = 'low_end';
    }
  } catch {
    tier = 'mid';
  }

  await AsyncStorage.setItem(CACHE_KEY, tier);
  return tier;
}
