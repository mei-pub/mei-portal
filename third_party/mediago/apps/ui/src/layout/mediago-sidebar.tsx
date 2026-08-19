// mei-allin：左侧浮动面板替代顶栏 + 弹层
// 三个入口：新建（弹层）、下载中（切换主体）、已完成（切换主体）
import { DownloadFilter } from "@mediago/shared-common";
import { Modal } from "antd";
import { type FC, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import DownloadForm, { type DownloadFormItem } from "@/components/download-form";
import { useConfigStore, downloadFormSelector } from "@/store/config";
import { useShallow } from "zustand/react/shallow";

const MEDIAGO_SIDEBAR_KEY = "mei-float-mediago";

const MediagoSidebar: FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(MEDIAGO_SIDEBAR_KEY) !== "1"; } catch { return true; }
  });
  const [newFormOpen, setNewFormOpen] = useState(false);
  const { lastIsBatch, lastDownloadTypes } = useConfigStore(useShallow(downloadFormSelector));

  const toggle = (next: boolean) => {
    setOpen(next);
    try { localStorage.setItem(MEDIAGO_SIDEBAR_KEY, next ? "0" : "1"); } catch {}
  };

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/media/" || location.pathname === "/media";
    return location.pathname === path;
  };

  const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

  const actions = [
    {
      label: "新建",
      title: "新建下载",
      icon: (
        <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" {...stroke}>
          <path d="M12 5v14M5 12h14"/>
        </svg>
      ),
      onClick: () => setNewFormOpen(true),
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

  return (
    <>
      <div className="shrink-0 flex flex-col items-center gap-1 p-1.5 ml-1.5 my-1 rounded-2xl bg-white/80 dark:bg-gray-900/70 backdrop-blur-lg border border-black/10 dark:border-white/10 shadow-sm">
        {!open ? (
          <button
            onClick={() => toggle(true)}
            title="展开菜单"
            className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-500 hover:bg-gray-900/5 hover:text-indigo-600 dark:text-gray-400 dark:hover:bg-white/10 transition-colors"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" {...stroke}>
              <path d="m9 18 6-6-6-6"/>
            </svg>
          </button>
        ) : (
          <>
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
          </>
        )}
      </div>

      {/* 新建弹层 */}
      <Modal
        open={newFormOpen}
        onCancel={() => setNewFormOpen(false)}
        footer={null}
        title={null}
        width="700px"
        styles={{ body: { paddingTop: 8 } }}
        destroyOnHidden
      >
        <DownloadForm
          id="mediago-sidebar-new"
          destroyOnClose
          onConfirm={() => {
            setNewFormOpen(false);
            navigate("/");
          }}
        />
      </Modal>
    </>
  );
};

export default MediagoSidebar;