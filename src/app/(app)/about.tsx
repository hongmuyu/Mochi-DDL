/**
 * 关于页面 — 麻糬のDDL
 * §8.1 评分跳转商店 / §8.2 邮件反馈 / §8.3 隐私政策入口
 */
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Device from 'expo-device';
import * as Haptics from 'expo-haptics';
import { getAllTasks, createTask, getTodayRecord, loadCutoffHour, exportAllData } from '@/db/api';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

// §8.1 应用商店链接（替换为实际 ID 后生效）
const APP_STORE_ID = 'YOUR_APP_ID'; // 上架后填入实际 Apple ID
const PLAY_STORE_ID = 'com.yourcompany.mochiddl';

async function openAppStore() {
  if (Platform.OS === 'ios') {
    const url = `itms-apps://itunes.apple.com/app/id${APP_STORE_ID}?action=write-review`;
    const can = await Linking.canOpenURL(url);
    await Linking.openURL(can ? url : `https://apps.apple.com/app/id${APP_STORE_ID}`);
  } else {
    const url = `market://details?id=${PLAY_STORE_ID}`;
    const can = await Linking.canOpenURL(url);
    await Linking.openURL(can ? url : `https://play.google.com/store/apps/details?id=${PLAY_STORE_ID}`);
  }
}

// §8.2 反馈邮件（无邮件客户端时复制地址）
const SUPPORT_EMAIL = 'support@mochiddl.app';

async function sendFeedback(): Promise<boolean> {
  const version = '2.7';
  const model   = Device.modelName ?? '未知设备';
  const os      = `${Platform.OS} ${Device.osVersion ?? ''}`.trim();
  const subject = encodeURIComponent('【麻糬のDDL】问题反馈');
  const body    = encodeURIComponent(
    `App 版本：v${version}\n系统：${os}\n设备：${model}\n\n问题描述：\n（请在此填写）`,
  );
  const mailto = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
  const can = await Linking.canOpenURL(mailto);
  if (can) {
    await Linking.openURL(mailto);
    return true;
  }
  await Clipboard.setStringAsync(SUPPORT_EMAIL);
  return false; // 表示降级（已复制）
}

const C_BG     = '#FFFDF2';
const C_PINK   = '#FF5E7C';
const C_PURPLE = '#6C63FF';
const C_MINT   = '#2EC4B6';
const C_YELLOW = '#FFD166';
const C_TEXT   = '#333333';
const C_MUTED  = '#888888';

const FEATURES = [
  { emoji: '💀', title: 'DDL 倒计时', desc: '精确到秒，实时渲染你的恐惧' },
  { emoji: '🧠', title: '生存状态系统', desc: '理智值·生存指数·发疯浓度全量监控' },
  { emoji: '📸', title: '生存日报卡片', desc: '拍立得风格，记录你的末日档案，支持收藏' },
  { emoji: '🐟', title: '摸鱼驾驶舱', desc: '学习/摸鱼/睡眠计时，数据可视化' },
  { emoji: '💬', title: '自定义语录', desc: '写下你的专属激励，随机出现在首页' },
  { emoji: '🏆', title: '成就系统', desc: '解锁摸鱼大师·刀锋战士等稀有称号' },
  { emoji: '🔔', title: 'DDL 到期提醒', desc: '截止前 6h/1h 自动推送，防止摸鱼过头' },
  { emoji: '📊', title: '数据统计', desc: '今日饼图·本周柱图·累计成就一览' },
  { emoji: '💾', title: '数据备份与恢复', desc: '全量导出 JSON · 换机迁移 · 本地备份' },
  { emoji: '📦', title: '归档删除', desc: '已完成任务无惩罚归档，功德值与成就不受影响' },
];

const CHANGELOG = [
  { ver: 'v2.7', desc: '已完成任务归档删除 · 无惩罚确认弹窗 · 状态机更新' },
  { ver: 'v2.6', desc: '历史卡片沙盒存储 · 30天自动清理 · 收藏机制' },
  { ver: 'v2.5', desc: '左滑删除手势 · 补完成状态机 · 过期任务处理' },
  { ver: 'v2.4', desc: '数据备份与恢复 · 全量 JSON 导出导入 · 换机迁移' },
  { ver: 'v2.3', desc: '自定义日切点 · 鼓点滚轮选择器 · 快捷日期按钮' },
  { ver: 'v2.2', desc: '首页全清彩花动画 · 智能时间显示 · 首页庆祝横幅' },
  { ver: 'v2.1', desc: 'DDL 推送提醒 · 通知权限引导 · 设置页重构' },
  { ver: 'v2.0', desc: '卡片标签页 · 独立统计页 · 自定义语录' },
  { ver: 'v1.0', desc: '首次发布 · 生存状态系统 · 摸鱼驾驶舱 · 成就系统' },
];

