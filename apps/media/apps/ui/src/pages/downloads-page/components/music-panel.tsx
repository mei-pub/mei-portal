// 音乐下载面板 —— 数据源：/music/api/download/library（契约 3）
// tasks = 进行中任务（进度经 shared-poll 统一 3s 轮询），files = 磁盘已下载
// （歌手/歌名/大小）；删除文件走契约 4。进行中任务天然置前（tasks 段在 files 段之前）。
// embedded=true（全部视图）：段卡片 + 段头（计数/进行中徽标 + 「进入 →」）。
import { App, Empty, Progress } from "antd";
import { PlayCircleOutlined } from "@ant-design/icons";
import { useMemoizedFn } from "ahooks";
import { type FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import { DeleteIcon, DownloadIcon } from "@/assets/svg";
import { DownloadTag } from "@/components/download-tag";
import { IconButton } from "@/components/icon-button";
import Loading from "@/components/loading";
import {
  deleteMusicFile,
  formatFileSize,
  getMusicLibrary,
  type MusicLibrary,
} from "@/api/download-center";
import { playMusicFile } from "@/utils/play-actions";
import { cn, fromatDateTime } from "@/utils";
import { InlineNotice } from "./inline-notice";
import { SectionHeader } from "./section-header";
import { useSharedPoll } from "./shared-poll";

interface Props {
  /** 全部视图内嵌模式 */
  embedded?: boolean;
  /** 段头「进入 →」回调（锚定音乐 tab） */
  onEnter?: () => void;
}

const EMPTY_LIBRARY: MusicLibrary = { tasks: [], files: [] };
const PANEL_ERROR_STYLE = "flex flex-1 flex-col items-center justify-center gap-3";

const SectionTitle: FC<{ text: string }> = ({ text }) => (
  <div className="shrink-0 px-1 text-sm font-medium text-[#343434] dark:text-white">
    {text}
  </div>
);

const MusicPanel: FC<Props> = ({ embedded = false, onEnter }) => {
  const { message } = App.useApp();
  const { t } = useTranslation();
  const { data, error, isLoading, mutate } = useSWR(
    "download-center/music",
    getMusicLibrary,
    { revalidateOnFocus: false },
  );

  const library = useMemo(() => data ?? EMPTY_LIBRARY, [data]);

  const tasks = library.tasks ?? [];
  const files = library.files ?? [];

  // 有进行中任务 → 3s 轮询进度（页面级共享计时器）；空闲时停止轮询
  useSharedPoll(tasks.length > 0, mutate);

  const handleDeleteFile = useMemoizedFn(async (path: string, name: string) => {
    try {
      await deleteMusicFile(path);
      message.success(`已删除 ${name}`);
      mutate();
    } catch (e) {
      message.error((e as Error).message || "删除失败");
    }
  });

  const renderTasks = () =>
    tasks.length > 0 && (
      <div className="flex flex-col gap-2 rounded-xl border border-black/5 bg-white/85 p-3 shadow-sm dark:border-white/10 dark:bg-[#1F2024]">
        <SectionTitle text={`下载任务（${tasks.length}）`} />
        {tasks.map((task) => {
          const percent = Math.max(0, Math.min(100, Math.round(task.percent ?? 0)));
          const failed = task.error != null && task.error !== "";
          return (
            <div
              key={String(task.id)}
              className="flex flex-row items-center gap-2 rounded-lg bg-[#FAFCFF] px-3 py-2 dark:bg-[#27292F]"
            >
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
                  <div className="truncate text-xs text-[#ff7373]" title={task.error}>
                    {task.error}
                  </div>
                ) : (
                  <div className="flex flex-row items-center gap-2 text-xs text-[rgba(0,0,0,0.65)] dark:text-[rgba(255,255,255,0.65)]">
                    <Progress percent={percent} strokeLinecap="butt" showInfo={false} />
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
            </div>
          );
        })}
      </div>
    );

  const renderFiles = () =>
    files.length > 0 && (
      <div className="flex flex-col gap-2 rounded-xl border border-black/5 bg-white/85 p-3 shadow-sm dark:border-white/10 dark:bg-[#1F2024]">
        <SectionTitle text={`已下载（${files.length}）`} />
        {files.map((file) => (
          <div
            key={file.path || file.fileName}
            className="flex flex-row items-center gap-2 rounded-lg bg-[#FAFCFF] px-3 py-2 dark:bg-[#27292F]"
          >
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
              onClick={() => handleDeleteFile(file.path, file.name || file.fileName)}
            />
          </div>
        ))}
      </div>
    );

  // ---- embedded（全部视图）：段卡片 + 段头，段内提示用 InlineNotice 不占满屏 ----
  if (embedded) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-black/5 bg-white/85 p-3 shadow-sm dark:border-white/10 dark:bg-[#1F2024]">
        <SectionHeader
          title="音乐"
          count={tasks.length + files.length}
          activeCount={tasks.length}
          onEnter={onEnter}
        />
        {isLoading && <InlineNotice text="音乐下载库加载中…" />}
        {error && (
          <InlineNotice
            error
            text="音乐服务不可用，暂时无法获取下载库"
          />
        )}
        {!isLoading && !error && tasks.length === 0 && files.length === 0 && (
          <InlineNotice text="暂无音乐下载" />
        )}
        {!isLoading && !error && (tasks.length > 0 || files.length > 0) && (
          <div className="flex flex-col gap-3">
            {renderTasks()}
            {renderFiles()}
          </div>
        )}
      </div>
    );
  }

  // ---- 单 tab 页面模式（原逻辑） ----
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
      {renderTasks()}
      {renderFiles()}
    </div>
  );
};

export default MusicPanel;
