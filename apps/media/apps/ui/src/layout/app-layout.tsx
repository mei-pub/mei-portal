import { useAsyncEffect } from "ahooks";
import { type FC, useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { CHANGE_PAGE } from "@/const";
import { setAppStoreSelector, useAppStore } from "@/store/app";
import { tdApp } from "@/utils";
import { getConfig } from "@/api/config";
import { InlineVideoPlayer } from "@/pages/downloads-page/components/inline-player";
import MediagoSidebar, { useRailOpen } from "./mediago-sidebar";

const App: FC = () => {
  const location = useLocation();
  const railOpen = useRailOpen((s) => s.open);
  const { setAppStore } = useAppStore(useShallow(setAppStoreSelector));

  useAsyncEffect(async () => {
    try {
      const configData = await getConfig();
      setAppStore(configData as unknown as Record<string, unknown>);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    tdApp.onEvent(CHANGE_PAGE, { page: location.pathname });
  }, [location.pathname]);

  return (
    // 内嵌播放弹层 Provider 提升到布局层：所有内页（下载中心/新建/转换器等）
    // 的就地播放动作都有弹层；无 Provider 时 play-actions 会退化为 window.open
    <InlineVideoPlayer>
    <div
      // 底色已提到 body（见 globals.css）：这里保持透明，让 body 底色铺到门户胶囊下方
      className="flex w-full flex-col overflow-hidden"
      style={{
        height: 'calc(100dvh - var(--mei-topbar-space, 0px))',
        maxHeight: 'calc(100dvh - var(--mei-topbar-space, 0px))',
      }}
    >
      {/* 左侧浮动面板（fixed 定位，不占布局空间，与 AI 绘图面板一致）；
          开启时内容区左避让 62px（胶囊右缘 ~52px + 10px 间距），避免胶囊盖住
          贴左缘的文本与控件；收起只余 20px 拉手，避让随之取消） */}
      <div
        className={`flex flex-1 min-h-0 overflow-hidden transition-[padding] duration-300 ease-out ${
          railOpen ? "pl-[62px]" : ""
        }`}
      >
        <MediagoSidebar />
        <div className="flex-1 min-h-0 overflow-hidden mx-auto w-full max-w-[1200px]">
          <Outlet />
        </div>
      </div>
    </div>
    </InlineVideoPlayer>
  );
};

export default App;
