// 全部视图 —— 六类内容的统一时间混排列表（不再分段分组）：
// 媒体任务（media core /api/downloads 全状态）+ 影视服务器下载（/tv/api/local-sources）
// + 音乐下载库（/music/api/download/library）合成一个列表，按添加时间倒序；
// 进行中任务稳定置前。每行展示来源类别徽标 + 状态 + 名称 + 时间，点击行跳转
// 对应分类 tab；右键行弹出差异化管理菜单（按内容类型提供操作，web 自绘）。
// 数据 5s 轻轮询保持状态新鲜（三源合计数据量小）。
import { App, Empty, Modal } from "antd";
import { useMemoizedFn } from "ahooks";
import {
  type FC,
  useMemo,
  useState,
} from "react";
import useSWR from "swr";
import {
  DownloadStatus,
  type DownloadTask,
} from "@mediago/shared-common";
import { DownloadIcon } from "@/assets/svg";
import { DownloadTag } from "@/components/download-tag";
import { useWebContextMenu, type ContextMenuItem } from "@/components/web-context-menu";
import Terminal from "@/components/download-terminal";
import { useDeleteTasks } from "@/components/delete-tasks-dialog";
import { stopDownload, getDownloadTasks as fetchMediaTasks } from "@/api/download-task";
import {
  type MovieSourceRecord,
  type MusicLibrary,
  deleteMediaTask,
  deleteMovieSource,
  deleteMusicFile,
  deleteMusicTask,
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
  /** 操作载荷：媒体任务（media/file/magnet 共用） */
  mediaTask?: DownloadTask;
  /** 影视记录 key（deleteMovieSource） */
  movieKey?: string;
  /** 音乐下载中任务 id */
  musicTaskId?: string | number;
  /** 音乐已下载文件路径 */
  musicFilePath?: string;
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
  const { message, modal } = App.useApp();
  // 三源并行拉取：媒体任务全状态（含文件/磁力/视频类），影视与音乐各自契约
  const { data: mediaData, mutate: mutateMedia } = useSWR(
    "download-center/all/media",
    () => fetchMediaTasks({ current: 1, pageSize: 200, filter: undefined }),
    { refreshInterval: 5000, revalidateOnFocus: false },
  );
  const { data: movieData, mutate: mutateMovie } = useSWR(
    "download-center/movie",
    listMovieSources,
    {
      refreshInterval: 5000,
      revalidateOnFocus: false,
    },
  );
  const { data: musicData, mutate: mutateMusic } = useSWR(
    "download-center/music",
    getMusicLibrary,
    {
      refreshInterval: 5000,
      revalidateOnFocus: false,
    },
  );
  const { menu, openMenu } = useWebContextMenu();
  const { confirmDelete, deleteDialog } = useDeleteTasks();
  /** 日志弹层目标（media 任务：失败/下载中排障用） */
  const [logTarget, setLogTarget] = useState<{ id: number; name: string } | null>(
    null,
  );

  const refreshAll = useMemoizedFn(() => {
    void mutateMedia();
    void mutateMovie();
    void mutateMusic();
  });

  /** 差异化管理菜单（按内容类型）：首项进入对应 tab，尾部刷新；
   *  中间操作块按 kind 提供——媒体任务（取消/日志/删除三选一确认）、
   *  影视记录（删记录含文件）、音乐任务（取消）、音乐文件（删文件） */
  const buildMenuItems = (item: MixedItem): ContextMenuItem[] => {
    const kindLabel = KIND_TAG[item.kind].text;
    const items: ContextMenuItem[] = [
      { key: "enter", label: `进入「${kindLabel}」` },
      { key: "sep-1", label: "", separator: true },
    ];
    if (item.mediaTask) {
      if (item.active) {
        items.push({ key: "cancel", label: "取消下载" });
      }
      items.push({ key: "log", label: "查看日志" });
      items.push({ key: "delete", label: "删除…", danger: true });
    } else if (item.movieKey) {
      items.push({ key: "del-movie", label: "删除记录（含文件）", danger: true });
    } else if (item.musicTaskId !== undefined) {
      items.push({ key: "cancel-music", label: "取消任务", danger: true });
    } else if (item.musicFilePath) {
      items.push({ key: "del-music-file", label: "删除文件", danger: true });
    }
    items.push({ key: "sep-2", label: "", separator: true });
    items.push({ key: "refresh", label: "刷新列表" });
    return items;
  };

  /** 菜单动作分发 */
  const handleMenuAction = useMemoizedFn(
    async (item: MixedItem, key: string) => {
      switch (key) {
        case "enter":
          onEnter(item.kind);
          break;
        case "refresh":
          refreshAll();
          break;
        case "cancel": {
          if (!item.mediaTask) break;
          await stopDownload(item.mediaTask.id);
          message.success("已取消下载");
          refreshAll();
          break;
        }
        case "log":
          if (item.mediaTask) {
            setLogTarget({ id: item.mediaTask.id, name: item.mediaTask.name });
          }
          break;
        case "delete": {
          if (!item.mediaTask) break;
          const task = item.mediaTask;
          const unfinished = task.status !== DownloadStatus.Success ? 1 : 0;
          const choice = await confirmDelete({
            unfinished,
            done: 1 - unfinished,
            label: `任务「${task.name}」`,
          });
          if (choice === null) break;
          try {
            await deleteMediaTask(task.id, choice);
            message.success("已删除");
          } catch {
            message.error("删除失败");
          }
          refreshAll();
          break;
        }
        case "del-movie": {
          if (!item.movieKey) break;
          modal.confirm({
            title: `删除《${item.title}》的下载记录？`,
            content: "将同时删除已下载的视频文件。",
            okText: "删除",
            okButtonProps: { danger: true },
            onOk: async () => {
              try {
                await deleteMovieSource(item.movieKey!, true);
                message.success("已删除");
              } catch {
                message.error("删除失败");
              }
              refreshAll();
            },
          });
          break;
        }
        case "cancel-music": {
          if (item.musicTaskId === undefined) break;
          try {
            await deleteMusicTask(item.musicTaskId);
            message.success("已取消");
          } catch {
            message.error("操作失败");
          }
          refreshAll();
          break;
        }
        case "del-music-file": {
          if (!item.musicFilePath) break;
          modal.confirm({
            title: `删除音乐文件「${item.title}」？`,
            okText: "删除",
            okButtonProps: { danger: true },
            onOk: async () => {
              try {
                await deleteMusicFile(item.musicFilePath!);
                message.success("已删除");
              } catch {
                message.error("删除失败");
              }
              refreshAll();
            },
          });
          break;
        }
      }
    },
  );

  const onRowContextMenu = useMemoizedFn(
    (e: React.MouseEvent, item: MixedItem) => {
      openMenu(e, buildMenuItems(item), (key) => void handleMenuAction(item, key));
    },
  );

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
        mediaTask: task,
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
        movieKey: record.key,
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
        musicTaskId: task.id,
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
        musicFilePath: file.path,
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
            onContextMenu={(e) => onRowContextMenu(e, item)}
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
      {menu}
      {deleteDialog}
      <Modal
        open={logTarget !== null}
        title="下载日志"
        onCancel={() => setLogTarget(null)}
        footer={null}
        width={720}
        styles={{ body: { paddingTop: 8 } }}
      >
        <p className="mb-2 truncate text-xs text-black/45 dark:text-white/45">
          {logTarget?.name}
        </p>
        <div className="h-[46vh] overflow-hidden rounded-lg bg-black">
          {logTarget && <Terminal id={logTarget.id} />}
        </div>
      </Modal>
    </div>
  );
};

export default AllView;
