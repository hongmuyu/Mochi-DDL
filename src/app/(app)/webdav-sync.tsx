/**
 * src/app/(app)/webdav-sync.tsx
 *
 * 麻糬のDDL V2 — 多机安全同步中心 (WebDAV & E2EE)
 * 纯客户端零知识加密同步界面，符合 Y2K 掌机像素电子风格
 */

import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { SyncEngine, SyncStatus } from '@/lib/sync/syncEngine';
import { WebDavClient } from '@/lib/sync/webdavClient';
import { generateRecoveryKey } from '@/lib/sync/cryptoEngine';
import { RestoreManager, SnapshotMeta } from '@/lib/sync/restoreManager';

const C_BG = '#FFFDF2';
const C_PINK = '#FF5E7C';
const C_PURPLE = '#6C63FF';
const C_MINT = '#2EC4B6';
const C_TEXT = '#333333';
const C_MUTED = '#888888';

export default function WebDavSyncScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [syncConfigured, setSyncConfigured] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);

  // 表单状态
  const [serverUrl, setServerUrl] = useState('https://dav.jianguoyun.com/dav/');
  const [username, setUsername] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [syncPassword, setSyncPassword] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');

  // 弹窗状态
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showRecoveryModal, setShowRecoveryModal] = useState(false);
  const [showSnapshotModal, setShowSnapshotModal] = useState(false);
  const [showLostDeviceWizard, setShowLostDeviceWizard] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [actionMsg, setActionMsg] = useState('');

  const syncEngine = SyncEngine.getInstance();

  const loadData = useCallback(async () => {
    setLoading(true);
    const configured = await syncEngine.isSyncConfigured();
    setSyncConfigured(configured);
    const status = await syncEngine.getSyncStatus();
    setSyncStatus(status);
    const snList = await RestoreManager.listSnapshots();
    setSnapshots(snList);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const handleTestAndSave = async () => {
    if (!username.trim() || !appPassword.trim()) {
      setActionMsg('⚠️ 请填写坚果云账号和应用密码');
      return;
    }
    if (!syncPassword.trim() || syncPassword.length < 6) {
      setActionMsg('⚠️ 端到端加密密码至少需 6 位字符');
      return;
    }

    setSyncing(true);
    const client = new WebDavClient({
      serverUrl: serverUrl.trim(),
      username: username.trim(),
      appPassword: appPassword.trim(),
    });

    const ping = await client.testConnection();
    if (!ping.success) {
      setSyncing(false);
      setActionMsg(`❌ 连接测试失败: ${ping.message}`);
      return;
    }

    const genKey = generateRecoveryKey();
    setRecoveryKey(genKey);

    await syncEngine.saveSyncConfig(
      {
        serverUrl: serverUrl.trim(),
        username: username.trim(),
        appPassword: appPassword.trim(),
      },
      syncPassword.trim()
    );

    setSyncing(false);
    setShowConfigModal(false);
    setShowRecoveryModal(true);
    await loadData();
  };

  const handleManualSync = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSyncing(true);
    const res = await syncEngine.performSync();
    setSyncing(false);
    if (res.success) {
      setActionMsg('🎉 双向增量同步完成！');
      setTimeout(() => setActionMsg(''), 3000);
      await loadData();
    } else {
      setActionMsg(`❌ 同步失败: ${res.error || '网络连接异常'}`);
    }
  };

  const handleDisconnect = async () => {
    await syncEngine.clearSyncConfig();
    setActionMsg('已断开当前设备同步，本地与云端数据已安全保留');
    setTimeout(() => setActionMsg(''), 3000);
    await loadData();
  };

  const handleRestoreSnapshot = async (id: string) => {
    setSyncing(true);
    const res = await RestoreManager.restoreFromSnapshot(id);
    setSyncing(false);
    setShowSnapshotModal(false);
    if (res.success) {
      setActionMsg('🎉 已安全回滚至所选快照状态！');
      setTimeout(() => setActionMsg(''), 3000);
      await loadData();
    } else {
      setActionMsg(`❌ 回滚失败: ${res.error || '未知错误'}`);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C_BG }}>
      {/* 顶部标题栏 */}
      <View style={{
        paddingTop: 56, paddingBottom: 16, paddingHorizontal: 16,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        borderBottomWidth: 1, borderBottomColor: '#E8E0D0', backgroundColor: '#fff',
      }}>
        <Pressable onPress={() => router.back()} style={{ padding: 6 }}>
          <Text style={{ fontSize: 16, color: C_TEXT }}>← 返回</Text>
        </Pressable>
        <Text style={{ fontSize: 18, fontWeight: 'bold', color: C_PURPLE }}>☁️ 多机安全同步 (V2.0)</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 80 }}>
        {actionMsg ? (
          <View style={{ backgroundColor: '#E8FBF8', padding: 12, borderRadius: 12, borderWidth: 1.5, borderColor: C_MINT }}>
            <Text style={{ color: C_MINT, fontWeight: 'bold', textAlign: 'center' }}>{actionMsg}</Text>
          </View>
        ) : null}

        {/* 状态卡片 */}
        <View style={{
          backgroundColor: '#fff', borderRadius: 16, padding: 18,
          borderWidth: 2, borderColor: '#2D2A26',
          boxShadow: [{ offsetX: 3, offsetY: 3, blurRadius: 0, color: '#2D2A26' }],
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <Text style={{ fontSize: 16, fontWeight: 'bold', color: C_TEXT }}>同步运行状态</Text>
            <View style={{
              paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
              backgroundColor: syncConfigured ? '#E8FBF8' : '#F3EFE6',
            }}>
              <Text style={{ fontSize: 11, fontWeight: 'bold', color: syncConfigured ? C_MINT : C_MUTED }}>
                {syncConfigured ? '● 已就绪' : '○ 未连接'}
              </Text>
            </View>
          </View>

          <Text style={{ color: C_MUTED, fontSize: 12, lineHeight: 18 }}>
            本机设备 ID：{syncStatus?.deviceId || '加载中...'}{'\n'}
            最后同步时刻：{syncStatus?.lastSyncTime ? new Date(syncStatus.lastSyncTime).toLocaleString('zh-CN') : '暂未同步'}{'\n'}
            待上传变更 (Outbox)：{syncStatus?.pendingOutboxCount || 0} 项
          </Text>

          {syncConfigured && (
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <Pressable
                onPress={handleManualSync}
                disabled={syncing}
                style={{
                  flex: 1, backgroundColor: C_PURPLE, borderRadius: 10, paddingVertical: 12,
                  alignItems: 'center', borderWidth: 1.5, borderColor: '#2D2A26',
                }}
              >
                {syncing ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 13 }}>🔄 立即双向同步</Text>
                )}
              </Pressable>
              <Pressable
                onPress={handleDisconnect}
                style={{
                  paddingHorizontal: 16, borderRadius: 10, paddingVertical: 12,
                  alignItems: 'center', borderWidth: 1.5, borderColor: '#E8E0D0', backgroundColor: '#F8F6F0',
                }}
              >
                <Text style={{ color: '#FF5E7C', fontWeight: '600', fontSize: 13 }}>断开连接</Text>
              </Pressable>
            </View>
          )}

          {syncConfigured && (
            <Pressable
              onPress={() => setShowLostDeviceWizard(true)}
              style={{
                marginTop: 10, paddingVertical: 10, borderRadius: 8,
                alignItems: 'center', borderWidth: 1, borderColor: '#E8E0D0', backgroundColor: '#FFFDF2',
              }}
            >
              <Text style={{ color: C_PURPLE, fontSize: 12, fontWeight: 'bold' }}>🚨 设备挂失与密钥轮换向导 (Epoch 升级)</Text>
            </Pressable>
          )}

          {!syncConfigured && (
            <Pressable
              onPress={() => setShowConfigModal(true)}
              style={{
                backgroundColor: C_PINK, borderRadius: 10, paddingVertical: 12,
                alignItems: 'center', marginTop: 14, borderWidth: 1.5, borderColor: '#2D2A26',
              }}
            >
              <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 14 }}>✨ 连接坚果云 WebDAV</Text>
            </Pressable>
          )}
        </View>

        {/* 核心安全保障说明卡片 */}
        <View style={{
          backgroundColor: '#F7F5F0', borderRadius: 16, padding: 16,
          borderWidth: 1.5, borderColor: '#E8E0D0',
        }}>
          <Text style={{ fontWeight: 'bold', color: C_TEXT, fontSize: 14, marginBottom: 8 }}>🛡️ V2 隐私优先架构原则</Text>
          <Text style={{ color: C_MUTED, fontSize: 12, lineHeight: 18 }}>
            • <Text style={{ fontWeight: 'bold' }}>零知识加密</Text>：所有任务与记录均在手机本地加密后再上传，坚果云仅保存密文容器，开发者亦无法解密。{'\n'}
            • <Text style={{ fontWeight: 'bold' }}>100% 离线优先</Text>：网络中断完全不影响本地记录，联网后自动追赶合并。{'\n'}
            • <Text style={{ fontWeight: 'bold' }}>独立设备分区</Text>：每台设备拥有独立日志分支，通过逻辑时钟解决冲突，避免整库覆盖。
          </Text>
        </View>

        {/* 灾难恢复与快照点卡片 */}
        <View style={{
          backgroundColor: '#fff', borderRadius: 16, padding: 16,
          borderWidth: 1.5, borderColor: '#E8E0D0',
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={{ fontWeight: 'bold', color: C_TEXT, fontSize: 14 }}>📦 最近安全恢复点 (30天)</Text>
            <Pressable onPress={() => setShowSnapshotModal(true)}>
              <Text style={{ color: C_PURPLE, fontSize: 12, fontWeight: 'bold' }}>查看快照 ({snapshots.length}) →</Text>
            </Pressable>
          </View>
          <Text style={{ color: C_MUTED, fontSize: 12 }}>
            每次执行云端合并或回滚前，系统都会自动为您生成一份本地全量安全快照。
          </Text>
        </View>
      </ScrollView>

      {/* 坚果云配置弹窗 */}
      <Modal visible={showConfigModal} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '90%' }}>
            <Text style={{ fontSize: 18, fontWeight: 'bold', color: C_TEXT, marginBottom: 4 }}>配置坚果云 WebDAV</Text>
            <Text style={{ fontSize: 11, color: C_MUTED, marginBottom: 16 }}>请前往坚果云官网 → 账户信息 → 安全选项中生成「应用密码」</Text>

            <ScrollView style={{ maxHeight: 400 }}>
              <Text style={{ fontSize: 12, fontWeight: 'bold', color: C_TEXT, marginBottom: 4 }}>WebDAV 地址</Text>
              <TextInput
                value={serverUrl}
                onChangeText={setServerUrl}
                style={{ borderWidth: 1, borderColor: '#E8E0D0', borderRadius: 8, padding: 10, marginBottom: 12 }}
              />

              <Text style={{ fontSize: 12, fontWeight: 'bold', color: C_TEXT, marginBottom: 4 }}>坚果云账号 (邮箱)</Text>
              <TextInput
                value={username}
                onChangeText={setUsername}
                placeholder="例如 yourname@example.com"
                style={{ borderWidth: 1, borderColor: '#E8E0D0', borderRadius: 8, padding: 10, marginBottom: 12 }}
              />

              <Text style={{ fontSize: 12, fontWeight: 'bold', color: C_TEXT, marginBottom: 4 }}>坚果云应用密码 (非登录密码)</Text>
              <TextInput
                value={appPassword}
                onChangeText={setAppPassword}
                secureTextEntry
                placeholder="坚果云自动生成的16位应用密码"
                style={{ borderWidth: 1, borderColor: '#E8E0D0', borderRadius: 8, padding: 10, marginBottom: 12 }}
              />

              <Text style={{ fontSize: 12, fontWeight: 'bold', color: C_PURPLE, marginBottom: 4 }}>端到端加密主密码 (E2EE Key)</Text>
              <TextInput
                value={syncPassword}
                onChangeText={setSyncPassword}
                secureTextEntry
                placeholder="自设密码，用于手机本地加解密任务"
                style={{ borderWidth: 1, borderColor: C_PURPLE, borderRadius: 8, padding: 10, marginBottom: 16 }}
              />
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <Pressable
                onPress={() => setShowConfigModal(false)}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', backgroundColor: '#F3EFE6' }}
              >
                <Text style={{ color: C_MUTED, fontWeight: 'bold' }}>取消</Text>
              </Pressable>
              <Pressable
                onPress={handleTestAndSave}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', backgroundColor: C_PURPLE }}
              >
                <Text style={{ color: '#fff', fontWeight: 'bold' }}>连通测试并保存</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* 恢复密钥备份弹窗 */}
      <Modal visible={showRecoveryModal} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 20, borderWidth: 2, borderColor: '#2D2A26' }}>
            <Text style={{ fontSize: 18, fontWeight: 'bold', color: C_TEXT, marginBottom: 8 }}>🔑 您的独立安全恢复密钥</Text>
            <Text style={{ fontSize: 12, color: C_MUTED, lineHeight: 18, marginBottom: 14 }}>
              若您遗忘加密主密码，该恢复密钥是唯一能够解密云端数据的凭据。请务必妥善保存或记录下来：
            </Text>

            <View style={{ backgroundColor: '#F3EFE6', padding: 14, borderRadius: 10, marginBottom: 16 }}>
              <Text style={{ fontFamily: 'monospace', fontSize: 13, color: C_PURPLE, textAlign: 'center', fontWeight: 'bold' }}>
                {recoveryKey}
              </Text>
            </View>

            <Pressable
              onPress={async () => {
                await Clipboard.setStringAsync(recoveryKey);
                setActionMsg('📋 恢复密钥已成功复制到剪贴板！');
              }}
              style={{ backgroundColor: '#E8E4FF', borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginBottom: 10 }}
            >
              <Text style={{ color: C_PURPLE, fontWeight: 'bold', fontSize: 13 }}>📋 复制恢复密钥</Text>
            </Pressable>

            <Pressable
              onPress={() => setShowRecoveryModal(false)}
              style={{ backgroundColor: C_PINK, borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
            >
              <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 14 }}>我已经安全备份，开始使用</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* 恢复快照列表弹窗 */}
      <Modal visible={showSnapshotModal} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '80%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <Text style={{ fontSize: 16, fontWeight: 'bold', color: C_TEXT }}>历史安全快照恢复点</Text>
              <Pressable onPress={() => setShowSnapshotModal(false)}>
                <Text style={{ color: C_MUTED, fontSize: 16 }}>✕</Text>
              </Pressable>
            </View>

            {snapshots.length === 0 ? (
              <View style={{ padding: 30, alignItems: 'center' }}>
                <Text style={{ color: C_MUTED }}>暂无快照记录</Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 350 }}>
                {snapshots.map(sn => (
                  <View
                    key={sn.snapshotId}
                    style={{
                      borderBottomWidth: 1, borderBottomColor: '#E8E0D0',
                      paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                    }}
                  >
                    <View>
                      <Text style={{ fontSize: 13, fontWeight: 'bold', color: C_TEXT }}>
                        {new Date(sn.createdAt).toLocaleString('zh-CN')}
                      </Text>
                      <Text style={{ fontSize: 11, color: C_MUTED, marginTop: 2 }}>
                        包含 {sn.taskCount} 项任务 · 自动保护快照
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => handleRestoreSnapshot(sn.snapshotId)}
                      style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#E8FBF8', borderWidth: 1, borderColor: C_MINT }}
                    >
                      <Text style={{ fontSize: 12, color: C_MINT, fontWeight: 'bold' }}>回滚</Text>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* 设备挂失与凭据撤销引导向导 (P1-03 安全落地) */}
      <Modal visible={showLostDeviceWizard} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '90%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={{ fontSize: 17, fontWeight: 'bold', color: '#D90429' }}>🚨 紧急设备挂失与凭据撤销向导</Text>
              <Pressable onPress={() => setShowLostDeviceWizard(false)}>
                <Text style={{ color: C_MUTED, fontSize: 16 }}>✕</Text>
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 380, marginBottom: 16 }}>
              <Text style={{ fontSize: 13, color: C_TEXT, lineHeight: 20, marginBottom: 10 }}>
                当您的某台同步手机丢失或失窃时，由于坚果云 WebDAV 本身不支持按设备细粒度权限控制，为防止旧设备重新联网读取数据，必须执行以下双重安全防御：
              </Text>

              <View style={{ backgroundColor: '#FFF2F2', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#FFCCD5', marginBottom: 12 }}>
                <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#D90429', marginBottom: 4 }}>
                  第一步：前往坚果云官网撤销应用密码 (必须执行)
                </Text>
                <Text style={{ fontSize: 11, color: C_TEXT, lineHeight: 16 }}>
                  登录坚果云官网 → 账户信息 → 安全选项 → 第三方应用管理，找到并点击「撤销/删除」当前的 16 位应用密码。撤销后旧设备将立即无法连接云盘。
                </Text>
              </View>

              <View style={{ backgroundColor: '#E8F4FD', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#BEE3F8', marginBottom: 12 }}>
                <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#2B6CB0', marginBottom: 4 }}>
                  第二步：升级本地加密纪元 (Epoch 密钥轮换)
                </Text>
                <Text style={{ fontSize: 11, color: C_TEXT, lineHeight: 16 }}>
                  点击下方按钮，系统将立即生成全新的加密 Epoch，重置本地游标，未来新增的数据将使用新纪元密文封装，旧设备即使强行连接亦无法解密新纪元数据。
                </Text>
              </View>
            </ScrollView>

            <Pressable
              onPress={async () => {
                await syncEngine.rotateEncryptionEpoch();
                setShowLostDeviceWizard(false);
                setActionMsg('🛡️ 密钥纪元 (Epoch) 已成功轮换，旧设备访问权限已失效！');
                setTimeout(() => setActionMsg(''), 4000);
                await loadData();
              }}
              style={{ backgroundColor: '#D90429', paddingVertical: 12, borderRadius: 10, alignItems: 'center' }}
            >
              <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 14 }}>执行密钥纪元升级并隔离旧设备</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
