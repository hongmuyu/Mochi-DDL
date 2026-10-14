/**
 * 设备性能 React Context（PRD §7.3）
 *
 * 在 App 根组件初始化时注入 deviceTier。
 * 所有动画组件消费该 Context，根据 tier 决定渲染路径。
 *
 * 同时监听省电模式变化，实时切换到 power_save（无需重启 App）。
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import * as Battery from 'expo-battery';
import { DeviceTier, detectDeviceTier, isPowerSaveMode } from '@/lib/performanceProfile';

interface PerformanceCtx {
  /** 当前设备等级 */
  tier: DeviceTier;
  /** 是否已完成检测（false 时降级到 mid 渲染） */
  ready: boolean;
}

const PerformanceContext = createContext<PerformanceCtx>({ tier: 'mid', ready: false });

export function usePerformanceTier(): DeviceTier {
  return useContext(PerformanceContext).tier;
}

/**
 * 分级效果判断工具 —— 方便各组件快速决策
 */
export function usePerformanceFlags() {
  const tier = usePerformanceTier();
  return {
    tier,
    /** 是否启用 Rive/复杂动画（高/中端非省电） */
    animEnabled: tier === 'high' || tier === 'mid',
    /** 是否全量粒子（高端） */
    fullParticles: tier === 'high',
    /** 是否启用贴纸错位 / 文字歪斜（高/中端） */
    stickerEnabled: tier === 'high' || tier === 'mid',
    /** 省电或低端 → 只用静态帧 */
    staticOnly: tier === 'low_end' || tier === 'power_save',
  };
}

export function PerformanceProvider({ children }: { children: React.ReactNode }) {
  const [tier, setTier] = useState<DeviceTier>('mid');
  const [ready, setReady] = useState(false);
  const subscriptionRef = useRef<Battery.Subscription | null>(null);

  const refresh = useCallback(async () => {
    const t = await detectDeviceTier();
    setTier(t);
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();

    // 监听省电模式变化（无需重启 App；Web 环境不支持 Battery.addBatteryStateListener）
    if (process.env.EXPO_OS !== 'web' && typeof Battery.addBatteryStateListener === 'function') {
      try {
        subscriptionRef.current = Battery.addBatteryStateListener(async (_event: Battery.BatteryStateEvent) => {
          // BatteryStateEvent 只含充电状态，省电模式需另行读取
          const ps = await Battery.getPowerStateAsync();
          if (ps.lowPowerMode) {
            setTier('power_save');
          } else {
            const updated = await detectDeviceTier(true);
            setTier(updated);
          }
        });
      } catch {
        // Web 或无电量模块设备静默降级
      }
    }

    return () => {
      subscriptionRef.current?.remove();
    };
  }, [refresh]);

  return (
    <PerformanceContext.Provider value={{ tier, ready }}>
      {children}
    </PerformanceContext.Provider>
  );
}
