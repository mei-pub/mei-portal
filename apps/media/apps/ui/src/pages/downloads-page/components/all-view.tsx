// 全部视图 —— 六类内容的统一时间混排列表（不再分段分组）：
// 媒体任务（media core /api/downloads 全状态）+ 影视服务器下载（/tv/api/local-sources）
// + 音乐下载库（/music/api/download/library）合成一个列表，按添加时间倒序；
// 进行中任务稳定置前。每行展示来源类别徽标 + 状态 + 名称 + 时间，点击行跳转
// 对应分类 tab。数据 5s 轻轮询保持状态新鲜（三源合计数据量小）。
import { Empty } from "antd";
import { type FC, useMemo } from "react";
import useSWR from "swr";
import { DownloadStatus, type DownloadTask } from "@mediago/shared-common";
import { DownloadIcon } from "@/assets/svg";
import { DownloadTag } from "@/components/download-tag";
import { getDownloadTasks as fetchMediaTasks } from "@/api/download-task";
import {
  type MovieSourceRecord,
  type MusicLibrary,
  getMusicLibrary,
  listMovieSources,
} from "@/api/download-center";
import { cn, fromatDateTime } from "@/utils";

export type MixedKind = "media" | "movie" | "music" | "file" | "magnet";

interface AllViewProps {
  /** 点击行 → 锚定对应分类 tab（由 index 统一切换并同步 query） */
  onEnter: (tab: MixedKind) => void;
}

interface MixedItem {
  key: string;
  kind: MixedKind;
  /** 排序时间戳（毫秒） */
  ts: number;
  title: string;
  subtitle: string;
  /** 进行中（下载中）置前 */
  active: boolean;
  statusNode: React.ReactNode;
}

const KIND_TAG: Record<MixedKind, { text: string; color: string }> = {
  media: { text: "媒体", color: "#7c5cff" },
  movie: { text: "影视", color: "#6366f1" },
  music: { text: "音乐", color: "#10b981" },
  file: { text: "文件", color: "#0ea5e9" },
  magnet: { text: "磁力", color: "#f59e0b" },
};

const MEDIA_TYPE_LABEL: Record<string, string> = {
  m3u8: "流媒体",
  bilibili: "B站",
  youtube: "YouTube",
  mediago: "MediaGo",
  direct: "文件",
  bt: "磁力",
};

const STATUS_DONE = <DownloadTag text="已完成" color="#09ce87" />;
const STATUS_PENDING = <DownloadTag text="等待中" color="#9abbe2" />;

function mediaStatusNode(status?: DownloadStatus): React.ReactNode {
  switch (status) {
    case DownloadStatus.Success:
      return STATUS_DONE;
    case DownloadStatus.Downloading:
      return (
        <DownloadTag
          icon={<DownloadIcon fill="#fff" width={14} height={14} />}
          text="下载中"
          color="#127af3"
        />
      );
    case DownloadStatus.Failed:
      return <DownloadTag text="失败" color="#ff7373" />;
    case DownloadStatus.Stopped:
      return <DownloadTag text="已停止" color="#9abbe2" />;
    default:
      return STATUS_PENDING;
  }
}

function movieStatusNode(record: MovieSourceRecord): React.ReactNode {
  switch (record.status) {
    case "done":
      return STATUS_DONE;
    case "downloading":
      return (
        <DownloadTag
          icon={<DownloadIcon fill="#fff" width={14} height={14} />}
          text="下载中"
          color="#127af3"
        />
      );
    case "failed":
      return <DownloadTag text="失败" color="#ff7373" />;
    default:
      return STATUS_PENDING;
  }
}

const toDateTs = (v: unknown): number => {
  if (typeof v === "number" && Number.isFinite(v)) {
    // 秒级 epoch（音乐 mtime）→ 毫秒
    return v > 1e12 ? v : v * 1000;
  }
  if (typeof v === "string" && v !== "") {
    const t = new Date(v.replace(" ", "T")).getTime();
    if (Number.isFinite(t)) return t;
  }
  if (v instanceof Date) return v.getTime();
  return 0;
};

