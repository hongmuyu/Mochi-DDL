/**
 * 自定义语录管理页
 * 功能：展示所有语录（含内置）、增删改查、"仅使用我的语录"开关、导入/导出
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import {
  getAllQuotes,
  addQuote,
  updateQuoteText,
  toggleQuoteActive,
  deleteQuote,
  getOnlyMine,
  setOnlyMine,
  exportUserQuotes,
  importQuotesFromFile,
  Quote,
} from '@/lib/quotesDb';

const C_BG     = '#FFFDF2';
const C_PINK   = '#FF5E7C';
const C_PURPLE = '#6C63FF';
const C_MINT   = '#2EC4B6';
const C_YELLOW = '#FFD166';
const C_TEXT   = '#333333';
const C_MUTED  = '#888888';
const C_ORANGE = '#FF8C00';

// §4.2 字数进度颜色（三段）
const countColor = (n: number) => n <= 40 ? C_MUTED : n <= 45 ? C_ORANGE : C_PINK;
const barColor   = (n: number) => n <= 40 ? C_MINT  : n <= 45 ? C_ORANGE : C_PINK;

export default function QuotesScreen() {
  const router = useRouter();

  const [quotes, setQuotes]       = useState<Quote[]>([]);
  const [loading, setLoading]     = useState(true);
  const [onlyMine, setOnlyMineState] = useState(false);

  // 弹窗状态
  const [modalVisible, setModalVisible] = useState(false);
  const [editTarget, setEditTarget]     = useState<Quote | null>(null); // null = 新增
  const [inputText, setInputText]       = useState('');
  const [inputError, setInputError]     = useState('');
  const [saving, setSaving]             = useState(false);

  // 操作反馈
  const [feedback, setFeedback] = useState('');
  const showFeedback = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(''), 2600);
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [list, om] = await Promise.all([getAllQuotes(), getOnlyMine()]);
      setQuotes(list);
      setOnlyMineState(om);
    } catch { }
    finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { loadAll(); }, [loadAll]));

  // 开关"仅使用我的语录"
  const handleToggleOnlyMine = async (v: boolean) => {
    setOnlyMineState(v);
    await setOnlyMine(v);
  };

  const inputRef = useRef<TextInput>(null);

  // 打开新增弹窗
  const openAdd = () => {
    setEditTarget(null);
    setInputText('');
    setInputError('');
    setModalVisible(true);
  };

  // 打开编辑弹窗
  const openEdit = (q: Quote) => {
    setEditTarget(q);
    setInputText(q.text);
    setInputError('');
    setModalVisible(true);
  };

  // 保存（新增或编辑）
  const handleSave = async () => {
    const text = inputText.trim();
    if (!text) { setInputError('语录不能为空哦~'); return; }
    if (text.length > 50) { setInputError('最多 50 个字'); return; }
    setSaving(true);
    try {
      if (editTarget) {
        await updateQuoteText(editTarget.id, text);
        showFeedback('✅ 语录已更新');
      } else {
        await addQuote(text);
        showFeedback('✨ 新语录已添加');
      }
      setModalVisible(false);
      await loadAll();
    } catch {
      setInputError('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  // 切换激活状态
  const handleToggle = async (q: Quote) => {
    await toggleQuoteActive(q.id, !q.is_active);
    await loadAll();
  };

  // 删除语录
  const handleDelete = async (q: Quote) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    await deleteQuote(q.id);
    showFeedback('🗑 已删除');
    await loadAll();
  };

  // 导出
  const handleExport = async () => {
    try {
      const uri = await exportUserQuotes();
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, { mimeType: 'application/json' });
      } else {
        showFeedback(`已导出到：${uri}`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '导出失败';
      showFeedback(`导出失败：${msg}`);
    }
  };

  // 导入
  const handleImport = async () => {
    try {
      const { added, skipped } = await importQuotesFromFile();
      await loadAll();
      showFeedback(`🎉 导入完成：新增 ${added} 条，跳过 ${skipped} 条`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '导入失败';
      showFeedback(`导入失败：${msg}`);
    }
  };

  const userQuotes    = quotes.filter(q => !q.is_builtin);
  const builtinQuotes = quotes.filter(q => q.is_builtin);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: C_BG, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 36 }}>💬</Text>
        <ActivityIndicator color={C_PURPLE} style={{ marginTop: 12 }} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C_BG }}>
      {/* 编辑/新增 弹窗 — §4.1 Bottom Sheet + KeyboardAvoidingView（§5.1 键盘适配） */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior="padding"
          style={{ flex: 1 }}
        >
          <Pressable
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'flex-end' }}
            onPress={() => setModalVisible(false)}
          >
            <Pressable onPress={() => {}}>
              <View style={{
                backgroundColor: '#FFFDF2',
                borderTopLeftRadius: 28, borderTopRightRadius: 28,
                paddingHorizontal: 24, paddingTop: 12, paddingBottom: 36,
              }}>
                {/* 拖把手 */}
                <View style={{ width: 40, height: 4, backgroundColor: '#E8E0D0', borderRadius: 2, alignSelf: 'center', marginBottom: 16 }} />

                {/* 标题栏 */}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <Text style={{ color: C_PURPLE, fontSize: 18, fontWeight: 'bold' }}>
                    {editTarget ? '✏️ 编辑语录' : '✨ 添加新语录'}
                  </Text>
                  <Pressable onPress={() => setModalVisible(false)} style={{ padding: 4 }}>
                    <Text style={{ color: C_MUTED, fontSize: 20 }}>✕</Text>
                  </Pressable>
                </View>

                {/* 文本框 */}
                <TextInput
                  ref={inputRef}
                  value={inputText}
                  onChangeText={t => {
                    // §6.1 粘贴超限自动截断 + haptic
                    if (t.length > 50) {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      t = t.slice(0, 50);
                    }
                    // §6.1 到达上限时震动提示
                    if (t.length === 50 && inputText.length < 50) {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }
                    setInputText(t);
                    setInputError('');
                  }}
                  placeholder="写一句激励自己的话吧…"
                  placeholderTextColor="#999999"
                  multiline
                  maxLength={50}
                  autoFocus
                  style={{
                    backgroundColor: '#FFFFFF',
                    borderRadius: 14,
                    borderWidth: 1.5,
                    borderColor: inputError ? C_PINK : '#E8E0D0',
                    padding: 14,
                    fontSize: 16,
                    color: C_TEXT,
                    minHeight: 90,
                    textAlignVertical: 'top',
                  }}
                />

                {/* §4.1 字数提示 + 进度条 */}
                <View style={{ marginTop: 8, marginBottom: 4 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                    {inputError
                      ? <Text style={{ color: C_PINK, fontSize: 12 }}>{inputError}</Text>
                      : <Text style={{ color: C_MUTED, fontSize: 11 }}>第一人称更有代入感 ✨</Text>
                    }
                    {/* 三段颜色字数 */}
                    <Text style={{ color: countColor(inputText.length), fontSize: 13, fontWeight: '600' }}>
                      {inputText.length} / 50
                    </Text>
                  </View>
                  {/* 进度条 */}
                  <View style={{ height: 3, backgroundColor: '#EEE', borderRadius: 2, overflow: 'hidden' }}>
                    <View style={{
                      height: 3,
                      width: `${(inputText.length / 50) * 100}%`,
                      backgroundColor: barColor(inputText.length),
                      borderRadius: 2,
                    }} />
                  </View>
                  {/* §6.1 达到上限提示 */}
                  {inputText.length >= 50 && (
                    <Text style={{ color: C_PINK, fontSize: 11, marginTop: 4 }}>已达上限，无法继续输入</Text>
                  )}
                </View>

                {/* §8 取消 + 保存按钮 */}
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                  <Pressable
                    onPress={() => setModalVisible(false)}
                    style={{
                      flex: 1, paddingVertical: 13, borderRadius: 14,
                      backgroundColor: '#F0EDE0', alignItems: 'center',
                    }}
                  >
                    <Text style={{ color: C_MUTED, fontSize: 15, fontWeight: '600' }}>取消</Text>
                  </Pressable>
                  {/* §8 空内容保存按钮置灰 */}
                  <Pressable
                    onPress={handleSave}
                    disabled={saving || inputText.trim().length === 0}
                    style={{
                      flex: 2, paddingVertical: 13, borderRadius: 14, alignItems: 'center',
                      backgroundColor: inputText.trim().length === 0 ? '#D0CCEA' : C_PURPLE,
                    }}
                  >
                    {saving
                      ? <ActivityIndicator color="#fff" />
                      : <Text style={{ color: '#fff', fontSize: 15, fontWeight: 'bold' }}>保存</Text>
                    }
                  </Pressable>
                </View>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingTop: 56, paddingBottom: 100 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* 顶部标题 + 返回 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 20 }}>
          <Pressable onPress={() => router.back()} style={{ marginRight: 12, padding: 4 }}>
            <Text style={{ color: C_PURPLE, fontSize: 20 }}>‹</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C_MUTED, fontSize: 11 }}>激励语录</Text>
            <Text style={{ color: C_PURPLE, fontSize: 22, fontWeight: 'bold' }}>💬 我的激励语录</Text>
          </View>
        </View>

        {/* 操作反馈条 */}
        {feedback ? (
          <View style={{ marginHorizontal: 16, marginBottom: 12, backgroundColor: C_MINT, borderRadius: 12, padding: 10 }}>
            <Text style={{ color: '#fff', fontSize: 13, textAlign: 'center', fontWeight: '600' }}>{feedback}</Text>
          </View>
        ) : null}

        {/* 「仅使用我的语录」开关卡片 */}
        <View style={{
          backgroundColor: '#FFFFFF', borderRadius: 18,
          marginHorizontal: 16, marginBottom: 16,
          paddingHorizontal: 16, paddingVertical: 14,
          boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 8, color: 'rgba(0,0,0,0.06)' }],
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={{ color: C_TEXT, fontSize: 14, fontWeight: '600' }}>仅使用我的语录</Text>
              <Text style={{ color: C_MUTED, fontSize: 11, marginTop: 2 }}>
                开启后吉祥物只从你的自定义语录中随机抽取
              </Text>
            </View>
            <Switch
              value={onlyMine}
              onValueChange={handleToggleOnlyMine}
              trackColor={{ false: '#E8E0D0', true: C_PINK }}
              thumbColor="#FFFFFF"
            />
          </View>
        </View>

        {/* 导入/导出按钮 */}
        <View style={{ flexDirection: 'row', gap: 10, marginHorizontal: 16, marginBottom: 20 }}>
          <Pressable
            onPress={handleImport}
            style={{
              flex: 1, backgroundColor: '#FFFFFF', borderRadius: 14,
              paddingVertical: 12, alignItems: 'center',
              borderWidth: 1.5, borderColor: C_PURPLE,
            }}
          >
            <Text style={{ color: C_PURPLE, fontSize: 13, fontWeight: '700' }}>📥 导入语录</Text>
          </Pressable>
          <Pressable
            onPress={handleExport}
            style={{
              flex: 1, backgroundColor: '#FFFFFF', borderRadius: 14,
              paddingVertical: 12, alignItems: 'center',
              borderWidth: 1.5, borderColor: C_MINT,
            }}
          >
            <Text style={{ color: C_MINT, fontSize: 13, fontWeight: '700' }}>📤 导出语录</Text>
          </Pressable>
        </View>

        {/* 用户自定义语录区 */}
        <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
          <Text style={{ color: C_MUTED, fontSize: 11, marginBottom: 8 }}>
            ✏️ 我的语录（{userQuotes.length} 条）
          </Text>
          <View style={{
            backgroundColor: '#FFFFFF', borderRadius: 18,
            boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 8, color: 'rgba(0,0,0,0.06)' }],
            overflow: 'hidden',
          }}>
            {userQuotes.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 32 }}>
                <Text style={{ fontSize: 36 }}>🫙</Text>
                <Text style={{ color: C_MUTED, fontSize: 13, marginTop: 10, textAlign: 'center' }}>
                  还没有自定义语录{'\n'}点下方按钮添加一条吧~
                </Text>
              </View>
            ) : (
              userQuotes.map((q, idx) => (
                <QuoteRow
                  key={q.id}
                  quote={q}
                  noBorder={idx === userQuotes.length - 1}
                  onToggle={() => handleToggle(q)}
                  onEdit={() => openEdit(q)}
                  onDelete={() => handleDelete(q)}
                />
              ))
            )}
          </View>
        </View>

        {/* 添加按钮 */}
        <Pressable
          onPress={openAdd}
          style={{
            marginHorizontal: 16, marginTop: 8, marginBottom: 24,
            backgroundColor: C_PINK, borderRadius: 16,
            paddingVertical: 14, alignItems: 'center',
            boxShadow: [{ offsetX: 0, offsetY: 4, blurRadius: 14, color: 'rgba(255,94,124,0.35)' }],
          }}
        >
          <Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>+ 添加新语录</Text>
        </Pressable>

        {/* 内置语录区 */}
        <View style={{ paddingHorizontal: 16 }}>
          <Text style={{ color: C_MUTED, fontSize: 11, marginBottom: 8 }}>
            📦 内置语录（{builtinQuotes.length} 条，可单独禁用或删除）
          </Text>
          <View style={{
            backgroundColor: '#FFFFFF', borderRadius: 18,
            boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 8, color: 'rgba(0,0,0,0.06)' }],
            overflow: 'hidden',
          }}>
            {builtinQuotes.map((q, idx) => (
              <QuoteRow
                key={q.id}
                quote={q}
                noBorder={idx === builtinQuotes.length - 1}
                isBuiltin
                onToggle={() => handleToggle(q)}
                onDelete={() => handleDelete(q)}
              />
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

// 单条语录行
function QuoteRow({
  quote,
  noBorder,
  isBuiltin,
  onToggle,
  onEdit,
  onDelete,
}: {
  quote: Quote;
  noBorder?: boolean;
  isBuiltin?: boolean;
  onToggle: () => void;
  onEdit?: () => void;
  onDelete: () => void;
}) {
  return (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderBottomWidth: noBorder ? 0 : 1,
      borderBottomColor: '#F5F0E8',
      gap: 10,
      opacity: quote.is_active ? 1 : 0.45,
    }}>
      {/* 激活状态点 */}
      <View style={{
        width: 8, height: 8, borderRadius: 4,
        backgroundColor: quote.is_active ? '#2EC4B6' : '#D0C8BC',
        flexShrink: 0,
      }} />

      {/* 文本 */}
      <Text
        style={{ flex: 1, color: '#444', fontSize: 13, lineHeight: 20 }}
        numberOfLines={3}
      >
        {quote.text}
      </Text>

      {/* 操作区 */}
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {/* 激活/禁用 */}
        <Pressable
          onPress={onToggle}
          style={{
            width: 30, height: 30, borderRadius: 8,
            backgroundColor: quote.is_active ? '#E8F8F6' : '#F5F0E8',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 14 }}>{quote.is_active ? '✅' : '⬜'}</Text>
        </Pressable>
        {/* 编辑（仅用户语录） */}
        {!isBuiltin && onEdit && (
          <Pressable
            onPress={onEdit}
            style={{
              width: 30, height: 30, borderRadius: 8,
              backgroundColor: '#F0EDFF',
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 14 }}>✏️</Text>
          </Pressable>
        )}
        {/* 删除 */}
        <Pressable
          onPress={onDelete}
          style={{
            width: 30, height: 30, borderRadius: 8,
            backgroundColor: '#FFF0F4',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 14 }}>🗑️</Text>
        </Pressable>
      </View>
    </View>
  );
}
