import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { enableMapSet } from "immer";

// Allow Immer to work with Map in state
enableMapSet();

// percent 事件统一 0-100 刻度：引擎侧 downloadedBytes/totalBytes 已换算为
// 百分数，队列侧解析 N_m3u8DL-RE 的 % 输出，停止事件传空串。旧实现按
// 「0-1 比例」猜测（≤1 一律 ×100），会把 0-100 刻度里 1% 以下的真值错放大
// 100 倍：0.9% → 90、0.99% → 99.9（显示四舍五入成 100%），再被合并的
// Math.max 永久锁死 —— 刚开下几秒进度条就冲到满格、暂停后常驻「100%」。
// 实测无任何生产方发送 0-1 比例，删除该猜测；非法值返回 null 由合并逻辑兜底
const normalizePercent = (value: string | number | undefined) => {
  const num = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
};
interface DownloadEvent {
  percent: string;
  speed: string;
  id: number;
  /** 引擎任务（FluxDown）附加：BT 上传速率 */
  uploadSpeed?: string;
  /** 引擎任务附加：做种状态（1=做种中） */
  seeding?: number;
  /** 引擎任务附加：已连接节点数 */
  peers?: number | null;
}

interface DownloadStore {
  count: number;
  events: DownloadEvent[];
  eventsMap: Map<string, DownloadEvent>;
}

const initialState: DownloadStore = {
  count: 0,
  events: [],
  eventsMap: new Map(),
};

type Actions = {
  clearCount: () => void;
  increase: () => void;
  /** 增量合并一批进度事件（进度批次是窗口采样，只含仍在推进的任务） */
  setEvents: (events: DownloadEvent[]) => void;
  /** 清除单任务进度缓存（任务重启瞬间旧进度不应残留） */
  removeEvent: (id: string | number) => void;
};

export const useDownloadStore = create<DownloadStore & Actions>()(
  immer((set) => ({
    ...initialState,
    clearCount: () =>
      set((state) => {
        state.count = 0;
      }),
    increase: () =>
      set((state) => {
        state.count += 1;
      }),
    setEvents: (events: DownloadEvent[]) =>
      set((state) => {
        // 进度批次是「窗口采样」：轮询只带上仍在下载且 0<p<100 的任务。
        // 这里必须增量合并 —— 旧实现整表重建 eventsMap，把本批之外的任务
        // 全部丢出缓存，典型链路：影视任务暂停的一瞬间同列表另一任务仍在
        // 推进 → 本批只剩它 → 暂停行进度缓存消失 → 行数据回退 percent:"0"，
        // 进度条整条消失（用户反馈「暂停下载的时候进度条进度会出错」）。
        const merged = new Map(state.eventsMap);
        const normalized = events.map((item) => {
          const prevPercent = normalizePercent(
            merged.get(String(item.id))?.percent,
          );
          const currentPercent = normalizePercent(item.percent);
          const percent = Math.min(
            100,
            Math.max(currentPercent ?? 0, prevPercent ?? 0, 0),
          );

          // speed 取本批现值（暂停/下载中速度各自如实覆盖，不沿用上次值）
          const entry = {
            ...item,
            percent: percent.toString(),
          };
          merged.set(String(item.id), entry);
          return entry;
        });

        state.events = Array.from(merged.values());
        state.eventsMap = merged;
      }),
    removeEvent: (id: string | number) =>
      set((state) => {
        const key = String(id);
        state.events = state.events.filter((item) => String(item.id) !== key);
        state.eventsMap.delete(key);
      }),
  })),
);

export const downloadStoreSelector = (state: DownloadStore & Actions) => {
  return {
    count: state.count,
    clearCount: state.clearCount,
    increase: state.increase,
    events: state.events,
    eventsMap: state.eventsMap,
    setEvents: state.setEvents,
    removeEvent: state.removeEvent,
  };
};
