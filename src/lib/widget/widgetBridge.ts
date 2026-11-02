/**
 * src/lib/widget/widgetBridge.ts
 *
 * 麻糬のDDL V2.2 Android 桌面小组件 (AppWidget) 数据管道桥接器
 *
 * 核心逻辑：
 * 1. 查询当前最临近、最高优先级的紧急待办 DDL
 * 2. 统计今日待办总数、已完成数与麻糬当前状态 (HP/SAN)
 * 3. 序列化为结构化轻量 JSON，供 Android 原生 AppWidgetProvider 读取并刷新桌面小组件
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDb } from '@/db/database';
import { Task } from '@/types/types';

export interface WidgetDataPayload {
  urgentTask: {
    id: string;
    name: string;
    deadline: string;
    priority: number;
    category?: string | null;
  } | null;
  activeCount: number;
  completedCount: number;
  updatedAt: string;
}

export const STORAGE_WIDGET_DATA = 'mochi_android_widget_payload';

export class WidgetBridge {
  /**
   * 刷新并持久化桌面小组件数据快照
   */
  public static async refreshWidgetData(): Promise<WidgetDataPayload> {
    try {
      const db = await getDb();
      // 查询最紧急的待办任务（未删除、未完成、按截止时间正序）
      const urgentRow = await db.getFirstAsync<Task>(
        `SELECT * FROM tasks
         WHERE status = 'active'
         ORDER BY deadline ASC
         LIMIT 1`
      );

      // 查询待办与完成统计
      const activeCountRow = await db.getFirstAsync<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM tasks WHERE status = 'active'`
      );
      const completedCountRow = await db.getFirstAsync<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM tasks WHERE status = 'completed'`
      );

      const payload: WidgetDataPayload = {
        urgentTask: urgentRow ? {
          id: urgentRow.id,
          name: urgentRow.name,
          deadline: urgentRow.deadline,
          priority: urgentRow.priority,
          category: urgentRow.category,
        } : null,
        activeCount: activeCountRow?.cnt || 0,
        completedCount: completedCountRow?.cnt || 0,
        updatedAt: new Date().toISOString(),
      };

      await AsyncStorage.setItem(STORAGE_WIDGET_DATA, JSON.stringify(payload));
      return payload;
    } catch {
      const fallback: WidgetDataPayload = {
        urgentTask: null,
        activeCount: 0,
        completedCount: 0,
        updatedAt: new Date().toISOString(),
      };
      return fallback;
    }
  }

  /**
   * 获取当前缓存的桌面小组件数据
   */
  public static async getWidgetData(): Promise<WidgetDataPayload | null> {
    const raw = await AsyncStorage.getItem(STORAGE_WIDGET_DATA);
    return raw ? JSON.parse(raw) : null;
  }
}
