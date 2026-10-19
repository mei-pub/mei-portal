import {
  CloudOutlined,
  CustomerServiceOutlined,
  DownloadOutlined,
  EyeOutlined,
  FileTextOutlined,
  FolderOutlined,
  LinkOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlaySquareOutlined,
  ThunderboltOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { App, Drawer } from "antd";
import {
  DownloadProgress,
  DownloadStatus,
  type DownloadTask,
  type DownloadTaskWithFile,
} from "@mediago/shared-common";
import { useMemoizedFn } from "ahooks";
import { memo, type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import { useShallow } from "zustand/react/shallow";
import {
  DeleteIcon,
  DownloadIcon,
  DownloadListIcon,
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
import type { DownloadTaskDetails, MusicRowMeta } from "@/hooks/use-tasks";
import { appStoreSelector, useAppStore } from "@/store/app";
import { appFileUrl, getMediaVideosKey, listMediaVideos } from "@/api/download-center";
import { matchMediaVideo, mediaVideoTarget, playMusicFile } from "@/utils/play-actions";
import { useInlinePlayer } from "@/pages/downloads-page/components/inline-player";
import { musicServeUrl } from "@/pages/downloads-page/components/content-menu";
import {
  FileViewerContent,
  FileViewerHeader,
  isQuickViewable,
} from "@/pages/downloads-page/components/file-viewer";
import { cn, fromatDateTime, isWeb, tdApp } from "@/utils";
import { TerminalDialog } from "./terminal-dialog";
import { usePlatform } from "@/hooks/use-platform";
import { useEnvPath } from "@/hooks/use-config";

/** 任务总体积（引擎任务实时值；非引擎任务未知 → 0，大小列显示 —） */
const sizeOfTask = (task: DownloadTaskDetails): number =>
  (task as { engine?: { totalBytes?: number } }).engine?.totalBytes ?? 0;

interface Props {
  task: DownloadTaskDetails;
  onSelectChange: (id: number) => void;
  selected: boolean;
  onStartDownload: (id: number) => void;
  onStopDownload: (taskId: number) => void;
  onContextMenu: (e: React.MouseEvent, task: DownloadTask) => void;
  progress?: DownloadProgress;
  onShowEditForm?: (value: DownloadTask) => void;
  downloadStatus?: DownloadStatus;
  onDeleteTask?: (task: DownloadTask) => void;
  /** 打开任务详情侧栏（失败原因/失败徽章点击） */
  onShowDetail?: (task: DownloadTask) => void;
  /** 归属命名队列名（对齐 FluxDown 任务列表队列列；null = 默认 main 不标） */
  queueName?: string | null;
  /** 迅雷式多选接线（useMarqueeSelect）：data-row-key + Cmd/Ctrl·Shift 行点击 */
  rowProps?: {
    "data-row-key": string;
    onClick: (e: React.MouseEvent) => void;
  };
}

export const DownloadTaskItem = memo(function DownloadTaskItem({
  task,
  onSelectChange,
  selected,
  onStartDownload,
  onStopDownload,
  onContextMenu,
  onDeleteTask,
  onShowDetail,
  queueName,
  rowProps,
}: Props) {
  const appStore = useAppStore(useShallow(appStoreSelector));
  const { t } = useTranslation();
  const { shell } = usePlatform();
  const { envPath } = useEnvPath();
  const { message } = App.useApp();

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

  // 快速查看侧栏（文本/图片/PDF 产物）；「新窗口」= /view?task= 独立全屏页
  const [viewerOpen, setViewerOpen] = useState(false);
  const viewerName = ((): string => {
    const file = (task as { file?: string }).file || "";
    return file ? file.split("/").pop() || file : task.name || "";
  })();

  /** 引擎任务与音乐行的详情都收敛到「点行展开」，此处不再有详情按钮 */

  // 操作区统一规范（round-C）：「详情」走点行展开不再占按钮位（点行 → 详情
  // 面板已是既定交互）；所有行按钮序一致 = 终端 → 生命周期 → 快速查看 →
  // 播放 → 下载到本机 → 删除；编辑移入右键菜单。
  const actionButtons = useMemo<ReactNode[]>(() => {
    const buttons: ReactNode[] = [];

    const terminalBtn = appStore.showTerminal ? (
      <TerminalDialog
        key="terminal"
        trigger={
          <IconButton
            key="terminal"
            size="md"
            title={t("terminal")}
            icon={<FileTextOutlined />}
          />
        }
        title={task.name}
        id={task.id}
      />
    ) : null;

    if (terminalBtn) buttons.push(terminalBtn);

    // 音乐行（负数合成 id 不能调媒体任务开始/暂停/编辑口）：文件行（已完成）
    // = 播放 / 下载到本机 / 删除；任务行 = 删除（取消任务）。媒体生命周期、
    // 播放、快速查看都不适用
    const musicMetaRow = (task as { music?: MusicRowMeta }).music;
    if (musicMetaRow) {
      if (musicMetaRow.kind === "file") {
        buttons.push(
          <IconButton
            key="play"
            size="md"
            icon={<PlayCircleOutlined />}
            title={t("playVideo")}
            onClick={() =>
              playMusicFile({
                path: musicMetaRow.path,
                name: musicMetaRow.song.name,
                artist: musicMetaRow.song.artist,
                fileName: musicMetaRow.path.split("/").pop() ?? "",
                size: 0,
                mtime: "",
              })
            }
          />,
        );
        buttons.push(
          <IconButton
            key="download"
            size="md"
            icon={<DownloadOutlined />}
            title={t("downloadToLocal")}
            onClick={() => {
              window.location.href = musicServeUrl(musicMetaRow.path);
            }}
          />,
        );
      }
    } else {
      switch (task.status) {
        case DownloadStatus.Ready:
          buttons.push(
            <IconButton
              key="start"
              size="md"
              icon={<DownloadListIcon />}
              title={t("download")}
              onClick={() => startWithEvent(DOWNLOAD_NOW)}
            />,
          );
          break;
        case DownloadStatus.Downloading:
          buttons.push(
            <IconButton
              key="pause"
              size="md"
              icon={<PauseCircleOutlined />}
              title={t("pause")}
              onClick={handleStop}
            />,
          );
          break;
        case DownloadStatus.Failed:
          buttons.push(
            <IconButton
              key="restart"
              size="md"
              icon={<DownloadListIcon />}
              title={t("redownload")}
              onClick={() => startWithEvent(RESTART_DOWNLOAD)}
            />,
          );
          break;
        case DownloadStatus.Pending:
          buttons.push(
            <IconButton
              key="start"
              size="md"
              icon={<DownloadListIcon />}
              title={t("download")}
              onClick={() => startWithEvent(DOWNLOAD_NOW)}
            />,
          );
          break;
        case DownloadStatus.Stopped:
          buttons.push(
            <IconButton
              key="start"
              size="md"
              icon={<DownloadListIcon />}
              title={t("continueDownload")}
              onClick={() => startWithEvent(CONTINUE_DOWNLOAD)}
            />,
          );
          break;
        default: {
          // Success：播放（web 加载中先禁用占位；未匹配不渲染死按钮）+ 下载
          // 到本机（exists 才给入口；/files/:id 附件端点任意扩展可回拉）
          if (isWeb) {
            if (videoListLoading) {
              buttons.push(
                <IconButton
                  key="play"
                  size="md"
                  icon={<PlayCircleOutlined />}
                  title="正在匹配可播放视频…"
                  disabled
                />,
              );
            } else if (playableVideo) {
              buttons.push(
                <IconButton
                  key="play"
                  size="md"
                  icon={<PlayCircleOutlined />}
                  title={t("playVideo")}
                  onClick={handleWebPlay}
                />,
              );
            }
            if (task.exists) {
              buttons.push(
                <IconButton
                  key="download"
                  size="md"
                  icon={<DownloadOutlined />}
                  title={t("downloadToLocal")}
                  onClick={() => {
                    window.location.href = appFileUrl(`files/${task.id}`);
                  }}
                />,
              );
            }
          } else {
            buttons.push(
              <IconButton
                key="play"
                size="md"
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

      // 快速查看（文本/图片/PDF 等可即时渲染产物）：侧栏查看 + 新窗口全屏页
      if (
        task.status === DownloadStatus.Success &&
        (task as { exists?: boolean }).exists &&
        isQuickViewable(task)
      ) {
        buttons.push(
          <IconButton
            key="view"
            size="md"
            icon={<EyeOutlined />}
            title="快速查看"
            onClick={() => setViewerOpen(true)}
          />,
        );
      }
    }

    // 删除（全部行可用；交互由列表统一三选一弹层，音乐行按任务/文件分流）
    if (onDeleteTask) {
      buttons.push(
        <IconButton
          key="delete"
          size="md"
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
    onDeleteTask,
    startWithEvent,
    t,
  ]);


  const renderTitle = useMemoizedFn((task: DownloadTaskWithFile): ReactNode => {
    return (
      <div
        className={cn(
          "min-w-0 truncate text-[13px] font-medium text-gray-900 dark:text-gray-200",
          { "text-[#127af3]": selected },
        )}
        title={task.name}
      >
        {task.folder && task.folder !== "bt" ? `${task.folder}/` : ""}
        {task.name}
      </div>
    );
  });

  /** 源链接（表格任务列信息字段 2）：截断展示，点击复制完整地址。
   *  音乐行的 url 是服务器落盘路径——用文件夹图标 +「服务器路径」语义区分 */
  const sourceUrl = task.url ?? "";
  const isMusicRow = Boolean((task as { music?: MusicRowMeta }).music);
  /** 「复制链接」= 复制源地址（round-C 契约）：音乐行源地址=服务器落盘路径，
   *  与媒体行同口径取行 url；不再复制可播放流直链 */
  const copyUrl = useMemoizedFn(() => {
    if (!sourceUrl) return;
    navigator.clipboard
      .writeText(sourceUrl)
      .then(() =>
        message.success(isMusicRow ? "已复制路径" : "已复制源链接"),
      )
      .catch(() => message.error("复制失败"));
  });

  /** 协议文案(磁力/BT/HTTP/媒体/音乐,对齐任务列表协议列) */
  const protocolLabel = ((): string => {
    const u = task.url ?? "";
    if ((task as { type?: string }).type === "music") return t("protocolMusic");
    if (/^magnet:/i.test(u)) return t("protocolMagnet");
    if (task.type === "bt") return "BT";
    if (/^ed2k:/i.test(u)) return "eD2K";
    if (/^ftp:/i.test(u)) return "FTP";
    if (task.type === "direct") return "HTTP";
    return t("protocolMedia");
  })();

  /** 类型图标瓦片(颜色语义:音乐紫/磁力琥珀/BT蓝/直链青蓝/媒体靛) */
  const typeMeta = ((): { icon: ReactNode; bg: string } => {
    const u = task.url ?? "";
    const typ = (task as { type?: string }).type;
    if (typ === "music")
      return {
        icon: <CustomerServiceOutlined />,
        bg: "bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300",
      };
    if (/^magnet:/i.test(u))
      return {
        icon: <ThunderboltOutlined />,
        bg: "bg-amber-100 text-amber-600 dark:bg-amber-400/15 dark:text-amber-300",
      };
    if (task.type === "bt")
      return {
        icon: <CloudOutlined />,
        bg: "bg-sky-100 text-sky-600 dark:bg-sky-400/15 dark:text-sky-300",
      };
    if (task.type === "direct")
      return {
        icon: <LinkOutlined />,
        bg: "bg-teal-100 text-teal-600 dark:bg-teal-400/15 dark:text-teal-300",
      };
    return {
      icon: <PlaySquareOutlined />,
      bg: "bg-indigo-100 text-indigo-600 dark:bg-indigo-400/15 dark:text-indigo-300",
    };
  })();

  /** 状态徽章（状态列:软底色+同色字,替代彩色胶囊堆） */
  const statusChip = (() => {
    const map: Partial<Record<DownloadStatus, { text: string; cls: string }>> = {
      [DownloadStatus.Success]: {
        text: t("downloadSuccess"),
        cls: "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-400",
      },
      [DownloadStatus.Downloading]: {
        text: t("downloading"),
        cls: "bg-blue-500/10 text-blue-600 dark:bg-blue-400/10 dark:text-blue-400",
      },
      [DownloadStatus.Failed]: {
        text: t("downloadFailed"),
        cls: "bg-rose-500/10 text-rose-600 dark:bg-rose-400/10 dark:text-rose-400",
      },
      [DownloadStatus.Stopped]: {
        text: t("downloadPause"),
        cls: "bg-orange-500/10 text-orange-600 dark:bg-orange-400/10 dark:text-orange-400",
      },
      [DownloadStatus.Pending]: {
        text: t("pending"),
        cls: "bg-gray-500/10 text-gray-500 dark:bg-white/10 dark:text-gray-400",
      },
      [DownloadStatus.Ready]: {
        text: t("pending"),
        cls: "bg-gray-500/10 text-gray-500 dark:bg-white/10 dark:text-gray-400",
      },
    };
    const cfg = task.status != null ? map[task.status] : undefined;
    if (!cfg) return null;
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full px-2 py-[3px] text-[11px] font-medium leading-none",
          cfg.cls,
        )}
      >
        {cfg.text}
      </span>
    );
  })();

  /** 标题旁内联小徽:只保留特殊态(直播/做种/文件丢失);常规状态已移入状态列 */
  const inlineFlags = useMemo<ReactNode[]>(() => {
    const list: ReactNode[] = [];
    if (task.isLive)
      list.push(<DownloadTag key="live" text={t("liveResource")} color="#9abbe2" />);
    if (
      task.status === DownloadStatus.Success &&
      task.type === "bt" &&
      task.seeding === 1
    )
      list.push(
        <DownloadTag
          key="seeding"
          icon={<UploadOutlined style={{ fontSize: 12, color: "#fff" }} />}
          text={t("seeding")}
          color="#67c23a"
          title={
            task.uploadSpeed
              ? `${t("seeding")} ↑ ${task.uploadSpeed}`
              : t("seeding")
          }
        />,
      );
    // 「文件不存在」只对已完成任务成立：列表接口仅对 success 行做存在性
    // 检查（进行中任务恒为 false），否则每个下载中的 BT 任务都误挂此徽标
    if (task.status === DownloadStatus.Success && !task.exists)
      list.push(
        <DownloadTag key="notExists" text={t("fileNotExist")} color="#9abbe2" />,
      );
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task, t]);

  const tags = useMemo<ReactNode[]>(() => {
    const list: ReactNode[] = [];
    if (task.isLive)
      list.push(
        <DownloadTag key="live" text={t("liveResource")} color="#9abbe2" />,
      );

    // 协议徽标（FluxDown 协议列：HTTP/FTP/eD2K/BT/磁力/媒体）
    const proto = (task as { type?: string }).type === "music"
      ? t("protocolMusic")
      : /^magnet:/i.test(task.url ?? "")
      ? t("protocolMagnet")
      : task.type === "bt"
        ? "BT"
        : /^ed2k:/i.test(task.url ?? "")
          ? "eD2K"
          : /^ftp:/i.test(task.url ?? "")
            ? "FTP"
            : task.type === "direct"
              ? "HTTP"
              : t("protocolMedia");
    list.push(
      <DownloadTag key="proto" text={proto} color="#8fb8de" title={task.url} />,
    );

    // 归属队列徽标（FluxDown 任务列表队列列；默认 main 不标）
    if (queueName) {
      list.push(
        <DownloadTag
          key="queue"
          text={queueName}
          color="#b3b3d7"
          title={t("taskQueue")}
        />,
      );
    }

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
        // BT 做种徽标（FluxDown：完成后按做种策略回馈 swarm；标题带实时
        // 上传速率）
        if (task.type === "bt" && task.seeding === 1) {
          list.push(
            <DownloadTag
              key="seeding"
              icon={<UploadOutlined style={{ fontSize: 12, color: "#fff" }} />}
              text={t("seeding")}
              color="#67c23a"
              title={
                task.uploadSpeed
                  ? `${t("seeding")} ↑ ${task.uploadSpeed}`
                  : t("seeding")
              }
            />,
          );
        }
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
  }, [task, t, queueName]);

  /** 字节量人话格式（BT 体积展示） */
  const fmtBytes = (n: number): string => {
    if (!n || n <= 0) return "";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let v = n;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
  };

  const renderDescription = useMemoizedFn(
    (task: DownloadTaskDetails): ReactNode => {
      const val = Math.round(Number(task.percent) || 0);
      const total =
        (task as { engine?: { totalBytes?: number } }).engine?.totalBytes ?? 0;

      // 信息优先级 P1(活动任务):细进度线,百分比/速度/节点/体积紧贴进度线随
      // 内容流动;合并中(N_m3u8DL-RE 分片下完进 ffmpeg 合并,percent 已 100)
      // 脉冲呼吸提示「合并中」而非卡死的 100%
      if (
        task.status === DownloadStatus.Downloading ||
        task.status === DownloadStatus.Stopped
      ) {
        const merging =
          task.status === DownloadStatus.Downloading && val >= 100;
        if (!val && !task.speed) return null;
        return (
          <div className="flex min-w-0 flex-row items-center gap-2 text-[11px] leading-none text-gray-500 dark:text-gray-400">
            <div className="h-1 min-w-0 max-w-md flex-1 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/10">
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-300",
                  task.status === DownloadStatus.Stopped
                    ? "bg-gray-400"
                    : "bg-blue-500",
                  merging && "animate-pulse",
                )}
                style={{ width: `${Math.max(val, 2)}%` }}
              />
            </div>
            {merging ? (
              <span className="shrink-0 font-medium text-blue-600 dark:text-blue-400">
                {t("merging")}
              </span>
            ) : val ? (
              <span className="shrink-0 tabular-nums">{val}%</span>
            ) : null}
            {task.speed ? (
              <span className="shrink-0 tabular-nums">{task.speed}</span>
            ) : null}
            {task.uploadSpeed ? (
              <span
                className="shrink-0 tabular-nums text-emerald-600 dark:text-emerald-400"
                title={t("uploadSpeed")}
              >
                ↑ {task.uploadSpeed}
              </span>
            ) : null}
            {typeof task.peers === "number" ? (
              <span className="shrink-0 tabular-nums opacity-70">{task.peers}P</span>
            ) : null}
            {total > 0 ? (
              <span className="shrink-0 tabular-nums">{fmtBytes(total)}</span>
            ) : null}
          </div>
        );
      }

      // 信息优先级 P3(异常):失败原因单行,点击看详情
      if (task.status === DownloadStatus.Failed) {
        return (
          <div
            className="cursor-pointer truncate self-start text-[11px] leading-[18px] text-[#ff7373] transition-colors hover:text-[#ff4d4f] dark:text-[rgba(255,115,115,0.65)] dark:hover:text-[rgba(255,115,115,0.9)]"
            title="点击查看失败详情"
            onClick={() => onShowDetail?.(task)}
          >
            {t("failReason")}: ...
          </div>
        );
      }

      // 完成态/待定态不再在描述里塞体积或域名——体积已进「大小」列、源链接
      // 独占一行（「源链接」信息字段），描述行留给活动进度与失败原因
      return null;
    },
  );

  return (
    <div
      {...rowProps}
      className={cn(
        // 表体行：分隔线 + 行 hover + 选中蓝底（对齐迅雷表格选中态）
        "group relative flex flex-row items-center gap-2.5 border-b border-black/[0.04] px-3 py-2 transition-colors duration-150 last:border-b-0 hover:bg-black/[0.03] dark:border-white/[0.06] dark:hover:bg-white/[0.04]",
        {
          "bg-blue-500/[0.07] dark:bg-blue-400/[0.09]": selected,
          "opacity-70": task.status === DownloadStatus.Success && !task.exists,
        },
      )}
      onContextMenu={(e) => onContextMenu(e, task)}
    >
      {/* 选框列（表格化后常驻可见，拖拽框选/Cmd+Shift 选择的主视觉锚点） */}
      <div className="flex w-4 shrink-0 items-center">
        <Checkbox
          checked={selected}
          onCheckedChange={() => onSelectChange(task.id)}
        />
      </div>
      {/* 类型瓦片（对齐列 1） */}
      <span
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[15px]",
          typeMeta.bg,
        )}
        title={protocolLabel}
      >
        {typeMeta.icon}
      </span>
      {/* 任务列：标题为主角 + 特殊态小徽；次行源链接；再次行活动进度/失败原因 */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 flex-row items-center gap-1.5">
          {renderTitle(task)}
          {inlineFlags}
        </div>
        {sourceUrl ? (
          <button
            type="button"
            className="flex min-w-0 max-w-full cursor-copy flex-row items-center gap-1 self-start text-left"
            title={
              isMusicRow
                ? `${sourceUrl}\n点击复制服务器路径`
                : `${sourceUrl}\n点击复制源链接`
            }
            onClick={copyUrl}
          >
            {isMusicRow ? (
              <FolderOutlined className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500" />
            ) : (
              <LinkOutlined className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500" />
            )}
            <span className="min-w-0 truncate text-[11px] leading-[15px] text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-400">
              {sourceUrl}
            </span>
          </button>
        ) : null}
        {renderDescription(task)}
      </div>
      {/* 大小列（引擎任务实时总体积；未知显示 —） */}
      <div className="w-[88px] shrink-0 text-right text-[11px] leading-none tabular-nums text-gray-500 dark:text-gray-400">
        {sizeOfTask(task) ? fmtBytes(sizeOfTask(task)) : "—"}
      </div>
      {/* 状态列（对齐列 2：状态徽章 + 时间，整行垂直居中） */}
      <div className="flex w-[118px] shrink-0 flex-col items-end gap-1">
        {statusChip && task.status === DownloadStatus.Failed ? (
          <button
            type="button"
            className="cursor-pointer text-left"
            title="点击查看失败详情"
            onClick={() => onShowDetail?.(task)}
          >
            {statusChip}
          </button>
        ) : (
          statusChip
        )}
        <span className="text-[11px] leading-none tabular-nums text-gray-400 dark:text-gray-500">
          {fromatDateTime(task.createdDate, "YYYY/MM/DD HH:mm")}
        </span>
      </div>
      {/* 操作列（对齐列 3：md 尺寸按钮、常驻可见、整行垂直居中） */}
      <div className="flex w-[124px] shrink-0 flex-row items-center justify-end gap-1">
        {actionButtons}
      </div>
      {/* 快速查看侧栏（文本/图片/PDF 渲染；头部支持新窗口全屏 + 下载到本机） */}
      <Drawer
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
        width={640}
        destroyOnHidden
        styles={{ body: { padding: 16 } }}
      >
        <div className="flex h-[calc(100vh-80px)] flex-col">
          <FileViewerHeader
            taskId={task.status === DownloadStatus.Success ? task.id : undefined}
            fileName={viewerName}
            onClose={() => setViewerOpen(false)}
          />
          <FileViewerContent
            url={appFileUrl(`files/${task.id}`)}
            fileName={viewerName}
          />
        </div>
      </Drawer>
    </div>
  );
});
