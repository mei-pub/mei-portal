// mei-allin：左侧浮动操作面板 —— 与 AI 绘图等应用的 AppSidebar 同一组件结构，仅内容不同
// 三个入口：新建（弹层）、下载中（切换主体）、已完成（切换主体）
// 固定悬浮于左缘中段；收起态为左缘渐变把手；展开/收起 localStorage 记忆
import { type FC, useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import DownloadForm, {
  type DownloadFormItem,
  type DownloadFormRef,
} from "@/components/download-form";
import { downloadFormSelector, useConfigStore } from "@/store/config";

const STORE_KEY = "mei-float-mediago";

const MediagoSidebar: FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState<boolean | null>(null);
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

  // 初始：记忆优先，默认展开
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      if (saved === "1") setOpen(false);
      else setOpen(true);
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
    if (path === "/") return location.pathname === "/media/" || location.pathname === "/media" || location.pathname === "/";
    return location.pathname === path;
  };

  const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

  const actions = [
    {
      label: "新建",
      title: "新建下载",
      active: false,
      icon: (
        <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" {...stroke}>
          <path d="M12 5v14M5 12h14"/>
        </svg>
      ),
      onClick: openNewForm,
    },
    {
      label: "下载中",
      title: "下载列表",
      active: isActive("/"),
      icon: (
        <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" {...stroke}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      ),
      onClick: () => navigate("/"),
    },
    {
      label: "已完成",
      title: "下载完成",
      active: isActive("/done"),
      icon: (
        <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" {...stroke}>
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      ),
      onClick: () => navigate("/done"),
    },
  ];

  // 初始 null（首帧）按收起把手渲染，避免闪烁
  const expanded = open === true;

  return (
    <>
      {!expanded ? (
        // 收起态：紧贴左缘的渐变小把手（与 AI 绘图一致）
        <button
          onClick={() => toggle(true)}
          title="展开菜单"
          className="fixed left-0 top-1/2 z-40 h-16 w-6 -translate-y-1/2 flex items-center justify-center rounded-r-xl bg-gradient-to-b from-indigo-500 to-purple-500 text-white shadow-lg transition-all hover:w-8"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" {...stroke}>
            <path d="m9 18 6-6-6-6"/>
          </svg>
        </button>
      ) : (
        // 展开态：左缘中段浮动玻璃面板（与 AI 绘图一致）
        <div className="fixed left-3 top-1/2 -translate-y-1/2 z-40 flex flex-col items-center gap-1 p-1.5 rounded-2xl bg-white/75 dark:bg-gray-900/70 backdrop-blur-xl border border-black/10 dark:border-white/10 shadow-lg">
          {actions.map(a => (
            <button
              key={a.label}
              onClick={a.onClick}
              title={a.title}
              className={`w-10 h-11 rounded-xl flex flex-col items-center justify-center transition-colors ${
                a.active
                  ? "bg-indigo-600/10 text-indigo-600"
                  : "text-gray-500 hover:bg-gray-900/5 hover:text-indigo-600 dark:text-gray-400 dark:hover:bg-white/10"
              }`}
            >
              {a.icon}
              <span className="text-[9px] leading-none mt-0.5">{a.label}</span>
            </button>
          ))}
          <button
            onClick={() => toggle(false)}
            title="收起菜单"
            className="w-10 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-900/5 dark:hover:bg-white/10 transition-colors"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" {...stroke}>
              <path d="m15 18-6-6 6-6"/>
            </svg>
          </button>
        </div>
      )}

      {/* 新建弹层（DownloadForm 内部自渲染 Modal，ref 驱动；新建成功后回到下载列表） */}
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
