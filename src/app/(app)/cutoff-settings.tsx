/**
 * 日切点设置页面（PRD 3.10）
 * 天亮之前都算昨天，天亮了才算今天~
 * 默认凌晨4:00，可调 0:00-6:00（步长1小时）
 */
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { loadCutoffHour, saveCutoffHour } from '@/db/api';

const C_BG     = '#FFFDF2';
const C_PURPLE = '#6C63FF';
const C_PINK   = '#FF5E7C';
const C_MINT   = '#2EC4B6';
const C_TEXT   = '#333333';
const C_MUTED  = '#888888';

const HOURS = [0, 1, 2, 3, 4, 5, 6];

function hourLabel(h: number): string {
  return h === 0 ? '0:00（午夜）' : `${h}:00`;
}

function hourEmoji(h: number): string {
  if (h === 0) return '🌑';
  if (h <= 2) return '🌒';
  if (h <= 4) return '🌓';
  return '🌔';
}

export default function CutoffSettingsScreen() {
  const router = useRouter();
  const [cutoffHour, setCutoffHour] = useState(4);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useFocusEffect(useCallback(() => {
    loadCutoffHour().then(h => {
      setCutoffHour(h);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []));

  const handleSelect = (h: number) => {
    void Haptics.selectionAsync();
    setCutoffHour(h);
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveCutoffHour(cutoffHour);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSaved(true);
      // 短暂显示保存成功后返回
      setTimeout(() => router.back(), 800);
    } catch {
      /* 忽略 */
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: C_BG, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={C_PURPLE} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C_BG }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingTop: 56, paddingBottom: 100, paddingHorizontal: 16 }}
      >
        {/* 顶部导航 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 24 }}>
          <Pressable
            onPress={() => router.back()}
            style={{
              width: 36, height: 36, borderRadius: 18,
              backgroundColor: '#FFFFFF',
              alignItems: 'center', justifyContent: 'center',
              boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 8, color: 'rgba(0,0,0,0.08)' }],
              marginRight: 12,
            }}
          >
            <Text style={{ fontSize: 18, color: C_TEXT }}>‹</Text>
          </Pressable>
          <View>
            <Text style={{ color: C_MUTED, fontSize: 11 }}>时间边界设置</Text>
            <Text style={{ color: C_PURPLE, fontSize: 22, fontWeight: 'bold' }}>⏰ 日切点设置</Text>
          </View>
        </View>

        {/* 说明卡片 */}
        <View style={{
          backgroundColor: '#FFFFFF', borderRadius: 20, padding: 18, marginBottom: 16,
          boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 10, color: 'rgba(0,0,0,0.06)' }],
          borderWidth: 1.5, borderColor: `${C_PURPLE}22`,
        }}>
          <Text style={{ fontSize: 28, textAlign: 'center', marginBottom: 10 }}>🌙</Text>
          <Text style={{ color: C_PURPLE, fontSize: 16, fontWeight: 'bold', textAlign: 'center', marginBottom: 8 }}>
            天亮之前都算昨天
          </Text>
          <Text style={{ color: C_MUTED, fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
            日切点决定了「今天」的起始时间。{'\n'}
            例如设置为凌晨 4:00，则凌晨 3:59 之前{'\n'}
            记录的数据都归属于「昨天」。
          </Text>
        </View>

        {/* 当前选择展示 */}
        <View style={{
          backgroundColor: `${C_PURPLE}12`,
          borderRadius: 16, padding: 14, marginBottom: 20,
          flexDirection: 'row', alignItems: 'center', gap: 12,
        }}>
          <Text style={{ fontSize: 32 }}>{hourEmoji(cutoffHour)}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C_MUTED, fontSize: 11 }}>当前日切点</Text>
            <Text style={{ color: C_PURPLE, fontSize: 22, fontWeight: 'bold' }}>
              {hourLabel(cutoffHour)}
            </Text>
          </View>
        </View>

        {/* 时间选择列表 */}
        <View style={{
          backgroundColor: '#FFFFFF', borderRadius: 20, paddingVertical: 8,
          boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 10, color: 'rgba(0,0,0,0.06)' }], marginBottom: 20,
        }}>
          {HOURS.map((h, idx) => {
            const isSelected = h === cutoffHour;
            return (
              <Pressable
                key={h}
                onPress={() => handleSelect(h)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 14,
                  paddingVertical: 14, paddingHorizontal: 18,
                  borderBottomWidth: idx < HOURS.length - 1 ? 1 : 0,
                  borderBottomColor: '#F5F0E8',
                  backgroundColor: isSelected ? `${C_PURPLE}0D` : 'transparent',
                }}
              >
                {/* 月相图标 */}
                <Text style={{ fontSize: 22 }}>{hourEmoji(h)}</Text>
                {/* 时间标签 */}
                <View style={{ flex: 1 }}>
                  <Text style={{
                    color: isSelected ? C_PURPLE : C_TEXT,
                    fontSize: 15,
                    fontWeight: isSelected ? '700' : '400',
                  }}>
                    {hourLabel(h)}
                  </Text>
                  {h === 4 && (
                    <Text style={{ color: C_MUTED, fontSize: 11, marginTop: 1 }}>（默认推荐）</Text>
                  )}
                  {h === 0 && (
                    <Text style={{ color: C_MUTED, fontSize: 11, marginTop: 1 }}>传统午夜换日</Text>
                  )}
                </View>
                {/* 选中圆圈 */}
                <View style={{
                  width: 22, height: 22, borderRadius: 11,
                  borderWidth: 2,
                  borderColor: isSelected ? C_PURPLE : '#D0C8B8',
                  backgroundColor: isSelected ? C_PURPLE : 'transparent',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  {isSelected && (
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>✓</Text>
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* 警告提示 */}
        <View style={{
          backgroundColor: '#FFF8E0', borderRadius: 14, padding: 14,
          borderWidth: 1, borderColor: '#FFD166', marginBottom: 24,
          flexDirection: 'row', gap: 10,
        }}>
          <Text style={{ fontSize: 18, lineHeight: 22 }}>⚠️</Text>
          <Text style={{ flex: 1, color: '#AA7A00', fontSize: 12, lineHeight: 18 }}>
            调整日切点仅影响未来数据，历史数据不会重新结算。
          </Text>
        </View>

        {/* 保存按钮 */}
        <Pressable
          onPress={() => void handleSave()}
          disabled={saving}
          style={{
            backgroundColor: saved ? C_MINT : C_PURPLE,
            borderRadius: 18, paddingVertical: 16,
            alignItems: 'center',
            boxShadow: [{ offsetX: 0, offsetY: 4, blurRadius: 16, color: saved ? 'rgba(46,196,182,0.35)' : 'rgba(108,99,255,0.35)' }],
          }}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: 'bold' }}>
              {saved ? '✅ 已保存！' : '💾 保存设置'}
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}
