// 全部视图 —— 六类内容的统一时间混排列表（不再分段分组）：
// 媒体任务（media core /api/downloads 全状态）+ 影视服务器下载（/tv/api/local-sources）
// + 音乐下载库（/music/api/download/library）合成一个列表，按添加时间倒序；
// 进行中任务稳定置前。每行展示来源类别徽标 + 状态 + 名称 + 时间，点击行跳转
// 对应分类 tab；右键行弹出差异化管理菜单（按内容类型提供操作，web 自绘）。
// 数据 5s 轻轮询保持状态新鲜（三源合计数据量小）。
import { App, Empty } from "antd";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "antd";
import { useWebContextMenu, type ContextMenuItem } from "@/components/web-context-menu";
import { useContentMenu } from "./content-menu";
import { useDeleteTasks } from "@/components/delete-tasks-dialog";
import {
  startDownload,
  getDownloadTasks as fetchMediaTasks,
} from "@/api/download-task";
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
import { movieFallbackVideo } from "@/utils/play-actions";
import { useInlinePlayer } from "./inline-player";
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
  /** 影视记录（播放/删除用完整记录；key 仅作菜单去重） */
  movieRecord?: MovieSourceRecord;
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
  const inlinePlayer = useInlinePlayer();
  /** 多选集合（MixedItem.key）——对齐磁力 tab 的批量交互 */
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const refreshAll = useMemoizedFn(() => {
    void mutateMedia();
    void mutateMovie();
    void mutateMusic();
  });

  // 内容级菜单/动作共享底座（与各分类 tab 同源）：音乐 guest 协议、
  // 任务/影视/音乐的载荷级动作、日志弹层
  const {
    menu: _sharedMenu,
    logModal,
    music,
    taskAction,
    movieAction,
    musicFileAction,
    musicTaskAction,
  } = useContentMenu({ refresh: refreshAll, inlinePlayer, confirmDelete });

  /** 差异化管理菜单（按内容类型）：首项进入对应 tab，尾部刷新；
   *  中间操作块按 kind 提供——媒体任务（取消/日志/删除三选一确认）、
   *  影视记录（删记录含文件）、音乐任务（取消）、音乐文件（删文件） */
  /** 差异化管理菜单：提供真正的内容操作——音乐文件=播放/收藏/加入
   *  播放列表/删除；影视=直接播放/删除；媒体视频=播放/取消/日志/删除；
   *  磁力·文件=取消/日志/删除。公共尾部进入 tab/刷新。 */
  const buildMenuItems = (item: MixedItem): ContextMenuItem[] => {
    const kindLabel = KIND_TAG[item.kind].text;
    const items: ContextMenuItem[] = [];
    if (item.musicFilePath) {
      items.push({ key: "play-music", label: "播放" });
      items.push({ key: "fav-music", label: "收藏" });
      const playlists = music.musicState?.playlists ?? [];
      if (playlists.length > 0) {
        for (const pl of playlists) {
          items.push({ key: `add-pl-${pl.id}`, label: `加入「${pl.name}」` });
        }
      } else {
        items.push({ key: "no-pl", label: "暂无播放列表", disabled: true });
      }
      items.push({ key: "sep-music", label: "", separator: true });
      items.push({ key: "del-music-file", label: "删除文件", danger: true });
    } else if (item.movieRecord) {
      const playable =
        !!item.movieRecord.playRoute || !!movieFallbackVideo(item.movieRecord);
      items.push({ key: "play-movie", label: "立即播放", disabled: !playable });
      items.push({ key: "sep-movie", label: "", separator: true });
      items.push({ key: "del-movie", label: "删除记录（含文件）", danger: true });
    } else if (item.mediaTask && item.kind === "media") {
      if (item.active) {
        items.push({ key: "cancel", label: "取消下载" });
      }
      if (item.mediaTask.status === DownloadStatus.Success) {
        items.push({ key: "play-media", label: "播放" });
      }
      items.push({ key: "log", label: "查看日志" });
      items.push({ key: "delete", label: "删除…", danger: true });
    } else if (item.mediaTask) {
      // 磁力 / 文件任务
      if (item.active) {
        items.push({ key: "cancel", label: "取消下载" });
      }
      items.push({ key: "log", label: "查看日志" });
      items.push({ key: "delete", label: "删除…", danger: true });
    }
    items.push({ key: "sep-2", label: "", separator: true });
    items.push({ key: "enter", label: `进入「${kindLabel}」` });
    items.push({ key: "refresh", label: "刷新列表" });
    return items;
  };

  /** 菜单动作分发（载荷级动作复用共享实现；进入/刷新为本视图特有） */
  const handleMenuAction = useMemoizedFn(
    async (item: MixedItem, key: string) => {
      if (key === "enter") {
        onEnter(item.kind);
        return;
      }
      if (key === "refresh") {
        refreshAll();
        return;
      }
      if (item.musicFilePath) {
        // 音乐文件：播放/收藏/加入播放列表/删除文件（含 409 并发重试链路）
        await musicFileAction(key, {
          path: item.musicFilePath,
          name: item.title,
          artist: item.subtitle.split(" · ")[0] || "",
        });
        return;
      }
      if (
        item.movieRecord &&
        (key === "play-movie" || key === "del-movie")
      ) {
        await movieAction(key, item.movieRecord);
        return;
      }
      if (
        item.mediaTask &&
        (key === "play-media" ||
          key === "cancel" ||
          key === "log" ||
          key === "delete")
      ) {
        await taskAction(key, item.mediaTask);
        return;
      }
      if (item.musicTaskId !== undefined && key === "cancel-music") {
        await musicTaskAction(key, item.musicTaskId);
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
        movieRecord: record,
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

  // ---- 多选与批量操作（对齐磁力 tab：全选 / 批量删除 / 清除选择 / 批量启动）----
  const selectedItems = useMemo(
    () => items.filter((i) => selectedKeys.has(i.key)),
    [items, selectedKeys],
  );
  const allChecked = items.length > 0 && selectedKeys.size === items.length;
  const someChecked = selectedKeys.size > 0 && !allChecked;
  const toggleAll = (checked: boolean) =>
    setSelectedKeys(checked ? new Set(items.map((i) => i.key)) : new Set());
  const toggleOne = (key: string, checked: boolean) =>
    setSelectedKeys((cur) => {
      const next = new Set(cur);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });

  /** 批量删除（跨类型分发）：media 任务按三选一语义（choice 决定是否删
   *  文件），影视记录同 choice，音乐任务总是停止并删记录，音乐文件仅在
   *  含文件语义下删除（它本身就是内容） */
  const onDeleteBatch = useMemoizedFn(async () => {
    const sel = selectedItems;
    if (sel.length === 0) return;
    const mediaTasks = sel
      .map((i) => i.mediaTask)
      .filter((t): t is DownloadTask => !!t);
    const unfinished = mediaTasks.filter(
      (t) => t.status !== DownloadStatus.Success,
    ).length;
    const movieCount = sel.filter((i) => i.movieKey).length;
    const musicTaskCount = sel.filter((i) => i.musicTaskId !== undefined).length;
    const musicFileCount = sel.filter((i) => i.musicFilePath).length;
    const choice = await confirmDelete({
      unfinished,
      done:
        mediaTasks.length - unfinished + movieCount + musicTaskCount + musicFileCount,
      label: `${sel.length} 项内容`,
    });
    if (choice === null) return;
    const results = await Promise.allSettled([
      ...mediaTasks.map((t) => deleteMediaTask(t.id, choice)),
      ...sel
        .filter((i) => i.movieKey)
        .map((i) => deleteMovieSource(i.movieKey!, choice)),
      ...sel
        .filter((i) => i.musicTaskId !== undefined)
        .map((i) => deleteMusicTask(i.musicTaskId!)),
      ...(choice
        ? sel
            .filter((i) => i.musicFilePath)
            .map((i) => deleteMusicFile(i.musicFilePath!))
        : []),
    ]);
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) message.error(`删除失败 ${failed} 项`);
    else message.success("已删除");
    setSelectedKeys(new Set());
    refreshAll();
  });

  /** 批量启动：选中项里所有非下载中的媒体任务（failed/stopped/success 重下） */
  const onDownloadBatch = useMemoizedFn(async () => {
    const ids = selectedItems
      .map((i) => i.mediaTask)
      .filter(
        (t): t is DownloadTask =>
          !!t && t.status !== DownloadStatus.Downloading,
      )
      .map((t) => t.id);
    if (ids.length === 0) {
      message.info("选中项中没有可启动的下载任务");
      return;
    }
    await Promise.allSettled(ids.map((id) => startDownload(id)));
    message.success("已开始下载");
    setSelectedKeys(new Set());
    refreshAll();
  });

  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Empty description="暂无下载记录" />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto pr-1">
      {/* 批量操作条（对齐磁力 tab：全选 / 批量删除 / 清除选择 / 批量启动） */}
      <div className="flex flex-row items-center justify-between pb-1 pl-1">
        <div className="flex flex-row items-center gap-3">
          <Checkbox
            checked={allChecked}
            {...(someChecked ? { checked: "indeterminate" as const } : {})}
            onCheckedChange={(v) => toggleAll(v === true)}
          />
          <span
            className="cursor-pointer text-sm text-[#343434] dark:text-white"
            onClick={() => toggleAll(!allChecked)}
          >
            全选
          </span>
          {selectedKeys.size > 0 && (
            <span className="text-xs text-[#A4A4A4]">
              已选 {selectedKeys.size} 项
            </span>
          )}
        </div>
        <div className="flex flex-row items-center gap-3">
          <Button
            size="small"
            disabled={selectedKeys.size === 0}
            onClick={() => void onDeleteBatch()}
          >
            删 除
          </Button>
          <Button
            size="small"
            disabled={selectedKeys.size === 0}
            onClick={() => setSelectedKeys(new Set())}
          >
            取 消
          </Button>
          <Button
            size="small"
            type="primary"
            disabled={selectedKeys.size === 0}
            onClick={() => void onDownloadBatch()}
          >
            下 载
          </Button>
        </div>
      </div>
      {items.map((item) => {
        const tag = KIND_TAG[item.kind];
        const checked = selectedKeys.has(item.key);
        return (
          <div
            key={item.key}
            onContextMenu={(e) => onRowContextMenu(e, item)}
            className={cn(
              "flex flex-row items-center gap-2 rounded-lg px-2 transition-colors",
              checked
                ? "bg-[#EAF1FB] dark:bg-[#2C3550]"
                : "bg-[#FAFCFF] hover:bg-[#F0F4FA] dark:bg-[#27292F] dark:hover:bg-[#2E3138]",
            )}
          >
            <Checkbox
              checked={checked}
              onClick={(e) => e.stopPropagation()}
              onCheckedChange={(v) => toggleOne(item.key, v === true)}
            />
            <button
              type="button"
              onClick={() => onEnter(item.kind)}
              className="flex min-w-0 flex-1 flex-row items-center gap-2 py-2 text-left"
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
          </div>
        );
      })}
      {menu}
      {deleteDialog}
      {logModal}
    </div>
  );
};

export default AllView;
