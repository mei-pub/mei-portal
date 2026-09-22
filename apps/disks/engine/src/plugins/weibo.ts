// 微博账号型搜索插件 —— Go plugin/weibo/weibo.go 的代码级移植
// 账号型插件：扫码登录微博建立 cookie 会话后，按配置的博主 UID 列表抓取其微博
// 正文 / url_struct / 评论中的网盘链接；除搜索外注册 Web 管理页路由 /weibo/:param
// （GET 渲染管理页 + POST 动作分发），与 Go RegisterWebRoutes 逐条对齐。
// 基础设施差异（Go 版可删部分）：
//   - Go http.Client 的 Transport/连接池参数：Node fetch 由 undici 接管，无需复刻
//   - Go 清理协程（24h ticker）：改为 setInterval + unref，语义一致且不阻止进程退出
//   - Go net/http/cookiejar：文件内实现简易 CookieJar（域匹配 + 手动跟随重定向收集
//     Set-Cookie），覆盖 initCookieFromAlt / doLogin 所需的 weibo.com / m.weibo.cn 会话
//   - Go parseWeibo 中遗留的 fmt.Println(links) 调试残留未移植（每次解析向 stdout 打一行
//     链接切片，无业务含义）

import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createLimiter } from '../http.ts';
import type { Link, SearchResult, WebRoute } from '../types.ts';
import { definePlugin } from './shared.ts';

const MaxConcurrentUsers = 10; // 最多同时搜索多少个微博用户
const MaxConcurrentWeibo = 30; // 最多同时处理多少条微博（获取评论）
const MaxComments = 1; // 每条微博最多获取多少条评论
const SEARCH_TIMEOUT = 30_000; // Go searchUserWeibo/getComments 的 30s 客户端超时

const PC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15';
const WIN86_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.111 Safari/537.36';

