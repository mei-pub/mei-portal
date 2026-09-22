// 盘链账号型搜索插件 —— Go plugin/panlian/panlian.go 的代码级移植
// 账号型插件：账号密码登录盘链站点（pinglian.lol）建立 cookie 会话，检索影视资源
// 并聚合其网盘链接（含 token 短链解析）；除搜索外注册 Web 管理页路由 /panlian/:param
// （GET 渲染管理页 + POST 动作分发），与 Go RegisterWebRoutes 逐条对齐。
// 基础设施差异（Go 版可删部分）：
//   - Go http.Client 的 Transport/连接池参数、每请求 context.WithTimeout 编排：
//     Node fetch 用 AbortController 超时，由 undici 接管连接
//   - Go net/http/cookiejar：文件内实现简易 CookieJar（域匹配 + 手动跟随重定向收集
//     Set-Cookie），覆盖 doLogin 的 PHPSESSID 预登录会话；Go 在 POST login.php 时会
//     以显式 Cookie 头 + jar 自动附加两条通路重复发送会话 Cookie，此处只经 jar 发送
//     （内容等价、无重复字段）
//   - Go sync.Map/sync.RWMutex：Node 单事件循环下用 Map 即可，无锁
//   - 密码 AES-256-GCM 加密语义逐位对齐（nonce 前置 + tag 后置，兼容 Go 侧密文互通）

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createLimiter } from '../http.ts';
import type { SearchResult, WebRoute } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const PluginName = 'panlian';
const DefaultBaseURL = 'https://pinglian.lol';
const ConfigFileName = 'panlian_config.json';
const RequestTimeout = 20_000; // Go RequestTimeout 20s
const MaxConcurrentJobs = 4;
const MaxVideoResults = 10;
const MaxLinksPerResult = 200;

/** 登录态失效信号（Go errLoginRequired，errors.Is 链路对应用 instanceof） */
class LoginRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoginRequiredError';
  }
}

const panOrder: Record<string, number> = {
  quark: 0,
  uc: 1,
  baidu: 2,
  xunlei: 3,
  '123': 4,
  tianyi: 5,
  '115': 6,
  aliyun: 7,
  guangya: 8,
  mobile: 9,
  pikpak: 10,
  magnet: 11,
  others: 12,
};

