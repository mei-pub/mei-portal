// 音乐下载面板 —— 数据源：/music/api/download/library（契约 3）
// tasks = 进行中任务（进度经 shared-poll 统一 3s 轮询），files = 磁盘已下载
// （歌手/歌名/大小）；删除文件走契约 4。进行中任务天然置前（tasks 段在 files 段前）。
// 表格化（round-C ⑤ 继承任务队列基元）：单表格卡 + 节行分组（进行中任务 /
// 已下载文件）+ 状态页签（全部/进行中/已下载）+ 搜索 + 统一选中模型
// （任务网段 t: / 文件网段 f:）+ 迅雷式多选（Cmd/Ctrl 点选 / Shift 范围选 /
// 拖拽框选，跨两段生效）。
import { App } from "antd";
import {
  CustomerServiceOutlined,
  DownloadOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  StarOutlined,
} from "@ant-design/icons";
import { useMemoizedFn } from "ahooks";
import { type FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import { Checkbox } from "@/components/ui/checkbox";
import { DeleteIcon } from "@/assets/svg";
import { IconButton } from "@/components/icon-button";
import Loading from "@/components/loading";
import {
  deleteMusicFile,
  deleteMusicTask,
  formatFileSize,
  getMusicLibrary,
  type MusicLibrary,
} from "@/api/download-center";
import { playMusicFile } from "@/utils/play-actions";
import { TaskDetailDrawer } from "@/pages/downloads-page/components/task-detail-drawer";
import type { DownloadTaskDetails } from "@/hooks/use-tasks";
import { DownloadStatus } from "@mediago/shared-common";
import { musicServeUrl } from "./content-menu";
import { songPageUrlOf } from "@/utils/song-source";
import { cn, fromatDateTime } from "@/utils";
import { useDeleteTasks } from "@/components/delete-tasks-dialog";
import { useContentMenu } from "./content-menu";
import { useInlinePlayer } from "./inline-player";
import { BulkBar, BulkButton, ListSearch, triState } from "./bulk-bar";
import { useSharedPoll } from "./shared-poll";
import { useMarqueeSelect } from "./use-marquee-select";
import {
  HEADER_CLS,
  ROW_CLS,
  ROW_SELECTED_CLS,
  TABLE_CLS,
  TOOLBAR_CLS,
} from "./table-styles";
import { Segmented } from "antd";

const EMPTY_LIBRARY: MusicLibrary = { tasks: [], files: [] };

/** 状态软徽章（对齐任务视图状态列视觉） */
const TASK_CHIP = {
  running: {
    text: "下载中",
    cls: "bg-blue-500/10 text-blue-600 dark:bg-blue-400/10 dark:text-blue-400",
  },
  failed: {
    text: "失败",
    cls: "bg-rose-500/10 text-rose-600 dark:bg-rose-400/10 dark:text-rose-400",
  },
  done: {
    text: "已完成",
    cls: "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-400",
  },
} as const;

const Chip: FC<{ kind: keyof typeof TASK_CHIP }> = ({ kind }) => (
  <span
    className={cn(
      "inline-flex shrink-0 items-center rounded-full px-2 py-[3px] text-[11px] font-medium leading-none",
      TASK_CHIP[kind].cls,
    )}
  >
    {TASK_CHIP[kind].text}
  </span>
);

/** mtime 兼容：服务端可能给秒或毫秒时间戳（>1e12 视为毫秒，防年份溢出） */
const fmtMtime = (v: number | string | undefined): string => {
  if (v == null || v === "") return "-";
  const n = typeof v === "number" ? v : Number(v);
  if (!isFinite(n) || n <= 0) return String(v);
  return fromatDateTime(new Date(n > 1e12 ? n : n * 1000), "YYYY/MM/DD");
};

/** 状态页签（继承任务队列工具条；音乐场景按两个段过滤） */
type MusicScopeKey = "all" | "tasks" | "files";
const MUSIC_SCOPE_OPTIONS: Array<{ label: string; value: MusicScopeKey }> = [
  { label: "全部", value: "all" },
  { label: "进行中", value: "tasks" },
  { label: "已下载", value: "files" },
];

/** 节行（表格分组头，全宽 span；复刻任务队列/影视库节行皮相） */
const SectionRow: FC<{ text: string; count: number }> = ({ text, count }) => (
  <div className="flex shrink-0 flex-row items-center gap-2 border-b border-black/[0.04] bg-black/[0.015] px-3 py-1.5 dark:border-white/[0.05] dark:bg-white/[0.02]">
    <span className="min-w-0 truncate text-xs font-medium text-gray-600 dark:text-gray-300">
      {text}
    </span>
    <span className="shrink-0 text-[11px] tabular-nums text-gray-400 dark:text-gray-500">
      {count} 项
    </span>
  </div>
);

/** 类型瓦片（音乐统一紫色歌手瓦片；对齐任务队列列 1） */
const MusicTile: FC = () => (
  <span
    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-[15px] text-violet-600 dark:bg-violet-500/15 dark:text-violet-300"
    title="音乐"
  >
    <CustomerServiceOutlined />
  </span>
);

/** 统一选中键：任务网段 t:<id> / 文件网段 f:<path> */
const taskKeyOf = (id: string | number): string => `t:${id}`;
const fileKeyOf = (path: string, fileName?: string): string =>
  `f:${path || fileName || ""}`;

const MusicPanel: FC = () => {
  const { confirmDelete, deleteDialog } = useDeleteTasks();
  const { message, modal } = App.useApp();
  const { t } = useTranslation();
  // 内容级右键菜单（播放/收藏/加入播放列表/取消/删除）——能力对齐全部 tab；
  // 操作区另有收藏 / 加入播放列表两个行内入口（按钮弹一级播放列表选择浮层）
  const {
    menu,
    openMusicFileMenu,
    openMusicPlaylistMenu,
    musicFileAction,
    openMusicTaskMenu,
    openMusicTaskBatchMenu,
    openMusicFileBatchMenu,
  } = useContentMenu({
    refresh: useMemoizedFn(() => void mutate()),
    inlinePlayer: useInlinePlayer(),
    confirmDelete,
  });
  const { data, error, isLoading, mutate } = useSWR(
    "download-center/music",
    getMusicLibrary,
    { revalidateOnFocus: false },
  );

  const library = useMemo(() => data ?? EMPTY_LIBRARY, [data]);

  const tasks = library.tasks ?? [];
  const files = library.files ?? [];

  // 状态页签 + 搜索过滤（继承任务队列工具条；页签裁掉另一段）
  const [scope, setScope] = useState<MusicScopeKey>("all");
  const [searchText, setSearchText] = useState("");

  const pendingTasks = useMemo(
    () => tasks.filter((t) => t.status !== "done"),
    [tasks],
  );

  const visibleTasks = useMemo(() => {
    if (scope === "files") return [];
    const kw = searchText.trim().toLowerCase();
    if (!kw) return pendingTasks;
    return pendingTasks.filter((t) =>
      `${t.song?.name ?? ""}${t.song?.artist ?? ""}`.toLowerCase().includes(kw),
    );
  }, [pendingTasks, searchText, scope]);

  const visibleFiles = useMemo(() => {
    if (scope === "tasks") return [];
    const kw = searchText.trim().toLowerCase();
    if (!kw) return files;
    return files.filter((f) =>
      `${f.name ?? ""}${f.fileName ?? ""}${f.artist ?? ""}`
        .toLowerCase()
        .includes(kw),
    );
  }, [files, searchText, scope]);

  // ---- 统一选中模型（跨两段；任务网段 t: / 文件网段 f:）----
  const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set());
  const selectedTaskIds = useMemo(
    () =>
      [...selectedSet]
        .filter((k) => k.startsWith("t:"))
        .map((k) => k.slice(2)),
    [selectedSet],
  );
  const selectedFileKeys = useMemo(
    () => [...selectedSet].filter((k) => k.startsWith("f:")).map((k) => k.slice(2)),
    [selectedSet],
  );
  const visibleRowKeys = useMemo(
    () => [
      ...visibleTasks.map((t) => taskKeyOf(t.id)),
      ...visibleFiles.map((f) => fileKeyOf(f.path, f.fileName)),
    ],
    [visibleTasks, visibleFiles],
  );

  const toggleRow = useMemoizedFn((key: string) => {
    setSelectedSet((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  });

  const handleSelectAll = useMemoizedFn((v: boolean | "indeterminate") => {
    // 部分选中状态点击全选 = 全选（对齐任务队列工具条语义）
    setSelectedSet(v === true ? new Set(visibleRowKeys) : new Set());
  });

  // ---- 行平单击 → 详情侧栏（复用 TaskDetailDrawer 的音乐行分支）----
  const [detailTask, setDetailTask] = useState<DownloadTaskDetails | null>(null);

  const taskRowToDetail = (t: (typeof tasks)[number]): DownloadTaskDetails =>
    ({
      id: -1,
      type: "music",
      name: t.song?.artist ? `${t.song.name} - ${t.song.artist}` : t.song?.name ?? "-",
      url: t.path ?? "",
      status:
        t.status === "error" ? DownloadStatus.Failed : DownloadStatus.Downloading,
      createdDate: new Date(),
      music: {
        kind: "task",
        taskId: t.id,
        path: t.path ?? "",
        song: t.song ?? { name: "", artist: "", source: "" },
        error: t.error,
      },
    }) as unknown as DownloadTaskDetails;

  const marquee = useMarqueeSelect<string>({
    rows: visibleRowKeys,
    isSelected: (key) => selectedSet.has(key),
    commit: (next) => setSelectedSet(next),
    open: (key) => {
      if (key.startsWith("f:")) {
        const raw = key.slice(2);
        const file = visibleFiles.find(
          (f) => fileKeyOf(f.path, f.fileName) === key,
        );
        if (!file) return;
        // 详情行链接口径=源站歌曲页地址（用户契约「复制链接=复制源链接」）：
        // 抽屉复制按钮原生兜底落盘路径（如实标「复制路径」），不引入本地流直链
        const fileSong = {
          name: file.name,
          artist: file.artist ?? "",
          source: file.songSource || "",
          id: file.songId,
        };
        setDetailTask({
          id: -1,
          type: "music",
          name: file.artist ? `${file.name} - ${file.artist}` : file.name,
          url: songPageUrlOf(fileSong),
          status: DownloadStatus.Success,
          createdDate: new Date(
            typeof file.mtime === "number" ? file.mtime : Date.now(),
          ),
          music: {
            kind: "file",
            path: file.path,
            song: fileSong,
          },
        } as unknown as DownloadTaskDetails);
        return;
      }
      const task = visibleTasks.find((x) => taskKeyOf(x.id) === key);
      if (task) setDetailTask(taskRowToDetail(task));
    },
  });

  // ---- 批量动作 ----
  // 批量取消任务（= 删除任务并清理临时文件，音乐任务无独立「暂停」态）
  const handleBulkCancelTasks = useMemoizedFn(async () => {
    const targets = pendingTasks.filter((x) =>
      selectedTaskIds.includes(String(x.id)),
    );
    if (targets.length === 0) return;
    const results = await Promise.allSettled(
      targets.map((x) => deleteMusicTask(x.id)),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) message.error(`取消失败 ${failed} 项`);
    else message.success("已取消所选任务");
    setSelectedSet(new Set());
    mutate();
  });

  // 批量删除文件：一次确认 → 逐条删除
  const handleBulkDeleteFiles = useMemoizedFn(async () => {
    const targets = visibleFiles.filter((f) =>
      selectedFileKeys.includes(f.path || f.fileName || ""),
    );
    if (targets.length === 0) return;
    const ok = await new Promise<boolean>((resolve) => {
      modal.confirm({
        title: `删除 ${targets.length} 个音乐文件？`,
        content: "将从服务器删除这些音频文件，不可恢复。",
        okText: "删除",
        okButtonProps: { danger: true },
        cancelText: "取消",
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
    if (!ok) return;
    const results = await Promise.allSettled(
      targets.map((f) => deleteMusicFile(f.path)),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) message.error(`删除失败 ${failed} 项`);
    else message.success("已删除");
    setSelectedSet(new Set());
    mutate();
  });

  // 有进行中任务 → 3s 轮询进度（页面级共享计时器）；空闲时停止轮询
  useSharedPoll(visibleTasks.length > 0, mutate);

  // 已下载文件：删除即删文件本身。命令式 modal.confirm（IconButton 无 ref
  // 透传，Popconfirm 浮层挂不上）
  const handleDeleteFile = useMemoizedFn((path: string, name: string) => {
    modal.confirm({
      title: `删除文件「${name}」？`,
      content: "将从服务器删除该音频文件，不可恢复。",
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          await deleteMusicFile(path);
          message.success(`已删除 ${name}`);
          mutate();
        } catch (e) {
          message.error((e as Error).message || "删除失败");
        }
      },
    });
  });

  // 未完成任务：停止下载 + 删记录 + 清理 .part 临时文件（服务端级联，无需选择）
  const handleDeleteTask = useMemoizedFn(
    async (taskId: string | number, name: string) => {
      const choice = await confirmDelete({
        unfinished: 1,
        done: 0,
        label: `下载任务「${name}」`,
      });
      if (choice === null) return; // 取消
      try {
        await deleteMusicTask(taskId);
        message.success("已删除任务并清理临时文件");
        mutate();
      } catch (e) {
        message.error((e as Error).message || "删除失败");
      }
    },
  );

  const renderTaskRows = () =>
    visibleTasks.map((task) => {
      const percent = Math.max(0, Math.min(100, Math.round(task.percent ?? 0)));
      const failed = task.error != null && task.error !== "";
      const key = taskKeyOf(task.id);
      const selected = selectedSet.has(key);
      return (
        <div
          key={key}
          {...marquee.rowProps(key)}
          className={cn(ROW_CLS, selected && ROW_SELECTED_CLS)}
          onContextMenu={(e) => {
            // 多选态右键：命中已选任务且选中 >1 → 批量菜单（全可取消才出现入口）
            if (selectedTaskIds.length > 1 && selectedTaskIds.includes(String(task.id))) {
              const targets = pendingTasks.filter((x) =>
                selectedTaskIds.includes(String(x.id)),
              );
              openMusicTaskBatchMenu(e, targets);
              return;
            }
            openMusicTaskMenu(e, task.id, task.song?.name ?? "-");
          }}
        >
          <div className="flex w-4 shrink-0 items-center">
            <Checkbox
              checked={selected}
              onCheckedChange={() => toggleRow(key)}
            />
          </div>
          <MusicTile />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex min-w-0 flex-row items-center gap-1.5">
              <span
                className={cn(
                  "min-w-0 truncate text-[13px] font-medium text-gray-900 dark:text-gray-200",
                  failed && "text-[#ff7373] dark:text-[#ff7373]",
                )}
                title={task.song?.name}
              >
                {task.song?.name ?? "-"}
              </span>
              <span className="shrink-0 text-[11px] leading-none text-gray-400 dark:text-gray-500">
                {task.song?.artist ?? "-"}
                {task.song?.source ? ` · ${task.song.source}` : ""}
              </span>
            </div>
            {failed ? (
              <div
                className="truncate text-[11px] leading-[18px] text-[#ff7373]"
                title={task.error}
              >
                {task.error}
              </div>
            ) : (
              <div className="flex min-w-0 flex-row items-center gap-2 text-[11px] leading-none text-gray-500 dark:text-gray-400">
                <div className="h-1 min-w-0 max-w-md flex-1 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/10">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-[width] duration-300"
                    style={{ width: `${Math.max(percent, 2)}%` }}
                  />
                </div>
                <span className="shrink-0 tabular-nums">{percent}%</span>
                {task.speed ? (
                  <span className="shrink-0 tabular-nums">{task.speed}</span>
                ) : null}
              </div>
            )}
          </div>
          {/* 大小列（音乐任务未知体积，对齐任务队列网格恒为 —） */}
          <div className="w-[88px] shrink-0 text-right text-[11px] leading-none tabular-nums text-gray-500 dark:text-gray-400">
            —
          </div>
          <div className="flex w-[118px] shrink-0 flex-col items-end gap-1">
            {failed ? <Chip kind="failed" /> : <Chip kind="running" />}
          </div>
          <div className="flex w-[160px] shrink-0 flex-row items-center justify-end gap-1">
            <IconButton
              size="md"
              title="取消任务"
              icon={<DeleteIcon />}
              onClick={() => handleDeleteTask(task.id, task.song?.name ?? "-")}
            />
          </div>
        </div>
      );
    });

  const renderFileRows = () =>
    visibleFiles.map((file) => {
      const raw = file.path || file.fileName || "";
      const key = fileKeyOf(raw);
      const selected = selectedSet.has(key);
      return (
        <div
          key={key}
          {...marquee.rowProps(key)}
          className={cn(ROW_CLS, selected && ROW_SELECTED_CLS)}
          onContextMenu={(e) => {
            // 多选态右键：命中已选文件且选中 >1 → 批量菜单（收藏/歌单/复制/删除）
            const selCount = selectedFileKeys.length;
            if (selCount > 1 && selectedFileKeys.includes(raw)) {
              const targets = visibleFiles
                .filter((f) => selectedFileKeys.includes(f.path || f.fileName || ""))
                .map((f) => ({
                  path: f.path,
                  name: f.name || f.fileName,
                  artist: f.artist || "",
                }));
              openMusicFileBatchMenu(e, targets);
              return;
            }
            openMusicFileMenu(e, {
              path: file.path,
              name: file.name || file.fileName,
              artist: file.artist || "",
              // 源 id/source 随行透传：菜单按可构造性决定是否展示「复制链接」
              songId: file.songId,
              songSource: file.songSource,
            });
          }}
        >
          <div className="flex w-4 shrink-0 items-center">
            <Checkbox
              checked={selected}
              onCheckedChange={() => toggleRow(key)}
            />
          </div>
          <MusicTile />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div
              className="min-w-0 truncate text-[13px] font-medium text-gray-900 dark:text-gray-200"
              title={file.fileName || file.name}
            >
              {file.name || file.fileName}
            </div>
            <div className="min-w-0 truncate text-[11px] leading-[15px] text-gray-400 dark:text-gray-500">
              {file.artist || "-"}
            </div>
          </div>
          <div className="w-[88px] shrink-0 text-right text-[11px] leading-none tabular-nums text-gray-500 dark:text-gray-400">
            {formatFileSize(file.size)}
          </div>
          <div className="flex w-[118px] shrink-0 flex-col items-end gap-1">
            <Chip kind="done" />
            <span className="text-[11px] leading-none tabular-nums text-gray-400 dark:text-gray-500">
              {fmtMtime(file.mtime)}
            </span>
          </div>
          <div className="flex w-[160px] shrink-0 flex-row items-center justify-end gap-1">
            <IconButton
              size="md"
              title={t("playVideo")}
              icon={<PlayCircleOutlined />}
              onClick={() => playMusicFile(file)}
            />
            <IconButton
              size="md"
              title="下载到本机"
              icon={<DownloadOutlined />}
              onClick={() => {
                window.location.href = musicServeUrl(file.path);
              }}
            />
            <IconButton
              size="md"
              title="收藏"
              icon={<StarOutlined />}
              onClick={() => void musicFileAction("fav-music", file)}
            />
            <IconButton
              size="md"
              title="加入播放列表"
              icon={<PlusOutlined />}
              onClick={(e) => openMusicPlaylistMenu(e, file)}
            />
            <IconButton
              size="md"
              title={t("delete")}
              icon={<DeleteIcon />}
              onClick={() => handleDeleteFile(file.path, file.name || file.fileName)}
            />
          </div>
        </div>
      );
    });

  if (isLoading) {
    return <Loading />;
  }

  if (error) {
    return (
      <div className="flex h-full min-h-[280px] flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-rose-500/20 bg-rose-500/[0.03] py-10">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-500">
          <CustomerServiceOutlined className="text-[24px]" />
        </span>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          音乐服务不可用，暂时无法获取下载库
        </span>
      </div>
    );
  }

  if (tasks.length === 0 && files.length === 0) {
    return (
      <div className="flex h-full min-h-[280px] flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-black/[0.08] bg-black/[0.015] py-10 dark:border-white/[0.08] dark:bg-white/[0.02]">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6366F1]/10 to-[#8B5CF6]/15 text-[#6366F1] dark:text-[#A78BFA]">
          <CustomerServiceOutlined className="text-[24px]" />
        </span>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          暂无音乐下载
        </span>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden pr-1">
      {/* 单行工具条（继承任务队列）：全选(三态·跨两段) + 状态页签 + 搜索 */}
      <div className={TOOLBAR_CLS}>
        {visibleRowKeys.length > 0 ? (
          <Checkbox
            className="mr-1"
            title="全选"
            checked={triState(selectedSet.size, visibleRowKeys.length)}
            onCheckedChange={handleSelectAll}
          />
        ) : null}
        <Segmented
          size="small"
          className="rounded-full p-0.5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
          value={scope}
          onChange={(v) => {
            setScope(v as MusicScopeKey);
            // 页签语义切换时保留对方段选中无意义：切换即清理跨段残留
            setSelectedSet((prev) => {
              const keep =
                v === "all"
                  ? [...prev]
                  : v === "tasks"
                    ? [...prev].filter((k) => k.startsWith("t:"))
                    : [...prev].filter((k) => k.startsWith("f:"));
              return new Set(keep);
            });
          }}
          options={MUSIC_SCOPE_OPTIONS}
        />
        <div className="min-w-4 flex-1" />
        <div className="w-40 shrink-0">
          <ListSearch
            value={searchText}
            onChange={setSearchText}
            placeholder="搜索歌名/歌手"
          />
        </div>
      </div>
      {/* 已选条（对齐任务队列 ListHeader；取消任务 / 删除文件按网段分流） */}
      {selectedSet.size > 0 ? (
        <BulkBar
          checked={triState(selectedSet.size, visibleRowKeys.length)}
          selectedCount={selectedSet.size}
          total={visibleRowKeys.length}
          onSelectAll={handleSelectAll}
        >
          {selectedTaskIds.length > 0 ? (
            <BulkButton onClick={() => void handleBulkCancelTasks()}>
              取消所选任务
            </BulkButton>
          ) : null}
          {selectedFileKeys.length > 0 ? (
            <BulkButton danger onClick={() => void handleBulkDeleteFiles()}>
              删除所选
            </BulkButton>
          ) : null}
        </BulkBar>
      ) : null}
      {/* 表格：表头（继承任务队列网格 16|28|flex|88|118|124）+ 节行分组 */}
      <div className={TABLE_CLS}>
        <div className={HEADER_CLS}>
          <span className="w-4 shrink-0" />
          <span className="w-7 shrink-0" />
          <span className="min-w-0 flex-1">任务</span>
          <span className="w-[88px] shrink-0 text-right">大小</span>
          <span className="w-[118px] shrink-0 text-right">状态 · 时间</span>
          <span className="w-[160px] shrink-0 text-right">操作</span>
        </div>
        <div
          {...marquee.containerProps}
          className="relative flex w-full min-h-0 flex-1 flex-col overflow-auto"
        >
          {marquee.marqueeEl}
          {visibleTasks.length > 0 ? (
            <SectionRow
              text="进行中任务"
              count={visibleTasks.length}
            />
          ) : null}
          {renderTaskRows()}
          {visibleFiles.length > 0 ? (
            <SectionRow text="已下载文件" count={visibleFiles.length} />
          ) : null}
          {renderFileRows()}
        </div>
      </div>
      {menu}
      {deleteDialog}
      <TaskDetailDrawer
        task={detailTask}
        open={detailTask !== null}
        onClose={() => setDetailTask(null)}
        onChanged={() => void mutate()}
      />
    </div>
  );
};

export default MusicPanel;
