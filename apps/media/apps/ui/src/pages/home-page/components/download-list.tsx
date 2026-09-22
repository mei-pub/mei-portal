import {
  DownloadStatus,
  type DownloadFilter,
  type DownloadTask,
} from "@mediago/shared-common";
import { useMemoizedFn } from "ahooks";
import { App, Empty, Segmented } from "antd";
import { produce } from "immer";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import DownloadForm, { type DownloadFormRef } from "@/components/download-form";
import Loading from "@/components/loading";
import { EDIT_DOWNLOAD } from "@/const";
import { usePlatform } from "@/hooks/use-platform";
import { startDownload, stopDownload } from "@/api/download-task";
import { deleteMediaTask } from "@/api/download-center";
import { useDeleteTasks } from "@/components/delete-tasks-dialog";
import { useTasks } from "@/hooks/use-tasks";
import { cn, isWeb, tdApp } from "@/utils";
import { DownloadTaskItem } from "./download-item";
import { ListHeader } from "./list-header";
import { useContentMenu, type ContextMenuItem } from "@/pages/downloads-page/components/content-menu";
import { useInlinePlayer } from "@/pages/downloads-page/components/inline-player";
import { ListSearch } from "@/pages/downloads-page/components/bulk-bar";

/** 状态过滤（对标迅雷：全部/进行中/已完成/失败） */
type StatusFilterKey = "all" | "downloading" | "done" | "failed";

const STATUS_FILTER_OPTIONS: { label: string; value: StatusFilterKey }[] = [
  { label: "全部", value: "all" },
  { label: "进行中", value: "downloading" },
  { label: "已完成", value: "done" },
  { label: "失败", value: "failed" },
];

const matchStatusFilter = (
  task: DownloadTask,
  key: StatusFilterKey,
): boolean => {
  switch (key) {
    case "downloading":
      return (
        task.status !== DownloadStatus.Success &&
        task.status !== DownloadStatus.Failed
      );
    case "done":
      return task.status === DownloadStatus.Success;
    case "failed":
      return task.status === DownloadStatus.Failed;
    default:
      return true;
  }
};

interface Props {
  filter: DownloadFilter;
  /** true 时进行中（downloading）任务稳定置前，其余保持原有顺序（下载中心全部视图用） */
  prioritizeActive?: boolean;
  /** 任务类型过滤：direct=文件 / bt=磁力 / media=视频类（下载中心分类 tab 用） */
  taskType?: string;
}

export function DownloadTaskList({
  filter,
  prioritizeActive = false,
  taskType,
}: Props) {
  const { confirmDelete, deleteDialog } = useDeleteTasks();
  const [selected, setSelected] = useState<number[]>([]);
  const { contextMenu } = usePlatform();
  const { message } = App.useApp();
  const { t } = useTranslation();
  const editFormRef = useRef<DownloadFormRef>(null);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const downloadListId = useId();
  const { mutate, isLoading, data } = useTasks(filter, taskType);

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
  const [statusFilter, setStatusFilter] = useState<StatusFilterKey>("all");

  const filteredData = useMemo(() => {
    let list = data;
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
  }, [data, searchText, statusFilter]);

  const handleSelectAll = useMemoizedFn(() => {
    setSelected(
      produce((draft) => {
        if (draft.length) {
          draft.splice(0, draft.length);
        } else {
          // 只全选可见行（搜索/状态过滤后的结果，对齐迅雷语义）
          draft.push(...filteredData.map((task) => task.id));
        }
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
  const orderedData = useMemo(() => {
    if (!prioritizeActive) return filteredData;
    return filteredData
      .map((task, index) => ({ task, index }))
      .sort((a, b) => {
        const aActive = a.task.status === DownloadStatus.Downloading ? 0 : 1;
        const bActive = b.task.status === DownloadStatus.Downloading ? 0 : 1;
        return aActive - bActive || a.index - b.index;
      })
      .map((item) => item.task);
  }, [filteredData, prioritizeActive]);

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
      // web/门户环境：内容级浮层菜单（能力对齐全部 tab，多选/编辑为列表个性化项）
      if (isWeb) {
        const extra: ContextMenuItem[] = [
          { key: "dl-select", label: t("select") },
        ];
        if (task.status !== DownloadStatus.Success) {
          extra.push({ key: "dl-edit", label: "编辑…" });
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
  // 未完成任务服务端总是停止下载（deleteFiles 仅对已完成任务的文件生效）
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
      targets.map((task) => deleteMediaTask(task.id, choice)),
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
    const results = await Promise.allSettled(
      ids.map((id) => startDownload(Number(id))),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed === 0) {
      message.success(t("addTaskSuccess"));
    } else if (failed === ids.length) {
      message.error(`批量启动失败（${failed} 项）`);
    } else {
      message.warning(`${ids.length - failed} 项已开始，${failed} 项失败`);
    }
    mutate();
    setSelected([]);
  });

  const onCancelItems = useMemoizedFn(async () => {
    setSelected([]);
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
  const { menu, logModal, openTaskMenu } = useContentMenu({
    refresh: useMemoizedFn(() => void mutate()),
    inlinePlayer: useInlinePlayer(),
    confirmDelete,
    onEditTask: handleShowDownloadForm,
    onSelectTask: useMemoizedFn((id: number) => {
      setSelected(
        produce((draft) => {
          if (!draft.includes(id)) draft.push(id);
        }),
      );
    }),
  });

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <div className="flex flex-row items-center justify-end gap-2 pb-2">
        <ListSearch value={searchText} onChange={setSearchText} placeholder="搜索任务" />
        <Segmented
          size="small"
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as StatusFilterKey)}
          options={STATUS_FILTER_OPTIONS}
        />
      </div>
      <ListHeader
        selected={selected}
        checked={listChecked}
        onSelectAll={handleSelectAll}
        onDeleteItems={onDeleteItems}
        onDownloadItems={onDownloadItems}
        onCancelItems={onCancelItems}
        filter={filter}
      />
      <div
        className={cn(
          "flex w-full flex-1 shrink-0 flex-col gap-3 overflow-auto",
        )}
      >
        {isLoading && <Loading />}
        {orderedData.length === 0 && !isLoading && (
          <div className="flex h-full flex-1 flex-row items-center justify-center rounded-lg bg-white dark:bg-[#1F2024]">
            <Empty description={t("noData")} />
          </div>
        )}
        {orderedData.length > 0 &&
          orderedData.map((task) => {
            return (
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
              />
            );
          })}
      </div>
      <DownloadForm
        id={downloadListId}
        ref={editFormRef}
        isEdit
        onConfirm={handleFormConfirm}
      />
      {menu}
      {logModal}
      {deleteDialog}
    </div>
  );
}

// Legacy export for backward compatibility
export const DownloadList = DownloadTaskList;
