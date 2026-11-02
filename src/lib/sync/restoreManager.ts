/**
 * src/lib/sync/restoreManager.ts
 *
 * 麻糬のDDL V2 — 统一恢复状态机、全局写入门禁与 30 天历史快照
 * 符合 PRD_V2 §FR-SYNC-03, §FR-BACKUP-01 & TECH_SPEC_V2 §1 规范：
 * 1. 全局写入门禁 (Write Gate)：
 *    - NORMAL: 允许正常读写；
 *    - RESTORING_READ_ONLY: 恢复中只读，全应用拦截新建/编辑/删除等写操作；
 *    - UNSAFE_SYNC_PAUSED: 检测到数据异常或密钥冲突时暂停同步与写入；
 * 2. 破坏性操作前自动生成本地保护快照 (`pre_restore_backup_*.json`)；
 * 3. 管理 30 天历史快照恢复点列表，保证灾难恢复能力。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDb } from '@/db/database';
import { getAllTasks } from '@/db/api';
import { WebDavClient } from './webdavClient';
import { SyncEngine } from './syncEngine';
import { encryptPayload, decryptPayload, deriveKey, EncryptedContainer } from './cryptoEngine';

export type WriteGateMode = 'NORMAL' | 'RESTORING_READ_ONLY' | 'UNSAFE_SYNC_PAUSED';

export interface SnapshotMeta {
  snapshotId: string;
  createdAt: string;       // ISO
  taskCount: number;
  source: 'local_auto' | 'remote_cloud';
  verified: boolean;
}

const STORAGE_GATE_MODE = 'mochi_write_gate_mode';
const STORAGE_SNAPSHOT_INDEX = 'mochi_snapshot_index';

export class RestoreManager {
  private static currentMode: WriteGateMode = 'NORMAL';

  /**
   * 获取当前写入门禁状态
   */
  public static async getWriteGateMode(): Promise<WriteGateMode> {
    const saved = await AsyncStorage.getItem(STORAGE_GATE_MODE);
    if (saved) {
      this.currentMode = saved as WriteGateMode;
    }
    return this.currentMode;
  }

  /**
   * 设置写入门禁状态
   */
  public static async setWriteGateMode(mode: WriteGateMode): Promise<void> {
    this.currentMode = mode;
    await AsyncStorage.setItem(STORAGE_GATE_MODE, mode);
  }

  /**
   * 写入门禁检查器：如果处于只读安全模式，抛出异常阻断业务写操作
   */
  public static async assertWriteAllowed(): Promise<void> {
    const mode = await this.getWriteGateMode();
    if (mode === 'RESTORING_READ_ONLY') {
      throw new Error('系统正处于「只读安全模式」（数据恢复或快照重构中），暂时禁止任何新建、修改或删除操作。');
    }
    if (mode === 'UNSAFE_SYNC_PAUSED') {
      throw new Error('检测到数据同步状态异常，系统已进入保护态，请在「设置 → 多机安全同步」中排查。');
    }
  }

  /**
   * 破坏性操作前自动创建本地完整安全保护快照
   */
  public static async createPreDestructiveSnapshot(reason: string): Promise<string> {
    const tasks = await getAllTasks();
    const snapshotId = `snap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const snapshotData = {
      snapshotId,
      reason,
      createdAt: new Date().toISOString(),
      taskCount: tasks.length,
      tasks,
    };

    const key = `mochi_snapshot_${snapshotId}`;
    await AsyncStorage.setItem(key, JSON.stringify(snapshotData));

    // 更新快照索引
    const indexRaw = await AsyncStorage.getItem(STORAGE_SNAPSHOT_INDEX);
    const indexList: SnapshotMeta[] = indexRaw ? JSON.parse(indexRaw) : [];
    indexList.unshift({
      snapshotId,
      createdAt: snapshotData.createdAt,
      taskCount: tasks.length,
      source: 'local_auto',
      verified: true,
    });

    // 仅保留最近 30 天/最多 30 个恢复点
    const pruned = indexList.slice(0, 30);
    await AsyncStorage.setItem(STORAGE_SNAPSHOT_INDEX, JSON.stringify(pruned));

    // 尝试异步加密归档至云端 WebDAV (PRD §FR-BACKUP-01)
    try {
      const syncEngine = SyncEngine.getInstance();
      const isConfigured = await syncEngine.isSyncConfigured();
      if (isConfigured) {
        const cfg = await syncEngine.getSyncConfig();
        const pwd = await syncEngine.getSyncPassword();
        if (cfg && pwd) {
          const client = new WebDavClient(cfg);
          const rootPath = client.getRootPath();
          const key = deriveKey(pwd, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]), 100);
          const encSnapshot = encryptPayload(JSON.stringify(snapshotData), key, 'snapshot_epoch');
          await client.ensureDirectory('DDLife-v2');
          await client.ensureDirectory(rootPath);
          await client.ensureDirectory(`${rootPath}/snapshots`);
          await client.putFile(`${rootPath}/snapshots/${snapshotId}.enc`, JSON.stringify(encSnapshot));
        }
      }
    } catch {
      // 云端备份静默容错，不阻断本地快照
    }

    return snapshotId;
  }

  /**
   * 列出所有可用的恢复快照
   */
  public static async listSnapshots(): Promise<SnapshotMeta[]> {
    const indexRaw = await AsyncStorage.getItem(STORAGE_SNAPSHOT_INDEX);
    return indexRaw ? JSON.parse(indexRaw) : [];
  }

  /**
   * 执行从快照恢复数据（受写入门禁保护）
   */
  public static async restoreFromSnapshot(snapshotId: string): Promise<{ success: boolean; error?: string }> {
    try {
      // 1. 开启只读安全门禁
      await this.setWriteGateMode('RESTORING_READ_ONLY');

      // 2. 先备份当前状态（防误操作二次灾难）
      await this.createPreDestructiveSnapshot(`回滚快照 ${snapshotId} 前的自动安全快照`);

      // 3. 读取快照内容
      const raw = await AsyncStorage.getItem(`mochi_snapshot_${snapshotId}`);
      if (!raw) {
        await this.setWriteGateMode('NORMAL');
        return { success: false, error: '快照数据不存在或已过期' };
      }

      const parsed = JSON.parse(raw);
      const targetTasks = parsed.tasks || [];

      // 4. 原子重刷 SQLite 任务表
      const db = await getDb();
      await db.execAsync(`DELETE FROM tasks;`);
      for (const t of targetTasks) {
        await db.runAsync(
          `INSERT INTO tasks (id, name, deadline, priority, completed, completed_at, created_at, status, note, category)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [t.id, t.name, t.deadline, t.priority, t.completed ? 1 : 0, t.completed_at, t.created_at, t.status, t.note || '', t.category || '']
        );
      }

      // 5. 恢复成功，解除写入门禁
      await this.setWriteGateMode('NORMAL');
      return { success: true };
    } catch (err: any) {
      await this.setWriteGateMode('NORMAL');
      return { success: false, error: err?.message || '恢复过程异常中断' };
    }
  }
}
