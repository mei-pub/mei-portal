import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMeilinkServer } from "../src/server.ts";

async function startServer() {
  const dataDir = await mkdtemp(join(tmpdir(), "meilink-setup-"));
  const server = await createMeilinkServer({ dataDir, frpcBin: "not-used-in-this-test", adminPassword: "test-password" });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind a TCP port");
  const base = `http://127.0.0.1:${address.port}`;
  const login = await fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user: "admin", password: "test-password" }) });
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie);
  return { dataDir, server, base, headers: { cookie, "content-type": "application/json" } };
}

async function stopServer(app: Awaited<ReturnType<typeof startServer>>) {
  await new Promise<void>(resolve => app.server.close(() => resolve()));
  await rm(app.dataDir, { recursive: true, force: true });
}

test("starting a tunnel without any server config returns setup guidance, not a bare error", async () => {
  const app = await startServer();
  try {
    const res = await fetch(`${app.base}/api/control/start`, { method: "POST", headers: app.headers });
    assert.equal(res.status, 400);
    const payload = await res.json() as { error: string; setup?: { code: string; fields: string[]; hint: string } };
    assert.equal(payload.error, "未配置服务器");
    assert.equal(payload.setup?.code, "server-not-configured");
    assert.ok(payload.setup?.hint.includes("设置"));
    assert.deepEqual(payload.setup?.fields, ["serverAddr", "serverPort", "authToken"]);
  } finally { await stopServer(app); }
});

test("domain directory failures carry setup guidance for the management page fields", async () => {
  const app = await startServer();
  try {
    const res = await fetch(`${app.base}/api/domains`, { headers: app.headers });
    assert.equal(res.status, 200);
    const payload = await res.json() as { error: string; setup?: { code: string; fields: string[] } };
    assert.match(payload.error, /未配置管理页地址或 token/);
    assert.equal(payload.setup?.code, "management-not-configured");
    assert.deepEqual(payload.setup?.fields, ["managementURL", "domainAPIToken"]);
  } finally { await stopServer(app); }
});

test("ordinary validation errors stay free of setup guidance", async () => {
  const app = await startServer();
  try {
    const res = await fetch(`${app.base}/api/tunnels`, {
      method: "POST", headers: app.headers,
      body: JSON.stringify({ name: "", type: "http", localIP: "127.0.0.1", localPort: 5000, enabled: true }),
    });
    assert.equal(res.status, 400);
    const payload = await res.json() as { error: string; setup?: unknown };
    assert.equal(payload.error, "隧道名称不能为空");
    assert.equal(payload.setup, undefined);
  } finally { await stopServer(app); }
});

test("status exposes the reconnect settings and runtime state for the UI", async () => {
  const app = await startServer();
  try {
    const res = await fetch(`${app.base}/api/status`, { headers: app.headers });
    const payload = await res.json() as {
      configured: boolean;
      desiredConnected: boolean;
      reconnect: { enabled: boolean; intervalSeconds: number; mode: string; maxAttempts: number };
      reconnectState: { attempts: number; stoppedReason: string };
    };
    assert.equal(payload.configured, false);
    assert.equal(payload.desiredConnected, false);
    assert.deepEqual(payload.reconnect, { enabled: true, intervalSeconds: 30, mode: "reconnect", maxAttempts: 0 });
    assert.equal(payload.reconnectState.attempts, 0);
  } finally { await stopServer(app); }
});

test("reconnect settings persist through the dedicated route and clamp bad input", async () => {
  const app = await startServer();
  try {
    // 保存重连设置前必须先有服务器配置，否则无处落盘
    const saveConfig = await fetch(`${app.base}/api/server-config`, {
      method: "POST", headers: app.headers,
      body: JSON.stringify({
        serverAddr: "frp.example.test", serverPort: 7000, authToken: "token", subDomainHost: "example.test",
        tlsEnabled: true, adminPort: 7400, adminUser: "admin", adminPassword: "admin",
        vhostHTTPPort: 8080, vhostHTTPSPort: 8443,
      }),
    });
    assert.equal(saveConfig.status, 201);

    const saved = await fetch(`${app.base}/api/reconnect`, {
      method: "POST", headers: app.headers,
      body: JSON.stringify({ enabled: true, intervalSeconds: 1, mode: "restart", maxAttempts: 5 }),
    });
    assert.equal(saved.status, 200);
    // intervalSeconds=1 低于下限，应被夹到 5
    assert.deepEqual(await saved.json(), { enabled: true, intervalSeconds: 5, mode: "restart", maxAttempts: 5 });

    const read = await fetch(`${app.base}/api/reconnect`, { headers: app.headers });
    assert.deepEqual(await read.json(), { enabled: true, intervalSeconds: 5, mode: "restart", maxAttempts: 5 });

    // server-config 也要带出重连设置，供设置面板一次性回填
    const cfg = await fetch(`${app.base}/api/server-config`, { headers: app.headers });
    const cfgPayload = await cfg.json() as { reconnect: { mode: string }; authToken: string };
    assert.equal(cfgPayload.reconnect.mode, "restart");
    assert.equal(cfgPayload.authToken, "");
  } finally { await stopServer(app); }
});

test("reconnect preferences can be saved before a server is configured", async () => {
  const app = await startServer();
  try {
    // 不写 /api/server-config，直接保存重连偏好：偏好应独立落盘，而不是因为“未配置服务器”报错。
    const saved = await fetch(`${app.base}/api/reconnect`, {
      method: "POST", headers: app.headers,
      body: JSON.stringify({ enabled: true, intervalSeconds: 12, mode: "restart", maxAttempts: 3 }),
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), { enabled: true, intervalSeconds: 12, mode: "restart", maxAttempts: 3 });

    const read = await fetch(`${app.base}/api/reconnect`, { headers: app.headers });
    assert.deepEqual(await read.json(), { enabled: true, intervalSeconds: 12, mode: "restart", maxAttempts: 3 });
  } finally { await stopServer(app); }
});
