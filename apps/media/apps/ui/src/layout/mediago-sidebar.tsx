// mei-portal 标准左侧面板（数据驱动）：应用信息（Logo + 纵向名称）+ 行动入口
// 组件契约见仓库根 AGENTS.md「顶栏与左侧面板组件化强约束」
// 行动入口分两组：任务域（任务/队列/订阅，?type= 深链）+ 下载库（影视/音乐）
// + 新建（弹层）；与下载中心页面内导航完全同源
import { type FC, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import DownloadForm, {
  type DownloadFormItem,
  type DownloadFormRef,
} from "@/components/download-form";
import { downloadFormSelector, useConfigStore } from "@/store/config";
import { DownloadType } from "@mediago/shared-common";

const STORE_KEY = "mei-float-mediago";

// 面板开合共享到布局层：开启时内容区左避让（胶囊宽 ~52px + 间距），避免
// 覆盖贴左缘的文本/控件（工具条全选框、表格行复选框、组标题、段标题）
export const useRailOpen = create<{
  open: boolean;
  setOpen: (next: boolean) => void;
}>((set) => ({ open: true, setOpen: (next) => set({ open: next }) }));

interface PanelAction {
  label: string;
  title: string;
  active: boolean;
  icon: React.ReactNode;
  onClick: () => void;
}

const MediagoSidebar: FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { open, setOpen } = useRailOpen();
  // DownloadForm 自带 Modal，通过 ref.openModal 驱动（外包一层 Modal 会导致弹层空白）
  const newFormRef = useRef<DownloadFormRef>(null);
  const { lastIsBatch, lastDownloadTypes } = useConfigStore(
    useShallow(downloadFormSelector),
  );

  const openNewForm = () => {
    const item: DownloadFormItem = {
      batch: lastIsBatch,
      type: lastDownloadTypes,
    };
    newFormRef.current?.openModal(item);
  };

  // 磁力投递唤起：网盘搜索等外部应用经 /?new=magnet&magnet=…&dn=… 跳入下载
  // 中心时，打开新建下载弹层并预填磁力链接/任务名 —— 用户确认内容、改名、
  // 选目录后再提交（绝不静默直接下载）；处理后立即清掉参数防止后退重唤起
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("new") !== "magnet") return;
    const magnet = (params.get("magnet") ?? "").trim();
    const dn = (params.get("dn") ?? "").trim();
    const item: DownloadFormItem = {
      batch: false,
      type: DownloadType.bt,
      url: magnet || undefined,
      name: dn || undefined,
    };
    newFormRef.current?.openModal(item);
    navigate(location.pathname, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  // 初始：localStorage 记忆优先，默认展开
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(STORE_KEY) !== "1");
    } catch {
      setOpen(true);
    }
  }, []);

  const toggle = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(STORE_KEY, next ? "0" : "1");
    } catch {}
  };

  const isActive = (path: string, viewType?: string) => {
    // 当前视图：深链 ?type= 与页面内导航共用同一映射（media/file/magnet/无 → 任务）
    const search = new URLSearchParams(location.search);
    const raw = search.get("type") || "";
    const view =
      raw === "queues"
        ? "queues"
        : raw === "rss"
          ? "rss"
          : raw === "movie"
            ? "movie"
            : raw === "music"
              ? "music"
              : "tasks";
    if (viewType) return viewType === view;
    // 根路由（下载中心任务视图）：覆盖带 /downloads basename 与根路径两种部署形态
    if (path === "/")
      return (
        view === "tasks" &&
        (location.pathname === "/downloads/" ||
          location.pathname === "/downloads" ||
          location.pathname === "/")
      );
    return location.pathname === path;
  };

  const stroke = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  // 面板数据：行动入口按「任务域 / 下载库」两组组织（组间分隔线）；
  // 任务 = 应用根（深链 ?type=media|file|magnet 均映射任务视图），
  // 队列/订阅/下载库走 ?type= 深链，与页面内导航完全同源。
  const taskActions: PanelAction[] = [
    {
      label: "任务",
      title: "任务（全部类型任务表）",
      active: isActive("/", "tasks"),
      // 列表图形：不能与 Logo 的下载托盘同款（应用标识优先占用）
      icon: (
        <svg className="h-[15px] w-[15px]" viewBox="0 0 24 24" {...stroke}>
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      ),
      onClick: () => navigate("/"),
    },
    {
      label: "队列",
      title: "队列（命名队列整队起停）",
      active: isActive("", "queues"),
      // 有序列表：队列 = 排队顺序语义
      icon: (
        <svg className="h-[15px] w-[15px]" viewBox="0 0 24 24" {...stroke}>
          <line x1="10" y1="6" x2="21" y2="6" />
          <line x1="10" y1="12" x2="21" y2="12" />
          <line x1="10" y1="18" x2="21" y2="18" />
          <path d="M4 6h1v4" />
          <path d="M4 10h2" />
          <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
        </svg>
      ),
      onClick: () => navigate("/?type=queues"),
    },
    {
      label: "订阅",
      title: "订阅（RSS 自动抓取下载）",
      active: isActive("", "rss"),
      icon: (
        <svg className="h-[15px] w-[15px]" viewBox="0 0 24 24" {...stroke}>
          <path d="M4 11a9 9 0 0 1 9 9" />
          <path d="M4 4a16 16 0 0 1 16 16" />
          <circle cx="5" cy="19" r="1" />
        </svg>
      ),
      onClick: () => navigate("/?type=rss"),
    },
  ];

  const libraryActions: PanelAction[] = [
    {
      label: "影视下载库",
      title: "影视下载库（影视产物管理）",
      active: isActive("", "movie"),
      // 电影胶片图形：影视语义（folder 是目录语义，用在这里没有常识）
      icon: (
        <svg className="h-[15px] w-[15px]" viewBox="0 0 24 24" {...stroke}>
          <rect x="2" y="2" width="20" height="20" rx="2.18" />
          <line x1="7" y1="2" x2="7" y2="22" />
          <line x1="17" y1="2" x2="17" y2="22" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <line x1="2" y1="7" x2="7" y2="7" />
          <line x1="2" y1="17" x2="7" y2="17" />
          <line x1="17" y1="17" x2="22" y2="17" />
          <line x1="17" y1="7" x2="22" y2="7" />
        </svg>
      ),
      onClick: () => navigate("/?type=movie"),
    },
    {
      label: "音乐下载库",
      title: "音乐下载库（音乐产物管理）",
      active: isActive("", "music"),
      icon: (
        <svg className="h-[15px] w-[15px]" viewBox="0 0 24 24" {...stroke}>
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      ),
      onClick: () => navigate("/?type=music"),
    },
  ];

  const actionButton = (a: PanelAction) => (
    <button
      key={a.label}
      onClick={a.onClick}
      title={a.title}
      className={`h-[34px] w-[34px] rounded-xl flex items-center justify-center transition-colors ${
        a.active
          ? "bg-indigo-600/10 text-indigo-600"
          : "text-gray-500 hover:bg-gray-900/5 hover:text-indigo-600 dark:text-gray-400 dark:hover:bg-white/10"
      }`}
    >
      {a.icon}
    </button>
  );

  if (!open) {
    return (
      <>
        <button
          onClick={() => toggle(true)}
          title="展开面板"
          className="fixed left-0 top-1/2 z-40 h-14 w-5 -translate-y-1/2 flex items-center justify-center rounded-r-lg bg-gradient-to-b from-indigo-500 to-purple-500 text-white shadow-lg transition-all hover:w-7"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" {...stroke}>
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
        <DownloadForm
          id="mediago-sidebar-new"
          ref={newFormRef}
          destroyOnClose
          onConfirm={() => navigate("/")}
        />
      </>
    );
  }

  return (
    <>
      <div className="fixed left-2 top-1/2 -translate-y-1/2 z-40 flex flex-col items-center gap-1 rounded-2xl border border-black/10 bg-white/75 p-1 shadow-lg backdrop-blur-xl dark:border-white/10 dark:bg-gray-900/70">
        {/* 应用信息区：Logo + 纵向名称（标准窄面板） */}
        <button
          onClick={() => navigate("/")}
          title="下载中心"
          className="flex flex-col items-center gap-1.5 rounded-xl px-0.5 py-1.5 transition-colors hover:bg-gray-900/5 dark:hover:bg-white/10"
        >
          <span className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 text-white shadow-md">
            <svg className="h-4 w-4" viewBox="0 0 24 24" {...stroke}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </span>
          <span className="select-none text-[10px] font-medium leading-none tracking-[0.18em] text-gray-700 [writing-mode:vertical-rl] dark:text-gray-300">
            下载中心
          </span>
        </button>
        <div className="h-px w-6 bg-black/10 dark:bg-white/10" />
        {/* 任务域视图组 */}
        {taskActions.map(actionButton)}
        <div className="h-px w-6 bg-black/10 dark:bg-white/10" />
        {/* 下载库组（影视/音乐产物管理平铺） */}
        {libraryActions.map(actionButton)}
        <div className="h-px w-6 bg-black/10 dark:bg-white/10" />
        {/* 新建下载（主操作） */}
        {actionButton({
          label: "新建",
          title: "新建下载",
          active: false,
          icon: (
            <svg className="h-[15px] w-[15px]" viewBox="0 0 24 24" {...stroke}>
              <path d="M12 5v14M5 12h14" />
            </svg>
          ),
          onClick: openNewForm,
        })}
        <button
          onClick={() => toggle(false)}
          title="收起面板"
          className="h-6 w-[34px] rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-900/5 dark:text-gray-400 dark:hover:bg-white/10 transition-colors"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" {...stroke}>
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
      </div>

      {/* 新建弹层（DownloadForm 内部自渲染 Modal，ref 驱动；新建成功后回到下载中心根，
          媒体任务在四 tab 的媒体面板里统一管理） */}
      <DownloadForm
        id="mediago-sidebar-new"
        ref={newFormRef}
        destroyOnClose
        onConfirm={() => {
          navigate("/");
        }}
      />
    </>
  );
};

export default MediagoSidebar;
