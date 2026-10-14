/**
 * MochiWidget — 麻糬吉祥物组件（PRD §1.1 / §1.3 / §1.4 / §7.3）
 *
 * 状态优先级（高→低）：
 *  1. completed   : 今日有任务完成（限时 8s，自动复位）
 *  2. near_dead   : HP < 10%（灰白濒死，最高警戒）
 *  3. red_hot     : HP<50 或 SAN<50 或存在红温DDL（红温/危险）
 *  4. idle_tired  : HP<70 或 SAN<70（有点累）
 *  5. idle_happy  : 默认精神良好
 *
 * 性能分级（来自 PerformanceContext）：
 *  - high / mid : 全动画（弹跳 + 颤抖 + 光晕）
 *  - low_end / power_save : 静态帧，仅更换表情+颜色
 *
 * 用法：
 *  <MochiWidget hp={spirit.lifePoints} san={spirit.sanityPoints}
 *    karma={spirit.meritPoints} hasCompletedToday={someFlag}
 *    hasRedHotDDL={dangerousTasks.length > 0}
 *    onPress={handleMascotPress} size={120} />
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { usePerformanceFlags } from '@/ctx/PerformanceContext';

// ─── 状态类型 ─────────────────────────────────────────────────────
export type MochiState =
  | 'idle_happy'
  | 'idle_tired'
  | 'red_hot'
  | 'near_dead'
  | 'completed';

// ─── 每种状态的配色与表情 ─────────────────────────────────────────
interface StateConfig {
  /** 大表情 emoji */
  face: string;
  /** 身体主色 */
  bodyColor: string;
  /** 高光色 */
  highlightColor: string;
  /** 脸颊色 */
  blushColor: string;
  /** 状态标签 */
  label: string;
  /** 描述文字 */
  desc: string;
}

const STATE_CONFIG: Record<MochiState, StateConfig> = {
  idle_happy: {
    face: '(≧∇≦)',
    bodyColor: '#FFE8F0',
    highlightColor: '#FFC0D0',
    blushColor: '#FF9EAE',
    label: '状态良好',
    desc: '戴小花，蹦蹦跳跳~',
  },
  idle_tired: {
    face: '(-_-；)',
    bodyColor: '#EDE8F8',
    highlightColor: '#C8BEF0',
    blushColor: '#9B8FD8',
    label: '有点累',
    desc: '黑眼圈出现，发呆发呆',
  },
  red_hot: {
    face: '(╬◣д◢)',
    bodyColor: '#FFD4C0',
    highlightColor: '#FF9870',
    blushColor: '#FF5E7C',
    label: '红温中！',
    desc: '全身橙红，头顶冒蒸汽 💨',
  },
  near_dead: {
    face: '(×_×)',
    bodyColor: '#E8E8E8',
    highlightColor: '#C0C0C0',
    blushColor: '#999999',
    label: '濒死警告',
    desc: '脸色灰白，偶尔抽搐…👻',
  },
  completed: {
    face: '(￣∇￣)',
    bodyColor: '#C8F0E0',
    highlightColor: '#80E0B8',
    blushColor: '#2EC4B6',
    label: '摊成一滩',
    desc: '任务完成，满足地瘫着 🎵',
  },
};

// ─── 状态机优先级判定 ──────────────────────────────────────────────
export function resolveMochiState(opts: {
  hp: number;
  san: number;
  karma: number;
  hasCompletedToday: boolean;
  hasRedHotDDL: boolean;
}): MochiState {
  const { hp, san, hasCompletedToday, hasRedHotDDL } = opts;
  if (hasCompletedToday) return 'completed';
  if (hp < 10) return 'near_dead';
  if (hp < 50 || san < 50 || hasRedHotDDL) return 'red_hot';
  if (hp < 70 || san < 70) return 'idle_tired';
  return 'idle_happy';
}

// ─── 主组件 Props ─────────────────────────────────────────────────
interface MochiWidgetProps {
  hp: number;
  san: number;
  karma: number;
  hasCompletedToday: boolean;
  hasRedHotDDL: boolean;
  onPress?: () => void;
  /** 组件整体尺寸（默认 120） */
  size?: number;
}

