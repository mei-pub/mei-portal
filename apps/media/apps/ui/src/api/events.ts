// DOWNLOAD_EVENT_NAME is used as the channel name for dispatching download events
import { http } from "@/utils";
import { useDownloadStore } from "@/store/download";

type Callback = (...args: unknown[]) => void;

let es: EventSource | null = null;

const downloadListeners = new Set<Callback>();
const configListeners = new Set<Callback>();

let pollingTimer: ReturnType<typeof setInterval> | null = null;

/** SSE payload 解析（统一容错：坏包直接丢弃，不让监听器抛未捕获异常） */
function parseEvent<T = Record<string, unknown>>(raw: unknown): T | null {
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return null;
  }
}

/**
 * Initialize Go Core SSE event stream.
 * Called once from App.tsx after discovering the core URL.
 */
export function initGoEvents(coreUrl: string) {
  if (es) {
    es.close();
  }

  es = new EventSource(`${coreUrl}/api/events`);

  // Task creation is broadcast from Go Core's download.Create handler.
  // Driving the sidebar badge from SSE (instead of the local `increase()`
  // call in the form/panel handlers) keeps the count correct across
  // WebContents — e.g. the source-extract overlay dialog has its own
  // Zustand instance and its local store updates never reach the main
  // window.
  es.addEventListener("download-create", (e) => {
    try {
      const payload = JSON.parse(e.data);
      const count =
        typeof payload?.count === "number" && payload.count > 0
          ? payload.count
          : 1;
      const ids: number[] = Array.isArray(payload?.ids)
        ? payload.ids.map((id: unknown) => Number(id))
        : [];
      const { increase } = useDownloadStore.getState();
      for (let i = 0; i < count; i++) increase();

      // Also fan out to download-event listeners so `useTasks` can
      // revalidate its list — otherwise tasks imported externally
      // (browser extension's HTTP mode, Docker clients) only bump
      // the sidebar badge and the list stays stale until a manual
      // refresh.
      dispatchDownload({ type: "created", data: { ids, count } });
    } catch {
      // ignore malformed payloads
    }
  });

  es.addEventListener("download-start", (e) => {
    const payload = parseEvent(e.data);
    if (!payload) return;
    dispatchDownload({ type: "start", data: { id: Number(payload.id) } });
    startProgressPolling();
  });

  es.addEventListener("download-success", (e) => {
    const payload = parseEvent(e.data);
    if (!payload) return;
    dispatchDownload({ type: "success", data: { id: Number(payload.id) } });
    stopProgressPollingIfIdle();
  });

  es.addEventListener("download-failed", (e) => {
    const payload = parseEvent(e.data);
    if (!payload) return;
    dispatchDownload({
      type: "failed",
      data: { id: Number(payload.id), error: payload.error },
    });
    stopProgressPollingIfIdle();
  });

  es.addEventListener("download-stop", (e) => {
    const payload = parseEvent(e.data);
    if (!payload) return;
    dispatchDownload({ type: "stopped", data: { id: Number(payload.id) } });
    stopProgressPollingIfIdle();
  });

  es.addEventListener("config-changed", (e) => {
    const payload = parseEvent(e.data);
    if (!payload) return;
    dispatchConfig({ key: payload.key, value: payload.value });
  });

  // 初始化不无条件开轮询：仅当确实存在下载中任务才启动（否则无事件时
  // 1s 轮询 /api/tasks 永不停止）；之后靠 download-start 事件再启动
  void (async () => {
    try {
      const data = (await http.get("/api/tasks")) as {
        tasks?: Array<{ status?: string }>;
      };
      if ((data.tasks ?? []).some((t) => t.status === "downloading")) {
        startProgressPolling();
      }
    } catch {
      // Go Core may not be ready yet; a download-start event will start it
    }
  })();
}

/**
 * Subscribe to download events (start/success/failed/stopped/progress).
 * Callback receives (null, eventData) to match existing consumer pattern.
 * Returns an unsubscribe function.
 */
export function onDownloadEvent(cb: Callback): () => void {
  downloadListeners.add(cb);
  return () => {
    downloadListeners.delete(cb);
  };
}

/**
 * Subscribe to config-changed events.
 * Callback receives (null, { key, value }).
 * Returns an unsubscribe function.
 */
export function onConfigChanged(cb: Callback): () => void {
  configListeners.add(cb);
  return () => {
    configListeners.delete(cb);
  };
}

function dispatchDownload(data: unknown) {
  downloadListeners.forEach((cb) => cb(null, data));
}

function dispatchConfig(data: unknown) {
  configListeners.forEach((cb) => cb(null, data));
}

// --- Progress polling (only while downloads are active) ---

/** 连续空转 N 次（无下载中任务）自动停轮询，下次 download-start 事件再启动，
 *  避免无事件时 1s 轮询 /api/tasks 永不停止 */
const IDLE_STOP_TICKS = 5;
let idleTicks = 0;

function startProgressPolling() {
  idleTicks = 0;
  if (pollingTimer) return;
  pollingTimer = setInterval(pollProgressOnce, 1000);
}

async function pollProgressOnce() {
  try {
    // Use /api/tasks which returns TaskInfo with percent/speed/isLive
    const data = (await http.get("/api/tasks")) as unknown as {
      tasks: Array<{
        id: string;
        type: string;
        percent: number;
        speed: string;
        isLive: boolean;
        status: string;
      }>;
      total: number;
    };
    const downloading = data.tasks.filter((t) => t.status === "downloading");
    const activeTasks = downloading.filter(
      (t) => t.percent > 0 && t.percent < 100,
    );
    if (activeTasks.length > 0) {
      const progress = activeTasks.map((t) => ({
        id: Number(t.id),
        type: t.type,
        percent: String(t.percent || 0),
        speed: t.speed || "",
        isLive: t.isLive || false,
        status: t.status,
      }));
      dispatchDownload({ type: "progress", data: progress });
    }
    if (downloading.length > 0) {
      idleTicks = 0;
    } else if (++idleTicks >= IDLE_STOP_TICKS) {
      stopPolling();
    }
  } catch {
    // Go Core may not be ready yet
  }
}

function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

async function stopProgressPollingIfIdle() {
  try {
    const result = (await http.get("/api/tasks")) as unknown as {
      tasks: Array<{ status: string }>;
      total: number;
    };
    const hasActive = result.tasks.some((t) => t.status === "downloading");
    if (!hasActive) {
      stopPolling();
    }
  } catch {
    // ignore
  }
}
