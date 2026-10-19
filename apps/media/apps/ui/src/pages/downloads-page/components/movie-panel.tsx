// 影视下载面板 —— 数据源：/tv/api/local-sources/list（契约 1）
// 按剧名（title + year）分组；下载中显示进度条 + 速度（经 shared-poll 统一 3s 轮询，
// 无下载任务时不轮询）；done 显示分类/集数；failed 标红；删除走契约 2。
// 列表表格化（全局表头 + 剧名节行 + 集行）+ 迅雷式多选（Cmd/Ctrl 点选 / Shift
// 范围选 / 拖拽框选，跨分组生效）。
import { App, Button, Empty, Segmented } from "antd";
import {
  CaretRightOutlined,
  DeleteOutlined,
  DownloadOutlined,
  PauseCircleOutlined,
  PauseOutlined,
  PlayCircleOutlined,
  PlaySquareOutlined,
} from "@ant-design/icons";
import { useMemoizedFn } from "ahooks";
import { type FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import { DeleteIcon } from "@/assets/svg";
import { DownloadTag } from "@/components/download-tag";
import { IconButton } from "@/components/icon-button";
import Loading from "@/components/loading";
import { Checkbox } from "@/components/ui/checkbox";
import {
  appFileUrl,
  deleteMovieSource,
  getMediaTaskUrl,
  listMovieSources,
  type MovieSourceRecord,
} from "@/api/download-center";
import { movieFallbackVideo, playMovieRecord } from "@/utils/play-actions";
import { startDownload, stopDownload } from "@/api/download-task";
import { useInlinePlayer } from "./inline-player";
import { useContentMenu } from "./content-menu";
import { BulkBar, BulkButton, ListSearch, triState } from "./bulk-bar";
import { TaskDetailDrawer } from "./task-detail-drawer";
import { useDeleteTasks } from "@/components/delete-tasks-dialog";
import type { DownloadTaskDetails } from "@/hooks/use-tasks";
import { cn, fromatDateTime } from "@/utils";
import { useSharedPoll } from "./shared-poll";
import { useMarqueeSelect } from "./use-marquee-select";
import {
  HEADER_CLS,
  ROW_CLS,
  ROW_SELECTED_CLS,
  TABLE_CLS,
  TOOLBAR_CLS,
} from "./table-styles";
import { DownloadStatus } from "@mediago/shared-common";

interface Group {
  groupKey: string;
  title: string;
  year: string | number;
  records: MovieSourceRecord[];
}

const PANEL_ERROR_STYLE =
  "flex flex-1 flex-col items-center justify-center gap-3";

/** 状态页签（对齐任务队列 Segmented：全部/下载中/已暂停/已完成/失败） */
type MovieStatusKey = "all" | "downloading" | "paused" | "done" | "failed";
const MOVIE_STATUS_OPTIONS: Array<{ label: string; value: MovieStatusKey }> = [
  { label: "全部", value: "all" },
  { label: "下载中", value: "downloading" },
  { label: "已暂停", value: "paused" },
  { label: "已完成", value: "done" },
  { label: "失败", value: "failed" },
];

/** 状态软徽章（对齐任务视图状态列视觉） */
const MOVIE_CHIP: Record<MovieSourceRecord["status"], { text: string; cls: string }> = {
  downloading: {
    text: "下载中",
    cls: "bg-blue-500/10 text-blue-600 dark:bg-blue-400/10 dark:text-blue-400",
  },
  paused: {
    text: "已暂停",
    cls: "bg-orange-500/10 text-orange-600 dark:bg-orange-400/10 dark:text-orange-400",
  },
  done: {
    text: "已完成",
    cls: "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-400",
  },
  failed: {
    text: "失败",
    cls: "bg-rose-500/10 text-rose-600 dark:bg-rose-400/10 dark:text-rose-400",
  },
  pending: {
    text: "等待中",
    cls: "bg-gray-500/10 text-gray-500 dark:bg-white/10 dark:text-gray-400",
  },
};

const isDownloading = (record: MovieSourceRecord) =>
  record.status === "downloading";

/** 影视本地源状态 → DownloadStatus（统一详情抽屉状态口径，live 轮询自动接管） */
const MOVIE_TO_STATUS: Record<MovieSourceRecord["status"], DownloadStatus> = {
  pending: DownloadStatus.Pending,
  downloading: DownloadStatus.Downloading,
  paused: DownloadStatus.Stopped,
  done: DownloadStatus.Success,
  failed: DownloadStatus.Failed,
};

/** 记录时间毫秒化（tv 下发 epoch 秒/毫秒或已格式化串，兼容收口同 around） */
const recordEpoch = (v: string | number | null | undefined): number => {
  if (v == null || v === "") return Date.now();
  const raw = typeof v === "number" ? String(v) : String(v).trim();
  if (/^\d{10,13}$/.test(raw)) {
    const n = Number(raw);
    return n > 1e12 ? n : n * 1000;
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? Date.now() : parsed;
};

/** 记录时间兼容：tv 服务实际下发 epoch 毫秒数字（13 位）/秒（10 位）或已格式化
 *  串（类型声明写 string 但运行时是 number，曾致 e.trim 白屏）——统一收口转换 */
const fmtRecordTime = (v: string | number | null | undefined): string => {
  if (v == null || v === "") return "-";
  const raw = typeof v === "number" ? String(v) : v;
  if (/^\d{10,13}$/.test(raw.trim())) {
    const n = Number(raw.trim());
    return fromatDateTime(new Date(n > 1e12 ? n : n * 1000), "YYYY/MM/DD HH:mm");
  }
  return raw;
};

const MoviePanel: FC = () => {
  // 就地播放：无 playRoute 的旧记录弹层播 /videos/:id 直播流，关闭即回列表
  const inlinePlayer = useInlinePlayer();
  const { confirmDelete, deleteDialog } = useDeleteTasks();
  const { message } = App.useApp();
  // 内容级右键菜单（生命周期/修改信息/日志/立即播放/删除）——能力对齐全部 tab
  const { menu, logModal, renameModal, openMovieMenu, openMovieBatchMenu } =
    useContentMenu({
      refresh: useMemoizedFn(() => void mutate()),
      inlinePlayer,
      confirmDelete,
    });
  const { t } = useTranslation();
  const { data, error, isLoading, mutate } = useSWR(
    "download-center/movie",
    listMovieSources,
    { revalidateOnFocus: false },
  );

  const records = useMemo(() => data ?? [], [data]);

  // 多选批量（对标迅雷）：选中集合 + 状态页签 + 搜索过滤（对齐任务队列工具条）
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<MovieStatusKey>("all");

  const visibleRecords = useMemo(() => {
    const kw = searchText.trim().toLowerCase();
    return records.filter((r) => {
      // 状态页签沿用任务队列口径：pending/failed 也算可开始族——但影视面板
      // 的页签是严格状态过滤（下载中/已暂停/已完成/失败各自独立）
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!kw) return true;
      return (
        (r.title ?? "").toLowerCase().includes(kw) ||
        (r.name ?? "").toLowerCase().includes(kw)
      );
    });
  }, [records, searchText, statusFilter]);

  // 全部暂停/全部开始（对齐任务队列工具条）：作用于当前过滤后的可见记录——
  // 暂停=下载中，开始=可续族（paused/pending/failed），逐条调 media 任务 API
  const onPauseAll = useMemoizedFn(async () => {
    const targets = visibleRecords.filter(
      (r) => r.status === "downloading" && r.mediaTaskId,
    );
    if (targets.length === 0) {
      message.info("没有进行中的任务");
      return;
    }
    const results = await Promise.allSettled(
      targets.map((record) => stopDownload(Number(record.mediaTaskId))),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed === 0) message.success("已全部暂停");
    else message.warning(`${targets.length - failed} 项已暂停，${failed} 项失败`);
    mutate();
  });

  const onStartAll = useMemoizedFn(async () => {
    const targets = visibleRecords.filter(
      (r) =>
        (r.status === "paused" || r.status === "pending" || r.status === "failed") &&
        r.mediaTaskId,
    );
    if (targets.length === 0) {
      message.info("没有可开始的任务");
      return;
    }
    const results = await Promise.allSettled(
      targets.map((record) => startDownload(Number(record.mediaTaskId))),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed === 0) message.success("已全部开始");
    else message.warning(`${targets.length - failed} 项已开始，${failed} 项失败`);
    mutate();
  });

  // 批量删除：一次三选一确认 → 逐条删除
  const handleBulkDelete = useMemoizedFn(async () => {
    const targets = visibleRecords.filter((r) => selectedKeys.has(r.key));
    if (targets.length === 0) return;
    const unfinished = targets.filter((r) => r.status !== "done").length;
    const choice = await confirmDelete({
      unfinished,
      done: targets.length - unfinished,
      label: `${targets.length} 条影视记录`,
    });
    if (choice === null) return;
    const results = await Promise.allSettled(
      targets.map((record) => deleteMovieSource(record.key, choice)),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) message.error(`删除失败 ${failed} 项`);
    else message.success("已删除");
    setSelectedKeys(new Set());
    mutate();
  });

  const toggleSelect = useMemoizedFn((key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  });

  // 持续刷新条件：非 done 记录（pending/downloading/paused/failed）——
  // paused/failed 也要轮询：继续下载/重试后 tv 数据层把状态写回
  // downloading/done，列表只随 3s 轮询更新（Round 二十二 状态机对齐）
  const hasActive = useMemo(
    () => records.some((r) => r.status !== "done"),
    [records],
  );
  useSharedPoll(hasActive, mutate);

  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const record of visibleRecords) {
      const yearStr = record.year ? String(record.year) : "";
      const groupKey = `${record.title}__${yearStr}`;
      let group = map.get(groupKey);
      if (!group) {
        group = { groupKey, title: record.title, year: yearStr, records: [] };
        map.set(groupKey, group);
      }
      group.records.push(record);
    }
    return [...map.values()];
  }, [visibleRecords]);

  // 迅雷式多选接线：可见行的扁平有序 key（跨分组）——Shift 范围与框选都按它算
  const flatRowKeys = useMemo(
    () => groups.flatMap((g) => g.records.map((r) => r.key)),
    [groups],
  );
  // 无选中时平单击行 → 详情抽屉（对齐任务队列/音乐库统一 TaskDetailDrawer；
  // 有选中时单击=反选，hook 既定语义）
  // 影视记录 → 媒体任务行映射：id=mediaTaskId（抽屉按 /api/downloads/:id
  // 2s 轮询驱动实时状态，暂停/继续按钮状态即时翻转——对齐任务列表），
  // url=按需拉一次任务源链接（复制链接/链接展示用），exists=true（媒体
  // 任务落盘产物在影视根目录，避免抽屉误报「产物未找到」）。
  const [detailRecord, setDetailRecord] = useState<MovieSourceRecord | null>(
    null,
  );
  const [detailTask, setDetailTask] = useState<DownloadTaskDetails | null>(null);
  const openDetail = useMemoizedFn((record: MovieSourceRecord) => {
    setDetailRecord(record);
    void (async () => {
      const url = record.mediaTaskId
        ? await getMediaTaskUrl(record.mediaTaskId)
        : null;
      setDetailTask({
        id: Number(record.mediaTaskId ?? -1),
        type:
          url && /\.m3u8(\?|$)/i.test(url)
            ? "m3u8"
            : url
              ? "direct"
              : undefined,
        name: record.name,
        url: url ?? "",
        status: MOVIE_TO_STATUS[record.status],
        createdDate: new Date(recordEpoch(record.createdAt)),
        updatedDate: new Date(recordEpoch(record.updatedAt)),
        exists: true,
        percent: String(Math.round(Number(record.progress ?? 0))),
        speed: record.speed ?? "",
      } as unknown as DownloadTaskDetails);
    })();
  });
  const marqueeSelect = useMarqueeSelect<string>({
    rows: flatRowKeys,
    isSelected: (key) => selectedKeys.has(key),
    commit: (next) => setSelectedKeys(next),
    open: (key) => {
      const record = visibleRecords.find((r) => r.key === key);
      if (record) openDetail(record);
    },
  });

  // 删除交互：未完成（downloading/pending/failed）必然停止下载并清理临时文件；
  // 已完成由用户选择是否连文件删除（deleteMovieSource 的 files 参数）
  // 单行队列控制（影视行 → media 任务的开始/停止；下载中可暂停）
  const toggleLifecycle = useMemoizedFn(
    async (record: MovieSourceRecord, start: boolean) => {
      try {
        if (start) await startDownload(Number(record.mediaTaskId));
        else await stopDownload(Number(record.mediaTaskId));
        message.success(start ? "已开始下载" : "已暂停");
      } catch (e) {
        message.error((e as Error).message || "操作失败");
      }
      mutate();
      // media DB 持久化可能滞后于 start/stop 调用返回：800ms 后再拍快照，
      // 覆盖首轮快照仍是旧状态的极端场景（与详情抽屉 2s 实时轮询兜底互补）
      window.setTimeout(() => void mutate(), 800);
    },
  );

  const handleDeleteRecord = useMemoizedFn(
    async (record: MovieSourceRecord) => {
      const unfinished = record.status !== "done" ? 1 : 0;
      const choice = await confirmDelete({
        unfinished,
        done: 1 - unfinished,
        label: `《${record.title}》${record.name}`,
      });
      if (choice === null) return; // 取消
      try {
        // 未完成记录：服务端总是级联停 media 任务并清临时文件（choice 仅对 done 生效）
        await deleteMovieSource(record.key, choice);
        message.success("已删除");
        mutate();
      } catch (e) {
        message.error((e as Error).message || "删除失败");
      }
    },
  );

  const handleDeleteGroup = useMemoizedFn(async (group: Group) => {
    const unfinished = group.records.filter((r) => r.status !== "done").length;
    const choice = await confirmDelete({
      unfinished,
      done: group.records.length - unfinished,
      label: `《${group.title}》全部 ${group.records.length} 条记录`,
    });
    if (choice === null) return; // 取消
    const results = await Promise.allSettled(
      group.records.map((record) => deleteMovieSource(record.key, choice)),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) {
      message.error(`删除失败 ${failed} 项`);
    } else {
      message.success("已删除");
    }
    mutate();
  });

  const renderRow = (record: MovieSourceRecord) => {
    const isFailed = record.status === "failed";
    const rowDownloading = isDownloading(record);
    const selected = selectedKeys.has(record.key);
    const chip = MOVIE_CHIP[record.status] ?? MOVIE_CHIP.pending;
    // 状态列时间：完成/暂停用更新时间，下载中用创建时间更贴近「开始下载于」
    const timeText = fmtRecordTime(
      rowDownloading
        ? record.createdAt || record.updatedAt
        : record.updatedAt || record.createdAt,
    );
    return (
      <div
        {...marqueeSelect.rowProps(record.key)}
        className={cn(ROW_CLS, selected && ROW_SELECTED_CLS, isFailed && "opacity-90")}
        onContextMenu={(e) => {
          // 多选态右键：命中已选成员且选中 >1 → 批量菜单（交集过滤）
          if (selectedKeys.size > 1 && selectedKeys.has(record.key)) {
            const targets = visibleRecords.filter((r) => selectedKeys.has(r.key));
            openMovieBatchMenu(e, targets);
            return;
          }
          openMovieMenu(e, record);
        }}
      >
        <div className="flex w-4 shrink-0 items-center">
          <Checkbox
            checked={selected}
            onCheckedChange={() => toggleSelect(record.key)}
          />
        </div>
        {/* 类型瓦片（对齐任务队列列 1：影视统一靛色剧集瓦片） */}
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-[15px] text-indigo-600 dark:bg-indigo-400/15 dark:text-indigo-300"
          title="剧集"
        >
          <PlaySquareOutlined />
        </span>
        {/* 内容列：集名 + 次行进度/更新说明（迅雷表格内容列随文本流） */}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div
            className={cn(
              "min-w-0 truncate text-[13px] font-medium text-gray-900 dark:text-gray-200",
              isFailed && "text-[#ff7373] dark:text-[#ff7373]",
            )}
            title={record.name}
          >
            {record.name}
          </div>
          {rowDownloading ? (
            <div className="flex min-w-0 flex-row items-center gap-2 text-[11px] leading-none text-gray-500 dark:text-gray-400">
              <div className="h-1 min-w-0 max-w-md flex-1 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/10">
                <div
                  className="h-full rounded-full bg-blue-500 transition-[width] duration-300"
                  style={{
                    width: `${Math.max(Math.round(Number(record.progress ?? 0)), 2)}%`,
                  }}
                />
              </div>
              <span className="shrink-0 tabular-nums">
                {Math.round(Number(record.progress ?? 0))}%
              </span>
              {record.speed ? (
                <span className="shrink-0 tabular-nums">{record.speed}</span>
              ) : null}
            </div>
          ) : (
            <div className="min-w-0 truncate text-[11px] leading-[15px] text-gray-400 dark:text-gray-500">
              {isFailed
                ? "下载失败，可在影视应用内重新发起"
                : `更新于 ${fmtRecordTime(record.updatedAt || record.createdAt)}`}
            </div>
          )}
        </div>
        {/* 大小列（对齐任务队列列宽 88；影视服务未下发占用体积，恒为 —） */}
        <div className="w-[88px] shrink-0 text-right text-[11px] leading-none tabular-nums text-gray-500 dark:text-gray-400">
          —
        </div>
        {/* 状态列：状态徽章 + 时间（整行垂直居中） */}
        <div className="flex w-[118px] shrink-0 flex-col items-end gap-1">
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-[3px] text-[11px] font-medium leading-none",
              chip.cls,
            )}
          >
            {chip.text}
          </span>
          <span className="text-[11px] leading-none tabular-nums text-gray-400 dark:text-gray-500">
            {timeText}
          </span>
        </div>
        {/* 操作列（对齐列 3 宽 124：生命周期 → 播放 → 下载到本机 → 删除） */}
        <div className="flex w-[124px] shrink-0 flex-row items-center justify-end gap-1">
          {record.status === "downloading" && record.mediaTaskId ? (
            <IconButton
              size="md"
              title="暂停下载"
              icon={<PauseCircleOutlined />}
              onClick={() => void toggleLifecycle(record, false)}
            />
          ) : null}
          {(record.status === "paused" ||
            record.status === "pending" ||
            record.status === "failed") &&
          record.mediaTaskId ? (
            <IconButton
              size="md"
              title={record.status === "failed" ? "重试下载" : "继续下载"}
              icon={<PlayCircleOutlined />}
              onClick={() => void toggleLifecycle(record, true)}
            />
          ) : null}
          {record.status === "done" &&
            (record.playRoute || movieFallbackVideo(record)) && (
              <IconButton
                size="md"
                title={t("playVideo")}
                icon={<PlayCircleOutlined />}
                onClick={() => {
                  if (record.playRoute) {
                    playMovieRecord(record);
                    return;
                  }
                  const target = movieFallbackVideo(record);
                  if (target) inlinePlayer.play(target);
                }}
              />
            )}
          {/* 下载到本机（已完成；媒体任务的 /files/:id 附件端点） */}
          {record.status === "done" && record.mediaTaskId ? (
            <IconButton
              size="md"
              title="下载到本机"
              icon={<DownloadOutlined />}
              onClick={() => {
                window.location.href = appFileUrl(
                  `files/${Number(record.mediaTaskId)}`,
                );
              }}
            />
          ) : null}
          <IconButton
            size="md"
            title={t("delete")}
            icon={<DeleteIcon />}
            onClick={() => handleDeleteRecord(record)}
          />
        </div>
      </div>
    );
  };

  const renderGroups = () =>
    groups.map((group) => {
      const doneCount = group.records.filter((r) => r.status === "done").length;
      const category = group.records[0]?.category || "";
      return (
        <div key={group.groupKey} className="flex flex-col">
          {/* 剧名/年份节行（表格节行，全宽，替代原分组卡片头） */}
          <div className="flex shrink-0 flex-row items-center gap-2 border-b border-black/[0.04] bg-black/[0.015] px-3 py-1.5 dark:border-white/[0.05] dark:bg-white/[0.02]">
            <span className="min-w-0 truncate text-xs font-medium text-gray-600 dark:text-gray-300">
              {group.title}
              {group.year ? `（${group.year}）` : ""}
            </span>
            {category && <DownloadTag text={category} color="#6366f1" />}
            <span className="shrink-0 text-[11px] text-gray-400 dark:text-gray-500">
              {doneCount}/{group.records.length} 集
            </span>
            <div className="ml-auto">
              <IconButton
                size="md"
                title="删除该剧全部"
                icon={<DeleteIcon />}
                onClick={() => handleDeleteGroup(group)}
              />
            </div>
          </div>
          {group.records.map(renderRow)}
        </div>
      );
    });

  if (isLoading) {
    return <Loading />;
  }

  if (error) {
    return (
      <div className={PANEL_ERROR_STYLE}>
        <Empty description="影视服务不可用，暂时无法获取下载记录" />
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className={PANEL_ERROR_STYLE}>
        <Empty description="暂无影视下载记录" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-hidden pr-1">
      {/* 单行工具条（对齐任务队列）：全选(三态) + 状态页签 + 搜索 + 全部起停 */}
      <div className={TOOLBAR_CLS}>
        <Checkbox
          className="mr-1"
          title="全选"
          checked={triState(selectedKeys.size, visibleRecords.length)}
          onCheckedChange={(v) =>
            setSelectedKeys(
              v ? new Set(visibleRecords.map((r) => r.key)) : new Set(),
            )
          }
        />
        <Segmented
          size="small"
          className="rounded-full p-0.5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as MovieStatusKey)}
          options={MOVIE_STATUS_OPTIONS}
        />
        <div className="min-w-4 flex-1" />
        <div className="w-40 shrink-0">
          <ListSearch
            value={searchText}
            onChange={setSearchText}
            placeholder="搜索剧名/集名"
          />
        </div>
        <div className="flex shrink-0 items-center gap-1">
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
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            disabled={selectedKeys.size === 0}
            onClick={() => void handleBulkDelete()}
          >
            删除
          </Button>
        </div>
      </div>
      {/* 已选条（对齐任务队列 ListHeader：选中态浮现统一动作区） */}
      {selectedKeys.size > 0 ? (
        <BulkBar
          checked={triState(selectedKeys.size, visibleRecords.length)}
          selectedCount={selectedKeys.size}
          total={visibleRecords.length}
          onSelectAll={(checked) =>
            setSelectedKeys(
              checked ? new Set(visibleRecords.map((r) => r.key)) : new Set(),
            )
          }
        >
          <BulkButton danger onClick={() => void handleBulkDelete()}>
            删除
          </BulkButton>
        </BulkBar>
      ) : null}
      {/* 表格：表头（列语义，继承任务队列网格 16|28|flex|88|118|124）+ 表体 */}
      <div className={TABLE_CLS}>
        <div className={HEADER_CLS}>
          <span className="w-4 shrink-0" />
          <span className="w-7 shrink-0" />
          <span className="min-w-0 flex-1">任务</span>
          <span className="w-[88px] shrink-0 text-right">大小</span>
          <span className="w-[118px] shrink-0 text-right">状态 · 时间</span>
          <span className="w-[124px] shrink-0 text-right">操作</span>
        </div>
        <div
          {...marqueeSelect.containerProps}
          className="relative flex w-full flex-1 flex-col overflow-auto"
        >
          {marqueeSelect.marqueeEl}
          {renderGroups()}
        </div>
      </div>
      {menu}
      {logModal}
      {renameModal}
      {/* 行平单击详情（对齐任务队列/音乐库统一 TaskDetailDrawer；多选态
          单击=反选是 hook 既定语义）：状态/操作由 /api/downloads/:id 2s
          实时轮询驱动；播放委托记录口径——playRoute 深链优先，无深链时
          就地 /videos/:id 弹层兜底 */}
      <TaskDetailDrawer
        task={detailTask}
        open={detailTask !== null}
        onClose={() => {
          setDetailTask(null);
          setDetailRecord(null);
        }}
        onChanged={() => void mutate()}
        onPlay={
          detailRecord && detailRecord.status === "done"
            ? () => {
                playMovieRecord(detailRecord);
                if (!detailRecord.playRoute) {
                  const target = movieFallbackVideo(detailRecord);
                  if (target) inlinePlayer.play(target);
                }
              }
            : undefined
        }
      />
      {deleteDialog}
    </div>
  );
};

export default MoviePanel;
