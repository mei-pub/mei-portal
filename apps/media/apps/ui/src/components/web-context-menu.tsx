// Web 右键菜单 —— 下载中心全部视图的管理操作入口。
// electron 客户端的 contextMenu.show 走 IPC 原生菜单，纯浏览器环境是
// stub（返回 null），因此自绘：onContextMenu 阻止默认 → 记录坐标渲染
// portal 浮层 → 点击项回调 / 点击外部·Esc·滚轮关闭。视口越界自动翻转。
import { type FC, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  /** 破坏性操作渲染为红色 */
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
}

interface MenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onAction: (key: string) => void;
}

const MENU_W = 176;
const ITEM_H = 32;

/** 页面级单例菜单：openMenu(e, items, onAction) 打开，返回受控浮层 */
export function useWebContextMenu() {
  const [state, setState] = useState<MenuState | null>(null);
  const stateRef = useRef<MenuState | null>(null);
  stateRef.current = state;

  const close = useCallback(() => setState(null), []);

  const openMenu = useCallback(
    (
      e: React.MouseEvent,
      items: ContextMenuItem[],
      onAction: (key: string) => void,
    ) => {
      e.preventDefault();
      e.stopPropagation();
      setState({ x: e.clientX, y: e.clientY, items, onAction });
    },
    [],
  );

  return { menu: state ? <WebContextMenu state={state} close={close} /> : null, openMenu, close };
}

const WebContextMenu: FC<{ state: MenuState; close: () => void }> = ({
  state,
  close,
}) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ x: state.x, y: state.y });

  // 视口越界翻转（渲染后量实际尺寸修正一次）
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setPos({
      x: Math.max(4, Math.min(state.x, vw - rect.width - 4)),
      y: Math.max(4, Math.min(state.y, vh - rect.height - 4)),
    });
  }, [state]);

  useEffect(() => {
    const onDown = (ev: MouseEvent) => {
      if (ref.current && !ref.current.contains(ev.target as Node)) close();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") close();
    };
    // mousedown 捕获阶段抢先于菜单项 click 之外的任何关闭路径
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("wheel", close, { passive: true });
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("wheel", close);
    };
  }, [close]);

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[1200] min-w-[176px] rounded-lg border border-black/[0.06] bg-white py-1 shadow-[0_8px_28px_rgba(0,0,0,0.18)] dark:border-white/10 dark:bg-[#27292F] dark:shadow-[0_8px_28px_rgba(0,0,0,0.5)]"
      style={{ left: pos.x, top: pos.y, maxHeight: "70vh", overflowY: "auto" }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {state.items.map((item) =>
        item.separator ? (
          <div key={`sep-${item.key}`} className="my-1 h-px bg-black/[0.06] dark:bg-white/10" />
        ) : (
          <button
            key={item.key}
            type="button"
            disabled={item.disabled}
            className={`flex w-full items-center gap-2 px-3 text-left text-[13px] leading-[32px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              item.danger
                ? "text-[#e5484d] hover:bg-[#e5484d]/[0.08]"
                : "text-[rgba(0,0,0,0.85)] hover:bg-black/[0.05] dark:text-[rgba(255,255,255,0.86)] dark:hover:bg-white/[0.08]"
            }`}
            style={{ height: ITEM_H }}
            onClick={() => {
              close();
              item.disabled ? undefined : state.onAction(item.key);
            }}
          >
            {item.icon}
            <span className="truncate">{item.label}</span>
          </button>
        ),
      )}
    </div>,
    document.body,
  );
};
