// iframe 保活的淘汰策略（纯逻辑，供 AppFrame 与单测复用）
//
// AGENTS.md 约束：上限 MAX_LIVE_FRAMES，淘汰最久未访问的；当前应用永不淘汰；
// 预热但未真正访问过的应用最先被淘汰。

export interface KeepaliveFrame {
  appId: string;
}

/**
 * 计算保活列表溢出时应淘汰的应用 id。
 *
 * 淘汰顺序（与预热逻辑一致）：
 *   1. 从未真正访问过的应用（只被预热挂载、不在访问顺序里）最先淘汰；
 *   2. 否则按访问顺序淘汰最久未访问的应用（LRU）；
 *   3. 当前应用永不淘汰；无可淘汰者返回 null（由调用方保留原状）。
 *
 * 历史缺陷：本函数落地前，真实访问触发的挂载只按 LRU 挑受害者，
 * 会让正在后台播音乐的应用（已访问但最久未动）先于纯预热的应用被销毁。
 */
export function pickEvictionVictim<T extends KeepaliveFrame>(
  candidates: readonly T[],
  currentAppId: string,
  visitedOrder: readonly string[]
): string | null {
  const cold = candidates.find((m) => m.appId !== currentAppId && !visitedOrder.includes(m.appId));
  if (cold) return cold.appId;
  const victim = visitedOrder.find(
    (a) => a !== currentAppId && candidates.some((m) => m.appId === a)
  );
  return victim || null;
}
