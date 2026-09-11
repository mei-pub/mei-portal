// 影视下载面板 —— 数据源：/tv/api/local-sources/list（契约 1）
// 按剧名（title + year）分组；下载中显示进度条 + 速度（3s 轮询）；
// done 显示分类/集数；failed 标红；删除走契约 2。
import { App, Empty, Popconfirm, Progress } from "antd";
import { useMemoizedFn } from "ahooks";
import { type FC, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import { DeleteIcon, DownloadIcon, FailedIcon } from "@/assets/svg";
import { DownloadTag } from "@/components/download-tag";
import { IconButton } from "@/components/icon-button";
import Loading from "@/components/loading";
import {
  deleteMovieSource,
  type MovieSourceRecord,
  listMovieSources,
} from "@/api/download-center";
import { cn } from "@/utils";

interface Group {
  groupKey: string;
  title: string;
  year: string | number;
  records: MovieSourceRecord[];
}

const PANEL_ERROR_STYLE = "flex flex-1 flex-col items-center justify-center gap-3";

const statusTag = (record: MovieSourceRecord) => {
  switch (record.status) {
    case "downloading":
      return (
        <DownloadTag
          icon={<DownloadIcon fill="#fff" width={14} height={14} />}
          text="下载中"
          color="#127af3"
        />
      );
    case "done":
      return <DownloadTag text="已完成" color="#09ce87" />;
    case "failed":
      return (
        <DownloadTag
          icon={<FailedIcon />}
          text="失败"
          color="#ff7373"
        />
      );
    default:
      return <DownloadTag text="等待中" color="#9abbe2" />;
  }
};

const MoviePanel: FC = () => {
  const { message } = App.useApp();
  const { t } = useTranslation();
  const { data, error, isLoading, mutate } = useSWR(
    "download-center/movie",
    listMovieSources,
    { revalidateOnFocus: false },
  );

  const records = useMemo(() => data ?? [], [data]);

  // 下载中 → 3s 轮询刷新进度/速度；无下载任务时停止轮询
  const hasDownloading = useMemo(
    () => records.some((item) => item.status === "downloading"),
    [records],
  );
  useEffect(() => {
    if (!hasDownloading) return;
    const timer = setInterval(() => {
      mutate();
    }, 3000);
    return () => clearInterval(timer);
  }, [hasDownloading, mutate]);

  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const record of records) {
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
  }, [records]);

  const handleDeleteRecord = useMemoizedFn(async (record: MovieSourceRecord) => {
    try {
      await deleteMovieSource(record.key);
      message.success("已删除");
      mutate();
    } catch (e) {
      message.error((e as Error).message || "删除失败");
    }
  });

  const handleDeleteGroup = useMemoizedFn(async (group: Group) => {
    const results = await Promise.allSettled(
      group.records.map((record) => deleteMovieSource(record.key)),
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
    const isDownloading = record.status === "downloading";
    return (
      <div
        key={record.key}
        className={cn(
          "flex flex-row items-center gap-2 rounded-lg bg-[#FAFCFF] px-3 py-2 dark:bg-[#27292F]",
          isFailed && "opacity-90",
        )}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div
            className={cn(
              "truncate text-sm text-[rgba(0,0,0,0.88)] dark:text-[rgba(255,255,255,0.85)]",
              isFailed && "text-[#ff7373]",
            )}
            title={record.name}
          >
            {record.name}
          </div>
          {isDownloading ? (
            <div className="flex flex-row items-center gap-2 text-xs text-[rgba(0,0,0,0.65)] dark:text-[rgba(255,255,255,0.65)]">
              <Progress
                percent={Math.round(Number(record.progress ?? 0))}
                strokeLinecap="butt"
                showInfo={false}
              />
              <div className="min-w-10 shrink-0">
                {Math.round(Number(record.progress ?? 0))}%
              </div>
              <div className="min-w-20 shrink-0">{record.speed ?? "-"}</div>
            </div>
          ) : (
            <div className="truncate text-xs text-[#B3B3B3] dark:text-[#515257]">
              {isFailed
                ? "下载失败，可在影视应用内重新发起"
                : `更新于 ${record.updatedAt || record.createdAt || "-"}`}
            </div>
          )}
        </div>
        {statusTag(record)}
        <IconButton
          title={t("delete")}
          icon={<DeleteIcon />}
          onClick={() => handleDeleteRecord(record)}
        />
      </div>
    );
  };

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
    <div className="flex flex-1 flex-col gap-4 overflow-auto pr-1">
      {groups.map((group) => {
        const doneCount = group.records.filter(
          (r) => r.status === "done",
        ).length;
        const category = group.records[0]?.category || "";
        return (
          <div
            key={group.groupKey}
            className="flex flex-col gap-2 rounded-xl border border-black/5 bg-white/85 p-3 shadow-sm dark:border-white/10 dark:bg-[#1F2024]"
          >
            <div className="flex flex-row items-center gap-2">
              <span className="truncate text-sm font-medium text-[#343434] dark:text-white">
                {group.title}
                {group.year ? `（${group.year}）` : ""}
              </span>
              {category && (
                <DownloadTag text={category} color="#6366f1" />
              )}
              <span className="shrink-0 text-xs text-[#B3B3B3] dark:text-[#515257]">
                {doneCount}/{group.records.length} 集
              </span>
              <div className="ml-auto">
                <Popconfirm
                  title="删除该剧全部记录？"
                  description="将同时清理服务端落盘文件"
                  okText="删除"
                  cancelText="取消"
                  onConfirm={() => handleDeleteGroup(group)}
                >
                  <IconButton title="删除该剧全部" icon={<DeleteIcon />} />
                </Popconfirm>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              {group.records.map(renderRow)}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default MoviePanel;
