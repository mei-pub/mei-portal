// 任务详情侧栏 —— 2026-10-15 按 Round-D 反馈再重构为「单一操作区 + 概况」形态：
//   - 全部操作按钮集中于顶部唯一操作区（不再「上面两个 + 引擎 tab 里三个」）：
//     音乐行=播放/下载到本机/复制链接·路径/删除文件·取消任务；引擎行=
//     暂停·继续·重试/重扫文件/换队列/插队/复制链接/下载到本机/删除；
//     普通行=暂停·继续·重试/播放/下载到本机/复制路径·链接/删除。
//   - 生命周期按钮由实时状态驱动：引擎行取 engine-detail 2s 轮询态、普通行
//     取 /api/downloads/:id 2s 轮询态 —— 操作完成后下一拍即翻转按钮
//     （修复「处理后按钮不变」）。
//   - 概况 = 状态徽章 + 名称 + 失败/异常卡 + 下载信息 + 引擎分区（引擎
//     信息并入概况分区展示，取代独立「引擎」tab）+ 时间。
//   日志：Terminal 内嵌终端（切换到该 tab 才挂载，懒加载）
//   —— 注意：音乐行（task.music）：本地数据渲染，绝不请求 /api/downloads/:id
//   （音乐行是负数合成 id，旧实现会请求 404 造成「无法查看详情」）。
//   - 全部操作按钮集中于顶部唯一操作区（不再「上面两个 + 引擎 tab 里三个」）：
//     音乐行=播放/下载到本机/复制链接·路径/删除文件·取消任务；引擎行=
//     暂停·继续·重试/重扫文件/换队列/插队/复制链接/下载到本机/删除；
//     普通行=暂停·继续·重试/播放/下载到本机/复制路径·链接/删除。
//   - 生命周期按钮由实时状态驱动：引擎行取 engine-detail 2s 轮询态、普通行
//     取 /api/downloads/:id 2s 轮询态 —— 操作完成后下一拍即翻转按钮
//     （修复「处理后按钮不变」）。
//   - 概况 = 状态徽章 + 名称 + 失败/异常卡 + 下载信息 + 引擎分区（引擎
//     信息并入概况分区展示，取代独立「引擎」tab）+ 时间。
//   日志：Terminal 内嵌终端（切换到该 tab 才挂载，懒加载）
//   —— 注意：音乐行（task.music）：本地数据渲染，绝不请求 /api/downloads/:id
//   （音乐行是负数合成 id，旧实现会请求 404 造成「无法查看详情」）。
import {
  CopyOutlined,
  DownloadOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ProfileOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { App, Button, Drawer, Select, Tabs } from "antd";
import { type FC, type ReactNode, useMemo, useState } from "react";
import useSWR from "swr";
import { EngineDetailInfo, useEngineDetail } from "@/components/engine-detail-drawer";
import type { DownloadTaskDetails, MusicRowMeta } from "@/hooks/use-tasks";
import {
  appFileUrl,
  deleteMediaTask,
  deleteMusicFile,
  deleteMusicTask,
  listMediaVideos,
} from "@/api/download-center";
import {
  matchMediaVideo,
  mediaVideoTarget,
  playMusicFile,
} from "@/utils/play-actions";
import { startDownload, stopDownload } from "@/api/download-task";
import { useDeleteTasks } from "@/components/delete-tasks-dialog";
import { useInlinePlayer } from "@/pages/downloads-page/components/inline-player";
import Terminal from "@/components/download-terminal";
import {
  isMediaVideoTask,
  musicServeUrl,
  copyText,
} from "@/pages/downloads-page/components/content-menu";
import { songPageUrlOf } from "@/utils/song-source";
import { cn } from "@/utils";
import { DownloadStatus, type DownloadTask } from "@mediago/shared-common";

const fmtBytes = (n?: number | null): string => {
  if (!n || n <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
};

const protocolOf = (task: DownloadTask): string => {
  const u = task.url ?? "";
  if ((task as { type?: string }).type === "music") return "音乐";
  if (/^magnet:/i.test(u)) return "磁力";
  if (task.type === "bt") return "BT";
  if (/^ed2k:/i.test(u)) return "eD2K";
  if (/^ftp:/i.test(u)) return "FTP";
  if (task.type === "direct") return "HTTP";
  return "媒体";
};

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};

/** 失败原因人话化:结论 + 建议(识别引擎/音源的高频错误族) */
const humanizeError = (
  msg: string,
): { title: string; hint: string; raw: string } => {
  const m = (msg || "").trim();
  if (/解析超时|resolve.*timeout/i.test(m))
    return {
      title: "磁力解析超时",
      hint: "DHT/Tracker 没能在时限内取到种子信息：资源过冷或网络受限。可稍后重试，或换一个做种数更多的资源。",
      raw: m,
    };
  if (/播放地址解析失败|解析播放地址|resolve.*play/i.test(m))
    return {
      title: "音乐源解析失败",
      hint: "上游音源没有返回可下载地址（常见于 VIP / 版权受限歌曲）。可换音源重试或换一首。",
      raw: m,
    };
  if (/ENOENT/i.test(m))
    return {
      title: "文件或目录不存在",
      hint: "产物文件或保存目录可能被外部移动/删除。可执行「清理无效任务」盘点后重新下载。",
      raw: m,
    };
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH/i.test(m))
    return {
      title: "网络连接失败",
      hint: "目标服务不可达或中途断开，检查服务器网络后重试。",
      raw: m,
    };
  if (/\b40[34]\b/.test(m))
    return {
      title: "资源已失效",
      hint: "服务器返回 403/404，下载链接可能已过期，需要更换链接。",
      raw: m,
    };
  return {
    title: "下载失败",
    hint: m ? "" : "未记录到具体失败原因，可在「日志」页定位。",
    raw: m || "",
  };
};

