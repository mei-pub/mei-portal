// mei-portal 标准左侧面板（数据驱动）：应用信息（Logo + 纵向名称）+ 行动入口
// 组件契约见仓库根 AGENTS.md「顶栏与左侧面板组件化强约束」
// 行动入口：下载中心（应用根 /）/ 新建（弹层）；下载列表/下载完成已整合进四 tab
import { type FC, useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import DownloadForm, {
  type DownloadFormItem,
  type DownloadFormRef,
} from "@/components/download-form";
import { downloadFormSelector, useConfigStore } from "@/store/config";

const STORE_KEY = "mei-float-mediago";

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
  const [open, setOpen] = useState(true);
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

  const isActive = (path: string) => {
    // 根路由（下载中心）：覆盖带 /downloads basename 与根路径两种部署形态
    if (path === "/") return location.pathname === "/downloads/" || location.pathname === "/downloads" || location.pathname === "/";
    return location.pathname === path;
  };

  const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

  // 面板数据：行动入口（图标 + 激活态 + 响应事件）；「下载中心」是应用根，放首位
  const actions: PanelAction[] = [
    // 统一下载中心（应用根 /，四 tab：全部为默认，深链 ?type=media|movie|music）
    {
      label: "下载中心",
      title: "下载中心（媒体 / 影视 / 音乐）",
      active: isActive("/"),
      icon: (
        <svg className="h-[15px] w-[15px]" viewBox="0 0 24 24" {...stroke}>
          <polygon points="12 2 2 7 12 12 22 7 12 2"/>
          <polyline points="2 17 12 22 22 17"/>
          <polyline points="2 12 12 17 22 12"/>
        </svg>
      ),
      onClick: () => navigate("/"),
    },
    {
      label: "新建",
      title: "新建下载",
      active: false,
      icon: (
        <svg className="h-[15px] w-[15px]" viewBox="0 0 24 24" {...stroke}>
          <path d="M12 5v14M5 12h14"/>
        </svg>
      ),
      onClick: openNewForm,
    },
  ];

  if (!open) {
    return (
      <>
        <button
          onClick={() => toggle(true)}
          title="展开面板"
          className="fixed left-0 top-1/2 z-40 h-14 w-5 -translate-y-1/2 flex items-center justify-center rounded-r-lg bg-gradient-to-b from-indigo-500 to-purple-500 text-white shadow-lg transition-all hover:w-7"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" {...stroke}>
            <path d="m9 18 6-6-6-6"/>
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
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </span>
          <span className="select-none text-[10px] font-medium leading-none tracking-[0.18em] text-gray-700 [writing-mode:vertical-rl] dark:text-gray-300">下载中心</span>
        </button>
        <div className="h-px w-6 bg-black/10 dark:bg-white/10" />
        {actions.map(a => (
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
        ))}
        <button
          onClick={() => toggle(false)}
          title="收起面板"
          className="h-6 w-[34px] rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-900/5 dark:text-gray-400 dark:hover:bg-white/10 transition-colors"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" {...stroke}>
            <path d="m15 18-6-6 6-6"/>
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
