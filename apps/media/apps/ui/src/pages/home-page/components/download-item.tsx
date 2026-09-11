import {
  FileTextOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";
import {
  DownloadProgress,
  DownloadStatus,
  type DownloadTask,
  type DownloadTaskWithFile,
} from "@mediago/shared-common";
import { useMemoizedFn } from "ahooks";
import { Progress } from "antd";
import { memo, type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import { useShallow } from "zustand/react/shallow";
import selectedBg from "@/assets/images/select-item-bg.png";
import {
  DeleteIcon,
  DownloadIcon,
  DownloadListIcon,
  EditIcon,
  FailedIcon,
  PauseIcon,
} from "@/assets/svg";
import { DownloadTag } from "@/components/download-tag";
import { IconButton } from "@/components/icon-button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  CONTINUE_DOWNLOAD,
  DOWNLOAD_NOW,
  PLAY_VIDEO,
  RESTART_DOWNLOAD,
  STOP_DOWNLOAD,
} from "@/const";
import type { DownloadTaskDetails } from "@/hooks/use-tasks";
import { appStoreSelector, useAppStore } from "@/store/app";
import { getMediaVideosKey, listMediaVideos } from "@/api/download-center";
import { matchMediaVideo, mediaVideoTarget } from "@/utils/play-actions";
import { useInlinePlayer } from "@/pages/downloads-page/components/inline-player";
import { cn, fromatDateTime, isWeb, tdApp } from "@/utils";
import { TerminalDialog } from "./terminal-dialog";
import { usePlatform } from "@/hooks/use-platform";
import { useEnvPath } from "@/hooks/use-config";

interface Props {
  task: DownloadTaskDetails;
  onSelectChange: (id: number) => void;
  selected: boolean;
  onStartDownload: (id: number) => void;
  onStopDownload: (taskId: number) => void;
  onContextMenu: (taskId: number) => void;
  progress?: DownloadProgress;
  onShowEditForm?: (value: DownloadTask) => void;
  downloadStatus?: DownloadStatus;
  onDeleteTask?: (task: DownloadTask) => void;
}

export const DownloadTaskItem = memo(function DownloadTaskItem({
  task,
  onSelectChange,
  selected,
  onStartDownload,
  onStopDownload,
  onContextMenu,
  onShowEditForm,
  onDeleteTask,
}: Props) {
  const appStore = useAppStore(useShallow(appStoreSelector));
  const { t } = useTranslation();
  const { shell } = usePlatform();
  const { envPath } = useEnvPath();

  // Handlers
  const handlePlay = useMemoizedFn(() => {
    tdApp.onEvent(PLAY_VIDEO);
    if (envPath?.playerUrl) {
      shell.open(`${envPath.playerUrl}?id=${task.id}`);
    }
  });

  // 服务器（web）模式播放出口：/api/v1/videos 只含已成功且文件在盘的任务，
  // 按 title（= 任务 name）匹配后新开 media 自带播放器页。SWR 统一 key 缓存，
  // 列表内多个 done 任务共享一次请求；桌面模式 / 非 done 任务不发起请求。
  const webPlay = isWeb && task.status === DownloadStatus.Success;
  const inlinePlayer = useInlinePlayer();
  const { data: videoList, isLoading: videoListLoading } = useSWR(
    webPlay ? getMediaVideosKey : null,
    listMediaVideos,
    { revalidateOnFocus: false },
  );
  const playableVideo = useMemo(
    () => (webPlay && videoList ? matchMediaVideo(videoList, task.name) : null),
    [webPlay, videoList, task.name],
  );

  const handleWebPlay = useMemoizedFn(() => {
    tdApp.onEvent(PLAY_VIDEO);
    if (playableVideo) {
      // 就地弹层播放（下载中心内）；无 Provider 场景回退新标签直开裸流
      inlinePlayer.play(mediaVideoTarget(playableVideo));
    }
  });

  const startWithEvent = useMemoizedFn((eventName: string) => {
    onStartDownload(task.id);
    tdApp.onEvent(eventName);
  });

  const handleStop = useMemoizedFn(() => {
    onStopDownload(task.id);
    tdApp.onEvent(STOP_DOWNLOAD);
  });

  // Action buttons by status (consolidated for clarity)
  const actionButtons = useMemo<ReactNode[]>(() => {
    const buttons: ReactNode[] = [];

    const terminalBtn = appStore.showTerminal ? (
      <TerminalDialog
        key="terminal"
        trigger={
          <IconButton
            key="terminal"
            title={t("terminal")}
            icon={<FileTextOutlined />}
          />
        }
        title={task.name}
        id={task.id}
      />
    ) : null;

    const editBtn = (
      <IconButton
        key="edit"
        title={t("edit")}
        icon={<EditIcon />}
        onClick={() => onShowEditForm?.(task)}
      />
    );

    switch (task.status) {
      case DownloadStatus.Ready:
        if (terminalBtn) buttons.push(terminalBtn);
        buttons.push(editBtn);
        buttons.push(
          <IconButton
            key="download"
            icon={<DownloadListIcon />}
            title={t("download")}
            onClick={() => startWithEvent(DOWNLOAD_NOW)}
          />,
        );
        break;
      case DownloadStatus.Downloading:
        if (terminalBtn) buttons.push(terminalBtn);
        buttons.push(
          <IconButton
            key="stop"
            title={t("pause")}
            icon={<PauseCircleOutlined />}
            onClick={handleStop}
          />,
        );
        break;
      case DownloadStatus.Failed:
        if (terminalBtn) buttons.push(terminalBtn);
        buttons.push(editBtn);
        buttons.push(
          <IconButton
            key="redownload"
            title={t("redownload")}
            icon={<DownloadListIcon />}
            onClick={() => startWithEvent(RESTART_DOWNLOAD)}
          />,
        );
        break;
      case DownloadStatus.Pending:
        buttons.push(<span key="pending">{t("pending")}</span>);
        break;
      case DownloadStatus.Stopped:
        if (terminalBtn) buttons.push(terminalBtn);
        buttons.push(editBtn);
        buttons.push(
          <IconButton
            key="restart"
            icon={<DownloadListIcon />}
            title={t("continueDownload")}
            onClick={() => startWithEvent(CONTINUE_DOWNLOAD)}
          />,
        );
        break;
      default: {
        // Success
        if (isWeb) {
          // 服务器模式：可播列表加载中先渲染禁用占位（避免加载完成后按钮突现）；
          // 已加载但未匹配（文件不在盘/非视频）不渲染播放按钮，避免死按钮
          if (videoListLoading) {
            buttons.push(
              <IconButton
                key="play"
                icon={<PlayCircleOutlined />}
                title="正在匹配可播放视频…"
                disabled
              />,
            );
          } else if (playableVideo) {
            buttons.push(
              <IconButton
                key="play"
                icon={<PlayCircleOutlined />}
                title={t("playVideo")}
                onClick={handleWebPlay}
              />,
            );
          }
        } else {
          buttons.push(
            <IconButton
              key="play"
              icon={<PlayCircleOutlined />}
              title={t("playVideo")}
              disabled={!task.exists}
              onClick={handlePlay}
            />,
          );
        }
        break;
      }
    }

    // 单条删除入口（web 模式无右键菜单）：全部状态可用，交互由列表层统一弹层
    if (onDeleteTask) {
      buttons.push(
        <IconButton
          key="delete"
          title={t("delete")}
          icon={<DeleteIcon />}
          onClick={() => onDeleteTask(task)}
        />,
      );
    }
    return buttons;
  }, [
    appStore.showTerminal,
    handlePlay,
    handleWebPlay,
    videoListLoading,
    playableVideo,
    handleStop,
    task,
    onShowEditForm,
    onDeleteTask,
    startWithEvent,
    t,
  ]);

  const renderTitle = useMemoizedFn((task: DownloadTaskWithFile): ReactNode => {
    return (
      <div
        className={cn("truncate text-sm dark:text-[#B4B4B4]", {
          "text-[#127af3]": selected,
        })}
        title={task.name}
      >
        {task.folder ? `${task.folder}/` : task.folder}
        {task.name}
      </div>
    );
  });

  const tags = useMemo<ReactNode[]>(() => {
    const list: ReactNode[] = [];
    if (task.isLive)
      list.push(
        <DownloadTag key="live" text={t("liveResource")} color="#9abbe2" />,
      );

    switch (task.status) {
      case DownloadStatus.Downloading:
        list.push(
          <DownloadTag
            key="downloading"
            icon={<DownloadIcon fill="#fff" width={14} height={14} />}
            text={t("downloading")}
            color="#127af3"
          />,
        );
        break;
      case DownloadStatus.Success:
        list.push(
          <DownloadTag
            key="success"
            text={t("downloadSuccess")}
            color="#09ce87"
          />,
        );
        if (!task.exists) {
          list.push(
            <DownloadTag
              key="notExists"
              text={t("fileNotExist")}
              color="#9abbe2"
            />,
          );
        }
        break;
      case DownloadStatus.Failed:
        list.push(
          <TerminalDialog
            key="failed"
            trigger={
              <DownloadTag
                icon={<FailedIcon />}
                text={t("downloadFailed")}
                color="#ff7373"
                className="cursor-pointer"
              />
            }
            title={task.name}
            id={task.id}
          />,
        );
        break;
      case DownloadStatus.Stopped:
        list.push(
          <DownloadTag
            key="pause"
            icon={<PauseIcon />}
            text={t("downloadPause")}
            color="#9abbe2"
          />,
        );
        break;
    }
    return list;
  }, [task, t]);

  const renderDescription = useMemoizedFn(
    (task: DownloadTaskDetails): ReactNode => {
      if (task.percent && task.status === DownloadStatus.Downloading) {
        const val = Math.round(Number(task.percent));

        return (
          <div className="flex flex-row items-center gap-2 text-xs text-[rgba(0,0,0,0.88)] dark:text-[rgba(255,255,255,0.85)]">
            <Progress percent={val} strokeLinecap="butt" showInfo={false} />
            <div className="min-w-5 shrink-0">{val}%</div>
            <div className="min-w-20 shrink-0">{task.speed}</div>
          </div>
        );
      }
      return (
        <div
          className="relative flex flex-col gap-1 text-xs text-[#B3B3B3] dark:text-[#515257]"
          title={task.url}
        >
          <div className="truncate">{task.url}</div>
          <div className="truncate">
            {t("createdAt")} {fromatDateTime(task.createdDate)}
          </div>
          {task.status === DownloadStatus.Failed && (
            <TerminalDialog
              asChild
              trigger={
                <div className="cursor-pointer truncate text-[#ff7373] dark:text-[rgba(255,115,115,0.6)]">
                  {t("failReason")}: ...
                </div>
              }
              title={task.name}
              id={task.id}
            />
          )}
        </div>
      );
    },
  );

  return (
    <div
      className={cn(
        "relative flex flex-row gap-3 rounded-lg bg-[#FAFCFF] px-3 pb-3.5 pt-2 dark:bg-[#27292F]",
        {
          "bg-linear-to-r from-[#D0E8FF] to-[#F2F7FF] dark:from-[#27292F] dark:to-[#00244E]":
            selected,
          "opacity-70": task.status === DownloadStatus.Success && !task.exists,
        },
      )}
      onContextMenu={() => onContextMenu(task.id)}
    >
      <Checkbox
        className="mt-2"
        checked={selected}
        onCheckedChange={() => onSelectChange(task.id)}
      />
      <div className={cn("flex flex-1 flex-col gap-1 overflow-hidden")}>
        {selected && (
          <img
            alt=""
            src={selectedBg}
            className="absolute bottom-0 right-[126px] top-0 block h-full select-none"
          />
        )}
        <div className="relative flex flex-row items-center gap-2">
          {renderTitle(task)}
          <div className="flex shrink-0 grow flex-row gap-2">{tags}</div>
          <div className="flex flex-row items-center gap-3 rounded-md bg-[#eff4fa] px-1.5 py-1.5 dark:bg-[#3B3F48]">
            {actionButtons}
          </div>
        </div>
        {renderDescription(task)}
      </div>
    </div>
  );
});
