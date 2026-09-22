// 下载中心统一节流轮询：影视/音乐两个数据源都只在「有进行中任务」时需要 3s 刷新，
// 但「全部」tab 会同时挂载两份面板。所有轮询注册到模块级**单一** interval，
// 页面内任意数量的 useSharedPoll 共用一个计时器，最后一个注销时自动停止。
import { useEffect } from "react";

type Listener = () => void;

const INTERVAL = 3000;
const listeners = new Set<Listener>();
let timer: ReturnType<typeof setInterval> | null = null;

function syncTimer() {
  if (timer == null && listeners.size > 0) {
    timer = setInterval(() => {
      listeners.forEach((fn) => fn());
    }, INTERVAL);
  } else if (timer != null && listeners.size === 0) {
    clearInterval(timer);
    timer = null;
  }
}

/**
 * active 为 true 时每 3s 调用一次 fn（fn 需引用稳定，如 SWR 的 mutate）。
 * 多实例（全部 tab 下影视+音乐同屏）共享同一计时器，不会叠加多份轮询。
 */
export function useSharedPoll(active: boolean, fn: Listener) {
  useEffect(() => {
    if (!active) return;
    listeners.add(fn);
    syncTimer();
    return () => {
      listeners.delete(fn);
      syncTimer();
    };
  }, [active, fn]);
}
