import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  Modal,
  KeyboardAvoidingView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {
  getAllTasks,
  getDeletedTasks,
  createTask,
  completeTask,
  uncompleteTask,
  restoreTask,
  deleteTask,
  archiveDeleteTask,
  permanentlyDeleteTask,
  clearTrash,
  overtimeCompleteTask,
  addDeletePenalty,
  reverseDeletePenalty,
  updateTask,
  postponeTask,
  toggleSubTask,
  addSubTask,
  deleteSubTask,
} from '@/db/api';
import { getEmptyStateType, getEmptyStateConfig, sortCompletedTasksByTime } from '@/lib/deadlineUtils';
import {
  getDangerLevel,
  getDangerColor,
  getDangerLabel,
  getHealthBarPercent,
  formatTimeRemaining,
  getPriorityLabel,
  generateICS,
  formatLocalDateKey,
  getWeekDates,
} from '@/lib/ddl';
import * as Notifications from 'expo-notifications';
import { syncAllNotifications, cancelTaskNotifications, scheduleTaskNotifications } from '@/lib/notifications';
import { Task, SubTask, RepeatRule } from '@/types/types';
import {
  WEEK_LABELS,
  formatDeadlineDisplay,
  setDateKeepTime,
  setTimeKeepDate,
  getShortcutDate,
  type CalendarCell,
  generateCalendarGrid,
} from '@/lib/deadlineUtils';

export {
  WEEK_LABELS,
  formatDeadlineDisplay,
  setDateKeepTime,
  setTimeKeepDate,
  getShortcutDate,
  type CalendarCell,
  generateCalendarGrid,
};

// 多巴胺配色
const C_BG = '#FFFDF2';
const C_PINK = '#FF5E7C';
const C_PURPLE = '#6C63FF';
const C_YELLOW = '#FFD166';
const C_MINT = '#2EC4B6';
const C_RED = '#FF003C';
const C_TEXT = '#333333';
const C_MUTED = '#888888';

// ─── 左滑删除容器 ───────────────────────────────────────────────
const SWIPE_REVEAL = 82;   // 露出宽度
const SWIPE_TRIGGER = -68; // 超过此距离松手后卡住露出按钮
const SWIPE_AUTO   = -160; // 超过此距离松手后直接触发删除

function SwipeableRow({
  children,
  onDelete,
  borderRadius = 20,
  marginBottom = 10,
}: {
  children: React.ReactNode;
  onDelete: () => void;
  borderRadius?: number;
  marginBottom?: number;
}) {
  const tx = useSharedValue(0);

  const pan = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .failOffsetY([-12, 12])
    .onUpdate(e => {
      tx.value = Math.min(0, Math.max(e.translationX, -220));
    })
    .onEnd(e => {
      if (e.translationX < SWIPE_AUTO) {
        // 快速甩出后自动删除
        tx.value = withTiming(-400, { duration: 220 }, () => runOnJS(onDelete)());
      } else if (e.translationX < SWIPE_TRIGGER) {
        tx.value = withSpring(-SWIPE_REVEAL, { damping: 18, stiffness: 200 });
      } else {
        tx.value = withSpring(0, { damping: 18, stiffness: 200 });
      }
    });

  const cardStyle  = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));
  // 删除区随滑动渐显
  const underlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [0, -30], [0, 1], Extrapolation.CLAMP),
    width: interpolate(tx.value, [-SWIPE_REVEAL, -220], [SWIPE_REVEAL, 220], Extrapolation.CLAMP),
  }));

  return (
    <View style={{ position: 'relative', marginBottom }}>
      {/* 红色删除底层 */}
      <Animated.View style={[{
        position: 'absolute', right: 0, top: 0, bottom: 0,
        backgroundColor: C_PINK,
        borderRadius,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 2,
      }, underlayStyle]}>
        <Text style={{ fontSize: 20 }}>🗑️</Text>
        <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>删除</Text>
      </Animated.View>
      {/* 卡片层 */}
      <GestureDetector gesture={pan}>
        <Animated.View style={cardStyle}>
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

// 彩色纸花粒子
interface Confetti {
  id: number;
  x: number;
  color: string;
  delay: number;
}

// ─── §1.6 压线完成：卡片裂开动画 ────────────────────────────────
// rush = 距离 deadline ≤ 1 小时时完成任务
// 动画：左右两块碎片向外飞出 + 涂鸦叠加层
function CrackAnimation({ visible, onDone }: { visible: boolean; onDone: () => void }) {
  const leftX   = useSharedValue(0);
  const rightX  = useSharedValue(0);
  const leftRot = useSharedValue(0);
  const rightRot= useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (!visible) {
      opacity.value = 0;
      leftX.value = 0; rightX.value = 0;
      leftRot.value = 0; rightRot.value = 0;
      return;
    }
    // 进场
    opacity.value = withTiming(1, { duration: 100 });
    // 裂开：左右碎片各飞出 ~120px 并旋转
    leftX.value  = withSequence(
      withTiming(-8,  { duration: 60 }),
      withTiming(-120, { duration: 380 }),
    );
    leftRot.value = withSequence(
      withTiming(-5,  { duration: 60 }),
      withTiming(-22, { duration: 380 }),
    );
    rightX.value  = withSequence(
      withTiming(8,   { duration: 60 }),
      withTiming(120, { duration: 380 }),
    );
    rightRot.value = withSequence(
      withTiming(5,   { duration: 60 }),
      withTiming(22,  { duration: 380 }),
    );
    // 整体淡出
    opacity.value = withSequence(
      withTiming(1, { duration: 200 }),
      withTiming(0, { duration: 340, }, () => runOnJS(onDone)()),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const leftStyle  = useAnimatedStyle(() => ({
    transform: [{ translateX: leftX.value }, { rotate: `${leftRot.value}deg` }],
    opacity: opacity.value,
  }));
  const rightStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: rightX.value }, { rotate: `${rightRot.value}deg` }],
    opacity: opacity.value,
  }));

  if (!visible) return null;
  return (
    <View style={{
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      pointerEvents: 'none', zIndex: 120,
      flexDirection: 'row',
      overflow: 'hidden',
    }}>
      {/* 左碎片 */}
      <Animated.View style={[{
        flex: 1, height: '100%',
        backgroundColor: 'rgba(255,94,124,0.18)',
        borderLeftWidth: 2,
        borderTopLeftRadius: 20,
        borderBottomLeftRadius: 20,
        borderColor: C_PINK,
        alignItems: 'center',
        justifyContent: 'center',
      }, leftStyle]}>
        <Text style={{ fontSize: 32, opacity: 0.7 }}>💥</Text>
      </Animated.View>
      {/* 右碎片 */}
      <Animated.View style={[{
        flex: 1, height: '100%',
        backgroundColor: 'rgba(108,99,255,0.18)',
        borderRightWidth: 2,
        borderTopRightRadius: 20,
        borderBottomRightRadius: 20,
        borderColor: C_PURPLE,
        alignItems: 'center',
        justifyContent: 'center',
      }, rightStyle]}>
        <Text style={{ fontSize: 32, opacity: 0.7 }}>✨</Text>
      </Animated.View>
    </View>
  );
}

// ─── §1.6 随机涂鸦叠加层 ────────────────────────────────────────
const DOODLES = ['✏️', '⚡', '💫', '🌀', '🎯', '🔥', '💣', '🖊️'];
interface DoodleDot { id: number; emoji: string; x: number; y: number; rot: number; size: number }

function DoodleOverlay({ visible }: { visible: boolean }) {
  const dots: DoodleDot[] = Array.from({ length: 6 }, (_, i) => ({
    id: i,
    emoji: DOODLES[Math.floor(Math.random() * DOODLES.length)],
    x: 10 + Math.random() * 80,  // % of container width
    y: 5  + Math.random() * 80,
    rot: (Math.random() - 0.5) * 60,
    size: 14 + Math.floor(Math.random() * 14),
  }));
  const opacity = useSharedValue(0);
  useEffect(() => {
    if (!visible) { opacity.value = withTiming(0, { duration: 200 }); return; }
    opacity.value = withSequence(
      withTiming(1, { duration: 150 }),
      withTiming(0.85, { duration: 300 }),
      withTiming(0, { duration: 350 }),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  if (!visible) return null;
  return (
    <Animated.View style={[{
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      pointerEvents: 'none', zIndex: 121,
    }, style]}>
      {dots.map(d => (
        <Text key={d.id} style={{
          position: 'absolute',
          left: `${d.x}%`,
          top: `${d.y}%`,
          fontSize: d.size,
          transform: [{ rotate: `${d.rot}deg` }],
        }}>{d.emoji}</Text>
      ))}
    </Animated.View>
  );
}

function ConfettiBurst({ visible }: { visible: boolean }) {
  const colors = [C_PINK, C_PURPLE, C_YELLOW, C_MINT, '#FF8C00'];
  const particles: Confetti[] = Array.from({ length: 16 }, (_, i) => ({
    id: i,
    x: 20 + (i % 8) * 46,
    color: colors[i % colors.length],
    delay: i * 40,
  }));
  if (!visible) return null;
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 200, pointerEvents: 'none', zIndex: 99 }}>
      {particles.map(p => (
        <ConfettiParticle key={p.id} x={p.x} color={p.color} delay={p.delay} />
      ))}
    </View>
  );
}

function ConfettiParticle({ x, color, delay }: { x: number; color: string; delay: number }) {
  const y = useSharedValue(0);
  const opacity = useSharedValue(1);
  useEffect(() => {
    const timeout = setTimeout(() => {
      y.value = withTiming(180, { duration: 900 });
      opacity.value = withTiming(0, { duration: 900 });
    }, delay);
    return () => clearTimeout(timeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
    opacity: opacity.value,
  }));
  return (
    <Animated.View style={[{
      position: 'absolute',
      left: x,
      top: 8,
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: color,
    }, style]} />
  );
}