export default function MochiWidget({
  hp,
  san,
  karma,
  hasCompletedToday,
  hasRedHotDDL,
  onPress,
  size = 120,
}: MochiWidgetProps) {
  const { animEnabled, staticOnly } = usePerformanceFlags();

  const state = resolveMochiState({ hp, san, karma, hasCompletedToday, hasRedHotDDL });
  const cfg = STATE_CONFIG[state];

  // ── 动画值 ────────────────────────────────────────────────────
  const bounceY     = useSharedValue(0);
  const scalePress  = useSharedValue(1);
  const shakeX      = useSharedValue(0);
  const glowOpacity = useSharedValue(0);
  // "摊成一滩" 时身体扁平化
  const flattenY    = useSharedValue(1);
  const flattenX    = useSharedValue(1);
  // 近死时抽搐
  const twitchRot   = useSharedValue(0);

  // 记录前一状态，用于状态切换时重置动画
  const prevStateRef = useRef<MochiState>(state);

  useEffect(() => {
    if (staticOnly) return;

    // 重置所有
    cancelAnimation(bounceY);
    cancelAnimation(shakeX);
    cancelAnimation(glowOpacity);
    cancelAnimation(flattenY);
    cancelAnimation(flattenX);
    cancelAnimation(twitchRot);

    prevStateRef.current = state;

    switch (state) {
      case 'idle_happy':
        bounceY.value = withRepeat(
          withSequence(
            withTiming(-6, { duration: 550 }),
            withTiming(0, { duration: 550 }),
          ), -1, true,
        );
        glowOpacity.value = withTiming(0, { duration: 300 });
        flattenY.value = withSpring(1); flattenX.value = withSpring(1);
        twitchRot.value = withTiming(0);
        break;

      case 'idle_tired':
        bounceY.value = withRepeat(
          withSequence(
            withTiming(-2, { duration: 900 }),
            withTiming(0, { duration: 900 }),
          ), -1, true,
        );
        glowOpacity.value = withTiming(0, { duration: 300 });
        flattenY.value = withSpring(0.92); flattenX.value = withSpring(1.05);
        twitchRot.value = withTiming(0);
        break;

      case 'red_hot':
        bounceY.value = withRepeat(
          withSequence(
            withTiming(-8, { duration: 220 }),
            withTiming(0, { duration: 220 }),
          ), -1, true,
        );
        glowOpacity.value = withRepeat(
          withSequence(
            withTiming(0.6, { duration: 350 }),
            withTiming(0.2, { duration: 350 }),
          ), -1, true,
        );
        flattenY.value = withSpring(1.08); flattenX.value = withSpring(0.95);
        twitchRot.value = withTiming(0);
        break;

      case 'near_dead':
        bounceY.value = withRepeat(
          withSequence(
            withTiming(-1, { duration: 1800 }),
            withTiming(0, { duration: 1800 }),
          ), -1, true,
        );
        // 每 2s 轻微抽搐
        twitchRot.value = withRepeat(
          withSequence(
            withTiming(0, { duration: 1500 }),
            withTiming(3, { duration: 80 }),
            withTiming(-3, { duration: 80 }),
            withTiming(0, { duration: 80 }),
          ), -1, false,
        );
        glowOpacity.value = withTiming(0, { duration: 300 });
        flattenY.value = withSpring(0.88); flattenX.value = withSpring(1.1);
        break;

      case 'completed':
        // 摊成一滩动画
        flattenY.value = withSpring(0.35, { damping: 8, stiffness: 180 });
        flattenX.value = withSpring(1.5, { damping: 8, stiffness: 180 });
        bounceY.value = withTiming(8, { duration: 300 });
        glowOpacity.value = withRepeat(
          withSequence(
            withTiming(0.5, { duration: 600 }),
            withTiming(0.1, { duration: 600 }),
          ), -1, true,
        );
        twitchRot.value = withTiming(0);
        break;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, staticOnly]);

  // ── 点击弹跳 ──────────────────────────────────────────────────
  const handlePress = () => {
    if (!staticOnly) {
      scalePress.value = withSequence(withSpring(1.35), withSpring(1));
    }
    onPress?.();
  };

  // ── 动画样式 ──────────────────────────────────────────────────
  const bodyStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: bounceY.value },
      { scaleX: flattenX.value * scalePress.value },
      { scaleY: flattenY.value * scalePress.value },
      { rotate: `${twitchRot.value}deg` },
    ],
  }));
  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  const bodySize   = size;
  const faceSize   = size * 0.36;
  const blushSize  = size * 0.12;

  // ── 渲染 ─────────────────────────────────────────────────────
  return (
    <Pressable onPress={handlePress} style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ width: bodySize, height: bodySize, alignItems: 'center', justifyContent: 'center' }, animEnabled ? bodyStyle : {}]}>

        {/* 发光光晕（高/中端非省电时显示） */}
        {animEnabled && (
          <Animated.View style={[{
            position: 'absolute',
            width: bodySize * 1.2,
            height: bodySize * 1.2,
            borderRadius: bodySize * 0.6,
            backgroundColor: cfg.bodyColor,
          }, glowStyle]} />
        )}

        {/* 身体主球 */}
        <View style={{
          width: bodySize,
          height: bodySize,
          borderRadius: bodySize / 2,
          backgroundColor: cfg.bodyColor,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 2.5,
          borderColor: cfg.highlightColor,
          // 发光阴影
          boxShadow: state === 'red_hot'
            ? [{ offsetX: 0, offsetY: 0, blurRadius: 18, color: `${cfg.blushColor}66` }]
            : [{ offsetX: 0, offsetY: 4, blurRadius: 14, color: 'rgba(0,0,0,0.1)' }],
        }}>

          {/* 高光点 */}
          <View style={{
            position: 'absolute',
            top: bodySize * 0.12,
            left: bodySize * 0.18,
            width: bodySize * 0.22,
            height: bodySize * 0.13,
            borderRadius: bodySize * 0.07,
            backgroundColor: 'rgba(255,255,255,0.55)',
            transform: [{ rotate: '-20deg' }],
          }} />

          {/* 脸颊红晕 × 2 */}
          <View style={{
            position: 'absolute',
            bottom: bodySize * 0.28,
            left: bodySize * 0.1,
            width: blushSize,
            height: blushSize * 0.65,
            borderRadius: blushSize * 0.5,
            backgroundColor: `${cfg.blushColor}70`,
          }} />
          <View style={{
            position: 'absolute',
            bottom: bodySize * 0.28,
            right: bodySize * 0.1,
            width: blushSize,
            height: blushSize * 0.65,
            borderRadius: blushSize * 0.5,
            backgroundColor: `${cfg.blushColor}70`,
          }} />

          {/* 表情文字 */}
          <Animated.Text style={{
            fontSize: faceSize,
            textAlign: 'center',
            // near_dead 时表情变灰
            opacity: state === 'near_dead' ? 0.7 : 1,
          }}>
            {cfg.face}
          </Animated.Text>

          {/* completed 状态：旁边的小音响 🎵 */}
          {state === 'completed' && (
            <Animated.Text style={{
              position: 'absolute',
              top: bodySize * 0.04,
              right: -bodySize * 0.15,
              fontSize: bodySize * 0.22,
            }}>
              🎵
            </Animated.Text>
          )}

          {/* near_dead 状态：头顶小幽灵 */}
          {state === 'near_dead' && animEnabled && (
            <GhostFloat size={bodySize * 0.28} />
          )}

          {/* red_hot / near_dead 状态：蒸汽 */}
          {(state === 'red_hot') && animEnabled && (
            <Animated.Text style={{
              position: 'absolute',
              top: -bodySize * 0.12,
              fontSize: bodySize * 0.2,
            }}>
              💨
            </Animated.Text>
          )}
        </View>

        {/* idle_happy 时头上的小花 */}
        {state === 'idle_happy' && (
          <Animated.Text style={{
            position: 'absolute',
            top: -bodySize * 0.08,
            fontSize: bodySize * 0.2,
          }}>
            🌸
          </Animated.Text>
        )}
      </Animated.View>
    </Pressable>
  );
}

