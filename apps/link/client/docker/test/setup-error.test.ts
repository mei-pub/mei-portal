import test from "node:test";
import assert from "node:assert/strict";
import { classifySetupError, errorPayload } from "../src/setup-error.ts";

test("classifySetupError maps missing server config to a setup guidance", () => {
  const info = classifySetupError("未配置服务器");
  assert.equal(info?.code, "server-not-configured");
  assert.deepEqual(info?.fields, ["serverAddr", "serverPort", "authToken"]);
});

test("classifySetupError distinguishes a failed FRP login from an unreachable port", () => {
  assert.equal(classifySetupError("frpc did not log in to the server within 5 seconds")?.code, "server-login-failed");
  assert.equal(classifySetupError("frpc exited before logging into the server")?.code, "server-login-failed");
  assert.equal(classifySetupError("connect ECONNREFUSED 10.0.0.2:7000")?.code, "server-unreachable");
});

test("classifySetupError prefers the refused-port cause over the generic login failure", () => {
  // frpc 实际吐出的报文同时含「登录失败」与「connection refused」，
  // 必须归到「连不上服务器」，否则会把用户引去改 Token 而不是地址/端口。
  const real = "login to the server failed: dial tcp 127.0.0.1:7999: connect: connection refused. With loginFailExit enabled, no additional retries will be attempted";
  const info = classifySetupError(real);
  assert.equal(info?.code, "server-unreachable");
  assert.deepEqual(info?.fields, ["serverAddr", "serverPort"]);
  assert.equal(info?.retryable, true);
});

test("classifySetupError separates admin credential errors from an unready admin API", () => {
  assert.equal(classifySetupError("frpc Admin API GET /api/status failed: 401")?.code, "admin-credentials-invalid");
  assert.equal(classifySetupError("Admin API 未就绪: timeout")?.code, "admin-api-unreachable");
});

test("classifySetupError routes management page failures to their own fields", () => {
  assert.deepEqual(classifySetupError("未配置管理页地址或 token")?.fields, ["managementURL", "domainAPIToken"]);
  assert.equal(classifySetupError("服务端未启用接口（未配 MEILINK_DOMAIN_API_TOKEN）")?.code, "management-api-disabled");
  assert.equal(classifySetupError("域名拉取 token 错误")?.code, "management-token-invalid");
  assert.equal(classifySetupError("无法连接管理页: fetch failed")?.code, "management-unreachable");
});

test("classifySetupError reports a wildcard domain clashing with the subdomain root", () => {
  const info = classifySetupError("泛域名 *.a.example.com 不能属于子域名根域 example.com；请改用独立域名");
  assert.equal(info?.code, "subdomain-conflict");
  assert.deepEqual(info?.fields, ["subDomainHost"]);
});

test("classifySetupError ignores ordinary validation errors", () => {
  assert.equal(classifySetupError("隧道名称已存在"), null);
  assert.equal(classifySetupError("本地端口必须在 1 到 65535 之间"), null);
  assert.equal(classifySetupError(""), null);
});

test("errorPayload only attaches setup guidance for setup failures", () => {
  assert.deepEqual(errorPayload("隧道名称已存在"), { error: "隧道名称已存在" });
  const payload = errorPayload("未配置服务器");
  assert.equal(payload.error, "未配置服务器");
  assert.equal(payload.setup?.code, "server-not-configured");
});

test("classifySetupError marks transient failures as worth retrying", () => {
  // 连不上端口 / 管理接口未就绪：可能只是服务端在重启，自动重连应继续尝试
  assert.equal(classifySetupError("dial tcp: connect: ECONNREFUSED")?.retryable, true);
  assert.equal(classifySetupError("Admin API 未就绪: fetch failed")?.retryable, true);
  assert.equal(classifySetupError("无法连接管理页")?.retryable, true);
  // 认证不符 / 压根没配 / 域名冲突：重试多少次都不会变好
  assert.equal(classifySetupError("未配置服务器")?.retryable, false);
  assert.equal(classifySetupError("域名拉取 token 错误")?.retryable, false);
  assert.equal(classifySetupError("frpc Admin API GET /api/status failed: 401")?.retryable, false);
  assert.equal(classifySetupError("login to server failed")?.retryable, false);
  assert.equal(classifySetupError("不能属于子域名根域")?.retryable, false);
});
