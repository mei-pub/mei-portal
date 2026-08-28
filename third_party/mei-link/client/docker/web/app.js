const $ = selector => document.querySelector(selector);
const icons = {
  tunnel: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 17h16M7 4v16m10-16v16"/></svg>',
  settings: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.15 2.15-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.04 1.56v.09h-3.04v-.09A1.7 1.7 0 0 0 10.59 18.7a1.7 1.7 0 0 0-1.88.34l-.06.06-2.15-2.15.06-.06A1.7 1.7 0 0 0 6.9 15a1.7 1.7 0 0 0-1.56-1.04h-.09v-3.04h.09A1.7 1.7 0 0 0 6.9 9.88 1.7 1.7 0 0 0 6.56 8l-.06-.06 2.15-2.15.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1.04-1.56v-.09h3.04v.09a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.15 2.15-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.04h.09v3.04h-.09A1.7 1.7 0 0 0 19.4 15Z"/></svg>',
  logs: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/></svg>',
  plus: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  copy: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="10" height="11" rx="1"/><path d="M15 9V5H5v11h4"/></svg>',
  open: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5M19 5l-9 9M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
  edit: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.3-1 10.1-10.1a2.1 2.1 0 0 0-3-3L5.3 16 4 20Z"/><path d="m13.8 7.4 3 3"/></svg>',
  trash: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5"/></svg>',
  close: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  empty: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M7 8h10M9 16h6"/><circle cx="5" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  power: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/></svg>',
  refresh: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/></svg>',
  // 刷新登录态：语义是「重新认证」，不能复用 refresh（会与「重启」按钮撞图标）
  key: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.2-8.2"/><path d="m17 4 3 3"/><path d="m14.5 6.5 3 3"/></svg>',
  logout: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>',
  collapseLeft: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
  collapseRight: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
  alert: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v5"/><path d="M12 17.4v.2"/></svg>',
};
let tunnels = [];
let events = [];
let serverConfig = {};
let configuredForm = false;
let polling = 0;
let toastTimer = 0;
let activeView = "tunnels";
const labels = { new: "新建", "wait start": "连接中", "start error": "启动失败", running: "运行中", "check failed": "检查失败", closed: "已关闭" };
// ---- API 基址：必须显式解析，不能依赖 nginx 的 sub_filter 改写 ----
//
// 门户以子路径反代本应用（当前为 /link/），nginx 用 sub_filter 给 JS 里的 "/api/
// 前缀补上该子路径。但该规则只命中「双引号字面量」，模板字符串 `/api/x/${id}`
// 一律漏改，请求会打到门户自身而不是本应用（表现为莫名的「请求失败」/404）。
//
// 因此基址改为运行时推导：本脚本由 <script src=".../app.js"> 加载，其所在目录
// 就是应用根，与部署用的子路径前缀无关（独立部署时自然得到 ""）。
const API_BASE = (() => {
  const src = (document.currentScript && document.currentScript.src) || import.meta.url;
  try {
    return new URL(".", src).pathname.replace(/\/$/, "");
  } catch {
    return location.pathname.replace(/\/[^/]*$/, "").replace(/\/$/, "");
  }
})();
/**
 * 归一化 API 路径。
 * 同时接受两种输入：源码里的 /api/x，以及被 sub_filter 改写后带子路径前缀的形式。
 * 两者都会被折算到当前部署实际的基址，因此模板字符串不再需要依赖字符串改写。
 *
 * 注意：本函数内不能出现 "/api/ 这样的双引号字面量，否则它自己会被 sub_filter
 * 一并改写，拼出 /link/link/api/... 的双前缀。故用数组 join 拼出该标记。
 */
