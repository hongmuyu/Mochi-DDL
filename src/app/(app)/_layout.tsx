import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Modal, Pressable, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack } from 'expo-router';
import {
  getAllTasks,
  cleanupOldData,
  loadCutoffHour,
  performLazySettlement,
  saveLastSettleDate,
  addSleepHoursToDateRecord,
} from '@/db/api';
import { calcDayFull } from '@/lib/state';
import {
  restoreTimerSession,
  clearTimerSession,
  calcElapsedSecs,
  splitSecsByDate,
  saveTimerSession,
} from '@/lib/timerStore';
import { addMinutesToDateRecord, dateStringByCutoff } from '@/db/api';
import { TimerRecoveryAction } from '@/types/types';

// 配色（与全局保持一致）
const C_BG     = '#FFFDF2';
const C_PINK   = '#FF5E7C';
const C_PURPLE = '#6C63FF';
const C_YELLOW = '#FFD166';
const C_MINT   = '#2EC4B6';
const C_TEXT   = '#333333';
const C_MUTED  = '#888888';

// ─── 格式化秒数为"X小时Y分钟" ─────────────────────────────
function fmtElapsed(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}小时${m > 0 ? m + '分钟' : ''}`;
  return `${Math.max(m, 1)}分钟`;
}

const C_SLEEP_MODAL = '#2C3E50';

// ─── 计时器恢复弹窗（PRD 3.4.2 / 13.5）支持 study/slack/sleep ──
function TimerRecoveryModal({
  visible,
  typeLabel,
  elapsedSecs,
  onAction,
}: {
  visible: boolean;
  typeLabel: '学习' | '摸鱼' | '睡眠';
  elapsedSecs: number;
  onAction: (action: TimerRecoveryAction) => void;
}) {
  if (!visible) return null;
  const isSleep = typeLabel === '睡眠';
  const accentColor = isSleep ? C_SLEEP_MODAL : typeLabel === '学习' ? C_PURPLE : C_PINK;
  const bgTint = isSleep ? '#EEF2FF' : typeLabel === '学习' ? '#EEF2FF' : '#FFF0F4';
  const emoji = isSleep ? '🌙' : typeLabel === '学习' ? '📚' : '🐟';
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => onAction('discard')}>
      <View style={{
        flex: 1, backgroundColor: 'rgba(51,33,66,0.45)',
        alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24,
      }}>
        <View style={{
          backgroundColor: C_BG, borderRadius: 28, padding: 28, width: '100%',
          boxShadow: [{ offsetX: 0, offsetY: 8, blurRadius: 32, color: 'rgba(108,99,255,0.18)' }],
        }}>
          {/* 标题 */}
          <View style={{ alignItems: 'center', marginBottom: 18 }}>
            <View style={{
              width: 72, height: 72, borderRadius: 36,
              backgroundColor: bgTint,
              alignItems: 'center', justifyContent: 'center', marginBottom: 12,
            }}>
              <Text style={{ fontSize: 34 }}>{emoji}</Text>
            </View>
            <Text style={{ color: C_TEXT, fontSize: 18, fontWeight: 'bold', textAlign: 'center' }}>
              发现未结束的{typeLabel}计时
            </Text>
            <Text style={{ color: C_MUTED, fontSize: 13, textAlign: 'center', marginTop: 6, lineHeight: 20 }}>
              上次{typeLabel}计时未正常停止{'\n'}
              已过去 <Text style={{ color: accentColor, fontWeight: 'bold' }}>
                {fmtElapsed(elapsedSecs)}
              </Text>，要怎么处理？
            </Text>
          </View>

          {/* 按钮组 */}
          <Pressable
            onPress={() => onAction('record')}
            style={{
              backgroundColor: accentColor,
              borderRadius: 16, paddingVertical: 14,
              alignItems: 'center', marginBottom: 10,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>
              ✅ {isSleep ? '记录这段睡眠' : '记录这段时间'}
            </Text>
          </Pressable>

          {/* 睡眠模式不提供「继续」（睡眠结束后无意义） */}
          {!isSleep && (
            <Pressable
              onPress={() => onAction('continue')}
              style={{
                backgroundColor: '#F5F2EE', borderRadius: 16, paddingVertical: 14,
                alignItems: 'center', marginBottom: 10,
              }}
            >
              <Text style={{ color: C_TEXT, fontSize: 14, fontWeight: '600' }}>
                ▶ 继续计时
              </Text>
            </Pressable>
          )}

          <Pressable
            onPress={() => onAction('discard')}
            style={{ alignItems: 'center', paddingVertical: 10 }}
          >
            <Text style={{ color: C_MUTED, fontSize: 13 }}>🗑 丢弃这段记录</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ─── 结算中 Loading 提示 ──────────────────────────────────
function SettlementLoadingModal({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade">
      <View style={{
        flex: 1, backgroundColor: 'rgba(51,33,66,0.32)',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <View style={{
          backgroundColor: C_BG, borderRadius: 20, padding: 28,
          alignItems: 'center', gap: 14,
        }}>
          <Text style={{ fontSize: 36 }}>🍡</Text>
          <Text style={{ color: C_PURPLE, fontSize: 15, fontWeight: 'bold' }}>正在补算历史数据…</Text>
          <ActivityIndicator color={C_PURPLE} />
          <Text style={{ color: C_MUTED, fontSize: 12 }}>最多补算 30 天，请稍候</Text>
        </View>
      </View>
    </Modal>
  );
}

/** 按日切点计算当前「今天」字符串 */
function todayByOffset(cutoffHour: number): string {
  const d = new Date();
  if (d.getHours() < cutoffHour) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function AppLayout() {
  const appStateRef = useRef(AppState.currentState);

  // 计时器恢复弹窗状态
  const [timerRecovery, setTimerRecovery] = useState<{
    visible: boolean;
    typeLabel: '学习' | '摸鱼' | '睡眠';
    elapsedSecs: number;
  }>({ visible: false, typeLabel: '学习', elapsedSecs: 0 });
  const pendingSessionRef = useRef<Awaited<ReturnType<typeof restoreTimerSession>>>(null);

  // 结算中 Loading
  const [settling, setSettling] = useState(false);

  // ─── 计时器恢复动作处理（study/slack/sleep 三类型）────────
  const handleTimerRecovery = useCallback(async (action: TimerRecoveryAction) => {
    setTimerRecovery(prev => ({ ...prev, visible: false }));
    const session = pendingSessionRef.current;
    if (!session) return;

    if (action === 'record') {
      const cutoff = await loadCutoffHour();
      if (session.type === 'sleep') {
        // 睡眠：按小时写入 sleep_hours，14h 截断
        const clampedSecs = Math.min(calcElapsedSecs(session), 14 * 3600);
        const segments = splitSecsByDate(session.startTs, clampedSecs, cutoff);
        for (const seg of segments) {
          await addSleepHoursToDateRecord(seg.date, seg.secs / 3600);
        }
        await clearTimerSession();
        await AsyncStorage.removeItem('ddl_sleep_start_ts');
      } else {
        // study / slack：按分钟写入，12h 截断
        const clampedSecs = Math.min(calcElapsedSecs(session), 12 * 3600);
        const segments = splitSecsByDate(session.startTs, clampedSecs, cutoff);
        for (const seg of segments) {
          await addMinutesToDateRecord(seg.date, session.type, Math.round(seg.secs / 60));
        }
        await clearTimerSession();
      }
    } else if (action === 'continue') {
      // 睡眠模式不提供继续（modal 中已隐藏按钮），防御性处理
      const elapsedSoFar = calcElapsedSecs(session);
      await saveTimerSession({
        type: session.type,
        startTs: Date.now(),
        accumSecs: elapsedSoFar,
        paused: false,
      });
    } else {
      await clearTimerSession();
      await AsyncStorage.removeItem('ddl_sleep_start_ts');
    }
    pendingSessionRef.current = null;
  }, []);

  // ─── 冷启动 / 前台恢复执行序列（PRD 13.1 / 13.2）──────
  const runStartupSequence = useCallback(async () => {
    // Step 1：异步日志/数据清理（每周一次，后台静默）
    cleanupOldData().catch(() => undefined);

    // Step 2a：检测未结束 study/slack 计时会话
    const session = await restoreTimerSession();
    if (session && !session.paused) {
      const elapsedSecs = Math.min(calcElapsedSecs(session), 12 * 3600);
      if (elapsedSecs > 60) {
        pendingSessionRef.current = session;
        setTimerRecovery({
          visible: true,
          typeLabel: session.type === 'study' ? '学习' : session.type === 'sleep' ? '睡眠' : '摸鱼',
          elapsedSecs,
        });
        return; // 等用户处理完再执行后续步骤
      }
    }

    // Step 2b：检测未结束睡眠计时会话（独立 AsyncStorage 键）
    const sleepStartStr = await AsyncStorage.getItem('ddl_sleep_start_ts');
    if (sleepStartStr) {
      const sleepStartTs = Number(sleepStartStr);
      const sleepElapsed = Math.floor((Date.now() - sleepStartTs) / 1000);
      if (sleepElapsed > 60) {
        // 构造虚拟 session 复用弹窗流程
        pendingSessionRef.current = {
          type: 'sleep',
          startTs: sleepStartTs,
          accumSecs: 0,
          paused: false,
        };
        setTimerRecovery({
          visible: true,
          typeLabel: '睡眠',
          elapsedSecs: Math.min(sleepElapsed, 14 * 3600),
        });
        return;
      }
    }

    // Step 3：跨日惰性结算
    const cutoff = await loadCutoffHour();
    const todayStr = todayByOffset(cutoff);

    setSettling(true);
    try {
      const tasks = await getAllTasks();
      await performLazySettlement(todayStr, (record, allTasks, prevWear, sleeplessDays) =>
        calcDayFull(record, tasks.length > 0 ? tasks : allTasks, prevWear, sleeplessDays)
      );
    } catch {
      // 结算失败静默处理
      await saveLastSettleDate(todayStr).catch(() => undefined);
    } finally {
      setSettling(false);
    }
  }, []);

  useEffect(() => {
    void runStartupSequence();

    const sub = AppState.addEventListener('change', (nextState) => {
      if (appStateRef.current !== 'active' && nextState === 'active') {
        void runStartupSequence();
      }
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, [runStartupSequence]);

  // 计时器恢复完成后继续执行后续步骤
  const handleTimerRecoveryAndContinue = useCallback(async (action: TimerRecoveryAction) => {
    await handleTimerRecovery(action);
    // 继续执行惰性结算
    const cutoff = await loadCutoffHour();
    const todayStr = todayByOffset(cutoff);
    setSettling(true);
    try {
      const tasks = await getAllTasks();
      await performLazySettlement(todayStr, (record, allTasks, prevWear, sleeplessDays) =>
        calcDayFull(record, tasks.length > 0 ? tasks : allTasks, prevWear, sleeplessDays)
      );
    } catch {
      await saveLastSettleDate(todayStr).catch(() => undefined);
    } finally {
      setSettling(false);
    }
  }, [handleTimerRecovery]);

  return (
    <>
      <TimerRecoveryModal
        visible={timerRecovery.visible}
        typeLabel={timerRecovery.typeLabel}
        elapsedSecs={timerRecovery.elapsedSecs}
        onAction={handleTimerRecoveryAndContinue}
      />
      <SettlementLoadingModal visible={settling} />

      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="achievements" />
        <Stack.Screen name="stats" />
        <Stack.Screen name="quotes" />
        <Stack.Screen name="about" />
        <Stack.Screen name="cutoff-settings" />
        <Stack.Screen name="data-backup" />
      </Stack>
    </>
  );
}
