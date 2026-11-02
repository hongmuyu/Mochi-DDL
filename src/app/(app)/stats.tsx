/**
 * 数据统计页面
 * 今日：SVG饼图（学习/摸鱼/睡眠）
 * 本周/本月：分组条形图（横向滚动）
 * 累计统计 + 每日明细（含修改窗口期） + 幽默彩蛋
 */
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, { Path, Circle, G } from 'react-native-svg';
import { useFocusEffect, useRouter } from 'expo-router';
import { getRecordsInRange, updateHistoricalRecord, runIncrementalRecalc, getAllTasks, getTotalRawTimerSeconds } from '@/db/api';
import { calcDayFull } from '@/lib/state';
import { TimeRecord, effectiveStudyMinutes, effectiveSlackMinutes } from '@/types/types';

// 配色
const C_BG     = '#FFFDF2';
const C_CARD   = '#FFFFFF';
const C_PINK   = '#FF5E7C';
const C_PURPLE = '#6C63FF';
const C_MINT   = '#2EC4B6';
const C_YELLOW = '#FFD166';
const C_TEXT   = '#333333';
const C_MUTED  = '#999999';
const C_RED    = '#FF003C';

// 指标配色（学习=薄荷绿, 摸鱼=粉红, 睡眠=紫色）
const COLORS = { study: C_MINT, slack: C_PINK, sleep: C_PURPLE };

type RangeKey = 'today' | 'week' | 'month';
const RANGE_LABELS: Record<RangeKey, string> = { today: '日报', week: '本周', month: '本月' };

// ── 工具 ──────────────────────────────────────────────────
function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return toLocalDateStr(date);
}

function formatFullDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const w = weekdays[date.getDay()];
  return `${y}年${m}月${d}日 ${w}`;
}

function getRangeStartEnd(key: RangeKey): { start: string; end: string } {
  const now = new Date();
  const end = toLocalDateStr(now);
  if (key === 'today') return { start: end, end };
  if (key === 'week') {
    const d = new Date(now);
    const day = d.getDay() === 0 ? 6 : d.getDay() - 1;
    d.setDate(d.getDate() - day);
    return { start: toLocalDateStr(d), end };
  }
  // month
  const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  return { start, end };
}

function fmtH(min: number): string {
  const h = min / 60;
  return h % 1 === 0 ? `${h}h` : `${h.toFixed(1)}h`;
}

function fmtDate(s: string): string {
  const [y, m, d] = s.split('-').map(Number);
  return `${m}-${String(d).padStart(2, '0')}`;
}

// ── SVG饼图 ────────────────────────────────────────────────
function PieChart({ studyH, slackH, sleepH }: { studyH: number; slackH: number; sleepH: number }) {
  const total = studyH + slackH + sleepH;
  const size = 180;
  const cx = size / 2;
  const cy = size / 2;
  const R = 70;
  const innerR = 36;

  if (total === 0) {
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={size} height={size}>
          <Circle cx={cx} cy={cy} r={R} fill="#F0EDE0" />
          <Circle cx={cx} cy={cy} r={innerR} fill={C_BG} />
        </Svg>
        <View style={{ position: 'absolute', alignItems: 'center' }}>
          <Text style={{ fontSize: 22 }}>🫙</Text>
        </View>
      </View>
    );
  }

  const slices = [
    { value: studyH, color: COLORS.study },
    { value: slackH, color: COLORS.slack },
    { value: sleepH, color: COLORS.sleep },
  ];

  // 计算路径
  const paths: { d: string; color: string }[] = [];
  let startAngle = -Math.PI / 2;

  for (const slice of slices) {
    if (slice.value === 0) continue;
    const angle = (slice.value / total) * 2 * Math.PI;
    const endAngle = startAngle + angle;
    const x1 = cx + R * Math.cos(startAngle);
    const y1 = cy + R * Math.sin(startAngle);
    const x2 = cx + R * Math.cos(endAngle);
    const y2 = cy + R * Math.sin(endAngle);
    const largeArc = angle > Math.PI ? 1 : 0;
    // 外弧
    const d = [
      `M ${cx} ${cy}`,
      `L ${x1} ${y1}`,
      `A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2}`,
      'Z',
    ].join(' ');
    paths.push({ d, color: slice.color });
    startAngle = endAngle;
  }

  const totalH = total.toFixed(1);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <G>
          {paths.map((p, i) => (
            <Path key={i} d={p.d} fill={p.color} />
          ))}
          {/* 圆环孔 */}
          <Circle cx={cx} cy={cy} r={innerR} fill={C_BG} />
        </G>
      </Svg>
      {/* 中心文字 */}
      <View style={{ position: 'absolute', alignItems: 'center' }}>
        <Text style={{ color: C_TEXT, fontSize: 16, fontWeight: 'bold' }}>{totalH}h</Text>
        <Text style={{ color: C_MUTED, fontSize: 9, marginTop: 1 }}>总计</Text>
      </View>
    </View>
  );
}