const AllView: FC<AllViewProps> = ({ onEnter }) => {
  // 三源并行拉取：媒体任务全状态（含文件/磁力/视频类），影视与音乐各自契约
  const { data: mediaData } = useSWR(
    "download-center/all/media",
    () => fetchMediaTasks({ current: 1, pageSize: 200, filter: undefined }),
    { refreshInterval: 5000, revalidateOnFocus: false },
  );
  const { data: movieData } = useSWR(
    "download-center/movie",
    listMovieSources,
    {
      refreshInterval: 5000,
      revalidateOnFocus: false,
    },
  );
  const { data: musicData } = useSWR("download-center/music", getMusicLibrary, {
    refreshInterval: 5000,
    revalidateOnFocus: false,
  });

  const items = useMemo<MixedItem[]>(() => {
    const out: MixedItem[] = [];
    const now = Date.now();

    for (const task of (mediaData?.list ?? []) as DownloadTask[]) {
      out.push({
        key: `media-${task.id}`,
        kind:
          task.type === ("direct" as string)
            ? "file"
            : task.type === ("bt" as string)
              ? "magnet"
              : "media",
        ts: toDateTs(task.createdDate),
        title: task.name,
        subtitle: MEDIA_TYPE_LABEL[task.type as string] ?? String(task.type),
        active: task.status === DownloadStatus.Downloading,
        statusNode: mediaStatusNode(task.status),
      });
    }

    for (const record of movieData ?? []) {
      out.push({
        key: `movie-${record.key}`,
        kind: "movie",
        ts: toDateTs(record.updatedAt || record.createdAt),
        title: `《${record.title}》${record.name}`,
        subtitle: record.category || "影视",
        active: record.status === "downloading",
        statusNode: movieStatusNode(record),
      });
    }

    const library: MusicLibrary = musicData ?? { tasks: [], files: [] };
    for (const task of library.tasks ?? []) {
      out.push({
        key: `music-task-${task.id}`,
        kind: "music",
        ts: now,
        title: task.song?.name ?? "-",
        subtitle: [task.song?.artist, task.song?.source]
          .filter(Boolean)
          .join(" · "),
        active: true,
        statusNode: (
          <DownloadTag
            icon={
              task.error ? undefined : (
                <DownloadIcon fill="#fff" width={14} height={14} />
              )
            }
            text={task.error ? "失败" : "下载中"}
            color={task.error ? "#ff7373" : "#127af3"}
          />
        ),
      });
    }
    for (const file of library.files ?? []) {
      out.push({
        key: `music-file-${file.path}`,
        kind: "music",
        ts: toDateTs(file.mtime),
        title: file.name || file.fileName,
        subtitle: file.artist || "音乐",
        active: false,
        statusNode: STATUS_DONE,
      });
    }

    // 进行中置前，其余按时间倒序（稳定：同时间按 key 保序）
    return out.sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return b.ts - a.ts;
    });
  }, [mediaData, movieData, musicData]);

  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Empty description="暂无下载记录" />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto pr-1">
      {items.map((item) => {
        const tag = KIND_TAG[item.kind];
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onEnter(item.kind)}
            className={cn(
              "flex flex-row items-center gap-2 rounded-lg bg-[#FAFCFF] px-3 py-2 text-left transition-colors hover:bg-[#F0F4FA] dark:bg-[#27292F] dark:hover:bg-[#2E3138]",
            )}
          >
            <DownloadTag text={tag.text} color={tag.color} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div
                className="truncate text-sm text-[rgba(0,0,0,0.88)] dark:text-[rgba(255,255,255,0.85)]"
                title={item.title}
              >
                {item.title}
              </div>
              <div className="flex flex-row gap-2 text-xs text-[#B3B3B3] dark:text-[#515257]">
                <span className="shrink-0">
                  {fromatDateTime(
                    item.ts > 0 ? new Date(item.ts) : undefined,
                    "YYYY/MM/DD HH:mm",
                  )}
                </span>
                <span className="truncate">{item.subtitle}</span>
              </div>
            </div>
            {item.statusNode}
          </button>
        );
      })}
    </div>
  );
};

export default AllView;
