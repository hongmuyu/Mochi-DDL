import React, { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { DatabaseHealth, resetAndRecreateDatabase, retryDatabaseInit } from '@/db/database';

interface DatabaseRecoveryModalProps {
  health: DatabaseHealth;
  onRecovered: () => void;
  onImportBackup?: () => void;
}

export function DatabaseRecoveryModal({
  health,
  onRecovered,
  onImportBackup,
}: DatabaseRecoveryModalProps) {
  const [retrying, setRetrying] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [msg, setMsg] = useState('');

  const isBlocked = health.status === 'corrupted' || health.status === 'migration_failed';

  if (!isBlocked && health.status !== 'degraded_web_memory') {
    return null;
  }

  // Web 端非阻断横幅
  if (health.status === 'degraded_web_memory') {
    return (
      <View style={{
        backgroundColor: '#FFF8E6',
        borderColor: '#FFD166',
        borderBottomWidth: 1.5,
        paddingHorizontal: 16,
        paddingVertical: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        zIndex: 9999,
      }}>
        <Text style={{ color: '#8A6D00', fontSize: 11, fontWeight: '600' }}>
          🌐 Web 预览模式：使用内存数据库，页面刷新后数据不保留。请在移动端体验完整持久化。
        </Text>
      </View>
    );
  }

  const handleRetry = async () => {
    setRetrying(true);
    setMsg('正在尝试重新挂载数据库…');
    try {
      const res = await retryDatabaseInit();
      if (res.status === 'ok') {
        setMsg('✅ 数据库已成功恢复连接！');
        setTimeout(() => onRecovered(), 600);
      } else {
        setMsg(`❌ 重试失败：${res.errorMessage ?? '未知原因'}`);
      }
    } catch (e) {
      setMsg(`❌ 重试异常：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRetrying(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    setMsg('正在重置并重建干净的本地数据库…');
    try {
      await resetAndRecreateDatabase();
      setMsg('✅ 数据库已重建，请重新开始或导入备份！');
      setTimeout(() => onRecovered(), 800);
    } catch (e) {
      setMsg(`❌ 重建失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setResetting(false);
    }
  };

  return (
    <View style={{
      position: 'absolute',
      inset: 0,
      backgroundColor: '#F7F5F0',
      zIndex: 99999,
      paddingHorizontal: 24,
      paddingTop: 64,
      paddingBottom: 40,
      justifyContent: 'space-between',
    }}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={{ alignItems: 'center', marginBottom: 20 }}>
          <Text style={{ fontSize: 56, marginBottom: 8 }}>🛡️</Text>
          <Text style={{ fontSize: 22, fontWeight: 'bold', color: '#2B2927' }}>
            数据库安全保护模式
          </Text>
          <Text style={{ fontSize: 13, color: '#A33A26', marginTop: 6, fontWeight: '600', textAlign: 'center' }}>
            检测到底层存储异常，已阻止进入常规界面以防数据假保存
          </Text>
        </View>

        <View style={{
          backgroundColor: '#FFFFFF',
          borderRadius: 18,
          borderWidth: 1.5,
          borderColor: '#DDD9D2',
          padding: 16,
          marginBottom: 18,
        }}>
          <Text style={{ fontSize: 14, fontWeight: 'bold', color: '#2B2927', marginBottom: 8 }}>
            📋 故障诊断报告
          </Text>
          <Text style={{ fontSize: 12, color: '#7D7975', lineHeight: 18 }}>
            • 当前状态：{health.status === 'corrupted' ? '数据库文件损坏或打不开' : '数据库版本迁移中断'}{'\n'}
            • 存储形态：{health.storageType === 'sqlite_file' ? '本地 SQLite 文件' : '内存临时库'}{'\n'}
            • 架构版本：v{health.schemaVersion}{'\n'}
            • 错误详情：{health.errorMessage || '无法获得有效连接句柄'}
          </Text>
        </View>

        <View style={{
          backgroundColor: '#FFF2EE',
          borderRadius: 18,
          borderWidth: 1.5,
          borderColor: '#A33A26',
          padding: 16,
          marginBottom: 20,
        }}>
          <Text style={{ fontSize: 13, fontWeight: 'bold', color: '#A33A26', marginBottom: 4 }}>
            💡 麻糬的建议
          </Text>
          <Text style={{ fontSize: 12, color: '#555', lineHeight: 19 }}>
            原数据库文件已完整保留，未做强制覆盖。建议优先点击「重试连接」，若由于升级中断可尝试「重试迁移」。若有历史导出的备份文件，可选择「从备份恢复」。
          </Text>
        </View>

        {msg ? (
          <View style={{
            backgroundColor: msg.startsWith('✅') ? '#EDFAF7' : '#FFF0F4',
            padding: 12,
            borderRadius: 12,
            marginBottom: 16,
          }}>
            <Text style={{
              color: msg.startsWith('✅') ? '#3D7A5A' : '#A33A26',
              fontSize: 12,
              fontWeight: '600',
              textAlign: 'center',
            }}>
              {msg}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={{ gap: 12 }}>
        <Pressable
          onPress={handleRetry}
          disabled={retrying || resetting}
          style={{
            backgroundColor: '#C85A32',
            borderRadius: 16,
            paddingVertical: 14,
            alignItems: 'center',
          }}
        >
          {retrying ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: 'bold' }}>
              🔄 尝试重新连接 / 重试迁移
            </Text>
          )}
        </Pressable>

        {onImportBackup && (
          <Pressable
            onPress={onImportBackup}
            disabled={retrying || resetting}
            style={{
              backgroundColor: '#3D7A5A',
              borderRadius: 16,
              paddingVertical: 14,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: 'bold' }}>
              📥 从已有全量备份文件恢复
            </Text>
          </Pressable>
        )}

        <Pressable
          onPress={handleReset}
          disabled={retrying || resetting}
          style={{
            backgroundColor: '#FFFFFF',
            borderWidth: 1.5,
            borderColor: '#A33A26',
            borderRadius: 16,
            paddingVertical: 14,
            alignItems: 'center',
          }}
        >
          {resetting ? (
            <ActivityIndicator color="#A33A26" />
          ) : (
            <Text style={{ color: '#A33A26', fontSize: 14, fontWeight: '600' }}>
              ⚠️ 清空损坏数据并全新重建
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}