const API_MARKER = ["", "api", ""].join("/"); // 等价于 /api/ ，规避 sub_filter 匹配
const apiPath = path => {
  const raw = String(path);
  const at = raw.indexOf(API_MARKER);
  const suffix = at >= 0 ? raw.slice(at) : raw;
  return `${API_BASE}${suffix}`;
};
// 门户级接口（穿透重登）永远挂在站点根，不带 /link 前缀。
// 拼接书写同样是为了避开 sub_filter 的 "/api/ 规则。
const PORTAL_REPENETRATE_URL = "/api" + "/auth/repenetrate";
for (const target of document.querySelectorAll("[data-icon]")) target.innerHTML = icons[target.dataset.icon] || "";
const api = async (path, options = {}) => {
  const response = await fetch(apiPath(path), { credentials: "include", ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "请求失败");
    // 服务端设置类故障：把结构化引导挂到 error 上，由调用方转成弹层而不是干巴巴的 toast
    if (payload.setup) error.setup = payload.setup;
    throw error;
  }
  return payload;
};
// 登录态失效时自动走门户穿透重登（门户已登录前提下无感恢复会话）
const repenetrate = async () => {
  try {
    const response = await fetch(PORTAL_REPENETRATE_URL, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app: "mei-link" }),
    });
    const payload = await response.json().catch(() => ({}));
    return Boolean(payload && payload.ok);
  } catch (error) { return false; }
};
const field = (form, name) => form.elements.namedItem(name);
const formValue = (form, name) => new FormData(form).get(name)?.toString().trim() || "";
const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const icon = name => icons[name] || "";
const setBusy = (button, busy) => { if (button) button.disabled = busy; };
function notify(message, error = false) { const toast = $("#toast"); toast.textContent = message; toast.className = `toast${error ? " error" : ""}`; clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.add("hidden"), 3600); }