const extractCodeNoiseRegex = /([?？]?\s*(提取码|访问码|密码)[:：]\s*[a-z0-9]{4,8})+$/i;
const htmlTagRegex = /<[^>]+>/g;
const pan123ShareHostRegex = /(^|\.)share\.(?:123684\.com|123865\.com|123912\.com|123pan\.com|123pan\.cn|123592\.com)$/i;
const panTokenURLRegexes = [
  /id=["']jumpBtn["'][^>]*href=["']([^"']+)["']/gi,
  /href=["']([^"']+)["'][^>]*id=["']jumpBtn["']/gi,
  /(?:targetUrl|window\.location\.href|location\.href)\s*=\s*["']([^"']+)["']/gi,
];

// ---- 管理页 HTML（Go htmlTemplate 逐段复刻，服务端渲染，仅替换 HASH_PLACEHOLDER）----

const htmlTemplate = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PanSou 盘链配置</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: linear-gradient(135deg, #eef4ff 0%, #f8efe4 100%);
      color: #1f2937;
    }
    .container {
      max-width: 860px;
      margin: 0 auto;
      background: #fff;
      border-radius: 18px;
      box-shadow: 0 18px 48px rgba(15, 23, 42, 0.14);
      overflow: hidden;
    }
    .header {
      padding: 28px 32px;
      background: linear-gradient(135deg, #1d4ed8 0%, #0f766e 100%);
      color: #fff;
    }
    .header h1 { margin: 0 0 8px; font-size: 28px; }
    .header p { margin: 4px 0; opacity: 0.9; }
    .section {
      padding: 28px 32px;
      border-top: 1px solid #e5e7eb;
    }
    .section h2 {
      margin: 0 0 16px;
      font-size: 18px;
    }
    .section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 16px;
    }
    .section-head h2 {
      margin: 0;
    }
    .grid {
      display: grid;
      gap: 16px;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    }
    .card {
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 16px;
      background: #f8fafc;
    }
    label {
      display: block;
      font-weight: 600;
      margin-bottom: 6px;
    }
    input, textarea {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      font-size: 14px;
    }
    textarea {
      min-height: 120px;
      resize: vertical;
    }
    button {
      border: 0;
      border-radius: 10px;
      padding: 10px 16px;
      font-size: 14px;
      cursor: pointer;
      background: #1d4ed8;
      color: #fff;
      transition: opacity 0.2s ease, transform 0.2s ease;
    }
    button:hover { transform: translateY(-1px); }
    button:disabled {
      cursor: not-allowed;
      opacity: 0.75;
      transform: none;
    }
    button.secondary { background: #334155; }
    button.danger { background: #dc2626; }
    .actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 12px;
    }
    .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 13px;
      word-break: break-all;
    }
    pre {
      background: #0f172a;
      color: #dbeafe;
      padding: 14px;
      border-radius: 12px;
      overflow: auto;
      font-size: 12px;
      line-height: 1.5;
    }
    .status {
      display: grid;
      gap: 8px;
    }
    .status-item {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 8px 0;
      border-bottom: 1px dashed #dbe2ea;
    }
    .status-item:last-child { border-bottom: 0; }
    .hidden { display: none; }
    .search-row {
      display: flex;
      gap: 12px;
      align-items: end;
    }
    .search-row .field {
      flex: 1;
    }
    .loading-text {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .loading-text::before {
      content: "";
      width: 14px;
      height: 14px;
      border-radius: 50%;
      border: 2px solid rgba(255, 255, 255, 0.35);
      border-top-color: #fff;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>盘链</h1>
      <p>登录盘链站点后，PanSou 会直接抓取搜索结果和网盘链接。</p>
      <p class="mono">当前管理地址: HASH_PLACEHOLDER</p>
    </div>

    <div class="section hidden" id="statusSection">
      <div class="section-head">
        <h2>状态</h2>
        <button type="button" class="danger" onclick="logoutUser()">退出登录</button>
      </div>
      <div class="card status" id="statusBox"></div>
    </div>

    <div class="section" id="loginSection">
      <h2>登录</h2>
      <div class="grid">
        <div>
          <label for="username">账号</label>
          <input id="username" autocomplete="username">
        </div>
        <div>
          <label for="password">密码</label>
          <input id="password" type="password" autocomplete="current-password">
        </div>
      </div>
      <div class="actions">
        <button type="button" onclick="login()">登录并保存</button>
      </div>
    </div>

    <div class="section">
      <h2>测试搜索</h2>
      <div class="search-row">
        <div class="field">
          <label for="keyword">关键词</label>
          <input id="keyword" placeholder="例如：遮天">
        </div>
        <button type="button" id="testSearchBtn" onclick="testSearch()">搜索测试</button>
      </div>
    </div>

    <div class="section">
      <h2>返回结果</h2>
      <pre id="result">等待操作...</pre>
    </div>
  </div>

  <script>
    const hash = "HASH_PLACEHOLDER";

    async function postAction(action, extra = {}) {
      const resp = await fetch("/panlian/" + hash, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra })
      });
      return await resp.json();
    }

    function showResult(data) {
      document.getElementById("result").textContent = JSON.stringify(data, null, 2);
    }

    function showError(error) {
      showResult({
        success: false,
        message: error && error.message ? error.message : String(error)
      });
    }

    function setSearchLoading(loading) {
      const btn = document.getElementById("testSearchBtn");
      if (!btn) return;
      btn.disabled = !!loading;
      btn.innerHTML = loading
        ? '<span class="loading-text">搜索中...</span>'
        : '搜索测试';
    }

    function updatePageState(data) {
      const loggedIn = !!(data && data.logged_in);
      document.getElementById("statusSection").classList.toggle("hidden", !loggedIn);
      document.getElementById("loginSection").classList.toggle("hidden", loggedIn);
    }

    function renderStatus(data) {
      const box = document.getElementById("statusBox");
      const rows = [
        ["状态", data.logged_in ? "已登录" : "未登录"],
        ["用户名", data.username || "-"],
        ["登录时间", data.login_time || "-"],
        ["有效期", data.expire_time || "-"],
        ["剩余天数", String(data.expires_in_days || 0)]
      ];
      box.innerHTML = rows.map(([k, v]) => {
        return '<div class="status-item"><span>' + k + '</span><strong>' + v + '</strong></div>';
      }).join("");
      updatePageState(data);
    }

    async function loadStatus() {
      try {
        const result = await postAction("get_status");
        showResult(result);
        if (result.success && result.data) {
          renderStatus(result.data);
        } else {
          updatePageState(null);
        }
      } catch (error) {
        showError(error);
      }
    }

    async function login() {
      try {
        const username = document.getElementById("username").value.trim();
        const password = document.getElementById("password").value;
        const result = await postAction("login", { username, password, remember: true });
        showResult(result);
        if (result.success) {
          document.getElementById("password").value = "";
          await loadStatus();
        }
      } catch (error) {
        showError(error);
      }
    }

    async function logoutUser() {
      try {
        const result = await postAction("logout");
        showResult(result);
        if (result.success) {
          document.getElementById("username").value = "";
          document.getElementById("password").value = "";
          await loadStatus();
        }
      } catch (error) {
        showError(error);
      }
    }

    async function testSearch() {
      const keyword = document.getElementById("keyword").value.trim();
      if (!keyword) {
        showResult({
          success: false,
          message: "请输入搜索关键词"
        });
        return;
      }

      setSearchLoading(true);
      try {
        const result = await postAction("test_search", { keyword });
        showResult(result);
      } catch (error) {
        showError(error);
      } finally {
        setSearchLoading(false);
      }
    }

    window.onload = loadStatus;
  </script>
</body>
</html>`;

// ---- 数据模型（Go struct 逐字段对齐）----

interface PluginConfig {
  blocked_pan_types: string[];
  updated_at: string;
}

interface User {
  hash: string;
  username: string;
  encrypted_password: string;
  cookie: string;
  status: string;
  created_at: string; // ISO 字符串（'' 表示 Go 零时）
  login_at: string;
  expire_at: string;
  last_access_at: string;
}

interface LoginResponse {
  success: boolean;
  message: string;
  user: { id: number; username: string; email: string; vip_level: number; invite_code: string };
}

interface VideoSearchResponse {
  code: number;
  msg: string;
  page: number;
  pagecount: number;
  total: number;
  list: VideoItem[];
}

interface VideoItem {
  vod_id: number;
  vod_name: string;
  vod_pic: string;
  vod_remarks: string;
  vod_score: string;
  vod_year: string;
  vod_area: string;
  vod_lang: string;
  type_name: string;
  vod_actor: string;
  vod_director: string;
  vod_content: string;
}

interface PanLinkResponse {
  success: boolean;
  message: string;
  total: number;
  data: Record<string, PanGroup>;
}

interface PanGroup {
  name: string;
  icon: string;
  links: PanLinkItem[];
}

interface PanLinkItem {
  title: string;
  url: string;
  token: string;
  password: string;
  type: string;
  time: string;
  source: string;
  id: string;
  user_tier: string;
}

interface resolveTokenResponse {
  success: boolean;
  message: string;
  url: string;
}

// ---- 插件状态与持久化（Go Initialize/loadAllUsers/saveUser/loadConfig）----

let storageDir = '';
const users = new Map<string, User>();
let configState: PluginConfig = { blocked_pan_types: [], updated_at: '' };
let initialized = false;

function ensureInit(): void {
  if (initialized) return;
  initialized = true;

  const cachePath = process.env['CACHE_PATH'] ?? '';
  storageDir = join(cachePath !== '' ? cachePath : './cache', 'panlian_users');
  try {
    mkdirSync(storageDir, { recursive: true });
  } catch (err) {
    console.error(`[Panlian] 创建存储目录失败: ${err instanceof Error ? err.message : err}`);
  }
  loadConfig();
  loadAllUsers();
}

function loadAllUsers(): void {
  let names: string[];
  try {
    names = readdirSync(storageDir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.endsWith('.json') || name === ConfigFileName) continue;
    try {
      const user = JSON.parse(readFileSync(join(storageDir, name), 'utf8')) as User;
      users.set(user.hash, user);
    } catch {
      continue;
    }
  }
}

function getUserByHash(hash: string): User | undefined {
  return users.get(hash);
}

function saveUser(user: User): void {
  users.set(user.hash, user);
  writeFileSync(join(storageDir, `${user.hash}.json`), JSON.stringify(user, null, 2));
}

function getActiveUsers(): User[] {
  const active: User[] = [];
  for (const user of users.values()) {
    if (user.status === 'active' && user.cookie !== '') active.push(user);
  }
  active.sort((a, b) => timeOf(b.last_access_at) - timeOf(a.last_access_at));
  return active;
}

function configPath(): string {
  return join(storageDir, ConfigFileName);
}

function loadConfig(): void {
  let data: string;
  try {
    data = readFileSync(configPath(), 'utf8');
  } catch {
    return; // 配置不存在：保持默认
  }
  try {
    const cfg = JSON.parse(data) as PluginConfig;
    cfg.blocked_pan_types = normalizeBlockedPanTypes(cfg.blocked_pan_types);
    configState = cfg;
  } catch (err) {
    console.error(`[Panlian] 加载配置失败: ${err instanceof Error ? err.message : err}`);
  }
}

function saveConfig(): void {
  writeFileSync(configPath(), JSON.stringify(configState, null, 2));
}

function getBlockedPanTypes(): string[] {
  return [...configState.blocked_pan_types];
}

// ---- 通用小工具 ----

function timeOf(iso: string): number {
  if (iso === '') return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

function nowISO(): string {
  return new Date().toISOString();
}

function plusDaysISO(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

/** Go formatTime：零时返回空串，其余 "2006-01-02 15:04:05" 本地时间 */
function formatTime(iso: string): string {
  if (iso === '') return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function browserUserAgent(): string {
  return 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';
}

function generateHash(username: string): string {
  const salt = process.env['PANLIAN_HASH_SALT'] ?? 'pansou_panlian_secret_2026';
  return createHash('sha256').update(username + salt).digest('hex');
}

function isHexString(s: string): boolean {
  return /^[0-9a-fA-F]+$/.test(s);
}

function firstNonEmpty(...values: string[]): string {
  for (const value of values) {
    if (value.trim() !== '') return value;
  }
  return '';
}

function compactStrings(items: string[]): string[] {
  const result: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (trimmed !== '') result.push(trimmed);
  }
  return result;
}

function sanitizeText(value: string): string {
  let text = value.replace(/<br>|<br\/>|<br \/>|<\/p>/g, '\n');
  text = text.replace(htmlTagRegex, '');
  text = text.replace(/\u00a0/g, ' ').replace(/\t/g, ' ');
  const lines = text
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line) => line !== '');
  return lines.join('\n');
}

/** Go html.UnescapeString 的常用子集（命名 + 数字实体） */
const HTML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

function unescapeHTML(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (all, entity: string) => {
    if (entity[0] === '#') {
      const hex = entity[1] === 'x' || entity[1] === 'X';
      const code = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isNaN(code) ? all : String.fromCodePoint(code);
    }
    return HTML_ENTITIES[entity] ?? all;
  });
}

function decodePanURL(value: string): string {
  return unescapeHTML(value.trim()).replaceAll('\\/', '/');
}

// ---- HTTP 基座（超时 fetch + 简易 CookieJar + Set-Cookie 收集）----

interface FetchOpts {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  redirect?: RequestRedirect;
}

async function fetchResp(url: string, opts: FetchOpts = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? RequestTimeout);
  try {
    return await fetch(url, {
      method: opts.method ?? 'GET',
      headers: opts.headers,
      body: opts.body,
      redirect: opts.redirect ?? 'follow',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function setCookiePairs(resp: Response): string[] {
  return resp.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .filter((c) => {
      const eq = c.indexOf('=');
      return eq > 0 && c.slice(eq + 1) !== ''; // Go 只保留非空值
    });
}

interface JarCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  hostOnly: boolean;
}

/** 简易 CookieJar：域后缀/Host-only 匹配 + 路径前缀（Go cookiejar 所需子集） */
class CookieJar {
  private cookies = new Map<string, JarCookie>();

  update(url: URL, resp: Response): void {
    for (const header of resp.headers.getSetCookie()) {
      const parts = header.split(';');
      const eq = parts[0].indexOf('=');
      if (eq <= 0) continue;
      const name = parts[0].slice(0, eq).trim();
      const value = parts[0].slice(eq + 1).trim();
      if (value === '') continue;
      let domain = '';
      let path = '/';
      let maxAgeZero = false;
      for (let i = 1; i < parts.length; i++) {
        const attr = parts[i];
        const aeq = attr.indexOf('=');
        const aname = (aeq >= 0 ? attr.slice(0, aeq) : attr).trim().toLowerCase();
        const aval = aeq >= 0 ? attr.slice(aeq + 1).trim() : '';
        if (aname === 'domain') domain = aval.replace(/^\./, '').toLowerCase();
        else if (aname === 'path' && aval !== '') path = aval;
        else if (aname === 'max-age' && parseInt(aval, 10) === 0) maxAgeZero = true;
      }
      if (maxAgeZero) continue;
      const finalDomain = domain !== '' ? domain : url.hostname.toLowerCase();
      this.cookies.set(`${finalDomain}|${path}|${name}`, {
        name,
        value,
        domain: finalDomain,
        path,
        hostOnly: domain === '',
      });
    }
  }

  pairsFor(rawUrl: string): string[] {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    const path = url.pathname === '' ? '/' : url.pathname;
    return [...this.cookies.values()]
      .filter((c) => {
        if (c.hostOnly ? c.domain !== host : !(host === c.domain || host.endsWith(`.${c.domain}`))) return false;
        return path.startsWith(c.path);
      })
      .map((c) => `${c.name}=${c.value}`);
  }
}

/** 带 Cookie 跟随重定向（Go：带 Jar 的 client 自动重定向并保留 Cookie） */
async function fetchWithJar(
  jar: CookieJar,
  url: string,
  headers: Record<string, string>,
  method = 'GET',
  body?: string,
): Promise<{ status: number; resp: Response }> {
  let current = url;
  for (let hop = 0; hop < 10; hop++) {
    const u = new URL(current);
    const cookie = jar.pairsFor(current).join('; ');
    const reqHeaders: Record<string, string> = { ...headers };
    if (cookie !== '') reqHeaders['Cookie'] = cookie;
    const resp = await fetchResp(current, { headers: reqHeaders, redirect: 'manual', method, body });
    jar.update(u, resp);
    if ([301, 302, 303, 307, 308].includes(resp.status)) {
      const location = resp.headers.get('location');
      if (location !== null && location !== '') {
        void resp.body?.cancel().catch(() => {});
        current = new URL(location, current).href;
        continue;
      }
    }
    return { status: resp.status, resp };
  }
  throw new Error('重定向次数过多');
}

function panlianHeaders(cookie: string, referer: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': browserUserAgent(),
    'X-Requested-With': 'XMLHttpRequest',
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-TW,zh;q=0.9,zh-CN;q=0.8,en;q=0.7',
    Origin: DefaultBaseURL,
    Referer: referer,
  };
  if (cookie !== '') headers['Cookie'] = cookie;
  return headers;
}

/** GET JSON 接口：3 次重试（(n+1)*200ms 退避）；未登录内容直接抛 LoginRequiredError */
async function doJSONGET<T>(cookie: string, path: string, values: URLSearchParams | null): Promise<T> {
  let targetURL = DefaultBaseURL + path;
  if (values !== null && [...values.keys()].length > 0) targetURL += `?${values.toString()}`;

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    let body: string;
    let status: number;
    try {
      const resp = await fetchResp(targetURL, { headers: panlianHeaders(cookie, `${DefaultBaseURL}/all-videos.php`) });
      status = resp.status;
      body = await resp.text();
    } catch (err) {
      lastErr = err;
      await sleep((attempt + 1) * 200);
      continue;
    }
    if (status !== 200) {
      lastErr = new Error(`HTTP ${status}`);
      await sleep((attempt + 1) * 200);
      continue;
    }
    try {
      return JSON.parse(body) as T;
    } catch (err) {
      if (body.includes('请先登录') || body.includes('login')) {
        throw new LoginRequiredError(`login required: ${body}`);
      }
      throw new Error(`解析接口响应失败: ${err instanceof Error ? err.message : err}`);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ---- 站点登录（Go doLogin/reloginUser）----

async function doLogin(username: string, password: string, remember: boolean): Promise<{ cookie: string; loginResp: LoginResponse }> {
  username = username.trim();
  if (username === '' || password === '') throw new Error('账号和密码不能为空');
  const jar = new CookieJar();

  // 站点登录只认预先由公开接口建立的 PHPSESSID
  const pre = await fetchWithJar(jar, `${DefaultBaseURL}/api/get_types.php`, panlianHeaders('', `${DefaultBaseURL}/all-videos.php`));
  if (pre.status !== 200) throw new Error(`获取预登录会话失败: HTTP ${pre.status}`);

  const form = new URLSearchParams();
  form.set('username', username);
  form.set('password', password);
  if (remember) form.set('remember', 'on');

  const post = await fetchWithJar(
    jar,
    `${DefaultBaseURL}/api/login.php`,
    { ...panlianHeaders('', `${DefaultBaseURL}/pages/login.php`), 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    'POST',
    form.toString(),
  );
  const respBody = await post.resp.text();
  if (post.status !== 200) throw new Error(`登录请求失败: HTTP ${post.status}`);

  let loginResp: LoginResponse;
  try {
    loginResp = JSON.parse(respBody) as LoginResponse;
  } catch (err) {
    throw new Error(`解析登录响应失败: ${err instanceof Error ? err.message : err}`);
  }
  if (!loginResp.success) throw new Error((loginResp.message ?? '').trim());

  // Go cookiesToString：按名称排序、只保留非空值
  const cookieString = jar
    .pairsFor(DefaultBaseURL)
    .sort((a, b) => a.slice(0, a.indexOf('=')).localeCompare(b.slice(0, b.indexOf('='))))
    .join('; ');
  if (cookieString === '') throw new Error('登录成功但未获取到有效 Cookie');

  return { cookie: cookieString, loginResp };
}

async function reloginUser(user: User): Promise<void> {
  const password = decryptPassword(user.encrypted_password);
  let login: { cookie: string; loginResp: LoginResponse };
  try {
    login = await doLogin(user.username, password, true);
  } catch (err) {
    user.status = 'expired';
    user.cookie = '';
    try {
      saveUser(user);
    } catch {
      /* Go 此处忽略持久化错误 */
    }
    throw err;
  }

  user.cookie = login.cookie;
  user.status = 'active';
  user.login_at = nowISO();
  user.expire_at = plusDaysISO(30);
  user.last_access_at = nowISO();
  saveUser(user);
}

// ---- 密码加密（Go AES-256-GCM，nonce 前置 + tag 后置，与 Go 密文互通）----

function getEncryptionKey(): Buffer {
  const key = process.env['PANLIAN_ENCRYPTION_KEY'] ?? 'default-panlian-encryption-key!!';
  return Buffer.from(key).subarray(0, 32);
}

function encryptPassword(password: string): string {
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey());
  const nonce = randomBytes(12); // Go gcm.NonceSize() = 12
  const ciphertext = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, ciphertext, tag]).toString('base64');
}

function decryptPassword(encrypted: string): string {
  const data = Buffer.from(encrypted, 'base64');
  const nonceSize = 12;
  const tagSize = 16;
  if (data.length < nonceSize) throw new Error('密文长度不足');
  const nonce = data.subarray(0, nonceSize);
  const ciphertext = data.subarray(nonceSize, data.length - tagSize);
  const tag = data.subarray(data.length - tagSize);
  const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey());
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// ---- 搜索链路（Go searchImpl/searchOnce/buildSearchResult/flattenPanLinks）----

async function searchImpl(keyword: string): Promise<SearchResult[]> {
  ensureInit();
  const active = getActiveUsers();
  if (active.length === 0) return [];

  let lastErr: unknown = null;
  for (const user of active) {
    let results: SearchResult[];
    try {
      results = await searchWithUser(user, keyword);
    } catch (err) {
      lastErr = err;
      continue;
    }
    return filterResultsByKeyword(results, keyword);
  }

  if (lastErr !== null) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  return [];
}

async function searchWithUser(user: User, keyword: string): Promise<SearchResult[]> {
  try {
    const results = await searchOnce(user, keyword);
    user.last_access_at = nowISO();
    try {
      saveUser(user);
    } catch {
      /* Go 此处忽略持久化错误 */
    }
    return results;
  } catch (err) {
    if (!(err instanceof LoginRequiredError)) throw err;
    if (user.encrypted_password === '' || user.username === '') {
      user.status = 'expired';
      user.cookie = '';
      try {
        saveUser(user);
      } catch {
        /* Go 此处忽略持久化错误 */
      }
      throw err;
    }

    await reloginUser(user);
    return searchOnce(user, keyword);
  }
}

async function searchOnce(user: User, keyword: string): Promise<SearchResult[]> {
  const videoResp = await fetchVideos(user.cookie, keyword);
  if (videoResp.list.length === 0) return [];

  const items = videoResp.list.slice(0, MaxVideoResults);

  const limit = createLimiter(MaxConcurrentJobs);
  const outcomes = await Promise.all(
    items.map((item) => limit(async (): Promise<SearchResult | null | Error> => {
      try {
        return await buildSearchResult(user.cookie, keyword, item);
      } catch (err) {
        return err;
      }
    })),
  );

  const results: SearchResult[] = [];
  let loginErr: LoginRequiredError | null = null;
  for (const outcome of outcomes) {
    if (outcome instanceof LoginRequiredError) {
      loginErr = outcome;
      continue;
    }
    if (outcome instanceof Error) continue; // 其余错误丢弃（Go 只检查登录态错误）
    if (outcome !== null) results.push(outcome);
  }
  if (loginErr !== null) throw loginErr;

  results.sort((a, b) => timeOf(b.datetime) - timeOf(a.datetime));
  return results;
}

async function buildSearchResult(cookie: string, keyword: string, item: VideoItem): Promise<SearchResult | null> {
  const panResp = await fetchPanLinks(cookie, keyword, item.vod_id);

  const { links, summary, latestTime, truncated } = flattenPanLinks(panResp.data);
  if (links.length === 0) return null;

  const content = buildResultContent(item, summary, truncated);
  const datetime = latestTime === '' ? nowISO() : latestTime;

  const result: SearchResult = {
    message_id: String(item.vod_id),
    unique_id: `${PluginName}-${item.vod_id}`,
    channel: '', // 插件结果 Channel 必须为空
    datetime,
    title: item.vod_name.trim(),
    content,
    links,
    tags: compactStrings([item.type_name, PluginName]),
  };
  const pic = item.vod_pic.trim();
  if (pic !== '') result.images = [pic];

  return result;
}

function buildResultContent(item: VideoItem, summary: string, truncated: boolean): string {
  const parts: string[] = [];

  const metaLine = compactStrings([item.type_name, item.vod_remarks, item.vod_year, item.vod_area, item.vod_lang]).join(' / ');
  if (metaLine !== '') parts.push(metaLine);
  const actors = item.vod_actor.trim();
  if (actors !== '') parts.push(`主演: ${actors}`);
  const director = item.vod_director.trim();
  if (director !== '') parts.push(`导演: ${director}`);
  if (summary !== '') parts.push(`网盘汇总: ${summary}`);
  if (truncated) parts.push(`链接已截取最新 ${MaxLinksPerResult} 条`);
  const desc = sanitizeText(item.vod_content);
  if (desc !== '') parts.push(desc);

  return parts.join('\n');
}

function flattenPanLinks(groups: Record<string, PanGroup>): {
  links: { type: string; url: string; password: string; datetime: string; work_title: string }[];
  summary: string;
  latestTime: string;
  truncated: boolean;
} {
  if (Object.keys(groups).length === 0) return { links: [], summary: '', latestTime: '', truncated: false };

  const blocked = getBlockedPanTypes();
  const keys = Object.keys(groups).filter((key) => !isBlockedPanType(key, groups[key].name, blocked));
  const unknownRank = Object.keys(panOrder).length + 1;
  keys.sort((a, b) => {
    const pi = panOrder[normalizePanTypeName(a)] ?? unknownRank;
    const pj = panOrder[normalizePanTypeName(b)] ?? unknownRank;
    if (pi !== pj) return pi - pj;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  const links: { type: string; url: string; password: string; datetime: string; work_title: string }[] = [];
  const summaryParts: string[] = [];
  const seen = new Set<string>();
  let latestTime = '';
  let truncated = false;

  for (const key of keys) {
    const group = groups[key];
    const groupLinks = normalizePanLinks(key, group);
    if (groupLinks.length === 0) continue;

    summaryParts.push(`${group.name.trim()}${groupLinks.length}条`);

    for (const item of groupLinks) {
      if (links.length >= MaxLinksPerResult) {
        truncated = true;
        break;
      }
      const dedupeKey = `${item.url}@@${item.password}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const linkTime = parseLinkTime(item.time);
      if (linkTime > latestTime) latestTime = linkTime;

      const linkType = normalizeLinkType(item.type, item.url);
      links.push({
        type: linkType,
        url: normalizePanURL(item.url, item.password, linkType),
        password: item.password.trim(),
        datetime: linkTime,
        work_title: item.title.trim(),
      });
    }
    if (truncated) break;
  }

  return { links, summary: summaryParts.join(' / '), latestTime, truncated };
}