// ---- 管理页 HTML（Go HTMLTemplate 逐段复刻，服务端渲染，仅替换 HASH_PLACEHOLDER）----
const HTMLTemplate = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PanSou 微博搜索配置</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 20px;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        .section {
            padding: 30px;
            border-bottom: 1px solid #eee;
        }
        .section:last-child { border-bottom: none; }
        .section-title {
            font-size: 18px;
            font-weight: bold;
            margin-bottom: 15px;
            color: #333;
        }
        .status-box {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 15px;
        }
        .status-item {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
        }
        .qrcode-container {
            text-align: center;
            padding: 20px;
        }
        .qrcode-img {
            max-width: 200px;
            border: 2px solid #ddd;
            border-radius: 8px;
        }
        .btn {
            padding: 10px 20px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.3s;
        }
        .btn-primary {
            background: #667eea;
            color: white;
        }
        .btn-primary:hover { background: #5568d3; }
        .btn-danger {
            background: #f56565;
            color: white;
        }
        .btn-danger:hover { background: #e53e3e; }
        .btn-secondary {
            background: #e2e8f0;
            color: #333;
        }
        .btn-secondary:hover { background: #cbd5e0; }
        textarea {
            width: 100%;
            padding: 10px 15px;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 14px;
            resize: vertical;
            font-family: monospace;
        }
        .test-results {
            max-height: 300px;
            overflow-y: auto;
            background: #f8f9fa;
            padding: 15px;
            border-radius: 6px;
            margin-top: 10px;
        }
        .hidden { display: none; }
        .alert {
            padding: 12px 15px;
            border-radius: 6px;
            margin: 10px 0;
        }
        .alert-success {
            background: #c6f6d5;
            color: #22543d;
        }
        .alert-error {
            background: #fed7d7;
            color: #742a2a;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔍 PanSou 微博搜索</h1>
            <p>配置你的专属搜索服务</p>
            <p style="font-size: 12px; margin-top: 10px; opacity: 0.8;">
                🔗 当前地址: <span id="current-url">HASH_PLACEHOLDER</span>
            </p>
        </div>

        <div class="section" id="login-section">
            <div class="section-title">📱 登录状态</div>

            <div id="logged-in-view" class="hidden">
                <div class="status-box">
                    <div class="status-item">
                        <span>状态</span>
                        <span><strong style="color: #48bb78;">✅ 已登录</strong></span>
                    </div>
                    <div class="status-item">
                        <span>登录时间</span>
                        <span id="login-time">-</span>
                    </div>
                    <div class="status-item">
                        <span>有效期</span>
                        <span id="expire-info">-</span>
                    </div>
                </div>
                <button class="btn btn-danger" onclick="logout()">退出登录</button>
            </div>

            <div id="not-logged-in-view" class="hidden">
                <div class="qrcode-container">
                    <img id="qrcode-img" class="qrcode-img" src="" alt="二维码">
                    <p style="margin-top: 10px; color: #666;">
                        请使用手机微博扫描二维码登录
                    </p>
                    <p style="font-size: 12px; color: #999;">扫码后自动检测登录状态</p>
                    <button class="btn btn-secondary" onclick="refreshQRCode()" style="margin-top: 10px;">
                        刷新二维码
                    </button>
                </div>
            </div>
        </div>

        <div class="section" id="users-section">
            <div class="section-title">👤 微博用户管理 (<span id="user-count">0</span> 个)</div>

            <div id="alert-box"></div>

            <p style="margin-bottom: 10px; color: #666;">每行一个微博用户ID，保存时自动去重</p>
            <textarea id="users-textarea" rows="10" placeholder="5487050770
1234567890
9876543210"></textarea>

            <button class="btn btn-primary" onclick="saveUsers()" style="margin-top: 10px;">保存用户配置</button>
        </div>

        <div class="section" id="test-section">
            <div class="section-title">🔍 测试搜索(限制返回10条数据)</div>

            <div style="display: flex; gap: 10px;">
                <input type="text" id="search-keyword" placeholder="输入关键词测试搜索" style="flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 6px;">
                <button class="btn btn-primary" onclick="testSearch()">搜索</button>
            </div>

            <div id="search-results" class="test-results hidden"></div>
        </div>
    </div>

    <script>
        const HASH = 'HASH_PLACEHOLDER';
        const API_URL = '/weibo/' + HASH;
        let statusCheckInterval = null;
        let loginCheckInterval = null;

        window.onload = function() {
            updateStatus();
            startStatusPolling();
        };

        function startStatusPolling() {
            statusCheckInterval = setInterval(updateStatus, 3000);
        }

        function startLoginPolling() {
            if (loginCheckInterval) return;
            loginCheckInterval = setInterval(checkLogin, 2000);
        }

        function stopLoginPolling() {
            if (loginCheckInterval) {
                clearInterval(loginCheckInterval);
                loginCheckInterval = null;
            }
        }

        async function postAction(action, extraData = {}) {
            try {
                const response = await fetch(API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: action, ...extraData })
                });
                return await response.json();
            } catch (error) {
                console.error('请求失败:', error);
                return { success: false, message: '请求失败: ' + error.message };
            }
        }

        async function updateStatus() {
            const result = await postAction('get_status');
            if (result.success && result.data) {
                const data = result.data;

                if (data.logged_in === true && data.status === 'active') {
                    document.getElementById('logged-in-view').classList.remove('hidden');
                    document.getElementById('not-logged-in-view').classList.add('hidden');

                    document.getElementById('login-time').textContent = data.login_time || '-';
                    document.getElementById('expire-info').textContent = '剩余 ' + (data.expires_in_days || 0) + ' 天';

                    stopLoginPolling();
                } else {
                    document.getElementById('logged-in-view').classList.add('hidden');
                    document.getElementById('not-logged-in-view').classList.remove('hidden');

                    if (data.qrcode_base64) {
                        document.getElementById('qrcode-img').src = data.qrcode_base64;
                    }

                    startLoginPolling();
                }

                updateUserList(data.user_ids || []);
            }
        }

        async function checkLogin() {
            const result = await postAction('check_login');
            if (result.success && result.data) {
                if (result.data.login_status === 'success') {
                    stopLoginPolling();
                    showAlert('登录成功！');
                    updateStatus();
                }
            }
        }

        function updateUserList(userIds) {
            const textarea = document.getElementById('users-textarea');
            const count = document.getElementById('user-count');

            count.textContent = userIds.length;

            if (document.activeElement !== textarea) {
                textarea.value = userIds.join('\n');
            }
        }

        function showAlert(message, type = 'success') {
            const alertBox = document.getElementById('alert-box');
            alertBox.innerHTML = '<div class="alert alert-' + type + '">' + message + '</div>';
            setTimeout(() => {
                alertBox.innerHTML = '';
            }, 3000);
        }

        async function refreshQRCode() {
            const result = await postAction('refresh_qrcode');
            if (result.success) {
                showAlert(result.message);
                updateStatus();
                startLoginPolling();
            } else {
                showAlert(result.message, 'error');
            }
        }

        async function logout() {
            if (!confirm('确定要退出登录吗？')) return;

            const result = await postAction('logout');
            if (result.success) {
                showAlert(result.message);
                updateStatus();
            } else {
                showAlert(result.message, 'error');
            }
        }

        async function saveUsers() {
            const textarea = document.getElementById('users-textarea');
            const usersText = textarea.value.trim();

            const userIds = usersText
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0);

            const result = await postAction('set_user_ids', { user_ids: userIds });
            if (result.success) {
                showAlert(result.message);
                updateStatus();
            } else {
                showAlert(result.message, 'error');
            }
        }

        async function testSearch() {
            const keyword = document.getElementById('search-keyword').value.trim();

            if (!keyword) {
                showAlert('请输入搜索关键词', 'error');
                return;
            }

            const resultsDiv = document.getElementById('search-results');
            resultsDiv.classList.remove('hidden');
            resultsDiv.innerHTML = '<div>🔍 搜索中...</div>';

            const result = await postAction('test_search', { keyword });

            if (result.success) {
                const results = result.data.results || [];

                if (results.length === 0) {
                    resultsDiv.innerHTML = '<p style="text-align: center; color: #999;">未找到结果</p>';
                    return;
                }

                let html = '<p><strong>找到 ' + result.data.total_results + ' 条结果</strong></p>';
                results.forEach((item, index) => {
                    html += '<div style="margin: 15px 0; padding: 10px; background: white; border-radius: 6px;">';
                    html += '<p><strong>' + (index + 1) + '. ' + item.title + '</strong></p>';
                    item.links.forEach(link => {
                        html += '<p style="font-size: 12px; color: #666; margin: 5px 0; word-break: break-all;">';
                        html += '[' + link.type + '] ' + link.url;
                        if (link.password) html += ' 密码: ' + link.password;
                        html += '</p>';
                    });
                    html += '</div>';
                });
                resultsDiv.innerHTML = html;
            } else {
                resultsDiv.innerHTML = '<p style="color: red;">' + result.message + '</p>';
            }
        }

        document.getElementById('search-keyword').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') testSearch();
        });
    </script>
