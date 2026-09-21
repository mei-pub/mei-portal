// 下载中心内容级右键菜单共享模块 —— 全部 tab 与各分类 tab 统一能力底座：
//   下载任务（media/file/bt）：取消 / 开始 / 播放（视频类 Success）/ 日志 / 删除
//   影视记录：立即播放（playRoute 深链 / 内嵌弹层兜底）/ 删除含文件
//   音乐文件：播放 / 收藏 / 加入播放列表（动态平铺）/ 删除文件
//   音乐任务：取消（删除任务并清理临时文件）
// 分类 tab 在此之上叠加个性化项（编辑/开始下载/加入多选等），不得少于全部 tab。
// 加入播放列表走实时 GET + revision PUT（409 重试）+ replace-data 同步外壳引擎。
import { App, Modal } from "antd";
import { DownloadStatus } from "@mediago/shared-common";
import type { DownloadTask } from "@mediago/shared-common";
import { useMemoizedFn } from "ahooks";
import { type FC, type ReactNode, useState } from "react";
import useSWR from "swr";
import Terminal from "@/components/download-terminal";
import type { ContextMenuItem } from "@/components/web-context-menu";
import { useWebContextMenu } from "@/components/web-context-menu";
export type { ContextMenuItem };
import {
  deleteMediaTask,
  deleteMovieSource,
  deleteMusicFile,
  deleteMusicTask,
  listMediaVideos,
  type MovieSourceRecord,
} from "@/api/download-center";
import { startDownload, stopDownload } from "@/api/download-task";
import {
  matchMediaVideo,
  mediaVideoTarget,
  movieFallbackVideo,
  playMovieRecord,
  playMusicFile,
} from "@/utils/play-actions";
import type { InlinePlayerApi } from "./inline-player";
import type { DeleteConfirmOptions } from "@/components/delete-tasks-dialog";

// ============================================================
// 音乐 guest 协议（与门户外壳 MusicDock 引擎协作）
// ============================================================

/** 音乐文件最小载荷（各面板的原生行数据归一化到这三个字段） */
export interface MusicFileLike {
  path: string;
  name: string;
  artist: string;
}

interface MusicStateLite {
  revision: number;
  playlists: Array<{ id: string; name: string; songs: Array<{ id: string }> }>;
  favorites: Array<{ id: string }>;
  temp: Array<{ id: string }>;
  selectedPlaylistId: string;
}

const MUSIC_STATE_SWR_KEY = "download-center/music-state";

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
      const r = await fetch("/api/music/state");
      if (!r.ok) return null;
      return (await r.json()) as { loggedIn: boolean; state: MusicStateLite };
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
}

/** 任务是否为视频类（m3u8/bilibili/mediago/youtube 等，可匹配 /api/v1/videos 播放） */
export const isMediaVideoTask = (task: DownloadTask): boolean =>
  task.type !== "direct" && task.type !== "bt";

export function useContentMenu(deps: ContentMenuDeps) {
  const { message, modal } = App.useApp();
  const { menu, openMenu } = useWebContextMenu();
  const music = useMusicGuest();
  const [logTarget, setLogTarget] = useState<TaskLogTarget | null>(null);
  const logModal = (
    <TaskLogModal target={logTarget} onClose={() => setLogTarget(null)} />
  );

  // ---- 下载任务（media / file / bt）----

  const buildTaskMenu = (task: DownloadTask): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];
    if (task.status === DownloadStatus.Downloading) {
      items.push({ key: "cancel", label: "取消下载" });
    } else if (
      task.status === DownloadStatus.Stopped ||
      task.status === DownloadStatus.Pending
    ) {
      items.push({ key: "start", label: "开始下载" });
    }
    if (
      task.status === DownloadStatus.Success &&
      isMediaVideoTask(task)
    ) {
      items.push({ key: "play-media", label: "播放" });
    }
    items.push({ key: "log", label: "查看日志" });
    items.push({ key: "delete", label: "删除…", danger: true });
    return items;
  };

  const taskAction = useMemoizedFn(
    async (key: string, task: DownloadTask) => {
      switch (key) {
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
            message.success("已开始下载");
            deps.refresh();
          } catch {
            message.error("操作失败");
          }
          break;
        case "cancel":
          try {
            await stopDownload(task.id);
            message.success("已取消下载");
            deps.refresh();
          } catch {
            message.error("操作失败");
          }
          break;
        case "log":
          setLogTarget({ id: task.id, name: task.name });
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
      items.push({ key: "refresh", label: "刷新列表" });
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

  // ---- 影视记录 ----

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
      case "del-movie": {
        modal.confirm({
          title: `删除《${record.title}》${record.name} 的下载记录？`,
          content: "将同时删除已下载的视频文件。",
          okText: "删除",
          okButtonProps: { danger: true },
          onOk: async () => {
            try {
              await deleteMovieSource(record.key, true);
              message.success("已删除");
            } catch {
              message.error("删除失败");
            }
            deps.refresh();
          },
        });
        break;
      }
    }
  });

  const openMovieMenu = useMemoizedFn(
    (e: React.MouseEvent, record: MovieSourceRecord) => {
      const playable = !!record.playRoute || !!movieFallbackVideo(record);
      const items: ContextMenuItem[] = [];
      if (record.status === "done") {
        items.push({ key: "play-movie", label: "立即播放", disabled: !playable });
      }
      items.push({ key: "del-movie", label: "删除记录（含文件）", danger: true });
      items.push({ key: "sep-2", label: "", separator: true });
      items.push({ key: "refresh", label: "刷新列表" });
      openMenu(e, items, (key) => {
        if (key === "refresh") {
          deps.refresh();
          return;
        }
        void movieAction(key, record);
      });
    },
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
          message.success("已在门户音乐引擎中切换收藏");
        }
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
      const items: ContextMenuItem[] = [
        { key: "play-music", label: "播放" },
        { key: "fav-music", label: "收藏" },
      ];
      const playlists = music.musicState?.playlists ?? [];
      if (playlists.length > 0) {
        for (const pl of playlists) {
          items.push({ key: `add-pl-${pl.id}`, label: `加入「${pl.name}」` });
        }
      } else {
        items.push({ key: "no-pl", label: "暂无播放列表", disabled: true });
      }
      items.push({ key: "sep-1", label: "", separator: true });
      items.push({ key: "del-music-file", label: "删除文件", danger: true });
      items.push({ key: "sep-2", label: "", separator: true });
      items.push({ key: "refresh", label: "刷新列表" });
      openMenu(e, items, (key) => {
        if (key === "refresh") {
          deps.refresh();
          return;
        }
        void musicFileAction(key, file);
      });
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
    (e: React.MouseEvent, taskId: string | number, name: string) => {
      const items: ContextMenuItem[] = [
        { key: "cancel-music", label: "取消下载" },
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

  return {
    menu,
    logModal,
    music,
    taskAction,
    movieAction,
    musicFileAction,
    musicTaskAction,
    openTaskMenu,
    openMovieMenu,
    openMusicFileMenu,
    openMusicTaskMenu,
  };
}

export type ContentMenuApi = ReturnType<typeof useContentMenu>;