// ── 幽灵漂浮子组件（near_dead 时使用）────────────────────────────
function GhostFloat({ size }: { size: number }) {
  const floatY = useSharedValue(0);
  useEffect(() => {
    floatY.value = withRepeat(
      withSequence(
        withTiming(-8, { duration: 900 }),
        withTiming(0, { duration: 900 }),
      ), -1, true,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: floatY.value }],
  }));
  return (
    <Animated.Text style={[{
      position: 'absolute',
      top: -size * 1.2,
      fontSize: size,
    }, style]}>
      👻
    </Animated.Text>
  );
}

// ─── 导出状态配置（供 home.tsx 使用标签/描述）─────────────────────
export { STATE_CONFIG };

// ─── 便捷 hook：返回当前吉祥物状态元数据 ─────────────────────────
export function useMochiMeta(state: MochiState) {
  return STATE_CONFIG[state];
}

// ─── completed_today 触发 hook（8s 后自动复位）────────────────────
export function useCompletedTodayTrigger(): {
  hasCompletedToday: boolean;
  triggerCompleted: () => void;
} {
  const [hasCompletedToday, setHasCompletedToday] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerCompleted = () => {
    setHasCompletedToday(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    // 8s 后自动切回常态（可重触发）
    timerRef.current = setTimeout(() => setHasCompletedToday(false), 8000);
  };

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { hasCompletedToday, triggerCompleted };
}
