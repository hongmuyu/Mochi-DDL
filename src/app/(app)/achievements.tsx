import { useCallback, useState } from 'react';
import { FlatList, Pressable, Text, View, ActivityIndicator } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useFocusEffect, useRouter } from 'expo-router';
import { loadAchievements, Achievement } from '@/lib/achievements';
import AchievementUnlockModal from '@/components/AchievementUnlockModal';

const C_BG = '#FFFDF2';
const C_PINK = '#FF5E7C';
const C_PURPLE = '#6C63FF';
const C_YELLOW = '#FFD166';
const C_MINT = '#2EC4B6';
const C_TEXT = '#333333';
const C_MUTED = '#888888';

function AchievementCard({ item, onShare }: { item: Achievement; onShare: (a: Achievement) => void }) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={[style, { marginBottom: 10 }]}>
      <Pressable
        onPress={() => {
          if (item.unlocked) {
            scale.value = withSpring(1.04, {}, () => { scale.value = withSpring(1); });
            onShare(item);
          }
        }}
        style={{
          backgroundColor: item.unlocked ? '#FFFFFF' : '#F5F3EE',
          borderRadius: 20,
          borderWidth: 2,
          borderColor: item.unlocked ? C_YELLOW : '#E8E2D8',
          padding: 14,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          opacity: item.unlocked ? 1 : 0.55,
          boxShadow: item.unlocked ? '0 2px 12px rgba(255,209,102,0.25)' : 'none',
        }}
      >
        {/* 贴纸emoji */}
        <View style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: item.unlocked ? '#FFFBEA' : '#EEEAE0',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <Text style={{ fontSize: item.unlocked ? 30 : 26 }}>{item.unlocked ? item.emoji : '🔒'}</Text>
        </View>

        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <Text style={{ color: item.unlocked ? C_TEXT : C_MUTED, fontSize: 15, fontWeight: 'bold' }}>
              {item.title}
            </Text>
            {item.unlocked && (
              <View style={{ backgroundColor: C_YELLOW, borderRadius: 99, paddingHorizontal: 7, paddingVertical: 2 }}>
                <Text style={{ color: '#7A5800', fontSize: 9, fontWeight: 'bold' }}>已解锁</Text>
              </View>
            )}
          </View>
          <Text style={{ color: C_MUTED, fontSize: 12, lineHeight: 17 }}>{item.condition}</Text>
          {item.unlocked && item.unlockedAt && (
            <Text style={{ color: C_MINT, fontSize: 10, marginTop: 4 }}>
              🗓 {new Date(item.unlockedAt).toLocaleDateString('zh-CN')} 解锁
            </Text>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}

export default function AchievementsScreen() {
  const router = useRouter();
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [loading, setLoading] = useState(true);
  // §6.1 点击已解锁成就 → 弹出贴纸分享弹窗
  const [shareTarget, setShareTarget] = useState<Achievement | null>(null);

  useFocusEffect(useCallback(() => {
    loadAchievements().then(data => {
      setAchievements(data);
      setLoading(false);
    });
  }, []));

  const unlocked = achievements.filter(a => a.unlocked);
  const locked = achievements.filter(a => !a.unlocked);
  const sortedList = [...unlocked, ...locked];

  return (
    <View style={{ flex: 1, backgroundColor: C_BG }}>
      {/* §6.1 已解锁成就分享弹窗 */}
      <AchievementUnlockModal
        achievement={shareTarget}
        onDismiss={() => setShareTarget(null)}
      />
      {/* 顶部 */}
      <View style={{
        paddingTop: 56,
        paddingHorizontal: 16,
        paddingBottom: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <View>
          <Text style={{ color: C_MUTED, fontSize: 11 }}>成就系统</Text>
          <Text style={{ color: C_YELLOW, fontSize: 24, fontWeight: 'bold' }}>🏆 我的勋章</Text>
        </View>
        <Pressable
          onPress={() => router.back()}
          style={{
            backgroundColor: '#FFFFFF',
            borderRadius: 99,
            paddingHorizontal: 14,
            paddingVertical: 7,
            boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 4, color: 'rgba(0,0,0,0.08)' }],
          }}
        >
          <Text style={{ color: C_MUTED, fontSize: 13 }}>← 返回</Text>
        </Pressable>
      </View>

      {/* 进度卡 */}
      <View style={{
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        marginHorizontal: 16,
        marginBottom: 14,
        padding: 16,
        boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 10, color: 'rgba(0,0,0,0.06)' }],
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <Text style={{ color: C_TEXT, fontSize: 15, fontWeight: '600' }}>
            解锁进度 {unlocked.length} / {achievements.length}
          </Text>
          <Text style={{ color: C_YELLOW, fontSize: 22 }}>
            {Array(Math.min(unlocked.length, 5)).fill('⭐').join('')}
          </Text>
        </View>
        <View style={{ height: 10, backgroundColor: '#F0EDE0', borderRadius: 999, overflow: 'hidden' }}>
          <View style={{
            width: `${achievements.length > 0 ? (unlocked.length / achievements.length) * 100 : 0}%`,
            height: '100%',
            backgroundColor: C_YELLOW,
            borderRadius: 999,
          }} />
        </View>
        <Text style={{ color: C_MUTED, fontSize: 11, marginTop: 6 }}>
          {unlocked.length === 0
            ? '还没有解锁任何成就，继续努力（摸鱼）吧！'
            : unlocked.length === achievements.length
              ? '🎉 全部解锁！你已成为大学生末日传说！'
              : `再解锁 ${locked.length} 个成就达成全收集！`
          }
        </Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 36 }}>🏆</Text>
          <ActivityIndicator color={C_YELLOW} style={{ marginTop: 12 }} />
        </View>
      ) : (
        <FlatList
          data={sortedList}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
          contentInsetAdjustmentBehavior="automatic"
          ListHeaderComponent={
            unlocked.length > 0 ? (
              <Text style={{ color: C_MUTED, fontSize: 11, marginBottom: 8, paddingLeft: 2 }}>
                ✨ 已解锁成就 ({unlocked.length})
              </Text>
            ) : null
          }
          renderItem={({ item, index }) => (
            <>
              {index === unlocked.length && locked.length > 0 && (
                <Text style={{ color: C_MUTED, fontSize: 11, marginBottom: 8, marginTop: 4, paddingLeft: 2 }}>
                  🔒 待解锁 ({locked.length})
                </Text>
              )}
              <AchievementCard item={item} onShare={setShareTarget} />
            </>
          )}
        />
      )}
    </View>
  );
}
