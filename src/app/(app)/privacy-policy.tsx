/**
 * 隐私政策页面 — §8.3
 * 使用 ScrollView + Text 内联渲染，支持长按复制（selectable）
 */
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

const C_BG     = '#FFFDF2';
const C_PURPLE = '#6C63FF';
const C_PINK   = '#FF5E7C';
const C_TEXT   = '#333333';
const C_MUTED  = '#888888';

const SECTIONS = [
  {
    title: '一、数据收集与存储',
    body: [
      '麻糬のDDL 不收集、不上传任何个人信息。',
      '您的全部数据（DDL 任务、时间记录、自定义语录、成就进度等）仅存储于您本机的本地数据库（SQLite）中，与任何第三方服务器无关。',
      '我们无法访问、读取或修改您的任何数据。',
    ],
  },
  {
    title: '二、权限使用说明',
    body: [
      '【通知权限】用于在 DDL 到期前推送提醒（6 小时 / 1 小时）。不授权则无法收到提醒，不影响其他功能。',
      '【相册写入权限】用于将生存日报卡片保存至系统相册。不授权则无法保存卡片图片，不影响其他功能。',
      '本 App 不使用位置权限、麦克风权限、摄像头权限或联系人权限。',
    ],
  },
  {
    title: '三、第三方 SDK',
    body: [
      '本 App 不集成任何第三方广告 SDK、数据分析 SDK 或行为追踪 SDK。',
      '本 App 基于 Expo / React Native 框架开发，Expo 可能包含崩溃报告组件，但不关联您的个人身份信息。',
    ],
  },
  {
    title: '四、换机数据丢失风险提示',
    body: [
      '⚠️ 重要：由于数据完全存储于本地，以下情况将导致数据永久丢失：',
      '• 更换设备（换手机）',
      '• 卸载 App',
      '• 系统重置 / 出厂恢复',
      '• 设备损坏',
      '强烈建议您定期通过「设置 → 数据备份与恢复 → 导出数据」将数据导出并保存至安全位置（如云盘、电脑）。',
      '开发者对因未备份导致的数据丢失不承担任何责任。',
    ],
  },
  {
    title: '五、未成年人保护',
    body: [
      '本 App 适合所有年龄段用户使用。',
      '由于不收集任何个人信息，不存在未成年人数据处理问题。',
    ],
  },
  {
    title: '六、隐私政策更新',
    body: [
      '如本隐私政策发生重大变更，我们将在 App 更新说明中明确告知。',
      '继续使用本 App 即视为您同意更新后的隐私政策。',
    ],
  },
  {
    title: '七、联系我们',
    body: [
      '如您对本隐私政策有任何疑问或建议，请通过以下方式联系我们：',
      '📧 邮箱：support@mochiddl.app',
      '反馈入口：关于页 → 反馈问题',
    ],
  },
];

export default function PrivacyPolicyScreen() {
  const router = useRouter();
  return (
    <View style={{ flex: 1, backgroundColor: C_BG }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingTop: 56, paddingBottom: 100, paddingHorizontal: 16 }}
      >
        {/* 顶部导航 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <Pressable onPress={() => router.back()} style={{ padding: 6 }}>
            <Text style={{ color: C_PURPLE, fontSize: 22 }}>‹</Text>
          </Pressable>
          <View>
            <Text style={{ color: C_MUTED, fontSize: 11 }}>法律文件</Text>
            <Text style={{ color: C_PURPLE, fontSize: 22, fontWeight: 'bold' }}>🔒 隐私政策</Text>
          </View>
        </View>

        {/* 摘要卡 */}
        <View style={{ backgroundColor: '#EDFAF7', borderRadius: 16, padding: 16, marginBottom: 20, borderWidth: 1.5, borderColor: '#C0F0E8' }}>
          <Text style={{ color: '#1A8870', fontSize: 13, fontWeight: '700', marginBottom: 6 }}>📌 核心摘要</Text>
          <Text style={{ color: '#2A6058', fontSize: 12, lineHeight: 20 }}>
            ✅ 不收集任何个人信息{'\n'}
            ✅ 数据仅存于本机，不上传服务器{'\n'}
            ✅ 无广告追踪 SDK{'\n'}
            ⚠️ 换机/卸载前请务必导出备份
          </Text>
        </View>

        {/* 更新日期 */}
        <Text style={{ color: C_MUTED, fontSize: 11, marginBottom: 20 }}>
          最后更新：2025年5月 · 版本 v2.7
        </Text>

        {/* 各章节 — selectable 支持长按复制 */}
        {SECTIONS.map((sec) => (
          <View key={sec.title} style={{ marginBottom: 24 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <View style={{ width: 4, height: 18, backgroundColor: C_PURPLE, borderRadius: 2 }} />
              <Text style={{ color: C_TEXT, fontSize: 14, fontWeight: '700' }}>{sec.title}</Text>
            </View>
            <View style={{ backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, gap: 8, boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 6, color: 'rgba(0,0,0,0.05)' }] }}>
              {sec.body.map((line, i) => (
                <Text key={i} selectable style={{ color: C_TEXT, fontSize: 12, lineHeight: 20 }}>
                  {line}
                </Text>
              ))}
            </View>
          </View>
        ))}

        {/* 底部声明 */}
        <View style={{ backgroundColor: `${C_PINK}0D`, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: `${C_PINK}25` }}>
          <Text style={{ color: C_PINK, fontSize: 11, textAlign: 'center', lineHeight: 18 }}>
            本 App 由个人开发者独立制作，无商业广告，无数据变现{'\n'}
            Made with 💜 · 麻糬研究所 © 2025
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