async function fetchVideos(cookie: string, keyword: string): Promise<VideoSearchResponse> {
  const values = new URLSearchParams({ wd: keyword, pg: '1' });
  const resp = await doJSONGET<VideoSearchResponse>(cookie, '/api/get_videos.php', values);
  if (resp.code === -1 && (resp.msg ?? '').includes('登录')) {
    throw new LoginRequiredError(`login required: ${resp.msg}`);
  }
  if (resp.code !== 1) throw new Error(`盘链列表接口异常: ${resp.msg}`);
  return resp;
}

async function fetchPanLinks(cookie: string, keyword: string, vodID: number): Promise<PanLinkResponse> {
  const values = new URLSearchParams({ keyword, vod_id: String(vodID), _t: String(Date.now()) });
  const resp = await doJSONGET<PanLinkResponse>(cookie, '/api/search_pan_links.php', values);
  if (!resp.success && (resp.message ?? '').includes('登录')) {
    throw new LoginRequiredError(`login required: ${resp.message}`);
  }
  if (!resp.success) throw new Error(`盘链网盘接口异常: ${resp.message}`);
  await resolvePanLinkTokens(cookie, resp.data);
  return resp;
}

/** token 短链并发解析，回填各分组的真实网盘 URL */
async function resolvePanLinkTokens(cookie: string, groups: Record<string, PanGroup>): Promise<void> {
  const jobs: Array<{ groupKey: string; index: number; token: string }> = [];
  for (const [groupKey, group] of Object.entries(groups)) {
    group.links.forEach((item, index) => {
      let candidate = item.url.trim();
      if (!isRealPanURL(candidate)) candidate = item.token.trim();
      if (candidate !== '' && !isRealPanURL(candidate)) {
        jobs.push({ groupKey, index, token: candidate });
      }
    });
  }
  if (jobs.length === 0) return;

  const limit = createLimiter(MaxConcurrentJobs);
  await Promise.all(
    jobs.map((job) =>
      limit(async () => {
        try {
          const resolvedURL = await resolvePanToken(cookie, job.token);
          if (isRealPanURL(resolvedURL)) {
            const group = groups[job.groupKey];
            if (group && job.index >= 0 && job.index < group.links.length) {
              group.links[job.index].url = resolvedURL;
            }
          }
        } catch {
          /* 单个 token 解析失败跳过（Go 同样丢弃失败结果） */
        }
      }),
    ),
  );
}

