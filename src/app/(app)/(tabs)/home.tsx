import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { getAllTasks, getRecentRecords, getTodayRecord, loadWearState, loadCutoffHour, loadPenaltyAdjustments } from '@/db/api';
import {
  getDangerLabel,
  getDangerLevel,
  getHealthBarPercent,
  getMostDangerousTask,
  formatTimeRemaining,
} from '@/lib/ddl';
import { calculateSpiritState, getGlitchLevel } from '@/lib/state';
import { calculatePersonality } from '@/lib/personality';
import { getAutoTaunt } from '@/lib/taunts';
import { syncAllNotifications } from '@/lib/notifications';
import { getTodayQuote, getRandomQuote, getOnlyMine } from '@/lib/quotesDb';
import { checkAndUnlockAchievements, Achievement } from '@/lib/achievements';
import AchievementUnlockModal from '@/components/AchievementUnlockModal';
import MochiWidget, { resolveMochiState, useMochiMeta, useCompletedTodayTrigger } from '@/components/MochiWidget';
import { usePerformanceFlags } from '@/ctx/PerformanceContext';
import { SpiritState, Task, TimeRecord, WearState } from '@/types/types';
import { NewbieGuideModal } from '@/components/NewbieGuideModal';

// 多巴胺配色
const C_BG = '#FFFDF2';
const C_PINK = '#FF5E7C';
const C_PURPLE = '#6C63FF';
const C_YELLOW = '#FFD166';
const C_MINT = '#2EC4B6';
const C_RED = '#FF003C';
const C_TEXT = '#333333';
const C_MUTED = '#888888';

// ── 贴纸错位：每张贴纸在红温/濒死时随机偏移 ±(2~6)px（PRD §1.5）
interface StickerOffset { x: number; y: number; rot: number }
function genStickerOffsets(count: number): StickerOffset[] {
  return Array.from({ length: count }, () => ({
    x: (Math.random() - 0.5) * 10,
    y: (Math.random() - 0.5) * 10,
    rot: (Math.random() - 0.5) * 8,
  }));
}

function getNewDangerColor(level: string): string {
  switch (level) {
    case 'safe': return C_MINT;
    case 'warning': return C_YELLOW;
    case 'danger': return '#FF8C00';
    case 'critical': return C_PINK;
    case 'dying': return C_RED;
    default: return C_MINT;
  }
}

