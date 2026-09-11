import { DownloadStatus } from "@mediago/shared-common";
import type { DownloadFilter, DownloadTask } from "@mediago/shared-common";
import { useMemoizedFn } from "ahooks";
import { App, Empty } from "antd";
import { produce } from "immer";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import DownloadForm, { type DownloadFormRef } from "@/components/download-form";
import Loading from "@/components/loading";
import { EDIT_DOWNLOAD } from "@/const";
import { usePlatform } from "@/hooks/use-platform";
import {
  startDownload,
  stopDownload,
} from "@/api/download-task";
import { deleteMediaTask } from "@/api/download-center";
import { useDeleteTasks } from "@/components/delete-tasks-dialog";
import { useTasks } from "@/hooks/use-tasks";
import { cn, tdApp } from "@/utils";
import { DownloadTaskItem } from "./download-item";
import { ListHeader } from "./list-header";

interface Props {
  filter: DownloadFilter;
  /** true 时进行中（downloading）任务稳定置前，其余保持原有顺序（下载中心全部视图用） */
  prioritizeActive?: boolean;
}

export function DownloadTaskList({ filter, prioritizeActive = false }: Props) {
  const { confirmDelete, deleteDialog } = useDeleteTasks();
  const [selected, setSelected] = useState<number[]>([]);
  const { contextMenu } = usePlatform();
  const { message } = App.useApp();
  const { t } = useTranslation();
  const editFormRef = useRef<DownloadFormRef>(null);
  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const downloadListId = useId();
  const { mutate, isLoading, data } = useTasks(filter);

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

  const handleSelectAll = useMemoizedFn(() => {
    setSelected(
      produce((draft) => {
        if (draft.length) {
          draft.splice(0, draft.length);
        } else {
          draft.push(...data.map((task) => task.id));
        }
      }),
    );
  });

  const listChecked = useMemo(() => {
    if (selected.length === 0) {
      return false;
    }
    if (selected.length === data.length) {
      return true;
    }
    return "indeterminate";
  }, [selected, data.length]);

  // 进行中置前（可选）：downloading 优先，其余条目保持服务端原有相对顺序（稳定排序）
  const orderedData = useMemo(() => {
    if (!prioritizeActive) return data;
    return data
      .map((task, index) => ({ task, index }))
      .sort((a, b) => {
        const aActive = a.task.status === DownloadStatus.Downloading ? 0 : 1;
        const bActive = b.task.status === DownloadStatus.Downloading ? 0 : 1;
        return aActive - bActive || a.index - b.index;
      })
      .map((item) => item.task);
  }, [data, prioritizeActive]);

  const onStartDownload = useMemoizedFn(async (id: number) => {
    await startDownload(id);

    message.success(t("addTaskSuccess"));
    mutate();
  });

  const onStopDownload = useMemoizedFn(async (id: number) => {
    await stopDownload(id);

    setTimeout(() => {
      mutate();
    }, 500);
  });

  const handleFormConfirm = useMemoizedFn(async () => {
    mutate();
  });

  const handleContext = useMemoizedFn(async (id: number) => {
    const action = await contextMenu.show([
      { key: "select", label: t("select") },
      { key: "download", label: t("download") },
      { key: "refresh", label: t("refresh") },
      { key: "separator", label: "", type: "separator" },
      { key: "delete", label: t("delete") },
    ]);
    if (action === "select") {
      setSelected((keys) => [...keys, id]);
    } else if (action === "download") {
      onStartDownload(id);
    } else if (action === "refresh") {
      mutate();
    } else if (action === "delete") {
      const target = data.find((task) => task.id === id);
      if (target) await confirmAndDelete([target]);
    }
  });

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
      label: targets.length === 1
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
    await Promise.allSettled(ids.map((id) => startDownload(Number(id))));

    message.success(t("addTaskSuccess"));
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

  return (
    <div className="flex flex-col flex-1 overflow-auto">
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
      {deleteDialog}
    </div>
  );
}

// Legacy export for backward compatibility
export const DownloadList = DownloadTaskList;
