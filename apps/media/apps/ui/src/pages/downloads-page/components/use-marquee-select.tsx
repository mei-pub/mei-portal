// 迅雷式多选交互集（下载中心任务列表/影视库/音乐库三列表共用，2026-10-13）
//   1. Cmd/Ctrl + 单击行 → 切换该行选中（记录锚点行，供范围选）
//   2. Shift + 单击行    → 锚点行到当前行的范围选择（替换当前选中；叠加 Cmd 则并集）
//   3. 列表区拖拽框选    → 与行相交即选中（起始按住 Cmd/Ctrl 则在现有选中上叠加）
//   4. 空白单击（无拖拽）→ 清空选中
//   5. 无修饰键单击行    → 已有选中集合时=反选该行（多选态单击语义）；
//      无任何选中时触发 open（打开行详情）
// 纯交互层：选中集合形态由调用方提供（isSelected/commit），行 key 为任务 id 或
// 记录 key 皆可；行内按钮/输入/链接上的按下不触发框选与行选（data-marquee-skip
// 可在任意子元素上显式豁免）。容器需 position:relative 以承载框选浮层。
import { useEffect, useRef, useState, type ReactNode } from "react";

export interface MarqueeSelectOptions<K> {
  /** 当前可见（过滤/排序/分组后）的有序行 key —— Shift 范围与框选命中都按它算 */
  rows: K[];
  isSelected: (key: K) => boolean;
  /** 替换整个选中集合（仅集合实际变化时回调） */
  commit: (next: Set<K>) => void;
  /** 无修饰键单击行（且当前无选中）→ 打开行详情 */
  open?: (key: K) => void;
}

export interface MarqueeSelectResult<K> {
  /** 挂到滚动容器上（需 self relative）；含 onMouseDown 与 ref */
  containerProps: {
    ref: (el: HTMLDivElement | null) => void;
    onMouseDown: (e: React.MouseEvent) => void;
  };
  /** 框选浮层（渲染进同一容器） */
  marqueeEl: ReactNode;
  /** 行接线属性：data-row-key + Cmd/Ctrl·Shift 点击处理 */
  rowProps: (key: K) => {
    "data-row-key": string;
    onClick: (e: React.MouseEvent) => void;
  };
}

const INTERACTIVE = "button, a, input, textarea, select, [role='button'], [data-marquee-skip]";