// ── 分组条形图（横向滚动，每天3根柱子）──────────────────────
function GroupedBarChart({ records }: { records: TimeRecord[] }) {
  const allVals = records.flatMap(r => [r.study_minutes / 60, r.slack_minutes / 60, r.sleep_hours ?? 0]);
  const maxVal  = Math.max(...allVals, 1);
  const BAR_H   = 100;
  const GROUP_W = 64;

  if (!records.length) return null;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 4 }}>
      {records.map(r => {
        const studyH = r.study_minutes / 60;
        const slackH = r.slack_minutes / 60;
        const sleepH = r.sleep_hours ?? 0;
        const isToday = r.record_date === toLocalDateStr(new Date());
        return (
          <View key={r.record_date} style={{ width: GROUP_W, alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: BAR_H, gap: 3 }}>
              {[
                { val: studyH, color: COLORS.study },
                { val: slackH, color: COLORS.slack },
                { val: sleepH, color: COLORS.sleep },
              ].map((bar, bi) => {
                const bh = Math.max(3, (bar.val / maxVal) * BAR_H);
                return (
                  <View key={bi} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end' }}>
                    <View style={{
                      width: '100%', height: bh, borderRadius: 4,
                      backgroundColor: isToday ? bar.color : `${bar.color}99`,
                    }} />
                  </View>
                );
              })}
            </View>
            <Text style={{
              color: isToday ? C_PURPLE : C_MUTED,
              fontSize: 9, marginTop: 4,
              fontWeight: isToday ? '700' : '400',
            }}>
              {fmtDate(r.record_date)}
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

// ── 幽默彩蛋文案 ────────────────────────────────────────────
const HUMOR_LINES = [
  '你的摸鱼时间可以写一本《论持久战》了',
  '学习时间已足够再读一个证书，加油！（大概）',
  '你的平均睡眠证明你还是个有盼头的人',
  '数据告诉我，你是个努力活着的大学生',
  '如果把摸鱼时间算工资，你早就财务自由了',
];
function getHumor(idx: number) { return HUMOR_LINES[idx % HUMOR_LINES.length]; }

// ── 主页面 ────────────────────────────────────────────────
// ── 修改窗口期 ──────────────────────────────────────────
type EditWindow = 'hot' | 'cold' | 'frozen';

function getEditWindow(recordDate: string): { window: EditWindow; daysAgo: number } {
  const now = new Date();
  const rec = new Date(recordDate + 'T00:00:00');
  const daysAgo = Math.floor((now.getTime() - rec.getTime()) / (1000 * 60 * 60 * 24));
  if (daysAgo <= 7) return { window: 'hot', daysAgo };
  if (daysAgo <= 30) return { window: 'cold', daysAgo };
  return { window: 'frozen', daysAgo };
}

// ── 今日日期字符串 ─────────────────────────────────────
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── 历史归档日期选择器弹窗 ─────────────────────────────────
function DatePickerModal({
  visible,
  currentDate,
  availableDates,
  onClose,
  onSelectDate,
}: {
  visible: boolean;
  currentDate: string;
  availableDates: string[];
  onClose: () => void;
  onSelectDate: (date: string) => void;
}) {
  if (!visible) return null;
  const today = toLocalDateStr(new Date());

  // 过去30天日期
  const past30Days: string[] = [];
  for (let i = 0; i < 30; i++) {
    past30Days.push(addDays(today, -i));
  }

  const recordDateSet = new Set(availableDates);

  return (
    <View style={{
      position: 'absolute', inset: 0,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center', justifyContent: 'center',
      zIndex: 110,
    }}>
      <View style={{
        backgroundColor: '#FFFDF2', borderRadius: 24, padding: 20,
        width: '90%', maxHeight: '75%',
        borderWidth: 2, borderColor: '#2D2A26',
        boxShadow: [{ offsetX: 3, offsetY: 3, blurRadius: 0, color: '#2D2A26' }],
      }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <View>
            <Text style={{ color: C_PURPLE, fontSize: 16, fontWeight: 'bold' }}>
              📅 历史日报归档翻阅
            </Text>
            <Text style={{ color: C_MUTED, fontSize: 11, marginTop: 2 }}>
              选择过去30天内任意日期快速查阅
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#EFECE6', alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ color: '#666', fontSize: 14, fontWeight: 'bold' }}>✕</Text>
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} style={{ marginVertical: 6 }}>
          <View style={{ gap: 6 }}>
            {past30Days.map(d => {
              const isSelected = d === currentDate;
              const isToday = d === today;
              const hasRec = recordDateSet.has(d);
              return (
                <Pressable
                  key={d}
                  onPress={() => onSelectDate(d)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    borderRadius: 12,
                    borderWidth: 1.5,
                    borderColor: isSelected ? C_PURPLE : isToday ? C_PINK : '#E8E5DD',
                    backgroundColor: isSelected ? `${C_PURPLE}15` : isToday ? '#FFF5F7' : '#FFFFFF',
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{
                      fontSize: 13,
                      fontWeight: isSelected || isToday ? '700' : '500',
                      color: isSelected ? C_PURPLE : C_TEXT,
                    }}>
                      {formatFullDate(d)}
                    </Text>
                    {isToday && (
                      <View style={{ backgroundColor: C_PINK, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1.5 }}>
                        <Text style={{ color: '#fff', fontSize: 9, fontWeight: 'bold' }}>今日</Text>
                      </View>
                    )}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {hasRec ? (
                      <View style={{ backgroundColor: `${C_MINT}20`, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ color: C_MINT, fontSize: 10, fontWeight: 'bold' }}>有记录 📝</Text>
                      </View>
                    ) : (
                      <Text style={{ color: '#BBB', fontSize: 10 }}>无记录</Text>
                    )}
                    {isSelected && (
                      <Text style={{ color: C_PURPLE, fontSize: 14, fontWeight: 'bold' }}>✓</Text>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>

        <Pressable
          onPress={() => onSelectDate(today)}
          style={{
            marginTop: 10,
            backgroundColor: C_PURPLE,
            borderRadius: 14,
            paddingVertical: 11,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: 'bold' }}>
            快速回到今日日报
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── 编辑弹窗 ──────────────────────────────────────────────
function EditModal({
  record,
  visible,
  onClose,
  onSaved,
}: {
  record: TimeRecord | null;
  visible: boolean;
  onClose: () => void;
  onSaved: (fromDate: string) => void;
}) {
  const [studyH, setStudyH] = useState('');
  const [slackH, setSlackH] = useState('');
  const [sleepH, setSleepH] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmCold, setConfirmCold] = useState(false);

  // 每次打开时初始化输入值
  const initValues = useCallback(() => {
    if (!record) return;
    setStudyH(String((effectiveStudyMinutes(record) / 60).toFixed(1)));
    setSlackH(String((effectiveSlackMinutes(record) / 60).toFixed(1)));
    setSleepH(String(record.sleep_hours ?? 0));
    setConfirmCold(false);
  }, [record]);

  // visible 变化时初始化
  useState(() => { if (visible) initValues(); });

  if (!visible || !record) return null;

  const { window: editWindow } = getEditWindow(record.record_date);

  const doSave = async () => {
    setSaving(true);
    try {
      await updateHistoricalRecord(record.id, {
        study_minutes: Math.min(Math.round(parseFloat(studyH || '0') * 60), 1440),
        slack_minutes: Math.min(Math.round(parseFloat(slackH || '0') * 60), 1440),
        sleep_hours: Math.min(parseFloat(sleepH || '0'), 24),
      });
      onSaved(record.record_date);
      onClose();
    } catch { /* 静默 */ } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{
      position: 'absolute', inset: 0,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center', justifyContent: 'center',
      zIndex: 100,
    }}>
      <View style={{
        backgroundColor: '#FFFDF2', borderRadius: 24, padding: 22,
        width: '90%',
        boxShadow: [{ offsetX: 0, offsetY: 8, blurRadius: 32, color: 'rgba(0,0,0,0.18)' }],
      }}>
        <Text style={{ color: C_PURPLE, fontSize: 16, fontWeight: 'bold', marginBottom: 4 }}>
          ✏️ 修改历史数据
        </Text>
        <Text style={{ color: C_MUTED, fontSize: 12, marginBottom: 16 }}>
          {fmtDate(record.record_date)}
        </Text>

        {/* 冷数据二次确认 */}
        {editWindow === 'cold' && !confirmCold && (
          <View style={{
            backgroundColor: '#FFF8E0', borderRadius: 12, padding: 12,
            borderWidth: 1, borderColor: C_YELLOW, marginBottom: 14,
          }}>
            <Text style={{ color: '#AA7A00', fontSize: 12, lineHeight: 18, marginBottom: 10 }}>
              ⚠️ 修改较早的数据可能导致历史精神状态变化，确定要继续吗？
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable
                onPress={onClose}
                style={{ flex: 1, borderRadius: 10, paddingVertical: 9, borderWidth: 1, borderColor: '#DDD', alignItems: 'center' }}
              >
                <Text style={{ color: C_MUTED, fontSize: 13 }}>取消</Text>
              </Pressable>
              <Pressable
                onPress={() => setConfirmCold(true)}
                style={{ flex: 1, borderRadius: 10, paddingVertical: 9, backgroundColor: C_YELLOW, alignItems: 'center' }}
              >
                <Text style={{ color: '#333', fontSize: 13, fontWeight: '700' }}>继续修改</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* 输入区（确认后或热点数据直接显示） */}
        {(editWindow === 'hot' || confirmCold) && (
          <>
            {[
              { label: '📚 学习（小时）', val: studyH, set: setStudyH },
              { label: '🐟 摸鱼（小时）', val: slackH, set: setSlackH },
              { label: '😴 睡眠（小时）', val: sleepH, set: setSleepH },
            ].map(({ label, val, set }) => (
              <View key={label} style={{ marginBottom: 12 }}>
                <Text style={{ color: C_MUTED, fontSize: 12, marginBottom: 4 }}>{label}</Text>
                <TextInput
                  value={val}
                  onChangeText={set}
                  keyboardType="decimal-pad"
                  style={{
                    backgroundColor: '#F5F2EE', borderRadius: 10,
                    paddingHorizontal: 14, paddingVertical: 10,
                    color: C_TEXT, fontSize: 15,
                  }}
                  maxLength={5}
                  placeholder="0.0"
                  placeholderTextColor={C_MUTED}
                />
              </View>
            ))}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              <Pressable
                onPress={onClose}
                style={{ flex: 1, borderRadius: 14, paddingVertical: 12, borderWidth: 1.5, borderColor: '#E8E0D0', alignItems: 'center' }}
              >
                <Text style={{ color: C_MUTED, fontWeight: '600' }}>取消</Text>
              </Pressable>
              <Pressable
                onPress={() => void doSave()}
                disabled={saving}
                style={{ flex: 1, borderRadius: 14, paddingVertical: 12, backgroundColor: C_PURPLE, alignItems: 'center' }}
              >
                {saving ? <ActivityIndicator color="#fff" size="small" /> : (
                  <Text style={{ color: '#fff', fontWeight: 'bold' }}>保存</Text>
                )}
              </Pressable>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

export default function StatsScreen() {
  const router       = useRouter();
  const todayStrDate = toLocalDateStr(new Date());
  const [range, setRange]               = useState<RangeKey>('today');
  const [selectedDate, setSelectedDate] = useState<string>(todayStrDate);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [records, setRecords]           = useState<TimeRecord[]>([]);
  const [allRecords, setAllRecords]     = useState<TimeRecord[]>([]);
  const [loading, setLoading]           = useState(true);
  const [editRecord, setEditRecord]     = useState<TimeRecord | null>(null);
  const [showEdit, setShowEdit]         = useState(false);
  const [recalcMsg, setRecalcMsg]       = useState('');
  const [rawTimerSecs, setRawTimerSecs] = useState<{ studySecs: number; slackSecs: number } | null>(null);

  const loadData = useCallback(async (r: RangeKey) => {
    setLoading(true);
    try {
      const { start, end } = getRangeStartEnd(r);
      const [cur, all, raw] = await Promise.all([
        getRecordsInRange(start, end),
        getRecordsInRange('2020-01-01', toLocalDateStr(new Date())),
        getTotalRawTimerSeconds(),
      ]);
      setRecords(cur);
      setAllRecords(all);
      setRawTimerSecs(raw);
    } catch { }
    finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { loadData(range); }, [loadData, range]));

  const handleRange = (r: RangeKey) => { setRange(r); loadData(r); };

  // 选定日期的归档数据（若有匹配则取，否则为 null）
  const selectedDateRec = useMemo(() => {
    return allRecords.find(r => r.record_date === selectedDate) ?? null;
  }, [allRecords, selectedDate]);

  const isViewingToday = selectedDate === todayStrDate;
  const canGoNextDay   = selectedDate < todayStrDate;

  // 翻阅操作
  const handlePrevDay = () => {
    setSelectedDate(prev => addDays(prev, -1));
  };

  const handleNextDay = () => {
    if (!canGoNextDay) return;
    setSelectedDate(prev => {
      const next = addDays(prev, 1);
      return next > todayStrDate ? todayStrDate : next;
    });
  };

  const handleBackToToday = () => {
    setSelectedDate(todayStrDate);
  };

  const handleSelectDate = (date: string) => {
    if (date > todayStrDate) return;
    setSelectedDate(date);
    setShowDatePicker(false);
  };

  // 保存后触发增量重算（PRD 4.23）
  const handleSaved = useCallback(async (fromDate: string) => {
    void loadData(range);
    setRecalcMsg('⚙️ 正在重算历史精神状态…');
    try {
      const tasks = await getAllTasks();
      await runIncrementalRecalc(fromDate, todayStr(), (record, allTasks, prevWear, sleeplessDays) =>
        calcDayFull(record, tasks.length > 0 ? tasks : allTasks, prevWear, sleeplessDays)
      );
      setRecalcMsg('✅ 历史数据已重算完成');
    } catch {
      setRecalcMsg('');
    }
    setTimeout(() => setRecalcMsg(''), 2800);
  }, [range, loadData]);

  const handleRowPress = (rec: TimeRecord) => {
    const { window: w } = getEditWindow(rec.record_date);
    if (w === 'frozen') return; // 冻结数据不响应点击
    setEditRecord(rec);
    setShowEdit(true);
  };

  // 查看指定日期的归档日报
  const handleViewDayReport = (dateStr: string) => {
    setSelectedDate(dateStr);
    setRange('today');
  };

  // 日报数据（根据当前选定日期动态提取）
  const studyH = selectedDateRec ? +(effectiveStudyMinutes(selectedDateRec) / 60).toFixed(1) : 0;
  const slackH = selectedDateRec ? +(effectiveSlackMinutes(selectedDateRec) / 60).toFixed(1) : 0;
  const sleepH = selectedDateRec?.sleep_hours ?? 0;

  // 累计统计
  const cumStudyH  = Math.round(allRecords.reduce((s, r) => s + r.study_minutes, 0) / 60 * 10) / 10;
  const cumSlackH  = Math.round(allRecords.reduce((s, r) => s + r.slack_minutes, 0) / 60 * 10) / 10;
  const cumAvgSleep = allRecords.length
    ? Math.round(allRecords.reduce((s, r) => s + (r.sleep_hours ?? 0), 0) / allRecords.length * 10) / 10
    : 0;
  const totalDays = allRecords.length;

  const hasData = records.length > 0;

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: C_BG, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 40 }}>📊</Text>
        <ActivityIndicator color={C_PURPLE} style={{ marginTop: 12 }} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C_BG }}>
      {/* 历史归档日期选择弹窗 */}
      <DatePickerModal
        visible={showDatePicker}
        currentDate={selectedDate}
        availableDates={allRecords.map(r => r.record_date)}
        onClose={() => setShowDatePicker(false)}
        onSelectDate={handleSelectDate}
      />
      {/* 编辑弹窗（绝对定位浮层） */}
      <EditModal
        record={editRecord}
        visible={showEdit}
        onClose={() => setShowEdit(false)}
        onSaved={handleSaved}
      />
      {/* 增量重算提示条（PRD 4.23） */}
      {recalcMsg ? (
        <View style={{
          position: 'absolute', top: 54, left: 16, right: 16, zIndex: 20,
          backgroundColor: C_PURPLE, borderRadius: 14, padding: 12,
          alignItems: 'center',
        }}>
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>{recalcMsg}</Text>
        </View>
      ) : null}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingTop: 56, paddingBottom: 100 }}
      >
        {/* 顶部导航 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 20 }}>
          <Pressable
            onPress={() => router.back()}
            style={{
              width: 36, height: 36, borderRadius: 18, backgroundColor: C_CARD,
              alignItems: 'center', justifyContent: 'center',
              boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 8, color: 'rgba(0,0,0,0.08)' }],
              marginRight: 12,
            }}
          >
            <Text style={{ fontSize: 18, color: C_TEXT }}>‹</Text>
          </Pressable>
          <View>
            <Text style={{ color: C_MUTED, fontSize: 11 }}>你的黑历史</Text>
            <Text style={{ color: C_PURPLE, fontSize: 22, fontWeight: 'bold' }}>📊 数据统计</Text>
          </View>
        </View>

        {/* 时间范围选择器 */}
        <View style={{
          flexDirection: 'row', marginHorizontal: 16, marginBottom: 18,
          backgroundColor: C_CARD, borderRadius: 16, padding: 4,
          boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 8, color: 'rgba(0,0,0,0.06)' }],
        }}>
          {(Object.keys(RANGE_LABELS) as RangeKey[]).map(key => (
            <Pressable
              key={key}
              onPress={() => handleRange(key)}
              style={{
                flex: 1, paddingVertical: 9, borderRadius: 12, alignItems: 'center',
                backgroundColor: range === key ? C_PURPLE : 'transparent',
              }}
            >
              <Text style={{
                color: range === key ? '#fff' : C_MUTED,
                fontSize: 13, fontWeight: range === key ? '700' : '400',
              }}>
                {RANGE_LABELS[key]}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* ── 日报 / 趋势模式 ── */}
        {range === 'today' ? (
          // ── 日报与历史归档翻阅模式 ──
          <>
            {/* 历史归档翻阅手账控制栏 */}
            <View style={{
              backgroundColor: C_CARD,
              borderRadius: 18,
              marginHorizontal: 16,
              marginBottom: 14,
              padding: 12,
              borderWidth: 1.5,
              borderColor: '#E8E4DA',
              boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 8, color: 'rgba(0,0,0,0.06)' }],
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                {/* 前一日按钮 */}
                <Pressable
                  onPress={handlePrevDay}
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 12,
                    backgroundColor: '#F5F2EA',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: '#DDD9D0',
                  }}
                >
                  <Text style={{ fontSize: 20, color: C_TEXT, fontWeight: 'bold' }}>‹</Text>
                </Pressable>

                {/* 当前日期展示（点击打开日期归档选择器） */}
                <Pressable
                  onPress={() => setShowDatePicker(true)}
                  style={{ flex: 1, alignItems: 'center', marginHorizontal: 8, paddingVertical: 4 }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ color: C_TEXT, fontSize: 15, fontWeight: 'bold' }}>
                      {formatFullDate(selectedDate)}
                    </Text>
                    <Text style={{ fontSize: 13 }}>▾</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    {isViewingToday ? (
                      <View style={{ backgroundColor: `${C_PINK}18`, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}>
                        <Text style={{ color: C_PINK, fontSize: 10, fontWeight: '700' }}>今日日报</Text>
                      </View>
                    ) : (
                      <View style={{ backgroundColor: `${C_PURPLE}18`, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}>
                        <Text style={{ color: C_PURPLE, fontSize: 10, fontWeight: '700' }}>历史归档</Text>
                      </View>
                    )}
                    <Text style={{ color: C_MUTED, fontSize: 10 }}>轻触切换日期</Text>
                  </View>
                </Pressable>

                {/* 快捷回到今天或后一日按钮 */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {!isViewingToday && (
                    <Pressable
                      onPress={handleBackToToday}
                      style={{
                        paddingHorizontal: 8,
                        paddingVertical: 8,
                        borderRadius: 10,
                        backgroundColor: `${C_PURPLE}15`,
                        borderWidth: 1,
                        borderColor: C_PURPLE,
                      }}
                    >
                      <Text style={{ color: C_PURPLE, fontSize: 11, fontWeight: 'bold' }}>今</Text>
                    </Pressable>
                  )}
                  <Pressable
                    onPress={handleNextDay}
                    disabled={!canGoNextDay}
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 12,
                      backgroundColor: canGoNextDay ? '#F5F2EA' : '#FAF8F5',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: 1,
                      borderColor: canGoNextDay ? '#DDD9D0' : '#EFECE6',
                      opacity: canGoNextDay ? 1 : 0.4,
                    }}
                  >
                    <Text style={{ fontSize: 20, color: canGoNextDay ? C_TEXT : '#BBB', fontWeight: 'bold' }}>›</Text>
                  </Pressable>
                </View>
              </View>
            </View>

            {/* 日报时间分布卡片 */}
            <View style={{
              backgroundColor: C_CARD, borderRadius: 20, marginHorizontal: 16,
              padding: 20, marginBottom: 14,
              boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 12, color: 'rgba(0,0,0,0.07)' }],
            }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <Text style={{ color: C_MUTED, fontSize: 12, fontWeight: '600' }}>
                  {isViewingToday ? '今日' : fmtDate(selectedDate)} 时间分布
                </Text>
                {!isViewingToday && (
                  <Text style={{ color: C_PURPLE, fontSize: 11, fontWeight: '600' }}>
                    归档快照
                  </Text>
                )}
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 20 }}>
                {/* 饼图 */}
                <PieChart studyH={studyH} slackH={slackH} sleepH={sleepH} />
                {/* 图例 */}
                <View style={{ gap: 12, flex: 1 }}>
                  {[
                    { label: '学习', val: studyH, color: COLORS.study, emoji: '📚' },
                    { label: '摸鱼', val: slackH, color: COLORS.slack, emoji: '🐟' },
                    { label: '睡眠', val: sleepH, color: COLORS.sleep, emoji: '😴' },
                  ].map(item => (
                    <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: item.color }} />
                      <Text style={{ color: C_MUTED, fontSize: 12, flex: 1 }}>{item.emoji} {item.label}</Text>
                      <Text style={{ color: item.color, fontSize: 14, fontWeight: 'bold' }}>{item.val}h</Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>

            {/* 日报幽默评价 / 空状态 */}
            <View style={{
              marginHorizontal: 16, marginBottom: 14,
              backgroundColor: `${C_PURPLE}12`,
              borderRadius: 14, padding: 12,
              borderLeftWidth: 3, borderLeftColor: C_PURPLE,
            }}>
              <Text style={{ color: C_PURPLE, fontSize: 12, lineHeight: 18 }}>
                {studyH === 0 && slackH === 0 && sleepH === 0
                  ? (isViewingToday
                    ? '今天还没有任何记录，先去摸鱼页面填一下数据吧~'
                    : '该历史日期暂无专注与摸鱼记录，当时可能在专心生活~ 🌿')
                  : slackH > studyH
                  ? `🐟 摸鱼 ${slackH}h > 学习 ${studyH}h，这一天的主业是摸鱼吧？`
                  : studyH > 3
                  ? `📚 学习 ${studyH}h！这天的你是「战士」，好评！`
                  : `当日学了 ${studyH}h，摸了 ${slackH}h，睡了 ${sleepH}h 🫡`
                }
              </Text>
            </View>
          </>
        ) : !hasData ? (
          <View style={{ alignItems: 'center', paddingTop: 32, paddingHorizontal: 32 }}>
            <Text style={{ fontSize: 72 }}>🍡</Text>
            <Text style={{ color: C_TEXT, fontSize: 16, fontWeight: 'bold', marginTop: 16, textAlign: 'center' }}>
              暂无趋势数据
            </Text>
            <Text style={{ color: C_MUTED, fontSize: 13, textAlign: 'center', marginTop: 8, lineHeight: 20 }}>
              先去摸鱼页面记一笔吧~{'\n'}数据是检验躺平的唯一标准 📝
            </Text>
          </View>
        ) : (
          // ── 本周/本月 分组条形图模式 ──
          <>
            <View style={{
              backgroundColor: C_CARD, borderRadius: 20, marginHorizontal: 16,
              padding: 16, marginBottom: 14,
              boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 12, color: 'rgba(0,0,0,0.07)' }],
            }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <Text style={{ color: C_TEXT, fontSize: 13, fontWeight: '600' }}>
                  {range === 'week' ? '本周' : '本月'}趋势
                </Text>
                {/* 图例 */}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  {[{ label: '学', color: COLORS.study }, { label: '鱼', color: COLORS.slack }, { label: '睡', color: COLORS.sleep }].map(l => (
                    <View key={l.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: l.color }} />
                      <Text style={{ color: C_MUTED, fontSize: 10 }}>{l.label}</Text>
                    </View>
                  ))}
                </View>
              </View>
              <GroupedBarChart records={records} />
            </View>
          </>
        )}

        {/* ── 累计统计卡片 ── */}
        {totalDays > 0 && (
          <View style={{
            backgroundColor: C_CARD, borderRadius: 20, marginHorizontal: 16,
            padding: 16, marginBottom: 14,
            boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 12, color: 'rgba(0,0,0,0.07)' }],
          }}>
            <Text style={{ color: C_MUTED, fontSize: 12, fontWeight: '600', marginBottom: 12 }}>🌐 累计统计</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {[
                { label: '总学习', val: `${cumStudyH}h`, color: COLORS.study, emoji: '📚' },
                { label: '总摸鱼', val: `${cumSlackH}h`, color: COLORS.slack, emoji: '🐟' },
                { label: '均睡眠', val: `${cumAvgSleep}h`, color: COLORS.sleep, emoji: '😴' },
                { label: '记录天数', val: `${totalDays}天`, color: C_YELLOW, emoji: '📅' },
              ].map(item => (
                <View key={item.label} style={{
                  width: '47%', backgroundColor: `${item.color}12`,
                  borderRadius: 14, padding: 12, alignItems: 'center',
                }}>
                  <Text style={{ fontSize: 20 }}>{item.emoji}</Text>
                  <Text style={{ color: item.color, fontSize: 18, fontWeight: 'bold', marginTop: 4 }}>{item.val}</Text>
                  <Text style={{ color: C_MUTED, fontSize: 10, marginTop: 2 }}>{item.label}</Text>
                </View>
              ))}
            </View>
            {/* 幽默彩蛋 */}
            <View style={{
              marginTop: 12, backgroundColor: '#FFF8E7', borderRadius: 10,
              borderLeftWidth: 3, borderLeftColor: C_YELLOW, padding: 10,
            }}>
              <Text style={{ color: '#666', fontSize: 11, lineHeight: 17, fontStyle: 'italic' }}>
                🐟 {getHumor(totalDays)}
              </Text>
            </View>
            {/* PRD §3.8.5 彩蛋：原始未截断 timer_sessions 总时长 */}
            {rawTimerSecs && (rawTimerSecs.studySecs > 0 || rawTimerSecs.slackSecs > 0) && (
              <View style={{
                marginTop: 8, backgroundColor: '#F0EDFF', borderRadius: 10,
                borderLeftWidth: 3, borderLeftColor: C_PURPLE, padding: 10,
              }}>
                <Text style={{ color: C_PURPLE, fontSize: 11, fontWeight: '700', marginBottom: 3 }}>
                  🔬 麻糬的秘密档案（原始未截断数据）
                </Text>
                <Text style={{ color: '#555', fontSize: 11, lineHeight: 17 }}>
                  你的计时器累计运行了{' '}
                  <Text style={{ fontWeight: 'bold', color: COLORS.study }}>
                    {(rawTimerSecs.studySecs / 3600).toFixed(1)}h 学习
                  </Text>
                  {' '}和{' '}
                  <Text style={{ fontWeight: 'bold', color: COLORS.slack }}>
                    {(rawTimerSecs.slackSecs / 3600).toFixed(1)}h 摸鱼
                  </Text>
                  ，比你以为的还要……诚实。
                </Text>
              </View>
            )}
          </View>
        )}

        {/* ── 每日明细列表（最近30天，降序，含修改窗口期） ── */}
        {allRecords.length > 0 && (
          <View style={{
            backgroundColor: C_CARD, borderRadius: 20, marginHorizontal: 16,
            padding: 16,
            boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 12, color: 'rgba(0,0,0,0.07)' }],
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
              <Text style={{ color: C_PURPLE, fontSize: 14, fontWeight: 'bold', flex: 1 }}>
                📅 每日明细
              </Text>
              <Text style={{ color: C_MUTED, fontSize: 10 }}>点击行可修改 7 天内数据</Text>
            </View>
            {/* 图例说明 */}
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
              {[
                { label: '7天内可修改', color: C_MINT },
                { label: '30天内需确认', color: C_YELLOW },
                { label: '已冻结', color: '#CCCCCC' },
              ].map(({ label, color }) => (
                <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
                  <Text style={{ color: C_MUTED, fontSize: 10 }}>{label}</Text>
                </View>
              ))}
            </View>
            {/* 表头 */}
            <View style={{ flexDirection: 'row', paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#F0EDE0', marginBottom: 4 }}>
              <Text style={{ flex: 2.2, color: C_MUTED, fontSize: 11 }}>日期</Text>
              <Text style={{ flex: 1.4, color: COLORS.study, fontSize: 11, textAlign: 'center' }}>📚学习</Text>
              <Text style={{ flex: 1.4, color: COLORS.slack, fontSize: 11, textAlign: 'center' }}>🐟摸鱼</Text>
              <Text style={{ flex: 1.2, color: COLORS.sleep, fontSize: 11, textAlign: 'center' }}>😴睡眠</Text>
              <Text style={{ flex: 0.5, color: C_MUTED, fontSize: 11, textAlign: 'center' }}> </Text>
            </View>
            {/* 最近30天，按降序 */}
            {[...allRecords].reverse().slice(0, 30).map((r, idx, arr) => {
              const isToday = r.record_date === todayStrDate;
              const isSelectedInReport = r.record_date === selectedDate;
              const { window: editW } = getEditWindow(r.record_date);
              const isFrozen = editW === 'frozen';
              const isCold   = editW === 'cold';
              const isHot    = editW === 'hot';

              // 行左侧的窗口期彩条颜色
              const dotColor = isFrozen ? '#CCCCCC' : isCold ? C_YELLOW : C_MINT;

              return (
                <View
                  key={r.record_date}
                  style={{
                    flexDirection: 'row', alignItems: 'center',
                    paddingVertical: 9,
                    borderBottomWidth: idx < arr.length - 1 ? 1 : 0,
                    borderBottomColor: '#F5F2EE',
                    backgroundColor: isSelectedInReport ? `${C_PURPLE}12` : isToday ? `${C_PURPLE}08` : 'transparent',
                    borderRadius: isSelectedInReport || isToday ? 8 : 0,
                    paddingHorizontal: 2,
                    opacity: isFrozen ? 0.7 : 1,
                  }}
                >
                  {/* 窗口期彩点 */}
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dotColor, marginRight: 6 }} />
                  {/* 日期区域：点击可快速翻阅至该日期的日报 */}
                  <Pressable
                    onPress={() => handleViewDayReport(r.record_date)}
                    style={{ flex: 2.2 }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Text style={{
                        color: isSelectedInReport ? C_PURPLE : isToday ? C_PURPLE : isFrozen ? C_MUTED : C_TEXT,
                        fontSize: 12,
                        fontWeight: isSelectedInReport || isToday ? '700' : '500',
                      }}>
                        {fmtDate(r.record_date)}{isToday ? ' 今' : ''}
                      </Text>
                      <Text style={{ color: C_PURPLE, fontSize: 10 }}>↗</Text>
                    </View>
                    {isFrozen && (
                      <Text style={{ color: C_MUTED, fontSize: 9, marginTop: 1 }}>已冻结</Text>
                    )}
                  </Pressable>
                  <Text style={{ flex: 1.4, color: isHot ? COLORS.study : C_MUTED, fontSize: 12, fontWeight: '600', textAlign: 'center' }}>
                    {fmtH(effectiveStudyMinutes(r))}
                  </Text>
                  <Text style={{ flex: 1.4, color: isFrozen ? C_MUTED : (effectiveSlackMinutes(r) > effectiveStudyMinutes(r) ? C_PINK : COLORS.slack), fontSize: 12, fontWeight: '600', textAlign: 'center' }}>
                    {fmtH(effectiveSlackMinutes(r))}
                  </Text>
                  <Text style={{ flex: 1.2, color: isFrozen ? C_MUTED : ((r.sleep_hours ?? 0) < 6 ? C_RED : COLORS.sleep), fontSize: 12, fontWeight: '600', textAlign: 'center' }}>
                    {r.sleep_hours ?? 0}h
                  </Text>
                  {/* 修改按钮（可编辑时点击弹窗） */}
                  <Pressable
                    onPress={() => handleRowPress(r)}
                    style={{ flex: 0.5, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Text style={{ color: isFrozen ? '#DDDDDD' : isCold ? C_YELLOW : C_MINT, fontSize: 13, textAlign: 'center' }}>
                      {isFrozen ? '🔒' : '✏️'}
                    </Text>
                  </Pressable>
                </View>
              );
            })}

            {/* 冻结说明脚注 */}
            <View style={{ marginTop: 10, padding: 10, backgroundColor: '#F8F5F0', borderRadius: 10 }}>
              <Text style={{ color: C_MUTED, fontSize: 11, lineHeight: 16 }}>
                🔒 30天以上的数据已冻结 —— 太久远啦，麻糬记不清了~
              </Text>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
