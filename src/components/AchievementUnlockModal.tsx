/**
 * PRD §3.7.2 / §6.1 成就解锁动画
 * 全屏弹出大贴纸，啪一下盖在屏幕上，可拖拽 + 截图分享
 * §6.2 设备性能分级：高端完整动画+confetti / 中端简化 / 低端静态
 */
import { useEffect, useRef, useCallback } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import { Achievement } from '@/lib/achievements';
import { usePerformanceFlags } from '@/ctx/PerformanceContext';

// ── confetti 粒子颜色
const CONFETTI_COLORS = ['#FF5E7C', '#FFD166', '#6C63FF', '#2EC4B6', '#FF9A3C', '#A8E063'];

// ── 单个 confetti 粒子（独立动画，入场后自由下落消失）
function ConfettiParticle({ idx, tier }: { idx: number; tier: 'high' | 'mid' }) {
  const startX = -40 + Math.random() * 380;     // 横向随机起点
  const delay  = Math.random() * 400;
  const dur    = tier === 'high' ? 900 + Math.random() * 600 : 700 + Math.random() * 400;
  const color  = CONFETTI_COLORS[idx % CONFETTI_COLORS.length];
  const size   = 6 + Math.round(Math.random() * 6);
  const rotate = Math.random() * 360;

  const ty      = useSharedValue(0);
  const opacity = useSharedValue(1);

  useEffect(() => {
    ty.value      = withDelay(delay, withTiming(360, { duration: dur }));
    opacity.value = withDelay(delay + dur * 0.5, withTiming(0, { duration: dur * 0.5 }));
  }, [delay, dur, opacity, ty]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: ty.value }, { rotate: `${rotate + ty.value * 0.5}deg` }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[{
        position: 'absolute',
        left: startX,
        top: 40,
        width: size,
        height: size * (tier === 'high' ? 1.6 : 1),
        backgroundColor: color,
        borderRadius: tier === 'high' ? 2 : 0,
      }, style]}
    />
  );
}

interface Props {
  achievement: Achievement | null;
  onDismiss: () => void;
}

