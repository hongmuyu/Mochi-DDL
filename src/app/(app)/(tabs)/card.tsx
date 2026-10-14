/**
 * 卡片页面 — 生存日报拍立得卡片 + 历史记录
 * v2 — 性能优化版（PRD §5.1–§5.4）
 *   §5.1 InteractionManager 非阻塞截图
 *   §5.2 每日首次进入预生成 3 种比例
 *   §5.3 低端设备降级静态模板
 *   §5.4 LRU 缓存池最多保留 3 张
 */
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  InteractionManager,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useFocusEffect } from 'expo-router';
import * as MediaLibrary from 'expo-media-library';
import { captureRef } from 'react-native-view-shot';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAllTasks, getTodayRecord, getRecentRecords, toggleCardFavorite, isCardFavorite } from '@/db/api';
import { calculatePersonality } from '@/lib/personality';
import { getDangerLevel } from '@/lib/ddl';
import { calculateSpiritState } from '@/lib/state';
import { loadAchievements } from '@/lib/achievements';
import { saveCardToSandbox, getCardImageUri, moveToFavorite, moveFromFavorite, cleanExpiredCardImages } from '@/lib/cardStorage';
import { getCachedCard, putCachedCard, RatioKey } from '@/lib/cardCache';
import { usePerformanceFlags } from '@/ctx/PerformanceContext';
import { TimeRecord, Task } from '@/types/types';

// 宽高比类型（与 cardCache.ts 保持一致）
type AspectRatio = RatioKey;
const RATIO_OPTIONS: { key: AspectRatio; label: string; width: number; heightRatio: number }[] = [
  { key: '3:4',  label: '3:4',  width: 300, heightRatio: 4 / 3 },
  { key: '9:16', label: '9:16', width: 260, heightRatio: 16 / 9 },
  { key: '1:1',  label: '1:1',  width: 300, heightRatio: 1 },
];

const K_PRELOAD_DATE = 'ddl_card_preload_date';

// 配色
const C_BG     = '#FFFDF2';
const C_PINK   = '#FF5E7C';
const C_PURPLE = '#6C63FF';
const C_YELLOW = '#FFD166';
const C_MINT   = '#2EC4B6';
const C_TEXT   = '#333333';
const C_MUTED  = '#888888';

const HISTORY_KEY = 'ddlife_card_history';
const MAX_HISTORY = 30;

interface CardSnapshot {
  ts: number;          // 时间戳
  dateLabel: string;   // 显示日期（zh-CN）
  dateKey: string;     // YYYY-MM-DD，用于文件路径
  lifePoints: number;
  sanityPoints: number;
  madnessLevel: number;
  activeTasks: number;
  dangerCount: number;
  personalityTitle: string;
  sleepHours: number;
  unlockedCount: number;
}

async function loadHistory(): Promise<CardSnapshot[]> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as CardSnapshot[]) : [];
  } catch { return []; }
}

async function saveToHistory(snap: CardSnapshot): Promise<void> {
  const list = await loadHistory();
  // 同一天只保留一条（覆盖）
  const today = new Date(snap.ts).toLocaleDateString('zh-CN');
  const filtered = list.filter(s => new Date(s.ts).toLocaleDateString('zh-CN') !== today);
  const updated = [snap, ...filtered].slice(0, MAX_HISTORY);
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
}

function getStatusEmoji(lifePoints: number): string {
  if (lifePoints > 70) return '🌸';
  if (lifePoints > 40) return '😑';
  if (lifePoints > 20) return '😰';
  return '🔥';
}

