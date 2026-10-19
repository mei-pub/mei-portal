// 下载中心内容级右键菜单共享模块 —— 全部 tab 与各分类 tab 统一能力底座：
//   下载任务（media/file/bt）：取消 / 开始 / 播放（视频类 Success）/ 日志 / 删除
//   影视记录：立即播放（playRoute 深链 / 内嵌弹层兜底）/ 删除含文件
//   音乐文件：播放 / 收藏 / 加入播放列表（二级菜单）/ 删除文件
//   音乐任务：取消（删除任务并清理临时文件）
// 分类 tab 在此之上叠加个性化项（编辑/开始下载/加入多选等），不得少于全部 tab。
// 加入播放列表走实时 GET + revision PUT（409 重试）+ replace-data 同步外壳引擎。
import { App, Input, Modal, Select } from "antd";
import {
  DownloadStatus,
  type DownloadTask,
  type DownloadTaskWithFile,
} from "@mediago/shared-common";
import {
  CaretRightOutlined,
  CloseCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  RocketOutlined,
  StarOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { useMemoizedFn } from "ahooks";
import { type FC, useState } from "react";
import useSWR from "swr";
import Terminal from "@/components/download-terminal";
import {
  useWebContextMenu,
  type ContextMenuItem,
} from "@/components/web-context-menu";
export type { ContextMenuItem };
import {
  appFileUrl,
  deleteMediaTask,
  deleteMovieSource,
  deleteMusicFile,
  deleteMusicTask,
  getMediaTaskUrl,
  listMediaVideos,
  type MovieSourceRecord,
  renameMovieSource,
} from "@/api/download-center";
import { startDownload, stopDownload } from "@/api/download-task";
import {
  matchMediaVideo,
  mediaVideoTarget,
  movieFallbackVideo,
  playMovieRecord,
  playMusicFile,
} from "@/utils/play-actions";
import { musicServeUrl, songPageUrlOf } from "@/utils/song-source";
import type { InlinePlayerApi } from "./inline-player";
import type { DeleteConfirmOptions } from "@/components/delete-tasks-dialog";
import type { MusicRowMeta } from "@/hooks/use-tasks";

// ============================================================
// 音乐 guest 协议（与门户外壳 MusicDock 引擎协作）
// ============================================================

/** 音乐文件最小载荷（各面板的原生行数据归一化到这三个字段；曲库 enrich 后
 * 的面板行一路携带源 id/source，供「复制链接」（源站页）按需构造） */
export interface MusicFileLike {
  path: string;
  name: string;
  artist: string;
  id?: string | number;
  source?: string;
  songId?: string | number;
  songSource?: string;
}

interface MusicStateLite {
  revision: number;
  playlists: Array<{ id: string; name: string; songs: Array<{ id: string }> }>;
  favorites: Array<{ id: string }>;
  temp: Array<{ id: string }>;
  selectedPlaylistId: string;
}

const MUSIC_STATE_SWR_KEY = "download-center/music-state";

/** 右键菜单项图标（模块级复用元素；图标槽由 WebContextMenu 承载） */
const MI = {
  play: <PlayCircleOutlined />,
  start: <CaretRightOutlined />,
  pause: <PauseCircleOutlined />,
  local: <DownloadOutlined />,
  del: <DeleteOutlined />,
  cancel: <CloseCircleOutlined />,
  copy: <CopyOutlined />,
  boost: <RocketOutlined />,
  rename: <EditOutlined />,
  queue: <UnorderedListOutlined />,
  log: <FileTextOutlined />,
  detail: <FileSearchOutlined />,
  refresh: <ReloadOutlined />,
  fav: <StarOutlined />,
  addPl: <PlusOutlined />,
  edit: <EditOutlined />,
};

/**
 * 门户账户音乐状态共享 hook（全部 tab 与音乐 tab 同 key 复用 SWR 缓存）：
 * - musicFileSong：MusicFileLike → MusicSong（server-local 同构，id=file:<相对路径>）
 * - sendMusicGuest：向外壳引擎发 mei-music-guest 消息（非 embedded 返回 false）
 * - addToPlaylist：实时 GET → 改 playlists → revision PUT（409 重试）→
 *   replace-data 同步引擎（SWR 缓存的 revision 会过期，必须实时读）
 */
export function useMusicGuest() {
  const { message } = App.useApp();
  const { data, mutate } = useSWR(
    MUSIC_STATE_SWR_KEY,
    async () => {
      // 绝对路径 /api/music/state 仅门户同源部署可达；独立部署/网络异常时
      // 静默降级为 null（菜单显示「暂无播放列表」禁用态，不抛错刷屏）
      try {
        const r = await fetch("/api/music/state");
        if (!r.ok) return null;
        return (await r.json()) as { loggedIn: boolean; state: MusicStateLite };
      } catch {
        return null;
      }
    },
    { refreshInterval: 15000, revalidateOnFocus: false },
  );
  const musicState = data?.state;

  const musicFileSong = useMemoizedFn((file: MusicFileLike) => ({
    id: `file:${file.path}`,
    name: file.name,
    artist: file.artist || "",
    album: "",
    pic_id: "",
    lyric_id: "",
    source: "server-local",
  }));

  const sendMusicGuest = useMemoizedFn((payload: Record<string, unknown>) => {
    if (window.parent === window.self) return false;
    window.parent.postMessage(
      { source: "mei-music-guest", ...payload },
      window.location.origin,
    );
    return true;
  });

  const addToPlaylist = useMemoizedFn(
    async (pid: string, file: MusicFileLike): Promise<boolean> => {
      const song = musicFileSong(file);
      let done = false;
      // 乐观并发（revision 落后 409）最多重试 2 次
      for (let attempt = 0; attempt < 3 && !done; attempt++) {
        let st: MusicStateLite | null = null;
        try {
          const gr = await fetch("/api/music/state");
          st = gr.ok ? (await gr.json()).state : null;
        } catch {
          st = null;
        }
        if (!st) {
          message.error("读取音乐状态失败");
          return false;
        }
        const pl = (st.playlists ?? []).find((p) => p.id === pid);
        if (!pl) return false;
        if ((pl.songs ?? []).some((s) => s.id === song.id)) {
          message.info(`已在「${pl.name}」中`);
          return true;
        }
        const playlists = (st.playlists ?? []).map((p) =>
          p.id === pid ? { ...p, songs: [song, ...(p.songs ?? [])] } : p,
        );
        try {
          const r = await fetch("/api/music/state", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ revision: st.revision, playlists }),
          });
          if (r.status === 409) continue; // 并发冲突：重读重试
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          sendMusicGuest({
            type: "replace-data",
            data: {
              playlists,
              favorites: st.favorites ?? [],
              temp: st.temp ?? [],
              selectedPlaylistId: st.selectedPlaylistId ?? "",
            },
          });
          message.success(`已加入「${pl.name}」`);
          done = true;
        } catch {
          message.error("加入播放列表失败");
          return false;
        }
      }
      if (!done) message.warning("未能加入播放列表，请稍后重试");
      return done;
    },
  );

  return {
    musicState,
    musicFileSong,
    sendMusicGuest,
    addToPlaylist,
    mutateMusicState: mutate,
  };
}