export default function AboutScreen() {
  const router = useRouter();

  // §8.2 反馈 Toast
  const [feedbackToast, setFeedbackToast] = useState('');
  const showToast = (msg: string) => {
    setFeedbackToast(msg);
    setTimeout(() => setFeedbackToast(''), 3000);
  };

  const handleRate = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try { await openAppStore(); } catch { showToast('暂时无法打开应用商店，请稍后再试'); }
  };

  const handleFeedback = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const opened = await sendFeedback();
      if (!opened) showToast(`📋 邮箱已复制：${SUPPORT_EMAIL}`);
    } catch { showToast(`📋 邮箱已复制：${SUPPORT_EMAIL}`); }
  };

  // ── Debug 后门：吉祥物连点 10 次进入开发者模式（PRD §10）──────────
  const tapCountRef  = useRef(0);
  const tapTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [devMode,    setDevMode]    = useState(false);
  const [devLog,     setDevLog]     = useState('');
  const [devBusy,    setDevBusy]    = useState(false);
  const [exporting,  setExporting]  = useState(false);

  const handleMascotTap = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    tapCountRef.current += 1;
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    tapTimerRef.current = setTimeout(() => { tapCountRef.current = 0; }, 1500);
    if (tapCountRef.current >= 10) {
      tapCountRef.current = 0;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDevMode(true);
      setDevLog('🛠 开发者模式已激活');
    }
  }, []);

  // ── 快捷导出（关于页入口，SPEC §3.2）────────────────────────────
  const handleQuickExport = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setExporting(true);
    try {
      const json = await exportAllData();
      const fileName = `mochi_ddl_backup_${new Date().toISOString().slice(0, 10)}.json`;
      const filePath = (FileSystem.documentDirectory ?? '') + fileName;
      await FileSystem.writeAsStringAsync(filePath, json, { encoding: FileSystem.EncodingType.UTF8 });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(filePath, {
          mimeType: 'application/json',
          dialogTitle: '保存麻糬 DDL 备份',
          UTI: 'public.json',
        });
      }
    } catch { /* 静默失败，用户取消分享属正常操作 */ }
    finally { setExporting(false); }
  };

  // ── Debug 操作 ──────────────────────────────────────────────────────
  const runDevAction = async (action: string) => {
    setDevBusy(true);
    setDevLog('执行中…');
    try {
      if (action === 'add100') {
        // 一键添加 100 个过期任务
        const now = Date.now();
        for (let i = 1; i <= 100; i++) {
          const expiredTs = new Date(now - i * 3600_000).toISOString();
          await createTask(`测试过期任务 #${i}`, expiredTs, i % 3 + 1);
        }
        setDevLog('✅ 已添加 100 个过期任务');
      } else if (action === 'showRecord') {
        const cutoff = await loadCutoffHour();
        const rec = await getTodayRecord(cutoff);
        setDevLog(rec ? JSON.stringify(rec, null, 2) : '今日暂无记录');
      } else if (action === 'countTasks') {
        const tasks = await getAllTasks();
        const done  = tasks.filter(t => t.completed).length;
        const alive = tasks.filter(t => !t.completed && new Date(t.deadline).getTime() > Date.now()).length;
        const over  = tasks.filter(t => !t.completed && new Date(t.deadline).getTime() <= Date.now()).length;
        setDevLog(`📦 任务总计 ${tasks.length} 条\n✅ 已完成: ${done}\n⏳ 进行中: ${alive}\n💀 已过期: ${over}`);
      } else if (action === 'close') {
        setDevMode(false);
        setDevLog('');
      }
    } catch (e: unknown) {
      setDevLog(`❌ 出错：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDevBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C_BG }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingTop: 56, paddingBottom: 100 }}
      >
        {/* 顶部导航 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 24 }}>
          <Pressable onPress={() => router.back()} style={{ marginRight: 12, padding: 4 }}>
            <Text style={{ color: C_PURPLE, fontSize: 22 }}>‹</Text>
          </Pressable>
          <View>
            <Text style={{ color: C_MUTED, fontSize: 11 }}>应用信息</Text>
            <Text style={{ color: C_PURPLE, fontSize: 22, fontWeight: 'bold' }}>❓ 关于麻糬のDDL</Text>
          </View>
        </View>

        {/* 应用 Logo 区 */}
        <View style={{ alignItems: 'center', marginBottom: 28 }}>
          <View style={{
            width: 90, height: 90, borderRadius: 28,
            backgroundColor: '#FFF0F4',
            alignItems: 'center', justifyContent: 'center',
            borderWidth: 2, borderColor: '#FFD6DF',
            boxShadow: [{ offsetX: 0, offsetY: 6, blurRadius: 20, color: 'rgba(255,94,124,0.20)' }],
            marginBottom: 14,
          }}>
            <Pressable onPress={handleMascotTap} hitSlop={12}>
              <Text style={{ fontSize: 48 }}>🍡</Text>
            </Pressable>
          </View>
          <Text style={{ color: C_PINK, fontSize: 22, fontWeight: 'bold' }}>麻糬のDDL</Text>
          <Text style={{ color: C_MUTED, fontSize: 12, marginTop: 4 }}>v2.7 · 大学生末日生存手册</Text>
          <View style={{
            marginTop: 10, backgroundColor: `${C_PURPLE}15`,
            borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6,
          }}>
            <Text style={{ color: C_PURPLE, fontSize: 12 }}>一个会陪你一起崩溃的 DDL 模拟器 💜</Text>
          </View>
        </View>

        {/* ① 换机风险提示条（SPEC §3.2 顶部）*/}
        <View style={{
          marginHorizontal: 16, marginBottom: 16,
          backgroundColor: '#FFF8E6',
          borderRadius: 14, padding: 14,
          borderWidth: 1.5, borderColor: '#FFD580',
          flexDirection: 'row', alignItems: 'flex-start', gap: 10,
        }}>
          <Text style={{ fontSize: 18, lineHeight: 22 }}>⚠️</Text>
          <Text style={{ flex: 1, color: '#AA7A00', fontSize: 12, lineHeight: 19 }}>
            数据仅存储于本地设备，<Text style={{ fontWeight: '700' }}>换机或卸载后数据将丢失</Text>。{'\n'}
            换机前请务必先导出备份！
          </Text>
        </View>

        {/* ② 数据备份快捷入口卡片（SPEC §3.2 中部）*/}
        <View style={{
          marginHorizontal: 16, marginBottom: 20,
          backgroundColor: '#FFFFFF', borderRadius: 20,
          boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 10, color: 'rgba(0,0,0,0.06)' }],
          overflow: 'hidden',
        }}>
          <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 }}>
            <Text style={{ color: C_TEXT, fontSize: 14, fontWeight: '700' }}>💾 数据备份与恢复</Text>
            <Text style={{ color: C_MUTED, fontSize: 11, marginTop: 3 }}>换机迁移 · 本地备份 · 全量导出</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 10, padding: 14 }}>
            <Pressable
              onPress={() => void handleQuickExport()}
              disabled={exporting}
              style={{
                flex: 1, backgroundColor: C_MINT, borderRadius: 12,
                paddingVertical: 11, alignItems: 'center',
                boxShadow: [{ offsetX: 0, offsetY: 3, blurRadius: 10, color: 'rgba(46,196,182,0.30)' }],
              }}
            >
              {exporting
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>📤 导出数据</Text>
              }
            </Pressable>
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push('/(app)/data-backup');
              }}
              style={{
                flex: 1, backgroundColor: `${C_PURPLE}14`,
                borderRadius: 12, paddingVertical: 11, alignItems: 'center',
                borderWidth: 1.5, borderColor: `${C_PURPLE}40`,
              }}
            >
              <Text style={{ color: C_PURPLE, fontSize: 13, fontWeight: '700' }}>📥 导入数据</Text>
            </Pressable>
          </View>
        </View>

        {/* 功能列表 */}
        <View style={{ paddingHorizontal: 16, marginBottom: 20 }}>
          <Text style={{ color: C_MUTED, fontSize: 11, marginBottom: 10 }}>✨ 核心功能</Text>
          <View style={{
            backgroundColor: '#FFFFFF', borderRadius: 20,
            boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 10, color: 'rgba(0,0,0,0.06)' }],
            overflow: 'hidden',
          }}>
            {FEATURES.map((f, idx) => (
              <View
                key={f.title}
                style={{
                  flexDirection: 'row', alignItems: 'center',
                  paddingVertical: 12, paddingHorizontal: 16, gap: 12,
                  borderBottomWidth: idx < FEATURES.length - 1 ? 1 : 0,
                  borderBottomColor: '#F5F0E8',
                }}
              >
                <View style={{
                  width: 36, height: 36, borderRadius: 10,
                  backgroundColor: '#F5F2EE',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Text style={{ fontSize: 18 }}>{f.emoji}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C_TEXT, fontSize: 13, fontWeight: '600' }}>{f.title}</Text>
                  <Text style={{ color: C_MUTED, fontSize: 11, marginTop: 2 }}>{f.desc}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* 更新日志 */}
        <View style={{ paddingHorizontal: 16, marginBottom: 20 }}>
          <Text style={{ color: C_MUTED, fontSize: 11, marginBottom: 10 }}>📋 更新日志</Text>
          <View style={{
            backgroundColor: '#FFFFFF', borderRadius: 20,
            paddingHorizontal: 16,
            boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 10, color: 'rgba(0,0,0,0.06)' }],
          }}>
            {CHANGELOG.map((log, idx) => (
              <View
                key={log.ver}
                style={{
                  flexDirection: 'row', alignItems: 'flex-start', gap: 12,
                  paddingVertical: 12,
                  borderBottomWidth: idx < CHANGELOG.length - 1 ? 1 : 0,
                  borderBottomColor: '#F5F0E8',
                }}
              >
                <View style={{
                  backgroundColor: idx === 0 ? C_PINK : '#F5F2EE',
                  borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
                  minWidth: 40, alignItems: 'center',
                }}>
                  <Text style={{
                    color: idx === 0 ? '#fff' : C_MUTED,
                    fontSize: 11, fontWeight: '700',
                  }}>
                    {log.ver}
                  </Text>
                </View>
                <Text style={{ flex: 1, color: C_TEXT, fontSize: 12, lineHeight: 18, paddingTop: 2 }}>
                  {log.desc}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* 统计彩蛋卡 */}
        <View style={{
          marginHorizontal: 16, marginBottom: 20,
          backgroundColor: `${C_YELLOW}20`,
          borderRadius: 18, padding: 16,
          borderWidth: 1.5, borderColor: `${C_YELLOW}60`,
        }}>
          <Text style={{ color: '#333', fontSize: 13, fontWeight: '700', marginBottom: 6 }}>🐟 开发者彩蛋</Text>
          <Text style={{ color: '#555', fontSize: 12, lineHeight: 19 }}>
            这个 App 诞生于某个 DDL 在即但就是不想学习的深夜。{'\n'}
            如果它帮你按时交了作业，那真是奇迹。{'\n'}
            如果它让你更理直气壮地摸鱼，那也是一种成功。🍡
          </Text>
        </View>

        {/* §8.1/8.2/8.3 底部操作菜单 */}
        <View style={{
          backgroundColor: '#FFFFFF', borderRadius: 20,
          marginHorizontal: 16, marginBottom: 20,
          paddingHorizontal: 16,
          boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 10, color: 'rgba(0,0,0,0.06)' }],
        }}>
          {/* §8.1 给我们评分 */}
          <Pressable
            onPress={() => void handleRate()}
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F5F0E8', gap: 12 }}
          >
            <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: '#FFF8E0', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 18 }}>⭐</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C_TEXT, fontSize: 14, fontWeight: '600' }}>给我们评分</Text>
              <Text style={{ color: C_MUTED, fontSize: 11, marginTop: 2 }}>跳转应用商店，给麻糬打个分吧 🍡</Text>
            </View>
            <Text style={{ color: C_MUTED, fontSize: 20 }}>›</Text>
          </Pressable>

          {/* §8.2 反馈问题 */}
          <Pressable
            onPress={() => void handleFeedback()}
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F5F0E8', gap: 12 }}
          >
            <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: '#F0EDFF', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 18 }}>✉️</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C_TEXT, fontSize: 14, fontWeight: '600' }}>反馈问题</Text>
              <Text style={{ color: C_MUTED, fontSize: 11, marginTop: 2 }}>唤起邮件，告诉麻糬你遇到的问题</Text>
            </View>
            <Text style={{ color: C_MUTED, fontSize: 20 }}>›</Text>
          </Pressable>

          {/* §8.3 隐私政策 */}
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/(app)/privacy-policy'); }}
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 12 }}
          >
            <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: '#EDFAF7', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 18 }}>🔒</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C_TEXT, fontSize: 14, fontWeight: '600' }}>隐私政策</Text>
              <Text style={{ color: C_MUTED, fontSize: 11, marginTop: 2 }}>数据本地存储，不收集个人信息</Text>
            </View>
            <Text style={{ color: C_MUTED, fontSize: 20 }}>›</Text>
          </Pressable>
        </View>

        {/* 反馈 Toast */}
        {feedbackToast ? (
          <View style={{ marginHorizontal: 16, marginBottom: 12, backgroundColor: '#333', borderRadius: 12, padding: 12 }}>
            <Text style={{ color: '#fff', fontSize: 12, textAlign: 'center' }}>{feedbackToast}</Text>
          </View>
        ) : null}

        {/* ③ 底部备份建议提示（SPEC §3.2 底部）*/}
        <View style={{
          marginHorizontal: 16, marginBottom: 16,
          backgroundColor: `${C_PURPLE}0D`,
          borderRadius: 12, padding: 12,
          borderWidth: 1, borderColor: `${C_PURPLE}25`,
        }}>
          <Text style={{ color: C_PURPLE, fontSize: 11, textAlign: 'center', lineHeight: 18 }}>
            📌 建议定期使用「设置 → 数据备份与恢复」导出备份{'\n'}避免换机时数据丢失 🍡
          </Text>
        </View>

        {/* 底部声明 */}
        <View style={{ alignItems: 'center', paddingHorizontal: 32 }}>
          <Text style={{ color: C_MUTED, fontSize: 10, textAlign: 'center', lineHeight: 16 }}>
            Made with 💜 · 仅用于个人学习与时间管理{'\n'}
            数据全部本地存储，不收集任何个人信息{'\n'}
            © 2025 麻糬研究所 · 保留一切摸鱼权利
          </Text>
        </View>
      </ScrollView>

      {/* ── 开发者模式弹窗（PRD §10 Debug 后门）──────────────────── */}
      <Modal
        visible={devMode}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => runDevAction('close')}
      >
        <View style={{ flex: 1, backgroundColor: '#0D0D1A', padding: 24, paddingTop: 48 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <Text style={{ color: '#00FF88', fontSize: 18, fontWeight: 'bold', fontFamily: 'monospace' }}>
              🛠 Developer Mode
            </Text>
            <Pressable onPress={() => runDevAction('close')} style={{ padding: 8 }}>
              <Text style={{ color: '#666', fontSize: 20 }}>✕</Text>
            </Pressable>
          </View>

          <Text style={{ color: '#556', fontSize: 11, marginBottom: 16 }}>
            ⚠️ 本菜单仅供 QA 测试，生产版本不可见。连点吉祥物 10 次触发。
          </Text>

          {/* 操作按钮 */}
          {[
            { id: 'add100',      label: '💣 一键添加 100 个过期任务', color: '#FF5E7C' },
            { id: 'countTasks',  label: '📦 统计任务数量（分状态）',  color: '#6C63FF' },
            { id: 'showRecord',  label: '📋 查看今日 time_record',    color: '#2EC4B6' },
          ].map(btn => (
            <Pressable
              key={btn.id}
              onPress={() => runDevAction(btn.id)}
              disabled={devBusy}
              style={{
                backgroundColor: `${btn.color}22`,
                borderWidth: 1, borderColor: btn.color,
                borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16,
                marginBottom: 12, opacity: devBusy ? 0.5 : 1,
              }}
            >
              <Text style={{ color: btn.color, fontWeight: '600', fontSize: 13 }}>{btn.label}</Text>
            </Pressable>
          ))}

          {/* 执行日志 */}
          <View style={{
            flex: 1, backgroundColor: '#111122', borderRadius: 12,
            padding: 14, marginTop: 8,
          }}>
            <Text style={{ color: '#888', fontSize: 10, marginBottom: 6 }}>// 执行日志</Text>
            {devBusy
              ? <ActivityIndicator color="#00FF88" />
              : <Text style={{ color: '#00FF88', fontSize: 12, fontFamily: 'monospace', lineHeight: 18 }}>
                  {devLog || '> 等待操作…'}
                </Text>
            }
          </View>
        </View>
      </Modal>
    </View>
  );
}
