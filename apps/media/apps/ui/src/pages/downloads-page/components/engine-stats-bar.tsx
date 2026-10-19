import { useMemo } from "react";
import useSWR from "swr";
import { useTranslation } from "react-i18next";
import { http } from "@/utils";

/**
 * 引擎全局运行统计条（对齐 FluxDown 控制台信息面）：活跃/排队任务、
 * 全局下载/上传速度、下载根磁盘剩余。数据 GET /api/downloads/engine-stats
 * （桥接层 runtimeStatsChanged 事件缓存），5s 轮询。
 */

interface EngineStats {
  activeTasks: number;
  pendingTasks: number;
  retryPendingTasks?: number;
  totalDownloadBps: number;
  totalUploadBps: number;
  diskFreeBytes: number | null;
  saveDir: string;
}

function fmtBps(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return "0 B/s";
  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  let v = bps;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
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

const ENGINE_STATS_KEY = "/api/downloads/engine-stats";

/**
 * 引擎全局运行统计条。
 * compact:顶栏内联形态(控制台 header 速度区);默认整行形态。
 */
export function EngineStatsBar({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const { data } = useSWR<EngineStats>(
    ENGINE_STATS_KEY,
    () => http.get(ENGINE_STATS_KEY) as Promise<EngineStats>,
    { refreshInterval: 5000, revalidateOnFocus: false },
  );

  const items = useMemo(
    () =>
      compact
        ? [
            { key: "active", label: t("engineStatActive"), value: String(data?.activeTasks ?? 0) },
            { key: "down", label: "↓", value: fmtBps(data?.totalDownloadBps ?? 0) },
            { key: "up", label: "↑", value: fmtBps(data?.totalUploadBps ?? 0) },
            {
              key: "disk",
              label: t("engineStatDisk"),
              value:
                data?.diskFreeBytes != null
                  ? fmtBytes(data.diskFreeBytes)
                  : t("engineStatUnknown"),
            },
          ]
        : [
            {
              key: "active",
              label: t("engineStatActive"),
              value: String(data?.activeTasks ?? 0),
            },
            {
              key: "pending",
              label: t("engineStatPending"),
              value: String((data?.pendingTasks ?? 0) + (data?.retryPendingTasks ?? 0)),
            },
            {
              key: "down",
              label: t("engineStatDown"),
              value: `↓ ${fmtBps(data?.totalDownloadBps ?? 0)}`,
            },
            {
              key: "up",
              label: t("engineStatUp"),
              value: `↑ ${fmtBps(data?.totalUploadBps ?? 0)}`,
            },
            {
              key: "disk",
              label: t("engineStatDisk"),
              value:
                data?.diskFreeBytes != null
                  ? fmtBytes(data.diskFreeBytes)
                  : t("engineStatUnknown"),
            },
          ],
    [data, t, compact],
  );

  return (
    <div
      className={
        compact
          ? "flex min-w-0 flex-row items-center gap-3 overflow-x-auto text-xs text-gray-500 dark:text-gray-400"
          : "flex shrink-0 flex-row items-center gap-4 overflow-x-auto px-1 text-xs text-gray-500 dark:text-gray-400"
      }
    >
      {items.map((it) => (
        <span key={it.key} className="flex shrink-0 flex-row items-center gap-1">
          <span>{it.label}</span>
          <span className="font-medium text-gray-700 dark:text-gray-200">
            {it.value}
          </span>
        </span>
      ))}
    </div>
  );
}
