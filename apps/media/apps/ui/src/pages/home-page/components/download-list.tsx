import {
  DownloadStatus,
  type DownloadFilter,
  type DownloadTask,
} from "@mediago/shared-common";
import {
  CaretRightOutlined,
  CheckSquareOutlined,
  EditOutlined,
  InboxOutlined,
  PauseOutlined,
  PlusOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { useMemoizedFn } from "ahooks";
import { App, Button, Segmented, Space } from "antd";import { produce } from "immer";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import DownloadForm, { type DownloadFormRef } from "@/components/download-form";
import Loading from "@/components/loading";
import { EDIT_DOWNLOAD } from "@/const";
import { usePlatform } from "@/hooks/use-platform";
import { startDownload, stopDownload } from "@/api/download-task";
import { deleteMediaTask, deleteMusicFile, deleteMusicTask } from "@/api/download-center";
import { useDeleteTasks } from "@/components/delete-tasks-dialog";
import { useTasks, type DownloadTaskDetails, type MusicRowMeta } from "@/hooks/use-tasks";
import { cn, http, isWeb, tdApp } from "@/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { DownloadTaskItem } from "./download-item";
import { ListHeader } from "./list-header";
import { useContentMenu, type ContextMenuItem } from "@/pages/downloads-page/components/content-menu";
import { TaskDetailDrawer } from "@/pages/downloads-page/components/task-detail-drawer";
import { useInlinePlayer } from "@/pages/downloads-page/components/inline-player";
import { ListSearch } from "@/pages/downloads-page/components/bulk-bar";
import { useMarqueeSelect } from "@/pages/downloads-page/components/use-marquee-select";

/** 状态页签(主分类维度收敛为五档:全部/进行中/已暂停/已完成/失败;
 *  等待中+下载中=进行中,未完成=全部的补集故并入全部) */
type StatusFilterKey = "all" | "running" | "paused" | "done" | "failed";

/** 状态页签视觉:着色小圆点表达状态语言(对齐系统状态色惯例) */
const STATUS_META: Record<StatusFilterKey, { label: string; dot: string }> = {
  all: { label: "全部", dot: "bg-gray-300 dark:bg-zinc-600" },
  running: { label: "进行中", dot: "bg-blue-500" },
  paused: { label: "已暂停", dot: "bg-orange-400" },
  done: { label: "已完成", dot: "bg-emerald-500" },
  failed: { label: "失败", dot: "bg-rose-500" },
};

const STATUS_OPTIONS: StatusFilterKey[] = ["all", "running", "paused", "done", "failed"];

const matchStatusFilter = (
  task: DownloadTask,
  key: StatusFilterKey,
): boolean => {
  switch (key) {
    case "running":
      return (
        task.status === DownloadStatus.Pending ||
        task.status === DownloadStatus.Ready ||
        task.status === DownloadStatus.Downloading
      );
    case "paused":
      return task.status === DownloadStatus.Stopped;
    case "done":
      return task.status === DownloadStatus.Success;
    case "failed":
      return task.status === DownloadStatus.Failed;
    default:
      return true;
  }
};

/** 深链旧状态键 → 新五档页签(waiting/downloading/undone→进行中) */
const parseInitialStatus = (raw?: string): StatusFilterKey => {
  switch (raw) {
    case "waiting":
    case "downloading":
    case "undone":
      return "running";
    case "paused":
      return "paused";
    case "done":
      return "done";
    case "failed":
      return "failed";
    default:
      return "all";
  }
};

interface Props {
  filter: DownloadFilter;
  /** true 时进行中（downloading）任务稳定置前，其余保持原有顺序（下载中心全部视图用） */
  prioritizeActive?: boolean;
  /** 任务类型过滤：direct=文件 / bt=磁力 / media=视频类（下载中心分类 tab 用） */
  taskType?: string;
  /** false 时隐藏已完成行（FluxDown 任务视图「显示已完成」开关） */
  showDone?: boolean;
  /** 分组视图：不分组 / 按队列 / 按协议（FluxDown「分组」） */
  groupKey?: "none" | "queue" | "protocol";
  /** 排序：添加时间（默认，服务端序）/ 大小 / 速度 */
  sortKey?: "added" | "size" | "speed";
  /** 初始状态页签（深链预置：waiting/downloading/paused/done/undone/failed） */
  initialStatus?: string;
  /** 空态「新建下载」入口回调（FluxDown 空态引导） */
  onOpenNew?: () => void;
  /** 工具条右侧扩展（调用方的分组/排序/全局操作等，收敛进单行工具条） */
  toolbarExtra?: ReactNode;
}

export function DownloadTaskList({
  filter,
  prioritizeActive = false,
  taskType,
  showDone = true,
  groupKey = "none",
  sortKey = "added",
  initialStatus,
  onOpenNew,
  toolbarExtra,
}: Props) {
  const { confirmDelete, deleteDialog } = useDeleteTasks();
  const [selected, setSelected] = useState<number[]>([]);
  /** 任务详情侧栏(右键「详情」/失败原因点击 → 人话化失败信息) */
  const [detailTask, setDetailTask] = useState<DownloadTaskDetails | null>(
    null,
  );
  const { contextMenu } = usePlatform();
  const { message } = App.useApp();
  const { t } = useTranslation();
  const editFormRef = useRef<DownloadFormRef>(null);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const downloadListId = useId();
  const { mutate, isLoading, data } = useTasks(filter, taskType);

  // 命名队列映射（行级队列徽标；引擎离线时静默无徽标——对齐 FluxDown 列表）
  const { data: engineQueues } = useSWR(
    "/api/downloads/engine-queues",
    () =>
      http.get("/api/downloads/engine-queues") as Promise<
        Array<{ queueId: string; name: string }>
      >,
    { refreshInterval: 60000, revalidateOnFocus: false },
  );
  const queueNameOf = useMemoizedFn((queueId?: string | null): string | null => {
    if (!queueId || queueId === "main") return null;
    return engineQueues?.find((q) => q.queueId === queueId)?.name ?? null;
  });

  useEffect(() => {
    return () => {
      // Clean up any pending refresh timers
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, [mutate]);

  const handleItemSelectChange = useMemoizedFn((id: number) => {
    setSelected(
      produce((draft) => {
        const index = draft.indexOf(id);
        if (index !== -1) {
          draft.splice(index, 1);
        } else {
          draft.push(id);
        }
      }),
    );
  });

  // 搜索 + 状态过滤（前端过滤，数据量小无性能问题）
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilterKey>(
    parseInitialStatus(initialStatus),
  );

  const filteredData = useMemo(() => {
    let list = data;
    if (!showDone) {
      // FluxDown「显示已完成」关闭:隐藏全部成功行
      list = list.filter((task) => task.status !== DownloadStatus.Success);
    }
    if (searchText.trim()) {
      const kw = searchText.trim().toLowerCase();
      list = list.filter((task) =>
        (task.name ?? "").toLowerCase().includes(kw),
      );
    }
    if (statusFilter !== "all") {
      list = list.filter((task) => matchStatusFilter(task, statusFilter));
    }
    return list;
  }, [data, searchText, statusFilter, showDone]);

  /** 状态页签(小圆点 + 文字) */
  const statusOptions = useMemo(
    () =>
      STATUS_OPTIONS.map((value) => ({
        label: (
          <span className="flex items-center justify-center gap-1.5">
            <span
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                STATUS_META[value].dot,
              )}
            />
            {STATUS_META[value].label}
          </span>
        ),
        value,
      })),
    [],
  );

  const handleSelectAll = useMemoizedFn(() => {
    setSelected(
      produce((draft) => {
        // 全选可见行（搜索/状态过滤后的结果，含音乐行——批量删除走音乐通道）；
        // 三态语义：未选/半选 → 全选，已全选 → 清空
        const selectable = filteredData.map((task) => task.id);
        const allSelected =
          selectable.length > 0 && selectable.every((id) => draft.includes(id));
        draft.splice(0, draft.length);
        if (!allSelected) draft.push(...selectable);
      }),
    );
  });

  const listChecked = useMemo(() => {
    if (selected.length === 0 || filteredData.length === 0) {
      return false;
    }
    if (filteredData.every((task) => selected.includes(task.id))) {
      return true;
    }
    return "indeterminate";
  }, [selected, filteredData]);

  // 进行中置前（可选）：downloading 优先，其余条目保持服务端原有相对顺序（稳定排序）
  // + FluxDown 排序键（size/speed;引擎任务的实时值,SSE 覆盖后即时生效）
  const speedOf = useMemoizedFn((task: DownloadTaskDetails): number => {
    const s = (task as { speed?: string }).speed ?? "";
    const m = /([\d.]+)\s*(B|KB|MiB|MB|GiB|GB)/i.exec(s);
    if (!m) return 0;
    const unit = m[2]!.toLowerCase();
    const mult =
      unit === "b" ? 1 : unit === "kb" ? 1024 : unit === "mib" || unit === "mb" ? 1024 ** 2 : 1024 ** 3;
    return Number(m[1]) * mult;
  });
  const sizeOf = (task: DownloadTaskDetails): number =>
    (task as { engine?: { totalBytes?: number } }).engine?.totalBytes ?? 0;
  const orderedData = useMemo(() => {
    let list = filteredData;
    if (sortKey === "size") {
      list = [...list].sort((a, b) => sizeOf(b) - sizeOf(a) || b.id - a.id);
    } else if (sortKey === "speed") {
      list = [...list].sort((a, b) => speedOf(b) - speedOf(a) || b.id - a.id);
    }
    if (!prioritizeActive) return list;
    return list
      .map((task, index) => ({ task, index }))
      .sort((a, b) => {
        const aActive = a.task.status === DownloadStatus.Downloading ? 0 : 1;
        const bActive = b.task.status === DownloadStatus.Downloading ? 0 : 1;
        return aActive - bActive || a.index - b.index;
      })
      .map((item) => item.task);
  }, [filteredData, prioritizeActive, sortKey]);

  /** 协议徽标(FluxDown 协议列:HTTP/FTP/ED2K/BT/磁力/媒体/音乐) */
  const protocolOf = (task: DownloadTask): string => {
    const u = task.url ?? "";
    if ((task as { type?: string }).type === "music") return t("protocolMusic");
    if (/^magnet:/i.test(u)) return t("protocolMagnet");
    if (task.type === "bt") return "BT";
    if (/^ed2k:/i.test(u)) return "eD2K";
    if (/^ftp:/i.test(u)) return "FTP";
    if (task.type === "direct") return "HTTP";
    return t("protocolMedia");
  };

  // 迅雷式多选（三合一交互）：Cmd/Ctrl 点选 + Shift 范围选 + 拖拽框选。
  // 与复选框/批量工具条共存：行内接线 data-row-key + 加号点击均落同一 selected
  const visibleRowIds = useMemo(
    () => orderedData.map((task) => task.id),
    [orderedData],
  );
  const marqueeSelect = useMarqueeSelect<number>({
    rows: visibleRowIds,
    isSelected: (id) => selected.includes(id),
    commit: (next) => setSelected(() => Array.from(next)),
    // 无选中时平单击行 → 打开详情侧栏（有选中时单击=反选，hook 处理）
    open: (id) => {
      const task = orderedData.find((t) => t.id === id);
      if (task) setDetailTask(task);
    },
  });

  /** 分组视图(FluxDown「分组」:按队列/按协议,分组头 + 组内任务) */
  const groupedData = useMemo(() => {
    if (groupKey === "none") return null;
    const map = new Map<string, DownloadTaskDetails[]>();
    for (const task of orderedData) {
      const key =
        groupKey === "queue"
          ? queueNameOf(task.queueId) ?? t("defaultQueueName")
          : protocolOf(task);
      const arr = map.get(key) ?? [];
      arr.push(task);
      map.set(key, arr);
    }
    return [...map.entries()].map(([label, tasks]) => ({ label, tasks }));
  }, [orderedData, groupKey, t]);

  const onStartDownload = useMemoizedFn(async (id: number) => {
    try {
      await startDownload(id);
      message.success(t("addTaskSuccess"));
    } catch (e) {
      message.error((e as Error)?.message || "操作失败");
    }
    mutate();
  });

  const onStopDownload = useMemoizedFn(async (id: number) => {
    try {
      await stopDownload(id);
    } catch (e) {
      message.error((e as Error)?.message || "操作失败");
    } finally {
      setTimeout(() => {
        mutate();
      }, 500);
    }
  });

  const handleFormConfirm = useMemoizedFn(async () => {
    mutate();
  });

  const handleContext = useMemoizedFn(
    async (e: React.MouseEvent, task: DownloadTask) => {
      // 多选态右键：命中已选成员且选中 >1 → 批量菜单（交集过滤，杜绝类型冲突项）
      if (selected.length > 1 && selected.includes(task.id)) {
        const targets = data.filter((t) => selected.includes(t.id));
        openTaskBatchMenu(e, targets);
        return;
      }
      // web/门户环境：内容级浮层菜单（能力对齐全部 tab，多选/编辑为列表个性化项）
      if (isWeb) {
        const extra: ContextMenuItem[] = [
          { key: "dl-select", label: t("select"), icon: <CheckSquareOutlined /> },
        ];
        if (task.status !== DownloadStatus.Success) {
          extra.push({ key: "dl-edit", label: "编辑…", icon: <EditOutlined /> });
        }
        openTaskMenu(e, task, extra);
        return;
      }
      // electron 桌面：原生菜单（IPC）
      const action = await contextMenu.show([
        { key: "select", label: t("select") },
        { key: "download", label: t("download") },
        { key: "refresh", label: t("refresh") },
        { key: "separator", label: "", type: "separator" },
        { key: "delete", label: t("delete") },
      ]);
      if (action === "select") {
        setSelected((keys) => [...keys, task.id]);
      } else if (action === "download") {
        onStartDownload(task.id);
      } else if (action === "refresh") {
        mutate();
      } else if (action === "delete") {
        await confirmAndDelete([task]);
      }
    },
  );

  // 删除交互（单条/批量/右键共用）：全未完成 → 确认级联清理临时文件；
  // 含已完成 → 三选一（仅删记录 / 删记录和文件 / 取消）。
  // 未完成任务服务端总是停止下载（deleteFiles 仅对已完成任务的文件生效）。
  // 音乐行分流：file → 删文件；task → 删音乐任务记录（不走媒体任务删除）
  const confirmAndDelete = useMemoizedFn(async (targets: DownloadTask[]) => {
    if (targets.length === 0) return;
    const unfinished = targets.filter(
      (task) => task.status !== DownloadStatus.Success,
    ).length;
    const choice = await confirmDelete({
      unfinished,
      done: targets.length - unfinished,
      label:
        targets.length === 1
          ? `任务「${targets[0].name}」`
          : `${targets.length} 个任务`,
    });
    if (choice === null) return; // 取消
    const results = await Promise.allSettled(
      targets.map((task) => {
        const musicMeta = (task as { music?: MusicRowMeta }).music;
        if (musicMeta) {
          if (musicMeta.kind === "file") return deleteMusicFile(musicMeta.path);
          if (musicMeta.taskId) return deleteMusicTask(musicMeta.taskId);
          return Promise.resolve();
        }
        return deleteMediaTask(task.id, choice);
      }),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) message.error(`删除失败 ${failed} 项`);
    else message.success("已删除");
    setSelected([]);
    mutate();
  });

  /** 单条删除（任务条目删除按钮 / 右键菜单） */
  const handleDeleteTask = useMemoizedFn((task: DownloadTask) => {
    confirmAndDelete([task]);
  });

  const onDeleteItems = useMemoizedFn(async (ids: number[]) => {
    const targets = data.filter((task) => ids.includes(task.id));
    await confirmAndDelete(targets);
  });

  const onDownloadItems = useMemoizedFn(async (ids: number[]) => {
    // 音乐行没有「重新下载」语义（文件已在盘/任务走右键），批量启动只作用于媒体任务
    const mediaIds = ids.filter((id) => {
      const t = data.find((x) => x.id === id);
      return t && !(t as { music?: unknown }).music;
    });
    if (mediaIds.length === 0) {
      message.info("所选音乐条目无需批量启动，可用右键操作");
      setSelected([]);
      return;
    }
    const results = await Promise.allSettled(
      mediaIds.map((id) => startDownload(Number(id))),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed === 0) {
      message.success(t("addTaskSuccess"));
    } else if (failed === mediaIds.length) {
      message.error(`批量启动失败（${failed} 项）`);
    } else {
      message.warning(`${mediaIds.length - failed} 项已开始，${failed} 项失败`);
    }
    mutate();
    setSelected([]);
  });

  const onCancelItems = useMemoizedFn(async () => {
    setSelected([]);
  });

  // 全部暂停/全部开始（对齐迅雷工具栏）：作用于当前搜索/状态过滤后的可见
  // 任务——暂停=进行中（downloading/pending），开始=全部可续（stopped/
  // pending/failed/ready）。引擎任务（FluxDown，engineTaskId 非空）走批量
  // 端点一次调用（daemon.task.pauseMany/resumeMany），队列任务逐条 stop/start
  const runBatchToggle = useMemoizedFn(
    async (
      targets: DownloadTaskDetails[],
      engineAction: "pause" | "resume",
      queueCall: (id: number) => Promise<void>,
    ): Promise<{ ok: number; failed: number }> => {
      const engineIds = targets
        .filter((task) => task.engineTaskId)
        .map((task) => task.id);
      const queueIds = targets
        .filter((task) => !task.engineTaskId)
        .map((task) => task.id);
      let ok = 0;
      let failed = 0;
      if (engineIds.length > 0) {
        try {
          await http.post("/api/downloads/engine-batch", {
            action: engineAction,
            ids: engineIds,
          });
          ok += engineIds.length;
        } catch {
          failed += engineIds.length;
        }
      }
      if (queueIds.length > 0) {
        const results = await Promise.allSettled(queueIds.map(queueCall));
        ok += results.filter((r) => r.status === "fulfilled").length;
        failed += results.filter((r) => r.status === "rejected").length;
      }
      return { ok, failed };
    },
  );

  const onPauseAll = useMemoizedFn(async () => {
    const targets = filteredData.filter(
      (task) =>
        task.status === DownloadStatus.Downloading ||
        task.status === DownloadStatus.Pending,
    );
    if (targets.length === 0) {
      message.info("没有进行中的任务");
      return;
    }
    const { ok, failed } = await runBatchToggle(targets, "pause", stopDownload);
    if (failed === 0) message.success("已全部暂停");
    else message.warning(`${ok} 项已暂停，${failed} 项失败`);
    mutate();
  });

  const onStartAll = useMemoizedFn(async () => {
    const targets = filteredData.filter(
      (task) =>
        task.status === DownloadStatus.Stopped ||
        task.status === DownloadStatus.Pending ||
        task.status === DownloadStatus.Failed ||
        task.status === DownloadStatus.Ready,
    );
    if (targets.length === 0) {
      message.info("没有可开始的任务");
      return;
    }
    const { ok, failed } = await runBatchToggle(targets, "resume", startDownload);
    if (failed === 0) message.success("已全部开始");
    else message.warning(`${ok} 项已开始，${failed} 项失败`);
    mutate();
  });

  const handleShowDownloadForm = useMemoizedFn((task: DownloadTask) => {
    tdApp.onEvent(EDIT_DOWNLOAD);
    const { id, name, url, headers, type, folder } = task;
    const values = {
      batch: false,
      id,
      name,
      url,
      headers,
      type,
      folder,
    };
    editFormRef.current?.openModal(values);
  });

  // 内容级右键菜单 + 日志弹层（media/file/magnet 三 tab 经本组件获得与全部 tab
  // 一致的操作能力：取消/开始/播放/日志/删除；多选与编辑为本列表个性化项）
  const { menu, logModal, taskOverlays, openTaskMenu, openTaskBatchMenu } =
    useContentMenu({
    refresh: useMemoizedFn(() => void mutate()),
    inlinePlayer: useInlinePlayer(),
    confirmDelete,
    onEditTask: handleShowDownloadForm,
    // 批量删除走列表统一路由（音乐行分流音乐通道 / 媒体任务三选一级联）
    onDeleteBatch: useMemoizedFn(async (targets: DownloadTask[]) => {
      await confirmAndDelete(targets);
    }),
    onShowDetail: useMemoizedFn((task: DownloadTask) => {
      setDetailTask(task as DownloadTaskDetails);
    }),
    onSelectTask: useMemoizedFn((id: number) => {
      setSelected(
        produce((draft) => {
          if (!draft.includes(id)) draft.push(id);
        }),
      );
    }),
  });

  /** 行渲染(分组/扁平共用):队列徽标 + 右键菜单 + 引擎详情入口 */
  /** 行内失败原因/失败徽章点击 → 详情侧栏 */
  const handleRowDetail = useMemoizedFn((task: DownloadTask) => {
    setDetailTask(task as DownloadTaskDetails);
  });

  const renderRow = (task: DownloadTaskDetails) => (
    <DownloadTaskItem
      key={task.id}
      task={task}
      selected={selected.includes(task.id)}
      onSelectChange={handleItemSelectChange}
      onStartDownload={onStartDownload}
      onStopDownload={onStopDownload}
      onContextMenu={handleContext}
      onShowEditForm={handleShowDownloadForm}
      onDeleteTask={handleDeleteTask}
      onShowDetail={handleRowDetail}
      queueName={queueNameOf(task.queueId)}
      rowProps={marqueeSelect.rowProps(task.id)}
    />
  );

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      {/* 单行工具条(吸顶):全选(三态) + 状态页签 + 搜索(定宽) + 全部起停 + 调用方扩展 */}
      <div className="sticky top-0 z-20 flex flex-row flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-black/[0.04] bg-white/85 px-3 py-2 backdrop-blur-sm dark:border-white/[0.06] dark:bg-[#1F2024]/85">
        {orderedData.length > 0 ? (
          <Checkbox
            className="mr-1"
            title="全选"
            checked={
              listChecked === true
                ? true
                : listChecked === "indeterminate"
                  ? "indeterminate"
                  : false
            }
            onCheckedChange={handleSelectAll}
          />
        ) : null}
        <Segmented
          size="small"
          className="rounded-full p-0.5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as StatusFilterKey)}
          options={statusOptions}
        />
        <div className="min-w-4 flex-1" />
        <div className="w-40 shrink-0">
          <ListSearch value={searchText} onChange={setSearchText} placeholder="搜索任务" />
        </div>
        <Space size={4}>
          <Button
            size="small"
            icon={<CaretRightOutlined />}
            onClick={() => void onStartAll()}
          >
            全部开始
          </Button>
          <Button
            size="small"
            icon={<PauseOutlined />}
            onClick={() => void onPauseAll()}
          >
            全部暂停
          </Button>
        </Space>
        {toolbarExtra ? (
          <div className="flex shrink-0 items-center gap-2">{toolbarExtra}</div>
        ) : null}
      </div>
      {selected.length > 0 ? (
        <ListHeader
          selected={selected}
          checked={listChecked}
          onSelectAll={handleSelectAll}
          onDeleteItems={onDeleteItems}
          onDownloadItems={onDownloadItems}
          onCancelItems={onCancelItems}
          filter={filter}
        />
      ) : null}
      {/* 表格化列表：明确的表头（列语义标注）+ 表体（滚动区，承载框选交互）。
          列网格：选框16 | 类型瓦片28 | 任务 flex | 大小 88 | 状态·时间 118 | 操作 124 */}
      <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-black/[0.06] bg-white/75 shadow-[0_1px_2px_rgba(16,24,40,0.03)] dark:border-white/[0.08] dark:bg-[#1F2024]/60">
        {orderedData.length > 0 ? (
          <div className="flex shrink-0 flex-row items-center gap-2.5 border-b border-black/[0.06] bg-black/[0.015] px-3 py-2 text-[11px] font-medium leading-none text-gray-400 dark:border-white/[0.07] dark:bg-white/[0.03] dark:text-gray-500">
            <span className="w-4 shrink-0" />
            <span className="w-7 shrink-0" />
            <span className="min-w-0 flex-1">任务</span>
            <span className="w-[88px] shrink-0 text-right">大小</span>
            <span className="w-[118px] shrink-0 text-right">状态 · 时间</span>
            <span className="w-[124px] shrink-0 text-right">操作</span>
          </div>
        ) : null}
        <div
          {...marqueeSelect.containerProps}
          className="relative flex w-full flex-1 shrink-0 flex-col overflow-auto"
        >
          {marqueeSelect.marqueeEl}
          {isLoading && <Loading />}
          {orderedData.length === 0 && !isLoading && (
            <div className="flex h-full min-h-[240px] flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-black/[0.08] bg-black/[0.015] py-10 dark:border-white/[0.08] dark:bg-white/[0.02]">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6366F1]/10 to-[#8B5CF6]/15 text-[#6366F1] dark:text-[#A78BFA]">
                {searchText.trim() || statusFilter !== "all" ? (
                  <SearchOutlined className="text-[24px]" />
                ) : (
                  <InboxOutlined className="text-[24px]" />
                )}
              </span>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {searchText.trim() || statusFilter !== "all"
                  ? "没有匹配的任务"
                  : t("noData")}
              </span>
              {onOpenNew ? (
                <Button
                  className="mt-0.5"
                  type="primary"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={onOpenNew}
                >
                  {t("newDownload")}
                </Button>
              ) : null}
            </div>
          )}
          {groupedData
            ? groupedData.map((g) => (
                <div key={g.label} className="flex flex-col">
                  {/* 分组节头（表格节行，全宽） */}
                  <div className="flex shrink-0 items-center gap-2 border-b border-black/[0.04] bg-black/[0.015] px-3 py-1.5 text-[11px] font-medium text-gray-500 dark:border-white/[0.05] dark:bg-white/[0.02] dark:text-gray-400">
                    <span className="shrink-0">{g.label}</span>
                    <span className="shrink-0 opacity-70">{g.tasks.length}</span>
                    <div className="h-px flex-1" />
                  </div>
                  {g.tasks.map((task) => renderRow(task))}
                </div>
              ))
            : orderedData.length > 0 &&
              orderedData.map((task) => renderRow(task))}
        </div>
      </div>
      <DownloadForm
        id={downloadListId}
        ref={editFormRef}
        isEdit
        onConfirm={handleFormConfirm}
      />
      {menu}
      {taskOverlays ?? logModal}
      {detailTask ? (
        <TaskDetailDrawer
          task={detailTask}
          open
          onClose={() => setDetailTask(null)}
          onChanged={handleFormConfirm}
        />
      ) : null}
      {deleteDialog}
    </div>
  );
}

// Legacy export for backward compatibility
export const DownloadList = DownloadTaskList;
