import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useFocusEffect, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { getAllTasks, getRecentRecords } from '@/db/api';
import { loadAchievements } from '@/lib/achievements';
import {
  requestNotificationPermission,
  getNotificationPermissionStatus,
  syncAllNotifications,
} from '@/lib/notifications';
import { Task } from '@/types/types';
import { NewbieGuideModal } from '@/components/NewbieGuideModal';

// 多巴胺配色
const C_BG     = '#FFFDF2';
const C_PINK   = '#FF5E7C';
const C_PURPLE = '#6C63FF';
const C_MINT   = '#2EC4B6';
const C_TEXT   = '#333333';
const C_MUTED  = '#888888';

// §8.2 反馈邮件（在 settings 中复用同一函数）
const SUPPORT_EMAIL = 'support@mochiddl.app';
const PLAY_STORE_ID = 'com.yourcompany.mochiddl';
const APP_STORE_ID  = 'YOUR_APP_ID';

async function openFeedbackEmail() {
  const subject = encodeURIComponent('【麻糬のDDL】问题反馈');
  const body    = encodeURIComponent(`App 版本：v2.7\n系统：${Platform.OS}\n\n问题描述：\n（请在此填写）`);
  const mailto  = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
  const can = await Linking.canOpenURL(mailto);
  if (can) await Linking.openURL(mailto);
}