export type MusicGuestApi = ReturnType<typeof useMusicGuest>;

// ============================================================
// 日志弹层（media/file/bt 任务排障；全部 tab 与 DownloadList 共用）
// ============================================================

export interface TaskLogTarget {
  id: number;
  name: string;
}

export const TaskLogModal: FC<{
  target: TaskLogTarget | null;
  onClose: () => void;
}> = ({ target, onClose }) => (
  <Modal
    open={target !== null}
    title="下载日志"
    onCancel={onClose}
    footer={null}
    width={720}
    styles={{ body: { paddingTop: 8 } }}
  >
    <p className="mb-2 truncate text-xs text-black/45 dark:text-white/45">
      {target?.name}
    </p>
    <div className="h-[46vh] overflow-hidden rounded-lg bg-black">
      {target && <Terminal id={target.id} />}
    </div>
  </Modal>
);

// ============================================================
// 内容菜单 hook（动作逻辑单份实现，菜单结构各视图自行组装）
// ============================================================

export interface ContentMenuDeps {
  /** 操作成功后刷新面板数据 */
  refresh: () => void;
  /** 就地播放弹层 API */
  inlinePlayer: InlinePlayerApi;
  /** 删除三选一确认 */
  confirmDelete: (opts: DeleteConfirmOptions) => Promise<boolean | null>;
  /** [DownloadList] 编辑任务回调 */
  onEditTask?: (task: DownloadTask) => void;
  /** [DownloadList] 把任务加入已选（多选）回调 */
  onSelectTask?: (id: number) => void;
  /** [DownloadList] 打开任务详情侧栏（失败原因等人话化信息） */
  onShowDetail?: (task: DownloadTask) => void;
  /** [DownloadList] 批量删除目标（列表层统一路由：音乐行分流音乐通道） */
  onDeleteBatch?: (tasks: DownloadTask[]) => Promise<void>;
}

/** 任务是否为视频类（m3u8/bilibili/mediago/youtube 等，可匹配 /api/v1/videos 播放） */
export const isMediaVideoTask = (task: DownloadTask): boolean =>
  task.type !== "direct" && task.type !== "bt";

/** 剪贴板写入（Clipboard API 优先，HTTP 部署降级 execCommand）——
 *  对齐迅雷「复制下载地址/复制磁力链接」的底层能力 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* 非 secure context（http 部署）：降级 */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

// 音乐文件的本地流直链（同源绝对地址，可粘给其它播放器/下载器直接用）。
// 实现移至 utils/song-source（use-tasks 曲库文件行 url 兜底共用），此处保留
// 原导出名，既有引用方无需改动。
export { musicServeUrl };