// 拍立得卡片（可截图）—— §5.3 isLowEnd 控制渲染路径
function PolaroidCard({
  cardRef,
  tasks,
  todayRecord,
  personality,
  lifePoints,
  sanityPoints,
  madnessLevel,
  unlockedCount,
  dangerCount,
  today,
  ratio,
  isLowEnd = false,
}: {
  cardRef: React.RefObject<View | null>;
  tasks: Task[];
  todayRecord: TimeRecord | null;
  personality: { title: string; description: string };
  lifePoints: number;
  sanityPoints: number;
  madnessLevel: number;
  unlockedCount: number;
  dangerCount: number;
  today: string;
  ratio: AspectRatio;
  isLowEnd?: boolean;
}) {
  const statusEmoji = getStatusEmoji(lifePoints);
  const activeTasks = tasks.filter(t => !t.completed).length;
  const opt = RATIO_OPTIONS.find(r => r.key === ratio) ?? RATIO_OPTIONS[0];

  return (
    <View
      ref={cardRef}
      collapsable={false}
      renderToHardwareTextureAndroid
      style={{
        backgroundColor: '#FFFFFF',
        borderRadius: isLowEnd ? 4 : 20,
        padding: 24,
        paddingBottom: 32,
        width: opt.width,
        minHeight: ratio === '9:16' ? opt.width * opt.heightRatio : undefined,
        alignSelf: 'center',
        ...(isLowEnd ? {} : {
          boxShadow: [{ offsetX: 0, offsetY: 8, blurRadius: 32, color: 'rgba(0,0,0,0.12)' }],
        }),
      }}
    >
      {/* 拍立得顶部装饰 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', gap: 5 }}>
          <View style={{ width: 8, height: 8, borderRadius: isLowEnd ? 0 : 4, backgroundColor: C_PINK }} />
          <View style={{ width: 8, height: 8, borderRadius: isLowEnd ? 0 : 4, backgroundColor: C_YELLOW }} />
          <View style={{ width: 8, height: 8, borderRadius: isLowEnd ? 0 : 4, backgroundColor: C_MINT }} />
        </View>
        <Text style={{ color: C_MUTED, fontSize: 10 }}>麻糬のDDL · 生存日报</Text>
      </View>

      {/* 人格 + 吉祥物 */}
      <View style={{ alignItems: 'center', marginBottom: 14 }}>
        <Text style={{ fontSize: 60 }}>{statusEmoji}</Text>
        <Text style={{ color: C_PINK, fontSize: 18, fontWeight: 'bold', marginTop: 6 }}>
          「{personality.title}」
        </Text>
        <Text style={{ color: C_MUTED, fontSize: 11, textAlign: 'center', marginTop: 4, lineHeight: 16 }}>
          {personality.description}
        </Text>
      </View>

      {/* 数据行：低端 → 纯文本列表；高/中端 → 色块卡片 */}
      {isLowEnd ? (
        <View style={{ gap: 6, marginBottom: 14 }}>
          <Text style={{ color: C_TEXT, fontSize: 13 }}>💀 待处理 DDL：<Text style={{ color: C_PINK, fontWeight: 'bold' }}>{activeTasks} 个</Text></Text>
          <Text style={{ color: C_TEXT, fontSize: 13 }}>😴 今日睡眠：<Text style={{ color: C_MINT, fontWeight: 'bold' }}>{todayRecord?.sleep_hours ?? 0}h</Text></Text>
          <Text style={{ color: C_TEXT, fontSize: 13 }}>🚨 危险任务：<Text style={{ color: dangerCount > 0 ? C_PINK : C_MINT, fontWeight: 'bold' }}>{dangerCount} 个</Text></Text>
          <Text style={{ color: C_TEXT, fontSize: 13 }}>🏆 解锁成就：<Text style={{ color: C_PURPLE, fontWeight: 'bold' }}>{unlockedCount} 个</Text></Text>
        </View>
      ) : (
        <View style={{ gap: 8, marginBottom: 14 }}>
          <View style={{ backgroundColor: '#FFFBEA', borderRadius: 10, padding: 10, flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: C_TEXT, fontSize: 13 }}>💀 待处理 DDL</Text>
            <Text style={{ color: C_PINK, fontSize: 15, fontWeight: 'bold' }}>{activeTasks} 个</Text>
          </View>
          <View style={{ backgroundColor: '#F0FFFE', borderRadius: 10, padding: 10, flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: C_TEXT, fontSize: 13 }}>😴 今日睡眠</Text>
            <Text style={{ color: C_MINT, fontSize: 15, fontWeight: 'bold' }}>{todayRecord?.sleep_hours ?? 0}h</Text>
          </View>
          <View style={{ backgroundColor: '#FFF0F4', borderRadius: 10, padding: 10, flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: C_TEXT, fontSize: 13 }}>🚨 危险任务</Text>
            <Text style={{ color: dangerCount > 0 ? C_PINK : C_MINT, fontSize: 15, fontWeight: 'bold' }}>{dangerCount} 个</Text>
          </View>
          <View style={{ backgroundColor: '#F5F0FF', borderRadius: 10, padding: 10, flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: C_TEXT, fontSize: 13 }}>🏆 解锁成就</Text>
            <Text style={{ color: C_PURPLE, fontSize: 15, fontWeight: 'bold' }}>{unlockedCount} 个</Text>
          </View>
        </View>
      )}

      {/* 生存指数条 */}
      <View style={{ marginBottom: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
          <Text style={{ color: C_MUTED, fontSize: 11 }}>🫀 生存指数</Text>
          <Text style={{ color: C_TEXT, fontSize: 11, fontWeight: '600' }}>{lifePoints}%</Text>
        </View>
        <View style={{ height: 8, backgroundColor: '#F0EDE0', borderRadius: isLowEnd ? 0 : 999, overflow: 'hidden' }}>
          <View style={{
            width: `${lifePoints}%`,
            height: '100%',
            backgroundColor: lifePoints < 20 ? '#FF003C' : lifePoints < 50 ? '#FF8C00' : C_MINT,
            borderRadius: isLowEnd ? 0 : 999,
          }} />
        </View>
      </View>

      {/* 理智 + 发疯浓度 */}
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        <View style={{ flex: 1, backgroundColor: '#F5F0FF', borderRadius: isLowEnd ? 4 : 10, padding: 10, alignItems: 'center' }}>
          <Text style={{ color: C_PURPLE, fontSize: 16, fontWeight: 'bold' }}>{sanityPoints}%</Text>
          <Text style={{ color: C_MUTED, fontSize: 10, marginTop: 2 }}>🧠 理智值</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: '#FFF0F4', borderRadius: isLowEnd ? 4 : 10, padding: 10, alignItems: 'center' }}>
          <Text style={{ color: C_PINK, fontSize: 16, fontWeight: 'bold' }}>{madnessLevel}%</Text>
          <Text style={{ color: C_MUTED, fontSize: 10, marginTop: 2 }}>🌀 发疯浓度</Text>
        </View>
      </View>

      {/* 底部签名 */}
      <View style={{ borderTopWidth: 1, borderTopColor: '#F0EDE0', paddingTop: 10, alignItems: 'center' }}>
        <Text style={{ color: C_MUTED, fontSize: 10 }}>{today} · 麻糬のDDL · 大学生末日生存手册</Text>
      </View>
    </View>
  );
}

