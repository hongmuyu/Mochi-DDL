import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';

const C_BG = '#FFFDF2';
const C_PINK = '#FF5E7C';
const C_PURPLE = '#6C63FF';
const C_YELLOW = '#FFD166';
const C_MINT = '#2EC4B6';
const C_TEXT = '#333333';
const C_MUTED = '#888888';

const GUIDE_STEPS = [
  {
    step: 1,
    emoji: '⚔️',
    title: 'DDL 战场与防逃课机制',
    badge: '核心规则',
    badgeBg: '#FFE0E8',
    badgeColor: C_PINK,
    content: [
      '• 临近截止的任务会进入「红温赤」濒死状态，麻糬会与你一同焦虑！',
      '• 🔒 防逃课铁律：已过期的任务截止时间自动锁定，不可键盘篡改。',
      '• ⚠️ 濒死/高危任务不可随意逃课，强行删除将触发反作弊扣除 HP-5 与功德-10！',
    ],
  },
  {
    step: 2,
    emoji: '🎯',
    title: '子任务拆解与快捷操作',
    badge: '高效利器',
    badgeBg: '#EDE9FF',
    badgeColor: C_PURPLE,
    content: [
      '• 任务支持拆解为多个子任务项，随时勾选完成，卡片实时展示完成进度条。',
      '• 🔁 支持每天/每周/每月周期性重复 DDL，完成本期后下一期自动就绪。',
      '• ⏳ 提供快捷复制任务为新模板，以及一键 +1天/+1周/自定义快捷延期。',
    ],
  },
  {
    step: 3,
    emoji: '⏱️',
    title: '专注计时与误操作修正',
    badge: '真实记录',
    badgeBg: '#FFF6D6',
    badgeColor: '#D48806',
    content: [
      '• 包含专注学习、摸鱼躺平、睡眠打卡三种计时模式，锁屏后台也能精准累计。',
      '• 🛡️ 4 小时单次计时保护：超过 4h 强制作废，防止遗忘挂机作弊。',
      '• ✏️ 误操作修正：在「摸鱼」页可以对历史记录进行修正与删除，统计自动重算！',
    ],
  },
  {
    step: 4,
    emoji: '🍡',
    title: '麻糬软糖与纯本地安全',
    badge: '100% 离线',
    badgeBg: '#E6FAF7',
    badgeColor: C_MINT,
    content: [
      '• 麻糬随你的完成率、生命值和功德值变脸，提供面团黄、红温赤等多种情绪。',
      '• 💾 100% 纯本地离线 SQLite 存储，不连接任何第三方云服务器，隐私零泄露。',
      '• 📥 支持随时一键导出标准 ICS 日历，支持导入系统日历与全量本地数据备份迁移。',
    ],
  },
];

export function NewbieGuideModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const [currentStep, setCurrentStep] = useState(0);

  const handleNext = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (currentStep < GUIDE_STEPS.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      void handleFinish();
    }
  };

  const handlePrev = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const handleFinish = async () => {
    await AsyncStorage.setItem('has_seen_newbie_guide', '1');
    setCurrentStep(0);
    onClose();
  };

  const stepData = GUIDE_STEPS[currentStep];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{
        flex: 1, backgroundColor: 'rgba(51,33,66,0.5)',
        alignItems: 'center', justifyContent: 'center', padding: 24,
      }}>
        <View style={{
          backgroundColor: C_BG,
          borderRadius: 28,
          padding: 24,
          width: '100%',
          maxWidth: 380,
          borderWidth: 2,
          borderColor: '#F0E6D2',
          boxShadow: [{ offsetX: 0, offsetY: 12, blurRadius: 36, color: 'rgba(0,0,0,0.2)' }],
        }}>
          {/* 顶栏步骤指示 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {GUIDE_STEPS.map((_, i) => (
                <View
                  key={i}
                  style={{
                    width: i === currentStep ? 24 : 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: i === currentStep ? C_PINK : '#E4DCB8',
                  }}
                />
              ))}
            </View>
            <Pressable onPress={handleFinish} style={{ padding: 4 }}>
              <Text style={{ fontSize: 13, color: C_MUTED, fontWeight: '600' }}>跳过</Text>
            </Pressable>
          </View>

          {/* 表头区 */}
          <View style={{ alignItems: 'center', marginBottom: 18 }}>
            <Text style={{ fontSize: 48, marginBottom: 8 }}>{stepData.emoji}</Text>
            <View style={{ backgroundColor: stepData.badgeBg, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3, marginBottom: 6 }}>
              <Text style={{ fontSize: 11, color: stepData.badgeColor, fontWeight: 'bold' }}>
                {stepData.badge} · 第 {stepData.step}/4 步
              </Text>
            </View>
            <Text style={{ fontSize: 18, fontWeight: 'bold', color: C_TEXT, textAlign: 'center' }}>
              {stepData.title}
            </Text>
          </View>

          {/* 说明卡片 */}
          <ScrollView style={{ maxHeight: 180, marginBottom: 20 }} showsVerticalScrollIndicator={false}>
            <View style={{ backgroundColor: '#FFFFFF', borderRadius: 18, padding: 14, gap: 10, borderWidth: 1, borderColor: '#EDE4D0' }}>
              {stepData.content.map((line, idx) => (
                <Text key={idx} style={{ fontSize: 13, color: C_TEXT, lineHeight: 20 }}>
                  {line}
                </Text>
              ))}
            </View>
          </ScrollView>

          {/* 操作按钮组 */}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {currentStep > 0 && (
              <Pressable
                onPress={handlePrev}
                style={{
                  flex: 1,
                  paddingVertical: 13,
                  borderRadius: 16,
                  backgroundColor: '#F0EBE0',
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: C_MUTED, fontSize: 14, fontWeight: '600' }}>上一步</Text>
              </Pressable>
            )}
            <Pressable
              onPress={handleNext}
              style={{
                flex: 2,
                paddingVertical: 13,
                borderRadius: 16,
                backgroundColor: currentStep === GUIDE_STEPS.length - 1 ? C_MINT : C_PINK,
                alignItems: 'center',
                boxShadow: [{ offsetX: 0, offsetY: 4, blurRadius: 12, color: 'rgba(255,94,124,0.35)' }],
              }}
            >
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>
                {currentStep === GUIDE_STEPS.length - 1 ? '🍡 开始征服 DDL！' : '下一步 →'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