export function useContentMenu(deps: ContentMenuDeps) {
  const { message, modal } = App.useApp();
  const { menu, openMenu } = useWebContextMenu();
  const music = useMusicGuest();
  const [logTarget, setLogTarget] = useState<TaskLogTarget | null>(null);
  const logModal = (
    <TaskLogModal target={logTarget} onClose={() => setLogTarget(null)} />
  );

  // 任务级 重命名 / 挪队列 弹层（对齐 FluxDown 控制台右键能力面；
  // boost 无弹层直接提交）。均限引擎任务（engineTaskId 在列表数据里）
  const [renameTaskTarget, setRenameTaskTarget] = useState<DownloadTask | null>(
    null,
  );
  const [renameTaskValue, setRenameTaskValue] = useState("");
  const [renameTaskBusy, setRenameTaskBusy] = useState(false);
  const [queueMoveTargets, setQueueMoveTargets] = useState<DownloadTask[]>([]);
  const [queueList, setQueueList] = useState<
    Array<{ queueId: string; name: string }>
  >([]);
  const [queueMoveValue, setQueueMoveValue] = useState<string | null>(null);
  const [queueMoveBusy, setQueueMoveBusy] = useState(false);

  const taskRenameModal = (
    <Modal
      title="重命名任务"
      open={renameTaskTarget !== null}
      onCancel={() => setRenameTaskTarget(null)}
      okText="保存"
      cancelText="取消"
      confirmLoading={renameTaskBusy}
      okButtonProps={{ disabled: renameTaskValue.trim() === "" }}
      width={440}
      destroyOnClose
      onOk={async () => {
        const t = renameTaskTarget;
        const name = renameTaskValue.trim();
        if (!t || name === "") return;
        setRenameTaskBusy(true);
        try {
          const res = await fetch(`/api/downloads/${t.id}/rename`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileName: name }),
          });
          const p = (await res.json().catch(() => null)) as {
            success?: boolean;
            message?: string;
          } | null;
          if (!res.ok || !p?.success) {
            throw new Error(p?.message || `HTTP ${res.status}`);
          }
          message.success("已重命名");
          setRenameTaskTarget(null);
          deps.refresh();
        } catch (e) {
          message.error((e as Error).message || "重命名失败");
        } finally {
          setRenameTaskBusy(false);
        }
      }}
    >
      <Input
        value={renameTaskValue}
        maxLength={120}
        onChange={(e) => setRenameTaskValue(e.target.value)}
      />
    </Modal>
  );

  const queueMoveModal = (
    <Modal
      title={
        queueMoveTargets.length > 1
          ? `移动 ${queueMoveTargets.length} 个任务到队列`
          : `移动「${queueMoveTargets[0]?.name ?? ""}」到队列`
      }
      open={queueMoveTargets.length > 0}
      onCancel={() => setQueueMoveTargets([])}
      okText="移动"
      cancelText="取消"
      confirmLoading={queueMoveBusy}
      okButtonProps={{ disabled: queueMoveValue === null }}
      width={440}
      destroyOnClose
      onOk={async () => {
        const targets = queueMoveTargets;
        const qid = queueMoveValue;
        if (targets.length === 0 || qid === null) return;
        setQueueMoveBusy(true);
        try {
          const results = await Promise.allSettled(
            targets.map((t) =>
              fetch(`/api/downloads/${t.id}/queue`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ queueId: qid }),
              }).then((res) => readEnvelope(res)),
            ),
          );
          const failed = results.filter((r) => r.status === "rejected").length;
          if (failed === targets.length) {
            throw new Error("移动失败");
          }
          message.success(
            failed === 0
              ? "已移动到新队列"
              : `${targets.length - failed} 个已移动，${failed} 个失败`,
          );
          setQueueMoveTargets([]);
          deps.refresh();
        } catch (e) {
          message.error((e as Error).message || "移动失败");
        } finally {
          setQueueMoveBusy(false);
        }
      }}
    >
      <Select
        className="w-full"
        placeholder="选择目标队列"
        value={queueMoveValue}
        onChange={(v) => setQueueMoveValue(v)}
        options={queueList.map((q) => ({ value: q.queueId, label: q.name }))}
        notFoundContent="暂无命名队列（先在队列视图新建）"
      />
    </Modal>
  );

  /** 任务列表的弹层合集（日志 + 重命名 + 挪队列；随 logModal 一并挂载） */
  const taskOverlays = (
    <>
      {logModal}
      {taskRenameModal}
      {queueMoveModal}
    </>
  );

  // ---- 下载任务（media / file / bt）----

  const buildTaskMenu = (task: DownloadTask): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];
    // 详情侧栏(失败原因等人话化信息)置顶——所有类型只挂一次（音乐分支此前
    // 重复 push 同 key 项导致菜单出现两个「详情」）
    items.push({ key: "task-detail", label: "详情", icon: MI.detail });
    // 音乐行（music 服务下载任务/曲库文件并入任务队列）：播放 / 下载到
    // 本地 / 复制路径 / 取消任务或删除文件——不走媒体任务的生命周期操作
    const musicMeta = (task as { music?: MusicRowMeta }).music;
    if (musicMeta) {
      if (task.status === DownloadStatus.Success) {
        items.push({ key: "music-play", label: "播放", icon: MI.play });
        items.push({ key: "music-download-local", label: "下载到本地", icon: MI.local });
      }
      // 「复制链接」恒在且恒为源链接（用户定案：所有复制链接=复制源链接）：
      // 有源 id 复制音源站歌曲页地址；构造不出源页（罕见：任务未带 id）时
      // 菜单项仍叫「复制链接」，点击兜底复制落盘路径并如实提示
      const hasSourcePage = Boolean(songPageUrlOf(musicMeta.song));
      items.push({
        key: "music-copy",
        label: hasSourcePage ? "复制链接" : "复制路径",
        icon: MI.copy,
      });
      items.push({
        key: "music-delete",
        icon: MI.del,
        label: task.status === DownloadStatus.Success ? "删除文件…" : "取消任务",
        danger: true,
      });
      return items;
    }
    // 生命周期语义对齐迅雷：暂停（可继续）/ 继续 / 重试（失败）/ 播放 / 删除
    switch (task.status) {
      case DownloadStatus.Downloading:
        items.push({ key: "pause", label: "暂停下载", icon: MI.pause });
        break;
      case DownloadStatus.Stopped:
      case DownloadStatus.Pending:
        items.push({ key: "start", label: "继续下载", icon: MI.start });
        break;
      case DownloadStatus.Failed:
        items.push({ key: "start", label: "重试", icon: MI.start });
        break;
      case DownloadStatus.Ready:
        items.push({ key: "start", label: "开始下载", icon: MI.start });
        break;
      case DownloadStatus.Success:
        if (isMediaVideoTask(task)) {
          items.push({ key: "play-media", label: "播放", icon: MI.play });
        }
        // 磁力/文件任务没有播放页：产物回拉走 /files/:id 附件端点
        // （下载中心 UI 的媒体任务列表带 exists 字段，文件在盘才给入口）
        if ((task as DownloadTaskWithFile).exists) {
          items.push({ key: "download-local", label: "下载到本地", icon: MI.local });
        }
        break;
    }
    items.push({
      key: "copy-link",
      icon: MI.copy,
      label: /^magnet:/i.test(task.url) ? "复制磁力链接" : "复制链接",
    });
    // FluxDown 控制台右键能力面：引擎任务的 优先下载(插队)/重命名/挪队列
    const engineTaskId = (task as { engineTaskId?: string | null })
      .engineTaskId;
    if (engineTaskId) {
      if (
        task.status === DownloadStatus.Downloading ||
        task.status === DownloadStatus.Pending
      ) {
        items.push({ key: "boost", label: "优先下载", icon: MI.boost });
      }
      items.push({ key: "rename", label: "重命名", icon: MI.rename });
      items.push({ key: "move-queue", label: "移动到队列…", icon: MI.queue });
    }
    items.push({ key: "log", label: "查看日志", icon: MI.log });
    items.push({ key: "delete", label: "删除…", danger: true, icon: MI.del });
    return items;
  };

  const taskAction = useMemoizedFn(
    async (key: string, task: DownloadTask) => {
      // 音乐行动作（music 元数据由 use-tasks 并入行时携带）
      const musicMeta = (task as { music?: MusicRowMeta }).music;
      if (musicMeta) {
        switch (key) {
          case "task-detail":
            // 音乐行「详情」必须在音乐分支内分发：music 分支结束即 return，
            // 不落到外层 switch（此前发生 music 行点详情无响应）
            deps.onShowDetail?.(task);
            break;
          case "music-play": {
            // 下载中心播放契约：mei-music-guest play-now（外壳引擎临时队列，MusicDock 常驻）
            const song = {
              id: `file:${musicMeta.path}`,
              name: musicMeta.song.name,
              artist: musicMeta.song.artist || "",
              source: "server-local",
            };
            if (!music.sendMusicGuest({ type: "play-now", song })) {
              window.location.assign("/music");
            }
            break;
          }
          case "music-download-local": {
            // serve 流（同源绝对地址）触发浏览器下载
            window.location.href = musicServeUrl(musicMeta.path);
            break;
          }
          case "music-copy": {
            // 「复制链接」恒为源链接（用户契约）：音源站歌曲页地址，不再用
            // 服务器本地流直链冒充；源页构造不出来时兜底复制落盘路径并如实
            // 提示（下载完成历史文件由曲库服务源回填补齐 song.id）
            const songPage = songPageUrlOf(musicMeta.song);
            const ok = await copyText(songPage || musicMeta.path || "");
            if (ok)
              message.success(
                songPage ? "已复制源链接" : "已复制路径（未找到源链接）",
              );
            else message.error("复制失败");
            break;
          }
          case "music-delete": {
            const isFile = musicMeta.kind === "file";
            const choice = await deps.confirmDelete({
              unfinished: isFile ? 0 : 1,
              done: isFile ? 1 : 0,
              label: isFile
                ? `音乐文件「${task.name}」`
                : `下载任务「${task.name}」`,
            });
            if (choice === null) break;
            try {
              if (isFile) {
                await deleteMusicFile(musicMeta.path);
              } else {
                await fetch(
                  `/music/api/download/server?id=${encodeURIComponent(musicMeta.taskId ?? "")}`,
                  { method: "DELETE", credentials: "include" },
                );
              }
              message.success(isFile ? "已删除文件" : "已取消任务");
              deps.refresh();
            } catch (e) {
              message.error((e as Error)?.message || "操作失败");
            }
            break;
          }
        }
        return;
      }
      switch (key) {
        case "task-detail":
          // 详情侧栏（失败原因等人话化信息；原始日志仅作为入口）
          deps.onShowDetail?.(task);
          break;
        case "play-media": {
          if (!isMediaVideoTask(task)) break;
          try {
            const videos = await listMediaVideos();
            const video = matchMediaVideo(videos, task.name);
            if (video) {
              deps.inlinePlayer.play(mediaVideoTarget(video));
            } else {
              message.info("未找到该任务对应的可播放视频");
            }
          } catch {
            message.error("获取视频信息失败");
          }
          break;
        }
        case "start":
          try {
            await startDownload(task.id);
            message.success(
              task.status === DownloadStatus.Failed ? "已重试" : "已开始下载",
            );
            deps.refresh();
          } catch {
            message.error("操作失败");
          }
          break;
        case "pause":
          try {
            await stopDownload(task.id);
            message.success("已暂停");
            deps.refresh();
          } catch {
            message.error("操作失败");
          }
          break;
        case "copy-link": {
          // 对齐迅雷「复制下载地址 / 复制磁力链接」
          const ok = await copyText(task.url || "");
          if (ok) message.success(/^magnet:/i.test(task.url) ? "已复制磁力链接" : "已复制下载链接");
          else message.error("复制失败，请手动选择链接");
          break;
        }
        case "boost":
          try {
            const res = await fetch(`/api/downloads/${task.id}/boost`, {
              method: "POST",
              credentials: "include",
            });
            const p = (await res.json().catch(() => null)) as {
              success?: boolean;
              message?: string;
            } | null;
            if (!res.ok || !p?.success) {
              throw new Error(p?.message || `HTTP ${res.status}`);
            }
            message.success("已插队（本队列内优先调度）");
            deps.refresh();
          } catch (e) {
            message.error((e as Error).message || "操作失败");
          }
          break;
        case "rename":
          setRenameTaskTarget(task);
          setRenameTaskValue(task.name);
          break;
        case "move-queue":
          setQueueMoveTargets([task]);
          setQueueMoveValue(null);
          try {
            const res = await fetch("/api/downloads/engine-queues", {
              credentials: "include",
            });
            const p = (await res.json().catch(() => null)) as {
              data?: Array<{ queueId: string; name: string }>;
            } | null;
            setQueueList(p?.data ?? []);
          } catch {
            setQueueList([]);
          }
          break;
        case "log":
          setLogTarget({ id: task.id, name: task.name });
          break;
        case "download-local":
          // 附件端点：appFileUrl 构造绝对路径（门户 /downloads 前缀 / 独立根路径），
          // attachment 响应触发浏览器下载
          window.location.href = appFileUrl(`files/${task.id}`);
          break;
        case "delete": {
          const unfinished =
            task.status !== DownloadStatus.Success ? 1 : 0;
          const choice = await deps.confirmDelete({
            unfinished,
            done: 1 - unfinished,
            label: `任务「${task.name}」`,
          });
          if (choice === null) break;
          try {
            await deleteMediaTask(task.id, choice);
            message.success("已删除");
          } catch {
            message.error("删除失败");
          }
          deps.refresh();
          break;
        }
      }
    },
  );

  /** DownloadList web 右键入口（含列表特有项：多选/编辑/开始/刷新） */
  const openTaskMenu = useMemoizedFn(
    (e: React.MouseEvent, task: DownloadTask, extra: ContextMenuItem[] = []) => {
      const items = [...extra, ...buildTaskMenu(task)];
      items.push({ key: "sep-2", label: "", separator: true });
      items.push({ key: "refresh", label: "刷新列表", icon: MI.refresh });
      openMenu(e, items, (key) => {
        if (key === "refresh") {
          deps.refresh();
          return;
        }
        if (key.startsWith("dl-")) {
          const raw = key.slice(3);
          if (raw === "edit") deps.onEditTask?.(task);
          else if (raw === "select") deps.onSelectTask?.(task.id);
          return;
        }
        void taskAction(key, task);
      });
    },
  );

  // ---- 多选批量菜单（迅雷语义，2026-10-14）----
  // 交集过滤：仅当「全部选中行」都能执行某动作时才展示该项——菜单里出现的
  // 一定可整体执行，不存在因选中类型混排（音乐行/媒体任务/引擎任务）导致
  // 点了报错或半数失效的情况。暂停/继续按可作用行的并集执行（引擎行走
  // engine-batch 一次调用，其余逐条 stop/start）。

  /** 从 fetch Response（{success,message} 信封）解析失败原因 */
  const readEnvelope = async (res: Response): Promise<void> => {
    const p = (await res.json().catch(() => null)) as {
      success?: boolean;
      message?: string;
    } | null;
    if (!res.ok || !p?.success) {
      throw new Error(p?.message || `HTTP ${res.status}`);
    }
  };

  const buildTaskBatchMenu = (tasks: DownloadTask[]): ContextMenuItem[] => {
    const musicOf = (t: DownloadTask): boolean =>
      Boolean((t as { music?: MusicRowMeta }).music);
    const engineOf = (t: DownloadTask): boolean =>
      Boolean((t as { engineTaskId?: string | null }).engineTaskId);
    const canPause = (t: DownloadTask): boolean =>
      !musicOf(t) &&
      (t.status === DownloadStatus.Downloading ||
        t.status === DownloadStatus.Pending);
    const canStart = (t: DownloadTask): boolean =>
      !musicOf(t) &&
      (t.status === DownloadStatus.Stopped ||
        t.status === DownloadStatus.Pending ||
        t.status === DownloadStatus.Failed ||
        t.status === DownloadStatus.Ready);
    const allPause = tasks.every(canPause);
    const allStart = tasks.every(canStart);
    const allEngine = tasks.every(engineOf);
    const allLink = tasks.every((t) => Boolean(t.url));
    const items: ContextMenuItem[] = [
      {
        key: "batch-info",
        label: `已选 ${tasks.length} 项`,
        disabled: true,
      },
    ];
    if (allPause) items.push({ key: "batch-pause", label: "暂停所选", icon: MI.pause });
    if (allStart) items.push({ key: "batch-start", label: tasks.some((t) => t.status === DownloadStatus.Failed) ? "重试所选" : "开始所选", icon: MI.start });
    if (allLink) items.push({ key: "batch-copy", label: "复制链接（逐行拼接）", icon: MI.copy });
    if (allEngine && tasks.every(canPause))
      items.push({ key: "batch-boost", label: "优先下载", icon: MI.boost });
    if (allEngine)
      items.push({ key: "batch-move-queue", label: "移动到队列…", icon: MI.queue });
    items.push({ key: "sep-batch", label: "", separator: true });
    items.push({ key: "batch-delete", label: "删除…", danger: true, icon: MI.del });
    items.push({ key: "sep-2", label: "", separator: true });
    items.push({ key: "refresh", label: "刷新列表", icon: MI.refresh });
    return items;
  };

  const taskBatchAction = useMemoizedFn(
    async (key: string, tasks: DownloadTask[]) => {
      const engineIds = tasks
        .filter((t) => Boolean((t as { engineTaskId?: string | null }).engineTaskId))
        .map((t) => t.id);
      const plainIds = tasks
        .filter((t) => Boolean((t as { music?: MusicRowMeta }).music) === false)
        .map((t) => t.id)
        .filter((id) => !engineIds.includes(id));
      const refreshSoon = () => setTimeout(() => deps.refresh(), 400);
      switch (key) {
        case "batch-pause": {
          // 引擎行一次批量端点，其余逐条 stop
          const [engine, ...rest] = await Promise.allSettled([
            engineIds.length > 0
              ? fetch("/api/downloads/engine-batch", {
                  method: "POST",
                  credentials: "include",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "pause", ids: engineIds }),
                })
              : Promise.resolve(null),
            ...plainIds.map((id) => stopDownload(id)),
          ]);
          void engine;
          const failed = rest.filter((r) => r.status === "rejected").length;
          if (failed > 0) message.error(`暂停失败 ${failed} 项`);
          else message.success(`已暂停 ${tasks.length} 项`);
          refreshSoon();
          break;
        }
        case "batch-start": {
          const [engine, ...rest] = await Promise.allSettled([
            engineIds.length > 0
              ? fetch("/api/downloads/engine-batch", {
                  method: "POST",
                  credentials: "include",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "resume", ids: engineIds }),
                })
              : Promise.resolve(null),
            ...plainIds.map((id) => startDownload(id)),
          ]);
          void engine;
          const failed = rest.filter((r) => r.status === "rejected").length;
          if (failed > 0) message.error(`开始失败 ${failed} 项`);
          else message.success(`已开始 ${tasks.length} 项`);
          refreshSoon();
          break;
        }
        case "batch-copy": {
          const text = tasks
            .map((t) => {
              const musicMeta = (t as { music?: MusicRowMeta }).music;
              if (musicMeta) {
                // 音乐行=源站歌曲页地址（源链接口径）；源页构造不出来时用
                // 落盘路径顶格（不让本地流直链混进「复制链接」）
                return (
                  (musicMeta.song && songPageUrlOf(musicMeta.song)) ||
                  musicMeta.path
                );
              }
              return t.url ?? "";
            })
            .filter(Boolean)
            .join("\n");
          const ok = await copyText(text);
          if (ok) message.success(`已复制 ${tasks.length} 条链接`);
          else message.error("复制失败，请手动选择链接");
          break;
        }
        case "batch-boost": {
          const results = await Promise.allSettled(
            tasks.map((t) =>
              fetch(`/api/downloads/${t.id}/boost`, {
                method: "POST",
                credentials: "include",
              }),
            ),
          );
          const failed = results.filter((r) => r.status === "rejected").length;
          if (failed > 0) message.error(`插队失败 ${failed} 项`);
          else message.success("已全部插队（各自队列内优先调度）");
          refreshSoon();
          break;
        }
        case "batch-move-queue":
          setQueueMoveTargets(tasks);
          setQueueMoveValue(null);
          try {
            const res = await fetch("/api/downloads/engine-queues", {
              credentials: "include",
            });
            const p = (await res.json().catch(() => null)) as {
              data?: Array<{ queueId: string; name: string }>;
            } | null;
            setQueueList(p?.data ?? []);
          } catch {
            setQueueList([]);
          }
          break;
        case "batch-delete":
          await deps.onDeleteBatch?.(tasks);
          break;
      }
    },
  );

  /** 多选右键入口：右键命中已选成员（且选中 >1）时展示批量菜单 */
  const openTaskBatchMenu = useMemoizedFn(
    (e: React.MouseEvent, tasks: DownloadTask[]) => {
      const items = buildTaskBatchMenu(tasks);
      openMenu(e, items, (key) => {
        if (key === "refresh") {
          deps.refresh();
          return;
        }
        void taskBatchAction(key, tasks);
      });
    },
  );

  // ---- 影视记录 ----

  // 修改信息弹层状态（影视记录重命名；tv 记录 + media 任务双侧同步）
  const [renameTarget, setRenameTarget] = useState<MovieSourceRecord | null>(
    null,
  );
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);

  /** 影视记录 → media 任务视图（生命周期动作复用 taskAction 的迅雷语义） */
  const movieTaskFromRecord = (record: MovieSourceRecord): DownloadTask => {
    const statusMap: Record<
      MovieSourceRecord["status"],
      DownloadStatus
    > = {
      pending: DownloadStatus.Pending,
      downloading: DownloadStatus.Downloading,
      paused: DownloadStatus.Stopped,
      done: DownloadStatus.Success,
      failed: DownloadStatus.Failed,
    };
    return {
      id: Number(record.mediaTaskId),
      name: record.name,
      status: statusMap[record.status],
      type: "mediago",
    } as unknown as DownloadTask;
  };

  const movieAction = useMemoizedFn(async (key: string, record: MovieSourceRecord) => {
    switch (key) {
      case "play-movie": {
        if (record.playRoute) {
          playMovieRecord(record);
          break;
        }
        const target = movieFallbackVideo(record);
        if (target) deps.inlinePlayer.play(target);
        else message.info("该记录没有可播放的文件");
        break;
      }
      case "edit-movie": {
        // 修改信息（对齐迅雷）：重命名集名；tv 记录与 media 任务双侧同步
        setRenameTarget(record);
        setRenameValue(record.name);
        break;
      }
      case "copy-link": {
        // 复制原始下载链接（对齐迅雷）：列表不随行携带 url，按需拉一次
        const url = await getMediaTaskUrl(record.mediaTaskId);
        if (!url) {
          message.info("该记录没有原始链接（任务可能已被删除）");
          break;
        }
        const ok = await copyText(url);
        if (ok) message.success(/^magnet:/i.test(url) ? "已复制磁力链接" : "已复制下载链接");
        else message.error("复制失败，请手动选择链接");
        break;
      }
      case "del-movie": {
        // 统一删除契约（useDeleteTasks 三选一）：未完成必然级联停止下载并
        // 清理临时文件；已完成由用户选择是否连文件删除
        const unfinished = record.status !== "done" ? 1 : 0;
        const choice = await deps.confirmDelete({
          unfinished,
          done: 1 - unfinished,
          label: `《${record.title}》${record.name}`,
        });
        if (choice === null) break; // 取消
        try {
          await deleteMovieSource(record.key, choice);
          message.success("已删除");
        } catch (e) {
          message.error((e as Error).message || "删除失败");
        }
        deps.refresh();
        break;
      }
      // 生命周期/日志/下载到本地：与下载任务同语义，复用 taskAction
      default:
        await taskAction(key, movieTaskFromRecord(record));
        break;
    }
  });

  const openMovieMenu = useMemoizedFn(
    (e: React.MouseEvent, record: MovieSourceRecord) => {
      const playable = !!record.playRoute || !!movieFallbackVideo(record);
      const items: ContextMenuItem[] = [];
      // 生命周期语义对齐迅雷：暂停 / 继续 / 重试 / 播放 / 下载到本地
      switch (record.status) {
        case "downloading":
          items.push({ key: "pause", label: "暂停下载", icon: MI.pause });
          break;
        case "pending":
        case "paused":
          items.push({ key: "start", label: "继续下载", icon: MI.start });
          break;
        case "failed":
          items.push({ key: "start", label: "重试", icon: MI.start });
          break;
        case "done":
          items.push({ key: "play-movie", icon: MI.play, label: "立即播放", disabled: !playable });
          if (record.localUrl) {
            items.push({ key: "download-local", label: "下载到本地", icon: MI.local });
          }
          break;
      }
      items.push({ key: "copy-link", label: "复制链接", icon: MI.copy });
      items.push({ key: "edit-movie", label: "修改信息…", icon: MI.edit });
      if (record.status !== "done") {
        items.push({ key: "log", label: "查看日志", icon: MI.log });
      }
      items.push({ key: "del-movie", label: "删除…", danger: true, icon: MI.del });
      items.push({ key: "sep-2", label: "", separator: true });
      items.push({ key: "refresh", label: "刷新列表", icon: MI.refresh });
      openMenu(e, items, (key) => {
        if (key === "refresh") {
          deps.refresh();
          return;
        }
        void movieAction(key, record);
      });
    },
  );

  /** 多选右键（影视）：交集过滤——全部可暂停才出现暂停，全部可继续才出现继续 */
  const openMovieBatchMenu = useMemoizedFn(
    (e: React.MouseEvent, records: MovieSourceRecord[]) => {
      const canPause = (r: MovieSourceRecord): boolean =>
        r.status === "downloading" && Boolean(r.mediaTaskId);
      const canStart = (r: MovieSourceRecord): boolean =>
        (r.status === "paused" || r.status === "pending" || r.status === "failed") &&
        Boolean(r.mediaTaskId);
      const items: ContextMenuItem[] = [
        { key: "batch-info", label: `已选 ${records.length} 项`, disabled: true },
      ];
      if (records.every(canPause))
        items.push({ key: "batch-m-pause", label: "暂停所选", icon: MI.pause });
      if (records.every(canStart))
        items.push({
          key: "batch-m-start",
          label: records.some((r) => r.status === "failed") ? "重试所选" : "继续所选",
          icon: MI.start,
        });
      if (records.every((r) => Boolean(r.mediaTaskId)))
        items.push({ key: "batch-m-copy", label: "复制链接（逐行拼接）", icon: MI.copy });
      items.push({ key: "sep-batch", label: "", separator: true });
      items.push({ key: "batch-m-delete", label: "删除…", danger: true, icon: MI.del });
      items.push({ key: "sep-2", label: "", separator: true });
      items.push({ key: "refresh", label: "刷新列表", icon: MI.refresh });
      openMenu(e, items, (key) => {
        if (key === "refresh") {
          deps.refresh();
          return;
        }
        void (async () => {
          switch (key) {
            case "batch-m-pause":
            case "batch-m-start": {
              const results = await Promise.allSettled(
                records.map((r) =>
                  key === "batch-m-pause"
                    ? stopDownload(Number(r.mediaTaskId))
                    : startDownload(Number(r.mediaTaskId)),
                ),
              );
              const failed = results.filter((r) => r.status === "rejected").length;
              if (failed > 0) message.error(`操作失败 ${failed} 项`);
              else message.success(key === "batch-m-pause" ? "已暂停" : "已继续下载");
              deps.refresh();
              break;
            }
            case "batch-m-copy": {
              const lines = await Promise.allSettled(
                records.map((r) => getMediaTaskUrl(r.mediaTaskId)),
              );
              const text = lines
                .filter(
                  (r): r is PromiseFulfilledResult<string> =>
                    r.status === "fulfilled" && Boolean(r.value),
                )
                .map((r) => r.value)
                .join("\n");
              const ok = text ? await copyText(text) : false;
              if (ok) message.success(`已复制 ${records.length} 条链接`);
              else message.info("所选记录没有可复制的原始链接");
              break;
            }
            case "batch-m-delete": {
              const unfinished = records.filter((r) => r.status !== "done").length;
              const choice = await deps.confirmDelete({
                unfinished,
                done: records.length - unfinished,
                label: `${records.length} 条影视记录`,
              });
              if (choice === null) return;
              const results = await Promise.allSettled(
                records.map((r) => deleteMovieSource(r.key, choice)),
              );
              const failed = results.filter((r) => r.status === "rejected").length;
              if (failed > 0) message.error(`删除失败 ${failed} 项`);
              else message.success("已删除");
              deps.refresh();
              break;
            }
          }
        })();
      });
    },
  );

  const renameModal = (
    <Modal
      title="修改信息"
      open={renameTarget !== null}
      onCancel={() => setRenameTarget(null)}
      okText="保存"
      cancelText="取消"
      confirmLoading={renaming}
      okButtonProps={{ disabled: renameValue.trim() === "" }}
      width={460}
      destroyOnClose
      onOk={async () => {
        const target = renameTarget;
        const name = renameValue.trim();
        if (!target || name === "") {
          message.warning("名称不能为空");
          return;
        }
        setRenaming(true);
        try {
          await renameMovieSource(target.key, name);
          message.success("已修改");
          setRenameTarget(null);
          deps.refresh();
        } catch (err) {
          message.error((err as Error).message || "修改失败");
        } finally {
          setRenaming(false);
        }
      }}
    >
      <div className="flex flex-col gap-3 py-2">
        <div className="text-xs text-black/45 dark:text-white/45">
          修改名称仅变更显示名，不影响已落盘文件。
        </div>
        <Input
          value={renameValue}
          autoFocus
          maxLength={200}
          placeholder="输入新的名称"
          onChange={(e) => setRenameValue(e.target.value)}
          onPressEnter={async () => {
            if (renameValue.trim() === "" || renaming || !renameTarget) return;
            const target = renameTarget;
            setRenaming(true);
            try {
              await renameMovieSource(target.key, renameValue.trim());
              message.success("已修改");
              setRenameTarget(null);
              deps.refresh();
            } catch (err) {
              message.error((err as Error).message || "修改失败");
            } finally {
              setRenaming(false);
            }
          }}
        />
      </div>
    </Modal>
  );

  // ---- 音乐文件 ----

  const musicFileAction = useMemoizedFn(async (key: string, file: MusicFileLike) => {
    switch (key) {
      case "play-music":
        playMusicFile({
          path: file.path,
          name: file.name,
          fileName: "",
          artist: file.artist,
          size: 0,
          mtime: "",
        });
        break;
      case "fav-music": {
        const song = music.musicFileSong(file);
        if (music.sendMusicGuest({ type: "toggle-favorite", song })) {
          // 外壳引擎对 toggle-favorite 无 ack 协议，只能确认「已发送」，
          // 不断言收藏结果（实际结果以 MusicDock 面板为准）
          message.success("已发送到门户音乐引擎");
        }
        break;
      }
      case "copy-music-page": {
        // 「复制链接」恒为源链接（用户契约）：音源站歌曲页地址；构造不出来
        // 时（历史文件源回填也命不中）兜底复制落盘路径并如实提示，不再用
        // 本地流直链冒充
        const page = songPageUrlOf({ id: file.songId ?? file.id, source: file.songSource || file.source });
        const ok = await copyText(page || file.path);
        if (ok)
          message.success(page ? "已复制源链接" : "已复制路径（未找到源链接）");
        else message.error("复制失败");
        break;
      }
      case "copy-music-url": {
        // 复制本地流直链（对齐迅雷「复制下载地址」）：可粘给其它播放器
        const ok = await copyText(musicServeUrl(file.path));
        if (ok) message.success("已复制播放链接");
        else message.error("复制失败");
        break;
      }
      case "del-music-file": {
        modal.confirm({
          title: `删除音乐文件「${file.name}」？`,
          content: "将从服务器删除该音频文件，不可恢复。",
          okText: "删除",
          okButtonProps: { danger: true },
          onOk: async () => {
            try {
              await deleteMusicFile(file.path);
              message.success(`已删除 ${file.name}`);
            } catch {
              message.error("删除失败");
            }
            deps.refresh();
          },
        });
        break;
      }
      default:
        if (key.startsWith("add-pl-")) {
          await music.addToPlaylist(key.slice("add-pl-".length), file);
          void music.mutateMusicState();
        }
        break;
    }
  });

  const openMusicFileMenu = useMemoizedFn(
    (e: React.MouseEvent, file: MusicFileLike) => {
      // 「复制链接」恒在场且恒为源链接（用户契约；下载完成时曲库服务已把
      // song.id 落进源索引，历史文件由源回填补齐）：源页构造不出来时点击
      // 兜底复制落盘路径并如实提示；「复制播放链接」独立在场不受影响
      const items: ContextMenuItem[] = [
        { key: "play-music", label: "播放", icon: MI.play },
        { key: "fav-music", label: "收藏", icon: MI.fav },
        { key: "copy-music-page", label: "复制链接", icon: MI.copy },
        { key: "copy-music-url", label: "复制播放链接", icon: MI.copy },
      ];
      const playlists = music.musicState?.playlists ?? [];
      // 加入播放列表收进二级菜单（用户契约：平铺每个列表会把右键菜单撑得
      // 过长）；无列表时子项给禁用态空提示，子项仍走 add-pl- 同一动作分支
      items.push({
        key: "add-pl",
        label: "加入播放列表",
        icon: MI.addPl,
        children:
          playlists.length > 0
            ? playlists.map((pl) => ({ key: `add-pl-${pl.id}`, label: pl.name }))
            : [{ key: "no-pl", label: "暂无播放列表", disabled: true }],
      });
      items.push({ key: "sep-1", label: "", separator: true });
      items.push({ key: "del-music-file", label: "删除文件", danger: true, icon: MI.del });
      items.push({ key: "sep-2", label: "", separator: true });
      items.push({ key: "refresh", label: "刷新列表", icon: MI.refresh });
      openMenu(e, items, (key) => {
        if (key === "refresh") {
          deps.refresh();
          return;
        }
        void musicFileAction(key, file);
      });
    },
  );

  /** 音乐行操作区「加入播放列表」按钮入口（非右键）：弹一级播放列表选择
   *  浮层，动作复用 musicFileAction 的 add-pl- 分支（与右键菜单同一实现） */
  const openMusicPlaylistMenu = useMemoizedFn(
    (e: React.MouseEvent, file: MusicFileLike) => {
      const playlists = music.musicState?.playlists ?? [];
      openMenu(
        e,
        playlists.length > 0
          ? playlists.map((pl) => ({ key: `add-pl-${pl.id}`, label: pl.name }))
          : [{ key: "no-pl", label: "暂无播放列表", disabled: true }],
        (key) => {
          if (key === "refresh") {
            deps.refresh();
            return;
          }
          void musicFileAction(key, file);
        },
      );
    },
  );

  // ---- 音乐任务（下载中）----

  const musicTaskAction = useMemoizedFn(
    async (key: string, taskId: string | number) => {
      if (key !== "cancel-music") return;
      try {
        await deleteMusicTask(taskId);
        message.success("已取消");
      } catch {
        message.error("操作失败");
      }
      deps.refresh();
    },
  );

  const openMusicTaskMenu = useMemoizedFn(
    // name 参数保留调用方签名（音乐 tab 传歌名占位），菜单本身未用到
    (e: React.MouseEvent, taskId: string | number, _name: string) => {
      const items: ContextMenuItem[] = [
        { key: "cancel-music", label: "取消下载", icon: MI.cancel },
        { key: "sep-2", label: "", separator: true },
        { key: "refresh", label: "刷新列表" },
      ];
      openMenu(e, items, (key) => {
        if (key === "refresh") {
          deps.refresh();
          return;
        }
        void musicTaskAction(key, taskId);
      });
    },
  );

  // ---- 音乐批量（多选右键）----

  /** 音乐任务（进行中/失败）批量：全部可取消才出现入口 */
  const openMusicTaskBatchMenu = useMemoizedFn(
    (
      e: React.MouseEvent,
      tasks: Array<{
        id: string | number;
        song?: { name?: string; artist?: string; source?: string };
      }>,
    ) => {
      const items: ContextMenuItem[] = [
        { key: "batch-info", label: `已选 ${tasks.length} 项`, disabled: true },
        { key: "batch-mt-cancel", label: "取消所选任务", icon: MI.cancel, danger: true },
        { key: "sep-2", label: "", separator: true },
        { key: "refresh", label: "刷新列表", icon: MI.refresh },
      ];
      openMenu(e, items, (key) => {
        if (key === "refresh") {
          deps.refresh();
          return;
        }
        if (key === "batch-mt-cancel") {
          void (async () => {
            const results = await Promise.allSettled(
              tasks.map((t) => deleteMusicTask(t.id)),
            );
            const failed = results.filter((r) => r.status === "rejected").length;
            if (failed > 0) message.error(`取消失败 ${failed} 项`);
            else message.success("已取消所选任务");
            deps.refresh();
          })();
        }
      });
    },
  );

  /** 音乐文件批量：收藏 / 加入播放列表（二级菜单）/ 复制播放链接 / 删除 */
  const openMusicFileBatchMenu = useMemoizedFn(
    (e: React.MouseEvent, files: MusicFileLike[]) => {
      const playlists = music.musicState?.playlists ?? [];
      const items: ContextMenuItem[] = [
        { key: "batch-info", label: `已选 ${files.length} 项`, disabled: true },
        { key: "batch-mf-fav", label: "收藏全部", icon: MI.fav },
        // 同单曲菜单：加入播放列表收进二级菜单，避免逐列表平铺
        {
          key: "batch-mf-pl",
          label: "加入播放列表",
          icon: MI.addPl,
          children:
            playlists.length > 0
              ? playlists.map((pl) => ({
                  key: `batch-mf-pl-${pl.id}`,
                  label: pl.name,
                }))
              : [{ key: "no-pl", label: "暂无播放列表", disabled: true }],
        },
      ];
      items.push(
        { key: "batch-mf-copy", label: "复制播放链接（逐行拼接）", icon: MI.copy },
        { key: "sep-1", label: "", separator: true },
        { key: "batch-mf-delete", label: "删除文件…", danger: true, icon: MI.del },
        { key: "sep-2", label: "", separator: true },
        { key: "refresh", label: "刷新列表", icon: MI.refresh },
      );
      openMenu(e, items, (action) => {
        if (action === "refresh") {
          deps.refresh();
          return;
        }
        void (async () => {
          switch (action) {
            case "batch-mf-fav": {
              for (const file of files) {
                music.sendMusicGuest({ type: "toggle-favorite", song: music.musicFileSong(file) });
              }
              message.success(`已发送 ${files.length} 首到门户音乐引擎收藏`);
              break;
            }
            case "batch-mf-copy": {
              const text = files.map((f) => musicServeUrl(f.path)).join("\n");
              const ok = await copyText(text);
              if (ok) message.success(`已复制 ${files.length} 条播放链接`);
              else message.error("复制失败");
              break;
            }
            case "batch-mf-delete": {
              modal.confirm({
                title: `删除 ${files.length} 个音乐文件？`,
                content: "将从服务器删除这些音频文件，不可恢复。",
                okText: "删除",
                okButtonProps: { danger: true },
                onOk: async () => {
                  const results = await Promise.allSettled(
                    files.map((f) => deleteMusicFile(f.path)),
                  );
                  const failed = results.filter((r) => r.status === "rejected").length;
                  if (failed > 0) message.error(`删除失败 ${failed} 项`);
                  else message.success("已删除");
                  deps.refresh();
                },
              });
              break;
            }
            default:
              if (action.startsWith("batch-mf-pl-")) {
                const pid = action.slice("batch-mf-pl-".length);
                const pl = playlists.find((p) => p.id === pid);
                let ok = 0;
                for (const file of files) {
                  if (await music.addToPlaylist(pid, file)) ok += 1;
                }
                if (ok > 0) void music.mutateMusicState();
                if (ok < files.length) message.warning(`仅 ${ok} 首成功加入${pl ? `「${pl.name}」` : ""}`);
              }
              break;
          }
        })();
      });
    },
  );

  return {
    menu,
    logModal,
    /** 任务列表弹层合集（日志 + 任务重命名 + 挪队列）——任务列表消费者挂这个 */
    taskOverlays,
    renameModal,
    music,
    taskAction,
    movieAction,
    musicFileAction,
    musicTaskAction,
    openTaskMenu,
    openMovieMenu,
    openMusicFileMenu,
    /** 行操作区「加入播放列表」按钮入口（弹一级列表选择，动作同右键菜单） */
    openMusicPlaylistMenu,
    openMusicTaskMenu,
    /** 多选批量右键入口（迅雷语义，交集过滤） */
    openTaskBatchMenu,
    openMovieBatchMenu,
    openMusicFileBatchMenu,
    openMusicTaskBatchMenu,
  };
}

export type ContentMenuApi = ReturnType<typeof useContentMenu>;
