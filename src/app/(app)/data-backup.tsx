/**
 * 数据备份与恢复页面（PRD §7.1–7.4）
 * - 导出：SHA256 签名 JSON → 系统分享
 * - 导入：文件选择 / 粘贴 → 异步验签 → Schema Migration → 字段截断 → 冲突策略弹窗
 * - 策略：覆盖 / 跳过 / 重命名（§7.4）
 */
import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import {
  exportAllData,
  parseAndVerifyBackup,
  importAllData,
  scanTitleConflicts,
  ImportConflictStrategy,
  BackupData,
} from '@/db/api';

const C_BG     = '#FFFDF2';
const C_PINK   = '#FF5E7C';
const C_PURPLE = '#6C63FF';
const C_MINT   = '#2EC4B6';
const C_TEXT   = '#333333';
const C_MUTED  = '#888888';

// ─── 通用确认弹窗 ─────────────────────────────────────────────
function ConfirmModal({
  visible, title, message, confirmLabel, confirmColor, onConfirm, onCancel,
}: {
  visible: boolean; title: string; message: string;
  confirmLabel: string; confirmColor: string;
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: 'rgba(51,33,66,0.45)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 }}>
        <View style={{ backgroundColor: C_BG, borderRadius: 24, padding: 28, width: '100%', boxShadow: [{ offsetX: 0, offsetY: 8, blurRadius: 32, color: 'rgba(0,0,0,0.12)' }] }}>
          <Text style={{ color: C_TEXT, fontSize: 18, fontWeight: 'bold', marginBottom: 10 }}>{title}</Text>
          <Text style={{ color: C_MUTED, fontSize: 13, lineHeight: 20, marginBottom: 22 }}>{message}</Text>
          <Pressable onPress={onConfirm} style={{ backgroundColor: confirmColor, borderRadius: 14, paddingVertical: 13, alignItems: 'center', marginBottom: 10 }}>
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>{confirmLabel}</Text>
          </Pressable>
          <Pressable onPress={onCancel} style={{ alignItems: 'center', paddingVertical: 8 }}>
            <Text style={{ color: C_MUTED, fontSize: 13 }}>取消</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ─── §7.4 冲突策略弹窗（底部 Sheet）────────────────────────────
function ConflictModal({
  visible, conflicts, strategy, onStrategyChange, onConfirm, onCancel,
}: {
  visible: boolean;
  conflicts: string[];
  strategy: ImportConflictStrategy;
  onStrategyChange: (s: ImportConflictStrategy) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const OPTIONS: { key: ImportConflictStrategy; label: string; emoji: string; desc: string; color: string }[] = [
    { key: 'overwrite', label: '覆盖', emoji: '✏️', desc: '用备份任务替换现有同名任务', color: C_PINK },
    { key: 'skip',      label: '跳过', emoji: '⏭️', desc: '保留现有任务，忽略备份中同名任务', color: C_MINT },
    { key: 'rename',    label: '重命名', emoji: '📝', desc: '备份任务加日期后缀导入，两者都保留', color: C_PURPLE },
  ];
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: 'rgba(51,33,66,0.45)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: C_BG, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 40 }}>
          <Text style={{ color: C_TEXT, fontSize: 17, fontWeight: 'bold', marginBottom: 6 }}>
            ⚠️ 检测到 {conflicts.length} 个同名任务
          </Text>
          <Text style={{ color: C_MUTED, fontSize: 12, lineHeight: 18, marginBottom: 14 }}>
            请选择冲突处理策略（对全部 {conflicts.length} 个同名任务生效）
          </Text>
          {conflicts.slice(0, 3).map((t, i) => (
            <View key={i} style={{ backgroundColor: '#FFF0F4', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 5 }}>
              <Text style={{ color: C_PINK, fontSize: 12 }} numberOfLines={1}>· {t}</Text>
            </View>
          ))}
          {conflicts.length > 3 && (
            <Text style={{ color: C_MUTED, fontSize: 11, marginBottom: 4 }}>…还有 {conflicts.length - 3} 个</Text>
          )}
          <View style={{ gap: 8, marginTop: 12, marginBottom: 16 }}>
            {OPTIONS.map(opt => (
              <Pressable
                key={opt.key}
                onPress={() => onStrategyChange(opt.key)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14,
                  backgroundColor: strategy === opt.key ? `${opt.color}14` : '#F5F2EE',
                  borderWidth: 1.5, borderColor: strategy === opt.key ? opt.color : 'transparent',
                }}
              >
                <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: strategy === opt.key ? opt.color : '#CCC', alignItems: 'center', justifyContent: 'center' }}>
                  {strategy === opt.key && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: opt.color }} />}
                </View>
                <Text style={{ fontSize: 16 }}>{opt.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: strategy === opt.key ? opt.color : C_TEXT, fontSize: 14, fontWeight: '600' }}>{opt.label}</Text>
                  <Text style={{ color: C_MUTED, fontSize: 11, marginTop: 2 }}>{opt.desc}</Text>
                </View>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={onConfirm} style={{ backgroundColor: C_PURPLE, borderRadius: 16, paddingVertical: 14, alignItems: 'center', marginBottom: 10 }}>
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>确认导入</Text>
          </Pressable>
          <Pressable onPress={onCancel} style={{ alignItems: 'center', paddingVertical: 8 }}>
            <Text style={{ color: C_MUTED, fontSize: 13 }}>取消</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export default function DataBackupScreen() {
  const router = useRouter();

  // ── 导出状态 ──
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState('');

  // ── 导入状态 ──
  const [importJson, setImportJson] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [importMsgOk, setImportMsgOk] = useState(true);
  // §7.4 冲突策略（默认跳过，最安全）
  const [strategy, setStrategy] = useState<ImportConflictStrategy>('skip');
  const [showConfirm, setShowConfirm] = useState(false);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [showConflict, setShowConflict] = useState(false);
  const [parsedBackup, setParsedBackup] = useState<BackupData | null>(null);

  const exportBtnScale = useSharedValue(1);
  const importBtnScale = useSharedValue(1);
  const exportBtnStyle = useAnimatedStyle(() => ({ transform: [{ scale: exportBtnScale.value }] }));
  const importBtnStyle = useAnimatedStyle(() => ({ transform: [{ scale: importBtnScale.value }] }));

  // ─── 导出 ────────────────────────────────────────────────────
  const handleExport = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    exportBtnScale.value = withSpring(0.93, {}, () => { exportBtnScale.value = withSpring(1); });
    setExporting(true);
    setExportMsg('');
    try {
      const json = await exportAllData();
      const fileName = `mochi_ddl_backup_${new Date().toISOString().slice(0, 10)}.json`;
      const filePath = (FileSystem.documentDirectory ?? '') + fileName;
      await FileSystem.writeAsStringAsync(filePath, json, { encoding: FileSystem.EncodingType.UTF8 });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(filePath, { mimeType: 'application/json', dialogTitle: '保存/分享麻糬 DDL 备份', UTI: 'public.json' });
        setExportMsg('✅ 备份已导出！请保存到安全位置 🍡');
      } else {
        setExportMsg(`✅ 备份已写入：${filePath}`);
      }
    } catch (e) {
      setExportMsg(`❌ 导出失败：${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  // ─── 从文件选择器读取 ─────────────────────────────────────────
  const handlePickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'], copyToCacheDirectory: true });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset?.uri) return;
      const text = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.UTF8 });
      setImportJson(text);
      setImportMsg('✅ 文件已读取，点击「验证并导入」继续');
      setImportMsgOk(true);
    } catch (e) {
      setImportMsg(`❌ 读取文件失败：${(e as Error).message}`);
      setImportMsgOk(false);
    }
  };

  // ─── 触发导入：§7.1 异步验签 + §7.2 Schema + §7.4 冲突扫描 ──
  const handleImportPress = async () => {
    if (!importJson.trim()) {
      setImportMsg('⚠️ 请先选择文件或粘贴备份 JSON');
      setImportMsgOk(false);
      return;
    }
    setImporting(true);
    setImportMsg('🔍 正在验证备份文件…');
    setImportMsgOk(true);
    try {
      const backup = await parseAndVerifyBackup(importJson.trim());
      setParsedBackup(backup);
      setImporting(false);
      setImportMsg('');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const titleConflicts = await scanTitleConflicts(backup);
      if (titleConflicts.length > 0) {
        setConflicts(titleConflicts);
        setShowConflict(true);
      } else {
        setShowConfirm(true);
      }
    } catch (e) {
      setImportMsg(`❌ 校验失败：${(e as Error).message}`);
      setImportMsgOk(false);
      setImporting(false);
    }
  };

  // ─── 确认导入（冲突已决策 或 无冲突）────────────────────────
  const handleConfirmImport = async () => {
    setShowConfirm(false);
    setShowConflict(false);
    if (!parsedBackup) return;
    setImporting(true);
    setImportMsg('');
    try {
      const { imported, skipped, truncated } = await importAllData(parsedBackup, strategy);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const truncMsg = truncated > 0 ? `，${truncated} 个字段已截断` : '';
      setImportMsg(`✅ 导入成功！写入 ${imported} 条，跳过 ${skipped} 条${truncMsg}`);
      setImportMsgOk(true);
      setImportJson('');
      setParsedBackup(null);
    } catch (e) {
      setImportMsg(`❌ 导入失败：${(e as Error).message}`);
      setImportMsgOk(false);
    } finally {
      setImporting(false);
    }
  };

  // ─── 收起/展开导入区 ─────────────────────────────────────────
  const [importExpanded, setImportExpanded] = useState(false);
  const sectionH = useSharedValue(0);
  const sectionStyle = useAnimatedStyle(() => ({ maxHeight: sectionH.value, overflow: 'hidden' }));
  const toggleImport = () => {
    const next = !importExpanded;
    setImportExpanded(next);
    sectionH.value = withTiming(next ? 700 : 0, { duration: 300 });
  };

  return (
    <View style={{ flex: 1, backgroundColor: C_BG }}>
      <ConfirmModal
        visible={showConfirm}
        title="确认导入备份？"
        message="无同名冲突，将直接写入备份数据。"
        confirmLabel="确认导入"
        confirmColor={C_PURPLE}
        onConfirm={handleConfirmImport}
        onCancel={() => setShowConfirm(false)}
      />
      <ConflictModal
        visible={showConflict}
        conflicts={conflicts}
        strategy={strategy}
        onStrategyChange={setStrategy}
        onConfirm={handleConfirmImport}
        onCancel={() => setShowConflict(false)}
      />

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingTop: 56, paddingBottom: 100, paddingHorizontal: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* 顶栏 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <Pressable onPress={() => router.back()} style={{ padding: 6 }}>
            <Text style={{ color: C_PURPLE, fontSize: 22 }}>←</Text>
          </Pressable>
          <View>
            <Text style={{ color: C_MUTED, fontSize: 11 }}>本地存储 · 完全离线</Text>
            <Text style={{ color: C_PURPLE, fontSize: 22, fontWeight: 'bold' }}>💾 数据备份</Text>
          </View>
        </View>

        {/* 说明卡 */}
        <View style={{ backgroundColor: '#F0EDFF', borderRadius: 16, padding: 16, marginBottom: 20, borderWidth: 1.5, borderColor: '#D8D4FF' }}>
          <Text style={{ color: C_PURPLE, fontSize: 13, fontWeight: '700', marginBottom: 6 }}>📌 使用说明</Text>
          <Text style={{ color: '#555', fontSize: 12, lineHeight: 20 }}>
            • 所有数据存储于设备本地，<Text style={{ fontWeight: '700' }}>不上传云端</Text>{'\n'}
            • 换机或重装前请先导出备份{'\n'}
            • 备份文件包含 SHA256 签名，防止篡改{'\n'}
            • 导入时检测同名任务，可选覆盖 / 跳过 / 重命名
          </Text>
        </View>

        {/* ── 导出区 ── */}
        <View style={{ backgroundColor: '#FFFFFF', borderRadius: 20, padding: 20, marginBottom: 16, boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 10, color: 'rgba(0,0,0,0.06)' }] }}>
          <Text style={{ color: C_TEXT, fontSize: 16, fontWeight: 'bold', marginBottom: 4 }}>📤 导出备份</Text>
          <Text style={{ color: C_MUTED, fontSize: 12, marginBottom: 16, lineHeight: 18 }}>
            将全部任务、时间记录、语录、成就等数据导出为 JSON 文件（含 SHA256 签名），通过系统分享保存到安全位置。
          </Text>
          {exportMsg ? (
            <View style={{ backgroundColor: exportMsg.startsWith('✅') ? '#EDFAF7' : '#FFF0F4', borderRadius: 12, padding: 10, marginBottom: 12 }}>
              <Text style={{ color: exportMsg.startsWith('✅') ? C_MINT : C_PINK, fontSize: 12 }}>{exportMsg}</Text>
            </View>
          ) : null}
          <Animated.View style={exportBtnStyle}>
            <Pressable onPress={handleExport} disabled={exporting} style={{ backgroundColor: C_MINT, borderRadius: 16, paddingVertical: 14, alignItems: 'center', boxShadow: [{ offsetX: 0, offsetY: 4, blurRadius: 14, color: 'rgba(46,196,182,0.35)' }] }}>
              {exporting ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>📤 立即导出并分享</Text>}
            </Pressable>
          </Animated.View>
        </View>

        {/* ── 导入区 ── */}
        <View style={{ backgroundColor: '#FFFFFF', borderRadius: 20, padding: 20, marginBottom: 16, boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 10, color: 'rgba(0,0,0,0.06)' }] }}>
          <Pressable onPress={toggleImport} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: importExpanded ? 16 : 0 }}>
            <View>
              <Text style={{ color: C_TEXT, fontSize: 16, fontWeight: 'bold' }}>📥 导入备份</Text>
              <Text style={{ color: C_MUTED, fontSize: 12, marginTop: 2 }}>从备份文件恢复数据</Text>
            </View>
            <Text style={{ color: C_MUTED, fontSize: 20 }}>{importExpanded ? '▲' : '▼'}</Text>
          </Pressable>

          <Animated.View style={sectionStyle}>
            <Pressable onPress={handlePickFile} style={{ borderWidth: 1.5, borderColor: C_PURPLE, borderStyle: 'dashed', borderRadius: 14, padding: 14, alignItems: 'center', marginBottom: 12, backgroundColor: '#F8F7FF' }}>
              <Text style={{ fontSize: 24, marginBottom: 4 }}>📂</Text>
              <Text style={{ color: C_PURPLE, fontSize: 13, fontWeight: '600' }}>选择备份文件</Text>
              <Text style={{ color: C_MUTED, fontSize: 11, marginTop: 2 }}>.json 格式</Text>
            </Pressable>

            <Text style={{ color: C_MUTED, fontSize: 11, textAlign: 'center', marginBottom: 10 }}>— 或直接粘贴 JSON 文本 —</Text>

            <TextInput
              value={importJson}
              onChangeText={setImportJson}
              multiline
              placeholder={'在此粘贴备份 JSON…\n{"schema_version":3,"exportedAt":"..."}'}
              placeholderTextColor="#BBB"
              style={{ backgroundColor: '#F5F2EE', borderRadius: 12, padding: 12, fontSize: 11, color: C_TEXT, height: 100, textAlignVertical: 'top', marginBottom: 14, fontFamily: 'monospace' }}
            />

            <View style={{ backgroundColor: '#F5F2EE', borderRadius: 12, padding: 12, marginBottom: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
              <Text style={{ fontSize: 15 }}>ℹ️</Text>
              <Text style={{ color: C_MUTED, fontSize: 11, flex: 1, lineHeight: 17 }}>
                检测到同名任务时，将弹出覆盖 / 跳过 / 重命名三选一弹窗；无冲突则直接导入。
              </Text>
            </View>

            {importMsg ? (
              <View style={{ backgroundColor: importMsgOk ? '#EDFAF7' : '#FFF0F4', borderRadius: 12, padding: 10, marginBottom: 12 }}>
                <Text style={{ color: importMsgOk ? C_MINT : C_PINK, fontSize: 12 }}>{importMsg}</Text>
              </View>
            ) : null}

            <Animated.View style={importBtnStyle}>
              <Pressable onPress={handleImportPress} disabled={importing} style={{ backgroundColor: C_PURPLE, borderRadius: 16, paddingVertical: 14, alignItems: 'center', boxShadow: [{ offsetX: 0, offsetY: 4, blurRadius: 14, color: 'rgba(108,99,255,0.30)' }] }}>
                {importing ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>📥 验证并导入</Text>}
              </Pressable>
            </Animated.View>
          </Animated.View>
        </View>

        <Text style={{ color: C_MUTED, fontSize: 11, textAlign: 'center', lineHeight: 17, marginTop: 8 }}>
          备份文件包含 SHA256 签名校验，防止意外损坏{'\n'}请妥善保管备份文件 🍡
        </Text>
      </ScrollView>
    </View>
  );
}