async function resolvePanToken(cookie: string, token: string): Promise<string> {
  token = token.trim();
  if (token === '') throw new Error('盘链 token 为空');
  if (isRealPanURL(token)) return token;

  // 优先走 resolve_token 接口
  try {
    const resp = await fetchResp(`${DefaultBaseURL}/api/resolve_token.php`, {
      method: 'POST',
      headers: { ...panlianHeaders(cookie, `${DefaultBaseURL}/pages/video.php`), 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (resp.status === 200) {
      const body = (await resp.text()).slice(0, 1 << 20); // Go LimitReader 1MB
      const resolved = JSON.parse(body) as resolveTokenResponse;
      if (resolved.success && isRealPanURL(resolved.url)) return resolved.url.trim();
    }
  } catch {
    /* 落入 go.php 兜底 */
  }

  // 兜底：go.php 短链跳转（不跟随重定向，读 Location 或页面内跳转目标）
  const resp = await fetchResp(`${DefaultBaseURL}/api/go.php?t=${encodeURIComponent(token)}`, {
    headers: {
      ...panlianHeaders(cookie, `${DefaultBaseURL}/pages/video.php`),
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    redirect: 'manual',
  });
  const location = (resp.headers.get('location') ?? '').trim();
  if (isRealPanURL(location)) return decodePanURL(location);

  const body = (await resp.text()).slice(0, 1 << 20);
  for (const pattern of panTokenURLRegexes) {
    pattern.lastIndex = 0;
    const match = pattern.exec(body);
    if (match && match[1]) {
      const resolvedURL = decodePanURL(match[1]);
      if (isRealPanURL(resolvedURL)) return resolvedURL;
    }
  }
  throw new Error('盘链 token 未解析出真实链接');
}

// ---- 规整函数（Go normalizePanLinks/normalizePanTypeName/normalizeLinkType 等）----

function normalizePanLinks(groupKey: string, group: PanGroup): PanLinkItem[] {
  const items: PanLinkItem[] = [];
  const seen = new Set<string>();

  for (const link of group.links) {
    const linkType = normalizeLinkType(firstNonEmpty(link.type, groupKey), link.url);
    const linkURL = normalizePanURL(link.url, link.password, linkType);
    if (!isRealPanURL(linkURL)) continue;

    const key = `${linkURL}@@${link.password.trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    items.push({
      title: link.title.trim(),
      url: linkURL,
      token: link.token.trim(),
      password: link.password.trim(),
      type: linkType,
      time: link.time.trim(),
      source: link.source.trim(),
      id: link.id.trim(),
      user_tier: link.user_tier.trim(),
    });
  }

  items.sort((a, b) => (parseLinkTime(b.time) || '').localeCompare(parseLinkTime(a.time) || ''));
  return items;
}

const PAN_TYPE_ALIASES: Record<string, string> = {
  迅雷: 'xunlei',
  迅雷云盘: 'xunlei',
  百度: 'baidu',
  百度网盘: 'baidu',
  夸克: 'quark',
  夸克网盘: 'quark',
  uc网盘: 'uc',
  '123网盘': '123',
  '123pan': '123',
  a123: '123',
  天翼: 'tianyi',
  天翼云盘: 'tianyi',
  a189: 'tianyi',
  '115网盘': '115',
  a115: '115',
  阿里: 'aliyun',
  阿里云盘: 'aliyun',
  阿里云: 'aliyun',
  ali: 'aliyun',
  光鸭: 'guangya',
  光鸭网盘: 'guangya',
  guangyapan: 'guangya',
  gy: 'guangya',
  中国移动云盘: 'mobile',
  移动云盘: 'mobile',
  a139: 'mobile',
  pikpak网盘: 'pikpak',
  磁力: 'magnet',
  磁链: 'magnet',
};

function normalizePanTypeName(value: string): string {
  const text = value.trim().toLowerCase();
  if (text === '' || text === '全部') return '';
  if (PAN_TYPE_ALIASES[text] !== undefined) return PAN_TYPE_ALIASES[text];
  return text;
}

function isBlockedPanType(groupKey: string, groupName: string, blocked: string[]): boolean {
  const key = normalizePanTypeName(groupKey);
  const name = normalizePanTypeName(groupName);
  return blocked.some((item) => item === key || item === name);
}

function normalizeLinkType(rawType: string, rawURL: string): string {
  const normalized = normalizePanTypeName(rawType);
  if (normalized !== '' && normalized !== 'others') return normalized;

  const urlLower = rawURL.trim().toLowerCase();
  if (urlLower.startsWith('magnet:')) return 'magnet';
  if (urlLower.startsWith('ed2k://')) return 'ed2k';
  if (urlLower.includes('pan.quark.cn') || urlLower.includes('pan.qoark.cn')) return 'quark';
  if (urlLower.includes('drive.uc.cn')) return 'uc';
  if (urlLower.includes('pan.baidu.com')) return 'baidu';
  if (urlLower.includes('aliyundrive.com') || urlLower.includes('alipan.com')) return 'aliyun';
  if (urlLower.includes('pan.xunlei.com')) return 'xunlei';
  if (urlLower.includes('cloud.189.cn')) return 'tianyi';
  if (urlLower.includes('115.com') || urlLower.includes('115cdn.com') || urlLower.includes('anxia.com')) return '115';
  if (
    urlLower.includes('123pan.com') ||
    urlLower.includes('123684.com') ||
    urlLower.includes('123685.com') ||
    urlLower.includes('123865.com') ||
    urlLower.includes('123912.com') ||
    urlLower.includes('123592.com')
  )
    return '123';
  if (urlLower.includes('caiyun.139.com') || urlLower.includes('yun.139.com')) return 'mobile';
  if (urlLower.includes('guangyapan')) return 'guangya';
  if (urlLower.includes('mypikpak.com') || urlLower.includes('mypikpak.net') || urlLower.includes('pikpakdrive.com')) return 'pikpak';
  return 'others';
}

function isRealPanURL(value: string): boolean {
  value = value.trim();
  if (value === '') return false;
  const lower = value.toLowerCase();
  return (
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('magnet:') ||
    lower.startsWith('ed2k:') ||
    lower.startsWith('thunder:')
  );
}

/** 123 盘分享域名规整：share.<123域名>/123pan/<id> → https://123865.com/s/<id>?pwd= */
function normalizePanShareURL(rawURL: string, linkType: string): string {
  const clean = rawURL.trim();
  if (clean === '') return '';

  let parsed: URL;
  try {
    parsed = new URL(clean);
  } catch {
    return clean;
  }
  if (parsed.hostname === '') return clean;

  const hostname = parsed.hostname.toLowerCase();
  const shareHost = pan123ShareHostRegex.test(hostname);
  const pathParts = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/');
  if ((normalizePanTypeName(linkType) === '123' || shareHost) && shareHost && pathParts.length === 2 && pathParts[0].toLowerCase() === '123pan' && pathParts[1] !== '') {
    const query = new URLSearchParams();
    for (const key of ['pwd', 'pass', 'password', 'code']) {
      const value = parsed.searchParams.get(key) ?? '';
      if (value !== '') {
        query.set('pwd', value);
        break;
      }
    }
    const normalized = `https://123865.com/s/${pathParts[1]}`;
    const qs = query.toString();
    return qs !== '' ? `${normalized}?${qs}` : normalized;
  }
  return clean;
}

function normalizePanURL(rawURL: string, password: string, linkType: string): string {
  let clean = normalizePanShareURL(rawURL.trim(), linkType);
  clean = clean.replace(/#+$/, '');
  clean = clean.replace(extractCodeNoiseRegex, '');
  clean = clean.trim();
  if (clean === '') return '';

  if (password === '') return clean;
  const lower = clean.toLowerCase();
  if (lower.includes('pwd=') || lower.includes('password=') || lower.includes('passcode=')) return clean;

  switch (linkType) {
    case 'baidu':
    case 'xunlei':
    case '123':
      return clean.includes('?') ? `${clean}&pwd=${encodeURIComponent(password)}` : `${clean}?pwd=${encodeURIComponent(password)}`;
    case '115':
      return clean.includes('?')
        ? `${clean}&password=${encodeURIComponent(password)}`
        : `${clean}?password=${encodeURIComponent(password)}`;
    default:
      return clean;
  }
}

/** 链接时间解析：RFC3339 / "2006-01-02 15:04:05" / "2006-01-02"（无时区按 UTC，Go time.Parse 语义） */
function parseLinkTime(value: string): string {
  value = value.trim();
  if (value === '') return '';

  const dt = value.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/);
  if (dt) {
    // Go time.Parse 失败 → 尝试下一布局；语义非法日期需校验后继续
    const t = new Date(`${dt[1]}T${dt[2]}Z`);
    if (!Number.isNaN(t.getTime())) return t.toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const t = new Date(`${value}T00:00:00Z`);
    if (!Number.isNaN(t.getTime())) return t.toISOString();
  }
  const t = new Date(value); // RFC3339 带时区
  return Number.isNaN(t.getTime()) ? '' : t.toISOString();
}

function normalizeBlockedPanTypes(value: unknown): string[] {
  let raw: string[];
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') raw = value.split(/[\n,，]/);
  else if (Array.isArray(value)) raw = value.map((v) => String(v));
  else raw = [String(value)];

  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    const normalized = normalizePanTypeName(item);
    if (normalized === '') continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

// ---- Web 管理页（Go handleManagePage / handleManagePagePOST 及各 action）----

function sendJSON(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function respondSuccess(res: ServerResponse, message: string, data: unknown): void {
  sendJSON(res, 200, { success: true, message, data });
}

function respondError(res: ServerResponse, message: string): void {
  sendJSON(res, 200, { success: false, message, data: null });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 10 * 1024 * 1024) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function handleManagePage(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
  const param = params['param'] ?? '';
  if (param.length === 64 && isHexString(param)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(htmlTemplate.replaceAll('HASH_PLACEHOLDER', param));
    return;
  }
  res.writeHead(302, { Location: `/panlian/${generateHash(param)}` });
  res.end();
}

async function handleManagePagePOST(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
  ensureInit();
  const hash = params['param'] ?? '';

  let reqData: Record<string, unknown>;
  try {
    reqData = JSON.parse(await readBody(req)) as Record<string, unknown>;
  } catch (err) {
    respondError(res, `无效的请求格式: ${err instanceof Error ? err.message : err}`);
    return;
  }

  const action = typeof reqData['action'] === 'string' ? reqData['action'] : '';
  if (action === '') {
    respondError(res, '缺少action字段');
    return;
  }

  switch (action) {
    case 'get_status':
      await handleGetStatus(res, hash);
      return;
    case 'login':
      await handleLogin(res, hash, reqData);
      return;
    case 'logout':
      await handleLogout(res, hash);
      return;
    case 'update_config':
      handleUpdateConfig(res, reqData);
      return;
    case 'test_search':
      await handleTestSearch(res, hash, reqData);
      return;
    default:
      respondError(res, `未知的操作类型: ${action}`);
  }
}

async function handleGetStatus(res: ServerResponse, hash: string): Promise<void> {
  let user = getUserByHash(hash);
  if (user === undefined) {
    user = {
      hash,
      username: '',
      encrypted_password: '',
      cookie: '',
      status: 'pending',
      created_at: nowISO(),
      login_at: '',
      expire_at: '',
      last_access_at: nowISO(),
    };
    try {
      saveUser(user);
    } catch {
      /* Go 忽略 */
    }
  } else {
    user.last_access_at = nowISO();
    try {
      saveUser(user);
    } catch {
      /* Go 忽略 */
    }
  }

  const loggedIn = user.status === 'active' && user.cookie !== '';
  let expiresInDays = 0;
  if (user.expire_at !== '') {
    expiresInDays = Math.floor((timeOf(user.expire_at) - Date.now()) / (24 * 60 * 60 * 1000));
    if (expiresInDays < 0) expiresInDays = 0;
  }

  respondSuccess(res, '获取成功', {
    hash,
    logged_in: loggedIn,
    status: user.status,
    username: user.username,
    login_time: formatTime(user.login_at),
    expire_time: formatTime(user.expire_at),
    expires_in_days: expiresInDays,
    blocked_pan_types: getBlockedPanTypes(),
  });
}

async function handleLogin(res: ServerResponse, hash: string, reqData: Record<string, unknown>): Promise<void> {
  const username = typeof reqData['username'] === 'string' ? reqData['username'] : '';
  const password = typeof reqData['password'] === 'string' ? reqData['password'] : '';
  const remember = reqData['remember'] === true;
  if (username.trim() === '' || password === '') {
    respondError(res, '缺少用户名或密码');
    return;
  }

  // Go 语义：未显式传 remember 字段时默认为 true（勾选记住）
  let login: { cookie: string; loginResp: LoginResponse };
  try {
    login = await doLogin(username, password, remember || !('remember' in reqData));
  } catch (err) {
    respondError(res, `登录失败: ${err instanceof Error ? err.message : err}`);
    return;
  }

  const encryptedPassword = encryptPassword(password);

  let user = getUserByHash(hash);
  if (user === undefined) {
    user = {
      hash,
      username: '',
      encrypted_password: '',
      cookie: '',
      status: '',
      created_at: nowISO(),
      login_at: '',
      expire_at: '',
      last_access_at: '',
    };
  }
  user.username = username.trim();
  user.encrypted_password = encryptedPassword;
  user.cookie = login.cookie;
  user.status = 'active';
  user.login_at = nowISO();
  user.expire_at = plusDaysISO(30);
  user.last_access_at = nowISO();

  try {
    saveUser(user);
  } catch (err) {
    respondError(res, `保存登录信息失败: ${err instanceof Error ? err.message : err}`);
    return;
  }

  respondSuccess(res, '登录成功', {
    username: login.loginResp.user.username,
    status: 'active',
  });
}

async function handleLogout(res: ServerResponse, hash: string): Promise<void> {
  const user = getUserByHash(hash);
  if (user === undefined) {
    respondError(res, '用户不存在');
    return;
  }
  user.cookie = '';
  user.status = 'pending';
  user.last_access_at = nowISO();
  try {
    saveUser(user);
  } catch {
    respondError(res, '退出失败');
    return;
  }
  respondSuccess(res, '已退出登录', { status: user.status });
}

function handleUpdateConfig(res: ServerResponse, reqData: Record<string, unknown>): void {
  let raw: unknown = reqData['blocked_pan_types'];
  if (raw === undefined) raw = reqData['blockedPanTypes'];

  try {
    configState.blocked_pan_types = normalizeBlockedPanTypes(raw);
    configState.updated_at = nowISO();
    saveConfig();
  } catch (err) {
    respondError(res, `保存配置失败: ${err instanceof Error ? err.message : err}`);
    return;
  }

  respondSuccess(res, '配置已保存', {
    blocked_pan_types: getBlockedPanTypes(),
  });
}

async function handleTestSearch(res: ServerResponse, hash: string, reqData: Record<string, unknown>): Promise<void> {
  const keyword = (typeof reqData['keyword'] === 'string' ? reqData['keyword'] : '').trim();
  if (keyword === '') {
    respondError(res, '缺少keyword字段');
    return;
  }

  const user = getUserByHash(hash);
  if (user === undefined || user.cookie === '' || user.status !== 'active') {
    respondError(res, '请先登录');
    return;
  }

  let results: SearchResult[];
  try {
    results = await searchWithUser(user, keyword);
  } catch (err) {
    respondError(res, `测试搜索失败: ${err instanceof Error ? err.message : err}`);
    return;
  }

  const frontendResults = results.map((result) => ({
    message_id: result.message_id,
    unique_id: result.unique_id,
    channel: result.channel,
    title: result.title,
    content: result.content,
    datetime: formatTime(result.datetime),
    tags: result.tags,
    images: result.images,
    link_count: result.links.length,
    links: result.links.map((link) => ({
      type: link.type,
      url: link.url,
      password: link.password,
      datetime: formatTime(link.datetime),
      work_title: link.work_title,
    })),
  }));
  const totalLinks = frontendResults.reduce((sum, r) => sum + r.link_count, 0);

  respondSuccess(res, `找到 ${frontendResults.length} 条结果，共 ${totalLinks} 个链接`, {
    keyword,
    total_results: frontendResults.length,
    total_links: totalLinks,
    results: frontendResults,
  });
}

// ---- 插件注册（Go init() + RegisterGlobalPlugin + RegisterWebRoutes）----

export const panlian = definePlugin({
  name: 'panlian',
  priority: 3, // Go NewBaseAsyncPlugin("panlian", 3)
  // 未实现 Go SkipServiceFilter → 保留 Service 层关键词过滤
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    return searchImpl(keyword);
  },
  webRoutes: [
    { method: 'GET', path: '/panlian/:param', handler: handleManagePage },
    { method: 'POST', path: '/panlian/:param', handler: handleManagePagePOST },
  ],
});