const STATUS_CHIP: Partial<
  Record<DownloadStatus, { text: string; cls: string }>
> = {
  [DownloadStatus.Success]: {
    text: "成功",
    cls: "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-400",
  },
  [DownloadStatus.Downloading]: {
    text: "下载中",
    cls: "bg-blue-500/10 text-blue-600 dark:bg-blue-400/10 dark:text-blue-400",
  },
  [DownloadStatus.Failed]: {
    text: "失败",
    cls: "bg-rose-500/10 text-rose-600 dark:bg-rose-400/10 dark:text-rose-400",
  },
  [DownloadStatus.Stopped]: {
    text: "已暂停",
    cls: "bg-orange-500/10 text-orange-600 dark:bg-orange-400/10 dark:text-orange-400",
  },
  [DownloadStatus.Pending]: {
    text: "等待下载",
    cls: "bg-gray-500/10 text-gray-500 dark:bg-white/10 dark:text-gray-400",
  },
  [DownloadStatus.Ready]: {
    text: "等待下载",
    cls: "bg-gray-500/10 text-gray-500 dark:bg-white/10 dark:text-gray-400",
  },
};

/** 引擎状态码 → 任务状态（概况徽章配色与引擎实时态同源） */
const ENGINE_STATUS_TO_STATUS: Record<number, DownloadStatus> = {
  0: DownloadStatus.Pending,
  1: DownloadStatus.Downloading,
  5: DownloadStatus.Downloading,
  2: DownloadStatus.Stopped,
  3: DownloadStatus.Success,
  4: DownloadStatus.Failed,
};

/** 信息行（label 定宽灰、值随文本流，长值可换行） */
const Row: FC<{ label: string; children: ReactNode }> = ({
  label,
  children,
}) => (
  <div className="flex flex-row gap-3 text-[13px] leading-[22px]">
    <span className="w-16 shrink-0 text-gray-400 dark:text-gray-500">
      {label}
    </span>
    <span className="min-w-0 flex-1 break-all text-gray-700 dark:text-gray-200">
      {children}
    </span>
  </div>
);

