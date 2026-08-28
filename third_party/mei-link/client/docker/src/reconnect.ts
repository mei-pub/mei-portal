// 自动重连策略（纯逻辑，不含定时器与 IO，便于单测）。
//
// 两种重连方式：
// - reconnect：只让 frpc 重新登录服务端（保持进程，走 start 流程重挂代理）
// - restart：先停掉 frpc 进程再完整拉起（用于进程僵死/配置漂移）
//
// 设置类故障（如 Token 错误）重试多少次都不会好，必须停下来引导用户去设置页，
// 否则会变成无意义的死循环刷日志。

import { classifySetupError } from "./setup-error.ts";

export type ReconnectMode = "reconnect" | "restart";

export interface ReconnectSettings {
  /** 是否开启自动重连 */
  enabled: boolean;
  /** 重连间隔（秒） */
  intervalSeconds: number;
  /** 重连方式 */
  mode: ReconnectMode;
  /** 连续失败多少次后停止自动重连；0 表示不限次数 */
  maxAttempts: number;
}

export const DEFAULT_RECONNECT: ReconnectSettings = {
  enabled: true,
  intervalSeconds: 30,
  mode: "reconnect",
  maxAttempts: 0,
};

const MIN_INTERVAL = 5;
const MAX_INTERVAL = 3600;

export function normalizeReconnect(input: Partial<ReconnectSettings> | null | undefined): ReconnectSettings {
  const raw = input || {};
  const interval = Number(raw.intervalSeconds);
  const attempts = Number(raw.maxAttempts);
  return {
    enabled: raw.enabled !== false,
    intervalSeconds: Number.isFinite(interval)
      ? Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, Math.round(interval)))
      : DEFAULT_RECONNECT.intervalSeconds,
    mode: raw.mode === "restart" ? "restart" : "reconnect",
    maxAttempts: Number.isFinite(attempts) && attempts > 0 ? Math.round(attempts) : 0,
  };
}

export interface ReconnectContext {
  /** 用户是否主动要求隧道处于连接状态（主动 stop 后不应自动拉起） */
  desired: boolean;
  /** 是否已配置服务器 */
  configured: boolean;
  /** frpc 是否已登录服务端 */
  connected: boolean;
  /** 已连续尝试次数 */
  attempts: number;
  /** 最近一次失败原因，用于判定是否为设置类故障 */
  lastError?: string;
}

export type ReconnectDecision =
  | { act: false; reason: "disabled" | "not-desired" | "not-configured" | "connected" | "attempts-exhausted" | "setup-required" }
  | { act: true; mode: ReconnectMode; escalated: boolean };

/**
 * 判定当前是否应该发起一次自动重连。
 * 认证不符、根本没配、域名冲突这类设置故障不重试：重试无法修好配置，只会掩盖
 * 真正要用户处理的问题。但「端口连不上 / 管理接口未就绪」同样可能只是服务端在
 * 重启或网络抖动，那正是自动重连要救的场景，按 retryable 继续尝试。
 *
 * 次数上限（maxAttempts > 0）下走两段式：
 * - 方式为 reconnect：前 maxAttempts 次重新连接；打满后自动升级为重启，再给 maxAttempts 次，
 *   两段都失败才彻底停止。重新登录修不好的故障（进程僵死、配置漂移）常常重启能恢复。
 * - 方式为 restart：本身已是最重手段，没有可升级的方式，打满即停止。
 * 不限次数（maxAttempts = 0）时没有升级点，保持所选方式持续重试。
 */
export function decideReconnect(settings: ReconnectSettings, ctx: ReconnectContext): ReconnectDecision {
  if (!settings.enabled) return { act: false, reason: "disabled" };
  if (!ctx.desired) return { act: false, reason: "not-desired" };
  if (!ctx.configured) return { act: false, reason: "not-configured" };
  if (ctx.connected) return { act: false, reason: "connected" };
  if (ctx.lastError) {
    const setup = classifySetupError(ctx.lastError);
    if (setup && !setup.retryable) return { act: false, reason: "setup-required" };
  }
  if (settings.maxAttempts <= 0) return { act: true, mode: settings.mode, escalated: false };
  if (ctx.attempts < settings.maxAttempts) return { act: true, mode: settings.mode, escalated: false };
  // 第一段打满：reconnect 升级为 restart 再试一段；restart 已无更重的手段可用。
  if (settings.mode === "reconnect" && ctx.attempts < settings.maxAttempts * 2) {
    return { act: true, mode: "restart", escalated: true };
  }
  return { act: false, reason: "attempts-exhausted" };
}

/**
 * 当前处于哪一段重试，供状态展示与日志区分「重连段」与「升级后的重启段」。
 * 只有 reconnect + 有次数上限才存在升级段。
 */
export function reconnectPhase(settings: ReconnectSettings, attempts: number): "primary" | "escalated" {
  if (settings.maxAttempts <= 0 || settings.mode !== "reconnect") return "primary";
  return attempts >= settings.maxAttempts ? "escalated" : "primary";
}

/** 本轮自动重连总共允许的尝试次数（含升级段）。0 表示不限。 */
export function totalAllowedAttempts(settings: ReconnectSettings): number {
  if (settings.maxAttempts <= 0) return 0;
  return settings.mode === "reconnect" ? settings.maxAttempts * 2 : settings.maxAttempts;
}
