// 下载中心 —— 复刻 FluxDown 控制台的功能布局,视觉与主应用统一
// (应用仍部署在 /downloads 子路径,路由与插件 id 不变)。
// 布局形态:
//   左侧导航 = mei-portal 标准左侧面板(layout/mediago-sidebar,数据驱动
//   行动入口):应用标识 + 任务组(任务/队列/订阅) + 下载库组(影视/音乐) + 新建。
//   本页只承载右侧工作区:顶栏(标识 + 全局速度/活跃/磁盘) + 活动面板。
//   视图切换走 ?type= 深链(parseView),与左侧面板、外部深链完全同源。
// Flux 管理配置不走独立 web 口:引擎设置收进主应用设置中心(/settings/mediago)。
// 深链契约(保持不变):/downloads?type=media|movie|music|file|magnet|rss|queues
//   media/file/magnet → 任务视图(全类型任务表)
//   movie/music → 下载库对应面板
//   rss/queues → 对应视图
import { PlusOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { type FC, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import PageContainer from "@/components/page-container";
import DownloadForm, {
  type DownloadFormItem,
  type DownloadFormRef,
} from "@/components/download-form";
import { useConfigStore, downloadFormSelector } from "@/store/config";
import { useShallow } from "zustand/react/shallow";
import { EngineStatsBar } from "./components/engine-stats-bar";
import MoviePanel from "./components/movie-panel";
import MusicPanel from "./components/music-panel";
import QueuesPanel from "./components/queues-panel";
import RssPanel from "./components/rss-panel";
import { TasksView } from "./components/tasks-view";

export type DownloadCenterView = "tasks" | "queues" | "rss" | "movie" | "music";

/** 各子功能视图页头标题/副标题（区分面板，不再统一叫「下载中心」） */
const VIEW_META: Record<DownloadCenterView, { title: string; sub: string }> = {
  tasks: { title: "任务队列", sub: "全部类型下载任务 · FluxDown 引擎" },
  queues: { title: "队列管理", sub: "命名队列起停 / 限速 / 分组调度" },
  rss: { title: "订阅管理", sub: "RSS 自动抓取下载" },
  movie: { title: "影视下载库", sub: "剧集与影片产物管理" },
  music: { title: "音乐下载库", sub: "音乐任务与曲库文件" },
};

/** 深链 type → 视图映射(旧 tab 语义全保留) */
const parseView = (raw: string | null): DownloadCenterView => {
  switch (raw) {
    case "queues":
      return "queues";
    case "rss":
      return "rss";
    case "movie":
      return "movie";
    case "music":
      return "music";
    default:
      // all/media/file/magnet → 任务视图(FluxDown 任务表涵盖全部类型)
      return "tasks";
  }
};

const DownloadsPage: FC = () => {
  const [searchParams] = useSearchParams();
  const view = parseView(searchParams.get("type"));
  const newFormRef = useRef<DownloadFormRef>(null);
  const { lastIsBatch, lastDownloadTypes } = useConfigStore(
    useShallow(downloadFormSelector),
  );

  const openNewForm = useCallback(() => {
    const item: DownloadFormItem = {
      batch: lastIsBatch,
      type: lastDownloadTypes,
    };
    newFormRef.current?.openModal(item);
  }, [lastIsBatch, lastDownloadTypes]);

  const panel = useMemo(() => {
    switch (view) {
      case "queues":
        return <QueuesPanel />;
      case "rss":
        return <RssPanel />;
      case "movie":
        return <MoviePanel />;
      case "music":
        return <MusicPanel />;
      default:
        return <TasksView onOpenNew={openNewForm} />;
    }
  }, [view, openNewForm]);

  return (
    <PageContainer className="bg-white/85 dark:bg-[#1F2024] flex flex-col flex-1 min-h-0 h-full rounded-xl border border-black/5 shadow-sm p-3 gap-3 overflow-hidden">
      {/* 顶栏:标识 + 全局速度/活跃/磁盘 + 主操作(导航在标准左侧面板) */}
      <div className="flex shrink-0 items-center gap-4 px-1 pt-1">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#6366F1] to-[#8B5CF6] text-white shadow-[0_4px_14px_rgba(99,102,241,0.35)]">
          <svg
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 3v12" />
            <path d="m7 10 5 5 5-5" />
            <path d="M5 21h14" />
          </svg>
        </span>
        <div className="min-w-0">
          <div className="text-[20px] font-bold leading-tight tracking-tight text-gray-900 dark:text-gray-100">
            {VIEW_META[view].title}
          </div>
          <div className="truncate text-xs text-gray-500 dark:text-gray-400">
            {VIEW_META[view].sub}
          </div>
        </div>

        <div className="min-w-0 flex-1" />

        {/* 全局速度/活跃/磁盘(控制台 header 速度区) */}
        <EngineStatsBar compact />

        {/* 主操作:新建下载(左侧面板也有同款入口) */}
        <Button
          type="primary"
          size="small"
          icon={<PlusOutlined />}
          onClick={openNewForm}
        >
          新建下载
        </Button>
      </div>

      {/* 面板区:占满剩余高度并在面板内部滚动 */}
      <div className="flex min-h-0 flex-1 flex-col">{panel}</div>

      {/* 新建下载(全局挂载,顶栏/任务空态共用) */}
      <DownloadForm ref={newFormRef} id="downloads-new-form" />
    </PageContainer>
  );
};

export default DownloadsPage;
