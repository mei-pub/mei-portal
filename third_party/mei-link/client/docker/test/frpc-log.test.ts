import test from "node:test";
import assert from "node:assert/strict";
import { cleanFrpcLogLine, isFrpcDisconnected, isFrpcLoginSuccess } from "../src/frpc-log.ts";

test("cleanFrpcLogLine removes terminal control codes from frpc output", () => {
  assert.equal(
    cleanFrpcLogLine("\u001b[0m\u001b[1;34m2026-08-02 [I] [client/service.go:328] login to server success"),
    "2026-08-02 [I] [client/service.go:328] login to server success",
  );
});

test("cleanFrpcLogLine omits noisy local Admin API request logs", () => {
  assert.equal(cleanFrpcLogLine("2026-08-02 [I] [http/middleware.go:35] http request: [/api/status]"), null);
});

test("isFrpcLoginSuccess identifies the server login event", () => {
  assert.equal(isFrpcLoginSuccess("2026-08-02 [I] [client/service.go:328] login to server success, get run id [abc]"), true);
  assert.equal(isFrpcLoginSuccess("2026-08-02 [I] [client/service.go:308] try to connect to server..."), false);
});

test("isFrpcDisconnected spots a drop that leaves the process alive", () => {
  // frpc 掉线不会退出进程，只能从这些日志判断连接已经断了
  assert.equal(isFrpcDisconnected("2026-08-02 [W] [client/control.go:141] read message error: i/o deadline reached"), true);
  assert.equal(isFrpcDisconnected("2026-08-02 [I] [client/service.go:290] try to reconnect to server..."), true);
  assert.equal(isFrpcDisconnected("2026-08-02 [W] [client/service.go:319] connect to server error: dial tcp: connection refused"), true);
  assert.equal(isFrpcDisconnected("2026-08-02 [I] [client/control.go:186] control connection closed"), true);
  // 正常运行的日志不能被误判为掉线，否则会触发无意义的重连
  assert.equal(isFrpcDisconnected("2026-08-02 [I] [client/service.go:328] login to server success, get run id [abc]"), false);
  assert.equal(isFrpcDisconnected("2026-08-02 [I] [proxy/proxy_manager.go:178] proxy added: [photo]"), false);
  assert.equal(isFrpcDisconnected(""), false);
});