// §9.1 主题 Coming Soon 弹窗
function ComingSoonModal({ visible, onClose, onFeedback }: { visible: boolean; onClose: () => void; onFeedback: () => void }) {
  const slideY  = useSharedValue(300);
  const opacity = useSharedValue(0);
  const sheetStyle   = useAnimatedStyle(() => ({ transform: [{ translateY: slideY.value }] }));
  const overlayStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  if (visible) {
    slideY.value  = withSpring(0, { damping: 18, stiffness: 160 });
    opacity.value = withTiming(1, { duration: 220 });
  } else {
    slideY.value  = withTiming(300, { duration: 200 });
    opacity.value = withTiming(0, { duration: 180 });
  }

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(51,33,66,0.30)' }, overlayStyle]} />
        <Pressable onPress={() => {}}>
          <Animated.View style={[{
            backgroundColor: '#FFFDF2',
            borderTopLeftRadius: 32, borderTopRightRadius: 32,
            paddingHorizontal: 24, paddingTop: 12, paddingBottom: 48,
          }, sheetStyle]}>
            <View style={{ width: 40, height: 4, backgroundColor: '#E8E0D0', borderRadius: 2, alignSelf: 'center', marginBottom: 20 }} />
            {/* 插图区 */}
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: '#F0EDFF', borderWidth: 2, borderColor: '#D8D4FF', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                <Text style={{ fontSize: 44 }}>🎨</Text>
              </View>
              <Text style={{ color: C_PURPLE, fontSize: 20, fontWeight: 'bold', marginBottom: 6 }}>主题与外观</Text>
              <Text style={{ color: C_MUTED, fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
                更多主题正在麻糬的设计稿里排队中{'\n'}敬请期待~ 🍡
              </Text>
            </View>
            {/* 当前主题说明 */}
            <View style={{ backgroundColor: '#F5F2EE', borderRadius: 16, padding: 14, marginBottom: 20 }}>
              <Text style={{ color: C_TEXT, fontSize: 12, lineHeight: 20 }}>
                🌈 当前主题：<Text style={{ fontWeight: '700', color: C_PURPLE }}>糖果色 Y2K 多巴胺</Text>{'\n'}
                即将上线：暗夜抹茶 · 奶油芋泥 · 薄荷可可{'\n'}
                如果你有喜欢的配色，来告诉麻糬吧！
              </Text>
            </View>
            <Pressable onPress={onClose} style={{ backgroundColor: C_PURPLE, borderRadius: 16, paddingVertical: 14, alignItems: 'center', marginBottom: 10, boxShadow: [{ offsetX: 0, offsetY: 4, blurRadius: 14, color: 'rgba(108,99,255,0.30)' }] }}>
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>知道了 💜</Text>
            </Pressable>
            <Pressable onPress={onFeedback} style={{ alignItems: 'center', paddingVertical: 8 }}>
              <Text style={{ color: C_PINK, fontSize: 12, textDecorationLine: 'underline' }}>告诉麻糬你喜欢的配色 →</Text>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// 通知权限引导弹窗
function NotifPermissionModal({
  visible,
  onConfirm,
  onDismiss,
}: {
  visible: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const slideY  = useSharedValue(300);
  const opacity = useSharedValue(0);

  const sheetStyle   = useAnimatedStyle(() => ({ transform: [{ translateY: slideY.value }] }));
  const overlayStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  if (visible) {
    slideY.value  = withSpring(0, { damping: 18, stiffness: 160 });
    opacity.value = withTiming(1, { duration: 220 });
  } else {
    slideY.value  = withTiming(300, { duration: 200 });
    opacity.value = withTiming(0, { duration: 180 });
  }

  const FEATURES = [
    { emoji: '⏰', text: '截止前 6 小时：提前预警，让你心里有数' },
    { emoji: '🚨', text: '截止前 1 小时：最后一道防线，再不动就没了' },
    { emoji: '✅', text: '标记完成后自动取消，不打扰你' },
  ];

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onDismiss}>
      <Pressable onPress={onDismiss} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View style={[{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(51,33,66,0.28)',
        }, overlayStyle]} />
        <Pressable onPress={() => {}}>
          <Animated.View style={[{
            backgroundColor: '#FFFDF2',
            borderTopLeftRadius: 32, borderTopRightRadius: 32,
            paddingHorizontal: 24, paddingTop: 8, paddingBottom: 44,
          }, sheetStyle]}>
            <View style={{ width: 40, height: 4, backgroundColor: '#E8E0D0', borderRadius: 2, alignSelf: 'center', marginBottom: 22 }} />
            <View style={{ alignItems: 'center', marginBottom: 18 }}>
              <View style={{
                width: 76, height: 76, borderRadius: 38,
                backgroundColor: '#FFF0F4', borderWidth: 2, borderColor: '#FFD6DF',
                alignItems: 'center', justifyContent: 'center', marginBottom: 14,
              }}>
                <Text style={{ fontSize: 36 }}>🔔</Text>
              </View>
              <Text style={{ color: C_PINK, fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginBottom: 6 }}>
                DDL 要来了，让我提醒你？
              </Text>
              <Text style={{ color: C_MUTED, fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
                开启通知后，麻糬のDDL 会在你的 DDL{'\n'}快到期时悄悄 @ 你，防止你摸鱼过头。
              </Text>
            </View>
            <View style={{ backgroundColor: '#FFFFFF', borderRadius: 18, padding: 16, marginBottom: 20, borderWidth: 1.5, borderColor: '#F0EDE0' }}>
              {FEATURES.map((f, i) => (
                <View key={i} style={{
                  flexDirection: 'row', alignItems: 'flex-start', gap: 10,
                  paddingVertical: 7,
                  borderBottomWidth: i < FEATURES.length - 1 ? 1 : 0,
                  borderBottomColor: '#F5F0E8',
                }}>
                  <Text style={{ fontSize: 18, lineHeight: 22 }}>{f.emoji}</Text>
                  <Text style={{ flex: 1, color: '#555555', fontSize: 13, lineHeight: 20 }}>{f.text}</Text>
                </View>
              ))}
            </View>
            <Pressable onPress={onConfirm} style={{
              backgroundColor: C_PINK, borderRadius: 18, paddingVertical: 15,
              alignItems: 'center', marginBottom: 10,
              boxShadow: [{ offsetX: 0, offsetY: 4, blurRadius: 16, color: 'rgba(255,94,124,0.30)' }],
            }}>
              <Text style={{ color: '#ffffff', fontSize: 15, fontWeight: 'bold' }}>🔔 开启 DDL 提醒</Text>
            </Pressable>
            <Pressable onPress={onDismiss} style={{ alignItems: 'center', paddingVertical: 8 }}>
              <Text style={{ color: '#AAAAAA', fontSize: 13 }}>以后再说</Text>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// 菜单项行组件
function MenuRow({
  emoji,
  label,
  desc,
  right,
  onPress,
  color,
  noBorder,
}: {
  emoji: string;
  label: string;
  desc?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  color?: string;
  noBorder?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row', alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 14,
        borderBottomWidth: noBorder ? 0 : 1,
        borderBottomColor: '#F5F0E8',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
        <View style={{
          width: 38, height: 38, borderRadius: 12,
          backgroundColor: '#F5F2EE',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{ fontSize: 18 }}>{emoji}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: color ?? C_TEXT, fontSize: 14, fontWeight: '600' }}>{label}</Text>
          {desc ? <Text style={{ color: C_MUTED, fontSize: 11, marginTop: 2 }}>{desc}</Text> : null}
        </View>
      </View>
      {right ?? (onPress ? <Text style={{ color: C_MUTED, fontSize: 20 }}>›</Text> : null)}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const router = useRouter();

  const [tasks, setTasks]               = useState<Task[]>([]);
  const [unlockedCount, setUnlockedCount] = useState(0);
  const [totalAch, setTotalAch]         = useState(0);
  const [loading, setLoading]           = useState(true);
  const [notifStatus, setNotifStatus]   = useState('');
  const [notifMsg, setNotifMsg]         = useState('');
  const [showNotifModal, setShowNotifModal] = useState(false);
  const [showComingSoon, setShowComingSoon] = useState(false);
  const [animEnabled, setAnimEnabled]   = useState(true);
  const [showNewbieGuide, setShowNewbieGuide] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [allTasks, ach, nStatus, animSetting] = await Promise.all([
        getAllTasks(),
        loadAchievements(),
        getNotificationPermissionStatus(),
        AsyncStorage.getItem('settings_animation_enabled'),
        getRecentRecords(30),
      ]);
      setTasks(allTasks);
      setUnlockedCount(ach.filter(a => a.unlocked).length);
      setTotalAch(ach.length);
      setNotifStatus(nStatus);
      if (animSetting !== null) {
        setAnimEnabled(animSetting !== '0');
      }
      if (nStatus === 'granted') {
        syncAllNotifications(allTasks).catch(() => undefined);
      }
    } catch { }
    finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const handleToggleAnimation = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const nextVal = !animEnabled;
    setAnimEnabled(nextVal);
    await AsyncStorage.setItem('settings_animation_enabled', nextVal ? '1' : '0');
  };

  const handleNotifPress = () => {
    if (notifStatus === 'granted') return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowNotifModal(true);
  };

  const handleConfirmNotif = async () => {
    setShowNotifModal(false);
    setTimeout(async () => {
      const granted = await requestNotificationPermission();
      setNotifStatus(granted ? 'granted' : 'denied');
      if (granted) {
        await syncAllNotifications(tasks);
        setNotifMsg('🎉 通知已开启！DDL 快到时我会叫你的~');
      } else {
        setNotifMsg('😅 被你拒了…可以在系统设置里再开启哦');
      }
      setTimeout(() => setNotifMsg(''), 3500);
    }, 350);
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: C_BG, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 36 }}>✨</Text>
        <ActivityIndicator color={C_PURPLE} style={{ marginTop: 12 }} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C_BG }}>
      <NotifPermissionModal
        visible={showNotifModal}
        onConfirm={handleConfirmNotif}
        onDismiss={() => setShowNotifModal(false)}
      />
      {/* §9.1 主题 Coming Soon */}
      <ComingSoonModal
        visible={showComingSoon}
        onClose={() => setShowComingSoon(false)}
        onFeedback={() => {
          setShowComingSoon(false);
          setTimeout(() => void openFeedbackEmail(), 200);
        }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingTop: 56, paddingBottom: 100 }}
      >
        {/* 标题 */}
        <View style={{ paddingHorizontal: 16, marginBottom: 24 }}>
          <Text style={{ color: C_MUTED, fontSize: 11 }}>偏好与管理</Text>
          <Text style={{ color: C_PURPLE, fontSize: 26, fontWeight: 'bold' }}>✨ 设置</Text>
        </View>

        {/* 用户身份卡片 */}
        <View style={{
          backgroundColor: '#FFFFFF', borderRadius: 20,
          marginHorizontal: 16, marginBottom: 16,
          padding: 20,
          boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 10, color: 'rgba(0,0,0,0.06)' }],
          flexDirection: 'row', alignItems: 'center', gap: 16,
        }}>
          <View style={{
            width: 56, height: 56, borderRadius: 28,
            backgroundColor: '#FFF0F4',
            alignItems: 'center', justifyContent: 'center',
            borderWidth: 2, borderColor: '#FFD6DF',
          }}>
            <Text style={{ fontSize: 28 }}>🍡</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C_TEXT, fontSize: 16, fontWeight: 'bold' }}>麻糬同学</Text>
            <Text style={{ color: C_MUTED, fontSize: 12, marginTop: 2 }}>
              已解锁 {unlockedCount}/{totalAch} 个成就 🏆
            </Text>
          </View>
          <View style={{ backgroundColor: '#FFF0F4', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 }}>
            <Text style={{ color: C_PINK, fontSize: 11, fontWeight: '700' }}>v2.7</Text>
          </View>
        </View>

        {/* 主菜单 */}
        <View style={{
          backgroundColor: '#FFFFFF', borderRadius: 20,
          marginHorizontal: 16,
          paddingHorizontal: 16,
          boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 10, color: 'rgba(0,0,0,0.06)' }],
        }}>
          {/* 1. 我的成就 */}
          <MenuRow
            emoji="🏆"
            label="我的成就"
            desc={`已解锁 ${unlockedCount} / ${totalAch} 个`}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push('/(app)/achievements');
            }}
          />

          {/* 2. 主题与外观 */}
          <MenuRow
            emoji="🌈"
            label="主题与外观"
            desc="糖果色 Y2K 多巴胺主题"
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowComingSoon(true);
            }}
            right={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ backgroundColor: '#FFF0F4', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Text style={{ color: C_PINK, fontSize: 10, fontWeight: '700' }}>即将上线</Text>
                </View>
                <Text style={{ color: C_MUTED, fontSize: 20 }}>›</Text>
              </View>
            }
          />

          {/* 2.5 全局动效开关 */}
          <MenuRow
            emoji="🎬"
            label="全局动效"
            desc={animEnabled ? '开（流畅软糖动效与彩花反馈）' : '关（0ms 纯净低功耗模式）'}
            right={
              <Pressable
                onPress={() => void handleToggleAnimation()}
                style={{
                  width: 50, height: 28, borderRadius: 14,
                  backgroundColor: animEnabled ? C_MINT : '#E4DCB8',
                  justifyContent: 'center', paddingHorizontal: 3,
                }}
              >
                <View style={{
                  width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff',
                  alignSelf: animEnabled ? 'flex-end' : 'flex-start',
                  boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 3, color: 'rgba(0,0,0,0.15)' }],
                }} />
              </Pressable>
            }
          />

          {/* 2.6 新手操作指南 */}
          <MenuRow
            emoji="📖"
            label="新手操作指南"
            desc="核心玩法、防逃课规则与快捷操作"
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowNewbieGuide(true);
            }}
          />

          {/* 3. DDL 提醒 */}
          <MenuRow
            emoji="🔔"
            label="DDL 提醒"
            desc={
              notifStatus === 'granted'
                ? '✅ 已开启——DDL 到期前会自动提醒'
                : notifStatus === 'denied'
                  ? '通知已被拒绝，请在系统设置中手动开启'
                  : '点击开启到期推送提醒'
            }
            color={notifStatus === 'granted' ? C_MINT : C_PINK}
            right={
              notifStatus !== 'granted' ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ backgroundColor: '#FFF0F4', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 }}>
                    <Text style={{ color: C_PINK, fontSize: 11, fontWeight: '700' }}>
                      {notifStatus === 'denied' ? '🚫 被拒绝' : '⚠️ 已关闭'}
                    </Text>
                  </View>
                  <Text style={{ color: C_MUTED, fontSize: 20 }}>›</Text>
                </View>
              ) : undefined
            }
            onPress={notifStatus !== 'granted' ? handleNotifPress : undefined}
          />
          {/* 通知权限降级提示条（PRD v2.1） */}
          {notifStatus === 'denied' && (
            <View style={{
              backgroundColor: '#FFF0E0',
              borderRadius: 12, marginHorizontal: 4,
              marginBottom: 8, marginTop: -4,
              padding: 10,
              borderWidth: 1, borderColor: '#FFD580',
              flexDirection: 'row', alignItems: 'flex-start', gap: 8,
            }}>
              <Text style={{ fontSize: 16 }}>⚠️</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#AA7A00', fontSize: 12, fontWeight: '600', marginBottom: 2 }}>
                  通知权限已被拒绝
                </Text>
                <Text style={{ color: '#AA7A00', fontSize: 11, lineHeight: 16 }}>
                  DDL 快到时无法叫醒你，摸鱼风险翻倍！{'\n'}请前往「系统设置 → 应用 → 通知」手动开启。
                </Text>
              </View>
            </View>
          )}
          {notifMsg ? (
            <Text style={{ color: C_MUTED, fontSize: 11, paddingHorizontal: 4, paddingBottom: 8, marginTop: -4 }}>
              {notifMsg}
            </Text>
          ) : null}

          {/* 4. 数据统计 */}
          <MenuRow
            emoji="📊"
            label="数据统计"
            desc="学习 · 摸鱼 · 睡眠时长分析"
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push('/(app)/stats');
            }}
          />

          {/* 5. 自定义语录 */}
          <MenuRow
            emoji="💬"
            label="自定义语录"
            desc="管理你的专属激励语录库"
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push('/(app)/quotes');
            }}
          />

          {/* 6. 日切点设置 */}
          <MenuRow
            emoji="⏰"
            label="日切点设置"
            desc="调整「今天」的起始时间（默认凌晨4:00）"
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push('/(app)/cutoff-settings');
            }}
          />

          {/* 7. 数据备份 */}
          <MenuRow
            emoji="💾"
            label="数据备份与恢复"
            desc="导出全量数据 · 换机迁移 · 本地备份"
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push('/(app)/data-backup');
            }}
          />

          {/* 8. 关于 */}
          <MenuRow
            emoji="❓"
            label="关于麻糬のDDL"
            desc="v2.7 · 一个会陪你一起崩溃的DDL模拟器"
            noBorder
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push('/(app)/about');
            }}
          />
        </View>

        {/* 底部彩蛋文案 */}
        <Text style={{ color: C_MUTED, fontSize: 11, textAlign: 'center', marginTop: 32, lineHeight: 18 }}>
          Made with 💜 by 麻糬研究所{'\n'}愿你每个 DDL 都能在最后一刻完成 🍡
        </Text>
      </ScrollView>

      {/* 新手操作指南弹窗 */}
      <NewbieGuideModal
        visible={showNewbieGuide}
        onClose={() => setShowNewbieGuide(false)}
      />
    </View>
  );
}