// ---- 服务端设置引导 ----
// 设置类故障不能只弹 toast：用户看完就没了，也不知道去哪改。统一走弹层 + 「前往设置」。
let setupDismissedCode = "";
let currentSetup = null;
function highlightSetupFields(fields) {
  document.querySelectorAll(".s-focus").forEach(node => node.classList.remove("s-focus"));
  if (!fields || !fields.length) return;
  const form = $("#configForm");
  for (const name of fields) {
    const input = form && field(form, name);
    const holder = input ? input.closest(".field") || input.closest(".switch-line") : null;
    if (holder) holder.classList.add("s-focus");
  }
  const first = fields[0] && form && field(form, fields[0]);
  if (first && typeof first.focus === "function" && activeView === "settings") {
    first.focus({ preventScroll: false });
  }
}
function showSetupDialog(setup) {
  if (!setup || !setup.code) return false;
  // 同一个故障码在用户点过「稍后处理」后不再反复弹（轮询每 3s 一次）
  if (setupDismissedCode === setup.code) return false;
  currentSetup = setup;
  $("#setupTitle").textContent = setup.title || "服务端设置需要处理";
  $("#setupMessage").textContent = setup.message || "";
  $("#setupHint").textContent = setup.hint || "";
  // 可重试的故障（端口不通/管理接口未就绪）后台仍在按设置自动重连，得说清楚，
  // 否则用户会以为必须立刻改配置才能恢复。
  const retryNote = $("#setupRetryNote");
  if (retryNote) {
    retryNote.textContent = setup.retryable ? "后台仍在按自动重连设置继续尝试恢复，如果是服务端临时重启，无需改动即可自动连回。" : "";
    retryNote.classList.toggle("hidden", !setup.retryable);
  }
  $("#setupModal").classList.remove("hidden");
  return true;
}
function hideSetupDialog() { $("#setupModal").classList.add("hidden"); }
/** 统一错误出口：设置类故障走引导弹层，其余照旧 toast。 */
function reportError(error) {
  const setup = error && error.setup;
  if (setup) {
    // 用户显式触发的操作报错，无论此前是否 dismiss 过都要弹出来
    setupDismissedCode = "";
    if (showSetupDialog(setup)) return;
  }
  notify((error && error.message) || "请求失败", true);
}
$("#setupDismiss").addEventListener("click", () => {
  setupDismissedCode = (currentSetup && currentSetup.code) || "";
  hideSetupDialog();
});
$("#setupGoto").addEventListener("click", () => {
  const fields = (currentSetup && currentSetup.fields) || [];
  hideSetupDialog();
  setupDismissedCode = (currentSetup && currentSetup.code) || "";
  // 设置面板就在本应用内（门户设置中心的「隧道服务器设置」也是深链到这里），
  // 直接切面板即可：既不重挂 iframe，也不依赖外壳额外的导航协议。
  setView("settings");
  window.scrollTo({ top: 0, behavior: "smooth" });
  highlightSetupFields(fields);
});
function statusKey(tunnel) { return tunnel.runtimeStatus || tunnel.status || "new"; }
function statusLabel(tunnel) { return labels[statusKey(tunnel)] || "新建"; }
function routeLine(tunnel) { return tunnel.route || "等待服务端分配访问地址"; }
function safeRoute(tunnel) { return /^https?:\/\//i.test(tunnel.route || "") && !tunnel.route.includes("*") ? tunnel.route : ""; }
function setSwitch(control, checked) { control.setAttribute("aria-checked", String(checked)); const input = field(control.closest("form") || document, control.dataset.switch); if (input) input.checked = checked; }
function bindSwitches(root = document) { root.querySelectorAll("[data-switch]").forEach(control => control.addEventListener("click", () => setSwitch(control, control.getAttribute("aria-checked") !== "true"))); }
bindSwitches();

async function load() {
  const [status, savedTunnels, savedEvents, config, reconnect] = await Promise.all([api("/api/status"), api("/api/tunnels"), api("/api/events"), api("/api/server-config"), api("/api/reconnect")]);
  tunnels = savedTunnels; events = savedEvents; serverConfig = config || {};
  renderStatus(status); renderTunnels(); renderEvents();
  if (!configuredForm) { fillConfig(serverConfig); configuredForm = true; }
  // 重连偏好独立存储，回填走它自己的接口（fillReconnect 内部会避让正在编辑的表单）
  fillReconnect(reconnect);
}
function renderStatus(status) {
  lastStatus = status || lastStatus;
  $("#statusText").textContent = status.connected ? "已连接" : status.running ? "连接中" : status.configured ? "未连接" : "未配置";
  $("#statusDot").className = `dot ${status.connected ? "ok" : status.running || status.configured ? "warn" : ""}`;
  // 面板 连接/断开 单入口：按连接态切换图标与提示
  const toggle = $("#panelToggle");
  if (toggle) {
    const connected = status.connected || status.running;
    toggle.title = connected ? "断开" : "连接";
    toggle.classList.toggle("on", connected);
  }
  renderReconnect(status);
  // 后台自动重连撞上设置类故障时，前端轮询到就主动弹层引导（用户可能根本没在点按钮）
  if (status.setup) showSetupDialog(status.setup);
}

/** 自动重连状态条：把「在重试 / 已停止重试 / 需要改配置」讲清楚。 */
function renderReconnect(status) {
  const box = $("#reconnectState");
  if (!box) return;
  const settings = status.reconnect || {};
  const state = status.reconnectState || {};
  if (!status.configured) { box.className = "reconnect-state"; box.textContent = "尚未配置服务器，自动重连暂不生效。"; return; }
  if (!settings.enabled) { box.className = "reconnect-state"; box.textContent = "自动重连已关闭，断连后需手动点连接。"; return; }
  const modeText = settings.mode === "restart" ? "直接重启" : "重新连接";
  // reconnect + 有次数上限时是两段式：先重连 N 次，打满自动升级为重启再试 N 次
  const twoPhase = settings.mode === "reconnect" && settings.maxAttempts > 0;
  const base = `自动重连已开启：每 ${settings.intervalSeconds}s 检查一次，方式为${modeText}`
    + (twoPhase ? `（连续失败 ${settings.maxAttempts} 次后自动升级为直接重启，再试 ${settings.maxAttempts} 次）` : "");
  if (status.connected) {
    box.className = "reconnect-state";
    box.textContent = `${base}。当前连接正常。`;
    return;
  }
  if (state.stoppedReason === "setup-required") {
    box.className = "reconnect-state error";
    box.textContent = `已暂停自动重连：失败原因属于服务端设置问题，重试无法修复，请先修正设置。${state.lastError ? `（${state.lastError}）` : ""}`;
    return;
  }
  if (state.stoppedReason === "attempts-exhausted") {
    box.className = "reconnect-state error";
    box.textContent = twoPhase
      ? `重新连接与直接重启各尝试 ${settings.maxAttempts} 次仍未恢复，自动重连已停止。手动点连接可重新开始。${state.lastError ? `（最近失败：${state.lastError}）` : ""}`
      : `已达到最大尝试次数（${settings.maxAttempts} 次），自动重连停止。手动点连接可重新开始。${state.lastError ? `（最近失败：${state.lastError}）` : ""}`;
    return;
  }
  if (!status.desiredConnected) {
    box.className = "reconnect-state";
    box.textContent = `${base}。当前为手动断开状态，不会自动拉起。`;
    return;
  }
  const next = state.nextAttemptAt ? new Date(state.nextAttemptAt).toLocaleTimeString() : "—";
  const escalated = state.phase === "escalated";
  const ordinal = escalated ? (state.attempts || 0) - settings.maxAttempts : (state.attempts || 0);
  const phaseText = escalated
    ? `已升级为直接重启，本段已尝试 ${ordinal}/${settings.maxAttempts} 次`
    : `已连续尝试 ${state.attempts || 0}${settings.maxAttempts > 0 ? `/${settings.maxAttempts}` : ""} 次`;
  box.className = "reconnect-state warn";
  box.textContent = `${base}。${phaseText}，下次尝试约在 ${next}。${state.lastError ? `最近失败：${state.lastError}` : ""}`;
}
function renderTunnels() {
  const target = $("#tunnelList");
  const enabled = tunnels.filter(tunnel => tunnel.enabled).length;
  const running = tunnels.filter(tunnel => statusKey(tunnel) === "running").length;
  $("#tunnelSummary").textContent = `${enabled} / ${tunnels.length} 个隧道已启用`;
  $("#allTunnelCount").textContent = tunnels.length;
  $("#enabledTunnelCount").textContent = enabled;
  $("#runningTunnelCount").textContent = running;
  if (!tunnels.length) { target.innerHTML = `<div class="empty">${icon("empty")}<div>还没有隧道</div><div class="muted" style="margin-top:5px">添加 HTTP、HTTPS、TCP 或 UDP 隧道，将 NAS 服务发布到公网。</div></div>`; return; }
  const header = '<div class="tunnel-head"><span>名称</span><span>本地服务</span><span>外网访问</span><span>状态</span><span></span></div>';
  target.innerHTML = header + tunnels.map(tunnel => {
    const key = statusKey(tunnel).replaceAll(" ", "-");
    const route = safeRoute(tunnel);
    const routeHtml = route ? `<a href="${escapeHtml(route)}" target="_blank" rel="noreferrer">${escapeHtml(route)}</a>` : escapeHtml(routeLine(tunnel));
    const opened = route ? `<a class="button ghost icon-button" title="打开访问地址" aria-label="打开访问地址" href="${escapeHtml(route)}" target="_blank" rel="noreferrer">${icon("open")}</a>` : "";
    return `<div class="tunnel-row"><div><span class="tunnel-name">${escapeHtml(tunnel.name)}</span><span class="type-badge">${escapeHtml(tunnel.type.toUpperCase())}</span></div><div class="service">${escapeHtml(tunnel.localIP)}:${escapeHtml(tunnel.localPort)}</div><div><div class="route">${routeHtml}</div>${tunnel.errorMessage ? `<div class="error">${escapeHtml(tunnel.errorMessage)}</div>` : ""}</div><div class="state ${key}"><i></i>${escapeHtml(statusLabel(tunnel))}</div><div class="actions row-actions"><button class="switch-control" type="button" role="switch" aria-checked="${tunnel.enabled ? "true" : "false"}" aria-label="${escapeHtml(tunnel.name)} ${tunnel.enabled ? "已启用，点击停用" : "已停用，点击启用"}" data-toggle="${escapeHtml(tunnel.id)}"><span></span></button><button class="button ghost icon-button" title="复制访问地址" aria-label="复制访问地址" data-copy="${escapeHtml(tunnel.id)}">${icon("copy")}</button>${opened}<button class="button ghost icon-button" title="编辑隧道" aria-label="编辑隧道" data-edit="${escapeHtml(tunnel.id)}">${icon("edit")}</button><button class="button danger icon-button" title="删除隧道" aria-label="删除隧道" data-delete="${escapeHtml(tunnel.id)}">${icon("trash")}</button></div></div>`;
  }).join("");
}
function formatLogs() { return events.map(event => `[${new Date(event.timestamp).toLocaleString()}] [${String(event.level || "info").toUpperCase()}] ${event.message}`).join("\n"); }
function renderEvents() {
  $("#logCount").textContent = `${events.length} 条记录`;
  const target = $("#events");
  if (!events.length) { target.innerHTML = '<div class="log-empty">尚无运行日志</div>'; return; }
  target.innerHTML = events.map(event => `<div class="log-entry ${escapeHtml(event.level || "info")}"><span class="log-time">${escapeHtml(new Date(event.timestamp).toLocaleString())}</span><span class="log-level">${escapeHtml(String(event.level || "info").toUpperCase())}</span><span class="log-message">${escapeHtml(event.message)}</span></div>`).join("");
}
function fillConfig(config) {
  if (!config) return;
  const form = $("#configForm");
  for (const [name, value] of Object.entries(config)) { const input = field(form, name); if (input && value !== "") input.value = value; }
  const tls = field(form, "tlsEnabled");
  const control = form.querySelector('[data-switch="tlsEnabled"]');
  if (tls && control) setSwitch(control, tls.checked);
}

/** 回填自动重连表单。用户正在编辑时不覆盖，避免轮询把输入抢掉。 */
function fillReconnect(settings) {
  if (!settings) return;
  const form = $("#reconnectForm");
  if (!form || form.contains(document.activeElement)) return;
  field(form, "intervalSeconds").value = settings.intervalSeconds;
  field(form, "mode").value = settings.mode || "reconnect";
  field(form, "maxAttempts").value = settings.maxAttempts ?? 0;
  const enabled = settings.enabled !== false;
  field(form, "reconnectEnabled").checked = enabled;
  setSwitch(form.querySelector('[data-switch="reconnectEnabled"]'), enabled);
}
function beginPolling() { clearInterval(polling); polling = setInterval(() => load().catch(() => {}), 3000); }
function setView(view) {
  activeView = view;
  document.querySelectorAll("[data-view]").forEach(item => item.classList.toggle("active", item.dataset.view === view));
  document.querySelectorAll("[data-panel]").forEach(panel => panel.classList.toggle("hidden", panel.dataset.panel !== view));
}
function formForTunnel(tunnel = {}) {
  const form = $("#tunnelForm"); form.reset();
  field(form, "id").value = tunnel.id || "";
  field(form, "name").value = tunnel.name || "";
  const selectedType = tunnel.type || "http"; field(form, "type").value = selectedType;
  field(form, "localIP").value = tunnel.localIP || "127.0.0.1"; field(form, "localPort").value = tunnel.localPort || "";
  field(form, "subdomain").value = tunnel.subdomain || ""; field(form, "remotePort").value = tunnel.remotePort || "";
  field(form, "customDomains").value = (tunnel.customDomains || []).join(", "); field(form, "httpUser").value = tunnel.httpUser || "";
  field(form, "httpPassword").value = ""; field(form, "hostHeaderRewrite").value = tunnel.hostHeaderRewrite || "";
  const enabled = tunnel.enabled !== false; field(form, "enabled").checked = enabled; setSwitch(form.querySelector('[data-switch="enabled"]'), enabled); typeFields();
}
function typeFields() { const webTunnel = ["http", "https"].includes(formValue($("#tunnelForm"), "type")); $("#webTunnelFields").classList.toggle("hidden", !webTunnel); $("#portTunnelFields").classList.toggle("hidden", webTunnel); }
function openTunnelDialog(tunnel) { formForTunnel(tunnel); $("#tunnelDialogTitle").textContent = tunnel ? "编辑隧道" : "添加隧道"; $("#tunnelDialog").showModal(); field($("#tunnelForm"), "name").focus(); loadDomainDirectory(tunnel); }
function closeTunnelDialog() { $("#tunnelDialog").close(); }

// 域名目录拉取（选基域+填前缀模式）。与原生端/Tauri 端逻辑一致。
let domainEntries = [];
let useDirectory = false;
let editingTunnelForDomain = null;

async function loadDomainDirectory(tunnel) {
  editingTunnelForDomain = tunnel || null;
  domainEntries = []; useDirectory = false;
  $("#directoryGroup").classList.add("hidden");
  $("#manualDomainFields").classList.remove("hidden");
  $("#fallbackNotice").classList.add("hidden");
  const isHttp = ["http", "https"].includes(tunnel?.type || "http");
  if (!isHttp) return;
  try {
    const res = await api("/api/domains");
    if (res.domains && res.domains.length) {
      domainEntries = res.domains;
      renderDomainSection();
    } else if (res.error) {
      $("#fallbackNotice").textContent = res.error + "，改为手动填写";
      $("#fallbackNotice").classList.remove("hidden");
    }
  } catch (e) { /* 静默 fallback */ }
}

function renderDomainSection() {
  if (!domainEntries.length) { useDirectory = false; return; }
  useDirectory = true;
  $("#directoryGroup").classList.remove("hidden");
  $("#manualDomainFields").classList.add("hidden");
  const sel = $("#baseDomain");
  sel.innerHTML = domainEntries.map(d => `<option value="${d.domain}">${d.domain}（${d.kind === "wildcard" ? "泛域名" : "主域名"}）</option>`).join("");
  // 编辑已有隧道时回填
  if (editingTunnelForDomain) {
    const sub = editingTunnelForDomain.subdomain;
    const customs = editingTunnelForDomain.customDomains || [];
    if (sub) { const p = domainEntries.find(d => d.kind !== "wildcard"); if (p) { sel.value = p.domain; $("#domainPrefix").value = sub; } }
    else if (customs.length) { const host = customs[0]; for (const d of domainEntries) { if (d.kind === "wildcard") { const h = d.domain.slice(2); if (host.endsWith("." + h)) { sel.value = d.domain; $("#domainPrefix").value = host.slice(0, -(h.length + 1)); break; } } } }
  }
  updateDomainPreview();
  sel.onchange = updateDomainPreview;
  $("#domainPrefix").oninput = updateDomainPreview;
}

function updateDomainPreview() {
  const sel = $("#baseDomain"); const domain = sel.value; const prefix = $("#domainPrefix").value.trim();
  const host = domain.startsWith("*.") ? domain.slice(2) : domain;
  const full = prefix ? `${prefix}.${host}` : host;
  const type = formValue($("#tunnelForm"), "type");
  $("#domainPreview").textContent = `访问地址：${type === "https" ? "https" : "http"}://${full}`;
}

function tunnelPayload(form) {
  const type = formValue(form, "type");
  let subdomain = formValue(form, "subdomain");
  let customDomains = formValue(form, "customDomains").split(",").map(d => d.trim()).filter(Boolean);
  // directory 模式：按所选基域类型算出 subdomain 或 customDomains
  if (useDirectory && ["http", "https"].includes(type)) {
    const sel = $("#baseDomain"); const entry = domainEntries.find(d => d.domain === sel.value);
    const prefix = $("#domainPrefix").value.trim();
    if (entry) {
      if (entry.kind === "wildcard") { subdomain = ""; customDomains = [prefix ? `${prefix}.${entry.domain.slice(2)}` : entry.domain.slice(2)]; }
      else { subdomain = prefix; customDomains = []; }
    }
  }
  return { name: formValue(form, "name"), type, localIP: formValue(form, "localIP"), localPort: Number(formValue(form, "localPort")), subdomain, remotePort: Number(formValue(form, "remotePort")) || undefined, customDomains, httpUser: formValue(form, "httpUser"), httpPassword: formValue(form, "httpPassword"), hostHeaderRewrite: formValue(form, "hostHeaderRewrite"), enabled: field(form, "enabled").checked };
}
async function saveConfig(connectAfterSave = false) {
  const form = $("#configForm");
  await api("/api/server-config", { method: "POST", body: JSON.stringify({ serverAddr: formValue(form, "serverAddr"), serverPort: Number(formValue(form, "serverPort")), authToken: formValue(form, "authToken"), subDomainHost: formValue(form, "subDomainHost"), tlsEnabled: field(form, "tlsEnabled").checked, adminPort: Number(formValue(form, "adminPort")), adminUser: formValue(form, "adminUser"), adminPassword: formValue(form, "adminPassword"), vhostHTTPPort: Number(formValue(form, "vhostHTTPPort")), vhostHTTPSPort: Number(formValue(form, "vhostHTTPSPort")), managementURL: formValue(form, "managementURL"), domainAPIToken: formValue(form, "domainAPIToken") }) });
  field(form, "authToken").value = ""; field(form, "adminPassword").value = "";
  if (connectAfterSave) await api("/api/control/start", { method: "POST" });
  notify(connectAfterSave ? "设置已保存，正在连接" : "服务器设置已保存"); await load();
}
async function copyText(value, success) { if (!value) throw new Error("没有可复制的内容"); if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value); else { const area = document.createElement("textarea"); area.value = value; document.body.append(area); area.select(); document.execCommand("copy"); area.remove(); } notify(success); }

