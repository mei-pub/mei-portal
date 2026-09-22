// 音乐下载面板 —— 数据源：/music/api/download/library（契约 3）
// tasks = 进行中任务（进度经 shared-poll 统一 3s 轮询），files = 磁盘已下载
// （歌手/歌名/大小）；删除文件走契约 4。进行中任务天然置前（tasks 段在 files 段之前）。
import { App, Empty, Progress } from "antd";
import { PlayCircleOutlined } from "@ant-design/icons";
import { useMemoizedFn } from "ahooks";
import { type FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import { DeleteIcon, DownloadIcon } from "@/assets/svg";
import { DownloadTag } from "@/components/download-tag";
import { IconButton } from "@/components/icon-button";
import Loading from "@/components/loading";
import { Checkbox } from "@/components/ui/checkbox";
import {
  deleteMusicFile,
  deleteMusicTask,
  formatFileSize,
  getMusicLibrary,
  type MusicLibrary,
} from "@/api/download-center";
import { playMusicFile } from "@/utils/play-actions";
import { cn, fromatDateTime } from "@/utils";
import { useDeleteTasks } from "@/components/delete-tasks-dialog";
import { useContentMenu } from "./content-menu";
import { useInlinePlayer } from "./inline-player";
import { BulkBar, BulkButton, ListSearch, triState } from "./bulk-bar";
import { useSharedPoll } from "./shared-poll";

const EMPTY_LIBRARY: MusicLibrary = { tasks: [], files: [] };
const PANEL_ERROR_STYLE =
  "flex flex-1 flex-col items-center justify-center gap-3";

const MusicPanel: FC = () => {
  const { confirmDelete, deleteDialog } = useDeleteTasks();
  const { message, modal } = App.useApp();
  const { t } = useTranslation();
  // 内容级右键菜单（播放/收藏/加入播放列表/取消/删除）——能力对齐全部 tab
  const { menu, openMusicFileMenu, openMusicTaskMenu } = useContentMenu({
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

  // 多选批量（对标迅雷）+ 搜索过滤：任务段与已下载段各自管理选中集合
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [selectedFileKeys, setSelectedFileKeys] = useState<Set<string>>(new Set());
  const [searchText, setSearchText] = useState("");

  const visibleTasks = useMemo(() => {
    const kw = searchText.trim().toLowerCase();
    if (!kw) return tasks;
    return tasks.filter((t) =>
      `${t.song?.name ?? ""}${t.song?.artist ?? ""}`.toLowerCase().includes(kw),
    );
  }, [tasks, searchText]);

  const visibleFiles = useMemo(() => {
    const kw = searchText.trim().toLowerCase();
    if (!kw) return files;
    return files.filter((f) =>
      `${f.name ?? ""}${f.fileName ?? ""}${f.artist ?? ""}`
        .toLowerCase()
        .includes(kw),
    );
  }, [files, searchText]);

  const toggleTask = useMemoizedFn((id: string) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  });

  const toggleFile = useMemoizedFn((key: string) => {
    setSelectedFileKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  });

  // 批量取消任务（= 删除任务并清理临时文件，音乐任务无独立「暂停」态）
  const handleBulkCancelTasks = useMemoizedFn(async () => {
    const targets = visibleTasks.filter((t) =>
      selectedTaskIds.has(String(t.id)),
    );
    if (targets.length === 0) return;
    const results = await Promise.allSettled(
      targets.map((t) => deleteMusicTask(t.id)),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) message.error(`取消失败 ${failed} 项`);
    else message.success("已取消所选任务");
    setSelectedTaskIds(new Set());
    mutate();
  });

  // 批量删除文件：一次确认 → 逐条删除
  const handleBulkDeleteFiles = useMemoizedFn(async () => {
    const targets = visibleFiles.filter((f) =>
      selectedFileKeys.has(f.path || f.fileName),
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
    setSelectedFileKeys(new Set());
    mutate();
  });

  // 有进行中任务 → 3s 轮询进度（页面级共享计时器）；空闲时停止轮询
  useSharedPoll(tasks.length > 0, mutate);

  // 已下载文件：删除即删文件本身（音乐没有独立于文件的「记录」概念）。
  // 命令式 modal.confirm（不依赖 antd trigger 子元素机制——IconButton 无 ref
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

  const renderTasks = () =>
    visibleTasks.length > 0 && (
      <div className="flex flex-col gap-2 rounded-xl border border-black/5 bg-white/85 p-3 shadow-sm dark:border-white/10 dark:bg-[#1F2024]">
        <BulkBar
          checked={triState(
            visibleTasks.filter((t) => selectedTaskIds.has(String(t.id))).length,
            visibleTasks.length,
          )}
          selectedCount={
            visibleTasks.filter((t) => selectedTaskIds.has(String(t.id))).length
          }
          total={visibleTasks.length}
          onSelectAll={(checked) =>
            setSelectedTaskIds(
              checked
                ? new Set(visibleTasks.map((t) => String(t.id)))
                : new Set(),
            )
          }
        >
          <BulkButton
            disabled={selectedTaskIds.size === 0}
            onClick={() => void handleBulkCancelTasks()}
          >
            取消所选
          </BulkButton>
        </BulkBar>
        {visibleTasks.map((task) => {
          const percent = Math.max(
            0,
            Math.min(100, Math.round(task.percent ?? 0)),
          );
          const failed = task.error != null && task.error !== "";
          return (
            <div
              key={String(task.id)}
              className="flex flex-row items-center gap-2 rounded-lg bg-[#FAFCFF] px-3 py-2 dark:bg-[#27292F]"
              onContextMenu={(e) =>
                openMusicTaskMenu(e, task.id, task.song?.name ?? "-")
              }
            >
              <Checkbox
                className="shrink-0"
                checked={selectedTaskIds.has(String(task.id))}
                onCheckedChange={() => toggleTask(String(task.id))}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-row items-center gap-2">
                  <span
                    className={cn(
                      "truncate text-sm text-[rgba(0,0,0,0.88)] dark:text-[rgba(255,255,255,0.85)]",
                      failed && "text-[#ff7373]",
                    )}
                    title={task.song?.name}
                  >
                    {task.song?.name ?? "-"}
                  </span>
                  <span className="shrink-0 text-xs text-[#B3B3B3] dark:text-[#515257]">
                    {task.song?.artist ?? "-"}
                    {task.song?.source ? ` · ${task.song.source}` : ""}
                  </span>
                </div>
                {failed ? (
                  <div
                    className="truncate text-xs text-[#ff7373]"
                    title={task.error}
                  >
                    {task.error}
                  </div>
                ) : (
                  <div className="flex flex-row items-center gap-2 text-xs text-[rgba(0,0,0,0.65)] dark:text-[rgba(255,255,255,0.65)]">
                    <Progress
                      percent={percent}
                      strokeLinecap="butt"
                      showInfo={false}
                    />
                    <div className="min-w-10 shrink-0">{percent}%</div>
                    <div className="min-w-20 shrink-0">{task.speed || "-"}</div>
                  </div>
                )}
              </div>
              <DownloadTag
                icon={<DownloadIcon fill="#fff" width={14} height={14} />}
                text={failed ? "失败" : "下载中"}
                color={failed ? "#ff7373" : "#127af3"}
              />
              <IconButton
                title={t("delete")}
                icon={<DeleteIcon />}
                onClick={() =>
                  handleDeleteTask(task.id, task.song?.name ?? "-")
                }
              />
            </div>
          );
        })}
      </div>
    );

  const renderFiles = () =>
    visibleFiles.length > 0 && (
      <div className="flex flex-col gap-2 rounded-xl border border-black/5 bg-white/85 p-3 shadow-sm dark:border-white/10 dark:bg-[#1F2024]">
        <BulkBar
          checked={triState(
            visibleFiles.filter((f) =>
              selectedFileKeys.has(f.path || f.fileName),
            ).length,
            visibleFiles.length,
          )}
          selectedCount={
            visibleFiles.filter((f) => selectedFileKeys.has(f.path || f.fileName))
              .length
          }
          total={visibleFiles.length}
          onSelectAll={(checked) =>
            setSelectedFileKeys(
              checked
                ? new Set(
                    visibleFiles.map((f) => f.path || f.fileName),
                  )
                : new Set(),
            )
          }
        >
          <BulkButton
            disabled={selectedFileKeys.size === 0}
            danger
            onClick={() => void handleBulkDeleteFiles()}
          >
            删除
          </BulkButton>
        </BulkBar>
        {visibleFiles.map((file) => (
          <div
            key={file.path || file.fileName}
            className="flex flex-row items-center gap-2 rounded-lg bg-[#FAFCFF] px-3 py-2 dark:bg-[#27292F]"
            onContextMenu={(e) =>
              openMusicFileMenu(e, {
                path: file.path,
                name: file.name || file.fileName,
                artist: file.artist || "",
              })
            }
          >
            <Checkbox
              className="shrink-0"
              checked={selectedFileKeys.has(file.path || file.fileName)}
              onCheckedChange={() => toggleFile(file.path || file.fileName)}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div
                className="truncate text-sm text-[rgba(0,0,0,0.88)] dark:text-[rgba(255,255,255,0.85)]"
                title={file.fileName || file.name}
              >
                {file.name || file.fileName}
              </div>
              <div className="flex flex-row gap-2 text-xs text-[#B3B3B3] dark:text-[#515257]">
                <span className="truncate">{file.artist || "-"}</span>
                <span className="shrink-0">{formatFileSize(file.size)}</span>
                <span className="shrink-0">
                  {fromatDateTime(
                    typeof file.mtime === "number"
                      ? new Date(file.mtime * 1000)
                      : file.mtime,
                    "YYYY/MM/DD",
                  )}
                </span>
              </div>
            </div>
            <DownloadTag text="已完成" color="#09ce87" />
            <IconButton
              title={t("playVideo")}
              icon={<PlayCircleOutlined />}
              onClick={() => playMusicFile(file)}
            />
            <IconButton
              title={t("delete")}
              icon={<DeleteIcon />}
              onClick={() =>
                handleDeleteFile(file.path, file.name || file.fileName)
              }
            />
          </div>
        ))}
      </div>
    );

  if (isLoading) {
    return <Loading />;
  }

  if (error) {
    return (
      <div className={PANEL_ERROR_STYLE}>
        <Empty description="音乐服务不可用，暂时无法获取下载库" />
      </div>
    );
  }

  if (tasks.length === 0 && files.length === 0) {
    return (
      <div className={PANEL_ERROR_STYLE}>
        <Empty description="暂无音乐下载" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-auto pr-1">
      <div className="flex flex-row justify-end">
        <ListSearch
          value={searchText}
          onChange={setSearchText}
          placeholder="搜索歌名/歌手"
        />
      </div>
      {renderTasks()}
      {renderFiles()}
      {menu}
      {deleteDialog}
    </div>
  );
};

export default MusicPanel;
