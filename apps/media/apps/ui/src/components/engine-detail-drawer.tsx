import {
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { useMemoizedFn } from "ahooks";
import {
  App,
  Button,
  Drawer,
  Form,
  InputNumber,
  Progress,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import { useEffect, useState, type FC, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import { useAppStore } from "@/store/app";
import { http } from "@/utils";

/**
 * 引擎任务详情（对齐 FluxDown 桌面端 DetailPanel）——2026-10-15 按 Round-D
 * 反馈重构为「操作上移、信息下沉」三层结构：
 *   - useEngineDetail：engine-detail 2s 轮询 + 全部引擎动作（暂停/继续/重试、
 *     重扫、换队列、插队、做种限制）。宿主（任务详情抽屉顶部唯一操作区）
 *     直接消费它的实时状态驱动按钮 —— 动作完成后 load() 立刻刷新，按钮随
 *     状态切换（修复「处理后按钮不变」）。
 *   - EngineDetailInfo：纯信息渲染（进度/速度/分段/速度历史/队列·做种态·
 *     失败原因/做种设置/活动日志），不再含任何任务操作按钮；作为任务详情
 *     抽屉「概况」里的「引擎」分区展示（取代独立引擎 tab）。
 *   - EngineDetailDrawer：独立薄壳（自持顶部操作区 + 信息块），当前无调用方，
 *     保留供独立引擎查看入口使用。
 * 数据源 GET /api/downloads/:id/engine-detail（task + activity + runtime +
 * segments + speedHistory）。
 */

interface SegmentDetail {
  index: number;
  startByte: number;
  endByte: number;
  downloadedBytes: number;
}

export interface EngineDetailTask {
  taskId: string;
  url: string;
  fileName: string;
  saveDir: string;
  status: number;
  downloadedBytes: number;
  totalBytes: number;
  errorMessage: string;
  createdAt: string;
  completedAt: string;
  uploadedBytes: number;
  queueId: string;
  seedingStatus: number;
  seedingMessage: string;
  seedingTimeSecs: number;
  seedRatioLimitMilli: number;
  seedPostRatioLimitMilli: number;
  seedTimeLimitMinutes: number;
  seedInactiveTimeLimitMinutes: number;
}

export interface EngineDetailData {
  task: EngineDetailTask | null;
  activity: Array<{
    id: number;
    kind: string;
    message: string;
    /** daemon status 条目的引擎状态码（ENGINE_STATUS 对位；合成人话文案用） */
    status?: number;
    taskId: string;
    timestampMs: number;
  }>;
  runtime: {
    speed: string;
    uploadSpeed: string;
    percent: number;
    uploadedBytes: number;
    downloadedBytes: number;
    totalBytes: number;
    seeding: number;
    seedingMessage: string;
    seedingTimeSecs: number;
    peers: number | null;
    activeTransfers: number | null;
  } | null;
  segments: {
    totalBytes: number;
    segmentCount: number;
    segments: SegmentDetail[];
    at: number;
  } | null;
  speedHistory: Array<{ t: number; bps: number; upBps: number }>;
}

export interface EngineQueue {
  queueId: string;
  name: string;
  isRunning: boolean;
}

function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function fmtDuration(secs: number): string {
  if (!Number.isFinite(secs) || secs <= 0) return "0m";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** 引擎状态码 → 人话（0 pending /1 downloading /2 paused /3 success /
 *  4 failed /5 preparing；与 DownloadStatus 字符串枚举对位） */
export const ENGINE_STATUS = {
  0: { label: "pending", color: "default" },
  1: { label: "downloading", color: "processing" },
  2: { label: "downloadPause", color: "warning" },
  3: { label: "downloadSuccess", color: "success" },
  4: { label: "downloadFailed", color: "error" },
  5: { label: "preparing", color: "processing" },
} as const;

/** useEngineDetail 的控制面：数据 + 动作（宿主渲染操作按钮用） */
export interface EngineDetailControl {
  data: EngineDetailData | null;
  loading: boolean;
  /** 引擎任务当前状态码（实时，2s 轮询驱动） */
  status: number;
  isBt: boolean;
  reload: () => Promise<void>;
  /** 按当前状态自动选向：进行中→暂停；暂停/失败→启动。动作后立即 reload，
   *  宿主按钮由 status 驱动 → 下一拍即切换 */
  pauseResume: () => Promise<void>;
  queues: EngineQueue[] | undefined;
  queueBusy: boolean;
  moveQueue: (queueId: string) => Promise<void>;
  boostTask: () => Promise<void>;
  rescan: () => Promise<void>;
  rescanning: boolean;
  limits: ReturnType<typeof Form.useForm>[0];
  saveLimits: () => Promise<void>;
  savingLimits: boolean;
}

/**
 * 引擎详情数据 + 动作集。open 期间 2s 轮询 engine-detail；全部动作成功后
 * onChanged（宿主刷新列表）+ reload（本 hook 刷新 → 按钮实时切换）。
 */
export function useEngineDetail(
  taskId: number,
  open: boolean,
  onChanged?: () => void,
): EngineDetailControl {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<EngineDetailData | null>(null);
  const [savingLimits, setSavingLimits] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [queueBusy, setQueueBusy] = useState(false);
  const [limits] = Form.useForm();

  const load = useMemoizedFn(async () => {
    try {
      // axios 拦截器已剥 {success,data} 信封——resolve 值即 detail 本体
      const payload = (await http.get(
        `/api/downloads/${taskId}/engine-detail`,
      )) as unknown as EngineDetailData | null;
      if (payload && payload.task) setData(payload);
    } catch {
      // 引擎离线等：保留上次数据，标题态提示
    } finally {
      setLoading(false);
    }
  });

  useEffect(() => {
    if (!open || !taskId) return;
    setLoading(true);
    setData(null);
    void load();
    const timer = setInterval(() => void load(), 2000);
    return () => clearInterval(timer);
  }, [open, taskId, load]);

  // 做种限制表单随任务字段初始化（-2 = 跟随全局 → 表单空值）
  useEffect(() => {
    const task = data?.task;
    if (!task) return;
    const val = (v: number): number | undefined =>
      v === -2 ? undefined : v === -1 ? 0 : v;
    limits.setFieldsValue({
      ratioLimitMilli: val(task.seedRatioLimitMilli),
      postRatioLimitMilli: val(task.seedPostRatioLimitMilli),
      seedTimeLimitMinutes: val(task.seedTimeLimitMinutes),
      inactiveTimeLimitMinutes: val(task.seedInactiveTimeLimitMinutes),
    });
  }, [data?.task?.taskId, data, limits]);

  const pauseResume = useMemoizedFn(async () => {
    const st = data?.task?.status ?? -1;
    // 进行中（pending/downloading/preparing）→ 暂停；暂停/失败 → 重启。
    // start 与列表行「继续/重试」同口径必须携带 localPath/deleteSegments
    // （media server 校验请求体），stop 无 body
    const stop = st === 0 || st === 1 || st === 5;
    try {
      await (stop
        ? http.post(`/api/downloads/${taskId}/stop`)
        : http.post(`/api/downloads/${taskId}/start`, {
            localPath: useAppStore.getState().local,
            deleteSegments: useAppStore.getState().deleteSegments,
          }));
      onChanged?.();
      await load();
    } catch (e: unknown) {
      message.error((e as Error)?.message || t("pleaseEnterCorrectFormInfo"));
    }
  });

  // 命名队列：换队列 / 插队（daemon.queue.moveTask / boost）
  const { data: queues } = useSWR(
    open ? "/api/downloads/engine-queues" : null,
    () =>
      http.get("/api/downloads/engine-queues") as Promise<EngineQueue[]>,
    { revalidateOnFocus: false },
  );

  const moveQueue = useMemoizedFn(async (queueId: string) => {
    setQueueBusy(true);
    try {
      await http.post(`/api/downloads/${taskId}/queue`, { queueId });
      message.success(t("queueMoved"));
      onChanged?.();
      await load();
    } catch (e: unknown) {
      message.error((e as Error)?.message || t("pleaseEnterCorrectFormInfo"));
    } finally {
      setQueueBusy(false);
    }
  });

  const boostTask = useMemoizedFn(async () => {
    setQueueBusy(true);
    try {
      await http.post(`/api/downloads/${taskId}/boost`);
      message.success(t("queueBoosted"));
      await load();
    } catch (e: unknown) {
      message.error((e as Error)?.message || t("pleaseEnterCorrectFormInfo"));
    } finally {
      setQueueBusy(false);
    }
  });

  const rescan = useMemoizedFn(async () => {
    setRescanning(true);
    try {
      await http.post("/api/downloads/engine-rescan");
      message.success(t("engineRescanDone"));
      await load();
    } catch (e: unknown) {
      message.error((e as Error)?.message || t("pleaseEnterCorrectFormInfo"));
    } finally {
      setRescanning(false);
    }
  });

  const saveLimits = useMemoizedFn(async () => {
    setSavingLimits(true);
    try {
      const v = limits.getFieldsValue() as Record<string, number | undefined>;
      // 空值（跟随全局 -2）；0 = 不限（-1）；>0 自定义（分钟/千分比原值）
      const num = (x: number | undefined): number =>
        x === undefined || x === null ? -2 : x <= 0 ? -1 : Math.round(x);
      await http.post(`/api/downloads/${taskId}/seed-limits`, {
        ratioLimitMilli: num(v.ratioLimitMilli),
        postRatioLimitMilli: num(v.postRatioLimitMilli),
        seedTimeLimitMinutes: num(v.seedTimeLimitMinutes),
        inactiveTimeLimitMinutes: num(v.inactiveTimeLimitMinutes),
        uploadLimitBps: -2,
      });
      message.success(t("engineConfigSaved"));
      await load();
    } catch (e: unknown) {
      message.error((e as Error)?.message || t("pleaseEnterCorrectFormInfo"));
    } finally {
      setSavingLimits(false);
    }
  });

  const task = data?.task ?? null;

  return {
    data,
    loading,
    status: task?.status ?? -1,
    isBt: (task?.seedingStatus ?? 0) > 0 || (task?.uploadedBytes ?? 0) > 0,
    reload: load,
    pauseResume,
    queues,
    queueBusy,
    moveQueue,
    boostTask,
    rescan,
    rescanning,
    limits,
    saveLimits,
    savingLimits,
  };
}

const queueDisplayName = (
  qid: string | undefined,
  queues: EngineQueue[] | undefined,
  fallback: string
): string =>
  queues?.find((q) => q.queueId === qid)?.name ?? qid ?? fallback;

/** 信息行（与任务详情抽屉「概况」同款 label 行语言，规整分栏） */
const InfoRow: FC<{ label: string; children: ReactNode }> = ({
  label,
  children,
}) => (
  <div className="flex flex-row gap-3 text-[12px] leading-[20px]">
    <span className="w-16 shrink-0 text-gray-400 dark:text-gray-500">
      {label}
    </span>
    <span className="min-w-0 flex-1 break-all text-gray-700 dark:text-gray-200">
      {children}
    </span>
  </div>
);

/** 概况分节壳（任务详情概况模式）：小写距标题行 + 内容，与宿主「下载信息/
 *  时间」分节同款视觉语言 */
export const EngineViewSection: FC<{ title: string; children: ReactNode }> = ({
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

/** daemon status 活动条目的状态码 → 人话（1 下载中的表述依赖前驱，合成时处理；
 *  与 ENGINE_STATUS 状态码对位） */
const ENGINE_ACTIVITY_TEXT: Record<number, string> = {
  0: "任务创建，等待开始",
  5: "准备资源（找源/解析元数据）",
  2: "已暂停",
  3: "下载完成",
  4: "下载失败",
};

/**
 * 合成活动可读文案：daemon 的 status 条目 message 恒为空（见 Round-A 反馈，
 * 之前渲染只剩一堆时间戳）。按状态码 + 前驱状态合成「开始下载/恢复下载/已
 * 暂停」等行为语，连续相同状态去重；非空 message（daemon 未来提供的真实
 * 日志）原样透出。
 */
const activityLinesOf = (
  entries: EngineDetailData["activity"],
): Array<{ key: number; at: number; text: string }> => {
  const lines: Array<{ key: number; at: number; text: string }> = [];
  let prev: number | null = null;
  for (const a of entries) {
    if (a.kind === "status" && !a.message) {
      const status = a.status;
      if (status === undefined) continue; // 合成仅针对带状态码的条目
      if (prev === status) continue; // 连续同状态无信息量，去重
      const text =
        status === 1
          ? prev === 2 || prev === 5
            ? "恢复下载"
            : "开始下载"
          : ENGINE_ACTIVITY_TEXT[status] ?? `状态 ${status}`;
      lines.push({ key: a.id, at: a.timestampMs, text });
      prev = status;
    } else if (a.message) {
      lines.push({ key: a.id, at: a.timestampMs, text: a.message });
      if (a.status !== undefined) prev = a.status;
    }
  }
  return lines;
};

type LimitsFormInstance = ReturnType<typeof Form.useForm>[0];

/**
 * 引擎信息块（纯信息，无任务操作按钮）：
 * 实时进度/速度、分段完成度、速度历史、队列·做种态·失败原因、
 * 做种设置（BT）、活动日志。目录/创建时间等常规字段由宿主「下载信息/
 * 时间」分区承载，这里只放引擎侧特有信息，避免分区重复。
 */
export function EngineDetailInfo({
  data,
  loading,
  queues,
  limits,
  savingLimits,
  saveLimits,
  sections,
}: {
  data: EngineDetailData | null;
  /** 宿主 useEngineDetail 的 loading（首帧未回包时占位） */
  loading?: boolean;
  queues?: EngineQueue[];
  /** 做种限制表单实例（宿主 useEngineDetail 持有）；缺省=不渲染设置块 */
  limits?: LimitsFormInstance;
  savingLimits?: boolean;
  saveLimits?: () => Promise<void>;
  /** 概况分节模式：按「下载进度/引擎信息/活动日志」分节承载（任务详情概况
   *  页使用）。Round-A 反馈：进度条所在分区标题不应是「引擎」——进度与引擎
   *  侧字段是两类信息，分节后各自语义可读 */
  sections?: boolean;
}): ReactNode {
  const { t } = useTranslation();
  const task = data?.task ?? null;
  const runtime = data?.runtime ?? null;
  const segments = data?.segments ?? null;
  const history = data?.speedHistory ?? [];
  const isBt = (task?.seedingStatus ?? 0) > 0 || (task?.uploadedBytes ?? 0) > 0;
  const maxBps = Math.max(1, ...history.map((h) => Math.max(h.bps, h.upBps)));

  const renderSpeedHistory = (): ReactNode => {
    if (history.length < 2) {
      return (
        <Typography.Text type="secondary" className="text-xs">
          {t("engineCollecting")}
        </Typography.Text>
      );
    }
    return (
      <div className="flex h-16 items-end gap-0.5">
        {history.map((h, i) => (
          <div key={i} className="flex h-full flex-1 flex-col justify-end">
            {h.upBps > 0 ? (
              <div
                className="w-full rounded-sm bg-[#67c23a]"
                style={{ height: `${(h.upBps / maxBps) * 100}%` }}
              />
            ) : null}
            <div
              className="w-full rounded-sm bg-[#1677ff]"
              style={{ height: `${(h.bps / maxBps) * 100}%` }}
            />
          </div>
        ))}
      </div>
    );
  };

  const renderSegments = (): ReactNode => {
    if (!segments || segments.segments.length === 0) {
      return (
        <Typography.Text type="secondary" className="text-xs">
          {t("engineNoSegments")}
        </Typography.Text>
      );
    }
    const totalSpan = Math.max(
      1,
      segments.segments.reduce(
        (s, g) => s + (g.endByte - g.startByte + 1),
        0,
      ),
    );
    return (
      <div className="flex h-2.5 w-full gap-px">
        {segments.segments.map((g) => {
          const size = g.endByte - g.startByte + 1;
          const pct = size > 0 ? Math.min(1, g.downloadedBytes / size) : 0;
          return (
            <div
              key={g.index}
              className="relative h-full overflow-hidden rounded-[1px] bg-[#e5e7eb] dark:bg-[#3a3d44]"
              style={{ flexGrow: Math.max(1, Math.round((size / totalSpan) * 100)) }}
            >
              <div
                className="h-full rounded-[1px] bg-[#1677ff]"
                style={{ width: `${pct * 100}%` }}
              />
            </div>
          );
        })}
      </div>
    );
  };

  if (loading && !data) {
    return (
      <div className="flex h-40 items-center justify-center text-xs text-gray-400">
        加载引擎状态…
      </div>
    );
  }
  if (!task) {
    return (
      <div className="flex h-40 items-center justify-center text-xs text-gray-400">
        {t("engineDown")}
      </div>
    );
  }

  // 三段视图：概况分节模式与独立抽屉平铺模式共用同一 JSX（差异只在包装层）
  const progressView = (
    <>
      {/* 实时进度 */}
      <div className="flex flex-col gap-1">
        <Progress
          percent={runtime?.percent ?? 0}
          status={task.status === 4 ? "exception" : undefined}
        />
        <Space size="large" className="text-xs">
          <span>
            ↓ {runtime?.speed || "0 B/s"}
          </span>
          {isBt ? (
            <span className="text-[#67c23a]">
              ↑ {runtime?.uploadSpeed || "0 B/s"}
            </span>
          ) : null}
          <span>
            {fmtBytes(runtime?.downloadedBytes ?? task.downloadedBytes)} /{" "}
            {fmtBytes(runtime?.totalBytes ?? task.totalBytes)}
          </span>
          {typeof runtime?.peers === "number" ? (
            <span title={t("engineDetailPeers")}>
              {runtime.peers}P
            </span>
          ) : null}
          {typeof runtime?.activeTransfers === "number" ? (
            <span title={t("engineDetailTransfers")}>
              {t("engineDetailTransfers")} {runtime.activeTransfers}
            </span>
          ) : null}
        </Space>
        {isBt ? (
          <Space size="large" className="text-xs text-gray-500 dark:text-gray-400">
            <span>
              {t("engineUploadedTotal")} {fmtBytes(runtime?.uploadedBytes ?? task.uploadedBytes)}
            </span>
            <span>
              {t("engineSeedingTime")}{" "}
              {fmtDuration(runtime?.seedingTimeSecs ?? task.seedingTimeSecs)}
            </span>
            {task.seedingStatus > 1 && task.seedingMessage ? (
              <span className="text-amber-500">{task.seedingMessage}</span>
            ) : null}
          </Space>
        ) : null}
      </div>

      {/* 分段完成度（进度可视化第一层：分段粒度的完成度） */}
      <div className="flex flex-col gap-1">
        <Typography.Text type="secondary" className="text-xs">
          {t("engineSegments")}
          {segments ? ` · ${segments.segmentCount}` : ""}
        </Typography.Text>
        {renderSegments()}
      </div>

      {/* 速度历史 */}
      <div className="flex flex-col gap-1">
        <Typography.Text type="secondary" className="text-xs">
          {t("engineSpeedHistory")}
        </Typography.Text>
        {renderSpeedHistory()}
      </div>
    </>
  );

  const infoView = (
    <>
      {/* 引擎侧特有信息（队列归属/做种态/失败原因），
          链接/目录/体积/时间等常规字段由宿主「下载信息/时间」分区承载 */}
      <div className="flex flex-col gap-1">
        <InfoRow label={t("taskQueue")}>
          {queueDisplayName(task.queueId, queues, t("queueDefault"))}
        </InfoRow>
        {task.seedingStatus > 1 && task.seedingMessage ? (
          <InfoRow label="做种态">
            {task.seedingMessage}
          </InfoRow>
        ) : null}
        {task.errorMessage ? (
          <InfoRow label={t("failReason")}>
            <span className="text-rose-600 dark:text-rose-400">
              {task.errorMessage}
            </span>
          </InfoRow>
        ) : null}
      </div>

      {/* 做种设置（BT）—— 属引擎信息面（对应 FluxDown 的做种设置），保存按钮属于表单本体 */}
      {isBt && limits && saveLimits ? (
        <Form form={limits} layout="vertical" size="small">
          <Typography.Text type="secondary" className="text-xs">
            {t("engineSeedSettings")}
          </Typography.Text>
          <div className="mt-2 grid grid-cols-2 gap-x-4">
            <Form.Item
              label={t("engineSeedRatioLimit")}
              tooltip={t("engineSeedZeroUnlimited")}
              name="ratioLimitMilli"
              className="mb-2"
            >
              <InputNumber
                min={0}
                precision={2}
                className="w-full"
                placeholder={t("engineSeedInherit")}
              />
            </Form.Item>
            <Form.Item
              label={t("engineSeedPostRatio")}
              tooltip={t("engineSeedZeroUnlimited")}
              name="postRatioLimitMilli"
              className="mb-2"
            >
              <InputNumber
                min={0}
                precision={2}
                className="w-full"
                placeholder={t("engineSeedInherit")}
              />
            </Form.Item>
            <Form.Item
              label={t("engineSeedTimeLimit")}
              tooltip={t("engineSeedZeroUnlimited")}
              name="seedTimeLimitMinutes"
              className="mb-2"
            >
              <InputNumber
                min={0}
                precision={0}
                className="w-full"
                placeholder={t("engineSeedInherit")}
              />
            </Form.Item>
            <Form.Item
              label={t("engineSeedInactiveLimit")}
              tooltip={t("engineSeedZeroUnlimited")}
              name="inactiveTimeLimitMinutes"
              className="mb-2"
            >
              <InputNumber
                min={0}
                precision={0}
                className="w-full"
                placeholder={t("engineSeedInherit")}
              />
            </Form.Item>
          </div>
          <Button
            size="small"
            type="primary"
            loading={savingLimits}
            onClick={() => void saveLimits()}
          >
            保存
          </Button>
        </Form>
      ) : null}
    </>
  );

  const activityLines = activityLinesOf(data?.activity ?? []);

  const activityView = (
    <>
      {/* 活动日志：daemon status 条目 message 为空，activityLinesOf 合成
          「开始下载/恢复下载/已暂停」等人话行（Round-A 反馈修复） */}
      <div className="flex flex-col gap-1">
        <Typography.Text type="secondary" className="text-xs">
          {t("engineDetailActivity")}
        </Typography.Text>
        <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
          {activityLines
            .slice()
            .reverse()
            .map((l) => (
              <div key={l.key} className="flex flex-row gap-2 text-xs">
                <span className="shrink-0 text-gray-400">
                  {new Date(l.at).toLocaleTimeString()}
                </span>
                <span className="break-all text-gray-600 dark:text-gray-300">
                  {l.text}
                </span>
              </div>
            ))}
          {activityLines.length === 0 ? (
            <Typography.Text type="secondary" className="text-xs">
              —
            </Typography.Text>
          ) : null}
        </div>
      </div>
    </>
  );

  if (sections) {
    return (
      <div className="flex flex-col gap-4">
        <EngineViewSection title="下载进度">{progressView}</EngineViewSection>
        <EngineViewSection title="引擎信息">{infoView}</EngineViewSection>
        <EngineViewSection title="活动日志">{activityView}</EngineViewSection>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {progressView}
      {infoView}
      {activityView}
    </div>
  );
}

/**
 * 独立抽屉薄壳：顶部自持操作区（单操作区，同一水平线承载全部动作）+
 * 引擎信息块。当前无外层任务详情场景时使用。
 */
export function EngineDetailDrawer({
  taskId,
  open,
  onClose,
  onChanged,
}: {
  taskId: number;
  open: boolean;
  onClose?: () => void;
  onChanged?: () => void;
}) {
  const { t } = useTranslation();
  const ctl = useEngineDetail(taskId, open, onChanged);
  const task = ctl.data?.task ?? null;
  const statusMeta = ENGINE_STATUS[(ctl.status >= 0 ? ctl.status : 0) as keyof typeof ENGINE_STATUS];
  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={480}
      destroyOnClose
      title={
        <span className="flex items-center gap-2 text-[15px]">
          <Typography.Text strong ellipsis className="max-w-64">
            {task?.fileName || t("viewDetails")}
          </Typography.Text>
          {task ? <Tag color={statusMeta.color}>{t(statusMeta.label)}</Tag> : null}
        </span>
      }
    >
      {task ? (
        <div className="flex flex-wrap items-center gap-2 pb-3">
          {[0, 1, 5].includes(ctl.status) ? (
            <Button size="small" icon={<PauseCircleOutlined />} onClick={() => void ctl.pauseResume()}>
              {t("pause")}
            </Button>
          ) : null}
          {ctl.status === 2 || ctl.status === 4 ? (
            <Button size="small" icon={<PlayCircleOutlined />} onClick={() => void ctl.pauseResume()}>
              {ctl.status === 2 ? t("continueDownload") : "重试"}
            </Button>
          ) : null}
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={ctl.rescanning}
            onClick={() => void ctl.rescan()}
            title={t("engineRescanTooltip")}
          >
            {t("engineRescan")}
          </Button>
          {ctl.queues && ctl.queues.length > 0 ? (
            <>
              <Select
                size="small"
                className="min-w-28"
                value={task.queueId || undefined}
                loading={ctl.queueBusy}
                disabled={ctl.queueBusy}
                onChange={(v) => void ctl.moveQueue(v)}
                options={ctl.queues.map((q) => ({ value: q.queueId, label: q.name }))}
              />
              <Button
                size="small"
                onClick={() => void ctl.boostTask()}
                loading={ctl.queueBusy}
                title={t("queueBoostTooltip")}
              >
                {t("queueBoost")}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
      <EngineDetailInfo data={ctl.data} loading={ctl.loading} queues={ctl.queues} limits={ctl.limits} savingLimits={ctl.savingLimits} saveLimits={ctl.saveLimits} />
    </Drawer>
  );
}