/** 分组标题（概况页信息分节） */
const Section: FC<{ title: string; children: ReactNode }> = ({
  title,
  children,
}) => (
  <div className="flex flex-col gap-1.5">
    <div className="border-b border-black/[0.05] pb-1 text-[11px] font-medium uppercase tracking-wider text-gray-400 dark:border-white/[0.06]">
      {title}
    </div>
    {children}
  </div>
);

const fmtTime = (v: unknown): string =>
  v ? new Date(v as string).toLocaleString("zh-CN", { hour12: false }) : "";

export function TaskDetailDrawer({
  task,
  open,
  onClose,
  onChanged,
  onPlay,
}: {
  task: DownloadTaskDetails | null;
  open: boolean;
  onClose: () => void;
  /** 任务级动作（暂停/继续等）成功后由调用方刷新列表 */
  onChanged?: () => void;
  /** 影视行播放委托：有 playRoute 的记录走播放页深链，覆盖默认的
   *  /api/v1/videos 匹配播放；其余行可不传（走默认播放逻辑） */
  onPlay?: () => void;
}) {
  const { message } = App.useApp();
  const inlinePlayer = useInlinePlayer();
  const { confirmDelete, deleteDialog } = useDeleteTasks();
  /** 受控 tab key；「日志」懒挂载——首次切入才渲染本体 */
  const [activeTab, setActiveTab] = useState("overview");
  const [logMounted, setLogMounted] = useState(false);
  const musicMeta = (task as { music?: MusicRowMeta } | null)?.music ?? null;
  const isMusic = Boolean(musicMeta);
  const isEngine = Boolean(task?.engineTaskId);

  // 引擎实时态：useEngineDetail 打开期间 2s 轮询 + 全部引擎动作
  // （非引擎行不轮询：open=false 守卫在 hook 内短路）
  const eng = useEngineDetail(task?.id ?? 0, open && isEngine, onChanged);
  const engTask = eng.data?.task ?? null;

  // 普通行实时态：/api/downloads/:id 2s 轮询（引擎行走 engine-detail，
  // 音乐行是负数合成 id 无后端任务，均不请求 —— 否则 404 噪声/误报）
  const detail = useSWR(
    open && task && !isMusic && !isEngine ? `/api/downloads/${task.id}` : null,
    (url: string) =>
      fetch(url).then((r) => r.json()) as Promise<Record<string, unknown>>,
    { refreshInterval: 2000, revalidateOnFocus: false },
  );
  const live = useMemo(() => {
    const payload = (detail.data as { data?: Record<string, unknown> } | null)
      ?.data;
    return {
      status: String(payload?.status ?? "") as DownloadStatus,
      errorMessage: String(payload?.errorMessage ?? ""),
      file: String(payload?.file ?? ""),
      exists: Boolean(payload?.exists),
    };
  }, [detail.data]);

  // 实时状态口径：引擎=engine-detail 轮询态映射；普通=/api 2s 轮询态；
  // 音乐=列表行本地态。顶部徽章与操作按钮统一由它驱动（处理后即时翻转）。
  const status = isEngine
    ? ENGINE_STATUS_TO_STATUS[eng.status] ?? task?.status ?? DownloadStatus.Ready
    : live.status || task?.status || DownloadStatus.Ready;

  // 原始 fetch 拿到的是 {success,data} 信封:engine-detail 的 data =
  // {task,...detail}（引擎）；普通行=任务本体；音乐=空
  const info = useMemo(() => {
    if (!task) return null;
    if (isEngine) {
      return {
        errorMessage: String(engTask?.errorMessage ?? ""),
        totalBytes: Number(engTask?.totalBytes ?? 0) || null,
        downloadedBytes: Number(engTask?.downloadedBytes ?? 0) || null,
        saveDir: String(engTask?.saveDir ?? ""),
      };
    }
    if (isMusic) {
      return {
        errorMessage: musicMeta?.error ?? "",
        totalBytes: null,
        downloadedBytes: null,
        saveDir: "",
      };
    }
    return {
      errorMessage: live.errorMessage,
      totalBytes: null,
      downloadedBytes: null,
      saveDir: "",
    };
  }, [task, isEngine, isMusic, engTask, live.errorMessage, musicMeta]);

  const chip =
    status != null ? STATUS_CHIP[status] : undefined;
  const failed = status === DownloadStatus.Failed;
  const success = status === DownloadStatus.Success;
  const human = failed
    ? humanizeError(
        isMusic
          ? (musicMeta?.error ?? "")
          : (info?.errorMessage ||
              (task as { errorMessage?: string })?.errorMessage ||
              ""),
      )
    : null;

  /** 剪贴板写入走共享 copyText（Clipboard API + execCommand 降级——HTTP 部署
   *  非安全上下文/无 user activation 时也能复制成功，与右键菜单同口径） */
  const copy = async (text: string, label = "已复制") => {
    const ok = await copyText(text);
    if (ok) message.success(label);
    else message.error("复制失败");
  };

  /** 复制口径统一=源地址（用户契约「复制链接=复制源链接」）：
   *  媒体/磁力/直链 = task.url；音乐行=音源站歌曲页地址（source+id 构造，
   *  use-tasks 并入时已写进 url）；源页构造不出来时按音乐元数据兜底落盘
   *  路径并如实提示——不再用本地流直链冒充源链接。 */
  const copyableOf = (): string => {
    if (musicMeta) return songPageUrlOf(musicMeta.song) || musicMeta.path;
    return task?.url ?? "";
  };
  // 音乐按钮文案（与右键菜单同口径）：源站歌曲页地址可构造 → 「复制链接」；
  // 构造不出来 → 兜底复制落盘路径，如实标「复制路径」
  const musicCopyLabel = musicMeta && songPageUrlOf(musicMeta.song)
    ? "复制链接"
    : "复制路径";

  const lifecycle = async (start: boolean) => {
    if (!task) return;
    try {
      await (start ? startDownload(task.id) : stopDownload(task.id));
      message.success(start ? "已开始下载" : "已暂停");
      onChanged?.();
      // 实时态数据下一拍刷新（详情轮询兜底，这里主动触发避免等 2s）
      void detail.mutate();
    } catch (e) {
      message.error((e as Error)?.message || "操作失败");
    }
  };

  /** 影视任务就地播放：/api/v1/videos 按任务名精确匹配 → 弹层播放 */
  const playMedia = async (name: string) => {
    try {
      const videos = await listMediaVideos();
      const video = matchMediaVideo(videos, name);
      if (video) {
        inlinePlayer.play(mediaVideoTarget(video));
      } else {
        message.info("未找到该任务对应的可播放视频");
      }
    } catch {
      message.error("获取视频信息失败");
    }
  };

  /** 产物回拉：/files/:id 附件端点（appFileUrl 处理门户 /downloads 前缀） */
  const downloadLocal = (id: number) => {
    window.location.href = appFileUrl(`files/${id}`);
  };

  const musicAction = async (kind: "play" | "download" | "cancel") => {
    if (!task || !musicMeta) return;
    if (kind === "play") {
      playMusicFile({
        path: musicMeta.path,
        name: musicMeta.song.name,
        artist: musicMeta.song.artist,
        fileName: musicMeta.path.split("/").pop() ?? "",
        size: 0,
        mtime: "",
      });
      return;
    }
    if (kind === "download") {
      window.location.href = musicServeUrl(musicMeta.path);
      return;
    }
    try {
      if (musicMeta.kind === "file") {
        await deleteMusicFile(musicMeta.path);
        message.success("已删除文件");
      } else {
        await deleteMusicTask(musicMeta.taskId ?? "");
        message.success("已取消任务");
      }
      onChanged?.();
      onClose();
    } catch (e) {
      message.error((e as Error)?.message || "操作失败");
    }
  };

  /** 媒体/引擎任务删除：三选一确认 → deleteMediaTask（未完成=清理临时文件） */
  const removeTask = async () => {
    if (!task) return;
    const unfinished = status !== DownloadStatus.Success ? 1 : 0;
    const choice = await confirmDelete({
      unfinished,
      done: 1 - unfinished,
      label: `任务「${task.name}」`,
    });
    if (choice === null) return;
    try {
      await deleteMediaTask(task.id, choice);
      message.success("已删除");
      onChanged?.();
      onClose();
    } catch (e) {
      message.error((e as Error)?.message || "删除失败");
    }
  };

  if (!task) return null;

  // 生命周期按钮可见性（实时态）：引擎 0/1/5=进行中 → 暂停，2=继续，
  // 4=失败 → 重试；普通行按字符串状态分流；状态 3（成功）无生命周期按钮
  const isResumable =
    !isEngine &&
    (status === DownloadStatus.Stopped ||
      status === DownloadStatus.Pending ||
      status === DownloadStatus.Ready ||
      status === DownloadStatus.Failed);

  /** 概况页 */
  const overview = (
    <div className="flex flex-col gap-4">
      {failed && human ? (
        <div className="flex flex-col gap-1.5 rounded-xl border border-rose-500/15 bg-rose-500/[0.06] p-3">
          <div className="text-[13px] font-medium text-rose-600 dark:text-rose-400">
            {human.title}
          </div>
          {human.hint ? (
            <div className="text-[12px] leading-[20px] text-gray-600 dark:text-gray-300">
              {human.hint}
            </div>
          ) : null}
          {human.raw ? (
            <details className="mt-0.5">
              <summary className="cursor-pointer select-none text-[11px] text-gray-400 hover:text-gray-500">
                技术细节
              </summary>
              <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/[0.04] p-2 text-[11px] leading-[16px] text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">
                {human.raw}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}

      {success && !isMusic && !task.exists && !live.exists ? (
        <div className="flex flex-col gap-1.5 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3">
          <div className="text-[13px] font-medium text-amber-600 dark:text-amber-400">
            产物文件未在磁盘找到
          </div>
          <div className="text-[12px] leading-[20px] text-gray-600 dark:text-gray-300">
            文件可能被外部移动或删除。可执行引擎「清理无效任务」盘点找回；确认丢失后可右键重新下载。
          </div>
        </div>
      ) : null}

      {isMusic ? (
        <Section title="歌曲信息">
          <Row label="歌名">{musicMeta?.song.name ?? task?.name}</Row>
          <Row label="歌手">{musicMeta?.song.artist || "—"}</Row>
          <Row label="音源">{musicMeta?.song.source || "—"}</Row>
          <Row label="路径">
            <span className="flex flex-row items-center gap-1.5">
              <span className="min-w-0 flex-1 break-all">
                {(task?.url ?? "").trim() || "—"}
              </span>
              <Button
                size="small"
                type="text"
                icon={<CopyOutlined title={musicCopyLabel} />}
                onClick={() =>
                  void copy(copyableOf(), musicCopyLabel === "复制链接" ? "已复制源链接" : "已复制路径")
                }
                title={musicCopyLabel === "复制链接" ? "复制链接（源地址）" : "复制路径（源地址）"}
              />
            </span>
          </Row>
        </Section>
      ) : (
        <Section title="下载信息">
          <Row label="协议">{task ? protocolOf(task) : "—"}</Row>
          <Row label="链接">
            <span className="flex flex-row items-center gap-1.5">
              <span className="min-w-0 flex-1 break-all">
                {/^magnet:/i.test(task?.url ?? "")
                  ? "磁力链接（BT 引擎 DHT/Tracker 找源）"
                  : hostOf(task?.url ?? "") || task?.url || "—"}
              </span>
              <Button
                size="small"
                type="text"
                icon={<CopyOutlined title="复制链接" />}
                onClick={() => void copy(copyableOf(), "已复制链接")}
                title="复制链接"
              />
            </span>
          </Row>
          {task?.folder ? <Row label="保存目录">{task.folder}</Row> : null}
          {info?.saveDir ? <Row label="引擎目录">{info.saveDir}</Row> : null}
          {info?.totalBytes ? (
            <Row label="体积">
              {fmtBytes(info.downloadedBytes ?? 0)} / {fmtBytes(info.totalBytes)}
            </Row>
          ) : null}
          {task?.segments ? <Row label="分段数">{task.segments}</Row> : null}
        </Section>
      )}

      {/* 引擎块按「下载进度/引擎信息/活动日志」三节平铺进概况（Round-A：
          进度条所在分区的标题不该是「引擎」——进度与引擎侧字段是两类信息）；
          目录/体积/时间等常规字段仍由上方「下载信息/时间」分节承载 */}
      {isEngine ? (
        <EngineDetailInfo
          sections
          data={eng.data}
          loading={eng.loading}
          queues={eng.queues}
          limits={eng.limits}
          savingLimits={eng.savingLimits}
          saveLimits={eng.saveLimits}
        />
      ) : null}

      <Section title="时间">
        {task?.createdDate || musicMeta?.song ? (
          <Row label="创建时间">{fmtTime(task?.createdDate)}</Row>
        ) : null}
      </Section>
    </div>
  );

  const tabs: Array<{
    key: string;
    label: string;
    children: ReactNode;
  }> = [{ key: "overview", label: "概况", children: overview }];
  if (!isMusic) {
    // 日志 tab 本体懒挂载:xterm 容器挂载才建立连接
    tabs.push({
      key: "log",
      label: "日志",
      children: logMounted && task ? (
        <div className="h-[420px] overflow-hidden rounded-lg bg-black">
          <Terminal id={task.id} />
        </div>
      ) : null,
    });
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={480}
      title={
        <span className="flex items-center gap-2 text-[15px]">
          <ProfileOutlined className="text-gray-400" />
          {isMusic ? "音乐详情" : "任务详情"}
        </span>
      }
      destroyOnHidden
    >
      <div className="flex flex-col gap-4">
        {/* 概要:状态徽章(实时) + 协议 + 名称 */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-row items-center gap-2">
            {chip ? (
              <span
                className={cn(
                  "inline-flex shrink-0 items-center rounded-full px-2 py-[3px] text-[11px] font-medium leading-none",
                  chip.cls,
                )}
              >
                {chip.text}
              </span>
            ) : null}
            <span className="truncate text-[11px] text-gray-400">
              {isMusic
                ? musicMeta?.song.source
                  ? `音乐 · ${musicMeta.song.source}`
                  : "音乐"
                : task
                  ? protocolOf(task)
                  : ""}
            </span>
          </div>
          <div className="text-[15px] font-medium leading-snug text-gray-900 dark:text-gray-100">
            {task?.name}
          </div>
          {/* 唯一操作区：全部动作按钮集中于此（Round-D 第 3 条） */}
          <div className="flex flex-row flex-wrap items-center gap-2">
            {isEngine && engTask ? (
              <>
                {[0, 1, 5].includes(engTask.status) ? (
                  <Button
                    size="small"
                    icon={<PauseCircleOutlined />}
                    title="暂停下载"
                    onClick={() => void eng.pauseResume()}
                  >
                    暂停
                  </Button>
                ) : null}
                {engTask.status === 2 || engTask.status === 4 ? (
                  <Button
                    size="small"
                    icon={<PlayCircleOutlined />}
                    title={engTask.status === 2 ? "继续下载" : "重试"}
                    onClick={() => void eng.pauseResume()}
                  >
                    {engTask.status === 2 ? "继续" : "重试"}
                  </Button>
                ) : null}
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  title="重扫库内文件"
                  loading={eng.rescanning}
                  onClick={() => void eng.rescan()}
                >
                  重扫文件
                </Button>
                {eng.queues && eng.queues.length > 0 ? (
                  <>
                    <Select
                      size="small"
                      className="min-w-28"
                      value={engTask.queueId || undefined}
                      loading={eng.queueBusy}
                      disabled={eng.queueBusy}
                      onChange={(v) => void eng.moveQueue(v)}
                      options={eng.queues.map((q) => ({
                        value: q.queueId,
                        label: q.name,
                      }))}
                    />
                    <Button
                      size="small"
                      loading={eng.queueBusy}
                      title="插队（立即开始）"
                      onClick={() => void eng.boostTask()}
                    >
                      插队
                    </Button>
                  </>
                ) : null}
              </>
            ) : null}
            {!isEngine && !isMusic ? (
              <>
                {status === DownloadStatus.Downloading ? (
                  <Button
                    size="small"
                    icon={<PauseCircleOutlined />}
                    title="暂停下载"
                    onClick={() => void lifecycle(false)}
                  >
                    暂停
                  </Button>
                ) : null}
                {isResumable ? (
                  <Button
                    size="small"
                    icon={failed ? <ReloadOutlined /> : <PlayCircleOutlined />}
                    title={failed ? "重试" : "继续下载"}
                    onClick={() => void lifecycle(true)}
                  >
                    {failed ? "重试" : "继续"}
                  </Button>
                ) : null}
              </>
            ) : null}
            {isMusic && success ? (
              <>
                <Button
                  size="small"
                  icon={<PlayCircleOutlined />}
                  title="播放"
                  onClick={() => void musicAction("play")}
                >
                  播放
                </Button>
                <Button
                  size="small"
                  icon={<DownloadOutlined />}
                  title="下载到本机"
                  onClick={() => void musicAction("download")}
                >
                  下载到本机
                </Button>
              </>
            ) : null}
            {!isMusic && success && task && !isEngine && (onPlay || isMediaVideoTask(task)) ? (
              <Button
                size="small"
                icon={<PlayCircleOutlined />}
                title="播放"
                onClick={() => {
                  if (onPlay) {
                    onPlay();
                    return;
                  }
                  void playMedia(task.name);
                }}
              >
                播放
              </Button>
            ) : null}
            {!isMusic && success && task ? (
              <Button
                size="small"
                icon={<DownloadOutlined />}
                title="下载到本机"
                onClick={() => downloadLocal(task.id)}
              >
                下载到本机
              </Button>
            ) : null}
            {isMusic ? (
              <Button
                size="small"
                icon={<CopyOutlined />}
                title={`复制${musicCopyLabel === "复制链接" ? "源链接" : "路径"}`}
                onClick={() =>
                  void copy(copyableOf(), musicCopyLabel === "复制链接" ? "已复制源链接" : "已复制路径")
                }
              >
                {musicCopyLabel}
              </Button>
            ) : (
              <Button
                size="small"
                icon={<CopyOutlined />}
                title="复制链接"
                onClick={() => void copy(copyableOf(), "已复制链接")}
              >
                复制链接
              </Button>
            )}
            {/* 复制路径：仅普通任务且已产出文件（file 绝对路径）时提供 */}
            {!isMusic && success && !isEngine && (live.file || (task as { file?: string }).file) ? (
              <Button
                size="small"
                icon={<CopyOutlined />}
                title="复制服务器本地路径"
                onClick={() =>
                  void copy(String(live.file || (task as { file?: string }).file), "已复制路径")
                }
              >
                复制路径
              </Button>
            ) : null}
            {isMusic ? (
              <Button
                size="small"
                danger
                title={musicMeta?.kind === "file" ? "删除文件" : "取消任务"}
                onClick={() => void musicAction("cancel")}
              >
                {musicMeta?.kind === "file" ? "删除文件" : "取消任务"}
              </Button>
            ) : (
              <Button size="small" danger title="删除任务" onClick={() => void removeTask()}>
                删除…
              </Button>
            )}
          </div>
        </div>

        <Tabs
          size="small"
          activeKey={activeTab}
          items={tabs}
          className="[-mb-1]"
          onChange={(k) => {
            setActiveTab(k);
            if (k === "log") setLogMounted(true);
          }}
        />
      </div>
      {/* 删除三选一确认弹窗（useDeleteTasks 的状态节点） */}
      {deleteDialog}
    </Drawer>
  );
}