/** 自动播放的完成盖章动画（无拖拽，完成后自动出现并消失） */
function DoneStamp({ onDismiss }: { onDismiss: () => void }) {
  const stampScale = useSharedValue(0);
  const stampOpacity = useSharedValue(0);
  const stampRotate = useSharedValue(-30);

  useEffect(() => {
    // 盖章落下动画
    stampScale.value = withSequence(
      withTiming(1.3, { duration: 120 }),
      withTiming(0.9, { duration: 80 }),
      withTiming(1, { duration: 60 }),
    );
    stampOpacity.value = withTiming(1, { duration: 100 });
    stampRotate.value = withTiming(-12, { duration: 150 });
    runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Heavy);
    // 1.2秒后自动消失
    const timer = setTimeout(() => {
      runOnJS(onDismiss)();
    }, 1200);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stampStyle = useAnimatedStyle(() => ({
    position: 'absolute',
    left: 0,
    right: 0,
    top: '35%' as any,
    alignItems: 'center' as any,
    justifyContent: 'center' as any,
    zIndex: 200,
    opacity: stampOpacity.value,
    transform: [{ scale: stampScale.value }, { rotate: `${stampRotate.value}deg` }],
  }));

  return (
    <Animated.View style={stampStyle}>
      <View style={{
        width: 120,
        height: 120,
        borderRadius: 60,
        borderWidth: 4,
        borderColor: '#6C63FF',
        backgroundColor: 'rgba(108,99,255,0.15)',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: [{ offsetX: 0, offsetY: 4, blurRadius: 20, color: 'rgba(108,99,255,0.4)' }],
      }}>
        <Text style={{ fontSize: 40 }}>💜</Text>
        <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#6C63FF', marginTop: 4, letterSpacing: 2 }}>
          已通关!
        </Text>
      </View>
    </Animated.View>
  );
}
function getCardColor(level: string): { bg: string; border: string; text: string } {
  switch (level) {
    case 'safe':    return { bg: '#F0FFFE', border: C_MINT,   text: C_MINT };
    case 'warning': return { bg: '#FFFBEA', border: C_YELLOW, text: '#CC9900' };
    case 'danger':  return { bg: '#FFF5EC', border: '#FF8C00', text: '#FF8C00' };
    case 'critical': return { bg: '#FFF0F4', border: C_PINK,  text: C_PINK };
    case 'dying':   return { bg: '#FFF0F4', border: C_RED,    text: C_RED };
    default:        return { bg: '#F0FFFE', border: C_MINT,   text: C_MINT };
  }
}

// 计算Boss等级（根据剩余时间百分比）
function getBossLevel(percent: number): number {
  return Math.max(1, Math.round(100 - percent));
}

// 等级对应星星
function getLevelStars(level: DangerLevelStr): string {
  switch (level) {
    case 'dying':    return '⭐⭐⭐⭐⭐';
    case 'critical': return '⭐⭐⭐⭐';
    case 'danger':   return '⭐⭐⭐';
    case 'warning':  return '⭐⭐';
    default:         return '⭐';
  }
}

type DangerLevelStr = 'safe' | 'warning' | 'danger' | 'critical' | 'dying';

// 任务卡片（Boss战风格）
function TaskCard({
  task,
  onComplete,
  onUncomplete,
  onDelete,
  onOvertimeComplete,
  onEdit,
  onCopy,
  onPostpone,
  onToggleSubTask,
  onAddSubTask,
  onDeleteSubTask,
}: {
  task: Task;
  onComplete: (id: string, deadline: string) => void;
  onUncomplete?: (id: string) => void;
  onDelete: (id: string) => void;
  onOvertimeComplete: (id: string) => void;
  onEdit: (task: Task) => void;
  onCopy?: (task: Task) => void;
  onPostpone?: (task: Task) => void;
  onToggleSubTask?: (taskId: string, subtaskId: string) => void;
  onAddSubTask?: (taskId: string, title: string) => void;
  onDeleteSubTask?: (taskId: string, subtaskId: string) => void;
}) {
  // 传入优先级以启用优先级加成危险等级
  const dangerLevel = getDangerLevel(task.deadline, task.priority) as DangerLevelStr;
  const cardColors = getCardColor(dangerLevel);
  const percent = getHealthBarPercent(task.deadline, task.created_at);
  const bossLevel = getBossLevel(percent);
  const stars = getLevelStars(dangerLevel);
  const timeLeft = formatTimeRemaining(task.deadline);
  const isOverdue = timeLeft === '已过期';
  const isHighPriority = task.priority === 3;

  // 子任务折叠与快速输入状态
  const [subtasksOpen, setSubtasksOpen] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');

  const subtasks = task.subtasks || [];
  const completedSubtasksCount = subtasks.filter(s => s.completed).length;
  const totalSubtasksCount = subtasks.length;
  const subtaskPercent = totalSubtasksCount > 0 ? Math.round((completedSubtasksCount / totalSubtasksCount) * 100) : 0;

  // 濒死时晃动
  const shakeX = useSharedValue(0);
  const blinkOp = useSharedValue(1);
  useEffect(() => {
    if (dangerLevel === 'dying' && !task.completed) {
      shakeX.value = withRepeat(
        withSequence(
          withTiming(3, { duration: 70 }),
          withTiming(-3, { duration: 70 }),
          withTiming(0, { duration: 70 }),
        ),
        -1, false,
      );
      blinkOp.value = withRepeat(
        withSequence(withTiming(0.5, { duration: 300 }), withTiming(1, { duration: 300 })),
        -1, true,
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dangerLevel, task.completed]);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shakeX.value }] }));
  const blinkStyle = useAnimatedStyle(() => ({ opacity: blinkOp.value }));

  // 已完成任务专属展示
  if (task.completed) {
    return (
      <View style={{
        backgroundColor: '#F3FAF7',
        borderRadius: 20,
        borderWidth: 2,
        borderColor: '#2D2A26',
        padding: 14,
        marginBottom: 10,
        opacity: 0.95,
        boxShadow: [{ offsetX: 2, offsetY: 2, blurRadius: 0, color: '#2D2A26' }],
      }}>
        {/* 已通关印章标识 */}
        <View style={{
          position: 'absolute',
          top: 10,
          right: 10,
          width: 56,
          height: 56,
          borderRadius: 28,
          borderWidth: 3,
          borderColor: '#6C63FF',
          backgroundColor: 'rgba(108,99,255,0.1)',
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ rotate: '-12deg' }],
        }}>
          <Text style={{ fontSize: 20 }}>💜</Text>
          <Text style={{ fontSize: 8, fontWeight: 'bold', color: '#6C63FF', marginTop: 1, letterSpacing: 0.5 }}>
            已通关
          </Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, marginRight: 62 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', flex: 1 }}>
            <View style={{ backgroundColor: C_MINT, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 3 }}>
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: 'bold' }}>
                {task.completion_type === 'rush' ? '⚡ 压线达成' : task.completion_type === 'overtime' ? '📝 超时补完' : '✅ 按时达成'}
              </Text>
            </View>
            {task.category ? (
              <View style={{ backgroundColor: '#E4EAE6', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 }}>
                <Text style={{ color: '#446655', fontSize: 10, fontWeight: '600' }}>🏷️ {task.category}</Text>
              </View>
            ) : null}
            {task.repeat_rule && task.repeat_rule !== 'none' && (
              <View style={{ backgroundColor: '#EDE9FF', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 }}>
                <Text style={{ color: C_PURPLE, fontSize: 10, fontWeight: 'bold' }}>
                  🔁 {task.repeat_rule === 'daily' ? '每日重复' : task.repeat_rule === 'weekly' ? '每周重复' : '每月重复'}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* 完成时间信息 */}
        <View style={{ marginBottom: 6 }}>
          <Text style={{ color: C_MUTED, fontSize: 11 }}>
            📅 完成于 {task.completed_at ? new Date(task.completed_at).toLocaleString('zh-CN', { 
              month: 'numeric', 
              day: 'numeric', 
              hour: '2-digit', 
              minute: '2-digit' 
            }) : '刚刚'}
          </Text>
        </View>

        <Text style={{ color: '#444', fontSize: 16, fontWeight: 'bold', textDecorationLine: 'line-through', marginBottom: 4 }}>
          {task.name}
        </Text>
        {task.note ? (
          <Text style={{ color: C_MUTED, fontSize: 12, marginBottom: 8, lineHeight: 16 }}>
            📝 {task.note}
          </Text>
        ) : null}

        {totalSubtasksCount > 0 && (
          <Text style={{ color: C_MUTED, fontSize: 11, marginBottom: 6 }}>
            🎯 子任务已全部达成 ({totalSubtasksCount}/{totalSubtasksCount})
          </Text>
        )}

        <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              onUncomplete?.(task.id);
            }}
            style={{
              flex: 2,
              backgroundColor: '#E8F5E9',
              borderRadius: 12,
              paddingVertical: 9,
              alignItems: 'center',
              borderWidth: 1.5,
              borderColor: '#2E7D32',
            }}
          >
            <Text style={{ color: '#2E7D32', fontSize: 13, fontWeight: 'bold' }}>↩️ 取消完成</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onDelete(task.id);
            }}
            style={{
              flex: 1,
              backgroundColor: '#F5F5F5',
              borderRadius: 12,
              paddingVertical: 9,
              alignItems: 'center',
              borderWidth: 1.5,
              borderColor: '#2D2A26',
            }}
          >
            <Text style={{ color: C_MUTED, fontSize: 13 }}>删除</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <Animated.View style={[{
      backgroundColor: isOverdue ? '#F5F3EE' : cardColors.bg,
      borderRadius: 20,
      borderWidth: isHighPriority ? 2.5 : 2,
      borderColor: isOverdue ? '#D0C8B8' : (isHighPriority ? '#F0A500' : cardColors.border),
      padding: 14,
      marginBottom: 10,
      opacity: isOverdue ? 0.85 : 1,
      boxShadow: isHighPriority && !isOverdue
        ? `0 2px 12px rgba(240,165,0,0.35)`
        : `0 2px 8px ${cardColors.border}33`,
    }, dangerLevel === 'dying' && !isOverdue ? shakeStyle : {}]}>

      {/* 高优先级金色顶部装饰条 */}
      {isHighPriority && !isOverdue && (
        <View style={{
          position: 'absolute',
          top: 0, left: 0, right: 0,
          height: 3,
          backgroundColor: '#F0A500',
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
        }} />
      )}

      {/* 过期标记横幅 */}
      {isOverdue && (
        <View style={{
          backgroundColor: '#E8E2D8', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3,
          alignSelf: 'flex-start', marginBottom: 8,
          flexDirection: 'row', alignItems: 'center', gap: 4,
        }}>
          <Text style={{ color: '#888', fontSize: 10, fontWeight: 'bold' }}>⏰ 已过期</Text>
        </View>
      )}

      {/* 头部：Boss等级 + 优先级 + 分类 + 重复规则 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {!isOverdue && (
            <View style={{ backgroundColor: cardColors.border, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 3 }}>
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: 'bold' }}>
                {getDangerLabel(dangerLevel)}
              </Text>
            </View>
          )}
          <View style={{
            backgroundColor: isHighPriority ? 'rgba(240,165,0,0.15)' : '#F5F2EE',
            borderRadius: 99,
            paddingHorizontal: 8,
            paddingVertical: 2,
            borderWidth: isHighPriority ? 1 : 0,
            borderColor: isHighPriority ? '#F0A500' : 'transparent',
          }}>
            <Text style={{
              fontSize: 10,
              color: isHighPriority ? '#C07800' : C_MUTED,
              fontWeight: isHighPriority ? 'bold' : 'normal',
            }}>
              {isHighPriority ? '🔥 ' : ''}{getPriorityLabel(task.priority)}
            </Text>
          </View>
          {task.category ? (
            <View style={{ backgroundColor: '#F0EDFF', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ color: C_PURPLE, fontSize: 10, fontWeight: '600' }}>🏷️ {task.category}</Text>
            </View>
          ) : null}
          {task.repeat_rule && task.repeat_rule !== 'none' && (
            <View style={{ backgroundColor: '#EDE9FF', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ color: C_PURPLE, fontSize: 10, fontWeight: 'bold' }}>
                🔁 {task.repeat_rule === 'daily' ? '每日' : task.repeat_rule === 'weekly' ? '每周' : '每月'}
              </Text>
            </View>
          )}
          {task.reminder_offset ? (
            <View style={{ backgroundColor: '#FFF0F4', borderRadius: 99, paddingHorizontal: 6, paddingVertical: 2 }}>
              <Text style={{ color: C_PINK, fontSize: 9, fontWeight: 'bold' }}>🔔 提前{task.reminder_offset >= 1440 ? `${Math.floor(task.reminder_offset / 1440)}天` : `${Math.floor(task.reminder_offset / 60)}h`}</Text>
            </View>
          ) : null}
        </View>
        {!isOverdue && <Text style={{ fontSize: 13 }}>{stars}</Text>}
      </View>

      {/* 任务名称 */}
      <Text style={{ color: isOverdue ? '#888' : C_TEXT, fontSize: 17, fontWeight: 'bold', marginBottom: 4 }}>
        {isOverdue ? '💤 ' : '⚠ '}{task.name}
      </Text>
      {!isOverdue && (
        <Text style={{ color: cardColors.text, fontSize: 12, fontWeight: 'bold', marginBottom: 6 }}>
          Lv.{bossLevel}
        </Text>
      )}

      {/* 任务备注 */}
      {task.note ? (
        <Text style={{ color: '#666', fontSize: 12, marginBottom: 8, lineHeight: 16 }}>
          📝 {task.note}
        </Text>
      ) : null}

      {/* 心理提前截止提示 */}
      {task.cutoff_deadline && !isOverdue ? (
        <View style={{
          backgroundColor: 'rgba(108,99,255,0.08)',
          borderRadius: 8,
          paddingHorizontal: 8,
          paddingVertical: 4,
          marginBottom: 8,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
        }}>
          <Text style={{ color: C_PURPLE, fontSize: 11, fontWeight: '600' }}>
            🎯 心理目标：{new Date(task.cutoff_deadline).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      ) : null}

      {/* 果汁血条 */}
      {!isOverdue && (
        <View style={{
          height: 10,
          backgroundColor: '#F0EDE0',
          borderRadius: 999,
          marginBottom: 6,
          overflow: 'hidden',
          borderWidth: isHighPriority ? 0.5 : 0,
          borderColor: isHighPriority ? '#F0A500' : 'transparent',
        }}>
          <View style={{
            width: `${percent}%`,
            height: '100%',
            backgroundColor: cardColors.border,
            borderRadius: 999,
          }} />
        </View>
      )}

      {/* 剩余时间 / 过期时间 */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <Text style={{ color: C_MUTED, fontSize: 11 }}>
          ⏰ 真实截止：{new Date(task.deadline).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </Text>
        {!isOverdue && (
          <Animated.Text style={[{
            color: cardColors.text,
            fontSize: 13,
            fontWeight: 'bold',
          }, dangerLevel === 'dying' ? blinkStyle : undefined]}>
            {`剩余生命：${timeLeft}`}
          </Animated.Text>
        )}
      </View>

      {/* 子任务进度条与展开清单 */}
      {(totalSubtasksCount > 0 || subtasksOpen) && (
        <View style={{
          backgroundColor: '#FFFFFF',
          borderRadius: 12,
          padding: 8,
          marginBottom: 10,
          borderWidth: 1,
          borderColor: '#E8E0D0',
        }}>
          <Pressable
            onPress={() => setSubtasksOpen(prev => !prev)}
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
              <Text style={{ color: C_PURPLE, fontSize: 12, fontWeight: '700' }}>
                🎯 子任务 ({completedSubtasksCount}/{totalSubtasksCount})
              </Text>
              {totalSubtasksCount > 0 && (
                <View style={{ flex: 1, height: 6, backgroundColor: '#E8E0D0', borderRadius: 3, overflow: 'hidden', maxWidth: 80 }}>
                  <View style={{ width: `${subtaskPercent}%`, height: '100%', backgroundColor: C_PURPLE }} />
                </View>
              )}
            </View>
            <Text style={{ color: C_MUTED, fontSize: 11 }}>
              {subtasksOpen ? '收起 ▲' : '查看清单 ▼'}
            </Text>
          </Pressable>

          {subtasksOpen && (
            <View style={{ marginTop: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#F0EAE0' }}>
              {subtasks.map(st => (
                <View key={st.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 }}>
                  <Pressable
                    onPress={() => onToggleSubTask?.(task.id, st.id)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}
                  >
                    <View style={{
                      width: 18, height: 18, borderRadius: 5,
                      borderWidth: 1.5, borderColor: st.completed ? C_MINT : '#C0B8A8',
                      backgroundColor: st.completed ? C_MINT : '#FFF',
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      {st.completed && <Text style={{ color: '#fff', fontSize: 11, fontWeight: 'bold' }}>✓</Text>}
                    </View>
                    <Text style={{
                      fontSize: 13, color: st.completed ? C_MUTED : C_TEXT,
                      textDecorationLine: st.completed ? 'line-through' : 'none', flex: 1,
                    }}>
                      {st.title}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => onDeleteSubTask?.(task.id, st.id)}
                    style={{ paddingHorizontal: 6, paddingVertical: 2 }}
                  >
                    <Text style={{ color: '#AAA', fontSize: 12 }}>✕</Text>
                  </Pressable>
                </View>
              ))}

              {/* 快捷新增子任务行 */}
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
                <TextInput
                  value={newSubtaskTitle}
                  onChangeText={setNewSubtaskTitle}
                  placeholder="添加子任务项…"
                  placeholderTextColor={C_MUTED}
                  style={{
                    flex: 1, backgroundColor: '#F8F6F0', borderRadius: 8,
                    paddingHorizontal: 8, paddingVertical: 4, fontSize: 12, color: C_TEXT,
                  }}
                />
                <Pressable
                  onPress={() => {
                    if (newSubtaskTitle.trim()) {
                      onAddSubTask?.(task.id, newSubtaskTitle.trim());
                      setNewSubtaskTitle('');
                    }
                  }}
                  style={{ backgroundColor: C_PURPLE, borderRadius: 8, paddingHorizontal: 10, justifyContent: 'center' }}
                >
                  <Text style={{ color: '#fff', fontSize: 11, fontWeight: 'bold' }}>+ 添加</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      )}

      {/* 操作按钮组 */}
      <View style={{ gap: 8 }}>
        {/* 第一行：完成 / 补完成 + 编辑 + 删除 */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {isOverdue ? (
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                onOvertimeComplete(task.id);
              }}
              style={{
                flex: 2,
                backgroundColor: '#888',
                borderRadius: 12,
                paddingVertical: 10,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: 'bold' }}>📝 补完成</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                onComplete(task.id, task.deadline);
              }}
              style={{
                flex: 2,
                backgroundColor: C_MINT,
                borderRadius: 12,
                paddingVertical: 10,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: 'bold' }}>🎉 完成！</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onEdit(task);
            }}
            style={{
              flex: 1,
              backgroundColor: '#F0EDFF',
              borderRadius: 12,
              paddingVertical: 10,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#6C63FF', fontSize: 13 }}>✏️ 编辑</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onDelete(task.id);
            }}
            style={{
              flex: 1,
              backgroundColor: '#F5F5F5',
              borderRadius: 12,
              paddingVertical: 10,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: C_MUTED, fontSize: 13 }}>删除</Text>
          </Pressable>
        </View>

        {/* 第二行：快捷延期 + 快捷复制 + 子任务折叠开关（若尚未展开） */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onPostpone?.(task);
            }}
            style={{
              flex: 1,
              backgroundColor: '#FFF5E6',
              borderRadius: 10,
              paddingVertical: 8,
              alignItems: 'center',
              borderWidth: 1,
              borderColor: '#FFE0B2',
            }}
          >
            <Text style={{ color: '#E65100', fontSize: 12, fontWeight: '600' }}>⏳ 快捷延期</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onCopy?.(task);
            }}
            style={{
              flex: 1,
              backgroundColor: '#E8F4FD',
              borderRadius: 10,
              paddingVertical: 8,
              alignItems: 'center',
              borderWidth: 1,
              borderColor: '#BBDEFB',
            }}
          >
            <Text style={{ color: '#1565C0', fontSize: 12, fontWeight: '600' }}>📋 快捷复制</Text>
          </Pressable>
          {totalSubtasksCount === 0 && !subtasksOpen && (
            <Pressable
              onPress={() => setSubtasksOpen(true)}
              style={{
                flex: 1,
                backgroundColor: '#F0EDFF',
                borderRadius: 10,
                paddingVertical: 8,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: C_PURPLE, fontSize: 12, fontWeight: '600' }}>+ 添子任务</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Animated.View>
  );
}

// ── 快捷延期弹窗（PRD §3.3.5）─────────────────────────────────────
function PostponeModal({
  visible,
  task,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  task: Task | null;
  onClose: () => void;
  onConfirm: (id: string, extendMs: number) => Promise<void>;
}) {
  const [customMode, setCustomMode] = useState(false);
  const [customDate, setCustomDate] = useState<Date>(new Date());
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (task) {
      setCustomMode(false);
      const cur = new Date(task.deadline);
      // 默认自定义时间为原截止时间 + 1天
      cur.setDate(cur.getDate() + 1);
      setCustomDate(cur);
      setError('');
    }
  }, [task]);

  if (!task) return null;

  const handleApplyPreset = async (extendMs: number) => {
    setLoading(true);
    try {
      await onConfirm(task.id, extendMs);
      onClose();
    } catch {
      setError('延期失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyCustom = async () => {
    const now = Date.now();
    const newTs = customDate.getTime();
    if (newTs <= now) {
      setError('延期时间不能早于当前时间');
      return;
    }
    const curTs = new Date(task.deadline).getTime();
    const extendMs = newTs - curTs;
    setLoading(true);
    try {
      await onConfirm(task.id, extendMs);
      onClose();
    } catch {
      setError('延期失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: '#FFFDF2', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 40 }}>
          <View style={{ width: 40, height: 4, backgroundColor: '#E0D8C8', borderRadius: 2, alignSelf: 'center', marginBottom: 16 }} />
          <Text style={{ color: '#E65100', fontSize: 18, fontWeight: 'bold', marginBottom: 4 }}>⏳ 快捷延期</Text>
          <Text style={{ color: C_MUTED, fontSize: 12, marginBottom: 14 }}>
            当前任务：【{task.name}】原截止：{new Date(task.deadline).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </Text>

          {error ? <Text style={{ color: C_RED, fontSize: 12, marginBottom: 10 }}>{error}</Text> : null}

          {!customMode ? (
            <View style={{ gap: 10 }}>
              <Pressable
                onPress={() => handleApplyPreset(24 * 3600 * 1000)}
                disabled={loading}
                style={{ backgroundColor: '#FFF', borderRadius: 14, borderWidth: 1.5, borderColor: '#FFE0B2', padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <Text style={{ color: C_TEXT, fontSize: 15, fontWeight: 'bold' }}>延期 1 天 (+24h)</Text>
                <Text style={{ color: '#E65100', fontSize: 12 }}>+24小时</Text>
              </Pressable>
              <Pressable
                onPress={() => handleApplyPreset(3 * 24 * 3600 * 1000)}
                disabled={loading}
                style={{ backgroundColor: '#FFF', borderRadius: 14, borderWidth: 1.5, borderColor: '#FFE0B2', padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <Text style={{ color: C_TEXT, fontSize: 15, fontWeight: 'bold' }}>延期 3 天 (+72h)</Text>
                <Text style={{ color: '#E65100', fontSize: 12 }}>+3天</Text>
              </Pressable>
              <Pressable
                onPress={() => handleApplyPreset(7 * 24 * 3600 * 1000)}
                disabled={loading}
                style={{ backgroundColor: '#FFF', borderRadius: 14, borderWidth: 1.5, borderColor: '#FFE0B2', padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <Text style={{ color: C_TEXT, fontSize: 15, fontWeight: 'bold' }}>延期 1 周 (+7天)</Text>
                <Text style={{ color: '#E65100', fontSize: 12 }}>+7天</Text>
              </Pressable>
              <Pressable
                onPress={() => setCustomMode(true)}
                style={{ backgroundColor: '#F0EDFF', borderRadius: 14, borderWidth: 1.5, borderColor: C_PURPLE, padding: 14, alignItems: 'center' }}
              >
                <Text style={{ color: C_PURPLE, fontSize: 14, fontWeight: 'bold' }}>⏱️ 自定义具体时间</Text>
              </Pressable>
            </View>
          ) : (
            <View>
              <DeadlineDrumPicker value={customDate} onChange={setCustomDate} />
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                <Pressable
                  onPress={() => setCustomMode(false)}
                  style={{ flex: 1, paddingVertical: 12, borderRadius: 14, backgroundColor: '#F0EDE0', alignItems: 'center' }}
                >
                  <Text style={{ color: C_MUTED, fontSize: 14 }}>返回选项</Text>
                </Pressable>
                <Pressable
                  onPress={handleApplyCustom}
                  disabled={loading}
                  style={{ flex: 2, paddingVertical: 12, borderRadius: 14, backgroundColor: '#E65100', alignItems: 'center' }}
                >
                  {loading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 14 }}>确认延期</Text>}
                </Pressable>
              </View>
            </View>
          )}

          <Pressable onPress={onClose} style={{ marginTop: 14, alignItems: 'center' }}>
            <Text style={{ color: C_MUTED, fontSize: 13 }}>取消</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ─── 独立日历选择弹窗 CalendarPickerModal ──────────────────────────────
function CalendarPickerModal({
  visible,
  currentDate,
  onClose,
  onSelectDate,
}: {
  visible: boolean;
  currentDate: Date;
  onClose: () => void;
  onSelectDate: (y: number, mo: number, d: number) => void;
}) {
  const [viewDate, setViewDate] = useState(() => new Date(currentDate));

  useEffect(() => {
    if (visible) {
      setViewDate(new Date(currentDate));
    }
  }, [visible, currentDate]);

  const grid = useMemo(() => generateCalendarGrid(viewDate, currentDate), [viewDate, currentDate]);

  const handlePrevMonth = () => {
    setViewDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setViewDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  const handleGoToday = () => {
    const now = new Date();
    setViewDate(new Date(now.getFullYear(), now.getMonth(), 1));
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.45)',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 20,
        }}
      >
        <Pressable
          onPress={e => e.stopPropagation()}
          style={{
            width: '100%',
            maxWidth: 360,
            backgroundColor: '#FFFFFF',
            borderRadius: 20,
            borderWidth: 2,
            borderColor: '#2D2A26',
            padding: 18,
            boxShadow: [{ offsetX: 3, offsetY: 3, blurRadius: 0, color: '#2D2A26' }],
          }}
        >
          {/* 弹窗头部：月份切换 */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <Pressable
              onPress={handlePrevMonth}
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                borderWidth: 1.5,
                borderColor: '#2D2A26',
                backgroundColor: '#FAF7EC',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#2D2A26' }}>◀</Text>
            </Pressable>

            <View style={{ alignItems: 'center' }}>
              <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#2D2A26' }}>
                {viewDate.getFullYear()}年 {viewDate.getMonth() + 1}月
              </Text>
              <Pressable onPress={handleGoToday}>
                <Text style={{ fontSize: 11, color: C_PURPLE, fontWeight: '600', marginTop: 1 }}>
                  [返回本月]
                </Text>
              </Pressable>
            </View>

            <Pressable
              onPress={handleNextMonth}
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                borderWidth: 1.5,
                borderColor: '#2D2A26',
                backgroundColor: '#FAF7EC',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#2D2A26' }}>▶</Text>
            </Pressable>
          </View>

          {/* 星期表头 */}
          <View style={{ flexDirection: 'row', marginBottom: 8 }}>
            {['一', '二', '三', '四', '五', '六', '日'].map((w, idx) => (
              <View key={w} style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{
                  fontSize: 12,
                  fontWeight: 'bold',
                  color: idx >= 5 ? C_PINK : C_MUTED,
                }}>
                  {w}
                </Text>
              </View>
            ))}
          </View>

          {/* 日历网格 */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {grid.map(cell => (
              <View key={cell.dateKey} style={{ width: '14.28%', aspectRatio: 1, padding: 2 }}>
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onSelectDate(cell.year, cell.month, cell.dayNum);
                    onClose();
                  }}
                  style={{
                    flex: 1,
                    borderRadius: 10,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: cell.isSelected ? C_PURPLE : cell.isToday ? '#EDE9FF' : '#FFFFFF',
                    borderWidth: cell.isSelected ? 2 : cell.isToday ? 1.5 : 0,
                    borderColor: cell.isSelected ? '#2D2A26' : cell.isToday ? C_PURPLE : 'transparent',
                  }}
                >
                  <Text style={{
                    fontSize: 13,
                    fontWeight: cell.isSelected || cell.isToday ? 'bold' : 'normal',
                    color: cell.isSelected
                      ? '#FFFFFF'
                      : !cell.isCurrentMonth
                        ? '#C8C4B8'
                        : cell.isToday
                          ? C_PURPLE
                          : '#2D2A26',
                  }}>
                    {cell.dayNum}
                  </Text>
                  {cell.isToday && !cell.isSelected && (
                    <View style={{
                      position: 'absolute',
                      bottom: 2,
                      width: 4,
                      height: 4,
                      borderRadius: 2,
                      backgroundColor: C_PURPLE,
                    }} />
                  )}
                </Pressable>
              </View>
            ))}
          </View>

          {/* 底部关闭 */}
          <Pressable
            onPress={onClose}
            style={{
              marginTop: 14,
              paddingVertical: 10,
              borderRadius: 12,
              backgroundColor: '#F3EFE6',
              alignItems: 'center',
              borderWidth: 1.5,
              borderColor: '#2D2A26',
            }}
          >
            <Text style={{ color: '#2D2A26', fontSize: 13, fontWeight: 'bold' }}>关闭日历</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── 独立时间选择弹窗 TimePickerModal ──────────────────────────────
function TimePickerModal({
  visible,
  currentDate,
  onClose,
  onSelectTime,
}: {
  visible: boolean;
  currentDate: Date;
  onClose: () => void;
  onSelectTime: (hour: number, min: number) => void;
}) {
  const [hour, setHour] = useState(currentDate.getHours());
  const [minute, setMinute] = useState(currentDate.getMinutes());

  useEffect(() => {
    if (visible) {
      setHour(currentDate.getHours());
      setMinute(currentDate.getMinutes());
    }
  }, [visible, currentDate]);

  const QUICK_TIMES = [
    { label: '08:00', h: 8, m: 0, desc: '早间' },
    { label: '12:00', h: 12, m: 0, desc: '中午' },
    { label: '18:00', h: 18, m: 0, desc: '傍晚' },
    { label: '23:59', h: 23, m: 59, desc: '深夜压线' },
  ];

  const COMMON_MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 59];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.45)',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 20,
        }}
      >
        <Pressable
          onPress={e => e.stopPropagation()}
          style={{
            width: '100%',
            maxWidth: 360,
            backgroundColor: '#FFFFFF',
            borderRadius: 20,
            borderWidth: 2,
            borderColor: '#2D2A26',
            padding: 18,
            boxShadow: [{ offsetX: 3, offsetY: 3, blurRadius: 0, color: '#2D2A26' }],
          }}
        >
          <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#2D2A26', textAlign: 'center', marginBottom: 12 }}>
            ⏰ 设定截止时间
          </Text>

          {/* 数字液晶屏效果 */}
          <View style={{
            backgroundColor: '#FAF7EC',
            borderRadius: 14,
            borderWidth: 2,
            borderColor: '#2D2A26',
            paddingVertical: 14,
            alignItems: 'center',
            marginBottom: 14,
          }}>
            <Text style={{
              fontSize: 34,
              fontWeight: 'bold',
              color: '#2D2A26',
              fontVariant: ['tabular-nums'],
              letterSpacing: 2,
            }}>
              {String(hour).padStart(2, '0')} : {String(minute).padStart(2, '0')}
            </Text>
            <Text style={{ fontSize: 11, color: C_MUTED, marginTop: 2 }}>
              {hour >= 18 ? '🌙 晚上' : hour >= 12 ? '☀️ 下午' : hour >= 6 ? '🌅 上午' : '🌌 凌晨'}
            </Text>
          </View>

          {/* 快捷时间行 */}
          <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#2D2A26', marginBottom: 6 }}>
            ⚡ 快捷时间推荐
          </Text>
          <View style={{ flexDirection: 'row', gap: 6, marginBottom: 14 }}>
            {QUICK_TIMES.map(q => {
              const active = hour === q.h && minute === q.m;
              return (
                <Pressable
                  key={q.label}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setHour(q.h);
                    setMinute(q.m);
                  }}
                  style={{
                    flex: 1,
                    paddingVertical: 6,
                    borderRadius: 10,
                    borderWidth: 1.5,
                    borderColor: '#2D2A26',
                    backgroundColor: active ? C_PINK : '#FFFFFF',
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: 'bold', color: active ? '#FFFFFF' : '#2D2A26' }}>
                    {q.label}
                  </Text>
                  <Text style={{ fontSize: 9, color: active ? '#FFFFFF' : C_MUTED }}>
                    {q.desc}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* 小时调整栏 */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#2D2A26' }}>时（00 - 23）</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <Pressable
                onPress={() => setHour(h => (h - 1 + 24) % 24)}
                style={{ paddingHorizontal: 8, paddingVertical: 2, backgroundColor: '#FAF7EC', borderRadius: 6, borderWidth: 1, borderColor: '#2D2A26' }}
              >
                <Text style={{ fontSize: 12, fontWeight: 'bold' }}>-1小时</Text>
              </Pressable>
              <Pressable
                onPress={() => setHour(h => (h + 1) % 24)}
                style={{ paddingHorizontal: 8, paddingVertical: 2, backgroundColor: '#FAF7EC', borderRadius: 6, borderWidth: 1, borderColor: '#2D2A26' }}
              >
                <Text style={{ fontSize: 12, fontWeight: 'bold' }}>+1小时</Text>
              </Pressable>
            </View>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 10 }}>
            {Array.from({ length: 24 }, (_, i) => i).map(h => {
              const active = hour === h;
              return (
                <Pressable
                  key={h}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setHour(h);
                  }}
                  style={{
                    width: 40,
                    height: 36,
                    borderRadius: 8,
                    borderWidth: 1.5,
                    borderColor: '#2D2A26',
                    backgroundColor: active ? C_PURPLE : '#FFFFFF',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: 13, fontWeight: 'bold', color: active ? '#FFFFFF' : '#2D2A26' }}>
                    {String(h).padStart(2, '0')}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* 分钟调整栏 */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, marginTop: 4 }}>
            <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#2D2A26' }}>分（快速直选）</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <Pressable
                onPress={() => setMinute(m => (m - 1 + 60) % 60)}
                style={{ paddingHorizontal: 8, paddingVertical: 2, backgroundColor: '#FAF7EC', borderRadius: 6, borderWidth: 1, borderColor: '#2D2A26' }}
              >
                <Text style={{ fontSize: 12, fontWeight: 'bold' }}>-1分</Text>
              </Pressable>
              <Pressable
                onPress={() => setMinute(m => (m + 1) % 60)}
                style={{ paddingHorizontal: 8, paddingVertical: 2, backgroundColor: '#FAF7EC', borderRadius: 6, borderWidth: 1, borderColor: '#2D2A26' }}
              >
                <Text style={{ fontSize: 12, fontWeight: 'bold' }}>+1分</Text>
              </Pressable>
            </View>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 12 }}>
            {COMMON_MINUTES.map(m => {
              const active = minute === m;
              return (
                <Pressable
                  key={m}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setMinute(m);
                  }}
                  style={{
                    width: 42,
                    height: 36,
                    borderRadius: 8,
                    borderWidth: 1.5,
                    borderColor: '#2D2A26',
                    backgroundColor: active ? (m === 59 ? C_PINK : C_PURPLE) : '#FFFFFF',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: 13, fontWeight: 'bold', color: active ? '#FFFFFF' : '#2D2A26' }}>
                    {String(m).padStart(2, '0')}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* 确认与取消 */}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
            <Pressable
              onPress={onClose}
              style={{
                flex: 1,
                paddingVertical: 11,
                borderRadius: 12,
                backgroundColor: '#F3EFE6',
                alignItems: 'center',
                borderWidth: 1.5,
                borderColor: '#2D2A26',
              }}
            >
              <Text style={{ color: '#2D2A26', fontSize: 13, fontWeight: 'bold' }}>取消</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                onSelectTime(hour, minute);
                onClose();
              }}
              style={{
                flex: 2,
                paddingVertical: 11,
                borderRadius: 12,
                backgroundColor: C_PINK,
                alignItems: 'center',
                borderWidth: 1.5,
                borderColor: '#2D2A26',
                boxShadow: [{ offsetX: 2, offsetY: 2, blurRadius: 0, color: '#2D2A26' }],
              }}
            >
              <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: 'bold' }}>确认时间</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── 统一复古截止时间选择器 DeadlinePicker（代替复杂五列滚轮） ───────────
export function DeadlinePicker({
  value,
  onChange,
}: {
  value: Date;
  onChange: (d: Date) => void;
}) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [timePickerOpen, setTimePickerOpen] = useState(false);

  const curVal = value instanceof Date && !isNaN(value.getTime()) ? value : (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(23, 59, 0, 0);
    return d;
  })();

  const isPast = curVal.getTime() < Date.now();

  // 快捷日期定义（修改日期时保留用户当前选择的时分秒）
  const DATE_SHORTCUTS: { label: string; type: 'today' | 'tomorrow' | '3days' | '7days' }[] = [
    { label: '今天', type: 'today' },
    { label: '明天', type: 'tomorrow' },
    { label: '3天后', type: '3days' },
    { label: '7天后', type: '7days' },
  ];

  // 快捷时间定义（修改时间时保留用户当前的年月日）
  const TIME_SHORTCUTS = [
    { label: '08:00', h: 8, m: 0, tag: '早' },
    { label: '12:00', h: 12, m: 0, tag: '午' },
    { label: '18:00', h: 18, m: 0, tag: '晚' },
    { label: '23:59', h: 23, m: 59, tag: '压线' },
  ];

  const now = new Date();
  const isSelectedDate = (type: 'today' | 'tomorrow' | '3days' | '7days') => {
    const target = getShortcutDate(type, now);
    return (
      curVal.getFullYear() === target.year &&
      curVal.getMonth() === target.month &&
      curVal.getDate() === target.date
    );
  };

  const isSelectedTime = (h: number, m: number) => {
    return curVal.getHours() === h && curVal.getMinutes() === m;
  };

  const applyDateShortcut = (type: 'today' | 'tomorrow' | '3days' | '7days') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const target = getShortcutDate(type, now);
    onChange(setDateKeepTime(curVal, target.year, target.month, target.date));
  };

  const applyTimeShortcut = (h: number, m: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onChange(setTimeKeepDate(curVal, h, m));
  };

  const formattedDateStr = `${curVal.getMonth() + 1}月${curVal.getDate()}日`;
  const formattedYearWeek = `${curVal.getFullYear()}年 · 星期${WEEK_LABELS[curVal.getDay()]}`;
  const formattedTimeStr = `${String(curVal.getHours()).padStart(2, '0')}:${String(curVal.getMinutes()).padStart(2, '0')}`;

  return (
    <View style={{
      backgroundColor: '#FFFFFF',
      borderRadius: 16,
      borderWidth: 2,
      borderColor: '#2D2A26',
      padding: 12,
      boxShadow: [{ offsetX: 2, offsetY: 2, blurRadius: 0, color: '#2D2A26' }],
    }}>
      {/* 最终截止时间摘要栏 */}
      <View style={{
        backgroundColor: isPast ? '#FFF0F0' : '#F0EDFF',
        borderRadius: 10,
        borderWidth: 1.5,
        borderColor: isPast ? C_RED : C_PURPLE,
        paddingVertical: 7,
        paddingHorizontal: 10,
        marginBottom: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <View style={{ flex: 1 }}>
          <Text style={{
            color: isPast ? C_RED : C_PURPLE,
            fontSize: 13,
            fontWeight: 'bold',
          }}>
            ⏰ {formatDeadlineDisplay(curVal)}
          </Text>
          {isPast && (
            <Text style={{ color: C_RED, fontSize: 10, fontWeight: 'bold', marginTop: 1 }}>
              ⚠️ 注意：选中的截止时间已早于当前时刻
            </Text>
          )}
        </View>
        <View style={{
          backgroundColor: isPast ? C_RED : C_PURPLE,
          borderRadius: 6,
          paddingHorizontal: 6,
          paddingVertical: 2,
        }}>
          <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: 'bold' }}>
            {isPast ? '已过期' : '已设定'}
          </Text>
        </View>
      </View>

      {/* 两个独立的点击区域：左日期、右时间 */}
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
        {/* 点击日期区域 */}
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setCalendarOpen(true);
          }}
          style={{
            flex: 1,
            backgroundColor: '#FAF7EC',
            borderRadius: 12,
            borderWidth: 1.5,
            borderColor: '#2D2A26',
            padding: 10,
            alignItems: 'center',
            boxShadow: [{ offsetX: 1.5, offsetY: 1.5, blurRadius: 0, color: '#2D2A26' }],
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
            <Text style={{ fontSize: 13 }}>📅</Text>
            <Text style={{ fontSize: 11, fontWeight: 'bold', color: C_MUTED }}>截止日期</Text>
          </View>
          <Text style={{ fontSize: 17, fontWeight: 'bold', color: '#2D2A26', marginVertical: 1 }}>
            {formattedDateStr}
          </Text>
          <Text style={{ fontSize: 10, color: C_MUTED }}>{formattedYearWeek}</Text>
          <View style={{
            marginTop: 4,
            backgroundColor: '#EDE9FF',
            borderRadius: 4,
            paddingHorizontal: 6,
            paddingVertical: 1,
          }}>
            <Text style={{ fontSize: 9, color: C_PURPLE, fontWeight: 'bold' }}>点击选日历 ▾</Text>
          </View>
        </Pressable>

        {/* 点击时间区域 */}
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setTimePickerOpen(true);
          }}
          style={{
            flex: 1,
            backgroundColor: '#FAF7EC',
            borderRadius: 12,
            borderWidth: 1.5,
            borderColor: '#2D2A26',
            padding: 10,
            alignItems: 'center',
            boxShadow: [{ offsetX: 1.5, offsetY: 1.5, blurRadius: 0, color: '#2D2A26' }],
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
            <Text style={{ fontSize: 13 }}>⏰</Text>
            <Text style={{ fontSize: 11, fontWeight: 'bold', color: C_MUTED }}>截止时刻</Text>
          </View>
          <Text style={{ fontSize: 20, fontWeight: 'bold', color: '#2D2A26', marginVertical: 1, fontVariant: ['tabular-nums'] }}>
            {formattedTimeStr}
          </Text>
          <Text style={{ fontSize: 10, color: C_MUTED }}>
            {curVal.getHours() === 23 && curVal.getMinutes() === 59 ? '🔥 压线满格' : '点击调整时刻'}
          </Text>
          <View style={{
            marginTop: 4,
            backgroundColor: '#FFE4EC',
            borderRadius: 4,
            paddingHorizontal: 6,
            paddingVertical: 1,
          }}>
            <Text style={{ fontSize: 9, color: C_PINK, fontWeight: 'bold' }}>点击选时刻 ▾</Text>
          </View>
        </Pressable>
      </View>

      {/* 快捷日期选项 */}
      <View style={{ marginBottom: 8 }}>
        <Text style={{ fontSize: 11, fontWeight: 'bold', color: '#2D2A26', marginBottom: 4 }}>
          📅 快捷日期：
        </Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {DATE_SHORTCUTS.map(s => {
            const active = isSelectedDate(s.type);
            return (
              <Pressable
                key={s.label}
                onPress={() => applyDateShortcut(s.type)}
                style={{
                  flex: 1,
                  paddingVertical: 6,
                  borderRadius: 8,
                  borderWidth: 1.5,
                  borderColor: '#2D2A26',
                  backgroundColor: active ? C_PURPLE : '#FAF7EC',
                  alignItems: 'center',
                }}
              >
                <Text style={{
                  fontSize: 12,
                  fontWeight: 'bold',
                  color: active ? '#FFFFFF' : '#2D2A26',
                }}>
                  {s.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* 快捷时间选项 */}
      <View>
        <Text style={{ fontSize: 11, fontWeight: 'bold', color: '#2D2A26', marginBottom: 4 }}>
          ⏰ 快捷时间：
        </Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {TIME_SHORTCUTS.map(s => {
            const active = isSelectedTime(s.h, s.m);
            return (
              <Pressable
                key={s.label}
                onPress={() => applyTimeShortcut(s.h, s.m)}
                style={{
                  flex: 1,
                  paddingVertical: 6,
                  borderRadius: 8,
                  borderWidth: 1.5,
                  borderColor: '#2D2A26',
                  backgroundColor: active ? C_PINK : '#FAF7EC',
                  alignItems: 'center',
                }}
              >
                <Text style={{
                  fontSize: 12,
                  fontWeight: 'bold',
                  color: active ? '#FFFFFF' : '#2D2A26',
                }}>
                  {s.label}
                </Text>
                <Text style={{
                  fontSize: 9,
                  color: active ? '#FFFFFF' : C_MUTED,
                }}>
                  {s.tag}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* 日期弹窗 */}
      <CalendarPickerModal
        visible={calendarOpen}
        currentDate={curVal}
        onClose={() => setCalendarOpen(false)}
        onSelectDate={(y, mo, d) => onChange(setDateKeepTime(curVal, y, mo, d))}
      />

      {/* 时间弹窗 */}
      <TimePickerModal
        visible={timePickerOpen}
        currentDate={curVal}
        onClose={() => setTimePickerOpen(false)}
        onSelectTime={(h, m) => onChange(setTimeKeepDate(curVal, h, m))}
      />
    </View>
  );
}

// 兼容别名导出
export const DeadlineDrumPicker = DeadlinePicker;

// 创建任务弹窗（支持备注、分类、心理截止、提前提醒、子任务、重复规则与草稿恢复）
function CreateTaskModal({
  visible,
  initialData,
  onClose,
  onCreate,
}: {
  visible: boolean;
  initialData?: Partial<Task> | null;
  onClose: () => void;
  onCreate: (
    name: string,
    deadline: Date,
    priority: number,
    options?: {
      note?: string;
      category?: string;
      cutoff_deadline?: string;
      reminder_offset?: number;
      subtasks?: SubTask[];
      repeat_rule?: RepeatRule;
    }
  ) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const defaultDeadline = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(23, 59, 0, 0);
    return d;
  };
  const [deadlineDate, setDeadlineDate] = useState<Date>(defaultDeadline());
  const [priority, setPriority] = useState(2);
  const [note, setNote] = useState('');
  const [category, setCategory] = useState('学习');
  const [cutoffOption, setCutoffOption] = useState<number>(0);
  const [reminderOffset, setReminderOffset] = useState<number>(60);
  const [subtasks, setSubtasks] = useState<SubTask[]>([]);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [repeatRule, setRepeatRule] = useState<RepeatRule>('none');
  const [draftRecoverable, setDraftRecoverable] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const DRAFT_STORAGE_KEY = 'ddl_create_task_draft_v1';

  const CATEGORIES = ['学习', '工作', '生活', '考研', '紧急', '其他'];
  const REPEAT_OPTIONS: { label: string; value: RepeatRule }[] = [
    { label: '不重复', value: 'none' },
    { label: '每天', value: 'daily' },
    { label: '每周', value: 'weekly' },
    { label: '每月', value: 'monthly' },
  ];
  const CUTOFF_OPTIONS = [
    { label: '无', value: 0 },
    { label: '提前30分', value: 30 },
    { label: '提前1小时', value: 60 },
    { label: '提前2小时', value: 120 },
    { label: '提前1天', value: 1440 },
  ];
  const REMINDER_OPTIONS = [
    { label: '提前15分', value: 15 },
    { label: '提前1小时', value: 60 },
    { label: '提前6小时', value: 360 },
    { label: '提前1天', value: 1440 },
    { label: '不提醒', value: 0 },
  ];

  // 初始化或快捷复制模板填充
  useEffect(() => {
    if (visible) {
      setError('');
      setNewSubtaskTitle('');
      if (initialData) {
        setName(initialData.name ? `${initialData.name} (副本)` : '');
        setDeadlineDate(initialData.deadline ? new Date(initialData.deadline) : defaultDeadline());
        setPriority(initialData.priority ?? 2);
        setNote(initialData.note ?? '');
        setCategory(initialData.category ?? '学习');
        setReminderOffset(initialData.reminder_offset ?? 60);
        setRepeatRule(initialData.repeat_rule ?? 'none');
        const clonedSubtasks = initialData.subtasks?.map(st => ({
          id: String(Date.now() + Math.random()),
          title: st.title,
          completed: false,
          completed_at: null,
        })) ?? [];
        setSubtasks(clonedSubtasks);
        setDraftRecoverable(false);
      } else {
        void (async () => {
          try {
            const rawDraft = await AsyncStorage.getItem(DRAFT_STORAGE_KEY);
            if (rawDraft) {
              const parsed = JSON.parse(rawDraft);
              if (parsed && parsed.name && parsed.name.trim()) {
                setDraftRecoverable(true);
              }
            }
          } catch {
            setDraftRecoverable(false);
          }
        })();
        setName('');
        setDeadlineDate(defaultDeadline());
        setPriority(2);
        setNote('');
        setCategory('学习');
        setCutoffOption(0);
        setReminderOffset(60);
        setSubtasks([]);
        setRepeatRule('none');
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialData]);

  // 恢复草稿
  const handleRestoreDraft = async () => {
    try {
      const rawDraft = await AsyncStorage.getItem(DRAFT_STORAGE_KEY);
      if (rawDraft) {
        const parsed = JSON.parse(rawDraft);
        if (parsed.name) setName(parsed.name);
        if (parsed.deadlineDate) setDeadlineDate(new Date(parsed.deadlineDate));
        if (parsed.priority) setPriority(parsed.priority);
        if (parsed.note) setNote(parsed.note);
        if (parsed.category) setCategory(parsed.category);
        if (parsed.subtasks) setSubtasks(parsed.subtasks);
        if (parsed.repeatRule) setRepeatRule(parsed.repeatRule);
      }
    } finally {
      setDraftRecoverable(false);
    }
  };

  // 丢弃草稿
  const handleDiscardDraft = async () => {
    await AsyncStorage.removeItem(DRAFT_STORAGE_KEY);
    setDraftRecoverable(false);
  };

  // 自动缓存草稿（当输入内容变化且非快捷复制时）
  useEffect(() => {
    if (!visible || initialData) return;
    if (name.trim()) {
      const timer = setTimeout(() => {
        void AsyncStorage.setItem(
          DRAFT_STORAGE_KEY,
          JSON.stringify({
            name,
            deadlineDate: deadlineDate.toISOString(),
            priority,
            note,
            category,
            subtasks,
            repeatRule,
          }),
        );
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [name, deadlineDate, priority, note, category, subtasks, repeatRule, visible, initialData]);

  const handleAddSubtask = () => {
    if (!newSubtaskTitle.trim()) return;
    setSubtasks(prev => [
      ...prev,
      {
        id: String(Date.now() + Math.random()),
        title: newSubtaskTitle.trim(),
        completed: false,
        completed_at: null,
      },
    ]);
    setNewSubtaskTitle('');
  };

  const handleDeleteSubtask = (id: string) => {
    setSubtasks(prev => prev.filter(st => st.id !== id));
  };

  const handleCreate = async () => {
    setError('');
    if (!name.trim()) { setError('请输入任务名称'); return; }
    if (deadlineDate <= new Date()) { setError('截止时间须在当前时间之后'); return; }
    setLoading(true);
    try {
      const cutoffDate = cutoffOption > 0
        ? new Date(deadlineDate.getTime() - cutoffOption * 60 * 1000).toISOString()
        : undefined;

      await onCreate(name.trim(), deadlineDate, priority, {
        note: note.trim() || undefined,
        category: category || undefined,
        cutoff_deadline: cutoffDate,
        reminder_offset: reminderOffset > 0 ? reminderOffset : undefined,
        subtasks: subtasks.length > 0 ? subtasks : undefined,
        repeat_rule: repeatRule,
      });

      await AsyncStorage.removeItem(DRAFT_STORAGE_KEY);
      onClose();
    } catch {
      setError('创建失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const priorityOptions = [
    { value: 1, label: '低 😌', color: C_MINT },
    { value: 2, label: '中 😬', color: C_YELLOW },
    { value: 3, label: '高 🔥', color: C_PINK },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <ScrollView
            style={{ backgroundColor: '#FFFDF2', borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '88%' }}
            contentContainerStyle={{ padding: 24, paddingBottom: 48 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={{ width: 40, height: 4, backgroundColor: '#E0D8C8', borderRadius: 2, alignSelf: 'center', marginBottom: 18 }} />
            <Text style={{ color: C_PINK, fontSize: 20, fontWeight: 'bold', marginBottom: 4 }}>
              {initialData ? '📋 快捷复制创建' : '📝 添加新DDL'}
            </Text>
            <Text style={{ color: C_MUTED, fontSize: 12, marginBottom: 16 }}>又是新的挑战，加油！（或者不加油）</Text>

            {/* 草稿恢复提示条 */}
            {draftRecoverable && (
              <View style={{
                backgroundColor: '#FFF8E1',
                borderRadius: 14,
                borderWidth: 1,
                borderColor: '#FFE082',
                padding: 12,
                marginBottom: 16,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <Text style={{ color: '#F57F17', fontSize: 13, flex: 1, fontWeight: '600' }}>
                  📝 发现未保存的草稿，是否恢复？
                </Text>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <Pressable
                    onPress={handleRestoreDraft}
                    style={{ backgroundColor: C_PURPLE, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 }}
                  >
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>恢复</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleDiscardDraft}
                    style={{ backgroundColor: '#F0EAE0', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 }}
                  >
                    <Text style={{ color: C_MUTED, fontSize: 12 }}>丢弃</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {/* 任务名 */}
            <Text style={{ color: C_TEXT, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>任务名称</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="例：高数作业、操作系统实验…"
              placeholderTextColor={C_MUTED}
              style={{
                backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1.5,
                borderColor: '#E8E0D0', color: C_TEXT, padding: 12, fontSize: 15, marginBottom: 14,
              }}
            />

            {/* 任务分类 */}
            <Text style={{ color: C_TEXT, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>任务分类</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {CATEGORIES.map(cat => (
                <Pressable
                  key={cat}
                  onPress={() => setCategory(cat)}
                  style={{
                    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
                    backgroundColor: category === cat ? C_PURPLE : '#FFFFFF',
                    borderWidth: 1, borderColor: category === cat ? C_PURPLE : '#E8E0D0',
                  }}
                >
                  <Text style={{ color: category === cat ? '#fff' : C_TEXT, fontSize: 12, fontWeight: '600' }}>
                    🏷️ {cat}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* 重复规则 */}
            <Text style={{ color: C_TEXT, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>
              🔁 重复规则 <Text style={{ color: C_MUTED, fontSize: 11, fontWeight: 'normal' }}>（完成后自动生成下一期）</Text>
            </Text>
            <View style={{ flexDirection: 'row', gap: 6, marginBottom: 14 }}>
              {REPEAT_OPTIONS.map(opt => (
                <Pressable
                  key={opt.value}
                  onPress={() => setRepeatRule(opt.value)}
                  style={{
                    flex: 1,
                    paddingVertical: 8,
                    borderRadius: 12,
                    alignItems: 'center',
                    backgroundColor: repeatRule === opt.value ? '#EDE9FF' : '#FFF',
                    borderWidth: 1.5,
                    borderColor: repeatRule === opt.value ? C_PURPLE : '#E8E0D0',
                  }}
                >
                  <Text style={{
                    color: repeatRule === opt.value ? C_PURPLE : C_TEXT,
                    fontSize: 12,
                    fontWeight: repeatRule === opt.value ? 'bold' : 'normal',
                  }}>
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* 截止时间 */}
            <Text style={{ color: C_TEXT, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>
              截止时间{' '}
              <Text style={{ color: C_MUTED, fontWeight: '400', fontSize: 11 }}>（快捷标签 / 独立日历与时间直选）</Text>
            </Text>
            <DeadlinePicker value={deadlineDate} onChange={setDeadlineDate} />

            {/* 心理提前截止 */}
            <Text style={{ color: C_TEXT, fontSize: 13, fontWeight: '600', marginBottom: 6, marginTop: 14 }}>
              🎯 心理提前截止 <Text style={{ color: C_MUTED, fontSize: 11, fontWeight: 'normal' }}>（给自己设置的伪死线）</Text>
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {CUTOFF_OPTIONS.map(opt => (
                <Pressable
                  key={opt.value}
                  onPress={() => setCutoffOption(opt.value)}
                  style={{
                    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12,
                    backgroundColor: cutoffOption === opt.value ? '#EAE6FF' : '#FFF',
                    borderWidth: 1, borderColor: cutoffOption === opt.value ? C_PURPLE : '#E8E0D0',
                  }}
                >
                  <Text style={{ color: cutoffOption === opt.value ? C_PURPLE : C_MUTED, fontSize: 11, fontWeight: '600' }}>
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* 提前提醒 */}
            <Text style={{ color: C_TEXT, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>
              🔔 任务提醒 <Text style={{ color: C_MUTED, fontSize: 11, fontWeight: 'normal' }}>（系统本地推送）</Text>
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {REMINDER_OPTIONS.map(opt => (
                <Pressable
                  key={opt.value}
                  onPress={() => setReminderOffset(opt.value)}
                  style={{
                    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12,
                    backgroundColor: reminderOffset === opt.value ? '#FFE6ED' : '#FFF',
                    borderWidth: 1, borderColor: reminderOffset === opt.value ? C_PINK : '#E8E0D0',
                  }}
                >
                  <Text style={{ color: reminderOffset === opt.value ? C_PINK : C_MUTED, fontSize: 11, fontWeight: '600' }}>
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* 优先级 */}
            <Text style={{ color: C_TEXT, fontSize: 13, fontWeight: '600', marginBottom: 8 }}>优先级</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
              {priorityOptions.map(opt => (
                <Pressable
                  key={opt.value}
                  onPress={() => setPriority(opt.value)}
                  style={{
                    flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 14,
                    borderWidth: 2,
                    borderColor: priority === opt.value ? opt.color : '#E8E0D0',
                    backgroundColor: priority === opt.value ? `${opt.color}22` : '#FFFFFF',
                  }}
                >
                  <Text style={{ color: priority === opt.value ? opt.color : C_MUTED, fontWeight: '600', fontSize: 13 }}>
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* 子任务拆解 */}
            <Text style={{ color: C_TEXT, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>
              🎯 子任务拆解 <Text style={{ color: C_MUTED, fontSize: 11, fontWeight: 'normal' }}>（拆解大目标，逐步击破）</Text>
            </Text>
            <View style={{ backgroundColor: '#FFF', borderRadius: 14, borderWidth: 1.5, borderColor: '#E8E0D0', padding: 12, marginBottom: 14 }}>
              {subtasks.length > 0 && (
                <View style={{ gap: 6, marginBottom: 10 }}>
                  {subtasks.map(st => (
                    <View key={st.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 3 }}>
                      <Text style={{ color: C_TEXT, fontSize: 13, flex: 1 }}>• {st.title}</Text>
                      <Pressable onPress={() => handleDeleteSubtask(st.id)} style={{ paddingHorizontal: 6 }}>
                        <Text style={{ color: '#AAA', fontSize: 13 }}>✕</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput
                  value={newSubtaskTitle}
                  onChangeText={setNewSubtaskTitle}
                  placeholder="添加具体步骤/子任务…"
                  placeholderTextColor={C_MUTED}
                  style={{ flex: 1, backgroundColor: '#F8F6F0', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: C_TEXT }}
                />
                <Pressable
                  onPress={handleAddSubtask}
                  style={{ backgroundColor: C_PURPLE, borderRadius: 10, paddingHorizontal: 14, justifyContent: 'center' }}
                >
                  <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>+ 添加</Text>
                </Pressable>
              </View>
            </View>

            {/* 任务备注 */}
            <Text style={{ color: C_TEXT, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>任务备注</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="添加详细说明、要点或交差标准…"
              placeholderTextColor={C_MUTED}
              multiline
              numberOfLines={2}
              style={{
                backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1.5,
                borderColor: '#E8E0D0', color: C_TEXT, padding: 12, fontSize: 13, marginBottom: 16,
                minHeight: 56, textAlignVertical: 'top',
              }}
            />

            {error ? <Text style={{ color: C_RED, fontSize: 12, marginBottom: 10 }}>{error}</Text> : null}

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable onPress={onClose} style={{ flex: 1, paddingVertical: 14, borderRadius: 16, backgroundColor: '#F0EDE0', alignItems: 'center' }}>
                <Text style={{ color: C_MUTED, fontWeight: '600', fontSize: 14 }}>取消</Text>
              </Pressable>
              <Pressable onPress={handleCreate} disabled={loading} style={{ flex: 2, paddingVertical: 14, borderRadius: 16, backgroundColor: C_PINK, alignItems: 'center' }}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 14 }}>🎯 确认添加</Text>}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── 编辑任务弹窗（PRD §3.3.3 / §7 防逃课）─────────────────────────────────
// 未过期 → 五列滑动滚轮；已过期 → 截止时间置灰锁定，无 TextInput（§6 异常边界）
function EditTaskModal({
  visible,
  task,
  onClose,
  onSave,
}: {
  visible: boolean;
  task: Task | null;
  onClose: () => void;
  onSave: (
    id: string,
    name: string,
    deadline: string,
    priority: number,
    options?: {
      note?: string;
      category?: string;
      cutoff_deadline?: string;
      reminder_offset?: number;
      subtasks?: SubTask[];
      repeat_rule?: RepeatRule;
    }
  ) => Promise<void>;
}) {
  const [name, setName]                 = useState('');
  const [deadlineDate, setDeadlineDate] = useState<Date>(new Date());
  const [priority, setPriority]         = useState(2);
  const [note, setNote]                 = useState('');
  const [category, setCategory]         = useState('');
  const [cutoffOption, setCutoffOption] = useState<number>(0);
  const [reminderOffset, setReminderOffset] = useState<number>(60);
  const [repeatRule, setRepeatRule]     = useState<RepeatRule>('none');
  const [subtasks, setSubtasks]         = useState<SubTask[]>([]);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [error, setError]               = useState('');
  const [saving, setSaving]             = useState(false);

  const CATEGORIES = ['学习', '工作', '生活', '考研', '紧急', '其他'];
  const REPEAT_OPTIONS: { label: string; value: RepeatRule }[] = [
    { label: '不重复', value: 'none' },
    { label: '每天', value: 'daily' },
    { label: '每周', value: 'weekly' },
    { label: '每月', value: 'monthly' },
  ];
  const CUTOFF_OPTIONS = [
    { label: '无', value: 0 },
    { label: '提前30分', value: 30 },
    { label: '提前1小时', value: 60 },
    { label: '提前2小时', value: 120 },
    { label: '提前1天', value: 1440 },
  ];
  const REMINDER_OPTIONS = [
    { label: '提前15分', value: 15 },
    { label: '提前1小时', value: 60 },
    { label: '提前6小时', value: 360 },
    { label: '提前1天', value: 1440 },
    { label: '不提醒', value: 0 },
  ];

  useEffect(() => {
    if (task) {
      setName(task.name);
      setDeadlineDate(new Date(task.deadline));
      setPriority(task.priority);
      setNote(task.note || '');
      setCategory(task.category || '学习');
      setReminderOffset(task.reminder_offset ?? 60);
      setRepeatRule(task.repeat_rule ?? 'none');
      setSubtasks(task.subtasks ?? []);
      setNewSubtaskTitle('');
      if (task.cutoff_deadline) {
        const diffMins = Math.round((new Date(task.deadline).getTime() - new Date(task.cutoff_deadline).getTime()) / 60000);
        setCutoffOption(diffMins > 0 ? diffMins : 0);
      } else {
        setCutoffOption(0);
      }
      setError('');
    }
  }, [task]);

  if (!task) return null;

  // 防逃课：已过期任务的 deadline 字段锁定（§3.3.3 / §7）
  const isExpired = formatTimeRemaining(task.deadline) === '已过期';

  const handleAddSubtask = () => {
    if (!newSubtaskTitle.trim()) return;
    setSubtasks(prev => [
      ...prev,
      {
        id: String(Date.now() + Math.random()),
        title: newSubtaskTitle.trim(),
        completed: false,
        completed_at: null,
      },
    ]);
    setNewSubtaskTitle('');
  };

  const handleDeleteSubtask = (id: string) => {
    setSubtasks(prev => prev.filter(st => st.id !== id));
  };

  const handleToggleSubtask = (id: string) => {
    setSubtasks(prev => prev.map(st => (
      st.id === id ? { ...st, completed: !st.completed, completed_at: !st.completed ? new Date().toISOString() : null } : st
    )));
  };

  const handleSave = async () => {
    if (!name.trim()) { setError('任务名不能为空'); return; }
    const finalDeadline = isExpired ? task.deadline : deadlineDate.toISOString();
    const finalCutoff = cutoffOption > 0
      ? new Date(new Date(finalDeadline).getTime() - cutoffOption * 60 * 1000).toISOString()
      : undefined;

    setSaving(true);
    try {
      await onSave(task.id, name.trim(), finalDeadline, priority, {
        note: note.trim() || undefined,
        category: category || undefined,
        cutoff_deadline: finalCutoff,
        reminder_offset: reminderOffset > 0 ? reminderOffset : undefined,
        subtasks: subtasks.length > 0 ? subtasks : undefined,
        repeat_rule: repeatRule,
      });
      onClose();
    } catch {
      setError('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const EB_BG    = '#FFFDF2';
  const EB_PINK  = '#FF5E7C';
  const EB_TEXT  = '#333333';
  const EB_MUTED = '#888888';

  const PRIORITIES = [
    { value: 1, label: '🟢 低', bg: '#E8F5E9' },
    { value: 2, label: '🟡 中', bg: '#FFF9C4' },
    { value: 3, label: '🔴 高', bg: '#FFEBEE' },
  ];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={process.env.EXPO_OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          style={{ flex: 1, backgroundColor: EB_BG }}
          contentContainerStyle={{ paddingBottom: 60 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* 顶栏 */}
          <View style={{ paddingTop: 24, paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#F0EBE0' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: EB_PINK, fontSize: 18, fontWeight: 'bold' }}>✏️ 编辑任务</Text>
              <Pressable onPress={onClose} style={{ padding: 4 }}>
                <Text style={{ color: EB_MUTED, fontSize: 22 }}>✕</Text>
              </Pressable>
            </View>
          </View>

          <View style={{ padding: 20, gap: 16 }}>
            {/* 任务名 */}
            <View>
              <Text style={{ color: EB_MUTED, fontSize: 12, marginBottom: 6 }}>任务名称</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="输入任务名"
                placeholderTextColor={EB_MUTED}
                style={{
                  backgroundColor: '#FFF', borderRadius: 12, padding: 12,
                  color: EB_TEXT, fontSize: 15,
                  borderWidth: 1, borderColor: '#E8E0D0',
                }}
              />
            </View>

            {/* 任务分类 */}
            <View>
              <Text style={{ color: EB_MUTED, fontSize: 12, marginBottom: 6 }}>任务分类</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {CATEGORIES.map(cat => (
                  <Pressable
                    key={cat}
                    onPress={() => setCategory(cat)}
                    style={{
                      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
                      backgroundColor: category === cat ? C_PURPLE : '#FFFFFF',
                      borderWidth: 1, borderColor: category === cat ? C_PURPLE : '#E8E0D0',
                    }}
                  >
                    <Text style={{ color: category === cat ? '#fff' : EB_TEXT, fontSize: 12, fontWeight: '600' }}>
                      🏷️ {cat}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* 重复规则 */}
            <View>
              <Text style={{ color: EB_MUTED, fontSize: 12, marginBottom: 6 }}>🔁 重复规则</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {REPEAT_OPTIONS.map(opt => (
                  <Pressable
                    key={opt.value}
                    onPress={() => setRepeatRule(opt.value)}
                    style={{
                      flex: 1,
                      paddingVertical: 8,
                      borderRadius: 12,
                      alignItems: 'center',
                      backgroundColor: repeatRule === opt.value ? '#EDE9FF' : '#FFF',
                      borderWidth: 1.5,
                      borderColor: repeatRule === opt.value ? C_PURPLE : '#E8E0D0',
                    }}
                  >
                    <Text style={{
                      color: repeatRule === opt.value ? C_PURPLE : EB_TEXT,
                      fontSize: 12,
                      fontWeight: repeatRule === opt.value ? 'bold' : 'normal',
                    }}>
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* 截止时间 */}
            <View>
              <Text style={{ color: EB_MUTED, fontSize: 12, marginBottom: 6 }}>
                截止时间{' '}
                {isExpired
                  ? <Text style={{ color: EB_PINK, fontSize: 11 }}>（已过期，锁定 🔒）</Text>
                  : <Text style={{ color: EB_MUTED, fontSize: 11 }}>（日历选日期 + 滚轮选时分）</Text>
                }
              </Text>

              {isExpired ? (
                /* §3.3.3 过期锁定：纯展示 View，完全无 TextInput，无法键盘输入（§6） */
                <View style={{
                  backgroundColor: '#F5F2EE', borderRadius: 12, padding: 14,
                  borderWidth: 1, borderColor: '#E0D8C8',
                  flexDirection: 'row', alignItems: 'center', gap: 8,
                }}>
                  <Text style={{ fontSize: 18 }}>🔒</Text>
                  <View>
                    <Text style={{ color: EB_MUTED, fontSize: 15 }}>
                      {new Date(task.deadline).toLocaleString('zh-CN', {
                        year: 'numeric', month: 'numeric', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </Text>
                    <Text style={{ color: EB_PINK, fontSize: 11, marginTop: 2 }}>
                      ⚠️ 防逃课规则：已过期任务截止时间不可修改
                    </Text>
                  </View>
                </View>
              ) : (
                /* §3.3.3 未过期：独立日期与时间选择器，禁止键盘直接输入（§3.3.1 / §6） */
                <DeadlinePicker value={deadlineDate} onChange={setDeadlineDate} />
              )}
            </View>

            {/* 心理提前截止 */}
            {!isExpired && (
              <View>
                <Text style={{ color: EB_MUTED, fontSize: 12, marginBottom: 6 }}>🎯 心理提前截止</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {CUTOFF_OPTIONS.map(opt => (
                    <Pressable
                      key={opt.value}
                      onPress={() => setCutoffOption(opt.value)}
                      style={{
                        paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12,
                        backgroundColor: cutoffOption === opt.value ? '#EAE6FF' : '#FFF',
                        borderWidth: 1, borderColor: cutoffOption === opt.value ? C_PURPLE : '#E8E0D0',
                      }}
                    >
                      <Text style={{ color: cutoffOption === opt.value ? C_PURPLE : EB_MUTED, fontSize: 11, fontWeight: '600' }}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            {/* 提前提醒设置 */}
            <View>
              <Text style={{ color: EB_MUTED, fontSize: 12, marginBottom: 6 }}>🔔 任务提醒</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {REMINDER_OPTIONS.map(opt => (
                  <Pressable
                    key={opt.value}
                    onPress={() => setReminderOffset(opt.value)}
                    style={{
                      paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12,
                      backgroundColor: reminderOffset === opt.value ? '#FFE6ED' : '#FFF',
                      borderWidth: 1, borderColor: reminderOffset === opt.value ? C_PINK : '#E8E0D0',
                    }}
                  >
                    <Text style={{ color: reminderOffset === opt.value ? C_PINK : EB_MUTED, fontSize: 11, fontWeight: '600' }}>
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* 优先级 */}
            <View>
              <Text style={{ color: EB_MUTED, fontSize: 12, marginBottom: 8 }}>优先级</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {PRIORITIES.map(p => (
                  <Pressable
                    key={p.value}
                    onPress={() => setPriority(p.value)}
                    style={{
                      flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center',
                      backgroundColor: priority === p.value ? p.bg : '#F5F2EE',
                      borderWidth: 1.5,
                      borderColor: priority === p.value ? EB_PINK : 'transparent',
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: priority === p.value ? '700' : '400' }}>{p.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* 子任务拆解编辑 */}
            <View>
              <Text style={{ color: EB_MUTED, fontSize: 12, marginBottom: 6 }}>🎯 子任务清单</Text>
              <View style={{ backgroundColor: '#FFF', borderRadius: 14, borderWidth: 1, borderColor: '#E8E0D0', padding: 12 }}>
                {subtasks.length > 0 && (
                  <View style={{ gap: 6, marginBottom: 10 }}>
                    {subtasks.map(st => (
                      <View key={st.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 3 }}>
                        <Pressable
                          onPress={() => handleToggleSubtask(st.id)}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}
                        >
                          <View style={{
                            width: 18, height: 18, borderRadius: 5,
                            borderWidth: 1.5, borderColor: st.completed ? C_MINT : '#C0B8A8',
                            backgroundColor: st.completed ? C_MINT : '#FFF',
                            alignItems: 'center', justifyContent: 'center',
                          }}>
                            {st.completed && <Text style={{ color: '#fff', fontSize: 11, fontWeight: 'bold' }}>✓</Text>}
                          </View>
                          <Text style={{
                            fontSize: 13, color: st.completed ? EB_MUTED : EB_TEXT,
                            textDecorationLine: st.completed ? 'line-through' : 'none', flex: 1,
                          }}>
                            {st.title}
                          </Text>
                        </Pressable>
                        <Pressable onPress={() => handleDeleteSubtask(st.id)} style={{ paddingHorizontal: 6 }}>
                          <Text style={{ color: '#AAA', fontSize: 13 }}>✕</Text>
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput
                    value={newSubtaskTitle}
                    onChangeText={setNewSubtaskTitle}
                    placeholder="添加子任务项…"
                    placeholderTextColor={EB_MUTED}
                    style={{ flex: 1, backgroundColor: '#F8F6F0', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: EB_TEXT }}
                  />
                  <Pressable
                    onPress={handleAddSubtask}
                    style={{ backgroundColor: C_PURPLE, borderRadius: 10, paddingHorizontal: 14, justifyContent: 'center' }}
                  >
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>+ 添加</Text>
                  </Pressable>
                </View>
              </View>
            </View>

            {/* 任务备注 */}
            <View>
              <Text style={{ color: EB_MUTED, fontSize: 12, marginBottom: 6 }}>任务备注</Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="添加详细说明…"
                placeholderTextColor={EB_MUTED}
                multiline
                numberOfLines={2}
                style={{
                  backgroundColor: '#FFF', borderRadius: 12, padding: 12,
                  color: EB_TEXT, fontSize: 13,
                  borderWidth: 1, borderColor: '#E8E0D0', minHeight: 56, textAlignVertical: 'top',
                }}
              />
            </View>

            {error ? <Text style={{ color: EB_PINK, fontSize: 13 }}>{error}</Text> : null}
          </View>

          <View style={{ paddingHorizontal: 20, paddingBottom: 40, flexDirection: 'row', gap: 12 }}>
            <Pressable onPress={onClose} style={{ flex: 1, paddingVertical: 14, borderRadius: 16, backgroundColor: '#F5F2EE', alignItems: 'center' }}>
              <Text style={{ color: EB_MUTED, fontWeight: '600' }}>取消</Text>
            </Pressable>
            <Pressable
              onPress={handleSave}
              disabled={saving}
              style={{ flex: 2, paddingVertical: 14, borderRadius: 16, backgroundColor: EB_PINK, alignItems: 'center' }}
            >
              {saving
                ? <ActivityIndicator color="#fff" />
                : <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 14 }}>💾 保存修改</Text>
              }
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function DDLCalendarView({
  mode,
  selectedDate,
  onSelectDate,
  tasks,
  onComplete,
  onUncomplete,
  onDelete,
  onOvertimeComplete,
  onEdit,
  onCopy,
  onPostpone,
  onToggleSubTask,
}: {
  mode: 'today' | 'week' | 'month';
  selectedDate: string;
  onSelectDate: (dateKey: string) => void;
  tasks: Task[];
  onComplete: (id: string, deadline: string) => Promise<void>;
  onUncomplete: (id: string) => Promise<void>;
  onDelete: (id: string) => void;
  onOvertimeComplete: (id: string) => void;
  onEdit: (task: Task) => void;
  onCopy: (task: Task) => void;
  onPostpone: (task: Task) => void;
  onToggleSubTask: (taskId: string, subtaskId: string) => Promise<void>;
}) {
  const todayKey = formatLocalDateKey(new Date());
  const [viewMonthDate, setViewMonthDate] = useState(() => new Date());

  // 本周 7 天
  const weekDates = useMemo(() => getWeekDates(new Date()), []);

  // 任务按日期分组字典
  const taskMapByDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      const dKey = formatLocalDateKey(new Date(t.deadline));
      const list = map.get(dKey) || [];
      list.push(t);
      map.set(dKey, list);
    }
    return map;
  }, [tasks]);

  // 当日选中的任务
  const activeDateTasks = useMemo(() => {
    return (taskMapByDate.get(selectedDate) || []).slice().sort(
      (a: Task, b: Task) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime()
    );
  }, [taskMapByDate, selectedDate]);

  // 月历网格计算
  const monthGrid = useMemo(() => {
    const year = viewMonthDate.getFullYear();
    const month = viewMonthDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    // 星期几 (0: 周日, 1: 周一, ..., 6: 周六) 转换为 0: 周一, ..., 6: 周日
    let firstDayIndex = firstDay.getDay() - 1;
    if (firstDayIndex === -1) firstDayIndex = 6;

    const daysCount = lastDay.getDate();
    const grid: { dateKey: string; dayNum: number; isCurrentMonth: boolean }[] = [];

    // 上月填充
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const dayNum = prevMonthLastDay - i;
      const prevDate = new Date(year, month - 1, dayNum);
      grid.push({
        dateKey: formatLocalDateKey(prevDate),
        dayNum,
        isCurrentMonth: false,
      });
    }

    // 当月天数
    for (let d = 1; d <= daysCount; d++) {
      const curDate = new Date(year, month, d);
      grid.push({
        dateKey: formatLocalDateKey(curDate),
        dayNum: d,
        isCurrentMonth: true,
      });
    }

    // 下月补齐到整行 (7的倍数)
    const remaining = 7 - (grid.length % 7);
    if (remaining < 7) {
      for (let n = 1; n <= remaining; n++) {
        const nextDate = new Date(year, month + 1, n);
        grid.push({
          dateKey: formatLocalDateKey(nextDate),
          dayNum: n,
          isCurrentMonth: false,
        });
      }
    }

    return grid;
  }, [viewMonthDate]);

  const changeMonth = (offset: number) => {
    setViewMonthDate(prev => new Date(prev.getFullYear(), prev.getMonth() + offset, 1));
  };

  const WEEK_DAYS = ['一', '二', '三', '四', '五', '六', '日'];

  return (
    <View style={{ flex: 1 }}>
      {/* 模式 1: 今天时间线模式 */}
      {mode === 'today' && (
        <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
          <View style={{
            backgroundColor: '#FFFFFF',
            borderRadius: 20,
            padding: 16,
            borderWidth: 1.5,
            borderColor: '#FFE0E8',
            boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 10, color: 'rgba(255,94,124,0.08)' }],
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <Text style={{ fontSize: 16, fontWeight: 'bold', color: C_PINK }}>
                ☀️ 今天 · {new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' })}
              </Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <View style={{ backgroundColor: '#FFF0F4', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Text style={{ fontSize: 11, color: C_PINK, fontWeight: 'bold' }}>
                    共 {(taskMapByDate.get(todayKey) || []).length} 项
                  </Text>
                </View>
                <View style={{ backgroundColor: '#E8FBF8', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Text style={{ fontSize: 11, color: C_MINT, fontWeight: 'bold' }}>
                    已完成 {(taskMapByDate.get(todayKey) || []).filter((t: Task) => t.completed).length} 项
                  </Text>
                </View>
              </View>
            </View>

            {/* 今日时间线段 */}
            <View style={{ gap: 8 }}>
              {[
                { title: '🌅 上午 (00:00 - 12:00)', range: [0, 12] },
                { title: '☀️ 下午 (12:00 - 18:00)', range: [12, 18] },
                { title: '🌙 晚间 (18:00 - 24:00)', range: [18, 24] },
              ].map(seg => {
                const segTasks = (taskMapByDate.get(todayKey) || []).filter((t: Task) => {
                  const h = new Date(t.deadline).getHours();
                  return h >= seg.range[0] && h < seg.range[1];
                });
                return (
                  <View key={seg.title} style={{ backgroundColor: '#FFFDF7', borderRadius: 12, padding: 10, borderWidth: 1, borderColor: '#F2ECD8' }}>
                    <Text style={{ fontSize: 12, color: C_MUTED, fontWeight: '600', marginBottom: 4 }}>
                      {seg.title} · {segTasks.length} 个
                    </Text>
                    {segTasks.length === 0 ? (
                      <Text style={{ fontSize: 11, color: '#BBB', fontStyle: 'italic' }}>无截止任务</Text>
                    ) : (
                      segTasks.map((t: Task) => (
                        <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 2 }}>
                          <Text style={{ fontSize: 13, color: t.completed ? '#AAA' : C_TEXT, textDecorationLine: t.completed ? 'line-through' : 'none', flex: 1 }} numberOfLines={1}>
                            • {t.name}
                          </Text>
                          <Text style={{ fontSize: 11, color: C_PINK, fontWeight: 'bold' }}>
                            {new Date(t.deadline).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                          </Text>
                        </View>
                      ))
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        </View>
      )}

      {/* 模式 2: 本周 7 天横条视图 */}
      {mode === 'week' && (
        <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
          <View style={{
            backgroundColor: '#FFFFFF',
            borderRadius: 20,
            padding: 14,
            borderWidth: 1,
            borderColor: '#E8E0D0',
          }}>
            <Text style={{ fontSize: 13, fontWeight: 'bold', color: C_PURPLE, marginBottom: 10 }}>
              📅 本周任务分布 (点击日期查看详情)
            </Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              {weekDates.map((d: Date, idx: number) => {
                const dKey = formatLocalDateKey(d);
                const isSelected = dKey === selectedDate;
                const isToday = dKey === todayKey;
                const count = (taskMapByDate.get(dKey) || []).length;
                const completedCount = (taskMapByDate.get(dKey) || []).filter((t: Task) => t.completed).length;

                return (
                  <Pressable
                    key={dKey}
                    onPress={() => onSelectDate(dKey)}
                    style={{
                      flex: 1,
                      alignItems: 'center',
                      paddingVertical: 8,
                      borderRadius: 14,
                      backgroundColor: isSelected ? C_PURPLE : isToday ? '#FFF0F4' : '#F8F6F0',
                      borderWidth: isSelected ? 1.5 : isToday ? 1.5 : 0,
                      borderColor: isSelected ? C_PURPLE : C_PINK,
                      marginHorizontal: 2,
                    }}
                  >
                    <Text style={{
                      fontSize: 11,
                      color: isSelected ? '#fff' : C_MUTED,
                      marginBottom: 4,
                      fontWeight: '600',
                    }}>
                      周{WEEK_DAYS[idx]}
                    </Text>
                    <Text style={{
                      fontSize: 15,
                      fontWeight: 'bold',
                      color: isSelected ? '#fff' : isToday ? C_PINK : C_TEXT,
                    }}>
                      {d.getDate()}
                    </Text>
                    {count > 0 ? (
                      <View style={{
                        marginTop: 4,
                        paddingHorizontal: 4,
                        paddingVertical: 1,
                        borderRadius: 8,
                        backgroundColor: isSelected ? '#fff' : completedCount === count ? C_MINT : C_PINK,
                      }}>
                        <Text style={{
                          fontSize: 9,
                          fontWeight: 'bold',
                          color: isSelected ? C_PURPLE : '#fff',
                        }}>
                          {count}
                        </Text>
                      </View>
                    ) : (
                      <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: 'transparent', marginTop: 8 }} />
                    )}
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      )}

      {/* 模式 3: 月历网格视图 */}
      {mode === 'month' && (
        <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
          <View style={{
            backgroundColor: '#FFFFFF',
            borderRadius: 20,
            padding: 14,
            borderWidth: 1,
            borderColor: '#E8E0D0',
          }}>
            {/* 月份切换器 */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <Pressable onPress={() => changeMonth(-1)} style={{ padding: 6 }}>
                <Text style={{ fontSize: 16, color: C_PURPLE, fontWeight: 'bold' }}>◀ 上月</Text>
              </Pressable>
              <Text style={{ fontSize: 15, fontWeight: 'bold', color: C_TEXT }}>
                {viewMonthDate.getFullYear()}年 {viewMonthDate.getMonth() + 1}月
              </Text>
              <Pressable onPress={() => changeMonth(1)} style={{ padding: 6 }}>
                <Text style={{ fontSize: 16, color: C_PURPLE, fontWeight: 'bold' }}>下月 ▶</Text>
              </Pressable>
            </View>

            {/* 星期表头 */}
            <View style={{ flexDirection: 'row', marginBottom: 6 }}>
              {WEEK_DAYS.map(w => (
                <View key={w} style={{ flex: 1, alignItems: 'center' }}>
                  <Text style={{ fontSize: 11, color: C_MUTED, fontWeight: '600' }}>{w}</Text>
                </View>
              ))}
            </View>

            {/* 日期格子 */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {monthGrid.map((cell: { dateKey: string; dayNum: number; isCurrentMonth: boolean }) => {
                const isSelected = cell.dateKey === selectedDate;
                const isToday = cell.dateKey === todayKey;
                const cellTasks = taskMapByDate.get(cell.dateKey) || [];
                const count = cellTasks.length;
                const allDone = count > 0 && cellTasks.every((t: Task) => t.completed);

                return (
                  <Pressable
                    key={cell.dateKey}
                    onPress={() => onSelectDate(cell.dateKey)}
                    style={{
                      width: '14.28%',
                      aspectRatio: 1.1,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 10,
                      backgroundColor: isSelected ? C_PURPLE : isToday ? '#FFEBF0' : 'transparent',
                    }}
                  >
                    <Text style={{
                      fontSize: 12,
                      fontWeight: isToday || isSelected ? 'bold' : 'normal',
                      color: isSelected ? '#fff' : !cell.isCurrentMonth ? '#CCC' : isToday ? C_PINK : C_TEXT,
                    }}>
                      {cell.dayNum}
                    </Text>
                    {count > 0 && (
                      <View style={{
                        width: 5,
                        height: 5,
                        borderRadius: 2.5,
                        marginTop: 2,
                        backgroundColor: isSelected ? '#fff' : allDone ? C_MINT : C_PINK,
                      }} />
                    )}
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      )}

      {/* 选中日期的任务清单 */}
      <View style={{ paddingHorizontal: 16, marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 13, fontWeight: 'bold', color: C_TEXT }}>
          📌 {selectedDate === todayKey ? '今天' : selectedDate} 的 DDL（{activeDateTasks.length} 项）
        </Text>
        <Text style={{ fontSize: 11, color: C_MUTED }}>
          {activeDateTasks.filter((t: Task) => t.completed).length} 已完成
        </Text>
      </View>

      {activeDateTasks.length === 0 ? (
        <View style={{
          backgroundColor: '#FFFFFF',
          borderRadius: 20,
          padding: 24,
          marginHorizontal: 16,
          alignItems: 'center',
          borderWidth: 1,
          borderColor: '#E8E0D0',
        }}>
          <Text style={{ fontSize: 32 }}>🏖️</Text>
          <Text style={{ fontSize: 14, fontWeight: 'bold', color: C_MINT, marginTop: 8 }}>
            该日暂无截止任务
          </Text>
          <Text style={{ fontSize: 12, color: C_MUTED, marginTop: 4 }}>
            尽情享受摸鱼时光，或者点击右下角 + 添加新任务~
          </Text>
        </View>
      ) : (
        <View style={{ paddingHorizontal: 16, gap: 8, paddingBottom: 100 }}>
          {activeDateTasks.map((task: Task) => (
            <TaskCard
              key={task.id}
              task={task}
              onComplete={onComplete}
              onUncomplete={onUncomplete}
              onDelete={onDelete}
              onOvertimeComplete={onOvertimeComplete}
              onEdit={onEdit}
              onCopy={onCopy}
              onPostpone={onPostpone}
              onToggleSubTask={onToggleSubTask}
            />
          ))}
        </View>
      )}
    </View>
  );
}

export default function DDLScreen() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [copyTargetTask, setCopyTargetTask] = useState<Task | null>(null);
  const [postponeTarget, setPostponeTarget] = useState<Task | null>(null);
  const [calendarViewMode, setCalendarViewMode] = useState<'list' | 'today' | 'week' | 'month'>('list');
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string>(formatLocalDateKey(new Date()));
  const [showConfetti, setShowConfetti] = useState(false);
  const [showStamp, setShowStamp] = useState(false);
  // 动画总开关（读取自设置页）
  const [animationsEnabled, setAnimationsEnabled] = useState(true);

  // 读取动画开关设置
  useEffect(() => {
    void (async () => {
      try {
        const val = await AsyncStorage.getItem('settings_animation_enabled');
        if (val !== null) {
          setAnimationsEnabled(val !== '0');
        }
      } catch { /* 使用默认值 */ }
    })();
  }, []);
  const [completedMsg, setCompletedMsg] = useState('');
  // §1.6 压线裂开动画状态
  const [showCrack, setShowCrack] = useState(false);
  const [showDoodle, setShowDoodle] = useState(false);
  const confettiTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 补完成确认弹窗
  const [overtimeTarget, setOvertimeTarget] = useState<string | null>(null);
  const [overtimeConfirming, setOvertimeConfirming] = useState(false);

  // 编辑任务弹窗（PRD §7 防逃课）
  const [editTarget, setEditTarget] = useState<Task | null>(null);

  // 红温任务惩罚性删除确认（PRD §3 反作弊）
  const [penaltyDeleteTarget, setPenaltyDeleteTarget] = useState<string | null>(null);
  const [penaltyDeleting, setPenaltyDeleting] = useState(false);

  // 已完成任务归档删除确认（SPEC §5.2）
  const [archiveDeleteTarget, setArchiveDeleteTarget] = useState<string | null>(null);
  const [archiveDeleting, setArchiveDeleting] = useState(false);

  // 通知权限横幅（PRD §3.3.5）
  const [notifPermission, setNotifPermission] = useState<'granted' | 'denied' | 'undetermined'>('undetermined');
  const [notifBannerDismissed, setNotifBannerDismissed] = useState(false);

  const loadTasks = useCallback(async () => {
    try {
      setLoadError('');
      const [data, dismissed] = await Promise.all([
        getAllTasks(),
        AsyncStorage.getItem('notif_banner_dismissed_ddl'),
      ]);
      setTasks(data);
      setNotifBannerDismissed(dismissed === '1');
      // 检查通知权限
      const { status } = await Notifications.getPermissionsAsync();
      setNotifPermission(status as 'granted' | 'denied' | 'undetermined');
      // 同步推送通知
      syncAllNotifications(data).catch(() => undefined);
    } catch (e) {
      setLoadError(`数据加载失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void loadTasks(); }, [loadTasks]));

  useEffect(() => {
    const timer = setInterval(() => setTasks(t => [...t]), 60000);
    return () => clearInterval(timer);
  }, []);

  const handleComplete = async (id: string, deadline: string) => {
    // §1.6 判断是否为压线完成（距 deadline ≤ 1 小时）
    const msLeft = new Date(deadline).getTime() - Date.now();
    const isRush = msLeft >= 0 && msLeft <= 3600 * 1000;

    const { nextTask } = await completeTask(id, deadline);
    await cancelTaskNotifications(id);
    if (nextTask) {
      await scheduleTaskNotifications(nextTask);
    }

    // 写入 AsyncStorage，供 home.tsx 在 focus 时触发吉祥物 completed 状态
    await AsyncStorage.setItem('last_task_completed_at', String(Date.now()));

    if (isRush) {
      // §1.6 压线完成：先裂开动画，再显示涂鸦，最后纸花
      if (animationsEnabled) {
        setShowCrack(true);
        setShowDoodle(true);
      }
      setCompletedMsg('⚡ 压线完成！绝地逆袭！');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (confettiTimer.current) clearTimeout(confettiTimer.current);
      confettiTimer.current = setTimeout(() => {
        setShowCrack(false);
        setShowDoodle(false);
        if (animationsEnabled) {
          setShowConfetti(true);
        }
        setCompletedMsg('🎉 压线完成！你是最棒的！（险些）');
        confettiTimer.current = setTimeout(() => {
          setShowConfetti(false);
          setCompletedMsg('');
          if (animationsEnabled) {
            setShowStamp(true);
          }
        }, 2000);
      }, 700);
    } else {
      if (animationsEnabled) {
        setShowConfetti(true);
      }
      setCompletedMsg(nextTask ? '🎉 本期完成！下一期重复任务已自动就绪！' : '🎉 任务完成！你是最棒的！（暂时）');
      if (confettiTimer.current) clearTimeout(confettiTimer.current);
      confettiTimer.current = setTimeout(() => {
        setShowConfetti(false);
        setCompletedMsg('');
        if (animationsEnabled) {
          setShowStamp(true);
        }
      }, 2000);
    }
    await loadTasks();
  };

  // 快捷复制
  const handleQuickCopy = (task: Task) => {
    setCopyTargetTask(task);
    setShowCreate(true);
  };

  // 快捷延期
  const handleQuickPostpone = (task: Task) => {
    setPostponeTarget(task);
  };

  // 确认快捷延期
  const handleConfirmPostpone = async (taskId: string, extendMs: number) => {
    const updated = await postponeTask(taskId, extendMs);
    await cancelTaskNotifications(taskId);
    if (updated && !updated.completed) {
      await scheduleTaskNotifications(updated);
    }
    setCompletedMsg('⏳ 任务已成功延期，倒计时与提醒已同步！');
    if (confettiTimer.current) clearTimeout(confettiTimer.current);
    confettiTimer.current = setTimeout(() => setCompletedMsg(''), 2500);
    await loadTasks();
  };

  // 勾选/取消子任务
  const handleToggleSubtask = async (taskId: string, subtaskId: string) => {
    await toggleSubTask(taskId, subtaskId);
    await loadTasks();
  };

  // 导出标准 ICS 日历文件（纯本地，不依赖服务器）
  const handleExportICS = async () => {
    const icsData = generateICS(tasks);
    if (!icsData) {
      setCompletedMsg('当前暂无有效DDL可导出');
      if (confettiTimer.current) clearTimeout(confettiTimer.current);
      confettiTimer.current = setTimeout(() => setCompletedMsg(''), 2000);
      return;
    }
    try {
      const fileUri = `${FileSystem.cacheDirectory}mochi-ddl-tasks.ics`;
      await FileSystem.writeAsStringAsync(fileUri, icsData, { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, { mimeType: 'text/calendar', dialogTitle: '导出麻糬DDL日历' });
      } else {
        setCompletedMsg('已生成本地ICS日历文件');
        if (confettiTimer.current) clearTimeout(confettiTimer.current);
        confettiTimer.current = setTimeout(() => setCompletedMsg(''), 2000);
      }
    } catch {
      setCompletedMsg('导出失败，请重试');
      if (confettiTimer.current) clearTimeout(confettiTimer.current);
      confettiTimer.current = setTimeout(() => setCompletedMsg(''), 2000);
    }
  };

  // 补完成：弹出确认框
  const handleOvertimeComplete = (id: string) => {
    setOvertimeTarget(id);
  };

  // 确认执行超时补完成
  const confirmOvertimeComplete = async () => {
    if (!overtimeTarget) return;
    setOvertimeConfirming(true);
    try {
      await overtimeCompleteTask(overtimeTarget);
      await cancelTaskNotifications(overtimeTarget);
      setCompletedMsg('📝 超时完成，功德值-10。下次加油！');
      if (confettiTimer.current) clearTimeout(confettiTimer.current);
      confettiTimer.current = setTimeout(() => setCompletedMsg(''), 2500);
      await loadTasks();
    } finally {
      setOvertimeConfirming(false);
      setOvertimeTarget(null);
    }
  };

  // 删除任务（PRD §3 反作弊：红温/高优任务触发惩罚确认；已完成任务触发归档确认）
  const handleDelete = (id: string) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    // 已完成任务 → 归档删除，不触发任何惩罚（SPEC §2.1）
    if (task.completed) {
      setArchiveDeleteTarget(id);
      return;
    }
    const dangerLevel = getDangerLevel(task.deadline, task.priority);
    const isRedHot = dangerLevel === 'critical' || dangerLevel === 'dying';
    const isHighPri = task.priority >= 2;
    if (isRedHot && isHighPri) {
      // 弹出惩罚警告
      setPenaltyDeleteTarget(id);
    } else {
      void (async () => {
        setUndoDeletedTask(task);
        if (undoTimer.current) clearTimeout(undoTimer.current);
        undoTimer.current = setTimeout(() => setUndoDeletedTask(null), 5000);
        await deleteTask(id);
        await cancelTaskNotifications(id);
        await loadTasks();
      })();
    }
  };

  // 确认归档删除（SPEC §4.1）：status 'completed' → 'deleted'，不扣功德/成就/历史
  const confirmArchiveDelete = async () => {
    if (!archiveDeleteTarget) return;
    setArchiveDeleting(true);
    try {
      const task = tasks.find(t => t.id === archiveDeleteTarget);
      if (task) {
        setUndoDeletedTask(task);
        setUndoWasPenalty(false);
        if (undoTimer.current) clearTimeout(undoTimer.current);
        undoTimer.current = setTimeout(() => setUndoDeletedTask(null), 5000);
      }
      await archiveDeleteTask(archiveDeleteTarget);
      await cancelTaskNotifications(archiveDeleteTarget);
      await loadTasks();
    } finally {
      setArchiveDeleting(false);
      setArchiveDeleteTarget(null);
    }
  };

  // 确认惩罚性删除：扣 HP-5 / 功德-10 后删除
  const confirmPenaltyDelete = async () => {
    if (!penaltyDeleteTarget) return;
    setPenaltyDeleting(true);
    try {
      const task = tasks.find(t => t.id === penaltyDeleteTarget);
      if (task) {
        setUndoDeletedTask(task);
        setUndoWasPenalty(true);
        if (undoTimer.current) clearTimeout(undoTimer.current);
        undoTimer.current = setTimeout(() => setUndoDeletedTask(null), 5000);
      }
      await addDeletePenalty(10, 5);
      await deleteTask(penaltyDeleteTarget);
      await cancelTaskNotifications(penaltyDeleteTarget);
      setCompletedMsg('💸 已扣除生命值-5 和功德值-10，你这个逃课犯！');
      if (confettiTimer.current) clearTimeout(confettiTimer.current);
      confettiTimer.current = setTimeout(() => setCompletedMsg(''), 3000);
      await loadTasks();
    } finally {
      setPenaltyDeleting(false);
      setPenaltyDeleteTarget(null);
    }
  };

  // 编辑任务
  const handleEdit = (task: Task) => { setEditTarget(task); };
  const handleSaveEdit = async (
    id: string,
    name: string,
    deadline: string,
    priority: number,
    options?: {
      note?: string;
      category?: string;
      cutoff_deadline?: string;
      reminder_offset?: number;
      subtasks?: SubTask[];
      repeat_rule?: RepeatRule;
    }
  ) => {
    const updated = await updateTask(id, { name, deadline, priority, ...options });
    await cancelTaskNotifications(id);
    if (updated && !updated.completed) {
      await scheduleTaskNotifications(updated);
    }
    await loadTasks();
  };

  const handleCreate = async (
    name: string,
    deadline: Date,
    priority: number,
    options?: {
      note?: string;
      category?: string;
      cutoff_deadline?: string;
      reminder_offset?: number;
      subtasks?: SubTask[];
      repeat_rule?: RepeatRule;
    }
  ) => {
    const created = await createTask(name, deadline.toISOString(), priority, options);
    if (created) {
      await scheduleTaskNotifications(created);
    }
    setCopyTargetTask(null);
    await loadTasks();
  };

  // 取消完成（恢复为进行中）
  const handleUncomplete = async (id: string) => {
    const restored = await uncompleteTask(id);
    if (restored) {
      await scheduleTaskNotifications(restored);
    }
    setCompletedMsg('↩️ 任务已恢复为进行中！');
    if (confettiTimer.current) clearTimeout(confettiTimer.current);
    confettiTimer.current = setTimeout(() => setCompletedMsg(''), 2000);
    await loadTasks();
  };

  // 撤销删除（误删救星）
  const [undoDeletedTask, setUndoDeletedTask] = useState<Task | null>(null);
  const [undoWasPenalty, setUndoWasPenalty] = useState(false);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 回收站弹窗状态
  const [showTrashModal, setShowTrashModal] = useState(false);
  const [trashTasks, setTrashTasks] = useState<Task[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);

  const loadTrash = async () => {
    setTrashLoading(true);
    try {
      const deleted = await getDeletedTasks();
      setTrashTasks(deleted);
    } catch {
      // 忽略
    } finally {
      setTrashLoading(false);
    }
  };

  const handleOpenTrash = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await loadTrash();
    setShowTrashModal(true);
  };

  const handleRestoreFromTrash = async (item: Task) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const restored = await restoreTask(item.id);
    if (restored && !restored.completed) {
      await scheduleTaskNotifications(restored);
    }
    setCompletedMsg(`↩️ 已从回收站恢复【${item.name}】！`);
    if (confettiTimer.current) clearTimeout(confettiTimer.current);
    confettiTimer.current = setTimeout(() => setCompletedMsg(''), 2000);
    await loadTrash();
    await loadTasks();
  };

  const handlePermanentlyDelete = async (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    await permanentlyDeleteTask(id);
    await loadTrash();
  };

  const handleClearTrash = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    await clearTrash();
    await loadTrash();
  };

  const handleUndoDelete = async () => {
    if (!undoDeletedTask) return;
    const restored = await restoreTask(undoDeletedTask.id);
    if (restored && !restored.completed) {
      await scheduleTaskNotifications(restored);
    }
    if (undoWasPenalty) {
      await reverseDeletePenalty(10, 5);
      setUndoWasPenalty(false);
    }
    const restoredName = undoDeletedTask.name;
    setUndoDeletedTask(null);
    setCompletedMsg(`↩️ 已恢复【${restoredName}】！`);
    if (confettiTimer.current) clearTimeout(confettiTimer.current);
    confettiTimer.current = setTimeout(() => setCompletedMsg(''), 2000);
    await loadTasks();
  };

  // 搜索、筛选与排序状态
  const [searchQuery, setSearchQuery] = useState('');
  const [statusTab, setStatusTab] = useState<'active' | 'expired' | 'completed' | 'all'>('active');
  const [selectedCategory, setSelectedCategory] = useState<string>('全部');
  const [sortBy, setSortBy] = useState<'deadline' | 'priority' | 'remaining'>('deadline');

  const CATEGORY_LIST = ['全部', '学习', '工作', '生活', '考研', '紧急'];

  // 统一筛选与排序
  const filteredAndSortedTasks = tasks.filter(t => {
    const isOverdue = formatTimeRemaining(t.deadline) === '已过期';
    // 状态筛选
    if (statusTab === 'active') {
      if (t.completed || isOverdue) return false;
    } else if (statusTab === 'expired') {
      if (t.completed || !isOverdue) return false;
    } else if (statusTab === 'completed') {
      if (!t.completed) return false;
    }
    // 分类筛选
    if (selectedCategory !== '全部') {
      if (t.category !== selectedCategory) return false;
    }
    // 关键词搜索
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const matchName = t.name.toLowerCase().includes(q);
      const matchNote = (t.note || '').toLowerCase().includes(q);
      const matchCat = (t.category || '').toLowerCase().includes(q);
      if (!matchName && !matchNote && !matchCat) return false;
    }
    return true;
  }).sort((a, b) => {
    if (sortBy === 'priority') {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
    }
    if (sortBy === 'remaining') {
      const aLeft = new Date(a.deadline).getTime() - Date.now();
      const bLeft = new Date(b.deadline).getTime() - Date.now();
      return aLeft - bLeft;
    }
    // 已完成任务按实际完成时间倒序排列
    if (statusTab === 'completed') {
      return sortCompletedTasksByTime([a, b])[0] === a ? -1 : 1;
    }
    // 默认按截止时间升序
    return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
  });

  const activeCount = tasks.filter(t => !t.completed && formatTimeRemaining(t.deadline) !== '已过期').length;
  const expiredCount = tasks.filter(t => !t.completed && formatTimeRemaining(t.deadline) === '已过期').length;
  const completedCount = tasks.filter(t => t.completed).length;

  const fabScale = useSharedValue(1);
  const fabStyle = useAnimatedStyle(() => ({ transform: [{ scale: fabScale.value }] }));

  return (
    <View style={{ flex: 1, backgroundColor: C_BG }}>
      {/* §1.6 压线裂开动画 + 涂鸦叠加 */}
      <CrackAnimation visible={showCrack} onDone={() => setShowCrack(false)} />
      <DoodleOverlay visible={showDoodle} />

      {/* 彩花动画 */}
      <ConfettiBurst visible={showConfetti} />

      {/* 盖戳印章 */}
      {showStamp && <DoneStamp onDismiss={() => setShowStamp(false)} />}

      {/* 完成提示 */}
      {completedMsg ? (
        <View style={{
          position: 'absolute', top: 56, left: 16, right: 16, zIndex: 10,
          backgroundColor: C_MINT,
          borderRadius: 16, padding: 14,
          boxShadow: [{ offsetX: 0, offsetY: 4, blurRadius: 16, color: 'rgba(46,196,182,0.35)' }],
        }}>
          <Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold', textAlign: 'center' }}>{completedMsg}</Text>
        </View>
      ) : null}

      {/* 撤销删除浮条（5秒自动消失） */}
      {undoDeletedTask && (
        <View style={{
          position: 'absolute', top: 56, left: 16, right: 16, zIndex: 11,
          backgroundColor: '#333333',
          borderRadius: 16, padding: 12, paddingHorizontal: 16,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          boxShadow: [{ offsetX: 0, offsetY: 4, blurRadius: 16, color: 'rgba(0,0,0,0.35)' }],
        }}>
          <Text style={{ color: '#fff', fontSize: 13, flex: 1 }} numberOfLines={1}>
            已删除「{undoDeletedTask.name}」
          </Text>
          <Pressable
            onPress={handleUndoDelete}
            style={{ backgroundColor: C_PINK, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}
          >
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>↩️ 撤销</Text>
          </Pressable>
        </View>
      )}

      {/* 顶部标题与导出 */}
      <View style={{ paddingTop: 52, paddingHorizontal: 16, paddingBottom: 6 }}>
        <Text style={{ color: C_MUTED, fontSize: 11 }}>BOSS 战场</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <Text style={{ color: C_PINK, fontSize: 24, fontWeight: 'bold' }}>⚔️ DDL 战列</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Pressable
              onPress={() => void handleOpenTrash()}
              style={{
                backgroundColor: '#FFFFFF',
                borderRadius: 20,
                borderWidth: 1.5,
                borderColor: '#FF5E7C',
                paddingHorizontal: 9,
                paddingVertical: 5,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                boxShadow: [{ offsetX: 1.5, offsetY: 1.5, blurRadius: 0, color: '#2D2A26' }],
              }}
            >
              <Text style={{ fontSize: 12 }}>🗑️</Text>
              <Text style={{ color: C_PINK, fontSize: 12, fontWeight: 'bold' }}>回收站</Text>
            </Pressable>
            <Pressable
              onPress={() => void handleExportICS()}
              style={{
                backgroundColor: '#FFFFFF',
                borderRadius: 20,
                borderWidth: 1.5,
                borderColor: C_PURPLE,
                paddingHorizontal: 9,
                paddingVertical: 5,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                boxShadow: [{ offsetX: 1.5, offsetY: 1.5, blurRadius: 0, color: '#2D2A26' }],
              }}
            >
              <Text style={{ fontSize: 12 }}>📥</Text>
              <Text style={{ color: C_PURPLE, fontSize: 12, fontWeight: 'bold' }}>导出ICS</Text>
            </Pressable>
            <View style={{ backgroundColor: activeCount > 0 ? '#FFF0F4' : '#F0FFFE', borderRadius: 99, paddingHorizontal: 9, paddingVertical: 5 }}>
              <Text style={{ color: activeCount > 0 ? C_PINK : C_MINT, fontSize: 12, fontWeight: '600' }}>
                {activeCount} 进行中
              </Text>
            </View>
          </View>
        </View>

        {/* 视图模式切换：列表 / 今天 / 本周 / 月历 */}
        <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8, backgroundColor: '#EFEAE0', borderRadius: 12, padding: 3 }}>
          {[
            { mode: 'list', label: '📋 战列' },
            { mode: 'today', label: '☀️ 今日' },
            { mode: 'week', label: '📅 本周' },
            { mode: 'month', label: '🗓️ 月历' },
          ].map(item => {
            const isActive = calendarViewMode === item.mode;
            return (
              <Pressable
                key={item.mode}
                onPress={() => setCalendarViewMode(item.mode as any)}
                style={{
                  flex: 1,
                  paddingVertical: 6,
                  borderRadius: 10,
                  alignItems: 'center',
                  backgroundColor: isActive ? C_PURPLE : 'transparent',
                }}
              >
                <Text style={{
                  fontSize: 12,
                  fontWeight: isActive ? 'bold' : '600',
                  color: isActive ? '#fff' : C_MUTED,
                }}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {calendarViewMode === 'list' && (
          <>
            {/* 搜索框 */}
            <View style={{
              flexDirection: 'row', alignItems: 'center',
              backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#E8E0D0',
              paddingHorizontal: 12, paddingVertical: 6, marginBottom: 8,
            }}>
              <Text style={{ fontSize: 14, marginRight: 6 }}>🔍</Text>
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="搜索任务名称、分类或备注…"
                placeholderTextColor={C_MUTED}
                style={{ flex: 1, color: C_TEXT, fontSize: 13, padding: 0 }}
              />
              {searchQuery ? (
                <Pressable onPress={() => setSearchQuery('')} style={{ padding: 4 }}>
                  <Text style={{ color: C_MUTED, fontSize: 14 }}>✕</Text>
                </Pressable>
              ) : null}
            </View>

            {/* 状态 Tab */}
            <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
              {[
                { key: 'active', label: `进行中 (${activeCount})` },
                { key: 'expired', label: `已过期 (${expiredCount})` },
                { key: 'completed', label: `已完成 (${completedCount})` },
                { key: 'all', label: `全部 (${tasks.length})` },
              ].map(tab => (
                <Pressable
                  key={tab.key}
                  onPress={() => setStatusTab(tab.key as any)}
                  style={{
                    flex: 1, paddingVertical: 7, borderRadius: 10, alignItems: 'center',
                    backgroundColor: statusTab === tab.key ? C_PURPLE : '#F3EFE6',
                  }}
                >
                  <Text style={{
                    color: statusTab === tab.key ? '#fff' : C_MUTED,
                    fontSize: 11, fontWeight: statusTab === tab.key ? 'bold' : 'normal',
                  }}>
                    {tab.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* 分类筛选与排序切换 */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              {/* 分类胶囊横滑 */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingRight: 8 }}>
                {CATEGORY_LIST.map(cat => (
                  <Pressable
                    key={cat}
                    onPress={() => setSelectedCategory(cat)}
                    style={{
                      paddingHorizontal: 10, paddingVertical: 4, borderRadius: 16,
                      backgroundColor: selectedCategory === cat ? '#E8E4FF' : '#FFF',
                      borderWidth: 1, borderColor: selectedCategory === cat ? C_PURPLE : '#E8E0D0',
                    }}
                  >
                    <Text style={{ color: selectedCategory === cat ? C_PURPLE : C_MUTED, fontSize: 11, fontWeight: '600' }}>
                      {cat === '全部' ? '🏷️ 全部' : cat}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>

              {/* 排序模式 */}
              <Pressable
                onPress={() => {
                  if (sortBy === 'deadline') setSortBy('priority');
                  else if (sortBy === 'priority') setSortBy('remaining');
                  else setSortBy('deadline');
                }}
                style={{
                  paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12,
                  backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E8E0D0',
                  flexDirection: 'row', alignItems: 'center', gap: 2,
                }}
              >
                <Text style={{ fontSize: 11, color: C_TEXT, fontWeight: '600' }}>
                  {sortBy === 'deadline' ? '📅 截止' : sortBy === 'priority' ? '🔥 优先级' : '⏳ 剩余'}
                </Text>
              </Pressable>
            </View>
          </>
        )}
      </View>

      {/* 通知权限 Level 1 横幅（PRD §3.3.5） */}
      {notifPermission === 'denied' && !notifBannerDismissed && (
        <View style={{
          backgroundColor: '#FFE4EC',
          borderRadius: 14,
          padding: 12,
          marginHorizontal: 16,
          marginBottom: 6,
          flexDirection: 'row',
          alignItems: 'center',
          borderWidth: 1.5,
          borderColor: '#FF5E7C',
          gap: 10,
        }}>
          <Text style={{ fontSize: 18 }}>🔔</Text>
          <Pressable style={{ flex: 1 }} onPress={() => void Linking.openSettings()}>
            <Text style={{ color: '#FF5E7C', fontSize: 12, fontWeight: 'bold' }}>
              开启通知可在DDL截止前收到提醒
            </Text>
            <Text style={{ color: '#FF5E7C', fontSize: 10 }}>→ 去开启权限</Text>
          </Pressable>
          <Pressable
            onPress={async () => {
              await AsyncStorage.setItem('notif_banner_dismissed_ddl', '1');
              setNotifBannerDismissed(true);
            }}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 8,
              backgroundColor: 'rgba(255,94,124,0.12)',
            }}
          >
            <Text style={{ color: '#FF5E7C', fontSize: 11, fontWeight: 'bold' }}>不再提示</Text>
          </Pressable>
        </View>
      )}

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 36 }}>⚔️</Text>
          <ActivityIndicator color={C_PINK} style={{ marginTop: 12 }} />
        </View>
      ) : loadError ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <Text style={{ fontSize: 40, marginBottom: 12 }}>💥</Text>
          <Text style={{ color: C_PINK, fontSize: 15, fontWeight: 'bold', textAlign: 'center', marginBottom: 8 }}>
            数据库启动失败
          </Text>
          <Text style={{ color: C_MUTED, fontSize: 12, textAlign: 'center', lineHeight: 18, marginBottom: 20 }}>
            {loadError}
          </Text>
          <Pressable
            onPress={() => { setLoading(true); void loadTasks(); }}
            style={{ backgroundColor: C_PINK, borderRadius: 14, paddingHorizontal: 24, paddingVertical: 10 }}
          >
            <Text style={{ color: '#fff', fontWeight: '600' }}>重新连接</Text>
          </Pressable>
        </View>
      ) : calendarViewMode !== 'list' ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 110 }}>
          <DDLCalendarView
            mode={calendarViewMode}
            selectedDate={selectedCalendarDate}
            onSelectDate={setSelectedCalendarDate}
            tasks={tasks}
            onComplete={handleComplete}
            onUncomplete={handleUncomplete}
            onDelete={handleDelete}
            onOvertimeComplete={handleOvertimeComplete}
            onEdit={handleEdit}
            onCopy={handleQuickCopy}
            onPostpone={handleQuickPostpone}
            onToggleSubTask={handleToggleSubtask}
          />
        </ScrollView>
      ) : (
        <FlatList
          data={filteredAndSortedTasks}
          keyExtractor={item => item.id}
          contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: 110 }}
          contentInsetAdjustmentBehavior="automatic"
          ListEmptyComponent={
            (() => {
              const emptyType = getEmptyStateType({ statusTab, searchQuery, selectedCategory, tasks });
              const config = getEmptyStateConfig(emptyType, selectedCategory);
              const hasCompleted = tasks.some(t => t.completed);
              return (
                <View style={{
                  backgroundColor: '#FFFFFF',
                  borderRadius: 24,
                  padding: 28,
                  alignItems: 'center',
                  borderWidth: 2,
                  borderColor: '#2D2A26',
                  boxShadow: [{ offsetX: 3, offsetY: 3, blurRadius: 0, color: '#2D2A26' }],
                }}>
                  <Text style={{ fontSize: 48 }}>{config.emoji}</Text>
                  <Text style={{ color: C_MINT, fontSize: 17, fontWeight: 'bold', marginTop: 12 }}>{config.title}</Text>
                  <Text style={{ color: C_MUTED, fontSize: 12, marginTop: 6, textAlign: 'center', lineHeight: 18 }}>
                    {config.subtitle}
                  </Text>
                  
                  {/* 引导按钮区域 */}
                  <View style={{ marginTop: 16, gap: 10, width: '100%' }}>
                    {/* 进行中为空但有已完成任务 → 提供查看已完成入口 */}
                    {emptyType === 'active-empty' && hasCompleted && (
                      <Pressable
                        onPress={() => setStatusTab('completed')}
                        style={{
                          backgroundColor: '#E8FBF8',
                          borderRadius: 12,
                          paddingVertical: 10,
                          paddingHorizontal: 20,
                          borderWidth: 1.5,
                          borderColor: C_MINT,
                          alignItems: 'center',
                          boxShadow: [{ offsetX: 2, offsetY: 2, blurRadius: 0, color: '#2D2A26' }],
                        }}
                      >
                        <Text style={{ color: C_MINT, fontSize: 13, fontWeight: 'bold' }}>📋 查看已完成</Text>
                      </Pressable>
                    )}
                    
                    {/* 所有任务都为空 → 提供创建 DDL 入口 */}
                    {config.showCreateButton && (
                      <Pressable
                        onPress={() => setShowCreate(true)}
                        style={{
                          backgroundColor: C_PINK,
                          borderRadius: 12,
                          paddingVertical: 12,
                          paddingHorizontal: 24,
                          borderWidth: 2,
                          borderColor: '#2D2A26',
                          alignItems: 'center',
                          boxShadow: [{ offsetX: 2, offsetY: 2, blurRadius: 0, color: '#2D2A26' }],
                        }}
                      >
                        <Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>✨ 创建第一个 DDL</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              );
            })()
          }
          renderItem={({ item }) => (
            <SwipeableRow onDelete={() => handleDelete(item.id)} borderRadius={20} marginBottom={0}>
              <TaskCard
                task={item}
                onComplete={handleComplete}
                onUncomplete={handleUncomplete}
                onDelete={handleDelete}
                onOvertimeComplete={handleOvertimeComplete}
                onEdit={handleEdit}
                onCopy={handleQuickCopy}
                onPostpone={handleQuickPostpone}
                onToggleSubTask={handleToggleSubtask}
              />
            </SwipeableRow>
          )}
        />
      )}

      {/* 悬浮添加按钮 */}
      <View style={{ position: 'absolute', bottom: 100, right: 20 }}>
        <Animated.View style={fabStyle}>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              fabScale.value = withSequence(withSpring(0.85), withSpring(1));
              setShowCreate(true);
            }}
            style={{
              backgroundColor: C_PINK,
              width: 56, height: 56,
              borderRadius: 28,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 2,
              borderColor: '#2D2A26',
              boxShadow: [{ offsetX: 3, offsetY: 3, blurRadius: 0, color: '#2D2A26' }],
            }}
          >
            <Text style={{ color: '#fff', fontSize: 28, marginTop: -2, fontWeight: 'bold' }}>+</Text>
          </Pressable>
        </Animated.View>
      </View>

      <CreateTaskModal
        visible={showCreate}
        initialData={copyTargetTask}
        onClose={() => {
          setShowCreate(false);
          setCopyTargetTask(null);
        }}
        onCreate={handleCreate}
      />

      {/* 快捷延期弹窗 */}
      <PostponeModal
        visible={!!postponeTarget}
        task={postponeTarget}
        onClose={() => setPostponeTarget(null)}
        onConfirm={handleConfirmPostpone}
      />

      {/* 补完成确认弹窗（PRD 3.3.3） */}
      <Modal visible={!!overtimeTarget} transparent animationType="fade" onRequestClose={() => setOvertimeTarget(null)}>
        <View style={{
          flex: 1, backgroundColor: 'rgba(51,33,66,0.45)',
          alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28,
        }}>
          <View style={{
            backgroundColor: C_BG, borderRadius: 28, padding: 28, width: '100%',
            boxShadow: [{ offsetX: 0, offsetY: 8, blurRadius: 32, color: 'rgba(0,0,0,0.18)' }],
          }}>
            <Text style={{ fontSize: 40, textAlign: 'center', marginBottom: 10 }}>⏰</Text>
            <Text style={{ color: C_TEXT, fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 8 }}>
              超时完成确认
            </Text>
            <Text style={{ color: C_MUTED, fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 24 }}>
              该任务已超过截止时间{'\n'}
              补完成将扣除 <Text style={{ color: C_PINK, fontWeight: 'bold' }}>功德值 -10</Text>{'\n'}
              确定要标记为「超时完成」吗？
            </Text>
            <Pressable
              onPress={() => void confirmOvertimeComplete()}
              disabled={overtimeConfirming}
              style={{
                backgroundColor: '#888', borderRadius: 16, paddingVertical: 14,
                alignItems: 'center', marginBottom: 10,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>
                {overtimeConfirming ? '处理中…' : '✅ 确定，补完成'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setOvertimeTarget(null)}
              style={{ alignItems: 'center', paddingVertical: 10 }}
            >
              <Text style={{ color: C_MUTED, fontSize: 13 }}>取消</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── 编辑任务弹窗（PRD §7 防逃课：已过期任务 deadline 只读）──────── */}
      <EditTaskModal
        visible={!!editTarget}
        task={editTarget}
        onClose={() => setEditTarget(null)}
        onSave={handleSaveEdit}
      />

      {/* ── 已完成任务归档删除确认（SPEC §5.2）──────────────────────────── */}
      <Modal
        visible={!!archiveDeleteTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setArchiveDeleteTarget(null)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(51,33,66,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <View style={{
            backgroundColor: C_BG, borderRadius: 28, padding: 24, width: '100%',
            boxShadow: [{ offsetX: 0, offsetY: 8, blurRadius: 32, color: 'rgba(0,0,0,0.14)' }],
          }}>
            <Text style={{ fontSize: 36, textAlign: 'center', marginBottom: 8 }}>📦</Text>
            <Text style={{ color: C_TEXT, fontSize: 17, fontWeight: 'bold', textAlign: 'center', marginBottom: 6 }}>
              归档删除确认
            </Text>
            <Text style={{ color: C_MUTED, fontSize: 13, textAlign: 'center', marginBottom: 16, lineHeight: 20 }}>
              「{tasks.find(t => t.id === archiveDeleteTarget)?.name ?? ''}」已完成{'\n'}确定要移除吗？
            </Text>
            {/* 三条保证 */}
            {['功德值保持不变', '已解锁成就保留', '历史数据不变'].map(msg => (
              <View key={msg} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Text style={{ fontSize: 16 }}>✅</Text>
                <Text style={{ color: C_TEXT, fontSize: 13 }}>{msg}</Text>
              </View>
            ))}
            <View style={{ height: 16 }} />
            <Pressable
              onPress={() => void confirmArchiveDelete()}
              disabled={archiveDeleting}
              style={{
                backgroundColor: C_MINT, borderRadius: 16, paddingVertical: 14,
                alignItems: 'center', marginBottom: 10,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>
                {archiveDeleting ? '归档中…' : '确定移除'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setArchiveDeleteTarget(null)}
              style={{ alignItems: 'center', paddingVertical: 10 }}
            >
              <Text style={{ color: C_MUTED, fontSize: 13 }}>我再看看</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── 红温任务惩罚性删除确认（PRD §3 反作弊）────────────────────── */}
      <Modal
        visible={!!penaltyDeleteTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setPenaltyDeleteTarget(null)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <View style={{
            backgroundColor: '#FFFDF2', borderRadius: 24, padding: 24, width: '100%',
            boxShadow: [{ offsetX: 0, offsetY: 8, blurRadius: 32, color: 'rgba(255,94,124,0.25)' }],
          }}>
            <Text style={{ color: C_PINK, fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginBottom: 12 }}>
              ⚠️ 危险操作警告
            </Text>
            <Text style={{ color: C_TEXT, fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 24 }}>
              临时删除 DDL 可不会让你的身体免于伤害！{'\n\n'}
              删除此「红温」任务将立即扣除{'\n'}
              <Text style={{ color: C_PINK, fontWeight: 'bold' }}>生命值 -5</Text>
              {'  '}和{'  '}
              <Text style={{ color: '#FF8C00', fontWeight: 'bold' }}>功德值 -10</Text>
              {'\n\n'}作为惩罚。确定吗？
            </Text>
            <Pressable
              onPress={() => void confirmPenaltyDelete()}
              disabled={penaltyDeleting}
              style={{
                backgroundColor: C_PINK, borderRadius: 16, paddingVertical: 14,
                alignItems: 'center', marginBottom: 10,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>
                {penaltyDeleting ? '处理中…' : '💸 接受惩罚，强制删除'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setPenaltyDeleteTarget(null)}
              style={{ alignItems: 'center', paddingVertical: 10 }}
            >
              <Text style={{ color: C_MUTED, fontSize: 13 }}>取消，我再想想</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── 回收站管理弹窗（支持随时恢复与永久清空） ────────────────────── */}
      <Modal
        visible={showTrashModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowTrashModal(false)}
      >
        <Pressable
          onPress={() => setShowTrashModal(false)}
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.5)',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <Pressable
            onPress={e => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 380,
              maxHeight: '80%',
              backgroundColor: '#FFFFFF',
              borderRadius: 24,
              borderWidth: 2,
              borderColor: '#2D2A26',
              padding: 18,
              boxShadow: [{ offsetX: 3, offsetY: 3, blurRadius: 0, color: '#2D2A26' }],
            }}
          >
            {/* 头部 */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 18 }}>🗑️</Text>
                <Text style={{ color: '#2D2A26', fontSize: 17, fontWeight: 'bold' }}>
                  DDL 回收站
                </Text>
                <View style={{ backgroundColor: '#FAF7EC', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: '#2D2A26' }}>
                  <Text style={{ fontSize: 11, fontWeight: 'bold', color: C_MUTED }}>{trashTasks.length} 个</Text>
                </View>
              </View>
              <Pressable
                onPress={() => setShowTrashModal(false)}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  backgroundColor: '#F3EFE6',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1,
                  borderColor: '#2D2A26',
                }}
              >
                <Text style={{ fontSize: 14, fontWeight: 'bold', color: '#2D2A26' }}>✕</Text>
              </Pressable>
            </View>

            <Text style={{ color: C_MUTED, fontSize: 12, marginBottom: 12 }}>
              已删除的 DDL 会暂存在此，可随时点「↩️ 恢复」找回，或永久彻底清除。
            </Text>

            {/* 列表 */}
            {trashLoading ? (
              <View style={{ paddingVertical: 36, alignItems: 'center' }}>
                <ActivityIndicator color={C_PINK} />
              </View>
            ) : trashTasks.length === 0 ? (
              <View style={{ paddingVertical: 36, alignItems: 'center' }}>
                <Text style={{ fontSize: 32, marginBottom: 8 }}>✨</Text>
                <Text style={{ color: '#2D2A26', fontSize: 14, fontWeight: 'bold' }}>回收站空空如也</Text>
                <Text style={{ color: C_MUTED, fontSize: 12, marginTop: 4 }}>没有被删除的 DDL 任务</Text>
              </View>
            ) : (
              <FlatList
                data={trashTasks}
                keyExtractor={item => item.id}
                style={{ maxHeight: 320 }}
                contentContainerStyle={{ gap: 8, paddingBottom: 10 }}
                renderItem={({ item }) => (
                  <View style={{
                    backgroundColor: '#FAF7EC',
                    borderRadius: 14,
                    borderWidth: 1.5,
                    borderColor: '#2D2A26',
                    padding: 10,
                  }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                      <Text style={{ color: '#2D2A26', fontSize: 14, fontWeight: 'bold', flex: 1, marginRight: 8 }} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <View style={{
                        backgroundColor: item.completed ? '#E8F5E9' : '#EDE9FF',
                        borderRadius: 6,
                        paddingHorizontal: 6,
                        paddingVertical: 1,
                      }}>
                        <Text style={{ fontSize: 10, fontWeight: 'bold', color: item.completed ? '#2E7D32' : C_PURPLE }}>
                          {item.completed ? '已完成' : '进行中'}
                        </Text>
                      </View>
                    </View>

                    <Text style={{ color: C_MUTED, fontSize: 11, marginBottom: 8 }}>
                      截止：{formatDeadlineDisplay(new Date(item.deadline))}
                    </Text>

                    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
                      <Pressable
                        onPress={() => void handlePermanentlyDelete(item.id)}
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 5,
                          borderRadius: 8,
                          backgroundColor: '#FFFFFF',
                          borderWidth: 1,
                          borderColor: '#E8E2D2',
                        }}
                      >
                        <Text style={{ color: C_RED, fontSize: 11, fontWeight: 'bold' }}>彻底删除</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => void handleRestoreFromTrash(item)}
                        style={{
                          paddingHorizontal: 12,
                          paddingVertical: 5,
                          borderRadius: 8,
                          backgroundColor: C_PINK,
                          borderWidth: 1.5,
                          borderColor: '#2D2A26',
                          boxShadow: [{ offsetX: 1, offsetY: 1, blurRadius: 0, color: '#2D2A26' }],
                        }}
                      >
                        <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: 'bold' }}>↩️ 恢复任务</Text>
                      </Pressable>
                    </View>
                  </View>
                )}
              />
            )}

            {/* 底部操作 */}
            {trashTasks.length > 0 && (
              <View style={{ marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderColor: '#F0EAE1', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Pressable
                  onPress={() => void handleClearTrash()}
                  style={{
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 10,
                    backgroundColor: '#FFF0F0',
                    borderWidth: 1,
                    borderColor: C_RED,
                  }}
                >
                  <Text style={{ color: C_RED, fontSize: 12, fontWeight: 'bold' }}>清空回收站</Text>
                </Pressable>
                <Pressable
                  onPress={() => setShowTrashModal(false)}
                  style={{
                    paddingVertical: 8,
                    paddingHorizontal: 16,
                    borderRadius: 10,
                    backgroundColor: '#F3EFE6',
                    borderWidth: 1.5,
                    borderColor: '#2D2A26',
                  }}
                >
                  <Text style={{ color: '#2D2A26', fontSize: 12, fontWeight: 'bold' }}>关闭</Text>
                </Pressable>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