export default function AchievementUnlockModal({ achievement, onDismiss }: Props) {
  // §6.2 性能分级
  const { staticOnly, animEnabled } = usePerformanceFlags();
  const confettiCount = staticOnly ? 0 : animEnabled ? 40 : 20;
  const confettiTier: 'high' | 'mid' = animEnabled ? 'high' : 'mid';

  // ── 贴纸入场动画
  const scale     = useSharedValue(0);
  const rotate    = useSharedValue(-15);
  const opacity   = useSharedValue(0);
  const bgOpacity = useSharedValue(0);

  // ── §6.1 拖拽
  const tx       = useSharedValue(0);
  const ty       = useSharedValue(0);
  const dragging = useSharedValue(false);  // 长按后激活拖拽

  // ── §6.1 分享截图 ref
  const stickerRef = useRef<View>(null);
  const [sharing, setSharing] = [useSharedValue(false), useCallback((v: boolean) => {}, [])];
  void sharing; void setSharing; // suppressed — use normal state via ref
  const isSharingRef = useRef(false);

  useEffect(() => {
    if (!achievement) return;

    // 重置
    scale.value = 0; rotate.value = -15; opacity.value = 0; bgOpacity.value = 0;
    tx.value = 0; ty.value = 0; dragging.value = false;

    if (staticOnly) {
      // 低端设备：直接显示，无动画
      scale.value   = 1;
      opacity.value = 1;
      bgOpacity.value = withTiming(1, { duration: 150 });
    } else {
      // 背景渐入
      bgOpacity.value = withTiming(1, { duration: 200 });
      // 贴纸"啪"一下
      scale.value = withSequence(
        withSpring(1.15, { damping: 6, stiffness: 300 }),
        withSpring(1.0,  { damping: 12, stiffness: 200 }),
      );
      rotate.value = withSequence(
        withSpring(8,  { damping: 6, stiffness: 300 }),
        withSpring(-3, { damping: 10, stiffness: 200 }),
        withSpring(0,  { damping: 14, stiffness: 180 }),
      );
      opacity.value = withTiming(1, { duration: 80 });
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [achievement, bgOpacity, dragging, opacity, rotate, scale, staticOnly, tx, ty]);

  const handleDismiss = useCallback(() => {
    if (staticOnly) {
      bgOpacity.value = withTiming(0, { duration: 150 }, (finished) => {
        if (finished) runOnJS(onDismiss)();
      });
    } else {
      scale.value     = withTiming(0, { duration: 200 });
      opacity.value   = withTiming(0, { duration: 200 });
      bgOpacity.value = withDelay(100, withTiming(0, { duration: 150 }, (finished) => {
        if (finished) runOnJS(onDismiss)();
      }));
    }
  }, [bgOpacity, onDismiss, opacity, scale, staticOnly]);

  // §6.1 长按激活拖拽
  const longPressGesture = Gesture.LongPress()
    .minDuration(350)
    .onStart(() => {
      if (staticOnly) return;
      dragging.value = true;
      scale.value = withSpring(1.08, { damping: 10 });
    });

  // §6.1 平移拖拽（高/中端启用）
  const panGesture = Gesture.Pan()
    .enabled(!staticOnly)
    .onUpdate((e) => {
      if (!dragging.value) return;
      tx.value = e.translationX;
      ty.value = e.translationY;
    })
    .onEnd(() => {
      dragging.value = false;
      if (animEnabled) {
        // 高端：弹性回位
        tx.value = withSpring(0, { damping: 14, stiffness: 160 });
        ty.value = withSpring(0, { damping: 14, stiffness: 160 });
      } else {
        // 中端：直接回位
        tx.value = withTiming(0, { duration: 200 });
        ty.value = withTiming(0, { duration: 200 });
      }
      scale.value = withSpring(1.0, { damping: 12 });
    });

  const combinedGesture = Gesture.Simultaneous(longPressGesture, panGesture);

  // §6.1 截图分享
  const handleShare = useCallback(async () => {
    if (isSharingRef.current || !stickerRef.current) return;
    isSharingRef.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const quality = staticOnly ? 0.7 : animEnabled ? 1 : 0.85;
      const uri = await captureRef(stickerRef, {
        format: 'png',
        quality,
        result: 'tmpfile',
        width: staticOnly ? 720 : animEnabled ? 1080 : 900,
        height: staticOnly ? 720 : animEnabled ? 1080 : 900,
      });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          dialogTitle: `分享成就「${achievement?.title ?? ''}」`,
        });
      }
    } catch { /* 分享失败静默处理 */ } finally {
      isSharingRef.current = false;
    }
  }, [achievement, animEnabled, staticOnly]);

  // ── 动画样式
  const stickerStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
      { rotate: `${rotate.value}deg` },
    ],
    opacity: opacity.value,
  }));

  const bgStyle = useAnimatedStyle(() => ({ opacity: bgOpacity.value }));

  if (!achievement) return null;

  return (
    <Modal transparent animationType="none" visible={!!achievement} onRequestClose={handleDismiss}>
      <Animated.View style={[{
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.55)',
        alignItems: 'center',
        justifyContent: 'center',
      }, bgStyle]}>

        {/* §6.2 confetti 粒子层（高/中端） */}
        {confettiCount > 0 && (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} pointerEvents="none">
            {Array.from({ length: confettiCount }).map((_, i) => (
              <ConfettiParticle key={i} idx={i} tier={confettiTier} />
            ))}
          </View>
        )}

        {/* 点击背景关闭 */}
        <Pressable
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          onPress={handleDismiss}
        />

        {/* §6.1 长按拖拽包装 */}
        <GestureDetector gesture={combinedGesture}>
          {/* §6.1 截图区域 ref（1:1 正方形） */}
          <Animated.View style={[{ alignItems: 'center' }, stickerStyle]}>
            <View
              ref={stickerRef}
              collapsable={false}
              style={{
                backgroundColor: '#FFFDF2',
                borderRadius: staticOnly ? 8 : 32,
                paddingVertical: 40,
                paddingHorizontal: 36,
                alignItems: 'center',
                width: 280,
                height: 280,
                justifyContent: 'center',
                borderWidth: 3,
                borderColor: '#FFD166',
                ...(staticOnly ? {} : {
                  boxShadow: [
                    { offsetX: 0, offsetY: 6, blurRadius: 32, color: 'rgba(255,209,102,0.45)' },
                    { offsetX: 0, offsetY: 2, blurRadius: 8,  color: 'rgba(0,0,0,0.15)' },
                  ],
                }),
              }}
            >
              {/* 胶带装饰（高/中端） */}
              {!staticOnly && (
                <>
                  <View style={{
                    position: 'absolute', top: -10, left: 28,
                    width: 44, height: 16, backgroundColor: 'rgba(255,209,102,0.55)',
                    borderRadius: 4, transform: [{ rotate: '-8deg' }],
                  }} />
                  <View style={{
                    position: 'absolute', top: -8, right: 32,
                    width: 36, height: 14, backgroundColor: 'rgba(110,99,255,0.35)',
                    borderRadius: 4, transform: [{ rotate: '6deg' }],
                  }} />
                </>
              )}

              {/* 解锁标签 */}
              <View style={{
                backgroundColor: '#FF5E7C',
                borderRadius: 99, paddingHorizontal: 14, paddingVertical: 5,
                marginBottom: 12,
              }}>
                <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: 'bold', letterSpacing: 1 }}>
                  🎉 成就解锁！
                </Text>
              </View>

              {/* 大 emoji 贴纸 */}
              <Text style={{ fontSize: 72, marginBottom: 10 }}>{achievement.emoji}</Text>

              {/* 成就名称 */}
              <Text style={{
                color: '#333333', fontSize: 18, fontWeight: 'bold',
                textAlign: 'center', marginBottom: 6,
              }}>
                《{achievement.title}》
              </Text>

              {/* 解锁条件（截图内显示） */}
              <Text style={{
                color: '#888888', fontSize: 11, textAlign: 'center', lineHeight: 16,
              }}>
                {achievement.condition}
              </Text>
            </View>

            {/* 操作提示（截图外） */}
            <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, marginTop: 12 }}>
              {staticOnly ? '点击背景关闭' : '长按可拖拽 · 点击背景关闭'}
            </Text>

            {/* §6.1 分享按钮 */}
            <Pressable
              onPress={handleShare}
              style={{
                marginTop: 14,
                backgroundColor: '#FF5E7C',
                borderRadius: 99,
                paddingHorizontal: 32,
                paddingVertical: 12,
                ...(staticOnly ? {} : {
                  boxShadow: [{ offsetX: 0, offsetY: 4, blurRadius: 12, color: 'rgba(255,94,124,0.4)' }],
                }),
              }}
            >
              <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: 'bold' }}>
                📤 分享这枚成就
              </Text>
            </Pressable>
          </Animated.View>
        </GestureDetector>
      </Animated.View>
    </Modal>
  );
}
