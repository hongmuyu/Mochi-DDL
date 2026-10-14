import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  getTodayRecord,
  getRecentRecords,
  upsertTodayRecord,
  addMinutesToDateRecord,
  addSleepHoursToDateRecord,
  loadCutoffHour,
  isTimerLockedToday,
  recordAbnormalSecs,
  detectTimeReversal,
  saveLastKnownTs,
  updateTimeRecord,
  deleteTimeRecord,
} from '@/db/api';
import { TimeRecord, effectiveSlackMinutes, effectiveStudyMinutes } from '@/types/types';
import {
  ActiveTimerType,
  TimerSession,
  calcElapsedSecs,
  clearTimerSession,
  restoreTimerSession,
  saveTimerSession,
  splitSecsByDate,
} from '@/lib/timerStore';

// 多巴胺配色
const C_BG = '#FFFDF2';
const C_PINK = '#FF5E7C';
const C_PURPLE = '#6C63FF';
const C_YELLOW = '#FFD166';
const C_MINT = '#2EC4B6';
const C_RED = '#FF003C';
const C_TEXT = '#333333';
const C_MUTED = '#888888';

// 深夜蓝（睡眠计时专用）
const C_SLEEP = '#2C3E50';

type TimerMode = 'idle' | ActiveTimerType;

// 格式化显示分钟数
function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

