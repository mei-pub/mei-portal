// 影视下载面板 —— 数据源：/tv/api/local-sources/list（契约 1）
// 按剧名（title + year）分组；下载中显示进度条 + 速度（经 shared-poll 统一 3s 轮询，
// 无下载任务时不轮询）；done 显示分类/集数；failed 标红；删除走契约 2。
// embedded=true（全部视图）：段卡片 + 段头（计数/进行中徽标 + 「进入 →」），
// 含进行中任务的分组与条目稳定置前（保持原有相对顺序）。
import { App, Empty, Popconfirm, Progress } from "antd";
import { useMemoizedFn } from "ahooks";
import { type FC, useMemo } from "react";
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
import { InlineNotice } from "./inline-notice";
import { SectionHeader } from "./section-header";
import { useSharedPoll } from "./shared-poll";

interface Props {
  /** 全部视图内嵌模式 */
  embedded?: boolean;
  /** 段头「进入 →」回调（锚定影视 tab） */
  onEnter?: () => void;
}

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

const isDownloading = (record: MovieSourceRecord) =>
  record.status === "downloading";

const MoviePanel: FC<Props> = ({ embedded = false, onEnter }) => {
  const { message } = App.useApp();
  const { t } = useTranslation();
  const { data, error, isLoading, mutate } = useSWR(
    "download-center/movie",
    listMovieSources,
    { revalidateOnFocus: false },
  );

  const records = useMemo(() => data ?? [], [data]);

  // 下载中 → 3s 轮询刷新进度/速度（页面级共享计时器）；无下载任务时停止轮询
  const hasDownloading = useMemo(
    () => records.some(isDownloading),
    [records],
  );
  useSharedPoll(hasDownloading, mutate);

  const activeCount = useMemo(
    () => records.filter(isDownloading).length,
    [records],
  );

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

  // 全部视图：进行中置前 —— 含下载中条目的分组优先（组内下载中条目优先），
  // 稳定排序保持其余条目原有相对顺序（沿用服务端顺序）
  const displayGroups = useMemo(() => {
    if (!embedded) return groups;
    const ordered = groups.map((group, groupIndex) => ({
      groupIndex,
      group: {
        ...group,
        records: group.records
          .map((record, index) => ({ record, index }))
          .sort((a, b) => {
            const av = isDownloading(a.record) ? 0 : 1;
            const bv = isDownloading(b.record) ? 0 : 1;
            return av - bv || a.index - b.index;
          })
          .map((item) => item.record),
      },
    }));
    ordered.sort((a, b) => {
      const av = a.group.records.some(isDownloading) ? 0 : 1;
      const bv = b.group.records.some(isDownloading) ? 0 : 1;
      return av - bv || a.groupIndex - b.groupIndex;
    });
    return ordered.map((item) => item.group);
  }, [groups, embedded]);

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
    const rowDownloading = isDownloading(record);
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
          {rowDownloading ? (
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

  const renderGroups = () =>
    displayGroups.map((group) => {
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
    });

  // ---- embedded（全部视图）：段卡片 + 段头，段内提示用 InlineNotice 不占满屏 ----
  if (embedded) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-black/5 bg-white/85 p-3 shadow-sm dark:border-white/10 dark:bg-[#1F2024]">
        <SectionHeader
          title="影视"
          count={records.length}
          activeCount={activeCount}
          onEnter={onEnter}
        />
        {isLoading && <InlineNotice text="影视下载记录加载中…" />}
        {error && (
          <InlineNotice
            error
            text="影视服务不可用，暂时无法获取下载记录"
          />
        )}
        {!isLoading && !error && displayGroups.length === 0 && (
          <InlineNotice text="暂无影视下载记录" />
        )}
        {!isLoading && !error && displayGroups.length > 0 && (
          <div className="flex flex-col gap-3">{renderGroups()}</div>
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
        <Empty description="影视服务不可用，暂时无法获取下载记录" />
      </div>
    );
  }

  if (displayGroups.length === 0) {
    return (
      <div className={PANEL_ERROR_STYLE}>
        <Empty description="暂无影视下载记录" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-auto pr-1">
      {renderGroups()}
    </div>
  );
};

export default MoviePanel;
