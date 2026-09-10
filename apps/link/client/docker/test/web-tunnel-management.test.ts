import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const web = join(import.meta.dirname, "../web");

test("web UI provides an accessible tunnel edit dialog and per-tunnel actions", async () => {
  const [html, script] = await Promise.all([
    readFile(join(web, "index.html"), "utf8"),
    readFile(join(web, "app.js"), "utf8"),
  ]);
  assert.match(html, /<dialog id="tunnelDialog"/);
  assert.match(html, /id="tunnelForm"/);
  assert.match(html, /aria-label="编辑隧道"/);
  assert.match(script, /data-edit=/);
  assert.match(script, /data-toggle=/);
  assert.match(script, /navigator\.clipboard\.writeText/);
  assert.match(script, /\/api\/tunnels\/\$\{encodeURIComponent\(tunnel\.id\)\}\/toggle/);
  assert.match(script, /const field = \(form, name\) => form\.elements\.namedItem\(name\)/);
  // 门户集成后 Console 三入口侧栏已移除，面板由 data-panel 深链切换（?meiView=）
  assert.match(html, /data-panel="tunnels"/);
  assert.match(html, /data-panel="settings"/);
  assert.match(html, /data-panel="logs"/);
  assert.match(html, /role="switch"/);
  assert.match(html, /id="testConnectionButton"/);
  assert.match(html, /id="fetchBootstrapButton"/);
  assert.match(html, /id="bootstrapResult"/);
  assert.match(html, /泛域名/);
  assert.match(script, /\/api\/bootstrap/);
  assert.match(script, /info\.serverAddr/);
  assert.match(script, /info\.subDomainHost/);
  assert.match(script, /<svg/);
});

test("web UI exposes the setup guidance dialog and reconnect settings form", async () => {
  const [html, script] = await Promise.all([
    readFile(join(web, "index.html"), "utf8"),
    readFile(join(web, "app.js"), "utf8"),
  ]);
  // 设置引导弹层：报错必须有「前往设置」出口，而不是只弹一条 toast
  assert.match(html, /id="setupModal"/);
  assert.match(html, /id="setupGoto"/);
  assert.match(html, /id="setupDismiss"/);
  assert.match(script, /function showSetupDialog/);
  assert.match(script, /function reportError/);
  assert.match(script, /error\.setup/);
  assert.match(script, /highlightSetupFields/);
  // 自动重连设置：开关 / 间隔 / 方式 / 次数上限
  assert.match(html, /id="reconnectForm"/);
  assert.match(html, /name="intervalSeconds"/);
  assert.match(html, /value="restart"/);
  assert.match(html, /name="maxAttempts"/);
  assert.match(html, /id="reconnectState"/);
  assert.match(script, /\/api\/reconnect/);
  assert.match(script, /function renderReconnect/);
  // 面板「重启」走独立的 restart 控制路由，而不是复用 start
  assert.match(script, /controlAction\("restart"/);
});

test("web UI resolves API paths at runtime instead of relying on nginx sub_filter", async () => {
  const script = await readFile(join(web, "app.js"), "utf8");
  // 门户以 /link/ 子路径反代，nginx 的 sub_filter 只改写双引号字面量；
  // 模板字符串路径会漏改并打到门户自身，因此必须统一经 apiPath() 归一化。
  assert.match(script, /const API_BASE = /);
  assert.match(script, /const apiPath = /);
  assert.match(script, /await fetch\(apiPath\(path\)/);
  // 门户级重登接口挂在站点根，必须用拼接写法避开 sub_filter
  assert.match(script, /"\/api" \+ "\/auth\/repenetrate"/);
});