export function useMarqueeSelect<K extends string | number>({
  rows,
  isSelected,
  commit,
  open,
}: MarqueeSelectOptions<K>): MarqueeSelectResult<K> {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [marquee, setMarquee] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  // 行集合/选中判定/提交函数用 ref 承接，鼠标监听器注册一次即可总是拿到最新值
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const isSelectedRef = useRef(isSelected);
  isSelectedRef.current = isSelected;
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const openRef = useRef(open);
  openRef.current = open;

  /** 框选状态机（全部 ref，避免拖拽期间重渲染整树） */
  const stateRef = useRef({
    armed: false,
    dragging: false,
    startX: 0,
    startY: 0,
    /** 拖拽起始按下的位置在行上（空白单击清空只在非行位置成立） */
    onRow: false,
    /** 叠加选（按住 Cmd/Ctrl 起拖） */
    additive: false,
    /** 叠加选基线：起拖时的既有选中 */
    base: new Set<K>(),
    /** 上一次已提交集合（避免相同集合反复触发 commit） */
    lastCommitted: new Set<K>(),
  });
  /** Shift 范围选锚点（最近一次 Cmd/Ctrl·Shift 点击的行下标） */
  const anchorRef = useRef<number | null>(null);

  const setEquals = (a: Set<K>, b: Set<K>): boolean => {
    if (a.size !== b.size) return false;
    for (const k of a) if (!b.has(k)) return false;
    return true;
  };

  const commitIfChanged = (next: Set<K>) => {
    const st = stateRef.current;
    if (setEquals(next, st.lastCommitted)) return;
    st.lastCommitted = new Set(next);
    commitRef.current(next);
  };

  /** client 坐标矩形 → 相交行 key 集合（getBoundingClientRect 即 client 坐标）。
   *  行 key 经 data-row-key 字符化后再映射回原类型（number/string 不丢型） */
  const hitTest = (x1: number, y1: number, x2: number, y2: number): Set<K> => {
    const el = containerRef.current;
    const out = new Set<K>();
    if (!el) return out;
    const mx1 = Math.min(x1, x2);
    const mx2 = Math.max(x1, x2);
    const my1 = Math.min(y1, y2);
    const my2 = Math.max(y1, y2);
    const rawHits = new Set<string>();
    el.querySelectorAll<HTMLElement>("[data-row-key]").forEach((node) => {
      const r = node.getBoundingClientRect();
      if (r.right > mx1 && r.left < mx2 && r.bottom > my1 && r.top < my2) {
        rawHits.add(node.dataset.rowKey ?? "");
      }
    });
    if (rawHits.size > 0) {
      for (const k of rowsRef.current) {
        if (rawHits.has(String(k))) out.add(k);
      }
    }
    return out;
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const st = stateRef.current;
      if (!st.armed) return;
      if (!st.dragging) {
        if (Math.abs(e.clientX - st.startX) < 4 && Math.abs(e.clientY - st.startY) < 4)
          return;
        st.dragging = true;
        // 拖拽期间禁原生文本选择，避免框选变成蓝色划选
        document.body.classList.add("select-none");
      }
      const el = containerRef.current;
      if (el) {
        // 浮层画在容器滚动内容坐标系（+scrollLeft/Top），拖拽中容器不滚动即贴合
        const rect = el.getBoundingClientRect();
        const sx = st.startX - rect.left + el.scrollLeft;
        const sy = st.startY - rect.top + el.scrollTop;
        const cx = e.clientX - rect.left + el.scrollLeft;
        const cy = e.clientY - rect.top + el.scrollTop;
        setMarquee({
          left: Math.min(sx, cx),
          top: Math.min(sy, cy),
          width: Math.abs(cx - sx),
          height: Math.abs(cy - sy),
        });
      }
      const hits = hitTest(st.startX, st.startY, e.clientX, e.clientY);
      if (st.additive) {
        const merged = new Set(st.base);
        for (const k of hits) merged.add(k);
        commitIfChanged(merged);
      } else {
        commitIfChanged(hits);
      }
    };

    const onUp = () => {
      const st = stateRef.current;
      if (!st.armed) return;
      const wasDragging = st.dragging;
      st.armed = false;
      st.dragging = false;
      document.body.classList.remove("select-none");
      setMarquee(null);
      // 空白单击（未在行上、未发生拖拽）= 清空选中（迅雷行为）
      if (!wasDragging && !st.onRow) {
        if (st.lastCommitted.size > 0) {
          st.lastCommitted = new Set<K>();
          commitRef.current(new Set<K>());
        }
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.classList.remove("select-none");
    };
  }, []);

  return {
    containerProps: {
      ref: (el: HTMLDivElement | null) => {
        containerRef.current = el;
      },
      onMouseDown: (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        const target = e.target as HTMLElement | null;
        if (!target) return;
        if (target.closest(INTERACTIVE)) return;
        const st = stateRef.current;
        st.armed = true;
        st.dragging = false;
        st.startX = e.clientX;
        st.startY = e.clientY;
        st.onRow = Boolean(target.closest("[data-row-key]"));
        st.additive = e.metaKey || e.ctrlKey;
        st.base = new Set(
          rowsRef.current.filter((k) => isSelectedRef.current(k)),
        );
        st.lastCommitted = new Set(
          rowsRef.current.filter((k) => isSelectedRef.current(k)),
        );
      },
    },
    marqueeEl: marquee ? (
      <div
        className="pointer-events-none absolute z-10 rounded-md border border-blue-500/40 bg-blue-500/[0.08] dark:border-blue-400/40 dark:bg-blue-400/[0.08]"
        style={{
          left: marquee.left,
          top: marquee.top,
          width: marquee.width,
          height: marquee.height,
        }}
      />
    ) : null,
    rowProps: (key: K) => ({
      "data-row-key": String(key),
      onClick: (e: React.MouseEvent) => {
        const target = e.target as HTMLElement | null;
        if (!target || target.closest(INTERACTIVE)) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey) {
          e.preventDefault();
          const list = rowsRef.current;
          const idx = list.indexOf(key);
          if (idx === -1) return;
          const anchor = anchorRef.current ?? idx;
          const next = new Set<K>();
          if (e.shiftKey) {
            // 范围选择：锚点 → 当前行；叠加 Cmd/Ctrl 时并入既有选中
            for (let i = Math.min(anchor, idx); i <= Math.max(anchor, idx); i++) {
              const k = list[i];
              if (k !== undefined) next.add(k);
            }
            if (e.metaKey || e.ctrlKey) {
              for (const k of list) {
                if (isSelectedRef.current(k)) next.add(k);
              }
            }
            commitIfChanged(next);
            anchorRef.current = idx;
          } else {
            // Cmd/Ctrl 点选：切换该行，其余保持
            for (const k of list) {
              if (isSelectedRef.current(k)) next.add(k);
            }
            if (next.has(key)) next.delete(key);
            else next.add(key);
            commitIfChanged(next);
            anchorRef.current = idx;
          }
          return;
        }
        // 无修饰键单击：存在选中集合 → 反选该行（多选态单击语义）；
        // 无选中 → 打开行详情
        if (rowsRef.current.some((k) => isSelectedRef.current(k))) {
          e.preventDefault();
          const next = new Set(
            rowsRef.current.filter((k) => isSelectedRef.current(k)),
          );
          if (next.has(key)) next.delete(key);
          else next.add(key);
          commitIfChanged(next);
          anchorRef.current = Math.max(0, rowsRef.current.indexOf(key));
          return;
        }
        openRef.current?.(key);
      },
    }),
  };
}
