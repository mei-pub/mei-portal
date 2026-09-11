// 内嵌播放弹层 —— 下载中心已完成条目就地播放（/videos/:id 直播流，
// media core 免鉴权 Range 端点），关闭即回列表。
// 取代原先跳独立播放器页（/downloads/player）的方案：那个页面没有返回路径，
// 用户看完回不到下载中心（实测反馈）。
//
// 经 Context 注入 play(target)：下载中心页挂 Provider 弹层播放；
// 在没有 Provider 的场景（home-page 复用 DownloadList）回退 window.open
// 直开 /videos/N 裸流（浏览器原生播放器自带返回）。
import { Modal } from "antd";
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type FC,
  type ReactNode,
} from "react";

export interface InlineVideoTarget {
  title: string;
  url: string;
}

interface InlinePlayerApi {
  play: (target: InlineVideoTarget) => void;
}

const defaultApi: InlinePlayerApi = {
  play: (target) => {
    window.open(target.url, "_blank");
  },
};

const InlinePlayerContext = createContext<InlinePlayerApi>(defaultApi);

/** 在下载中心（挂了 Provider）内就地弹层播放；无 Provider 场景回退新标签直开 */
export const useInlinePlayer = (): InlinePlayerApi => useContext(InlinePlayerContext);

export const InlineVideoPlayer: FC<{ children: ReactNode }> = ({ children }) => {
  const [target, setTarget] = useState<InlineVideoTarget | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const play = useCallback((t: InlineVideoTarget) => setTarget(t), []);
  // Modal 关闭只是隐藏（display:none 不会自动暂停媒体），必须显式 pause，
  // 否则弹层关了声音还在播（实测踩过）
  const close = useCallback(() => {
    videoRef.current?.pause();
    setTarget(null);
  }, []);

  return (
    <InlinePlayerContext.Provider value={{ play }}>
      {children}
      <Modal
        open={target !== null}
        title={target?.title || "播放"}
        footer={null}
        width="auto"
        destroyOnHidden
        styles={{ body: { padding: 0, background: "#000" } }}
        onCancel={close}
      >
        {target && (
          <video
            key={target.url}
            ref={videoRef}
            controls
            autoPlay
            src={target.url}
            style={{ display: "block", width: "100%", maxHeight: "72vh", background: "#000" }}
          />
        )}
      </Modal>
    </InlinePlayerContext.Provider>
  );
};
