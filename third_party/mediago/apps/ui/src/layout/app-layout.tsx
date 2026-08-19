import { useAsyncEffect } from "ahooks";
import { type FC, useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { CHANGE_PAGE } from "@/const";
import { setAppStoreSelector, useAppStore } from "@/store/app";
import { tdApp } from "@/utils";
import { getConfig } from "@/api/config";
import MediagoSidebar from "./mediago-sidebar";

const App: FC = () => {
  const location = useLocation();
  const { setAppStore } = useAppStore(useShallow(setAppStoreSelector));

  useAsyncEffect(async () => {
    try {
      const configData = await getConfig();
      setAppStore(configData as Record<string, unknown>);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    tdApp.onEvent(CHANGE_PAGE, { page: location.pathname });
  }, [location.pathname]);

  return (
    <div
      className="flex w-full flex-col overflow-hidden bg-[#F4F7FA] dark:bg-[#141415]"
      style={{
        height: 'calc(100dvh - var(--mei-topbar-space, 0px))',
        maxHeight: 'calc(100dvh - var(--mei-topbar-space, 0px))',
      }}
    >
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* 左侧面板 */}
        <MediagoSidebar />
        <div className="flex-1 min-h-0 overflow-hidden mx-auto w-full max-w-[1200px]">
          <Outlet />
        </div>
      </div>
    </div>
  );
};

export default App;