// 历史卡片行（含缩略图、收藏状态）
function HistoryRow({
  snap,
  imageUri,
  isFav,
  onPress,
  onToggleFavorite,
}: {
  snap: CardSnapshot;
  imageUri: string | null;
  isFav: boolean;
  onPress: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#F5F0E8',
        gap: 10,
      }}
    >
      {/* 缩略图 / 占位图 */}
      {imageUri ? (
        <Image
          source={{ uri: imageUri }}
          style={{ width: 44, height: 58, borderRadius: 8 }}
          contentFit="cover"
        />
      ) : (
        <View style={{
          width: 44, height: 58, borderRadius: 8,
          backgroundColor: '#F5F0E8',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{ fontSize: 20 }}>⏳</Text>
        </View>
      )}

      <View style={{ flex: 1 }}>
        <Text style={{ color: C_TEXT, fontSize: 13, fontWeight: '600' }}>{snap.dateLabel}</Text>
        <Text style={{ color: C_MUTED, fontSize: 11, marginTop: 2 }}>
          「{snap.personalityTitle}」· 生存 {snap.lifePoints}% · DDL {snap.activeTasks}个
        </Text>
        {!imageUri && (
          <Text style={{ color: C_YELLOW, fontSize: 10, marginTop: 2 }}>图片已过期，点击重新生成</Text>
        )}
      </View>

      {/* 收藏按钮 */}
      <Pressable
        onPress={e => { e.stopPropagation?.(); onToggleFavorite(); }}
        hitSlop={8}
        style={{ padding: 4 }}
      >
        <Text style={{ fontSize: 18 }}>{isFav ? '⭐' : '☆'}</Text>
      </Pressable>

      <Text style={{ color: C_MUTED, fontSize: 18 }}>›</Text>
    </Pressable>
  );
}