// HH:MM:SS 格式（PRD 3.4.2）
function formatHMS(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

// 睡眠计时友好格式：Xh Ym
function formatSleepElapsed(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h${m > 0 ? m + 'm' : ''}`;
  return `${m}m`;
}

function getSlackIndex(slackMin: number, studyMin: number): {
  label: string; emoji: string; desc: string; color: string;
} {
  if (studyMin === 0 && slackMin > 0)
    return { label: '摸鱼仙人', emoji: '🐟', desc: '0学习，纯摸鱼。已臻化境。', color: C_RED };
  const ratio = studyMin > 0 ? slackMin / studyMin : 99;
  if (ratio > 3) return { label: '摸鱼大师', emoji: '🎣', desc: '摸鱼是学习的3倍+，天赋异禀', color: C_PINK };
  if (ratio > 1) return { label: '边学边摸', emoji: '😬', desc: '摸鱼超过学习，合理合理', color: C_YELLOW };
  if (ratio > 0.5) return { label: '努力摸鱼中', emoji: '😅', desc: '学习与摸鱼并行，人之常情', color: '#FF8C00' };
  if (ratio > 0) return { label: '还算努力', emoji: '🌱', desc: '摸鱼比例尚可，继续保持', color: C_MINT };
  return { label: '卷王出没', emoji: '👑', desc: '今日无摸鱼，肃然起敬', color: C_PURPLE };
}

// 软卡片
function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return (
    <View style={[{
      backgroundColor: '#FFFFFF',
      borderRadius: 20,
      padding: 16,
      marginBottom: 12,
      boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 10, color: 'rgba(0,0,0,0.06)' }],
    }, style]}>
      {children}
    </View>
  );
}

// 步进器（可爱版）
function Stepper({
  label, emoji, displayValue, onInc, onDec, accentColor,
}: {
  label: string; emoji: string; value: number; displayValue: string;
  onInc: () => void; onDec: () => void; accentColor: string;
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ color: C_MUTED, fontSize: 12, marginBottom: 8 }}>{emoji} {label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable onPress={onDec} style={{
          width: 44, height: 44, borderRadius: 22, backgroundColor: '#F5F2EA',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{ color: C_TEXT, fontSize: 22, fontWeight: '300', lineHeight: 26 }}>−</Text>
        </Pressable>
        <Text style={{ color: accentColor, fontSize: 28, fontWeight: 'bold', minWidth: 100, textAlign: 'center' }}>
          {displayValue}
        </Text>
        <Pressable onPress={onInc} style={{
          width: 44, height: 44, borderRadius: 22, backgroundColor: `${accentColor}22`,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{ color: accentColor, fontSize: 22, fontWeight: '600', lineHeight: 26 }}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

function EditTimeRecordModal({
  visible,
  record,
  onClose,
  onSave,
  onDelete,
}: {
  visible: boolean;
  record: TimeRecord | null;
  onClose: () => void;
  onSave: (recordDate: string, studyMin: number, slackMin: number, sleepH: number) => Promise<void>;
  onDelete: (recordDate: string) => Promise<void>;
}) {
  const [study, setStudy] = useState('0');
  const [slack, setSlack] = useState('0');
  const [sleep, setSleep] = useState('0');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (record) {
      setStudy(String(effectiveStudyMinutes(record)));
      setSlack(String(effectiveSlackMinutes(record)));
      setSleep(String(record.sleep_hours));
      setError('');
    }
  }, [record]);

  if (!record) return null;

  const handleSave = async () => {
    const studyNum = parseInt(study, 10);
    const slackNum = parseInt(slack, 10);
    const sleepNum = parseFloat(sleep);

    if (isNaN(studyNum) || studyNum < 0 || isNaN(slackNum) || slackNum < 0 || isNaN(sleepNum) || sleepNum < 0) {
      setError('请输入有效的非负数值');
      return;
    }

    // 24小时防溢出校验
    const totalMinutes = studyNum + slackNum + sleepNum * 60;
    if (totalMinutes > 1440) {
      setError('单日总时长不能超过 24 小时（1440 分钟）');
      return;
    }

    setSaving(true);
    try {
      await onSave(record.record_date, studyNum, slackNum, sleepNum);
      onClose();
    } catch {
      setError('保存修改失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onDelete(record.record_date);
      onClose();
    } catch {
      setError('删除记录失败，请重试');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={process.env.EXPO_OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 }}>
        <View style={{ backgroundColor: '#FFFDF2', borderRadius: 24, padding: 20, borderWidth: 1.5, borderColor: '#E8E0D0' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <Text style={{ fontSize: 17, fontWeight: 'bold', color: C_PURPLE }}>
              ✏️ 修正专注与摸鱼记录
            </Text>
            <Pressable onPress={onClose} style={{ padding: 4 }}>
              <Text style={{ fontSize: 20, color: C_MUTED }}>✕</Text>
            </Pressable>
          </View>
          <Text style={{ fontSize: 12, color: C_MUTED, marginBottom: 14 }}>
            日期：{record.record_date} · 误操作修正后将自动重新计算当日统计
          </Text>

          <View style={{ gap: 10, marginBottom: 14 }}>
            <View>
              <Text style={{ fontSize: 12, color: C_TEXT, fontWeight: '600', marginBottom: 4 }}>
                学习专注时长 (分钟)
              </Text>
              <TextInput
                value={study}
                onChangeText={setStudy}
                keyboardType="numeric"
                style={{ backgroundColor: '#fff', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#E8E0D0', color: C_TEXT }}
              />
            </View>

            <View>
              <Text style={{ fontSize: 12, color: C_TEXT, fontWeight: '600', marginBottom: 4 }}>
                摸鱼时长 (分钟)
              </Text>
              <TextInput
                value={slack}
                onChangeText={setSlack}
                keyboardType="numeric"
                style={{ backgroundColor: '#fff', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#E8E0D0', color: C_TEXT }}
              />
            </View>

            <View>
              <Text style={{ fontSize: 12, color: C_TEXT, fontWeight: '600', marginBottom: 4 }}>
                睡眠时长 (小时)
              </Text>
              <TextInput
                value={sleep}
                onChangeText={setSleep}
                keyboardType="numeric"
                style={{ backgroundColor: '#fff', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#E8E0D0', color: C_TEXT }}
              />
            </View>
          </View>

          {error ? (
            <Text style={{ color: C_RED, fontSize: 12, marginBottom: 10 }}>{error}</Text>
          ) : null}

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable
              onPress={() => void handleDelete()}
              disabled={deleting}
              style={{ paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, backgroundColor: '#FFEBF0', alignItems: 'center' }}
            >
              <Text style={{ color: C_RED, fontWeight: 'bold', fontSize: 13 }}>
                {deleting ? '删除中…' : '🗑️ 删除'}
              </Text>
            </Pressable>
            <Pressable
              onPress={onClose}
              style={{ flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: '#F0EBE0', alignItems: 'center' }}
            >
              <Text style={{ color: C_MUTED, fontWeight: '600', fontSize: 13 }}>取消</Text>
            </Pressable>
            <Pressable
              onPress={() => void handleSave()}
              disabled={saving}
              style={{ flex: 2, paddingVertical: 12, borderRadius: 12, backgroundColor: C_PURPLE, alignItems: 'center' }}
            >
              <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 13 }}>
                {saving ? '保存中…' : '💾 确认修正'}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default function SlackScreen() {
  const [todayRecord, setTodayRecord] = useState<TimeRecord | null>(null);
  const [recentRecords, setRecentRecords] = useState<TimeRecord[]>([]);
  const [editRecordTarget, setEditRecordTarget] = useState<TimeRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  // 手动覆盖确认弹窗
  const [showOverrideConfirm, setShowOverrideConfirm] = useState(false);
  // 极值警告
  const [inputError, setInputError] = useState<string | null>(null);

  const [studyMin, setStudyMin] = useState(0);
  const [slackMin, setSlackMin] = useState(0);
  const [sleepH, setSleepH] = useState(0);
  // 日切点
  const [cutoffHour, setCutoffHour] = useState(4);

  // 计时器状态（study / slack）
  const [timerMode, setTimerMode] = useState<TimerMode>('idle');
  const [timerPaused, setTimerPaused] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  // 当前段开始的时间戳（每次开始/继续时更新，暂停时停止用）
  const sessionStartTsRef = useRef<number>(0);
  // 当前段开始前已累计秒数
  const accumSecsRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // §3.1 睡眠计时器（独立状态机）
  const [sleepTimerActive, setSleepTimerActive] = useState(false);
  const [sleepTimerSeconds, setSleepTimerSeconds] = useState(0);
  const sleepStartTsRef = useRef<number>(0);
  const sleepTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 14h 超限弹窗
  const [showSleepOverLimit, setShowSleepOverLimit] = useState(false);
  const [sleepOverLimitSecs, setSleepOverLimitSecs] = useState(0);
  // 反作弊：计时器锁定（PRD §5 异常计时器保护）
  const [timerLocked, setTimerLocked] = useState(false);
  const [timerLockedMsg, setTimerLockedMsg] = useState('');
  // HC-08 时光倒流防御（PRD §4.17）
  const [timeReversed, setTimeReversed] = useState(false);
  const [showTimeReverseModal, setShowTimeReverseModal] = useState(false);

  // ─── 数据加载 ───────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      const cutoff = await loadCutoffHour();
      setCutoffHour(cutoff);
      const [today, recent] = await Promise.all([getTodayRecord(cutoff), getRecentRecords(7)]);
      setTodayRecord(today);
      setRecentRecords(recent);
      if (today) {
        setStudyMin(effectiveStudyMinutes(today));
        setSlackMin(effectiveSlackMinutes(today));
        setSleepH(today.sleep_hours);
      }
      // 检查计时器锁定状态（PRD §5 反作弊）
      const todayStr = (() => {
        const d = new Date(); if (d.getHours() < cutoff) d.setDate(d.getDate() - 1);
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      })();
      const locked = await isTimerLockedToday(todayStr);
      setTimerLocked(locked);
      if (locked) setTimerLockedMsg('⚠️ 今日检测到异常计时行为，计时器已锁定');
      // HC-08 时光倒流检测（PRD §4.17）
      const reversed = await detectTimeReversal();
      if (reversed) {
        setTimeReversed(true);
        setShowTimeReverseModal(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } else {
        setTimeReversed(false);
      }
    } catch { }
    finally { setLoading(false); }
  }, []);

  // 记录修正与统计重算
  const handleSaveRecordCorrection = async (
    recordDate: string,
    studyMinutes: number,
    slackMinutes: number,
    sleepHours: number
  ) => {
    await updateTimeRecord(recordDate, {
      study_minutes: studyMinutes,
      slack_minutes: slackMinutes,
      sleep_hours: sleepHours,
    });
    // 触发吉祥物重新计算
    await AsyncStorage.setItem('last_task_completed_at', String(Date.now()));
    await loadData();
  };

  const handleDeleteRecord = async (recordDate: string) => {
    await deleteTimeRecord(recordDate);
    // 触发吉祥物重新计算
    await AsyncStorage.setItem('last_task_completed_at', String(Date.now()));
    await loadData();
  };

  // ─── 恢复后台计时（差值法，PRD 4.14）──────────────────────
  const restoreTimer = useCallback(async () => {
    const session = await restoreTimerSession();
    if (!session) return;

    // ── 反作弊 §5：恢复时检查 4h 硬上限（PRD 3.4.2）──────────
    const elapsed = calcElapsedSecs(session, Date.now());
    const MAX_SESSION_SECS = 4 * 3600;
    if (elapsed > MAX_SESSION_SECS) {
      // 超过 4h，强制作废本次会话
      await clearTimerSession();
      const now = new Date();
      if (now.getHours() < 4) now.setDate(now.getDate() - 1);
      const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      const locked = await recordAbnormalSecs(elapsed, todayStr);
      if (locked) {
        setTimerLocked(true);
        setTimerLockedMsg('⚠️ 异常恢复超过 12h 累计，计时器已锁定');
      } else {
        setTimerLockedMsg('⏰ 上次计时超过 4 小时，已强制作废，不计入统计');
      }
      return;
    }

    setTimerMode(session.type);
    setTimerPaused(session.paused);
    setTimerSeconds(elapsed);
    accumSecsRef.current = session.accumSecs;
    sessionStartTsRef.current = session.startTs;
  }, []);

  // ─── §3.1 睡眠计时器恢复（差值法，键值独立）──────────────
  const restoreSleepTimer = useCallback(async () => {
    const stored = await AsyncStorage.getItem('ddl_sleep_start_ts');
    if (!stored) return;
    const startTs = Number(stored);
    if (!startTs) return;
    const elapsed = Math.floor((Date.now() - startTs) / 1000);
    if (elapsed > 14 * 3600) {
      // 超过 14h → 弹窗让用户选择记录为 8h 或丢弃
      setSleepOverLimitSecs(elapsed);
      setShowSleepOverLimit(true);
      return;
    }
    sleepStartTsRef.current = startTs;
    setSleepTimerActive(true);
    setSleepTimerSeconds(elapsed);
  }, []);

  // 进入页面：先恢复计时，再加载数据
  useFocusEffect(useCallback(() => {
    restoreTimer().then(() => loadData());
    void restoreSleepTimer();
  }, [restoreTimer, loadData, restoreSleepTimer]));

  // ─── 计时器 tick（study/slack）────────────────────────────
  useEffect(() => {
    if (timerMode !== 'idle' && !timerPaused) {
      timerRef.current = setInterval(() => {
        const elapsed = accumSecsRef.current + Math.floor((Date.now() - sessionStartTsRef.current) / 1000);
        setTimerSeconds(elapsed);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timerMode, timerPaused]);

  // ─── §3.1 睡眠计时器 tick ─────────────────────────────────
  useEffect(() => {
    if (sleepTimerActive) {
      sleepTimerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - sleepStartTsRef.current) / 1000);
        setSleepTimerSeconds(elapsed);
        // 14h 自动触发超限弹窗
        if (elapsed > 14 * 3600) {
          if (sleepTimerRef.current) clearInterval(sleepTimerRef.current);
          setSleepOverLimitSecs(elapsed);
          setShowSleepOverLimit(true);
          setSleepTimerActive(false);
        }
      }, 1000);
    } else {
      if (sleepTimerRef.current) clearInterval(sleepTimerRef.current);
    }
    return () => { if (sleepTimerRef.current) clearInterval(sleepTimerRef.current); };
  }, [sleepTimerActive]);

  // ─── §3.1 开始睡眠计时 ────────────────────────────────────
  const startSleepTimer = async () => {
    if (timerLocked || timeReversed) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const now = Date.now();
    sleepStartTsRef.current = now;
    await AsyncStorage.setItem('ddl_sleep_start_ts', String(now));
    setSleepTimerActive(true);
    setSleepTimerSeconds(0);
  };

  // ─── §3.1 停止睡眠计时并写入 sleep_hours ─────────────────
  const stopSleepTimer = async (overrideSecs?: number) => {
    if (sleepTimerRef.current) clearInterval(sleepTimerRef.current);
    const elapsed = overrideSecs ?? Math.floor((Date.now() - sleepStartTsRef.current) / 1000);
    setSleepTimerActive(false);
    setSleepTimerSeconds(0);
    await AsyncStorage.removeItem('ddl_sleep_start_ts');

    if (elapsed < 60) return; // 不足 1 分钟不记录

    setAutoSaving(true);
    try {
      const cutoff = cutoffHour;
      const startTs = sleepStartTsRef.current;
      // 跨天拆分（以小时为单位，按日切点）
      const segments = splitSecsByDate(startTs, elapsed, cutoff);
      for (const seg of segments) {
        const hours = seg.secs / 3600;
        if (hours > 0) await addSleepHoursToDateRecord(seg.date, hours);
      }
      await saveLastKnownTs();
      await loadData();
    } catch { } finally {
      setAutoSaving(false);
    }
  };

  // ─── §3.1 睡眠超 14h 弹窗处理 ─────────────────────────────
  const handleSleepOverLimit = async (recordAs8h: boolean) => {
    setShowSleepOverLimit(false);
    setSleepTimerActive(false);
    await AsyncStorage.removeItem('ddl_sleep_start_ts');
    if (recordAs8h) {
      // 按 8h 写入当日
      const cutoff = cutoffHour;
      const now = new Date();
      if (now.getHours() < cutoff) now.setDate(now.getDate() - 1);
      const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      await addSleepHoursToDateRecord(dateStr, 8);
      await loadData();
    }
  };

  // ─── 开始计时 ─────────────────────────────────────────────
  const startTimer = async (mode: ActiveTimerType) => {
    // 互斥防冲突：已有进行中的计时时禁止重复启动冲突计时
    if (timerMode !== 'idle') {
      setInputError('已有正在进行中的计时，请先结束当前计时哦！');
      return;
    }
    // 反作弊：计时器锁定时禁止开始新会话
    if (timerLocked) return;
    // HC-08：时光倒流时禁止开始计时
    if (timeReversed) {
      setShowTimeReverseModal(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const now = Date.now();
    sessionStartTsRef.current = now;
    accumSecsRef.current = 0;
    setTimerMode(mode);
    setTimerPaused(false);
    setTimerSeconds(0);
    const session: TimerSession = { type: mode, startTs: now, accumSecs: 0, paused: false };
    await saveTimerSession(session);
    await saveLastKnownTs(); // 更新可信时间戳
  };

  // ─── 暂停计时 ─────────────────────────────────────────────
  const pauseTimer = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // 冻结已过秒数到 accumSecs
    const frozenSecs = accumSecsRef.current + Math.floor((Date.now() - sessionStartTsRef.current) / 1000);
    accumSecsRef.current = frozenSecs;
    setTimerPaused(true);
    setTimerSeconds(frozenSecs);
    if (timerMode === 'idle') return;
    const session: TimerSession = {
      type: timerMode as ActiveTimerType,
      startTs: sessionStartTsRef.current,
      accumSecs: frozenSecs,
      paused: true,
    };
    await saveTimerSession(session);
  };

  // ─── 继续计时 ─────────────────────────────────────────────
  const resumeTimer = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const now = Date.now();
    sessionStartTsRef.current = now;
    setTimerPaused(false);
    if (timerMode === 'idle') return;
    const session: TimerSession = {
      type: timerMode as ActiveTimerType,
      startTs: now,
      accumSecs: accumSecsRef.current,
      paused: false,
    };
    await saveTimerSession(session);
  };

  // ─── 停止计时并自动累加（PRD 3.4.2 / 4.14 核心逻辑）────────
  const stopTimer = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    if (timerRef.current) clearInterval(timerRef.current);

    const totalSecs = timerPaused
      ? accumSecsRef.current
      : accumSecsRef.current + Math.floor((Date.now() - sessionStartTsRef.current) / 1000);

    if (totalSecs < 1 || timerMode === 'idle') {
      setTimerMode('idle');
      setTimerPaused(false);
      setTimerSeconds(0);
      await clearTimerSession();
      return;
    }

    // ── 反作弊与防记录丢失：单次会话 4h 封顶保护（PRD 3.4.2 优化）─────────────
    const MAX_SESSION_SECS = 4 * 3600;
    const isExceeded = totalSecs > MAX_SESSION_SECS;
    const effectiveSecs = isExceeded ? MAX_SESSION_SECS : totalSecs;

    if (isExceeded) {
      const cutoff = cutoffHour;
      const now = new Date();
      if (now.getHours() < cutoff) now.setDate(now.getDate() - 1);
      const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      const locked = await recordAbnormalSecs(totalSecs - MAX_SESSION_SECS, todayStr);
      if (locked) {
        setTimerLocked(true);
        setTimerLockedMsg('⚠️ 今日累计异常计时过多，计时器已锁定');
      } else {
        setTimerLockedMsg('⏰ 单次计时超过 4 小时，已自动按 4 小时封顶计入，请注意劳逸结合！');
      }
    }

    // HC-08：时光倒流时禁止写入数据，清空会话并提示
    if (timeReversed) {
      await clearTimerSession();
      setTimerMode('idle');
      setTimerPaused(false);
      setTimerSeconds(0);
      accumSecsRef.current = 0;
      setShowTimeReverseModal(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    const type = timerMode as ActiveTimerType;
    if (type === 'sleep') return; // 睡眠由独立计时器处理，此处不应触发
    // 跨天拆分（PRD 4.14），传入用户自定义日切点
    const startTs = sessionStartTsRef.current - (accumSecsRef.current * 1000);
    const slices = splitSecsByDate(startTs, effectiveSecs, cutoffHour);

    setAutoSaving(true);
    try {
      for (const slice of slices) {
        const addMin = Math.round(slice.secs / 60);
        if (addMin > 0) await addMinutesToDateRecord(slice.date, type, addMin);
      }
      await clearTimerSession();
      setTimerMode('idle');
      setTimerPaused(false);
      setTimerSeconds(0);
      accumSecsRef.current = 0;
      await saveLastKnownTs(); // 成功写入后更新可信时间戳
      await loadData();
    } catch { } finally {
      setAutoSaving(false);
    }
  };

  // ─── 手动保存（含手动覆盖确认 + 极值校验）────────────────
  const handleSavePress = () => {
    // 前端极值防线：超1440分钟(24h)时提示
    if (studyMin > 1440 || slackMin > 1440) {
      setInputError('一天最多 24 小时哦，麻糬的数学不太好~');
      return;
    }
    setInputError(null);
    // 若有计时器记录（非手动覆盖），需弹出确认弹窗
    const hasTimerData = todayRecord && (
      (todayRecord.timer_study_minutes ?? 0) > 0 ||
      (todayRecord.timer_slack_minutes ?? 0) > 0
    );
    if (hasTimerData && !todayRecord?.is_manual_override) {
      setShowOverrideConfirm(true);
    } else {
      void doSave();
    }
  };

  const doSave = async () => {
    setSaving(true);
    setShowOverrideConfirm(false);
    try {
      await upsertTodayRecord(
        { study_minutes: Math.min(studyMin, 1440), slack_minutes: Math.min(slackMin, 1440), sleep_hours: sleepH, manual_override: true },
        cutoffHour,
      );
      await loadData();
    } catch { }
    finally { setSaving(false); }
  };

  const slackIndex = getSlackIndex(slackMin, studyMin);
  const timerColor = timerMode === 'slack' ? C_PINK : C_MINT;
  const timerDisplay = formatHMS(timerSeconds);
  const addedMin = Math.round(timerSeconds / 60);

  const blinkOp = useSharedValue(1);
  useEffect(() => {
    if (timerMode !== 'idle' && !timerPaused) {
      blinkOp.value = withRepeat(
        withSequence(withTiming(0.5, { duration: 500 }), withTiming(1, { duration: 500 })),
        -1, true,
      );
    } else {
      blinkOp.value = withTiming(1, { duration: 300 });
    }
  }, [timerMode, timerPaused, blinkOp]);
  const blinkStyle = useAnimatedStyle(() => ({ opacity: blinkOp.value }));

  const sleepColor = sleepH < 5 ? C_RED : sleepH < 7 ? C_YELLOW : C_MINT;

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: C_BG, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 36 }}>🐟</Text>
        <ActivityIndicator color={C_MINT} style={{ marginTop: 12 }} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C_BG }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 56, paddingBottom: 100 }}
      >
        {/* 标题 */}
        <Text style={{ color: C_MUTED, fontSize: 11 }}>时间追踪</Text>
        <Text style={{ color: C_PURPLE, fontSize: 24, fontWeight: 'bold', marginBottom: 16 }}>🐟 摸鱼日志</Text>

        {/* 摸鱼指数卡片 */}
        <Card style={{ borderWidth: 2, borderColor: slackIndex.color }}>
          <Text style={{ color: C_MUTED, fontSize: 11, marginBottom: 8 }}>当前摸鱼指数</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text style={{ fontSize: 48 }}>{slackIndex.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: slackIndex.color, fontSize: 20, fontWeight: 'bold' }}>
                「{slackIndex.label}」
              </Text>
              <Text style={{ color: C_MUTED, fontSize: 12, marginTop: 4 }}>{slackIndex.desc}</Text>
            </View>
          </View>
        </Card>

        {/* 实时计时器卡片 */}
        <Card style={timerMode !== 'idle' ? { borderWidth: 2, borderColor: timerColor } : {}}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={{ color: C_MUTED, fontSize: 11 }}>⏱ 实时计时器</Text>
            {timerMode !== 'idle' && (
              <View style={{
                backgroundColor: `${timerColor}22`,
                borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
              }}>
                <Text style={{ color: timerColor, fontSize: 11, fontWeight: '700' }}>
                  {timerMode === 'study' ? '📚 学习中' : '🐟 摸鱼中'}
                  {timerPaused ? ' · 已暂停' : ''}
                </Text>
              </View>
            )}
          </View>

          {/* 反作弊：计时器锁定提示（PRD §5）*/}
          {(timerLocked || timerLockedMsg !== '') && (
            <View style={{
              backgroundColor: '#FFF3E0', borderRadius: 10, padding: 10, marginBottom: 12,
              borderWidth: 1, borderColor: '#FF8C00',
            }}>
              <Text style={{ color: '#FF8C00', fontSize: 12, textAlign: 'center' }}>
                {timerLockedMsg || '⚠️ 计时器已锁定，请明日再使用'}
              </Text>
            </View>
          )}

          {/* HC-08 时光倒流警告横幅（PRD §4.17）*/}
          {timeReversed && (
            <Pressable
              onPress={() => setShowTimeReverseModal(true)}
              style={{
                backgroundColor: '#FDE8F0', borderRadius: 10, padding: 10, marginBottom: 12,
                borderWidth: 1, borderColor: '#FF5E7C', flexDirection: 'row',
                alignItems: 'center', gap: 8,
              }}
            >
              <Text style={{ fontSize: 16 }}>⏳</Text>
              <Text style={{ color: '#D63384', fontSize: 12, fontWeight: '700', flex: 1 }}>
                检测到时光倒流！计时器已被暂时封印
              </Text>
              <Text style={{ color: '#D63384', fontSize: 11 }}>详情 →</Text>
            </Pressable>
          )}

          {/* HH:MM:SS 大显示（PRD 3.4.2）*/}
          <Animated.Text style={[{
            color: timerMode === 'idle' ? C_TEXT : timerColor,
            fontSize: 52,
            fontWeight: 'bold',
            textAlign: 'center',
            marginBottom: 4,
            fontVariant: ['tabular-nums'],
          }, (timerMode !== 'idle' && !timerPaused) ? blinkStyle : {}]}>
            {timerDisplay}
          </Animated.Text>

          {timerMode !== 'idle' && (
            <Text style={{ color: C_MUTED, textAlign: 'center', fontSize: 11, marginBottom: 12 }}>
              停止后将自动累加到今日记录 · 无需手动保存
            </Text>
          )}

          {/* 按钮区 */}
          {timerMode === 'idle' ? (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable
                onPress={() => startTimer('study')}
                disabled={timerLocked || timeReversed}
                style={{
                  flex: 1, paddingVertical: 12, borderRadius: 14,
                  backgroundColor: (timerLocked || timeReversed) ? '#F5F2EE' : `${C_MINT}22`,
                  borderWidth: 1.5, borderColor: (timerLocked || timeReversed) ? '#CCC' : C_MINT,
                  alignItems: 'center', opacity: (timerLocked || timeReversed) ? 0.5 : 1,
                }}
              >
                <Text style={{ color: (timerLocked || timeReversed) ? '#AAA' : C_MINT, fontSize: 13, fontWeight: 'bold' }}>📚 开始学习</Text>
              </Pressable>
              <Pressable
                onPress={() => startTimer('slack')}
                disabled={timerLocked || timeReversed}
                style={{
                  flex: 1, paddingVertical: 12, borderRadius: 14,
                  backgroundColor: (timerLocked || timeReversed) ? '#F5F2EE' : `${C_PINK}22`,
                  borderWidth: 1.5, borderColor: (timerLocked || timeReversed) ? '#CCC' : C_PINK,
                  alignItems: 'center', opacity: (timerLocked || timeReversed) ? 0.5 : 1,
                }}
              >
                <Text style={{ color: (timerLocked || timeReversed) ? '#AAA' : C_PINK, fontSize: 13, fontWeight: 'bold' }}>🐟 开始摸鱼</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ gap: 8 }}>
              {/* 暂停 / 继续 */}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {timerPaused ? (
                  <Pressable
                    onPress={resumeTimer}
                    style={{
                      flex: 1, paddingVertical: 12, borderRadius: 14,
                      backgroundColor: `${timerColor}22`, borderWidth: 1.5, borderColor: timerColor,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ color: timerColor, fontSize: 13, fontWeight: 'bold' }}>▶ 继续计时</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={pauseTimer}
                    style={{
                      flex: 1, paddingVertical: 12, borderRadius: 14,
                      backgroundColor: '#F5F2EA', borderWidth: 1.5, borderColor: '#DDD',
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ color: C_TEXT, fontSize: 13, fontWeight: 'bold' }}>⏸ 暂停</Text>
                  </Pressable>
                )}
              </View>
              {/* 停止并自动累加 */}
              <Pressable
                onPress={stopTimer}
                disabled={autoSaving}
                style={{
                  paddingVertical: 12, borderRadius: 14,
                  backgroundColor: timerColor, alignItems: 'center',
                }}
              >
                {autoSaving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: 'bold' }}>
                    ⏹ 停止并记录（+{addedMin}min）
                  </Text>
                )}
              </Pressable>
            </View>
          )}
        </Card>

        {/* §3.1 睡眠计时器卡片 */}
        <Card style={sleepTimerActive ? { borderWidth: 2, borderColor: C_SLEEP } : {}}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <Text style={{ color: C_MUTED, fontSize: 11 }}>🌙 睡眠计时器</Text>
            {sleepTimerActive && (
              <View style={{ backgroundColor: '#2C3E5022', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ color: C_SLEEP, fontSize: 11, fontWeight: '700' }}>睡眠中…</Text>
              </View>
            )}
          </View>

          {sleepTimerActive ? (
            <>
              <Text style={{
                color: C_SLEEP, fontSize: 38, fontWeight: 'bold',
                textAlign: 'center', marginBottom: 4, fontVariant: ['tabular-nums'],
              }}>
                已过去 {formatSleepElapsed(sleepTimerSeconds)}
              </Text>
              <Text style={{ color: C_MUTED, textAlign: 'center', fontSize: 11, marginBottom: 12 }}>
                起床后点击「起来啦！」自动写入睡眠时长
              </Text>
              <Pressable
                onPress={() => void stopSleepTimer()}
                disabled={autoSaving}
                style={{
                  paddingVertical: 12, borderRadius: 14,
                  backgroundColor: C_SLEEP, alignItems: 'center',
                }}
              >
                {autoSaving
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={{ color: '#fff', fontSize: 13, fontWeight: 'bold' }}>🌅 起来啦！记录睡眠</Text>
                }
              </Pressable>
            </>
          ) : (
            <>
              <Text style={{ color: C_MUTED, fontSize: 12, textAlign: 'center', marginBottom: 12, lineHeight: 18 }}>
                睡前点击开始，起床后自动计算{'\n'}并写入今日睡眠时长
              </Text>
              <Pressable
                onPress={() => void startSleepTimer()}
                disabled={timerLocked || timeReversed}
                style={{
                  paddingVertical: 12, borderRadius: 14,
                  backgroundColor: (timerLocked || timeReversed) ? '#F5F2EE' : `${C_SLEEP}22`,
                  borderWidth: 1.5, borderColor: (timerLocked || timeReversed) ? '#CCC' : C_SLEEP,
                  alignItems: 'center', opacity: (timerLocked || timeReversed) ? 0.5 : 1,
                }}
              >
                <Text style={{ color: (timerLocked || timeReversed) ? '#AAA' : C_SLEEP, fontSize: 13, fontWeight: 'bold' }}>
                  🌙 开始睡眠
                </Text>
              </Pressable>
            </>
          )}
        </Card>

        {/* 今日记录手动调整（睡眠 + 微调）*/}
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <Text style={{ color: C_MUTED, fontSize: 11 }}>✏️ 今日记录（手动调整）</Text>
            {/* 数据来源标签：显示当前是 manual 还是 timer */}
            {todayRecord?.is_manual_override ? (
              <View style={{ backgroundColor: '#FFF0F4', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 }}>
                <Text style={{ color: C_PINK, fontSize: 10 }}>✏️ 手动</Text>
              </View>
            ) : (todayRecord?.timer_study_minutes ?? 0) + (todayRecord?.timer_slack_minutes ?? 0) > 0 ? (
              <View style={{ backgroundColor: '#F0FFF8', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 }}>
                <Text style={{ color: C_MINT, fontSize: 10 }}>⏱ 计时器</Text>
              </View>
            ) : null}
          </View>
          {/* 计时器数据提示行 */}
          {(todayRecord?.timer_study_minutes ?? 0) + (todayRecord?.timer_slack_minutes ?? 0) > 0 && (
            <View style={{
              backgroundColor: '#F5F9FF',
              borderRadius: 10,
              padding: 8,
              marginBottom: 10,
              flexDirection: 'row',
              gap: 12,
            }}>
              <Text style={{ color: C_MUTED, fontSize: 11 }}>计时器：</Text>
              <Text style={{ color: C_MINT, fontSize: 11 }}>
                学习 {formatMinutes(todayRecord?.timer_study_minutes ?? 0)}
              </Text>
              <Text style={{ color: C_PINK, fontSize: 11 }}>
                摸鱼 {formatMinutes(todayRecord?.timer_slack_minutes ?? 0)}
              </Text>
            </View>
          )}
          <Stepper
            label="学习时间"
            emoji="📚"
            value={studyMin}
            displayValue={formatMinutes(studyMin)}
            onInc={() => {
              setStudyMin(m => {
                const next = m + 15;
                if (next > 1440) { setInputError('一天最多 24 小时哦~'); return m; }
                setInputError(null); return next;
              });
              void Haptics.selectionAsync();
            }}
            onDec={() => { setStudyMin(m => Math.max(0, m - 15)); setInputError(null); void Haptics.selectionAsync(); }}
            accentColor={C_MINT}
          />
          <View style={{ height: 1, backgroundColor: '#F5F0E8', marginBottom: 12 }} />
          <Stepper
            label="摸鱼时间"
            emoji="🐟"
            value={slackMin}
            displayValue={formatMinutes(slackMin)}
            onInc={() => {
              setSlackMin(m => {
                const next = m + 15;
                if (next > 1440) { setInputError('一天最多 24 小时哦~'); return m; }
                setInputError(null); return next;
              });
              void Haptics.selectionAsync();
            }}
            onDec={() => { setSlackMin(m => Math.max(0, m - 15)); setInputError(null); void Haptics.selectionAsync(); }}
            accentColor={slackMin > studyMin ? C_PINK : C_YELLOW}
          />
          <View style={{ height: 1, backgroundColor: '#F5F0E8', marginBottom: 12 }} />
          <Stepper
            label="今日睡眠"
            emoji="😴"
            value={sleepH}
            displayValue={`${sleepH}h`}
            onInc={() => { setSleepH(h => Math.min(24, parseFloat((h + 0.5).toFixed(1)))); void Haptics.selectionAsync(); }}
            onDec={() => { setSleepH(h => Math.max(0, parseFloat((h - 0.5).toFixed(1)))); void Haptics.selectionAsync(); }}
            accentColor={sleepColor}
          />
          {/* 极值错误提示 */}
          {inputError && (
            <Text style={{ color: C_RED, fontSize: 12, marginBottom: 8, textAlign: 'center' }}>
              ⚠️ {inputError}
            </Text>
          )}
          <Pressable
            onPress={handleSavePress}
            disabled={saving}
            style={{
              marginTop: 4, backgroundColor: C_PURPLE,
              borderRadius: 16, paddingVertical: 14, alignItems: 'center',
            }}
          >
            {saving
              ? <ActivityIndicator color="#fff" />
              : <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 14 }}>💾 保存今日记录</Text>
            }
          </Pressable>
        </Card>

        {/* 最近7天 */}
        {recentRecords.length > 0 && (
          <View>
            <Text style={{ color: C_MUTED, fontSize: 11, marginBottom: 8, paddingLeft: 4 }}>
              📅 最近 {recentRecords.length} 天记录
            </Text>
            {recentRecords.map(r => {
              const effStudy = effectiveStudyMinutes(r);
              const effSlack = effectiveSlackMinutes(r);
              const daySlackColor = effSlack > effStudy ? C_PINK : C_YELLOW;
              const daySleepColor = r.sleep_hours < 6 ? C_RED : C_MINT;
              return (
                <View key={r.id} style={{
                  backgroundColor: '#FFFFFF', borderRadius: 14, padding: 12,
                  marginBottom: 6, flexDirection: 'row', alignItems: 'center',
                  justifyContent: 'space-between',
                }}>
                  <View>
                    <Text style={{ color: C_MUTED, fontSize: 12 }}>{r.record_date}</Text>
                    {r.is_manual_override && (
                      <Text style={{ color: C_PINK, fontSize: 9 }}>手动</Text>
                    )}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ alignItems: 'center' }}>
                      <Text style={{ color: C_MINT, fontSize: 12, fontWeight: '600' }}>
                        {formatMinutes(effStudy)}
                      </Text>
                      <Text style={{ color: C_MUTED, fontSize: 9 }}>学习</Text>
                    </View>
                    <View style={{ alignItems: 'center' }}>
                      <Text style={{ color: daySlackColor, fontSize: 12, fontWeight: '600' }}>
                        {formatMinutes(effSlack)}
                      </Text>
                      <Text style={{ color: C_MUTED, fontSize: 9 }}>摸鱼</Text>
                    </View>
                    <View style={{ alignItems: 'center' }}>
                      <Text style={{ color: daySleepColor, fontSize: 12, fontWeight: '600' }}>
                        {r.sleep_hours}h
                      </Text>
                      <Text style={{ color: C_MUTED, fontSize: 9 }}>睡眠</Text>
                    </View>
                    <Pressable
                      onPress={() => setEditRecordTarget(r)}
                      style={{
                        paddingHorizontal: 8,
                        paddingVertical: 5,
                        borderRadius: 8,
                        backgroundColor: '#F3EFE6',
                        borderWidth: 1,
                        borderColor: '#E8E0D0',
                      }}
                    >
                      <Text style={{ fontSize: 11, color: C_PURPLE, fontWeight: '600' }}>✏️ 修正</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* 手动覆盖确认弹窗（替代 Alert.alert） */}
      {showOverrideConfirm && (
        <View style={{
          position: 'absolute', inset: 0,
          backgroundColor: 'rgba(0,0,0,0.45)',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <View style={{
            backgroundColor: '#FFFDF2', borderRadius: 24, padding: 24,
            marginHorizontal: 24, width: '88%',
            boxShadow: [{ offsetX: 0, offsetY: 8, blurRadius: 32, color: 'rgba(0,0,0,0.18)' }],
          }}>
            <Text style={{ fontSize: 22, textAlign: 'center', marginBottom: 8 }}>📝</Text>
            <Text style={{ color: C_TEXT, fontSize: 16, fontWeight: 'bold', textAlign: 'center', marginBottom: 8 }}>
              覆盖计时器记录？
            </Text>
            <Text style={{ color: C_MUTED, fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 20 }}>
              手动输入将覆盖今日计时器记录的数据{'\n'}确定要这样做吗？
            </Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable
                onPress={() => setShowOverrideConfirm(false)}
                style={{
                  flex: 1, borderRadius: 14, paddingVertical: 12,
                  borderWidth: 1.5, borderColor: '#E8E0D0', alignItems: 'center',
                }}
              >
                <Text style={{ color: C_MUTED, fontWeight: '600' }}>取消</Text>
              </Pressable>
              <Pressable
                onPress={() => void doSave()}
                style={{
                  flex: 1, borderRadius: 14, paddingVertical: 12,
                  backgroundColor: C_PURPLE, alignItems: 'center',
                }}
              >
                <Text style={{ color: '#fff', fontWeight: 'bold' }}>确认覆盖</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {/* §3.1 睡眠超 14h 异常弹窗 */}
      <Modal visible={showSleepOverLimit} transparent animationType="fade" onRequestClose={() => void handleSleepOverLimit(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(44,62,80,0.6)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          <View style={{
            backgroundColor: '#FFFDF2', borderRadius: 28, padding: 28, width: '100%',
            boxShadow: [{ offsetX: 0, offsetY: 8, blurRadius: 32, color: 'rgba(44,62,80,0.22)' }],
          }}>
            <Text style={{ fontSize: 40, textAlign: 'center', marginBottom: 8 }}>😴</Text>
            <Text style={{ color: C_SLEEP, fontSize: 17, fontWeight: 'bold', textAlign: 'center', marginBottom: 8 }}>
              睡了超过 14 小时？
            </Text>
            <Text style={{ color: C_MUTED, fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 20 }}>
              麻糬不信哦~ 是否记录为 8 小时？{'\n'}
              <Text style={{ color: C_SLEEP }}>实际已过去 {formatSleepElapsed(sleepOverLimitSecs)}</Text>
            </Text>
            <Pressable
              onPress={() => void handleSleepOverLimit(true)}
              style={{ backgroundColor: C_SLEEP, borderRadius: 16, paddingVertical: 14, alignItems: 'center', marginBottom: 10 }}
            >
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>✅ 记录为 8 小时</Text>
            </Pressable>
            <Pressable
              onPress={() => void handleSleepOverLimit(false)}
              style={{ alignItems: 'center', paddingVertical: 10 }}
            >
              <Text style={{ color: C_MUTED, fontSize: 13 }}>🗑 直接丢弃</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── HC-08 时光倒流警告弹窗（PRD §4.17）──────────────────── */}
      <Modal
        visible={showTimeReverseModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowTimeReverseModal(false)}
      >
        <View style={{
          flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <View style={{
            backgroundColor: '#FFFDF2', borderRadius: 24, padding: 28,
            marginHorizontal: 24, width: '88%',
            boxShadow: [{ offsetX: 0, offsetY: 8, blurRadius: 32, color: 'rgba(214,51,132,0.18)' }],
            borderWidth: 1.5, borderColor: '#FF5E7C',
          }}>
            {/* 标题区 */}
            <Text style={{ fontSize: 40, textAlign: 'center', marginBottom: 8 }}>⏳</Text>
            <Text style={{
              color: '#D63384', fontSize: 18, fontWeight: 'bold',
              textAlign: 'center', marginBottom: 6,
            }}>
              检测到时光倒流！
            </Text>
            <Text style={{
              color: C_TEXT, fontSize: 13, textAlign: 'center',
              lineHeight: 20, marginBottom: 8,
            }}>
              麻糬发现你的系统时间{'\n'}比上次使用 App 时还要早。
            </Text>
            {/* 说明卡片 */}
            <View style={{
              backgroundColor: '#FDE8F0', borderRadius: 14, padding: 14, marginBottom: 20,
            }}>
              <Text style={{ color: '#D63384', fontSize: 12, lineHeight: 19 }}>
                {'🔒  计时器已被暂时封印，停止后的时长不会写入记录。\n\n'}
                {'✅  修复方式：将系统时间恢复正常后，重新进入此页面即可自动解除封印。'}
              </Text>
            </View>
            {/* 关闭按钮 */}
            <Pressable
              onPress={() => setShowTimeReverseModal(false)}
              style={{
                borderRadius: 16, paddingVertical: 13,
                backgroundColor: '#D63384', alignItems: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 15 }}>
                我知道了，去修复时间 →
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* 修正专注与摸鱼记录弹窗 */}
      <EditTimeRecordModal
        visible={!!editRecordTarget}
        record={editRecordTarget}
        onClose={() => setEditRecordTarget(null)}
        onSave={handleSaveRecordCorrection}
        onDelete={handleDeleteRecord}
      />
    </View>
  );
}
