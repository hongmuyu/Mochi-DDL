/**
 * 跨页面轻量统一数据变更广播总线 (DataEventBus)
 *
 * 保证数据在任务列表、首页、统计、通知和日报中保持强一致性：
 * 1. 精准事件分发：任务/记录/配置变更时通知订阅页面刷新，杜绝无脑全应用重载；
 * 2. 竞态与覆盖防护：携带单调自增版本号，防止慢网络/慢磁盘的过时异步响应覆盖新修改；
 * 3. 页面按需订阅：React 组件在 useFocusEffect/useEffect 中订阅，页面卸载自动注销。
 */

export type DataEventType =
  | 'task_changed'
  | 'record_changed'
  | 'settings_changed'
  | 'card_invalidated'
  | 'notification_reconcile';

export interface DataEventPayload {
  action?: 'create' | 'update' | 'delete' | 'complete' | 'uncomplete' | 'restore';
  entityId?: string;
  date?: string;
  version: number;
  timestamp: number;
}

type EventCallback = (payload: DataEventPayload) => void;

class EventBus {
  private listeners: Map<DataEventType, Set<EventCallback>> = new Map();
  private currentVersion = 1;

  /** 发送数据变更广播 */
  emit(event: DataEventType, payload?: Partial<DataEventPayload>): void {
    this.currentVersion++;
    const fullPayload: DataEventPayload = {
      action: payload?.action ?? 'update',
      entityId: payload?.entityId,
      date: payload?.date,
      version: this.currentVersion,
      timestamp: Date.now(),
    };

    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(fullPayload);
        } catch (e) {
          console.warn(`[DataEventBus] Error in listener for ${event}:`, e);
        }
      });
    }
  }

  /** 订阅数据变更事件，返回注销函数 */
  subscribe(event: DataEventType, callback: EventCallback): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const handlers = this.listeners.get(event)!;
    handlers.add(callback);

    return () => {
      handlers.delete(callback);
    };
  }

  /** 获取当前事件总线版本戳 */
  getCurrentVersion(): number {
    return this.currentVersion;
  }
}

export const DataEventBus = new EventBus();
