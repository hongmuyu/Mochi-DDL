/**
 * 首次启动引导页（PRD Ch.1）
 * 3页欢迎流程 → 写入 AsyncStorage → 跳转主 App
 */
import { useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width: SW } = Dimensions.get('window');
const ONBOARDING_KEY = 'ddl_onboarded_v1';

// 配色
const C_BG     = '#FFFDF2';
const C_PINK   = '#FF5E7C';
const C_PURPLE = '#6C63FF';
const C_MINT   = '#2EC4B6';
const C_YELLOW = '#FFD166';
const C_MUTED  = '#888888';

// 三页引导内容
const PAGES = [
  {
    emoji: '🍡',
    title: '你好，我是麻糬！',
    subtitle: '麻糬のDDL',
    body: '专为摸鱼型大学生设计的\n末日生存手册\n\n我会陪你记录每一个 DDL、每一分钟的摸鱼与学习、每一次离谱的深夜奋战。',
    color: C_PINK,
    bg: '#FFF0F4',
  },
  {
    emoji: '💀',
    title: '你的DDL列表',
    subtitle: '每个任务都在倒计时',
    body: '添加 DDL 后，麻糬会实时追踪危险程度\n\n🟢 安全 → 🟡 预警 → 🔴 红温 → 💀 濒死\n\n越拖越红，越红越慌，越慌越拖——\n人类迷惑行为学精华。',
    color: C_PURPLE,
    bg: '#F0F0FF',
  },
  {
    emoji: '🐟',
    title: '摸鱼驾驶舱就绪',
    subtitle: '学习 · 摸鱼 · 睡眠全量监控',
    body: '用计时器记录今日数据\n让麻糬帮你算清楚\n到底是摸鱼多还是学习多\n\n以及……生存指数、理智值、功德值、发疯浓度\n一个都不会放过你 🍵',
    color: C_MINT,
    bg: '#EFFFFC',
  },
];

// 单页动画卡
function OnboardingPage({
  page,
  isActive,
}: {
  page: typeof PAGES[0];
  isActive: boolean;
}) {
  const scale   = useSharedValue(0.85);
  const opacity = useSharedValue(0);
  const floatY  = useSharedValue(0);

  // 进入动画
  useEffect(() => {
    if (isActive) {
      scale.value   = withSpring(1, { damping: 14, stiffness: 180 });
      opacity.value = withTiming(1, { duration: 300 });
      // 吉祥物漂浮
      floatY.value = withTiming(-10, { duration: 800 }, () => {
        // looping float via repeated callbacks is tricky; just do a single float
      });
    } else {
      scale.value   = withTiming(0.85, { duration: 200 });
      opacity.value = withTiming(0, { duration: 200 });
      floatY.value  = 0;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  const cardStyle  = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));
  const floatStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: floatY.value }],
  }));

  return (
    <Animated.View style={[{
      width: SW - 48,
      alignSelf: 'center',
      alignItems: 'center',
    }, cardStyle]}>
      {/* 吉祥物圆形 */}
      <Animated.View style={[{
        width: 120,
        height: 120,
        borderRadius: 60,
        backgroundColor: page.bg,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 24,
        borderWidth: 2,
        borderColor: `${page.color}40`,
        boxShadow: [{ offsetX: 0, offsetY: 8, blurRadius: 24, color: `${page.color}30` }],
      }, floatStyle]}>
        <Text style={{ fontSize: 60 }}>{page.emoji}</Text>
      </Animated.View>

      {/* 副标题 */}
      <View style={{
        backgroundColor: `${page.color}18`,
        borderRadius: 20, paddingHorizontal: 14, paddingVertical: 5,
        marginBottom: 12,
      }}>
        <Text style={{ color: page.color, fontSize: 12, fontWeight: '700' }}>{page.subtitle}</Text>
      </View>

      {/* 标题 */}
      <Text style={{
        color: page.color,
        fontSize: 26, fontWeight: 'bold',
        textAlign: 'center', marginBottom: 16,
      }}>
        {page.title}
      </Text>

      {/* 正文卡 */}
      <View style={{
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        padding: 20,
        width: '100%',
        boxShadow: [{ offsetX: 0, offsetY: 4, blurRadius: 16, color: 'rgba(0,0,0,0.07)' }],
      }}>
        <Text style={{ color: '#555', fontSize: 14, lineHeight: 22, textAlign: 'center' }}>
          {page.body}
        </Text>
      </View>
    </Animated.View>
  );
}

