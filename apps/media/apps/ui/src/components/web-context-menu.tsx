// Web 右键菜单 —— 下载中心全部视图的管理操作入口。
// electron 客户端的 contextMenu.show 走 IPC 原生菜单，纯浏览器环境是
// stub（返回 null），因此自绘：onContextMenu 阻止默认 → 记录坐标渲染
// portal 浮层 → 点击项回调 / 点击外部·Esc·滚轮关闭。视口越界自动翻转。
// 带子项的条目渲染为二级菜单（hover / 点击展开，锚定父项右侧，越界翻转）。
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
  /** 有子项者渲染为二级菜单（hover / 点击展开）；父项自身点击只切换子菜单，
   *  不触发 onAction。仅支持一层子菜单，子项不再嵌套 children */
  children?: ContextMenuItem[];
}

interface MenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onAction: (key: string) => void;
}

interface SubState {
  item: ContextMenuItem;
  /** 父项矩形（翻转子菜单时需要父项左边界） */
  anchor: { left: number; top: number; right: number };
  x: number;
  y: number;
}

/** 页面级单例菜单：openMenu(e, items, onAction) 打开，返回受控浮层 */
export function useWebContextMenu() {
  const [state, setState] = useState<MenuState | null>(null);

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

const MENU_BOX_CLS =
  "absolute z-[1200] min-w-[200px] rounded-xl border border-black/[0.06] bg-white/95 p-1 shadow-[0_1px_2px_rgba(0,0,0,0.05),0_10px_32px_rgba(0,0,0,0.16)] backdrop-blur-md dark:border-white/10 dark:bg-[#25272C]/95 dark:shadow-[0_1px_2px_rgba(0,0,0,0.4),0_10px_32px_rgba(0,0,0,0.55)]";

const ITEM_CLS =
  "flex h-[32px] w-[calc(100%-8px)] items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-40";

/** 子菜单预估宽度（挂载后按实测再修正一次翻转） */
const SUB_W_ESTIMATE = 210;

const WebContextMenu: FC<{ state: MenuState; close: () => void }> = ({
  state,
  close,
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const subRef = useRef<HTMLDivElement | null>(null);
  const itemEls = useRef(new Map<string, HTMLButtonElement>());
  const [pos, setPos] = useState({ x: state.x, y: state.y });
  const [sub, setSub] = useState<SubState | null>(null);

  // 主浮层视口越界翻转（渲染后量实际尺寸修正一次）
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setPos({
      x: Math.max(4, Math.min(state.x, vw - rect.width - 4)),
      y: Math.max(4, Math.min(state.y, vh - rect.height - 4)),
    });
  }, [state]);

  // 子菜单挂载后按实测尺寸二次修正：右侧放不下翻转到父项左侧，纵向夹紧
  useEffect(() => {
    if (!sub) return;
    const el = subRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let { x, y } = sub;
    if (x + rect.width > vw - 4) x = Math.max(4, sub.anchor.left - rect.width - 6);
    if (y + rect.height > vh - 4) y = Math.max(4, vh - rect.height - 4);
    if (x !== sub.x || y !== sub.y) setSub({ ...sub, x, y });
  }, [sub]);

  useEffect(() => {
    const onDown = (ev: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(ev.target as Node)) close();
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

  const setItemEl = (key: string, el: HTMLButtonElement | null) => {
    if (el) itemEls.current.set(key, el);
    else itemEls.current.delete(key);
  };

  const openSubmenu = (item: ContextMenuItem) => {
    const el = itemEls.current.get(item.key);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    let x = r.right + 6;
    // 预估宽度兜底翻转（实测修正见挂载后 effect）
    if (x + SUB_W_ESTIMATE > vw - 4) x = Math.max(4, r.left - SUB_W_ESTIMATE - 6);
    setSub({ item, anchor: { left: r.left, top: r.top, right: r.right }, x, y: r.top - 5 });
  };

  // 渲染单条菜单目（主菜单与子菜单共用；子项不走 children 递归）
  const renderItem = (item: ContextMenuItem, isSub: boolean) => {
    const hasChildren = Boolean(item.children?.length);
    return item.separator ? (
      <div
        key={`sep-${item.key}`}
        className="mx-2 my-1 h-px bg-black/[0.06] dark:bg-white/10"
      />
    ) : (
      <button
        key={item.key}
        ref={(el) => setItemEl(item.key, el)}
        type="button"
        disabled={item.disabled}
        className={`${ITEM_CLS} ${
          item.danger
            ? "text-[#e5484d] hover:bg-[#e5484d]/[0.08]"
            : "text-[rgba(0,0,0,0.85)] hover:bg-black/[0.05] dark:text-[rgba(255,255,255,0.86)] dark:hover:bg-white/[0.08]"
        } ${
          hasChildren && sub?.item.key === item.key
            ? "bg-black/[0.05] dark:bg-white/[0.08]"
            : ""
        }`}
        onMouseEnter={() => {
          // 子菜单本身项 hover 不参与父级切换，否则移入子菜单即关自身
          if (isSub) return;
          if (hasChildren) {
            if (sub?.item.key !== item.key) openSubmenu(item);
          } else if (sub) {
            setSub(null);
          }
        }}
        onClick={() => {
          // 父项点击只切换子菜单（不关闭、不触发 onAction）
          if (hasChildren) {
            if (sub?.item.key === item.key) setSub(null);
            else openSubmenu(item);
            return;
          }
          close();
          item.disabled ? undefined : state.onAction(item.key);
        }}
      >
        {"icon" in item && item.icon ? (
          <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[14px] leading-none opacity-80">
            {item.icon}
          </span>
        ) : null}
        <span className="truncate">{item.label}</span>
        {hasChildren ? (
          <span className="ml-auto shrink-0 text-[11px] leading-none opacity-50">▸</span>
        ) : null}
      </button>
    );
  };

  return createPortal(
    <>
      {/* 入场动画 keyframes(单例浮层,随渲染注入) */}
      <style>{`@keyframes ctx-menu-in { from { opacity: 0; transform: scale(0.95) translateY(-3px); } to { opacity: 1; transform: none; } }`}</style>
      {/* 全视口命中采集根：主/子浮层共用一个 portal 根以便「点击外部」判定
          同时覆盖两层；pointer-events none 让页面点击穿透（target 不在根内），
          浮层本体重新启用 pointer-events */}
      <div ref={rootRef} className="fixed inset-0 z-[1200]" style={{ pointerEvents: "none" }}>
        <div
          ref={boxRef}
          className={`${MENU_BOX_CLS} pointer-events-auto`}
          style={{
            left: pos.x,
            top: pos.y,
            maxHeight: "70vh",
            overflowY: "auto",
            animation: "ctx-menu-in 0.14s ease-out",
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {state.items.map((item) => renderItem(item, false))}
        </div>
        {sub ? (
          <div
            ref={subRef}
            className={`${MENU_BOX_CLS} pointer-events-auto`}
            style={{
              left: sub.x,
              top: sub.y,
              maxHeight: "60vh",
              overflowY: "auto",
              animation: "ctx-menu-in 0.12s ease-out",
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            {(sub.item.children ?? []).map((child) => renderItem(child, true))}
          </div>
        ) : null}
      </div>
    </>,
    document.body,
  );
};