export default function CardScreen() {
  // §5.3 低端设备标识
  const { staticOnly: isLowEnd } = usePerformanceFlags();

  // 主卡片 ref（当前比例显示用）
  const cardRef = useRef<View>(null);
  // §5.2 预生成用的 3 个离屏 ref（Rules of Hooks：顶层独立声明）
  const ref34  = useRef<View>(null);
  const ref916 = useRef<View>(null);
  const ref11  = useRef<View>(null);
  const refMap: Record<AspectRatio, React.RefObject<View | null>> = {
    '3:4': ref34, '9:16': ref916, '1:1': ref11,
  };

  const [tasks, setTasks] = useState<Task[]>([]);
  const [todayRecord, setTodayRecord] = useState<TimeRecord | null>(null);
  const [recentRecords, setRecentRecords] = useState<TimeRecord[]>([]);
  const [unlockedCount, setUnlockedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [savingCard, setSavingCard] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [history, setHistory] = useState<CardSnapshot[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('3:4');
  // §5.2 预生成进度
  const [preloadLoading, setPreloadLoading] = useState(false);
  // 图片 URI 缓存：dateKey → uri | null
  const [imageUris, setImageUris] = useState<Record<string, string | null>>({});
  // 收藏状态缓存：dateKey → boolean
  const [favMap, setFavMap] = useState<Record<string, boolean>>({});

  const btnScale = useSharedValue(1);
  const btnStyle = useAnimatedStyle(() => ({ transform: [{ scale: btnScale.value }] }));

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [allTasks, today, recent, ach, hist] = await Promise.all([
        getAllTasks(),
        getTodayRecord(),
        getRecentRecords(30),
        loadAchievements(),
        loadHistory(),
      ]);
      setTasks(allTasks);
      setTodayRecord(today);
      setRecentRecords(recent);
      setUnlockedCount(ach.filter(a => a.unlocked).length);
      setHistory(hist);

      // 批量加载图片 URI 与收藏状态
      const [uriEntries, favEntries] = await Promise.all([
        Promise.all(hist.map(async s => {
          const key = s.dateKey ?? new Date(s.ts).toISOString().slice(0, 10);
          const uri = await getCardImageUri(key);
          return [key, uri] as [string, string | null];
        })),
        Promise.all(hist.map(async s => {
          const key = s.dateKey ?? new Date(s.ts).toISOString().slice(0, 10);
          const fav = await isCardFavorite(key);
          return [key, fav] as [string, boolean];
        })),
      ]);
      setImageUris(Object.fromEntries(uriEntries));
      setFavMap(Object.fromEntries(favEntries));
    } catch { }
    finally { setLoading(false); }
  }, []);

  // §5.2 每日首次进入预生成所有比例
  const runPreload = useCallback((
    dateKey: string,
    cardData: { tasks: Task[]; todayRecord: TimeRecord | null; personality: { title: string; description: string }; spirit: { lifePoints: number; sanityPoints: number; madnessLevel: number }; dangerCount: number; unlockedCount: number; today: string },
  ) => {
    // 推到所有交互完成后再执行，不阻塞首屏
    InteractionManager.runAfterInteractions(async () => {
      setPreloadLoading(true);
      try {
        for (const ratio of ['3:4', '9:16', '1:1'] as AspectRatio[]) {
          // 先检查磁盘缓存，已有则跳过
          const existing = await getCachedCard(dateKey, ratio);
          if (existing) continue;

          const ref = refMap[ratio];
          if (!ref.current) continue;
          await new Promise(r => setTimeout(r, 80)); // 等待布局稳定
          try {
            const tmpUri = await captureRef(ref as React.RefObject<View>, {
              format: 'png', quality: 1, result: 'tmpfile',
            });
            await putCachedCard(tmpUri, dateKey, ratio);
          } catch { /* 单比例失败不影响其他 */ }
        }
        await AsyncStorage.setItem(K_PRELOAD_DATE, dateKey);
      } catch { } finally {
        setPreloadLoading(false);
      }
    });
    // suppress unused warning — cardData param used externally by caller to confirm data ready
    void cardData;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useFocusEffect(useCallback(() => {
    void (async () => {
      await loadData();
      // 冷启动5秒后异步清理过期卡片图片（SPEC §4.1）
      const t = setTimeout(() => { void cleanExpiredCardImages(); }, 5000);
      return () => clearTimeout(t);
    })();
  }, [loadData]));

  const personality = calculatePersonality(tasks, recentRecords);
  const spirit = calculateSpiritState(tasks, todayRecord, recentRecords);
  const dangerCount = tasks.filter(t => !t.completed && ['critical', 'dying'].includes(getDangerLevel(t.deadline))).length;
  const today = new Date().toLocaleDateString('zh-CN');
  const todayKey = new Date().toISOString().slice(0, 10);
  const hasData = tasks.length > 0 || todayRecord !== null;

  // 数据加载完毕后，检查是否需要预生成
  const prevLoadingRef = useRef(true);
  if (prevLoadingRef.current && !loading && hasData) {
    prevLoadingRef.current = false;
    void (async () => {
      const lastDate = await AsyncStorage.getItem(K_PRELOAD_DATE);
      if (lastDate !== todayKey) {
        runPreload(todayKey, { tasks, todayRecord, personality, spirit, dangerCount, unlockedCount, today });
      }
    })();
  }

  // §5.1 非阻塞截图：等所有 JS 交互结束后才执行 captureRef
  const captureWithInteractionGuard = useCallback(
    (ref: React.RefObject<View>): Promise<string> =>
      new Promise((resolve, reject) => {
        InteractionManager.runAfterInteractions(async () => {
          try {
            await new Promise(r => setTimeout(r, 120));
            const uri = await captureRef(ref, { format: 'png', quality: 1, result: 'tmpfile' });
            resolve(uri);
          } catch (e) { reject(e); }
        });
      }),
    [],
  );

  const handleSaveCard = async () => {
    if (!cardRef.current) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    btnScale.value = withSpring(0.9, {}, () => { btnScale.value = withSpring(1); });

    if (permissionDenied) {
      const { status: retryStatus } = await MediaLibrary.requestPermissionsAsync(false, ['photo']);
      if (retryStatus !== 'granted') return;
      setPermissionDenied(false);
    } else {
      const { status } = await MediaLibrary.requestPermissionsAsync(false, ['photo']);
      if (status !== 'granted') { setPermissionDenied(true); return; }
    }

    setSavingCard(true);
    try {
      // §5.1 优先用缓存，无缓存则非阻塞截图
      let uri = await getCachedCard(todayKey, aspectRatio);
      if (!uri) {
        uri = await captureWithInteractionGuard(cardRef as React.RefObject<View>);
        uri = await putCachedCard(uri, todayKey, aspectRatio);
      }

      // 双写：系统相册 + App 沙盒（SPEC §3.1）
      await Promise.all([
        MediaLibrary.createAssetAsync(uri),
        saveCardToSandbox(uri, todayKey),
      ]);

      const snap: CardSnapshot = {
        ts: Date.now(), dateLabel: today, dateKey: todayKey,
        lifePoints: spirit.lifePoints, sanityPoints: spirit.sanityPoints,
        madnessLevel: spirit.madnessLevel,
        activeTasks: tasks.filter(t => !t.completed).length,
        dangerCount, personalityTitle: personality.title,
        sleepHours: todayRecord?.sleep_hours ?? 0, unlockedCount,
      };
      await saveToHistory(snap);
      const newHist = await loadHistory();
      setHistory(newHist);
      const newUri = await getCardImageUri(todayKey);
      setImageUris(prev => ({ ...prev, [todayKey]: newUri }));

      setSaveMsg('🎉 卡片已保存到相册！');
      setTimeout(() => setSaveMsg(''), 2500);
    } catch {
      setSaveMsg('保存失败，请重试 😢');
      setTimeout(() => setSaveMsg(''), 2500);
    } finally { setSavingCard(false); }
  };

  // §5.1 分享也走非阻塞路径
  const handleShareCard = async () => {
    if (!cardRef.current) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    btnScale.value = withSpring(0.9, {}, () => { btnScale.value = withSpring(1); });
    setSavingCard(true);
    try {
      let uri = await getCachedCard(todayKey, aspectRatio);
      if (!uri) {
        uri = await captureWithInteractionGuard(cardRef as React.RefObject<View>);
        uri = await putCachedCard(uri, todayKey, aspectRatio);
      }
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: '分享我的生存日报' });
      } else {
        setSaveMsg('当前设备不支持分享 😢');
        setTimeout(() => setSaveMsg(''), 2500);
      }
    } catch {
      setSaveMsg('分享失败，请重试 😢');
      setTimeout(() => setSaveMsg(''), 2500);
    } finally { setSavingCard(false); }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: C_BG, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 36 }}>📸</Text>
        <ActivityIndicator color={C_PINK} style={{ marginTop: 12 }} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C_BG }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingTop: 56, paddingBottom: 100 }}
      >
        {/* 标题 */}
        <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
          <Text style={{ color: C_MUTED, fontSize: 11 }}>今日档案</Text>
          <Text style={{ color: C_PINK, fontSize: 24, fontWeight: 'bold' }}>📸 生存日报</Text>
        </View>

        {!hasData ? (
          /* 空状态 */
          <View style={{ alignItems: 'center', paddingVertical: 60, paddingHorizontal: 32 }}>
            <Text style={{ fontSize: 72 }}>🍡</Text>
            <Text style={{ color: C_PURPLE, fontSize: 17, fontWeight: 'bold', marginTop: 16, textAlign: 'center' }}>
              今天还没有状态
            </Text>
            <Text style={{ color: C_MUTED, fontSize: 13, marginTop: 8, textAlign: 'center', lineHeight: 20 }}>
              先去添加 DDL 吧~{'\n'}添加后这里会生成你的专属生存日报 ✨
            </Text>
          </View>
        ) : (
          <>
            {/* 宽高比切换 */}
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: 14 }}>
              {RATIO_OPTIONS.map(opt => (
                <Pressable
                  key={opt.key}
                  onPress={() => { Haptics.selectionAsync(); setAspectRatio(opt.key); }}
                  style={{
                    paddingHorizontal: 18, paddingVertical: 7,
                    borderRadius: 20,
                    backgroundColor: aspectRatio === opt.key ? C_PINK : '#F5F0E8',
                    borderWidth: 1.5,
                    borderColor: aspectRatio === opt.key ? C_PINK : '#E8E2D8',
                  }}
                >
                  <Text style={{
                    color: aspectRatio === opt.key ? '#fff' : C_MUTED,
                    fontSize: 12, fontWeight: '700',
                  }}>{opt.label}</Text>
                </Pressable>
              ))}
            </View>

            {/* §5.3 isLowEnd + §5.2 预加载指示器 */}
            {isLowEnd && (
              <View style={{ marginHorizontal: 16, marginBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ color: C_MUTED, fontSize: 10 }}>⚡ 低配模式：简化渲染已启用</Text>
              </View>
            )}
            {preloadLoading && !isLowEnd && (
              <View style={{ marginHorizontal: 16, marginBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <ActivityIndicator size="small" color={C_PINK} />
                <Text style={{ color: C_MUTED, fontSize: 10 }}>麻糬正在预生成所有比例…</Text>
              </View>
            )}

            {/* §5.2 3 个离屏 PolaroidCard（绝对定位在屏幕外，用于预截图） */}
            <View style={{ position: 'absolute', left: -9999, top: 0, opacity: 0 }} pointerEvents="none">
              {(['3:4', '9:16', '1:1'] as AspectRatio[]).map(r => (
                <PolaroidCard
                  key={r}
                  cardRef={refMap[r]}
                  tasks={tasks}
                  todayRecord={todayRecord}
                  personality={personality}
                  lifePoints={spirit.lifePoints}
                  sanityPoints={spirit.sanityPoints}
                  madnessLevel={spirit.madnessLevel}
                  unlockedCount={unlockedCount}
                  dangerCount={dangerCount}
                  today={today}
                  ratio={r}
                  isLowEnd={isLowEnd}
                />
              ))}
            </View>

            {/* 拍立得卡片区 */}
            <Text style={{ color: C_MUTED, fontSize: 11, marginLeft: 20, marginBottom: 10 }}>
              📸 今日档案·拍立得
            </Text>
            <PolaroidCard
              cardRef={cardRef}
              tasks={tasks}
              todayRecord={todayRecord}
              personality={personality}
              lifePoints={spirit.lifePoints}
              sanityPoints={spirit.sanityPoints}
              madnessLevel={spirit.madnessLevel}
              unlockedCount={unlockedCount}
              dangerCount={dangerCount}
              today={today}
              ratio={aspectRatio}
              isLowEnd={isLowEnd}
            />

            {/* 操作反馈 */}
            {saveMsg ? (
              <View style={{ marginHorizontal: 16, marginTop: 10, backgroundColor: C_MINT, borderRadius: 12, padding: 10 }}>
                <Text style={{ color: '#fff', textAlign: 'center', fontSize: 13, fontWeight: '600' }}>{saveMsg}</Text>
              </View>
            ) : null}
            {/* 相册权限被拒绝时的引导横幅（PRD v2.1） */}
            {permissionDenied ? (
              <View style={{
                marginHorizontal: 16, marginTop: 10,
                backgroundColor: '#FFF0E0', borderRadius: 14,
                padding: 12, borderWidth: 1, borderColor: '#FFD580',
                flexDirection: 'row', alignItems: 'flex-start', gap: 10,
              }}>
                <Text style={{ fontSize: 18 }}>📷</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#AA7A00', fontSize: 12, fontWeight: '600', marginBottom: 2 }}>
                    需要相册权限才能保存卡片
                  </Text>
                  <Text style={{ color: '#AA7A00', fontSize: 11, lineHeight: 16, marginBottom: 8 }}>
                    请在「系统设置 → 应用 → 存储权限」中手动开启相册访问权限，或点击下方重试。
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Pressable
                      onPress={() => Linking.openSettings()}
                      style={{
                        flex: 1, backgroundColor: '#F0A500', borderRadius: 10,
                        paddingVertical: 8, alignItems: 'center',
                      }}
                    >
                      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>去系统设置</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => void handleSaveCard()}
                      style={{
                        flex: 1, backgroundColor: '#E8E2D8', borderRadius: 10,
                        paddingVertical: 8, alignItems: 'center',
                      }}
                    >
                      <Text style={{ color: '#888', fontSize: 12, fontWeight: '600' }}>重试</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            ) : null}

            {/* 操作按钮行：保存 + 分享 */}
            <Animated.View style={[{ marginHorizontal: 16, marginTop: 12, flexDirection: 'row', gap: 10 }, btnStyle]}>
              <Pressable
                onPress={handleSaveCard}
                disabled={savingCard}
                style={{
                  flex: 1,
                  backgroundColor: C_PINK,
                  borderRadius: 18,
                  paddingVertical: 14,
                  alignItems: 'center',
                  boxShadow: [{ offsetX: 0, offsetY: 4, blurRadius: 16, color: 'rgba(255,94,124,0.35)' }],
                }}
              >
                {savingCard
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>📸 保存相册</Text>
                }
              </Pressable>
              <Pressable
                onPress={handleShareCard}
                disabled={savingCard}
                style={{
                  flex: 1,
                  backgroundColor: C_PURPLE,
                  borderRadius: 18,
                  paddingVertical: 14,
                  alignItems: 'center',
                  boxShadow: [{ offsetX: 0, offsetY: 4, blurRadius: 16, color: 'rgba(108,99,255,0.30)' }],
                }}
              >
                {savingCard
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>🔗 分享</Text>
                }
              </Pressable>
            </Animated.View>
          </>
        )}

        {/* 历史卡片回顾 */}
        {history.length > 0 && (
          <View style={{
            backgroundColor: '#FFFFFF', borderRadius: 20,
            marginHorizontal: 16, marginTop: 24,
            paddingHorizontal: 16,
            boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 10, color: 'rgba(0,0,0,0.06)' }],
          }}>
            <Pressable
              onPress={() => setShowHistory(v => !v)}
              style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14 }}
            >
              <Text style={{ color: C_TEXT, fontSize: 14, fontWeight: '600' }}>🗂 历史卡片回顾</Text>
              <Text style={{ color: C_MUTED, fontSize: 13 }}>{showHistory ? '收起 ▲' : `展开 (${history.length}条) ▼`}</Text>
            </Pressable>

        {showHistory && history.map(snap => {
          const key = snap.dateKey ?? new Date(snap.ts).toISOString().slice(0, 10);
          return (
            <HistoryRow
              key={snap.ts}
              snap={snap}
              imageUri={imageUris[key] ?? null}
              isFav={favMap[key] ?? false}
              onPress={() => { /* TODO: 历史卡片详情页 */ }}
              onToggleFavorite={async () => {
                Haptics.selectionAsync();
                const nowFav = await toggleCardFavorite(key);
                // 同步文件迁移（SPEC §5.1）
                if (nowFav) {
                  await moveToFavorite(key);
                } else {
                  await moveFromFavorite(key);
                }
                setFavMap(prev => ({ ...prev, [key]: nowFav }));
              }}
            />
          );
        })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
