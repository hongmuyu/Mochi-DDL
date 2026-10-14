import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { PortalHost } from '@rn-primitives/portal';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { PerformanceProvider } from '@/ctx/PerformanceContext';
import "../global.css";

const PRIVACY_KEY = 'ddl_privacy_accepted';
const C_PURPLE = '#6C63FF';
const C_PINK   = '#FF5E7C';
const C_MUTED  = '#888888';

/** §8.3 首次启动隐私政策弹窗 */
function PrivacyModal({ onAccept, onViewFull }: { onAccept: () => void; onViewFull: () => void }) {
  return (
    <Modal visible transparent animationType="fade">
      <View style={{ flex: 1, backgroundColor: 'rgba(30,20,50,0.55)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
        <View style={{ backgroundColor: '#FFFDF2', borderRadius: 28, padding: 28, width: '100%', boxShadow: [{ offsetX: 0, offsetY: 8, blurRadius: 32, color: 'rgba(0,0,0,0.15)' }] }}>
          <Text style={{ fontSize: 32, textAlign: 'center', marginBottom: 10 }}>🍡</Text>
          <Text style={{ color: '#222', fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 14 }}>
            欢迎使用麻糬のDDL
          </Text>
          <View style={{ backgroundColor: '#F5F2EE', borderRadius: 16, padding: 14, marginBottom: 20, gap: 8 }}>
            <Text style={{ color: '#333', fontSize: 13, fontWeight: '700', marginBottom: 4 }}>在继续之前，请了解：</Text>
            <Text style={{ color: '#555', fontSize: 12, lineHeight: 20 }}>
              ✅ 您的全部数据仅存储于本机，<Text style={{ fontWeight: '700' }}>不上传任何服务器</Text>{'\n'}
              ✅ 我们不收集任何个人信息，无广告追踪{'\n'}
              ⚠️ <Text style={{ fontWeight: '700' }}>换机或卸载前请务必导出备份</Text>，否则数据将永久丢失{'\n'}
              ⚠️ 通知与相册权限仅用于提醒和保存卡片
            </Text>
          </View>
          <Pressable
            onPress={onAccept}
            style={{ backgroundColor: C_PURPLE, borderRadius: 16, paddingVertical: 14, alignItems: 'center', marginBottom: 10, boxShadow: [{ offsetX: 0, offsetY: 4, blurRadius: 14, color: 'rgba(108,99,255,0.30)' }] }}
          >
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: 'bold' }}>同意并继续 🍡</Text>
          </Pressable>
          <Pressable onPress={onViewFull} style={{ alignItems: 'center', paddingVertical: 6 }}>
            <Text style={{ color: C_PINK, fontSize: 12, textDecorationLine: 'underline' }}>
              点击查看完整隐私政策
            </Text>
          </Pressable>
          <Text style={{ color: C_MUTED, fontSize: 10, textAlign: 'center', marginTop: 10, lineHeight: 16 }}>
            点击「同意并继续」即表示您已阅读并同意本隐私政策{'\n'}如不同意，请关闭 App 并卸载
          </Text>
        </View>
      </View>
    </Modal>
  );
}

// 纯本地 App，无需登录认证
const RootLayout: React.FC = () => {
  const router = useRouter();
  const [privacyAccepted, setPrivacyAccepted] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(PRIVACY_KEY).then(val => {
      setPrivacyAccepted(val === '1');
    });
  }, []);

  const handleAccept = async () => {
    await AsyncStorage.setItem(PRIVACY_KEY, '1');
    setPrivacyAccepted(true);
  };

  const handleViewFull = async () => {
    await AsyncStorage.setItem(PRIVACY_KEY, '1');
    setPrivacyAccepted(true);
    // 延迟跳转，等 Stack 渲染完成
    setTimeout(() => router.push('/(app)/privacy-policy'), 100);
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PerformanceProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="(app)" />
        </Stack>
        <PortalHost />
        {/* §8.3 首次启动隐私政策弹窗（privacyAccepted===false 时显示） */}
        {privacyAccepted === false && (
          <PrivacyModal onAccept={handleAccept} onViewFull={handleViewFull} />
        )}
      </PerformanceProvider>
    </GestureHandlerRootView>
  );
};

export default RootLayout;
