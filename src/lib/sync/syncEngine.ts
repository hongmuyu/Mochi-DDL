/**
 * src/lib/sync/syncEngine.ts
 *
 * 麻糬のDDL V2 — 增量双向同步引擎 (Sync Engine)
 * 符合 PRD_V2 §FR-SYNC-02 & TECH_SPEC_V2 §3 规范：
 * 1. 本地 Outbox 变更日志，原子写入 SQLite；
 * 2. 每设备独立加密 segment 分区，避免覆盖冲突；
 * 3. 逻辑时钟 (Lamport Clock) 与 opId 去重幂等应用；
 * 4. 软删除墓碑机制，防止多端同步时已删除任务复活；
 * 5. 支持离线排队，联网后自动追赶。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { getDb } from '@/db/database';
import { Task, TimeRecord } from '@/types/types';
import { WebDavClient, WebDavConfig } from './webdavClient';
import { encryptPayload, decryptPayload, deriveKey, EncryptedContainer } from './cryptoEngine';

export const CURRENT_APP_VERSION = '2.0.0';

export interface SyncOperation {
  protocol: number;          // 协议版本 1
  appVersion: string;        // 完全匹配，如 2.0.0
  epoch: string;             // 密钥纪元
  opId: string;              // 全局唯一操作UUID
  deviceId: string;          // 设备标识
  deviceSeq: number;         // 设备内操作递增序号
  lamport: number;           // 逻辑时钟
  entityType: 'task' | 'time_record' | 'achievement' | 'favorite';
  entityId: string;          // 实体稳定主键
  action: 'upsert' | 'delete';
  payload: any;              // 实体业务字段
  createdAt: string;         // ISO 时间戳
}

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'paused' | 'error';
  lastSyncTime: string | null;
  pendingOutboxCount: number;
  lastError: string | null;
  deviceId: string;
}

const STORAGE_DEVICE_ID = 'mochi_sync_device_id';
const STORAGE_SYNC_CONFIG = 'mochi_sync_webdav_config';
const STORAGE_SYNC_PASSWORD = 'mochi_sync_password';
const STORAGE_SYNC_EPOCH = 'mochi_sync_epoch';
const STORAGE_LAST_SYNC = 'mochi_sync_last_time';
const STORAGE_LAMPORT = 'mochi_sync_lamport';

export class SyncEngine {
  private static instance: SyncEngine;
  private currentLamport = 0;
  private deviceId = '';

  private constructor() {
    this.initDeviceId();
  }

  public static getInstance(): SyncEngine {
    if (!SyncEngine.instance) {
      SyncEngine.instance = new SyncEngine();
    }
    return SyncEngine.instance;
  }

  private async initDeviceId(): Promise<string> {
    let id = await AsyncStorage.getItem(STORAGE_DEVICE_ID);
    if (!id) {
      id = 'dev_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
      await AsyncStorage.setItem(STORAGE_DEVICE_ID, id);
    }
    this.deviceId = id;
    const lamportStr = await AsyncStorage.getItem(STORAGE_LAMPORT);
    this.currentLamport = lamportStr ? parseInt(lamportStr, 10) : 0;
    return id;
  }

  public async getDeviceId(): Promise<string> {
    if (!this.deviceId) {
      await this.initDeviceId();
    }
    return this.deviceId;
  }

  /**
   * 初始化 V2 同步表 (SQLite)
   */
  public async initSyncTables(): Promise<void> {
    const db = await getDb();
    // 1. sync_outbox: 本地待上传操作队列
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS sync_outbox (
        op_id        TEXT PRIMARY KEY,
        device_id    TEXT NOT NULL,
        device_seq   INTEGER NOT NULL,
        lamport      INTEGER NOT NULL,
        entity_type  TEXT NOT NULL,
        entity_id    TEXT NOT NULL,
        action       TEXT NOT NULL,
        payload      TEXT NOT NULL,
        created_at   TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'pending' -- 'pending' | 'uploaded'
      );
    `);
    // 2. sync_applied: 已应用的远程操作（防重复重放）
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS sync_applied (
        op_id        TEXT PRIMARY KEY,
        device_id    TEXT NOT NULL,
        applied_at   TEXT NOT NULL
      );
    `);
    // 3. sync_tombstones: 删除墓碑记录
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS sync_tombstones (
        entity_id    TEXT PRIMARY KEY,
        entity_type  TEXT NOT NULL,
        deleted_at   TEXT NOT NULL,
        winning_op   TEXT NOT NULL
      );
    `);
    // 4. sync_segments: 已拉取解析的 Segment 游标记录 (P2-01: 避免每次全量拉取)
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS sync_segments (
        segment_file TEXT PRIMARY KEY,
        device_id    TEXT NOT NULL,
        processed_at TEXT NOT NULL
      );
    `);
  }

  /**
   * 记录一次本地业务操作入队 (原子写入 Outbox)
   */
  public async recordOperation(
    entityType: 'task' | 'time_record' | 'achievement' | 'favorite',
    entityId: string,
    action: 'upsert' | 'delete',
    payload: any
  ): Promise<void> {
    try {
      const isSyncEnabled = await this.isSyncConfigured();
      if (!isSyncEnabled) return; // 未配置坚果云时完全跳过，零开销

      await this.initSyncTables();
      const db = await getDb();
      const devId = await this.getDeviceId();

      this.currentLamport += 1;
      await AsyncStorage.setItem(STORAGE_LAMPORT, this.currentLamport.toString());

      const opId = 'op_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now();
      const now = new Date().toISOString();

      await db.runAsync(
        `INSERT INTO sync_outbox (op_id, device_id, device_seq, lamport, entity_type, entity_id, action, payload, created_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [opId, devId, this.currentLamport, this.currentLamport, entityType, entityId, action, JSON.stringify(payload), now]
      );

      // 如果是删除动作，登记墓碑
      if (action === 'delete') {
        await db.runAsync(
          `INSERT OR REPLACE INTO sync_tombstones (entity_id, entity_type, deleted_at, winning_op) VALUES (?, ?, ?, ?)`,
          [entityId, entityType, now, opId]
        );
      }
    } catch {
      // 容错处理：不阻断本地离线操作
    }
  }

  public async isSyncConfigured(): Promise<boolean> {
    const cfg = await AsyncStorage.getItem(STORAGE_SYNC_CONFIG);
    let pwd: string | null = null;
    if (process.env.EXPO_OS === 'web') {
      pwd = await AsyncStorage.getItem(STORAGE_SYNC_PASSWORD);
    } else {
      pwd = await SecureStore.getItemAsync(STORAGE_SYNC_PASSWORD);
    }
    return !!(cfg && pwd);
  }

  public async getSyncConfig(): Promise<WebDavConfig | null> {
    const raw = await AsyncStorage.getItem(STORAGE_SYNC_CONFIG);
    return raw ? JSON.parse(raw) : null;
  }

  public async getSyncPassword(): Promise<string | null> {
    if (process.env.EXPO_OS === 'web') {
      return AsyncStorage.getItem(STORAGE_SYNC_PASSWORD);
    }
    return SecureStore.getItemAsync(STORAGE_SYNC_PASSWORD);
  }

  public async saveSyncConfig(cfg: WebDavConfig, password: string): Promise<void> {
    await AsyncStorage.setItem(STORAGE_SYNC_CONFIG, JSON.stringify(cfg));
    if (process.env.EXPO_OS === 'web') {
      await AsyncStorage.setItem(STORAGE_SYNC_PASSWORD, password);
    } else {
      await SecureStore.setItemAsync(STORAGE_SYNC_PASSWORD, password);
    }
    let epoch = await AsyncStorage.getItem(STORAGE_SYNC_EPOCH);
    if (!epoch) {
      epoch = 'epoch_' + Math.random().toString(36).slice(2, 10);
      await AsyncStorage.setItem(STORAGE_SYNC_EPOCH, epoch);
    }
  }

  public async clearSyncConfig(): Promise<void> {
    await AsyncStorage.removeItem(STORAGE_SYNC_CONFIG);
    if (process.env.EXPO_OS === 'web') {
      await AsyncStorage.removeItem(STORAGE_SYNC_PASSWORD);
    } else {
      await SecureStore.deleteItemAsync(STORAGE_SYNC_PASSWORD);
    }
  }

  /**
   * 紧急安全处理与密钥轮换 (Epoch 升级)
   * 针对丢失旧设备场景：废弃旧 Epoch 密钥并升级版本，防止旧手机盗用历史凭证
   */
  public async rotateEncryptionEpoch(newPassword?: string): Promise<{ newEpoch: string }> {
    const newEpoch = `epoch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await AsyncStorage.setItem(STORAGE_SYNC_EPOCH, newEpoch);
    if (newPassword) {
      if (process.env.EXPO_OS === 'web') {
        await AsyncStorage.setItem(STORAGE_SYNC_PASSWORD, newPassword);
      } else {
        await SecureStore.setItemAsync(STORAGE_SYNC_PASSWORD, newPassword);
      }
    }
    // 清理本地已处理 Segment 游标缓存，在新纪元重新对齐
    const db = await getDb();
    await db.execAsync(`DELETE FROM sync_segments;`);
    return { newEpoch };
  }

  /**
   * 执行双向增量同步
   */
  public async performSync(): Promise<{ success: boolean; error?: string }> {
    const isConfigured = await this.isSyncConfigured();
    if (!isConfigured) return { success: false, error: '未配置坚果云同步' };

    const cfg = await this.getSyncConfig();
    const pwd = await this.getSyncPassword();
    const epoch = (await AsyncStorage.getItem(STORAGE_SYNC_EPOCH)) || 'epoch_default';
    if (!cfg || !pwd) return { success: false, error: '同步凭证不完整' };

    const client = new WebDavClient(cfg);
    const rootPath = client.getRootPath();
    const devId = await this.getDeviceId();
    const key = deriveKey(pwd, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]), 100);

    try {
      await this.initSyncTables();
      const db = await getDb();

      // 1. 确保云端目录结构
      await client.ensureDirectory('DDLife-v2');
      await client.ensureDirectory(rootPath);
      await client.ensureDirectory(`${rootPath}/devices`);
      await client.ensureDirectory(`${rootPath}/devices/${devId}`);
      await client.ensureDirectory(`${rootPath}/devices/${devId}/segments`);

      // 2. 推送本地待同步 Outbox
      const pendingOps = await db.getAllAsync<any>(
        `SELECT * FROM sync_outbox WHERE status = 'pending' ORDER BY device_seq ASC LIMIT 100`
      );

      if (pendingOps.length > 0) {
        const segmentId = `seg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const segmentPayload: SyncOperation[] = pendingOps.map(row => ({
          protocol: 1,
          appVersion: '2.0.0',
          epoch,
          opId: row.op_id,
          deviceId: row.device_id,
          deviceSeq: row.device_seq,
          lamport: row.lamport,
          entityType: row.entity_type,
          entityId: row.entity_id,
          action: row.action,
          payload: JSON.parse(row.payload),
          createdAt: row.created_at,
        }));

        // 客户端本地端到端加密
        const encrypted = encryptPayload(JSON.stringify(segmentPayload), key, epoch);
        const uploadPath = `${rootPath}/devices/${devId}/segments/${segmentId}.enc`;
        const uploadRes = await client.putFile(uploadPath, JSON.stringify(encrypted));

        if (uploadRes.success) {
          // 标记已上传
          const opIds = pendingOps.map(o => `'${o.op_id}'`).join(',');
          await db.execAsync(`UPDATE sync_outbox SET status = 'uploaded' WHERE op_id IN (${opIds})`);
        }
      }

      // 3. 拉取所有设备的分区并增量合并
      const devList = await client.listFiles(`${rootPath}/devices`);
      if (devList.success && devList.files) {
        for (const remoteDev of devList.files) {
          if (remoteDev === devId) continue; // 跳过本机已发出的数据

          const segList = await client.listFiles(`${rootPath}/devices/${remoteDev}/segments`);
          if (!segList.success || !segList.files) continue;

          for (const segFile of segList.files) {
            if (!segFile.endsWith('.enc')) continue;
            // 检查该 Segment 是否已被处理 (P2-01: 增量游标跳过已下载文件)
            const segProcessed = await db.getFirstAsync(
              `SELECT segment_file FROM sync_segments WHERE segment_file = ?`,
              [segFile]
            );
            if (segProcessed) continue;

            const fileData = await client.getFile(`${rootPath}/devices/${remoteDev}/segments/${segFile}`);
            if (!fileData.success || !fileData.data) continue;

            try {
              const container: EncryptedContainer = JSON.parse(fileData.data);
              const dec = decryptPayload(container, key);
              if (!dec.success || !dec.data) continue;

              const ops: SyncOperation[] = JSON.parse(dec.data);
              // 区分实时设备协议握手与历史日志兼容读取：
              // 1. 协议版本 protocol 必须为 1
              // 2. 对于当前活跃设备提交的操作，大版本必须兼容 2.x
              // 3. 未来小版本升级（如 2.0.0 升级到 2.0.1）能平滑回放并读取历史合法 2.0.x 数据，杜绝升级后历史数据不可恢复
              const hasBrokenProtocol = ops.some(op => op.protocol && op.protocol !== 1);
              if (hasBrokenProtocol) {
                return { success: false, error: '检测到远程设备使用不兼容的数据协议版本，同步已暂停' };
              }
              const hasIncompatibleMajorVersion = ops.some(op => op.appVersion && !op.appVersion.startsWith('2.'));
              if (hasIncompatibleMajorVersion) {
                return { success: false, error: `检测到不兼容的 App 主版本，当前应用版本: ${CURRENT_APP_VERSION}，请升级后同步` };
              }

              await this.applyRemoteOperations(ops);

              // 记录该 Segment 已处理成功
              await db.runAsync(
                `INSERT OR REPLACE INTO sync_segments (segment_file, device_id, processed_at) VALUES (?, ?, ?)`,
                [segFile, remoteDev, new Date().toISOString()]
              );
            } catch {
              // 单个文件解析异常跳过，保证鲁棒性
            }
          }
        }
      }

      await AsyncStorage.setItem(STORAGE_LAST_SYNC, new Date().toISOString());
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || '同步网络中断' };
    }
  }

  /**
   * 应用远端拉取的操作（幂等去重 + 墓碑防护）
   */
  private async applyRemoteOperations(ops: SyncOperation[]): Promise<void> {
    const db = await getDb();
    for (const op of ops) {
      // 检查是否已应用
      const existing = await db.getFirstAsync(`SELECT op_id FROM sync_applied WHERE op_id = ?`, [op.opId]);
      if (existing) continue;

      // 检查是否落入墓碑
      const tombstone = await db.getFirstAsync(`SELECT entity_id FROM sync_tombstones WHERE entity_id = ?`, [op.entityId]);
      if (tombstone && op.action !== 'delete') {
        // 已被墓碑标记删除，阻断复活
        await db.runAsync(`INSERT INTO sync_applied (op_id, device_id, applied_at) VALUES (?, ?, ?)`, [op.opId, op.deviceId, new Date().toISOString()]);
        continue;
      }

      if (op.entityType === 'task') {
        const taskData = op.payload as Task;
        if (op.action === 'delete') {
          await db.runAsync(`UPDATE tasks SET status = 'deleted' WHERE id = ?`, [op.entityId]);
          await db.runAsync(`INSERT OR REPLACE INTO sync_tombstones (entity_id, entity_type, deleted_at, winning_op) VALUES (?, 'task', ?, ?)`, [op.entityId, op.createdAt, op.opId]);
        } else {
          // Upsert Task
          await db.runAsync(
            `INSERT INTO tasks (id, name, deadline, priority, completed, completed_at, created_at, status, note, category, is_overtime_complete)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               deadline = excluded.deadline,
               priority = excluded.priority,
               completed = excluded.completed,
               completed_at = excluded.completed_at,
               status = excluded.status,
               note = excluded.note,
               category = excluded.category`,
            [
              taskData.id,
              taskData.name,
              taskData.deadline,
              taskData.priority ?? 2,
              taskData.completed ? 1 : 0,
              taskData.completed_at ?? null,
              taskData.created_at ?? op.createdAt,
              taskData.status ?? 'active',
              taskData.note ?? '',
              taskData.category ?? '',
              taskData.is_overtime_complete ? 1 : 0,
            ]
          );
        }
      }

      // 记录已应用
      await db.runAsync(
        `INSERT INTO sync_applied (op_id, device_id, applied_at) VALUES (?, ?, ?)`,
        [op.opId, op.deviceId, new Date().toISOString()]
      );
    }
  }

  /**
   * 获取当前同步状态摘要
   */
  public async getSyncStatus(): Promise<SyncStatus> {
    const isConfigured = await this.isSyncConfigured();
    const lastSyncTime = await AsyncStorage.getItem(STORAGE_LAST_SYNC);
    const devId = await this.getDeviceId();
    let pendingCount = 0;

    if (isConfigured) {
      try {
        const db = await getDb();
        const res = await db.getFirstAsync<{ count: number }>(
          `SELECT COUNT(*) as count FROM sync_outbox WHERE status = 'pending'`
        );
        pendingCount = res?.count || 0;
      } catch {
        pendingCount = 0;
      }
    }

    return {
      state: isConfigured ? 'idle' : 'paused',
      lastSyncTime,
      pendingOutboxCount: pendingCount,
      lastError: null,
      deviceId: devId,
    };
  }
}
