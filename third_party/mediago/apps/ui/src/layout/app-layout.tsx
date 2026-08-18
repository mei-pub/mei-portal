import { useAsyncEffect } from "ahooks";
import { type FC, useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { CHANGE_PAGE } from "@/const";
import { setAppStoreSelector, useAppStore } from "@/store/app";
import { tdApp } from "@/utils";
import { getConfig } from "@/api/config";

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
        // 门户胶囊顶栏占用 74px（topbar.js 注入 --mei-topbar-space）；独立部署时变量缺省 0
        height: 'calc(100dvh - var(--mei-topbar-space, 0px))',
        maxHeight: 'calc(100dvh - var(--mei-topbar-space, 0px))',
      }}
    >
      <div className="flex-1 min-h-0 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
};

export default App;