$("#loginForm").addEventListener("submit", async event => { event.preventDefault(); $("#loginError").textContent = ""; try { await api("/api/login", { method: "POST", body: JSON.stringify({ user: formValue(event.target, "user"), password: formValue(event.target, "password") }) }); $("#loginView").classList.add("hidden"); $("#appView").classList.remove("hidden"); await load(); beginPolling(); } catch (error) { $("#loginError").textContent = error.message; } });
// mei-allin 集成：Console 侧栏已移除，主界面锁死隧道管理页（默认 tunnels）。
// 门户设置集成页通过 ?meiView=settings|logs 深链打开对应面板。
{
  const meiView = new URLSearchParams(location.search).get("meiView");
  if (meiView === "settings" || meiView === "logs" || meiView === "tunnels") setView(meiView);
}
$("#configForm").addEventListener("submit", async event => { event.preventDefault(); const button = event.submitter; setBusy(button, true); try { await saveConfig(); } catch (error) { reportError(error); } finally { setBusy(button, false); } });
$("#saveAndConnectButton").addEventListener("click", async event => { setBusy(event.currentTarget, true); try { await saveConfig(true); } catch (error) { reportError(error); } finally { setBusy(event.currentTarget, false); } });
// 自动重连设置独立保存，不牵动服务器凭据字段
$("#reconnectForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.target;
  const button = event.submitter;
  setBusy(button, true);
  try {
    await api("/api/reconnect", { method: "POST", body: JSON.stringify({
      enabled: field(form, "reconnectEnabled").checked,
      intervalSeconds: Number(formValue(form, "intervalSeconds")),
      mode: formValue(form, "mode"),
      maxAttempts: Number(formValue(form, "maxAttempts")) || 0,
    }) });
    notify("自动重连设置已保存");
    await load();
  } catch (error) { reportError(error); }
  finally { setBusy(button, false); }
});
$("#fetchBootstrapButton").addEventListener("click", async event => {
  const result = $("#bootstrapResult"); setBusy(event.currentTarget, true);
  result.textContent = "正在拉取配置…"; result.className = "test-result";
  try {
    const info = await api("/api/bootstrap");
    if (!info || info.error) {
      const failure = new Error((info && info.error) || "拉取失败");
      if (info && info.setup) failure.setup = info.setup;
      throw failure;
    }
    const form = $("#configForm");
    if (info.serverAddr) field(form, "serverAddr").value = info.serverAddr;
    if (info.serverPort) field(form, "serverPort").value = info.serverPort;
    if (info.authToken) field(form, "authToken").value = info.authToken;
    if (info.subDomainHost) field(form, "subDomainHost").value = info.subDomainHost;
    result.textContent = `已拉取：${info.serverAddr || "未设置"}:${info.serverPort}，子域名根域 ${info.subDomainHost || "未设置"}`;
    result.className = "test-result ok";
  } catch (error) {
    result.textContent = `拉取失败：${error.message}`;
    result.className = "test-result error";
    // 设置类根因（管理页地址/Token 未配或不对）直接引导，而不是只留一行红字
    if (error.setup) reportError(error);
  }
  finally { setBusy(event.currentTarget, false); }
});
$("#testConnectionButton").addEventListener("click", async event => { const result = $("#connectionTestResult"); setBusy(event.currentTarget, true); result.textContent = "正在测试连接…"; result.className = "test-result"; try { const form = $("#configForm"); const outcome = await api("/api/test-connection", { method: "POST", body: JSON.stringify({ addr: formValue(form, "serverAddr"), port: Number(formValue(form, "serverPort")) }) }); result.textContent = outcome.ok ? "服务器端口可连接" : `连接失败：${outcome.err || "未知错误"}`; result.className = `test-result ${outcome.ok ? "ok" : "error"}`; } catch (error) { result.textContent = `测试失败：${error.message}`; result.className = "test-result error"; reportError(error); } finally { setBusy(event.currentTarget, false); } });
$("#newTunnelButton").addEventListener("click", () => openTunnelDialog()); $("#closeTunnelDialog").addEventListener("click", closeTunnelDialog); $("#cancelTunnelButton").addEventListener("click", closeTunnelDialog);
document.querySelectorAll('input[name="type"]').forEach(input => input.addEventListener("change", typeFields));
$("#tunnelForm").addEventListener("submit", async event => { event.preventDefault(); const form = event.target; const button = $("#saveTunnelButton"); setBusy(button, true); try { const payload = tunnelPayload(form); const id = field(form, "id").value; await api(id ? `/api/tunnels/${encodeURIComponent(id)}` : "/api/tunnels", { method: id ? "PUT" : "POST", body: JSON.stringify(payload) }); closeTunnelDialog(); notify(id ? "隧道已更新" : "隧道已创建"); await load(); } catch (error) { if (error.setup) closeTunnelDialog(); reportError(error); } finally { setBusy(button, false); } });
$("#tunnelList").addEventListener("click", async event => { const action = event.target.closest("[data-edit],[data-toggle],[data-delete],[data-copy]"); if (!action) return; const id = action.dataset.edit || action.dataset.toggle || action.dataset.delete || action.dataset.copy; const tunnel = tunnels.find(item => item.id === id); if (!tunnel) return; try { if (action.dataset.edit) return openTunnelDialog(tunnel); if (action.dataset.copy) return copyText(tunnel.route || "", "访问地址已复制"); if (action.dataset.delete) { if (!confirm(`确定删除隧道“${tunnel.name}”吗？`)) return; await api(`/api/tunnels/${encodeURIComponent(tunnel.id)}`, { method: "DELETE" }); notify("隧道已删除"); } else { await api(`/api/tunnels/${encodeURIComponent(tunnel.id)}/toggle`, { method: "POST", body: JSON.stringify({ enabled: !tunnel.enabled }) }); notify(`隧道已${tunnel.enabled ? "停用" : "启用"}`); } await load(); } catch (error) { reportError(error); } });
// 左侧窄面板行动点（req：添加隧道 / 连接或断开 / 重启 / 退出 全部收敛到面板）
let lastStatus = { connected: false, running: false, configured: false };
async function controlAction(action, event, okMessage) {
  setBusy(event.currentTarget, true);
  try { await api(`/api/control/${action}`, { method: "POST" }); if (okMessage) notify(okMessage); await load(); }
  catch (error) { reportError(error); await load().catch(() => {}); }
  finally { setBusy(event.currentTarget, false); }
}
$("#panelAddTunnel").addEventListener("click", () => openTunnelDialog());
$("#panelToggle").addEventListener("click", async event => {
  // 已连接或连接中 → 断开；否则 → 连接
  const connected = lastStatus.connected || lastStatus.running;
  await controlAction(connected ? "stop" : "start", event);
});
$("#panelRestart").addEventListener("click", async event => { await controlAction("restart", event, "隧道管理器已重启"); });
// 刷新登录态：登录态失效时手动触发门户穿透重登（替代原退出按钮）
$("#panelRelogin").addEventListener("click", async event => {
  setBusy(event.currentTarget, true);
  try {
    const response = await fetch(PORTAL_REPENETRATE_URL, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app: "mei-link" }),
    });
    const payload = await response.json().catch(() => ({}));
    if (payload && payload.ok) { notify("登录态已刷新"); await load(); }
    else notify((payload && payload.error) || "刷新失败，请先登录门户", true);
  } catch (error) { notify(error.message, true); }
  finally { setBusy(event.currentTarget, false); }
});
// 面板收展（localStorage 记忆）
(function initPanelToggle() {
  const KEY = "mei-float-meilink";
  const panel = $("#meiPanel");
  const handle = $("#panelHandle");
  const apply = open => {
    panel.classList.toggle("hidden", !open);
    handle.classList.toggle("hidden", open);
  };
  let open = true;
  try { open = localStorage.getItem(KEY) !== "1"; } catch (e) {}
  apply(open);
  $("#panelCollapse").addEventListener("click", () => { open = false; try { localStorage.setItem(KEY, "1"); } catch (e) {} apply(false); });
  handle.addEventListener("click", () => { open = true; try { localStorage.setItem(KEY, "0"); } catch (e) {} apply(true); });
})();
$("#refreshButton").addEventListener("click", () => load().catch(error => notify(error.message, true)));
$("#copyLogsButton").addEventListener("click", () => copyText(formatLogs(), "运行日志已复制").catch(error => notify(error.message, true)));
$("#exportLogsButton").addEventListener("click", () => { const blob = new Blob([formatLogs() || "尚无运行日志\n"], { type: "text/plain;charset=utf-8" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `meilink-log-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`; link.click(); URL.revokeObjectURL(link.href); });
$("#clearLogsButton").addEventListener("click", async () => { if (!events.length || !confirm("确定清空当前运行日志吗？")) return; try { await api("/api/events", { method: "DELETE" }); notify("运行日志已清空"); await load(); } catch (error) { notify(error.message, true); } });

(async function restoreSession() {
  let status = null;
  try {
    status = await api("/api/status");
  } catch (error) {
    // 会话失效：尝试门户穿透重登后重试一次
    if (!(await repenetrate())) return;
    try { status = await api("/api/status"); } catch (e) { return; }
  }
  if (status && status.unauthorized && await repenetrate()) {
    try { status = await api("/api/status"); } catch (e) { return; }
  }
  if (status && !status.unauthorized) {
    $("#loginView").classList.add("hidden");
    $("#appView").classList.remove("hidden");
    await load(); beginPolling();
  }
})();
