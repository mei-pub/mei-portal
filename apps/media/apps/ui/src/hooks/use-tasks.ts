import {
  DownloadFilter,
  DownloadStatus,
  type DownloadCreatedEvent,
  type DownloadEvent,
  type DownloadFailedEvent,
  type DownloadProgress,
  type DownloadStoppedEvent,
  type DownloadSuccessEvent,
  type DownloadTask,
} from "@mediago/shared-common";
import { useCallback, useEffect, useMemo } from "react";
import useSWR from "swr";
import { useShallow } from "zustand/react/shallow";
import { downloadStoreSelector, useDownloadStore } from "@/store/download";
import { getDownloadTasks as fetchDownloadTasks } from "@/api/download-task";
import { onDownloadEvent } from "@/api/events";
import { homeSelector, useHomeStore } from "@/store/home";
import { songPageUrlOf } from "@/utils/song-source";
import { http } from "@/utils";

/**
 * Extended Download Task with real-time details
 */
export interface DownloadTaskDetails extends DownloadTask {
  percent: string;
  speed: string;
  exists?: boolean;
  file?: string;
  /** 引擎任务（FluxDown）实时态：BT 上传速率 / 做种 / 节点数 */
  uploadSpeed?: string;
  seeding?: number;
  peers?: number | null;
  seedingMessage?: string;
  /** 音乐行（music 服务下载任务/曲库文件并入任务队列）的元数据 */
  music?: MusicRowMeta;
}

export interface MusicRowMeta {
  kind: "task" | "file";
  taskId?: string;
  /** 曲库相对路径（file:<path> 播放 / serve 下载 / 删除都用它） */
  path: string;
  song: { name: string; artist: string; source: string; id?: string; };
  /** 下载失败原因（music 服务任务行；曲库文件行无） */
  error?: string;
}

/** 音乐行合成 id（稳定负数，与媒体任务的数据库自增 id 天然隔离） */
const musicRowId = (key: string): number =>
  -(Math.abs([...key].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)) % 900000000) - 1;

const isSuccessEvent = (obj: DownloadEvent): obj is DownloadSuccessEvent =>
  obj.type === "success";
const isFailedEvent = (obj: DownloadEvent): obj is DownloadFailedEvent =>
  obj.type === "failed";
const isStoppedEvent = (obj: DownloadEvent): obj is DownloadStoppedEvent =>
  obj.type === "stopped";
const isCreatedEvent = (obj: DownloadEvent): obj is DownloadCreatedEvent =>
  obj.type === "created";
const isProgressEvent = (
  obj: DownloadEvent,
): obj is DownloadEvent<DownloadProgress[]> => obj.type === "progress";