// 进度点
function Dots({ total, current }: { total: number; current: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
      {Array.from({ length: total }).map((_, i) => {
        const isActive = i === current;
        return (
          <Animated.View
            key={i}
            style={{
              width: isActive ? 20 : 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: isActive ? PAGES[current].color : '#DDD',
            }}
          />
        );
      })}
    </View>
  );
}

export default function OnboardingScreen() {
  const router = useRouter();
  const [pageIndex, setPageIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const btnScale = useSharedValue(1);

  // 按钮弹簧效果
  const btnStyle = useAnimatedStyle(() => ({
    transform: [{ scale: btnScale.value }],
  }));

  const goNext = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    btnScale.value = withSpring(0.92, {}, () => { btnScale.value = withSpring(1); });

    if (pageIndex < PAGES.length - 1) {
      const next = pageIndex + 1;
      setPageIndex(next);
      scrollRef.current?.scrollTo({ x: next * SW, animated: true });
    } else {
      // 完成引导
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await AsyncStorage.setItem(ONBOARDING_KEY, '1');
      router.replace('/(app)/(tabs)/home');
    }
  };

  const skip = async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, '1');
    router.replace('/(app)/(tabs)/home');
  };

  const currentPage = PAGES[pageIndex];
  const isLast = pageIndex === PAGES.length - 1;

  // 背景渐变动画
  const bgOpacity = useSharedValue(1);
  useEffect(() => {
    bgOpacity.value = withTiming(0, { duration: 100 }, () => {
      bgOpacity.value = withTiming(1, { duration: 300 });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIndex]);

  return (
    <View style={{ flex: 1, backgroundColor: C_BG }}>
      {/* 跳过按钮 */}
      {!isLast && (
        <Pressable
          onPress={skip}
          style={{ position: 'absolute', top: 60, right: 20, zIndex: 10, padding: 8 }}
        >
          <Text style={{ color: C_MUTED, fontSize: 13 }}>跳过</Text>
        </Pressable>
      )}

      {/* 顶部装饰条 */}
      <View style={{
        height: 4, marginTop: 56, marginHorizontal: 40,
        backgroundColor: '#F5EEE8', borderRadius: 2, overflow: 'hidden',
      }}>
        <Animated.View style={{
          width: `${((pageIndex + 1) / PAGES.length) * 100}%`,
          height: '100%',
          backgroundColor: currentPage.color,
          borderRadius: 2,
        }} />
      </View>

      {/* 内容区（不可滑动，通过按钮翻页） */}
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 24 }}>
        <OnboardingPage page={currentPage} isActive={true} />
      </View>

      {/* 底部：进度点 + 按钮 */}
      <View style={{ paddingHorizontal: 24, paddingBottom: 56, gap: 20 }}>
        <Dots total={PAGES.length} current={pageIndex} />

        <Animated.View style={btnStyle}>
          <Pressable
            onPress={goNext}
            style={{
              backgroundColor: currentPage.color,
              borderRadius: 20,
              paddingVertical: 16,
              alignItems: 'center',
              boxShadow: [{ offsetX: 0, offsetY: 6, blurRadius: 20, color: `${currentPage.color}50` }],
            }}
          >
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>
              {isLast ? '🍡 开始末日生存！' : '下一步 →'}
            </Text>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}