</body>
</html>`;

// ---- 账号模型（Go User：transient 字段 QRCodeCache/Qrsig 用独立内存表，等价 json:"-"）----

interface User {
  hash: string;
  cookie: string;
  status: string;
  user_ids: string[];
  created_at: string; // ISO 字符串（'' 表示 Go 零时）
  login_at: string;
  expire_at: string;
  last_access_at: string;
  last_refresh: string; // Cookie 上次刷新时间
}

/** 扫码会话的内存态（Go User.QRCodeCache/QRCodeCacheTime/Qrsig，均不落盘） */
interface QRState {
  pngBase64: string;
  qrid: string;
  time: number;
}

interface UserTask {
  userID: string;
  cookie: string;
}

interface Comment {
  text: string;
  urls: string[];
}

interface LoginResult {
  status: 'success' | 'waiting' | 'expired';
  cookie: string;
  message: string;
}

let StorageDir = '';
const users = new Map<string, User>();
const qrState = new Map<string, QRState>();
let initialized = false;

// ---- 初始化与持久化（Go Initialize/loadAllUsers/persistUser/deleteUser）----

function ensureInit(): void {
  if (initialized) return;
  initialized = true;

  const cachePath = process.env['CACHE_PATH'] ?? '';
  StorageDir = join(cachePath !== '' ? cachePath : './cache', 'weibo_users');
  try {
    mkdirSync(StorageDir, { recursive: true });
  } catch (err) {
    console.error(`[Weibo] 创建存储目录失败: ${err instanceof Error ? err.message : err}`);
  }
  loadAllUsers();

  // Go startCleanupTask：24h 一次清理过期用户
  const timer = setInterval(() => {
    const deleted = cleanupExpiredUsers();
    const marked = markInactiveUsers();
    if (deleted > 0 || marked > 0) {
      console.log(`[Weibo] 清理任务完成: 删除 ${deleted} 个过期用户, 标记 ${marked} 个不活跃用户`);
    }
  }, 24 * 60 * 60 * 1000);
  timer.unref();
}

function loadAllUsers(): void {
  let names: string[];
  try {
    names = readdirSync(StorageDir);
  } catch {
    return;
  }
  let count = 0;
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const data = readFileSync(join(StorageDir, name), 'utf8');
      const user = JSON.parse(data) as User;
      users.set(user.hash, user);
      count++;
    } catch {
      continue;
    }
  }
  console.log(`[Weibo] 已加载 ${count} 个用户到内存`);
}

function getUserByHash(hash: string): User | undefined {
  return users.get(hash);
}

function saveUser(user: User): void {
  users.set(user.hash, user);
  writeFileSync(join(StorageDir, `${user.hash}.json`), JSON.stringify(user, null, 2));
}

function deleteUser(hash: string): void {
  users.delete(hash);
  try {
    rmSync(join(StorageDir, `${hash}.json`));
  } catch {
    /* 文件不存在视为已删除 */
  }
}

function getActiveUsers(): User[] {
  const active: User[] = [];
  for (const user of users.values()) {
    if (user.status !== 'active') continue;
    if (user.expire_at !== '' && Date.now() > timeOf(user.expire_at)) {
      user.status = 'expired';
      user.cookie = '';
      try {
        saveUser(user);
      } catch {
        /* Go 此处忽略持久化错误 */
      }
      continue;
    }
    if (user.user_ids.length === 0) continue;
    active.push(user);
  }
  return active;
}

function cleanupExpiredUsers(): number {
  const expireThreshold = Date.now() - 30 * 24 * 60 * 60 * 1000;
  let deletedCount = 0;
  for (const user of [...users.values()]) {
    if (user.status === 'expired' && timeOf(user.last_access_at) < expireThreshold) {
      deleteUser(user.hash);
      deletedCount++;
    }
  }
  return deletedCount;
}

function markInactiveUsers(): number {
  const inactiveThreshold = Date.now() - 90 * 24 * 60 * 60 * 1000;
  let markedCount = 0;
  for (const user of [...users.values()]) {
    if (timeOf(user.last_access_at) < inactiveThreshold && user.status !== 'expired') {
      user.status = 'expired';
      user.cookie = '';
      try {
        saveUser(user);
        markedCount++;
      } catch {
        continue;
      }
    }
  }
  return markedCount;
}

// ---- 通用小工具 ----

function timeOf(iso: string): number {
  if (iso === '') return 0; // Go 零时（1970 前的零值按最旧处理）
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

function nowISO(): string {
  return new Date().toISOString();
}

function plusDaysISO(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Go Format("2006-01-02 15:04:05") 的本地时间格式；零时输出与 Go 一致 */
function formatTime(iso: string): string {
  if (iso === '') return '0001-01-01 00:00:00';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function generateHash(input: string): string {
  const salt = process.env['WEIBO_HASH_SALT'] ?? 'pansou_weibo_secret_2025';
  return createHash('sha256').update(input + salt).digest('hex');
}

function isHexString(s: string): boolean {
  return /^[0-9a-fA-F]+$/.test(s);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

// ---- HTTP 基座（超时 fetch + 简易 CookieJar，Go http.Client/cookiejar 的对应物）----

interface FetchOpts {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  redirect?: RequestRedirect;
}

async function fetchResp(url: string, opts: FetchOpts = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
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

interface ParsedSetCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
}

function parseSetCookie(header: string): ParsedSetCookie | null {
  const parts = header.split(';');
  const eq = parts[0].indexOf('=');
  if (eq <= 0) return null;
  const name = parts[0].slice(0, eq).trim();
  const value = parts[0].slice(eq + 1).trim();
  let domain = '';
  let path = '/';
  for (let i = 1; i < parts.length; i++) {
    const attr = parts[i];
    const aeq = attr.indexOf('=');
    const aname = (aeq >= 0 ? attr.slice(0, aeq) : attr).trim().toLowerCase();
    const aval = aeq >= 0 ? attr.slice(aeq + 1).trim() : '';
    if (aname === 'domain') domain = aval.replace(/^\./, '').toLowerCase();
    else if (aname === 'path' && aval !== '') path = aval;
    else if (aname === 'max-age' && parseInt(aval, 10) === 0) return null; // 删除指令
    else if (aname === 'expires') {
      const t = Date.parse(aval);
      if (!Number.isNaN(t) && t <= Date.now()) return null;
    }
  }
  if (value === '') return null; // Go 仅保留非空值
  return { name, value, domain, path };
}

interface JarCookie extends ParsedSetCookie {
  hostOnly: boolean;
  seq: number;
}

/** 简易 CookieJar：域后缀/Host-only 匹配 + 路径前缀，按路径长度降序、创建顺序输出 */
class CookieJar {
  private cookies = new Map<string, JarCookie>();
  private nextSeq = 0;

  update(url: URL, resp: Response): void {
    for (const header of resp.headers.getSetCookie()) {
      const parsed = parseSetCookie(header);
      if (!parsed) continue;
      const domain = parsed.domain !== '' ? parsed.domain : url.hostname.toLowerCase();
      this.cookies.set(`${domain}|${parsed.path}|${parsed.name}`, {
        ...parsed,
        domain,
        hostOnly: parsed.domain === '',
        seq: this.nextSeq++,
      });
    }
  }

  /** 命中请求 URL 的全部 Cookie，按 name=value 形式返回 */
  pairsFor(rawUrl: string): string[] {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    const path = url.pathname === '' ? '/' : url.pathname;
    const matched = [...this.cookies.values()].filter((c) => {
      if (c.hostOnly ? c.domain !== host : !(host === c.domain || host.endsWith(`.${c.domain}`))) return false;
      return path.startsWith(c.path);
    });
    matched.sort((a, b) => b.path.length - a.path.length || a.seq - b.seq);
    return matched.map((c) => `${c.name}=${c.value}`);
  }

  headerFor(rawUrl: string): string {
    return this.pairsFor(rawUrl).join('; ');
  }
}

/** 带 Cookie 跟随重定向（Go：带 Jar 的 client 自动重定向并保留 Cookie） */
async function fetchWithJar(
  jar: CookieJar,
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  method = 'GET',
  body?: string,
): Promise<{ status: number; resp: Response }> {
  let current = url;
  for (let hop = 0; hop < 10; hop++) {
    const u = new URL(current);
    const cookie = jar.headerFor(current);
    const reqHeaders: Record<string, string> = { ...headers };
    if (cookie !== '') reqHeaders['Cookie'] = cookie;
    const resp = await fetchResp(current, { headers: reqHeaders, timeoutMs, redirect: 'manual', method, body });
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

// ---- 微博扫码登录（Go generateQRCodeWithSig/checkQRLoginStatus/initCookieFromAlt）----

async function generateQRCodeWithSig(): Promise<{ pngBase64: string; qrid: string }> {
  const timestamp = Date.now();
  const infoURL = `https://passport.weibo.com/sso/v2/qrcode/image?entry=miniblog&size=180&callback=STK_${timestamp}`;
  const headers = { 'User-Agent': WIN86_UA, Referer: 'https://weibo.com/' };

  const infoResp = await fetchResp(infoURL, { timeoutMs: 15_000, headers });
  const infoText = await infoResp.text();

  const apiKeyMatch = infoText.match(/api_key=([^"]+)/);
  if (!apiKeyMatch) throw new Error('无法提取api_key');
  const apiKey = apiKeyMatch[1];

  const qridMatch = infoText.match(/"qrid":"([^"]+)"/);
  if (!qridMatch) throw new Error('无法提取qrid');
  const qrid = qridMatch[1];

  // 使用 api_key 获取二维码图片
  const qrResp = await fetchResp(`https://v2.qr.weibo.cn/inf/gen?api_key=${apiKey}`, { timeoutMs: 15_000, headers });
  const pngBase64 = Buffer.from(await qrResp.arrayBuffer()).toString('base64');
  return { pngBase64, qrid };
}

/** 从 alt URL 初始化 PC + 移动端 Cookie（Go initCookieFromAlt 四步链） */
async function initCookieFromAlt(alt: string): Promise<string> {
  const jar = new CookieJar();
  const headersPC = { 'User-Agent': WIN86_UA, Referer: 'https://weibo.com/' };
  const headersMobile = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    Referer: 'https://m.weibo.cn/',
  };

  await fetchWithJar(jar, alt, headersPC, 30_000); // 步骤1：alt URL（跟随重定向，保留 Cookie）
  await fetchWithJar(jar, 'https://weibo.com/', headersPC, 30_000); // 步骤2：PC 首页
  await fetchWithJar(jar, 'https://m.weibo.cn/', headersMobile, 30_000); // 步骤3：移动端首页
  await fetchWithJar(jar, 'https://m.weibo.cn/profile', headersMobile, 30_000); // 步骤4：移动端 profile

  const allCookies = new Map<string, string>();
  for (const base of ['https://weibo.com', 'https://m.weibo.cn']) {
    for (const pair of jar.pairsFor(base)) {
      const eq = pair.indexOf('=');
      if (eq > 0) allCookies.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
  }

  for (const field of ['SUB', 'SUBP']) {
    if (!allCookies.has(field)) throw new Error(`缺少必需的Cookie字段: ${field}`);
  }

  return [...allCookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function checkQRLoginStatus(qrsig: string): Promise<LoginResult> {
  const timestamp = Date.now();
  const checkURL = `https://passport.weibo.com/sso/v2/qrcode/check?entry=sso&qrid=${encodeURIComponent(qrsig)}&callback=STK_${timestamp}`;

  console.log(`[Weibo DEBUG] checkQRLoginStatus调用 - qrsig: ${qrsig}`);

  const resp = await fetchResp(checkURL, {
    timeoutMs: 15_000,
    redirect: 'manual', // Go CheckRedirect: ErrUseLastResponse
    headers: { 'User-Agent': WIN86_UA, Referer: 'https://weibo.com/' },
  });
  const responseText = await resp.text();
  console.log(`[Weibo DEBUG] 原始响应: ${responseText}`);

  // 响应可能是 JSONP: STK_xxx({...}) 或纯 JSON: {...}
  let jsonStr: string;
  if (responseText.startsWith('STK_')) {
    const startIdx = responseText.indexOf('({');
    const endIdx = responseText.lastIndexOf('})');
    if (startIdx === -1 || endIdx === -1) return { status: 'waiting', cookie: '', message: '' };
    jsonStr = responseText.slice(startIdx + 1, endIdx + 1);
  } else if (responseText.startsWith('{')) {
    jsonStr = responseText;
  } else {
    return { status: 'waiting', cookie: '', message: '' };
  }

  let result: { retcode?: unknown; msg?: unknown; data?: { url?: unknown } };
  try {
    result = JSON.parse(jsonStr);
  } catch {
    return { status: 'waiting', cookie: '', message: '' };
  }

  const retcode = result.retcode;
  // 20000000: 扫码成功 / 50114001: 等待扫码 / 50114002: 已扫描待确认 / 50114004: 二维码已过期
  if (retcode === 20000000) {
    const alt = str(result.data?.url);
    console.log(`[Weibo DEBUG] 登录成功! alt URL: ${alt}`);
    const cookieStr = await initCookieFromAlt(alt);
    console.log(`[Weibo DEBUG] Cookie初始化成功, Cookie长度: ${cookieStr.length}`);
    return { status: 'success', cookie: cookieStr, message: '' };
  }
  if (retcode === 50114002) return { status: 'waiting', cookie: '', message: '已扫描，请在手机上确认' };
  if (retcode === 50114004) return { status: 'expired', cookie: '', message: '二维码已过期' };
  return { status: 'waiting', cookie: '', message: '等待扫码中' };
}

/** 访问 PC + 移动端首页刷新短期令牌（XSRF-TOKEN 等），合并响应 Set-Cookie */
async function refreshCookie(cookieStr: string): Promise<string> {
  const cookieMap = new Map<string, string>();
  for (const item of cookieStr.split('; ')) {
    const idx = item.indexOf('=');
    if (idx > 0) cookieMap.set(item.slice(0, idx), item.slice(idx + 1));
  }

  const mergeFrom = (resp: Response): void => {
    for (const header of resp.headers.getSetCookie()) {
      const pair = header.split(';')[0];
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const value = pair.slice(eq + 1);
      if (value !== '') cookieMap.set(pair.slice(0, eq), value);
    }
  };

  try {
    const respPC = await fetchResp('https://weibo.com/', {
      timeoutMs: 10_000,
      headers: { 'User-Agent': MAC_UA, Cookie: cookieStr },
    });
    mergeFrom(respPC);

    const respMobile = await fetchResp('https://m.weibo.cn/', {
      timeoutMs: 10_000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15',
        Cookie: cookieStr,
      },
    });
    mergeFrom(respMobile);
  } catch {
    return cookieStr; // 任一步失败返回原 Cookie
  }

  return [...cookieMap.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

// ---- 链接提取（Go extractNetworkDriveLinks/cleanHTML/extractURLsFromComment）----

const DRIVE_LINK_PATTERNS: Array<[string, RegExp]> = [
  ['baidu', /https?:\/\/pan\.baidu\.com\/s\/[a-zA-Z0-9_-]+(?:\?pwd=[a-zA-Z0-9]+)?/g],
  ['quark', /https?:\/\/pan\.quark\.cn\/s\/[a-zA-Z0-9]+(?:\?pwd=[a-zA-Z0-9]+)?/g],
  [
    'aliyun',
    /https?:\/\/www\.alip?a?n\.com\/s\/[a-zA-Z0-9]+(?:\?[^\s]*)?|https?:\/\/www\.aliyundrive\.com\/s\/[a-zA-Z0-9]+(?:\?[^\s]*)?/g,
  ],
  ['115', /https?:\/\/115\.com\/s\/[a-zA-Z0-9]+(?:\?[^\s]*)?/g],
  ['tianyi', /https?:\/\/cloud\.189\.cn\/(?:t\/|web\/share\?code=)[a-zA-Z0-9]+(?:&?[^\s]*)?/g],
  ['xunlei', /https?:\/\/pan\.xunlei\.com\/s\/[a-zA-Z0-9_-]+(?:\?[^\s]*)?/g],
  ['123', /https?:\/\/www\.123pan\.com\/s\/[a-zA-Z0-9_-]+(?:\?[^\s]*)?/g],
  ['pikpak', /https?:\/\/mypikpak\.com\/s\/[a-zA-Z0-9]+(?:\?[^\s]*)?/g],
];

const PWD_PATTERNS = [
  /(?:密码|提取码|访问码|pwd|code)[:：\s]*([a-zA-Z0-9]{4})/,
  /pwd=([a-zA-Z0-9]{4})/,
];

function extractNetworkDriveLinks(text: string, datetime: string): Link[] {
  const links: Link[] = [];
  const seenURLs = new Set<string>();

  for (const [linkType, pattern] of DRIVE_LINK_PATTERNS) {
    for (const match of text.match(pattern) ?? []) {
      if (seenURLs.has(match)) continue;
      seenURLs.add(match);

      let password = '';
      const start = text.indexOf(match);
      if (start !== -1) {
        const contextStart = Math.max(0, start - 50);
        const contextEnd = Math.min(text.length, start + match.length + 50);
        const context = text.slice(contextStart, contextEnd);
        for (const pwdPattern of PWD_PATTERNS) {
          const pwdMatch = context.match(pwdPattern);
          if (pwdMatch && pwdMatch[1]) {
            password = pwdMatch[1];
            break;
          }
        }
      }

      links.push({ type: linkType, url: match, password, datetime });
    }
  }

  return links;
}

function cleanHTML(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/** 评论里的短链 https://weibo.cn/sinaurl?u=... → 解码出真实 URL */
function extractURLsFromComment(htmlText: string): string[] {
  if (htmlText === '') return [];
  const urls: string[] = [];
  const pattern = /https:\/\/weibo\.cn\/sinaurl\?u=([^"&\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(htmlText)) !== null) {
    try {
      urls.push(decodeURIComponent(match[1]));
    } catch {
      /* 解码失败跳过 */
    }
  }
  return urls;
}

/** 抓取页面内容并提取网盘链接（评论短链跳板页） */
async function fetchPageAndExtractLinks(pageURL: string, datetime: string): Promise<Link[]> {
  try {
    const resp = await fetchResp(pageURL, {
      timeoutMs: 15_000,
      headers: {
        'User-Agent': MAC_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (resp.status !== 200) return [];
    const htmlContent = await resp.text();
    return extractNetworkDriveLinks(htmlContent, datetime);
  } catch {
    return [];
  }
}

// ---- 搜索链路（Go parseWeibo/getComments/searchUserWeibo/buildUserTasks/executeTasks）----

/** 解析微博时间 "Mon Jan 02 15:04:05 -0700 2006" */
function parseWeiboTime(value: string): string {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const m = value.match(/^([A-Za-z]{3})\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+([+-]\d{4})\s+(\d{4})$/);
  if (!m) return nowISO();
  const month = MONTHS.indexOf(m[2]);
  if (month < 0) return nowISO();
  const tz = m[7];
  const d = new Date(`${m[8]}-${String(month + 1).padStart(2, '0')}-${m[3].padStart(2, '0')}T${m[4]}:${m[5]}:${m[6]}${tz.slice(0, 3)}:${tz.slice(3)}`);
  return Number.isNaN(d.getTime()) ? nowISO() : d.toISOString();
}

interface ParsedWeibo {
  result: SearchResult;
  weiboID: string;
}

async function parseWeibo(weibo: Record<string, unknown>, uid: string): Promise<ParsedWeibo> {
  // 优先 text_raw，其次 text
  let textRaw = str(weibo['text_raw']);
  if (textRaw === '') textRaw = str(weibo['text']);

  // 发布时间
  const createdAt = str(weibo['created_at']);
  const publishTime = createdAt !== '' ? parseWeiboTime(createdAt) : nowISO();

  const text = cleanHTML(textRaw);

  // 1. 直接从文本中提取网盘链接
  let links = extractNetworkDriveLinks(text, publishTime);

  // 2. url_struct 字段（微博 API 已解码的外部长链接）
  const urlStruct = weibo['url_struct'];
  if (Array.isArray(urlStruct) && urlStruct.length > 0) {
    for (const urlItem of urlStruct) {
      if (typeof urlItem !== 'object' || urlItem === null) continue;
      const item = urlItem as Record<string, unknown>;
      if (item['url_title'] !== '网页链接') continue;
      const longURL = str(item['long_url']);
      if (longURL === '') continue;

      const directLinks = extractNetworkDriveLinks(longURL, publishTime);
      if (directLinks.length > 0) {
        links = links.concat(directLinks);
      } else {
        const pageLinks = await fetchPageAndExtractLinks(longURL, publishTime);
        if (pageLinks.length > 0) links = links.concat(pageLinks);
      }
    }
  }

  let title = text;
  if (text.length > 100) title = text.slice(0, 100) + '...';

  // 微博 ID，支持 idstr / id(string) / id(number)
  let id = '';
  if (typeof weibo['idstr'] === 'string') id = weibo['idstr'];
  else if (typeof weibo['id'] === 'string') id = weibo['id'];
  else if (typeof weibo['id'] === 'number') id = String(weibo['id']);
  else id = String(weibo['id']);

  const result: SearchResult = {
    message_id: '',
    unique_id: `weibo-${uid}-${id}`,
    channel: '', // 插件结果 Channel 必须为空
    datetime: publishTime,
    title,
    content: text,
    links,
  };
  return { result, weiboID: id };
}

async function getComments(weiboID: string, cookie: string, maxComments: number): Promise<Comment[]> {
  const comments: Comment[] = [];
  let maxID = 0;
  let maxIDType = 0;

  while (comments.length < maxComments) {
    const params = new URLSearchParams({
      id: weiboID,
      mid: weiboID,
      max_id: String(maxID),
      max_id_type: String(maxIDType),
    });
    const apiURL = `https://m.weibo.cn/comments/hotflow?${params.toString()}`;

    let apiResp: Record<string, unknown>;
    try {
      const resp = await fetchResp(apiURL, {
        timeoutMs: SEARCH_TIMEOUT,
        headers: {
          'User-Agent': IPHONE_UA,
          Referer: 'https://m.weibo.cn/',
          Accept: 'application/json, text/plain, */*',
          Cookie: cookie,
        },
      });
      if (resp.status !== 200) break;
      apiResp = JSON.parse(await resp.text()) as Record<string, unknown>;
    } catch {
      break;
    }

    const data = asRecord(apiResp['data']);
    if (data === null) break;

    const commentList = data['data'];
    if (!Array.isArray(commentList) || commentList.length === 0) break;

    for (const item of commentList) {
      const commentMap = asRecord(item);
      if (commentMap === null) continue;
      const rawText = str(commentMap['text']);
      comments.push({ text: cleanHTML(rawText), urls: extractURLsFromComment(rawText) });
      if (comments.length >= maxComments) break;
    }

    const newMaxID = typeof data['max_id'] === 'number' ? data['max_id'] : 0;
    if (newMaxID === 0 || newMaxID === maxID) break;
    maxID = newMaxID;
    if (typeof data['max_id_type'] === 'number') maxIDType = data['max_id_type'];

    await sleep(500);
  }

  return comments;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

async function searchUserWeibo(uid: string, cookie: string, keyword: string): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const maxPages = 3;

  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams({ uid, feature: '0', q: keyword, page: String(page) });
    const apiURL = `https://weibo.com/ajax/profile/searchblog?${params.toString()}`;

    let apiResp: Record<string, unknown>;
    try {
      const resp = await fetchResp(apiURL, {
        timeoutMs: SEARCH_TIMEOUT,
        headers: {
          'User-Agent': PC_UA,
          Referer: 'https://weibo.com/',
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          Cookie: cookie,
        },
      });
      if (resp.status !== 200) return results;
      apiResp = JSON.parse(await resp.text()) as Record<string, unknown>;
    } catch {
      return results;
    }

    // ok 字段支持多种类型（1 / true / 字符串形式）
    const okValue = apiResp['ok'];
    const okStr = okValue === null || okValue === undefined ? '' : String(okValue);
    const isOK = okStr === '1' || okStr === 'true';
    if (!isOK) break;

    const data = asRecord(apiResp['data']);
    if (data === null) break;
    const list = data['list'];
    if (!Array.isArray(list) || list.length === 0) break;

    // 并发处理每条微博（解析 + 正文无链接时抓评论）
    const pageResults = await Promise.all(
      list.map(async (item): Promise<SearchResult | null> => {
        const weiboData = asRecord(item);
        if (weiboData === null) return null;
        const { result, weiboID } = await parseWeibo(weiboData, uid);

        // 正文没有网盘链接时才获取评论
        if (result.links.length === 0 && weiboID !== '') {
          const comments = await getComments(weiboID, cookie, MaxComments);
          for (const comment of comments) {
            // 1. 从评论文本直接提取网盘链接
            const commentLinks = extractNetworkDriveLinks(comment.text, result.datetime);
            // 2. 从评论中的 URL（已解码的 sinaurl）提取，或抓取跳板页面
            for (const decodedURL of comment.urls) {
              const directLinks = extractNetworkDriveLinks(decodedURL, result.datetime);
              if (directLinks.length > 0) {
                commentLinks.push(...directLinks);
              } else {
                const pageLinks = await fetchPageAndExtractLinks(decodedURL, result.datetime);
                commentLinks.push(...pageLinks);
              }
            }
            result.links.push(...commentLinks);
          }
        }

        return result.links.length > 0 ? result : null;
      }),
    );
    for (const r of pageResults) {
      if (r !== null) results.push(r);
    }

    await sleep(1000);
  }

  return results;
}

/** 同一 UID 被多个账号配置时，挑当前任务量最少的账号承载；每小时刷新一次短期令牌 */
async function buildUserTasks(list: User[]): Promise<UserTask[]> {
  const userOwners = new Map<string, User[]>();
  for (const user of list) {
    for (const uid of user.user_ids) {
      const owners = userOwners.get(uid) ?? [];
      owners.push(user);
      userOwners.set(uid, owners);
    }
  }

  const tasks: UserTask[] = [];
  const userTaskCount = new Map<string, number>();

  for (const [uid, owners] of userOwners) {
    let selectedUser = owners[0];
    let minTasks = userTaskCount.get(selectedUser.hash) ?? 0;

    for (const owner of owners) {
      const count = userTaskCount.get(owner.hash) ?? 0;
      if (count < minTasks) {
        selectedUser = owner;
        minTasks = count;
      }
    }

    // Cookie 使用超过 1 小时则刷新短期令牌
    let cookie = selectedUser.cookie;
    if (Date.now() - timeOf(selectedUser.last_refresh) > 60 * 60 * 1000) {
      const refreshedCookie = await refreshCookie(cookie);
      if (refreshedCookie !== cookie) {
        selectedUser.cookie = refreshedCookie;
        selectedUser.last_refresh = nowISO();
        try {
          saveUser(selectedUser);
        } catch {
          /* Go 此处忽略持久化错误 */
        }
        cookie = refreshedCookie;
      }
    }

    tasks.push({ userID: uid, cookie });
    userTaskCount.set(selectedUser.hash, (userTaskCount.get(selectedUser.hash) ?? 0) + 1);
  }

  return tasks;
}

async function executeTasks(tasks: UserTask[], keyword: string): Promise<SearchResult[]> {
  const limit = createLimiter(MaxConcurrentWeibo);
  const batches = await Promise.all(tasks.map((t) => limit(() => searchUserWeibo(t.userID, t.cookie, keyword))));
  return batches.flat();
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
    res.end(HTMLTemplate.replaceAll('HASH_PLACEHOLDER', param));
  } else {
    res.writeHead(302, { Location: `/weibo/${generateHash(param)}` });
    res.end();
  }
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

  const action = str(reqData['action']);
  if (action === '') {
    respondError(res, '缺少action字段');
    return;
  }

  switch (action) {
    case 'get_status':
      await handleGetStatus(res, hash);
      return;
    case 'refresh_qrcode':
      await handleRefreshQRCode(res, hash);
      return;
    case 'logout':
      await handleLogout(res, hash);
      return;
    case 'set_user_ids':
      await handleSetUserIDs(res, hash, reqData);
      return;
    case 'test_search':
      await handleTestSearch(res, hash, reqData);
      return;
    case 'check_login':
      await handleCheckLogin(res, hash);
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
      cookie: '',
      status: 'pending',
      user_ids: [],
      created_at: nowISO(),
      login_at: '',
      expire_at: '',
      last_access_at: nowISO(),
      last_refresh: '',
    };
    saveUser(user);
  } else {
    user.last_access_at = nowISO();
    saveUser(user);
  }

  const loggedIn = user.status === 'active' && user.cookie !== '';
  console.log(`[Weibo DEBUG] handleGetStatus - hash: ${hash}, Status: ${user.status}, Cookie长度: ${user.cookie.length}, loggedIn: ${loggedIn}`);

  let qrcodeBase64 = '';
  if (!loggedIn) {
    const cached = qrState.get(hash);
    if (cached !== undefined && Date.now() - cached.time < 30_000) {
      qrcodeBase64 = `data:image/png;base64,${cached.pngBase64}`;
    } else {
      try {
        const { pngBase64, qrid } = await generateQRCodeWithSig();
        qrcodeBase64 = `data:image/png;base64,${pngBase64}`;
        qrState.set(hash, { pngBase64, qrid, time: Date.now() });
      } catch {
        /* 生成失败不阻塞状态返回（Go 同样只在 err==nil 时缓存） */
      }
    }
  }

  let expiresInDays = 0;
  if (user.expire_at !== '') {
    expiresInDays = Math.floor((timeOf(user.expire_at) - Date.now()) / (24 * 60 * 60 * 1000));
    if (expiresInDays < 0) expiresInDays = 0;
  }

  respondSuccess(res, '获取成功', {
    hash,
    logged_in: loggedIn,
    status: user.status,
    login_time: formatTime(user.login_at),
    expire_time: formatTime(user.expire_at),
    expires_in_days: expiresInDays,
    user_ids: user.user_ids,
    qrcode_base64: qrcodeBase64,
  });
}

async function handleRefreshQRCode(res: ServerResponse, hash: string): Promise<void> {
  if (getUserByHash(hash) === undefined) {
    respondError(res, '用户不存在');
    return;
  }

  let generated: { pngBase64: string; qrid: string };
  try {
    generated = await generateQRCodeWithSig();
  } catch (err) {
    respondError(res, `生成二维码失败: ${err instanceof Error ? err.message : err}`);
    return;
  }

  qrState.set(hash, { pngBase64: generated.pngBase64, qrid: generated.qrid, time: Date.now() });

  respondSuccess(res, '二维码已刷新', {
    qrcode_base64: `data:image/png;base64,${generated.pngBase64}`,
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

  try {
    saveUser(user);
  } catch {
    respondError(res, '退出失败');
    return;
  }

  respondSuccess(res, '已退出登录', { status: 'pending' });
}

async function handleCheckLogin(res: ServerResponse, hash: string): Promise<void> {
  const user = getUserByHash(hash);
  if (user === undefined) {
    respondError(res, '用户不存在');
    return;
  }

  const cached = qrState.get(hash);
  const qrsig = cached?.qrid ?? '';
  if (qrsig === '') {
    respondError(res, '请先刷新二维码');
    return;
  }

  let loginResult: LoginResult;
  try {
    loginResult = await checkQRLoginStatus(qrsig);
  } catch (err) {
    console.error(`[Weibo] checkQRLoginStatus错误: ${err instanceof Error ? err.message : err}`);
    respondError(res, err instanceof Error ? err.message : String(err));
    return;
  }

  console.log(`[Weibo] checkQRLoginStatus返回状态: ${loginResult.status}, Cookie长度: ${loginResult.cookie.length}`);

  if (loginResult.status === 'success') {
    user.cookie = loginResult.cookie;
    user.status = 'active';
    user.login_at = nowISO();
    user.expire_at = plusDaysISO(30);
    qrState.delete(hash);

    users.set(hash, user);
    try {
      saveUser(user);
    } catch (err) {
      console.error(`[Weibo DEBUG] 持久化失败: ${err instanceof Error ? err.message : err}`);
      respondError(res, `保存失败: ${err instanceof Error ? err.message : err}`);
      return;
    }

    respondSuccess(res, '登录成功', { login_status: 'success' });
  } else if (loginResult.status === 'waiting') {
    respondSuccess(res, '等待扫码', { login_status: 'waiting' });
  } else if (loginResult.status === 'expired') {
    respondError(res, '二维码已失效，请刷新');
  } else {
    respondSuccess(res, '等待扫码', { login_status: 'waiting' });
  }
}

async function handleSetUserIDs(res: ServerResponse, hash: string, reqData: Record<string, unknown>): Promise<void> {
  if (!('user_ids' in reqData)) {
    respondError(res, '缺少user_ids字段');
    return;
  }

  const userIDs: string[] = [];
  if (Array.isArray(reqData['user_ids'])) {
    for (const uid of reqData['user_ids']) {
      if (typeof uid === 'string') userIDs.push(uid);
    }
  }

  const user = getUserByHash(hash);
  if (user === undefined) {
    respondError(res, '用户不存在');
    return;
  }

  const normalizedUserIDs: string[] = [];
  const seen = new Set<string>();
  for (const uid of userIDs) {
    const trimmed = uid.trim();
    if (trimmed === '') continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalizedUserIDs.push(trimmed);
  }

  user.user_ids = normalizedUserIDs;
  user.last_access_at = nowISO();

  try {
    saveUser(user);
  } catch (err) {
    respondError(res, `保存失败: ${err instanceof Error ? err.message : err}`);
    return;
  }

  respondSuccess(res, '用户列表已更新', {
    user_ids: normalizedUserIDs,
    user_count: normalizedUserIDs.length,
  });
}

async function handleTestSearch(res: ServerResponse, hash: string, reqData: Record<string, unknown>): Promise<void> {
  const keyword = str(reqData['keyword']);
  if (keyword === '') {
    respondError(res, '缺少keyword字段');
    return;
  }

  const user = getUserByHash(hash);
  if (user === undefined || user.cookie === '') {
    respondError(res, '请先登录');
    return;
  }

  if (user.user_ids.length === 0) {
    respondError(res, '请先配置微博用户ID');
    return;
  }

  const tasks: UserTask[] = user.user_ids.map((uid) => ({ userID: uid, cookie: user.cookie }));
  const allResults = await executeTasks(tasks, keyword);

  const maxResults = 10;
  const capped = allResults.slice(0, maxResults);

  const results = capped.map((r) => ({
    unique_id: r.unique_id,
    title: r.title,
    links: r.links.map((link) => ({ type: link.type, url: link.url, password: link.password })),
  }));

  respondSuccess(res, `找到 ${results.length} 条结果`, {
    keyword,
    total_results: results.length,
    results,
  });
}

// ---- 插件注册（Go init() + RegisterGlobalPlugin + RegisterWebRoutes）----

console.log('[Weibo] Web路由已注册: /weibo/:param');

export const weibo = definePlugin({
  name: 'weibo',
  priority: 3, // Go NewBaseAsyncPlugin("weibo", 3)
  skipServiceFilter: true, // 微博 API 已按关键词过滤（q 参数），跳过 Service 层过滤
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    ensureInit();
    const active = getActiveUsers();
    if (active.length === 0) return [];

    let list = active;
    if (list.length > MaxConcurrentUsers) {
      list.sort((a, b) => timeOf(b.last_access_at) - timeOf(a.last_access_at));
      list = list.slice(0, MaxConcurrentUsers);
    }

    const tasks = await buildUserTasks(list);
    return executeTasks(tasks, keyword);
  },
  webRoutes: [
    { method: 'GET', path: '/weibo/:param', handler: handleManagePage },
    { method: 'POST', path: '/weibo/:param', handler: handleManagePagePOST },
  ],
});