export function useTasks(
  filter: DownloadFilter = DownloadFilter.list,
  /** 任务类型过滤：direct=文件 / bt=磁力 / media=视频类（排除 direct、bt） */
  taskType?: string,
) {
  const { setEvents, eventsMap, removeEvent } = useDownloadStore(
    useShallow(downloadStoreSelector),
  );
  const { page, pageSize, setPage, setPageSize } = useHomeStore(
    useShallow(homeSelector),
  );

  const { data, error, isLoading, mutate } = useSWR(
    {
      key: "api/tasks",
      args: {
        current: page,
        pageSize,
        filter,
        type: taskType,
      },
    },
    ({ args }) => {
      return fetchDownloadTasks(args);
    },
  );

  // ── 音乐下载任务并入任务队列 ──
  // 「无论什么源下载都要在任务队列」：music 服务自管的下载任务（进行中/失败）
  // 与曲库文件（已完成）以 music 行形态并入列表。仅全量视图（无 taskType）注入，
  // 类型页（direct/bt/media）不掺行；done 任务由曲库文件行代表，避免重复。
  const { data: musicLib } = useSWR(
    taskType
      ? null
      : { key: "music-download-library" },
    () =>
      http.get("/music/api/download/library") as Promise<{
        tasks?: Array<{
          id: string;
          status: string;
          song: { name: string; artist: string; source: string; id?: string };
          percent: number;
          speed: number;
          path: string;
          error?: string;
        }>;
        files?: Array<{
          name: string;
          artist: string;
          source: string;
          /** 任务表 join 回填的源歌曲 id/source（Round-B：曲库文件行复制链接用） */
          songId?: string | number;
          songSource?: string;
          path: string;
          size: number;
          mtime: number;
        }>;
      }>,
    { refreshInterval: 5000, revalidateOnFocus: false },
  );
  const musicRows: DownloadTaskDetails[] = useMemo(() => {
    if (taskType || !musicLib) return [];
    const fmtSpeed = (bps: number): string => {
      if (!bps || bps <= 0) return "0 B/s";
      const units = ["B/s", "KB/s", "MB/s", "GB/s"];
      let v = bps;
      let i = 0;
      while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i += 1;
      }
      return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
    };
    const relPath = (p: string): string => (p ?? "").replace(/^\/downloads\/music\//, "");
    const rows: DownloadTaskDetails[] = [];
    for (const t of musicLib.tasks ?? []) {
      if (t.status === "done") continue; // done 由曲库文件行代表（去重）
      rows.push({
        id: musicRowId(`task:${t.id}`),
        type: "music",
        name: t.song.artist ? `${t.song.name} - ${t.song.artist}` : t.song.name,
        // 源地址口径：音乐行「复制链接」= 这首歌的音源站页面地址（原始资源
        // 链接，由 source+id 构造）。构造不出来（未收录源）时行 url 置空，
        // 复制动作由菜单/抽屉按音乐元数据兜底落盘路径
        url: songPageUrlOf(t.song) || "",
        folder: null,
        headers: null,
        isLive: false,
        status:
          t.status === "error" ? DownloadStatus.Failed : DownloadStatus.Downloading,
        createdDate: new Date().toISOString(),
        updatedDate: new Date().toISOString(),
        selectFile: null,
        engineTaskId: null,
        segments: null,
        queueId: null,
        exists: false,
        percent: String(t.percent ?? 0),
        speed: fmtSpeed(t.speed ?? 0),
        music: { kind: "task", taskId: t.id, path: relPath(t.path), song: t.song, error: t.error },
      } as unknown as DownloadTaskDetails);
    }
    for (const f of musicLib.files ?? []) {
      // 源地址口径与任务行一致：曲库文件行由 download-library 按落盘路径
      // join 任务表/源索引回填 song.id/source，「复制链接」（音源站页面地址）
      // 恒可用；无源 id 的历史文件没有播放直链可冒充（用户契约「复制链接
      // =复制源链接」），行 url 置空，复制动作按音乐元数据兜底落盘路径
      const fileSong = {
        name: f.name,
        artist: f.artist,
        source: f.songSource || f.source,
        id: f.songId,
      };
      rows.push({
        id: musicRowId(`file:${f.path}`),
        type: "music",
        name: f.artist ? `${f.name} - ${f.artist}` : f.name,
        url: songPageUrlOf(fileSong) || "",
        folder: null,
        headers: null,
        isLive: false,
        status: DownloadStatus.Success,
        createdDate: new Date(f.mtime ?? Date.now()).toISOString(),
        updatedDate: new Date(f.mtime ?? Date.now()).toISOString(),
        selectFile: null,
        engineTaskId: null,
        segments: null,
        queueId: null,
        exists: true,
        percent: "100",
        speed: "0 B/s",
        music: { kind: "file", path: f.path, song: fileSong },
      } as unknown as DownloadTaskDetails);
    }
    return rows;
  }, [taskType, musicLib]);

  // ── 队列快照兜底（页面刷新/无 SSE 进度事件时的行进度来源）──
  // /api/tasks 是核心服务的进程内任务表：percent 对暂停任务保留「暂停前的
  // 真实进度」。缺这个兜底时，暂停行在页面刷新或进度缓存丢失后会回退
  // percent:"0"——进度条归零，用户看到「暂停下载的时候进度条进度出错」。
  const { data: taskSnaps } = useSWR(
    { key: "api-task-snapshots" },
    () =>
      // http 响应拦截器已解包 { success, data } —— 这里的值直接是 { tasks, total }
      http.get("/api/tasks") as Promise<{
        tasks?: Array<{
          id: string;
          status: string;
          percent: number;
          speed: string;
        }>;
      }>,
    { refreshInterval: 5000, revalidateOnFocus: false },
  );
  const queueMap = useMemo(
    () => new Map((taskSnaps?.tasks ?? []).map((t) => [String(t.id), t])),
    [taskSnaps],
  );

  const mediaRows: DownloadTaskDetails[] = useMemo(() => {
    return (data?.list || []).map((item) => {
      const evnetItem = eventsMap.get(String(item.id));

      // 引擎实时态：列表行自带（完成态做种数据），下载中由轮询事件覆盖
      const engineBase = item.engine;
      if (!evnetItem) {
        const snap = queueMap.get(String(item.id));
        return {
          ...item,
          // 队列快照优先：暂停/等待中的任务在快照里保留暂停前真实进度；
          // 快照也没有（引擎任务重启前/极端情形）才回退 "0"
          percent: snap ? String(snap.percent ?? 0) : "0",
          speed: snap?.speed || "0 B/s",
          uploadSpeed: engineBase?.uploadSpeed,
          seeding: engineBase?.seeding,
          peers: engineBase?.peers ?? null,
          seedingMessage: engineBase?.seedingMessage,
        };
      }

      return {
        ...item,
        percent: evnetItem.percent || "0",
        speed: evnetItem.speed || "0 B/s",
        uploadSpeed: evnetItem.uploadSpeed ?? engineBase?.uploadSpeed,
        seeding: evnetItem.seeding ?? engineBase?.seeding,
        peers: evnetItem.peers ?? engineBase?.peers ?? null,
        seedingMessage: engineBase?.seedingMessage,
      };
    });
  }, [data, eventsMap, queueMap]);

  // 音乐行并入任务队列（无论什么源下载都要在任务队列里）
  const detail = useMemo(
    () => [...mediaRows, ...musicRows],
    [mediaRows, musicRows],
  );

  const handleDownloadEvent = useCallback(
    (_: unknown, eventData: DownloadEvent) => {
      // 任务重启（开始事件）：上一轮的进度缓存立即清除 —— 重新下载/续传
      // 重算时行显示应从引擎本轮真实进度起步，不能沿用旧百分比
      if (eventData.type === "start") {
        const startId = (eventData.data as { id?: number } | null)?.id;
        if (startId !== undefined && startId !== null) {
          removeEvent(startId);
        }
        return;
      }

      if (isSuccessEvent(eventData)) {
        mutate();
        return;
      }

      if (isFailedEvent(eventData)) {
        mutate();
        return;
      }

      if (isStoppedEvent(eventData)) {
        // 暂停：速度清零（停下后不再有速率）——不清的话暂停行会挂着最后一次
        // 的瞬时速率，显示上仍在「跑」。percent 先以事件缓存兜底（merge 会
        // 保留暂停前的 max），再直拉一次 /api/tasks 用进程内冻结的真实进度
        // 校正 —— 事件缓存是轮询批次（最长 1s 延迟）的滞后值，下载快的任务
        // 暂停时会明显回跳（如真实 12.67% 显示成 1%）
        const stopId = eventData.data?.id;
        if (stopId !== undefined) {
          setEvents([{ id: stopId, percent: "", speed: "0 B/s" }]);
          void (http.get("/api/tasks") as Promise<{
            tasks?: Array<{
              id: string;
              status: string;
              percent: number;
              speed: string;
            }>;
          }>)
            .then((snap) => {
              const task = (snap?.tasks ?? []).find(
                (x) => String(x.id) === String(stopId),
              );
              if (task) {
                setEvents([
                  {
                    id: stopId,
                    percent: String(task.percent ?? 0),
                    speed: task.speed || "0 B/s",
                  },
                ]);
              }
            })
            .catch(() => {
              // 快照拉不到就保留事件缓存值
            });
        }
        mutate();
        return;
      }

      // Tasks created externally (browser extension, Docker clients)
      // arrive here — refetch so the new rows show up immediately
      // without a manual refresh.
      if (isCreatedEvent(eventData)) {
        mutate();
        return;
      }

      if (isProgressEvent(eventData)) {
        const events = eventData.data.map((item) => ({
          percent: item.percent,
          speed: item.speed,
          id: item.id,
        }));
        setEvents(events);

        mutate(
          (current) => {
            if (!current) {
              return current;
            }

            const progressMap = new Map(
              eventData.data.map((item) => [item.id, item]),
            );
            let changed = false;
            const nextList = current.list.map((item) => {
              if (!progressMap.has(item.id)) {
                return item;
              }
              if (item.status === DownloadStatus.Downloading) {
                return item;
              }
              changed = true;
              return {
                ...item,
                status: DownloadStatus.Downloading,
              };
            });

            if (!changed) {
              return current;
            }

            return {
              ...current,
              list: nextList,
            };
          },
          { revalidate: false },
        );
      }
    },
    [mutate, setEvents, removeEvent],
  );

  // Subscribe to Go SSE download events（Callback 契约是 (...args: unknown[])，
  // 事件载荷在 [1] 位）
  useEffect(() => {
    return onDownloadEvent((...args: unknown[]) =>
      handleDownloadEvent(args[0], args[1] as DownloadEvent),
    );
  }, [handleDownloadEvent]);

  return {
    data: detail,
    total: data?.total || 0,
    isLoading,
    error,
    mutate,
    pagination: {
      page,
      pageSize,
    },
    setPage,
    setPageSize,
  };
}
