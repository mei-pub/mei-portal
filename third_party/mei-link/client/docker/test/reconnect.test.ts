import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RECONNECT, decideReconnect, normalizeReconnect, reconnectPhase, totalAllowedAttempts } from "../src/reconnect.ts";

const base = { desired: true, configured: true, connected: false, attempts: 0 };

test("normalizeReconnect clamps the interval and falls back to a safe default", () => {
  assert.equal(normalizeReconnect({ intervalSeconds: 1 }).intervalSeconds, 5);
  assert.equal(normalizeReconnect({ intervalSeconds: 99_999 }).intervalSeconds, 3600);
  assert.equal(normalizeReconnect({ intervalSeconds: Number.NaN }).intervalSeconds, DEFAULT_RECONNECT.intervalSeconds);
  assert.equal(normalizeReconnect(null).intervalSeconds, DEFAULT_RECONNECT.intervalSeconds);
});

test("normalizeReconnect only accepts the two supported modes", () => {
  assert.equal(normalizeReconnect({ mode: "restart" }).mode, "restart");
  assert.equal(normalizeReconnect({ mode: "reconnect" }).mode, "reconnect");
  assert.equal(normalizeReconnect({ mode: "explode" as never }).mode, "reconnect");
});

test("normalizeReconnect treats a non-positive attempt cap as unlimited", () => {
  assert.equal(normalizeReconnect({ maxAttempts: -3 }).maxAttempts, 0);
  assert.equal(normalizeReconnect({ maxAttempts: 4 }).maxAttempts, 4);
});

test("decideReconnect reconnects with the configured mode while disconnected", () => {
  assert.deepEqual(decideReconnect(normalizeReconnect({}), base), { act: true, mode: "reconnect", escalated: false });
  assert.deepEqual(decideReconnect(normalizeReconnect({ mode: "restart" }), base), { act: true, mode: "restart", escalated: false });
});

test("decideReconnect stays idle when the user did not ask for a connection", () => {
  assert.deepEqual(decideReconnect(normalizeReconnect({}), { ...base, desired: false }), { act: false, reason: "not-desired" });
  assert.deepEqual(decideReconnect(normalizeReconnect({}), { ...base, connected: true }), { act: false, reason: "connected" });
  assert.deepEqual(decideReconnect(normalizeReconnect({}), { ...base, configured: false }), { act: false, reason: "not-configured" });
  assert.deepEqual(decideReconnect(normalizeReconnect({ enabled: false }), base), { act: false, reason: "disabled" });
});

test("decideReconnect refuses to retry a setup failure that retries cannot fix", () => {
  const decision = decideReconnect(normalizeReconnect({}), { ...base, lastError: "域名拉取 token 错误" });
  assert.deepEqual(decision, { act: false, reason: "setup-required" });
});

test("decideReconnect keeps retrying setup failures that a restart could fix", () => {
  // 端口连不上、管理接口未就绪同样可能只是服务端在重启，正是自动重连要救的场景
  assert.deepEqual(
    decideReconnect(normalizeReconnect({}), { ...base, lastError: "dial tcp 10.0.0.2:7000: connect: ECONNREFUSED" }),
    { act: true, mode: "reconnect", escalated: false },
  );
  assert.deepEqual(
    decideReconnect(normalizeReconnect({}), { ...base, lastError: "Admin API 未就绪: fetch failed" }),
    { act: true, mode: "reconnect", escalated: false },
  );
});

test("decideReconnect keeps retrying transient network failures", () => {
  const decision = decideReconnect(normalizeReconnect({}), { ...base, lastError: "socket hang up" });
  assert.deepEqual(decision, { act: true, mode: "reconnect", escalated: false });
});

test("decideReconnect escalates from reconnect to restart once the cap is hit", () => {
  const capped = normalizeReconnect({ mode: "reconnect", maxAttempts: 3 });
  // 第一段：按所选方式重新连接
  assert.deepEqual(decideReconnect(capped, { ...base, attempts: 2 }), { act: true, mode: "reconnect", escalated: false });
  // 打满后自动升级为重启，并再获得同样多的尝试次数
  assert.deepEqual(decideReconnect(capped, { ...base, attempts: 3 }), { act: true, mode: "restart", escalated: true });
  assert.deepEqual(decideReconnect(capped, { ...base, attempts: 5 }), { act: true, mode: "restart", escalated: true });
  // 两段都打满才彻底停止
  assert.deepEqual(decideReconnect(capped, { ...base, attempts: 6 }), { act: false, reason: "attempts-exhausted" });
});

test("decideReconnect has nothing to escalate to when restart is already the chosen mode", () => {
  const capped = normalizeReconnect({ mode: "restart", maxAttempts: 3 });
  assert.deepEqual(decideReconnect(capped, { ...base, attempts: 2 }), { act: true, mode: "restart", escalated: false });
  assert.deepEqual(decideReconnect(capped, { ...base, attempts: 3 }), { act: false, reason: "attempts-exhausted" });
});

test("decideReconnect never escalates when attempts are unlimited", () => {
  const decision = decideReconnect(normalizeReconnect({ maxAttempts: 0 }), { ...base, attempts: 999 });
  assert.deepEqual(decision, { act: true, mode: "reconnect", escalated: false });
});

test("reconnectPhase and totalAllowedAttempts describe the two-stage budget", () => {
  const capped = normalizeReconnect({ mode: "reconnect", maxAttempts: 3 });
  assert.equal(reconnectPhase(capped, 2), "primary");
  assert.equal(reconnectPhase(capped, 3), "escalated");
  assert.equal(totalAllowedAttempts(capped), 6);
  assert.equal(totalAllowedAttempts(normalizeReconnect({ mode: "restart", maxAttempts: 3 })), 3);
  assert.equal(totalAllowedAttempts(normalizeReconnect({ maxAttempts: 0 })), 0);
});