function JuiceBar({ percent, color, label, value }: {
  percent: number;
  color: string;
  label: string;
  value: string;
}) {
  const anim = useSharedValue(0);
  useEffect(() => {
    anim.value = withSpring(percent / 100, { damping: 12 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [percent]);
  const barStyle = useAnimatedStyle(() => ({
    width: `${anim.value * 100}%` as unknown as number,
  }));
  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
        <Text style={{ color: '#2D2A26', fontSize: 12, fontWeight: '600' }}>{label}</Text>
        <Text style={{ color: '#2D2A26', fontSize: 12, fontWeight: 'bold', fontVariant: ['tabular-nums'] }}>{value}</Text>
      </View>
      <View style={{
        height: 14,
        backgroundColor: '#F3EFE6',
        borderRadius: 6,
        borderWidth: 1.5,
        borderColor: '#2D2A26',
        overflow: 'hidden',
        padding: 1.5,
      }}>
        <Animated.View style={[{ height: '100%', backgroundColor: color, borderRadius: 3 }, barStyle]} />
      </View>
    </View>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return (
    <View style={[{
      backgroundColor: '#FFFFFF',
      borderRadius: 16,
      borderWidth: 2,
      borderColor: '#2D2A26',
      padding: 16,
      marginBottom: 14,
      boxShadow: [{ offsetX: 2.5, offsetY: 2.5, blurRadius: 0, color: '#2D2A26' }],
    }, style]}>
      {children}
    </View>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const { stickerEnabled } = usePerformanceFlags();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [todayRecord, setTodayRecord] = useState<TimeRecord | null>(null);
  const [recentRecords, setRecentRecords] = useState<TimeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [taunt, setTaunt] = useState('');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [dormQuote, setDormQuote] = useState('');
  // 磨损值
  const [wearState, setWearState] = useState<WearState>({ wearValue: 0, lastLowHpDays: 0, lastSettleDate: '' });
  const [penaltyAdjust, setPenaltyAdjust] = useState({ karmaDeduct: 0, hpDeduct: 0 });
  // 通知权限状态
  const [notifPermission, setNotifPermission] = useState<'granted' | 'denied' | 'undetermined'>('undetermined');
  // 通知横幅「不再提示」（PRD §3.2.7）
  const [notifBannerDismissed, setNotifBannerDismissed] = useState(false);
  const [showNewbieGuide, setShowNewbieGuide] = useState(false);
  // 成就解锁队列（PRD §3.7.2）
  const [achievementQueue, setAchievementQueue] = useState<Achievement[]>([]);
  const [currentAchievement, setCurrentAchievement] = useState<Achievement | null>(null);

  // 吉祥物气泡
  const [mascotBubble, setMascotBubble] = useState('');
  const [showBubble, setShowBubble] = useState(false);
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 强制休息模式
  const [restMode, setRestMode] = useState(false);
  const [restSecondsLeft, setRestSecondsLeft] = useState(3600);
  const prevLifeRef = useRef<number>(100);

  // §1.2 completed_today 触发（8s 限时动画）
  const { hasCompletedToday, triggerCompleted } = useCompletedTodayTrigger();

  // 检测跨屏任务完成事件（ddl.tsx 写入 last_task_completed_at，focus 时读取）
  const lastCompletedRef = useRef<string | null>(null);
  const checkCompletedEvent = useCallback(async () => {
    const ts = await AsyncStorage.getItem('last_task_completed_at');
    if (ts && ts !== lastCompletedRef.current) {
      lastCompletedRef.current = ts;
      // 30s 内的完成事件才触发（避免历史残留）
      if (Date.now() - Number(ts) < 30000) {
        triggerCompleted();
      }
    }
  }, [triggerCompleted]);

  // mascotBounce / mascotTap 已迁移至 MochiWidget 内部，保留 blinkOpacity / bgPink / restOverlay
  const blinkOpacity = useSharedValue(1);
  const bgPink = useSharedValue(0);
  // 强制休息蒙层透明度
  const restOverlay = useSharedValue(0);
  // PRD §3.2.2 / §4.20：SAN<20% 一键摸鱼按钮脉冲
  const sanPulse = useSharedValue(1);
  // PRD §3.2.1：功德值负数漂浮
  const karmaFloat = useSharedValue(0);

  // §1.5 文字歪斜动画（人格称号 + 语录标签在红温/濒死时倾斜）
  const skewAnim = useSharedValue(0);
  // §1.5 贴纸错位：语录卡片 & 功德值标签的随机偏移（红温时随机生成）
  const [stickerOffsets, setStickerOffsets] = useState(() => genStickerOffsets(3));
  const stickerTranslateX0 = useSharedValue(0);
  const stickerTranslateY0 = useSharedValue(0);
  const stickerRot0        = useSharedValue(0);
  const stickerTranslateX1 = useSharedValue(0);
  const stickerTranslateY1 = useSharedValue(0);
  const stickerRot1        = useSharedValue(0);
  const stickerTranslateX2 = useSharedValue(0);
  const stickerTranslateY2 = useSharedValue(0);
  const stickerRot2        = useSharedValue(0);

  const loadData = useCallback(async () => {
    try {
      const cutoff = await loadCutoffHour();
      const [allTasks, today, recent, wear, penalty, dismissed, hasSeenGuide] = await Promise.all([
        getAllTasks(),
        getTodayRecord(cutoff),
        getRecentRecords(7),
        loadWearState(),
        loadPenaltyAdjustments(),
        AsyncStorage.getItem('notif_banner_dismissed_home'),
        AsyncStorage.getItem('has_seen_newbie_guide'),
      ]);
      setTasks(allTasks);
      setTodayRecord(today);
      setRecentRecords(recent);
      setWearState(wear);
      setPenaltyAdjust(penalty);
      setNotifBannerDismissed(dismissed === '1');
      if (hasSeenGuide !== '1') {
        setShowNewbieGuide(true);
      }
      // 检查通知权限
      const { status } = await Notifications.getPermissionsAsync();
      setNotifPermission(status as 'granted' | 'denied' | 'undetermined');
      // 同步推送通知
      syncAllNotifications(allTasks).catch(() => undefined);
      // PRD §4.5 检查并解锁成就（Anti-Cheat §4：不可逆）
      const spirit = calculateSpiritState(allTasks, today, recent, wear, penalty);
      checkAndUnlockAchievements(
        allTasks,
        recent,
        new Date().getHours(),
        spirit.meritPoints,
      ).then(newly => {
        if (newly.length > 0) setAchievementQueue(q => [...q, ...newly]);
      }).catch(() => undefined);
    } catch {
      // 忽略错误
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    loadData();
    void checkCompletedEvent();
    // 异步加载今日激励语录（当天固定，不随切页/刷新变化）
    getOnlyMine().then(onlyMine => getTodayQuote(onlyMine)).then(q => setDormQuote(q)).catch(() => {});
  }, [loadData, checkCompletedEvent]));

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const spirit: SpiritState = calculateSpiritState(tasks, todayRecord, recentRecords, wearState, penaltyAdjust);
  const glitchLevel = getGlitchLevel(spirit, currentTime.getHours() >= 0 && currentTime.getHours() < 5);
  const mostDangerous = getMostDangerousTask(tasks);
  const personality = calculatePersonality(tasks, recentRecords);
  const activeTasks = tasks.filter(t => !t.completed);
  const dangerousTasks = activeTasks.filter(t => ['critical', 'dying'].includes(getDangerLevel(t.deadline)));
  const dyingTasks = activeTasks.filter(t => getDangerLevel(t.deadline) === 'dying');
  // §1.3 MochiWidget 状态（HP<10% 独立最高优先级）
  const mochiState = resolveMochiState({
    hp: spirit.lifePoints,
    san: spirit.sanityPoints,
    karma: spirit.meritPoints,
    hasCompletedToday,
    hasRedHotDDL: dangerousTasks.length > 0,
  });
  const mochiMeta = useMochiMeta(mochiState);

  // ── 全部完成庆祝横幅（有任务 + 全完成）──────────────────
  const [celebrationVisible, setCelebrationVisible] = useState(false);
  const celebrationY = useSharedValue(-80);
  const celebrationOp = useSharedValue(0);
  const allClear = tasks.length > 0 && activeTasks.length === 0;

  useEffect(() => {
    if (allClear && !celebrationVisible) {
      setCelebrationVisible(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      celebrationOp.value = withTiming(1, { duration: 400 });
      celebrationY.value = withSpring(0, { damping: 14, stiffness: 180 });
      const hide = setTimeout(() => {
        celebrationOp.value = withTiming(0, { duration: 500 });
        celebrationY.value = withTiming(-80, { duration: 500 });
        setTimeout(() => setCelebrationVisible(false), 500);
      }, 5000);
      return () => clearTimeout(hide);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allClear]);

  const celebrationBannerStyle = useAnimatedStyle(() => ({
    opacity: celebrationOp.value,
    transform: [{ translateY: celebrationY.value }],
  }));

  // 成就队列消费：逐个弹出（PRD §3.7.2）
  useEffect(() => {
    if (!currentAchievement && achievementQueue.length > 0) {
      const [next, ...rest] = achievementQueue;
      setCurrentAchievement(next);
      setAchievementQueue(rest);
    }
  }, [currentAchievement, achievementQueue]);

  // 生命值首次归零时触发强制休息
  useEffect(() => {
    if (prevLifeRef.current > 0 && spirit.lifePoints === 0 && !restMode) {
      setRestMode(true);
      setRestSecondsLeft(3600);
      restOverlay.value = withTiming(1, { duration: 800 });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
    prevLifeRef.current = spirit.lifePoints;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spirit.lifePoints]);

  // 强制休息倒计时
  useEffect(() => {
    if (!restMode) return;
    const timer = setInterval(() => {
      setRestSecondsLeft(s => {
        if (s <= 1) {
          setRestMode(false);
          restOverlay.value = withTiming(0, { duration: 600 });
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restMode]);

  useEffect(() => {
    const text = getAutoTaunt({
      hour: currentTime.getHours(),
      slackMinutes: todayRecord?.slack_minutes ?? 0,
      dangerousCount: dangerousTasks.length,
      dyingCount: dyingTasks.length,
      sleepHours: todayRecord?.sleep_hours ?? 7,
    });
    setTaunt(text);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks.length, todayRecord, currentTime.getHours()]);

  useEffect(() => {
    if (glitchLevel >= 2) {
      bgPink.value = withTiming(1, { duration: 800 });
      blinkOpacity.value = withRepeat(
        withSequence(withTiming(0.5, { duration: 300 }), withTiming(1, { duration: 300 })),
        -1, true,
      );
    } else if (glitchLevel >= 1) {
      bgPink.value = withTiming(0.3, { duration: 600 });
      blinkOpacity.value = withTiming(1, { duration: 300 });
    } else {
      bgPink.value = withTiming(0, { duration: 600 });
      blinkOpacity.value = withTiming(1, { duration: 300 });
    }
  }, [glitchLevel, bgPink, blinkOpacity]);

  // PRD §3.2.2 / §4.20：SAN<20% 时一键摸鱼按钮脉冲动画
  useEffect(() => {
    if (spirit.sanityPoints < 20) {
      sanPulse.value = withRepeat(
        withSequence(
          withTiming(1.08, { duration: 350 }),
          withTiming(0.94, { duration: 350 }),
        ),
        -1, true,
      );
    } else {
      sanPulse.value = withTiming(1, { duration: 200 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spirit.sanityPoints < 20]);

  // PRD §3.2.1：功德值负数时漂浮特效
  useEffect(() => {
    if (spirit.meritPoints < 0) {
      karmaFloat.value = withRepeat(
        withSequence(
          withTiming(-6, { duration: 600 }),
          withTiming(0, { duration: 600 }),
        ),
        -1, true,
      );
    } else {
      karmaFloat.value = withTiming(0, { duration: 300 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spirit.meritPoints < 0]);

  // §1.5 文字歪斜 & 贴纸错位：红温/濒死状态驱动
  const isStressedUI = glitchLevel >= 2 || spirit.lifePoints < 10;
  useEffect(() => {
    if (!stickerEnabled) return;
    if (isStressedUI) {
      // 文字向左倾斜 ~3°
      skewAnim.value = withSpring(1, { damping: 14, stiffness: 120 });
      // 随机生成贴纸偏移量并驱动动画
      const offsets = genStickerOffsets(3);
      setStickerOffsets(offsets);
      stickerTranslateX0.value = withSpring(offsets[0].x, { damping: 14 });
      stickerTranslateY0.value = withSpring(offsets[0].y, { damping: 14 });
      stickerRot0.value        = withSpring(offsets[0].rot, { damping: 14 });
      stickerTranslateX1.value = withSpring(offsets[1].x, { damping: 14 });
      stickerTranslateY1.value = withSpring(offsets[1].y, { damping: 14 });
      stickerRot1.value        = withSpring(offsets[1].rot, { damping: 14 });
      stickerTranslateX2.value = withSpring(offsets[2].x, { damping: 14 });
      stickerTranslateY2.value = withSpring(offsets[2].y, { damping: 14 });
      stickerRot2.value        = withSpring(offsets[2].rot, { damping: 14 });
    } else {
      // 状态恢复：400ms 内平滑复位
      skewAnim.value = withTiming(0, { duration: 400 });
      stickerTranslateX0.value = withTiming(0, { duration: 400 });
      stickerTranslateY0.value = withTiming(0, { duration: 400 });
      stickerRot0.value        = withTiming(0, { duration: 400 });
      stickerTranslateX1.value = withTiming(0, { duration: 400 });
      stickerTranslateY1.value = withTiming(0, { duration: 400 });
      stickerRot1.value        = withTiming(0, { duration: 400 });
      stickerTranslateX2.value = withTiming(0, { duration: 400 });
      stickerTranslateY2.value = withTiming(0, { duration: 400 });
      stickerRot2.value        = withTiming(0, { duration: 400 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStressedUI, stickerEnabled]);

  // 吉祥物点击：随机弹出激励语录气泡（从 SQLite 库抽取）
  const handleMascotPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    getOnlyMine().then(onlyMine => getRandomQuote(onlyMine)).then(quote => {
      setMascotBubble(quote);
      setShowBubble(true);
      if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
      bubbleTimer.current = setTimeout(() => setShowBubble(false), 2000);
    }).catch(() => {});
  };

  const blinkStyle = useAnimatedStyle(() => ({ opacity: blinkOpacity.value }));
  const sanPulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: sanPulse.value }],
    opacity: 0.5 + 0.5 * (sanPulse.value - 0.94) / 0.14,
  }));
  const karmaFloatStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: karmaFloat.value }],
  }));
  const bgStyle = useAnimatedStyle(() => {
    const g = Math.round(253 - 33 * bgPink.value);
    const b = Math.round(242 - 12 * bgPink.value);
    return { backgroundColor: `rgb(255,${g},${b})` };
  });
  const restOverlayStyle = useAnimatedStyle(() => ({
    opacity: restOverlay.value,
  }));
  // §1.5 歪斜样式（标题文字）
  const skewStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${-3 * skewAnim.value}deg` }],
  }));
  // §1.5 贴纸错位样式 × 3
  const sticker0Style = useAnimatedStyle(() => ({
    transform: [
      { translateX: stickerTranslateX0.value },
      { translateY: stickerTranslateY0.value },
      { rotate: `${stickerRot0.value}deg` },
    ],
  }));
  const sticker1Style = useAnimatedStyle(() => ({
    transform: [
      { translateX: stickerTranslateX1.value },
      { translateY: stickerTranslateY1.value },
      { rotate: `${stickerRot1.value}deg` },
    ],
  }));
  const sticker2Style = useAnimatedStyle(() => ({
    transform: [
      { translateX: stickerTranslateX2.value },
      { translateY: stickerTranslateY2.value },
      { rotate: `${stickerRot2.value}deg` },
    ],
  }));

  // §1.5 useMemo 防止每次渲染都 re-compute stickerOffsets（仅供标注使用）
  const _stickerOffsets = useMemo(() => stickerOffsets, [stickerOffsets]);
  void _stickerOffsets; // 避免 lint unused warning

  const formatRestTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: C_BG, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 40 }}>🌸</Text>
        <ActivityIndicator color={C_PINK} style={{ marginTop: 12 }} />
        <Text style={{ color: C_MUTED, marginTop: 8, fontSize: 13 }}>加载中，请稍候…</Text>
      </View>
    );
  }

  const dangerColor = mostDangerous ? getNewDangerColor(getDangerLevel(mostDangerous.deadline)) : C_MINT;
  const lifeColor = spirit.lifePoints <= 20 ? C_RED : spirit.lifePoints <= 50 ? '#FF8C00' : C_MINT;
  const sanityColor = spirit.sanityPoints <= 20 ? C_RED : spirit.sanityPoints <= 50 ? C_YELLOW : C_PURPLE;

  return (
    <Animated.View style={[{ flex: 1 }, bgStyle]}>
      {/* PRD §3.7.2 成就解锁全屏贴纸动画 */}
      <AchievementUnlockModal
        achievement={currentAchievement}
        onDismiss={() => setCurrentAchievement(null)}
      />

      {/* 全部完成庆祝横幅 */}
      {celebrationVisible && (
        <Animated.View style={[{
          position: 'absolute', top: 56, left: 16, right: 16, zIndex: 100,
          backgroundColor: C_MINT,
          borderRadius: 20,
          paddingVertical: 16,
          paddingHorizontal: 20,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          boxShadow: [{ offsetX: 0, offsetY: 6, blurRadius: 24, color: 'rgba(46,196,182,0.45)' }],
        }, celebrationBannerStyle]}>
          <Text style={{ fontSize: 32 }}>🎉</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>
              全部完成！！！
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 12, marginTop: 2 }}>
              麻糬为你骄傲！享受短暂的安宁 🍡
            </Text>
          </View>
          <Pressable onPress={() => {
            celebrationOp.value = withTiming(0, { duration: 300 });
            celebrationY.value = withTiming(-80, { duration: 300 });
            setTimeout(() => setCelebrationVisible(false), 300);
          }}>
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 20 }}>✕</Text>
          </Pressable>
        </Animated.View>
      )}

      {/* 强制休息蒙层 */}
      {restMode && (
        <Animated.View style={[{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(255,160,100,0.22)',
          zIndex: 50,
          pointerEvents: 'none',
        }, restOverlayStyle]} />
      )}

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 56, paddingBottom: 32 }}
      >
        {/* 顶部标题 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <View>
            <Text style={{ color: C_MUTED, fontSize: 11 }}>今日</Text>
            <Text style={{ color: C_PINK, fontSize: 26, fontWeight: 'bold' }}>DDLife 🎀</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: C_MUTED, fontSize: 11 }}>
              {currentTime.toLocaleDateString('zh-CN')}
            </Text>
            <Text style={{ color: C_TEXT, fontSize: 14, fontWeight: '600' }}>
              {currentTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </Text>
          </View>
        </View>

        {/* 通知权限 Level 1 横幅（PRD §3.2.7） */}
        {notifPermission === 'denied' && !notifBannerDismissed && (
          <View style={{
            backgroundColor: '#FFE4EC',
            borderRadius: 14,
            padding: 12,
            marginBottom: 10,
            flexDirection: 'row',
            alignItems: 'center',
            borderWidth: 1.5,
            borderColor: '#FF5E7C',
            gap: 10,
          }}>
            <Text style={{ fontSize: 20 }}>😢</Text>
            <Pressable
              style={{ flex: 1 }}
              onPress={() => void Linking.openSettings()}
            >
              <Text style={{ color: '#FF5E7C', fontSize: 13, fontWeight: 'bold' }}>
                开启通知可在DDL截止前1小时收到提醒
              </Text>
              <Text style={{ color: '#FF5E7C', fontSize: 11 }}>
                → 去开启权限
              </Text>
            </Pressable>
            {/* 不再提示按钮 */}
            <Pressable
              onPress={async () => {
                await AsyncStorage.setItem('notif_banner_dismissed_home', '1');
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

        {/* 强制休息横幅 */}
        {restMode && (
          <View style={{
            backgroundColor: '#FF8C00',
            borderRadius: 18,
            padding: 16,
            marginBottom: 12,
            alignItems: 'center',
          }}>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold', marginBottom: 4 }}>
              😴 强制休息中
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 12, marginBottom: 8, textAlign: 'center' }}>
              你已经快不行了，强制休息1小时。1小时后生命值恢复10。
            </Text>
            <Text style={{ color: '#fff', fontSize: 28, fontWeight: 'bold', fontVariant: ['tabular-nums'] }}>
              {formatRestTime(restSecondsLeft)}
            </Text>
          </View>
        )}

        {/* 红温警告 */}
        {!restMode && glitchLevel >= 2 && (
          <Animated.View style={[blinkStyle, { marginBottom: 12 }]}>
            <View style={{
              backgroundColor: glitchLevel >= 3 ? 'rgba(255,0,60,0.12)' : 'rgba(255,94,124,0.12)',
              borderRadius: 16,
              borderWidth: 1.5,
              borderColor: glitchLevel >= 3 ? C_RED : C_PINK,
              padding: 12,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
            }}>
              <Text style={{ fontSize: 20 }}>{glitchLevel >= 3 ? '🚨' : '⚠️'}</Text>
              <Text style={{ color: glitchLevel >= 3 ? C_RED : C_PINK, fontSize: 13, fontWeight: 'bold', flex: 1 }}>
                {glitchLevel >= 3 ? '你的作业正在提刀赶来！！' : '快救救你的DDL吧！'}
              </Text>
            </View>
          </Animated.View>
        )}

        {/* 吉祥物卡片（§1.1 MochiWidget + §1.5 文字歪斜） */}
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            {/* MochiWidget：5 状态动画吉祥物 */}
            <View style={{ alignItems: 'center' }}>
              <MochiWidget
                hp={spirit.lifePoints}
                san={spirit.sanityPoints}
                karma={spirit.meritPoints}
                hasCompletedToday={hasCompletedToday}
                hasRedHotDDL={dangerousTasks.length > 0}
                onPress={handleMascotPress}
                size={restMode ? 80 : 100}
              />
              {/* 气泡对话框 */}
              {showBubble && (
                <View style={{
                  position: 'absolute',
                  bottom: 88,
                  left: -20,
                  width: 200,
                  backgroundColor: '#fff',
                  borderRadius: 14,
                  borderWidth: 1.5,
                  borderColor: C_PURPLE,
                  padding: 8,
                  zIndex: 10,
                  boxShadow: [{ offsetX: 0, offsetY: 4, blurRadius: 12, color: 'rgba(108,99,255,0.18)' }],
                }}>
                  <Text style={{ color: C_PURPLE, fontSize: 11, lineHeight: 16 }}>"{mascotBubble}"</Text>
                  <View style={{
                    position: 'absolute',
                    bottom: -8,
                    left: 28,
                    width: 0,
                    height: 0,
                    borderLeftWidth: 6,
                    borderRightWidth: 6,
                    borderTopWidth: 8,
                    borderLeftColor: 'transparent',
                    borderRightColor: 'transparent',
                    borderTopColor: C_PURPLE,
                  }} />
                </View>
              )}
            </View>

            <View style={{ flex: 1 }}>
              {/* §1.5 状态徽章（贴纸错位 sticker0） */}
              <Animated.View style={[{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }, sticker0Style]}>
                <View style={{
                  backgroundColor: restMode ? '#FF8C00' : mochiState === 'near_dead' ? C_RED : mochiState === 'red_hot' ? C_PINK : mochiState === 'completed' ? C_MINT : mochiState === 'idle_tired' ? '#FF8C00' : C_MINT,
                  borderRadius: 99,
                  paddingHorizontal: 10,
                  paddingVertical: 3,
                }}>
                  <Text style={{ color: '#fff', fontSize: 11, fontWeight: 'bold' }}>
                    {restMode ? '休眠中…' : mochiMeta.label}
                  </Text>
                </View>
              </Animated.View>

              {/* §1.5 人格称号（文字歪斜） */}
              <Animated.Text style={[{ color: C_TEXT, fontSize: 13, fontWeight: '600', marginBottom: 2 }, skewStyle]}>
                {personality.title}
              </Animated.Text>

              {/* 状态描述（贴纸错位 sticker1） */}
              <Animated.Text style={[{ color: C_MUTED, fontSize: 11 }, sticker1Style]}>
                {restMode ? '正在强制充电，别打扰 😴' : mochiMeta.desc}
              </Animated.Text>
              <Text style={{ color: C_PURPLE, fontSize: 10, marginTop: 4 }}>👆 点我说话</Text>
            </View>
          </View>

          {/* 今日激励语录（贴纸错位 sticker2） */}
          <Animated.View style={[{
            marginTop: 10,
            backgroundColor: '#FFF8E7',
            borderRadius: 12,
            padding: 10,
          }, sticker2Style]}>
            <Text style={{ color: C_MUTED, fontSize: 10, marginBottom: 2 }}>💬 今日激励语录</Text>
            <Text style={{ color: '#666', fontSize: 12, fontStyle: 'italic' }}>"{dormQuote}"</Text>
          </Animated.View>
        </Card>

        {/* 生存状态面板 */}
        <Card>
          <Text style={{ color: C_MUTED, fontSize: 11, marginBottom: 10 }}>🩺 大学生生存状态</Text>
          <JuiceBar percent={spirit.lifePoints} color={lifeColor} label="🫀 生命值（今日）" value={`${spirit.lifePoints}%`} />
          {/* 磨损值 */}
          <JuiceBar
            percent={wearState.wearValue}
            color={wearState.wearValue > 60 ? C_RED : wearState.wearValue > 30 ? '#FF8C00' : C_YELLOW}
            label="💢 磨损值（累计）"
            value={`${wearState.wearValue}%`}
          />
          <JuiceBar percent={spirit.sanityPoints} color={sanityColor} label="🧠 理智值" value={`${spirit.sanityPoints}%`} />
          {/* PRD §3.2.2 / §4.20：SAN<20% 时一键摸鱼按钮闪烁 */}
          {spirit.sanityPoints < 20 && (
            <Animated.View style={[{ marginTop: 6, marginBottom: 4 }, sanPulseStyle]}>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  router.push('/(app)/(tabs)/slack');
                }}
                style={{
                  backgroundColor: '#6C63FF',
                  borderRadius: 14,
                  paddingVertical: 11,
                  alignItems: 'center',
                  borderWidth: 2,
                  borderColor: '#FF5E7C',
                }}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: 'bold' }}>
                  🐟 理智濒临崩溃，一键摸鱼！
                </Text>
              </Pressable>
            </Animated.View>
          )}
          <View style={{ height: 1, backgroundColor: '#F0EDE0', marginVertical: 8 }} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: spirit.sleepDebt > 10 ? C_RED : spirit.sleepDebt > 5 ? '#FF8C00' : C_MINT, fontSize: 20, fontWeight: 'bold', fontVariant: ['tabular-nums'] }}>
                +{spirit.sleepDebt}h
              </Text>
              <Text style={{ color: C_MUTED, fontSize: 10, marginTop: 2 }}>😴 睡眠债</Text>
            </View>
            <View style={{ width: 1, backgroundColor: '#F0EDE0' }} />
            {/* 功德值：负数时特效 */}
            <View style={{ alignItems: 'center' }}>
              {spirit.meritPoints < -100 ? (
                <Animated.Text style={[
                  { fontSize: 18, fontWeight: 'bold', color: C_RED },
                  blinkStyle,
                  karmaFloatStyle,
                ]}>
                  功德-∞
                </Animated.Text>
              ) : spirit.meritPoints < 0 ? (
                <Animated.Text style={[
                  {
                    color: spirit.meritPoints < -50 ? C_RED : '#FF8C00',
                    fontSize: 20,
                    fontWeight: 'bold',
                    fontVariant: ['tabular-nums'],
                  },
                  karmaFloatStyle,
                ]}>
                  {spirit.meritPoints}
                </Animated.Text>
              ) : (
                <Text style={{
                  color: spirit.meritPoints < -50 ? C_RED : spirit.meritPoints < 0 ? '#FF8C00' : C_PURPLE,
                  fontSize: 20,
                  fontWeight: 'bold',
                  fontVariant: ['tabular-nums'],
                }}>
                  {spirit.meritPoints}
                </Text>
              )}
              <Text style={{ color: C_MUTED, fontSize: 10, marginTop: 2 }}>✨ 功德值</Text>
            </View>
            <View style={{ width: 1, backgroundColor: '#F0EDE0' }} />
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: spirit.madnessLevel > 70 ? C_RED : spirit.madnessLevel > 40 ? '#FF8C00' : C_PURPLE, fontSize: 20, fontWeight: 'bold', fontVariant: ['tabular-nums'] }}>
                {spirit.madnessLevel}%
              </Text>
              <Text style={{ color: C_MUTED, fontSize: 10, marginTop: 2 }}>🌀 发疯浓度</Text>
            </View>
          </View>
        </Card>

        {/* 最危险DDL */}
        <Card style={{ borderWidth: mostDangerous ? 2 : 0, borderColor: dangerColor }}>
          <Text style={{ color: C_MUTED, fontSize: 11, marginBottom: 8 }}>💀 当前最危险DDL</Text>
          {mostDangerous ? (
            <>
              <Text style={{ color: C_TEXT, fontSize: 17, fontWeight: 'bold', marginBottom: 6 }}>
                ⚠ {mostDangerous.name}
              </Text>
              <View style={{ height: 14, backgroundColor: '#F0EDE0', borderRadius: 999, marginBottom: 8, overflow: 'hidden' }}>
                <View style={{
                  width: `${getHealthBarPercent(mostDangerous.deadline, mostDangerous.created_at)}%`,
                  height: '100%',
                  backgroundColor: dangerColor,
                  borderRadius: 999,
                }} />
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <View style={{ backgroundColor: dangerColor, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <Text style={{ color: '#fff', fontSize: 11, fontWeight: 'bold' }}>
                    {getDangerLabel(getDangerLevel(mostDangerous.deadline))}
                  </Text>
                </View>
                <Animated.Text style={[{ color: dangerColor, fontSize: 14, fontWeight: 'bold' }, glitchLevel >= 2 ? blinkStyle : undefined]}>
                  ⏳ {formatTimeRemaining(mostDangerous.deadline)}
                </Animated.Text>
              </View>
              {/* 立即开干按钮 */}
              {!restMode && (
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    router.push('/(app)/(tabs)/ddl');
                  }}
                  style={{
                    backgroundColor: dangerColor,
                    borderRadius: 14,
                    paddingVertical: 11,
                    alignItems: 'center',
                    marginTop: 2,
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>立即开干 ▶</Text>
                </Pressable>
              )}
            </>
          ) : (
            <View style={{ alignItems: 'center', paddingVertical: 8 }}>
              <Text style={{ fontSize: 36 }}>🎉</Text>
              <Text style={{ color: C_MINT, fontSize: 15, fontWeight: 'bold', marginTop: 4 }}>暂无DDL，享受片刻安宁</Text>
              <Text style={{ color: C_MUTED, fontSize: 11, marginTop: 2 }}>它不会太久的……</Text>
            </View>
          )}
        </Card>

        {/* 今日人格 */}
        <Card>
          <Text style={{ color: C_MUTED, fontSize: 11, marginBottom: 8 }}>🔮 今日人格检测</Text>
          <Text style={{ color: C_PURPLE, fontSize: 22, fontWeight: 'bold', textAlign: 'center' }}>
            「{personality.title}」
          </Text>
          <Text style={{ color: C_MUTED, fontSize: 12, textAlign: 'center', marginTop: 6, lineHeight: 18 }}>
            {personality.description}
          </Text>
        </Card>

        {/* 今日吐槽 */}
        <Card>
          <Text style={{ color: C_MUTED, fontSize: 11, marginBottom: 8 }}>💬 系统每日吐槽</Text>
          <View style={{
            backgroundColor: '#FFF8E7',
            borderRadius: 14,
            borderLeftWidth: 3,
            borderLeftColor: C_YELLOW,
            padding: 12,
          }}>
            <Text style={{ color: C_TEXT, fontSize: 14, lineHeight: 22, fontStyle: 'italic' }}>"{taunt}"</Text>
          </View>
          <Pressable
            onPress={() => {
              const newTaunt = getAutoTaunt({
                hour: currentTime.getHours(),
                slackMinutes: todayRecord?.slack_minutes ?? 0,
                dangerousCount: dangerousTasks.length,
                dyingCount: dyingTasks.length,
                sleepHours: todayRecord?.sleep_hours ?? 7,
              });
              setTaunt(newTaunt);
            }}
            style={{ marginTop: 10, alignSelf: 'flex-end' }}
          >
            <View style={{ backgroundColor: '#FFF0F4', borderRadius: 99, paddingHorizontal: 14, paddingVertical: 6 }}>
              <Text style={{ color: C_PINK, fontSize: 12, fontWeight: '600' }}>换一条 🔄</Text>
            </View>
          </Pressable>
        </Card>

        {/* 今日概况 */}
        <Card>
          <Text style={{ color: C_MUTED, fontSize: 11, marginBottom: 10 }}>📊 今日概况</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: C_PURPLE, fontSize: 28, fontWeight: 'bold' }}>{activeTasks.length}</Text>
              <Text style={{ color: C_MUTED, fontSize: 11, marginTop: 2 }}>待处理DDL</Text>
            </View>
            <View style={{ width: 1, backgroundColor: '#F0EDE0' }} />
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: dangerousTasks.length > 0 ? C_RED : C_MINT, fontSize: 28, fontWeight: 'bold' }}>
                {dangerousTasks.length}
              </Text>
              <Text style={{ color: C_MUTED, fontSize: 11, marginTop: 2 }}>🚨 危险任务</Text>
            </View>
            <View style={{ width: 1, backgroundColor: '#F0EDE0' }} />
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: C_MINT, fontSize: 28, fontWeight: 'bold' }}>
                {todayRecord?.sleep_hours ?? 0}h
              </Text>
              <Text style={{ color: C_MUTED, fontSize: 11, marginTop: 2 }}>💤 今日睡眠</Text>
            </View>
          </View>
        </Card>
      </ScrollView>

      {/* 新手引导 */}
      <NewbieGuideModal
        visible={showNewbieGuide}
        onClose={() => setShowNewbieGuide(false)}
      />
    </Animated.View>
  );
}
