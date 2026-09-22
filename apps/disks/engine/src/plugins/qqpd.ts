// QQ 频道搜索插件（qqpd）—— Go pansou/plugin/qqpd 的代码级 TS 移植
// 账号型插件：用户经 Web 管理页扫码登录 QQ 频道（pd.qq.com），插件用其 Cookie
// 在各用户配置的频道内调用频道内搜索接口，提取网盘链接。
// 除搜索外注册 Web 路由 /qqpd/:param（GET 管理页 / POST 动作），业务逻辑与 Go 版逐条对齐。
//
// 与 Go 版的差异（刻意取舍，均在下文注明）：
// - Go 用 net/http + InsecureSkipVerify；这里用 Node 全局 fetch（正常校验证书，
//   pd.qq.com / ptlogin2.qq.com 证书均有效，无降级影响）。Go 未显式设置 UA 的请求
//   （二维码/登录轮询/check_sig/guild 页）原本发送 Go-http-client/1.1，这里统一用 Chrome UA
// - 3xx 改为手动逐跳跟随并沿途累积收集 Set-Cookie（Go 无 Cookie Jar 只拿最终响应，
//   这里是超集：还原 Python 参考实现的 Session 语义，ptlogin 登录链路依赖中间跳转的 Cookie）
// - Go 的 encryptCookie/decryptCookie（AES-GCM）在 qqpd.go 中是死代码（无任何调用点），未移植
// - Go 的 http.Transport 连接池参数仅为 InsecureSkipVerify 一项，随 fetch 一并移除
// - bkn/ptqrtoken 的 hash33：Go 用 int64 累加后 & 0x7fffffff，低 31 位不受高位回绕影响，
//   故 JS 里逐步对 2^31 取模与 Go 结果完全等价（JS 位运算仅 32 位，不能用 <<）
// - 24h 清理任务保留（setInterval + unref，替代 Go 的 time.Ticker 协程）

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { config } from '../config.ts';
import { createLimiter } from '../http.ts';
import type { Link, SearchResult } from '../types.ts';
import { definePlugin } from './shared.ts';

// 插件配置参数（与 Go 一致）
const MAX_CONCURRENT_USERS = 10; // 最多使用的用户数
const MAX_CONCURRENT_CHANNELS = 50; // 最大并发频道数

// 存储目录：CACHE_PATH/qqpd_users（Go StorageDir）
const STORAGE_DIR = join(config.cachePath, 'qqpd_users');

const HTML_TEMPLATE = String.raw`<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PanSou QQ频道搜索配置</title>
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
        .api-code {
            background: #2d3748;
            color: #68d391;
            padding: 10px;
            border-radius: 6px;
            font-family: 'Courier New', monospace;
            font-size: 12px;
            overflow-x: auto;
            margin: 10px 0;
            white-space: pre-wrap;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔍 PanSou QQ频道搜索</h1>
            <p>配置你的专属搜索服务</p>
            <p style="font-size: 12px; margin-top: 10px; opacity: 0.8;">
                🔗 当前地址: <span id="current-url">HASH_PLACEHOLDER</span>
            </p>
        </div>

        <div class="section" id="login-section">
            <div class="section-title">📱 登录状态</div>
            
            <div id="logged-in-view" class="hidden">
                <div style="text-align: center; padding: 20px;">
                    <div style="width: 100px; height: 100px; margin: 0 auto 15px; border-radius: 50%; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); display: flex; align-items: center; justify-content: center; color: white; font-size: 36px; font-weight: bold;">
                        <span id="qq-avatar">QQ</span>
                    </div>
                </div>
                <div class="status-box">
                    <div class="status-item">
                        <span>状态</span>
                        <span><strong style="color: #48bb78;">✅ 已登录</strong></span>
                    </div>
                    <div class="status-item">
                        <span>QQ号</span>
                        <span id="qq-masked">-</span>
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
                        请使用手机QQ扫描二维码登录
                    </p>
                    <p style="font-size: 12px; color: #999;">扫码后自动检测登录状态</p>
                    <button class="btn btn-secondary" onclick="refreshQRCode()" style="margin-top: 10px;">
                        刷新二维码
                    </button>
                </div>
            </div>
        </div>

        <div class="section" id="channels-section">
            <div class="section-title">📋 频道管理 (<span id="channel-count">0</span> 个)</div>
            
            <div id="alert-box"></div>
            
            <p style="margin-bottom: 10px; color: #666;">每行一个频道号或链接，保存时自动去重</p>
            <textarea id="channels-textarea" rows="10" placeholder="pd97631607
kuake12345
languan8K115"></textarea>
            
            <button class="btn btn-primary" onclick="saveChannels()" style="margin-top: 10px;">保存频道配置</button>
        </div>

        <div class="section" id="test-section">
            <div class="section-title">🔍 测试搜索(限制返回10条数据)</div>
            
            <div style="display: flex; gap: 10px;">
                <input type="text" id="search-keyword" placeholder="输入关键词测试搜索" style="flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 6px;">
                <button class="btn btn-primary" onclick="testSearch()">搜索</button>
            </div>

            <div id="search-results" class="test-results hidden"></div>
        </div>

        <div class="section">
            <div class="section-title">📖 API调用说明</div>
            
            <p style="margin-bottom: 15px;">你可以通过API程序化管理频道和搜索：</p>

            <details>
                <summary style="cursor: pointer; padding: 10px 0; font-weight: bold;">获取状态</summary>
                <div class="api-code">curl -X POST https://your-domain.com/qqpd/HASH_PLACEHOLDER \
  -H "Content-Type: application/json" \
  -d '{"action": "get_status"}'</div>
            </details>

            <details>
                <summary style="cursor: pointer; padding: 10px 0; font-weight: bold;">设置频道列表</summary>
                <div class="api-code">curl -X POST https://your-domain.com/qqpd/HASH_PLACEHOLDER \
  -H "Content-Type: application/json" \
  -d '{"action": "set_channels", "channels": ["pd97631607", "kuake12345"]}'</div>
            </details>

            <details>
                <summary style="cursor: pointer; padding: 10px 0; font-weight: bold;">测试搜索</summary>
                <div class="api-code">curl -X POST https://your-domain.com/qqpd/HASH_PLACEHOLDER \
  -H "Content-Type: application/json" \
  -d '{"action": "test_search", "keyword": "遮天"}'</div>
            </details>
        </div>
    </div>

    <script>
        const HASH = 'HASH_PLACEHOLDER';
        const API_URL = '/qqpd/' + HASH;
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
            if (loginCheckInterval) return; // 避免重复启动
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
                    // 已登录：显示用户信息，隐藏二维码
                    document.getElementById('logged-in-view').classList.remove('hidden');
                    document.getElementById('not-logged-in-view').classList.add('hidden');
                    
                    // 更新用户信息
                    const qqMasked = data.qq_masked || 'QQ';
                    document.getElementById('qq-masked').textContent = qqMasked;
                    document.getElementById('login-time').textContent = data.login_time || '-';
                    document.getElementById('expire-info').textContent = '剩余 ' + (data.expires_in_days || 0) + ' 天';
                    
                    // 显示QQ号首位作为头像
                    const firstChar = qqMasked.charAt(0) || 'Q';
                    document.getElementById('qq-avatar').textContent = firstChar;
                    
                    // 停止登录检测
                    stopLoginPolling();
                } else {
                    // 未登录：显示二维码，隐藏用户信息
                    document.getElementById('logged-in-view').classList.add('hidden');
                    document.getElementById('not-logged-in-view').classList.remove('hidden');
                    
                    if (data.qrcode_base64) {
                        document.getElementById('qrcode-img').src = data.qrcode_base64;
                    }
                    
                    // 启动登录检测（每2秒检查一次）
                    startLoginPolling();
                }

                updateChannelList(data.channels || []);
            }
        }

        async function checkLogin() {
            const result = await postAction('check_login');
            if (result.success && result.data) {
                if (result.data.login_status === 'success') {
                    // 登录成功，停止轮询并刷新状态
                    stopLoginPolling();
                    showAlert('登录成功！');
                    updateStatus();
                }
            }
        }

        function updateChannelList(channels) {
            const textarea = document.getElementById('channels-textarea');
            const count = document.getElementById('channel-count');
            
            count.textContent = channels.length;
            
            // 只在用户没有聚焦输入框时更新内容
            if (document.activeElement !== textarea) {
                textarea.value = channels.join('\n');
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
                // 启动登录检测
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

        async function saveChannels() {
            const textarea = document.getElementById('channels-textarea');
            const channelsText = textarea.value.trim();
            
            const channels = channelsText
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0);
            
            const result = await postAction('set_channels', { channels });
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

// ============ 数据结构（Go User / ChannelTask / LoginResult） ============

/** 用户数据（与 Go User 的持久化 JSON 字段一一对应；时间为 ISO 字符串，'' 即 Go 零值时间） */
interface User {
  hash: string;
  qq_masked: string;
  cookie: string;
  status: string;
  channels: string[];
  channel_guild_ids: Record<string, string>; // 频道号 -> guild_id（持久化缓存）
  created_at: string;
  login_at: string;
  expire_at: string;
  last_access_at: string;
}

/** 二维码会话（Go 挂在 User 上且 json:"-" 不持久化，这里独立存放） */
interface QRState {
  qrCodeCache: Buffer;
  qrCodeCacheTime: number; // epoch ms
  qrsig: string; // 用于登录检测
}

/** 频道搜索任务（Go ChannelTask） */
interface ChannelTask {
  channelId: string; // 频道号
  guildId: string; // 真实 guild_id（缓存或实时获取）
  userHash: string; // 分配给哪个用户
  cookie: string; // 使用的 Cookie
}

/** 登录检测结果（Go LoginResult） */
interface LoginResult {
  status: 'success' | 'waiting' | 'expired';
  cookie: string;
  qqMasked: string;
}

// ============ 内存缓存与持久化（Go sync.Map + <hash>.json 文件） ============

const users = new Map<string, User>();
const qrStates = new Map<string, QRState>();

let initPromise: Promise<void> | null = null;

/** 延迟初始化（Go Initialize）：建目录、加载全部用户、启动定期清理 */
function ensureInit(): Promise<void> {
  initPromise ??= (async () => {
    await mkdir(STORAGE_DIR, { recursive: true });
    await loadAllUsers();
    startCleanupTask();
  })();
  return initPromise;
}

/** 启动时加载所有用户到内存（Go loadAllUsers） */
async function loadAllUsers(): Promise<void> {
  let files: string[];
  try {
    files = await readdir(STORAGE_DIR);
  } catch {
    return;
  }
  let count = 0;
  for (const name of files) {
    if (name.endsWith('.json') === false) continue;
    try {
      const user = JSON.parse(await readFile(join(STORAGE_DIR, name), 'utf8')) as User;
      if (typeof user.hash === 'string' && user.hash !== '') {
        users.set(user.hash, user);
        count++;
      }
    } catch {
      continue; // 损坏文件跳过
    }
  }
  console.log(`[QQPD] 已加载 ${count} 个用户到内存`);
}

/** 获取用户（从内存） */
function getUserByHash(hash: string): User | undefined {
  return users.get(hash);
}

/** 保存用户（内存+文件） */
async function saveUser(user: User): Promise<void> {
  users.set(user.hash, user);
  await persistUser(user);
}

/** 持久化用户到文件（Go persistUser：MarshalIndent 两空格缩进；二维码状态不落盘） */
async function persistUser(user: User): Promise<void> {
  const data = {
    hash: user.hash,
    qq_masked: user.qq_masked,
    cookie: user.cookie,
    status: user.status,
    channels: user.channels,
    channel_guild_ids: user.channel_guild_ids,
    created_at: user.created_at,
    login_at: user.login_at,
    expire_at: user.expire_at,
    last_access_at: user.last_access_at,
  };
  await writeFile(join(STORAGE_DIR, `${user.hash}.json`), JSON.stringify(data, null, 2));
}

/** 删除用户（内存+文件） */
async function deleteUser(hash: string): Promise<void> {
  users.delete(hash);
  qrStates.delete(hash);
  await rm(join(STORAGE_DIR, `${hash}.json`), { force: true });
}

/** 获取有效的活跃用户（Go getActiveUsers：状态/过期/无频道三重过滤，过期就地落盘标记） */
async function getActiveUsers(): Promise<User[]> {
  const result: User[] = [];
  const now = Date.now();
  const expiredSaves: Promise<void>[] = [];
  for (const user of users.values()) {
    if (user.status !== 'active') continue;
    // 检查 Cookie 是否过期（根据 ExpireAt 时间判断）
    if (user.expire_at !== '' && now > Date.parse(user.expire_at)) {
      user.status = 'expired';
      user.cookie = ''; // 清空 Cookie
      expiredSaves.push(saveUser(user));
      continue;
    }
    if (user.channels.length === 0) continue;
    result.push(user);
  }
  await Promise.all(expiredSaves);
  return result;
}

// ============ HTTP 层（Go net/http → 全局 fetch + Chrome UA + 超时） ============

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

interface RawResp {
  status: number;
  setCookies: string[]; // 所有 3xx 跳转沿途收集的 Set-Cookie 原始头
  body: Buffer;
}

/** 提取 Response 的全部 Set-Cookie 头 */
function getSetCookie(resp: Response): string[] {
  const headers = resp.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const joined = resp.headers.get('set-cookie');
  return joined !== null ? [joined] : [];
}

/**
 * 抓取并手动逐跳跟随 3xx，沿途累积收集 Set-Cookie（替代 Go 的 cloudscraper/裸 http.Client）。
 * Go 无 Cookie Jar 时只保留最终响应的 Set-Cookie；这里是超集实现，
 * 还原 Python 参考实现的 Session 语义（ptlogin 登录链路依赖中间跳转下发的 Cookie）。
 */
async function rawFetch(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {},
): Promise<RawResp> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  const setCookies: string[] = [];
  let current = url;
  try {
    for (let hop = 0; hop < 10; hop++) {
      const resp = await fetch(current, {
        method: opts.method ?? 'GET',
        headers: opts.headers,
        // 与 Go http.Client 语义一致：302/303 之后的跳转按 GET，不再携带 body
        body: hop === 0 ? opts.body : undefined,
        redirect: 'manual',
        signal: controller.signal,
      });
      setCookies.push(...getSetCookie(resp));
      const location = resp.headers.get('location');
      if ([301, 302, 303, 307, 308].includes(resp.status) && location !== null) {
        current = new URL(location, current).toString();
        await resp.body?.cancel();
        continue;
      }
      const body = Buffer.from(await resp.arrayBuffer());
      return { status: resp.status, setCookies, body };
    }
    throw new Error('too many redirects');
  } finally {
    clearTimeout(timer);
  }
}

// ============ Cookie 工具（Go parseCookieString / parseSetCookieHeader / extractQrsig） ============

const COOKIE_ATTRS = new Set(['Domain', 'Path', 'Expires', 'Max-Age', 'SameSite', 'Secure', 'HttpOnly']);

/** 解析 Cookie 字符串为 map */
function parseCookieString(cookieStr: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (cookieStr === '') return cookies;
  for (const pair of cookieStr.split(';')) {
    const trimmed = pair.trim();
    if (trimmed === '') continue;
    const idx = trimmed.indexOf('=');
    if (idx > 0) {
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      // 跳过 cookie 属性（只保留真正的 cookie 名称）
      if (key !== '' && value !== '' && !COOKIE_ATTRS.has(key)) cookies[key] = value;
    }
  }
  return cookies;
}

/** 从 Set-Cookie 响应头解析 cookie（只提取名称和值，忽略属性段） */
function parseSetCookieHeader(setCookie: string): [name: string, value: string] {
  const nameValue = (setCookie.split(';')[0] ?? '').trim();
  const idx = nameValue.indexOf('=');
  if (idx <= 0) return ['', ''];
  const key = nameValue.slice(0, idx).trim();
  const value = nameValue.slice(idx + 1).trim();
  if (key === '' || value === '' || COOKIE_ATTRS.has(key)) return ['', ''];
  return [key, value];
}

/** 从 Set-Cookie 中提取 qrsig（Go 只查首个头，这里查全部，超集） */
function extractQrsig(setCookies: string[]): string {
  for (const setCookie of setCookies) {
    for (const part of setCookie.split(';')) {
      const cookie = part.trim();
      if (cookie.startsWith('qrsig=')) return cookie.slice('qrsig='.length);
    }
  }
  return '';
}

// ============ QQ 签名计算（Go bkn / getptqrtoken：hash33） ============
// Go 用 int64 累加 e = e*33 + c 后 & 0x7fffffff；低 31 位不受 int64 高位回绕影响，
// 逐步对 2^31 取模与 Go 结果完全等价（JS 位运算只有 32 位，不能用 <<）。

/** ptqrtoken（qrsig → 扫码登录轮询签名，初始值 0） */
function getptqrtoken(qrsig: string): string {
  let e = 0;
  for (let i = 0; i < qrsig.length; i++) e = (e * 33 + qrsig.charCodeAt(i)) % 0x80000000;
  return String(e);
}

/** bkn（p_skey → 搜索接口签名，初始值 5381） */
function bkn(skey: string): number {
  let t = 5381;
  for (let i = 0; i < skey.length; i++) t = (t * 33 + skey.charCodeAt(i)) % 0x80000000;
  return t;
}

// ============ QQ 扫码登录（Go generateQRCodeWithSig / checkQRLoginStatus / fetchFullCookie） ============

/** 生成 QQ 登录二维码并返回图片字节与 qrsig */
async function generateQRCodeWithSig(): Promise<{ qrcodeBytes: Buffer; qrsig: string }> {
  const qrcodeURL =
    'https://xui.ptlogin2.qq.com/ssl/ptqrshow?appid=1600001587&e=2&l=M&s=3&d=72&v=4&t=0.3680011491059967&daid=823&pt_3rd_aid=0';
  const resp = await rawFetch(qrcodeURL, { timeoutMs: 15_000, headers: { 'User-Agent': CHROME_UA } });
  if (resp.status !== 200) throw new Error(`二维码请求返回状态码: ${resp.status}`);
  const qrsig = extractQrsig(resp.setCookies);
  return { qrcodeBytes: resp.body, qrsig };
}

/** 检查二维码登录状态（Go checkQRLoginStatus） */
async function checkQRLoginStatus(qrsig: string): Promise<LoginResult> {
  const ptqrtoken = getptqrtoken(qrsig);
  const loginCheckURL = `https://xui.ptlogin2.qq.com/ssl/ptqrlogin?u1=https%3A%2F%2Fpd.qq.com%2Fexplore&ptqrtoken=${ptqrtoken}&ptredirect=1&h=1&t=1&g=1&from_ui=1&ptlang=2052&action=0-0-1761211119400&js_ver=25100115&js_type=1&login_sig=&pt_uistyle=40&aid=1600001587&daid=823&&o1vId=11f3315cde61b7b5da200e4a09fe308c&pt_js_version=28d22679`;

  const resp = await rawFetch(loginCheckURL, {
    timeoutMs: 10_000,
    headers: { 'User-Agent': CHROME_UA, Cookie: `qrsig=${qrsig}` },
  });
  const bodyStr = resp.body.toString('utf8');

  if (bodyStr.includes('二维码已失效')) return { status: 'expired', cookie: '', qqMasked: '' };

  if (bodyStr.includes('登录成功')) {
    // 解析 ptuiCB('0','0','url',...) 提取 ptsigx 与 uin（Go extractLoginInfo）
    const cbMatch = bodyStr.match(/ptuiCB\('0','0','([^']+)'/);
    if (cbMatch === null) throw new Error('提取登录信息失败: 未找到ptuiCB');
    const url = cbMatch[1]!;
    const ptsigx = url.match(/ptsigx=([A-Za-z0-9]+)/)?.[1];
    const uin = url.match(/uin=(\d+)/)?.[1];
    if (ptsigx === undefined) throw new Error('提取登录信息失败: 未找到ptsigx');
    if (uin === undefined) throw new Error('提取登录信息失败: 未找到uin');

    // 用 ptqrlogin 返回的全部 Set-Cookie 换取完整 Cookie
    const cookie = await fetchFullCookie(uin, ptsigx, resp.setCookies.join('; '));
    return { status: 'success', cookie, qqMasked: maskQQ(uin) };
  }

  // 等待扫码
  return { status: 'waiting', cookie: '', qqMasked: '' };
}

/** 获取完整 Cookie（Go fetchFullCookie：check_sig 换取登录态） */
async function fetchFullCookie(uin: string, ptsigx: string, setCookieHeader: string): Promise<string> {
  const checkSigURL = `https://ptlogin2.pd.qq.com/check_sig?pttype=1&uin=${uin}&service=ptqrlogin&nodirect=1&ptsigx=${ptsigx}&s_url=https%3A%2F%2Fpd.qq.com%2Fexplore&f_url=&ptlang=2052&ptredirect=101&aid=1600001587&daid=823&j_later=0&low_login_hour=0&regmaster=0&pt_login_type=3&pt_aid=0&pt_aaid=16&pt_light=0&pt_3rd_aid=0`;

  const resp = await rawFetch(checkSigURL, {
    timeoutMs: 10_000,
    headers: { 'User-Agent': CHROME_UA, Cookie: setCookieHeader },
  });

  const cookieDict: Record<string, string> = {};
  for (const setCookie of resp.setCookies) {
    const [name, value] = parseSetCookieHeader(setCookie);
    if (name !== '' && value !== '') cookieDict[name] = value;
  }
  // 手动补 uin（o0 前缀）
  if (!cookieDict['uin'] || !cookieDict['uin'].startsWith('o')) cookieDict['uin'] = 'o0' + uin;

  return Object.entries(cookieDict).map(([k, v]) => `${k}=${v}`).join('; ');
}

/** 刷新 cookies（更新 uuid 等动态字段，Go refreshCookie） */
async function refreshCookie(cookieStr: string): Promise<string> {
  if (cookieStr === '') return cookieStr;
  const oldCookies = parseCookieString(cookieStr);
  const uin = oldCookies['uin'] ?? '';
  if (uin === '') return cookieStr;
  const strippedUin = uin.startsWith('o0') ? uin.slice(2) : uin.startsWith('o') ? uin.slice(1) : uin;

  try {
    const resp = await rawFetch('https://pd.qq.com/explore', {
      timeoutMs: 10_000,
      headers: {
        Cookie: cookieStr,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', // 与 Go 一致
      },
    });

    const newCookies: Record<string, string> = {};
    for (const setCookie of resp.setCookies) {
      const [name, value] = parseSetCookieHeader(setCookie);
      if (name !== '' && value !== '') newCookies[name] = value;
    }
    if (Object.keys(newCookies).length === 0) return cookieStr;

    // 旧 Cookie 为底、新 Cookie 覆盖，确保 uin 格式正确
    const merged: Record<string, string> = { ...oldCookies, ...newCookies };
    if (!merged['uin'] || !merged['uin'].startsWith('o')) merged['uin'] = 'o0' + strippedUin;
    return Object.entries(merged).map(([k, v]) => `${k}=${v}`).join('; ');
  } catch {
    return cookieStr;
  }
}

/** 生成脱敏 QQ 号（Go maskQQ：前4位+****+后2位） */
function maskQQ(uin: string): string {
  if (uin.length <= 4) return uin;
  if (uin.length > 6) return uin.slice(0, 4) + '****' + uin.slice(-2);
  return uin.slice(0, 2) + '****' + uin.slice(-2);
}

/** 测试 Cookie 是否有效（Go testCookieValid：向固定频道发一次搜索探活） */
async function testCookieValid(cookieStr: string): Promise<boolean> {
  cookieStr = await refreshCookie(cookieStr);
  const cookies = parseCookieString(cookieStr);
  const pSkey = cookies['p_skey'] ?? '';
  if (pSkey === '') return false;

  const payload = JSON.stringify({
    guild_id: '592843764045681811',
    query: 'test',
    cookie: '',
    member_cookie: '',
    search_type: { type: 0, feed_type: 0 },
    cond: { channel_ids: [], feed_rank_type: 0, type_list: [2, 3] },
  });
  try {
    const resp = await rawFetch(
      `https://pd.qq.com/qunng/guild/gotrpc/auth/trpc.group_pro.in_guild_search_svr.InGuildSearch/NewSearch?bkn=${bkn(pSkey)}`,
      {
        method: 'POST',
        timeoutMs: 10_000,
        headers: {
          'User-Agent': CHROME_UA,
          'x-oidb': '{"uint32_command":"0x9287","uint32_service_type":"2"}',
          'content-type': 'application/json',
          Cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; '),
        },
        body: payload,
      },
    );
    if (resp.status === 200) {
      const result = JSON.parse(resp.body.toString('utf8')) as Record<string, unknown>;
      if (result['retcode'] === 0) return true;
      if ('data' in result) return true;
    }
  } catch {
    return false;
  }
  return false;
}

// ============ 搜索逻辑（Go SearchWithResult / buildChannelTasks / executeTasks） ============

/** 从频道号提取真实 guild_id（Go extractGuildIDFromChannelNumber，失败落回原值） */
async function extractGuildIDFromChannelNumber(channelNumber: string): Promise<string> {
  if (/^\d+$/.test(channelNumber)) return channelNumber;
  try {
    const resp = await rawFetch(`https://pd.qq.com/g/${channelNumber}`, {
      timeoutMs: 10_000,
      headers: { 'User-Agent': CHROME_UA },
    });
    const match = resp.body.toString('utf8').match(/https:\/\/groupprohead\.gtimg\.cn\/(\d+)\//);
    if (match !== null) return match[1]!;
  } catch {
    /* 落回原值 */
  }
  return channelNumber;
}

const SEARCH_HEADERS = {
  'x-oidb': '{"uint32_command":"0x9287","uint32_service_type":"2"}',
  'content-type': 'application/json',
  'User-Agent': CHROME_UA, // Go 显式 Chrome/120
  Referer: 'https://pd.qq.com/',
  Origin: 'https://pd.qq.com',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

/** 搜索单个频道（Go searchSingleChannel，失败一律返回空数组） */
async function searchSingleChannel(
  keyword: string,
  cookieStr: string,
  channelId: string,
  guildId: string,
): Promise<SearchResult[]> {
  // 搜索前刷新 cookies（更新 uuid 等动态字段）
  cookieStr = await refreshCookie(cookieStr);
  const cookies = parseCookieString(cookieStr);
  const pSkey = cookies['p_skey'];
  if (pSkey === undefined) return []; // Cookie 中缺少 p_skey

  const apiURL = `https://pd.qq.com/qunng/guild/gotrpc/auth/trpc.group_pro.in_guild_search_svr.InGuildSearch/NewSearch?bkn=${bkn(pSkey)}`;
  const payload = JSON.stringify({
    guild_id: guildId,
    query: keyword,
    cookie: '',
    member_cookie: '',
    search_type: { type: 0, feed_type: 0 },
    cond: { channel_ids: [], feed_rank_type: 0, type_list: [2, 3] },
  });

  try {
    const resp = await rawFetch(apiURL, {
      method: 'POST',
      timeoutMs: 15_000,
      headers: { ...SEARCH_HEADERS, Cookie: cookieHeader(cookies) },
      body: payload,
    });
    if (resp.status !== 200) return [];
    const apiResp = JSON.parse(resp.body.toString('utf8')) as Record<string, unknown>;
    const data = apiResp['data'];
    const unionResult = typeof data === 'object' && data !== null ? (data as Record<string, unknown>)['union_result'] : undefined;
    const guildFeeds = typeof unionResult === 'object' && unionResult !== null ? (unionResult as Record<string, unknown>)['guild_feeds'] : undefined;
    if (!Array.isArray(guildFeeds)) return [];

    const results: SearchResult[] = [];
    guildFeeds.forEach((item, i) => {
      if (typeof item !== 'object' || item === null) return;
      const result = extractResultInfo(item as Record<string, unknown>, channelId, i);
      if (result.title !== '' && result.links.length > 0) results.push(result);
    });
    return results;
  } catch {
    return [];
  }
}

/** 从搜索结果条目提取标准结构（Go extractResultInfo） */
function extractResultInfo(item: Record<string, unknown>, channelId: string, index: number): SearchResult {
  // 标题：去掉「名称：」前缀，只取第一行
  let title = typeof item['title'] === 'string' ? item['title'] : '';
  if (title.startsWith('名称：')) title = title.slice('名称：'.length);
  const nl = title.indexOf('\n');
  if (nl > 0) title = title.slice(0, nl);
  title = title.trim();

  // 内容中提取网盘链接（不在插件层过滤，交给 Service 层处理）
  const content = typeof item['content'] === 'string' ? item['content'] : '';
  const links = extractLinksFromContent(content);

  // create_time 是 Unix 时间戳字符串
  let datetime = new Date().toISOString();
  const createTime = typeof item['create_time'] === 'string' ? item['create_time'] : '';
  if (createTime !== '') {
    const ts = Number.parseInt(createTime, 10);
    if (!Number.isNaN(ts)) datetime = new Date(ts * 1000).toISOString();
  }

  // 图片 URL 列表
  const images: string[] = [];
  if (Array.isArray(item['images'])) {
    for (const img of item['images']) {
      if (typeof img === 'object' && img !== null) {
        const url = (img as Record<string, unknown>)['url'];
        if (typeof url === 'string' && url !== '') images.push(url);
      }
    }
  }

  return {
    message_id: '',
    unique_id: `qqpd-${channelId}-${index}`,
    channel: '', // 插件搜索结果 Channel 必须为空
    datetime,
    title,
    content,
    links,
    images,
  };
}

/** 网盘链接提取规则（Go extractLinksFromContent 的 12 条模式，顺序与去重语义一致） */
const LINK_PATTERNS: Array<{ pattern: RegExp; linkType: string }> = [
  { pattern: /https:\/\/pan\.quark\.cn\/s\/[^\s\n]+/g, linkType: 'quark' },
  { pattern: /https:\/\/drive\.uc\.cn\/s\/[^\s\n]+/g, linkType: 'uc' },
  { pattern: /https:\/\/pan\.baidu\.com\/s\/[^\s\n?]+(?:\?pwd=[a-zA-Z0-9]+)?/g, linkType: 'baidu' },
  { pattern: /https:\/\/(?:aliyundrive\.com|www\.alipan\.com)\/s\/[^\s\n]+/g, linkType: 'aliyun' },
  { pattern: /https:\/\/pan\.xunlei\.com\/s\/[^\s\n]+/g, linkType: 'xunlei' },
  { pattern: /https:\/\/cloud\.189\.cn\/(?:t|web\/share)\/[^\s\n]+/g, linkType: 'tianyi' },
  { pattern: /https:\/\/(?:115\.com|115cdn\.com)\/s\/[^\s\n?]+(?:\?password=[a-zA-Z0-9]+)?/g, linkType: '115' },
  {
    pattern: /https:\/\/(?:123pan\.cn|www\.123912\.com|www\.123684\.com|www\.123685\.com|www\.123592\.com|www\.123pan\.com)\/s\/[^\s\n]+/g,
    linkType: '123',
  },
  { pattern: /https:\/\/caiyun\.(?:139\.com|feixin\.10086\.cn)\/[^\s\n]+/g, linkType: 'mobile' },
  { pattern: /https:\/\/mypikpak\.com\/s\/[^\s\n]+/g, linkType: 'pikpak' },
  { pattern: /magnet:\?xt=urn:btih:[^\n]+/g, linkType: 'magnet' },
  { pattern: /ed2k:\/\/\|file\|[^\n]+?\|\//g, linkType: 'ed2k' },
];

/** 从内容中提取网盘链接（同一 URL 去重） */
function extractLinksFromContent(content: string): Link[] {
  const links: Link[] = [];
  const seen = new Set<string>();
  for (const { pattern, linkType } of LINK_PATTERNS) {
    for (const linkURL of content.match(pattern) ?? []) {
      if (seen.has(linkURL)) continue;
      seen.add(linkURL);

      let password = '';
      if (linkURL.includes('pwd=')) {
        password = linkURL.match(/pwd=([a-zA-Z0-9]+)/)?.[1] ?? '';
      } else if (linkURL.includes('password=')) {
        password = linkURL.match(/password=([a-zA-Z0-9]+)/)?.[1] ?? '';
      }
      links.push({ type: linkType, url: linkURL, password });
    }
  }
  return links;
}

/** 构建频道任务（去重 + 负载均衡，Go buildChannelTasks） */
async function buildChannelTasks(activeUsers: User[]): Promise<ChannelTask[]> {
  // 1. 收集所有频道及其所属用户
  const channelOwners = new Map<string, User[]>();
  for (const user of activeUsers) {
    for (const channelId of user.channels) {
      const owners = channelOwners.get(channelId) ?? [];
      owners.push(user);
      channelOwners.set(channelId, owners);
    }
  }

  // 2. 每个频道分配给当前任务最少的用户（负载均衡）
  const tasks: ChannelTask[] = [];
  const userTaskCount = new Map<string, number>();
  for (const [channelId, owners] of channelOwners) {
    let selectedUser = owners[0]!;
    let minTasks = userTaskCount.get(selectedUser.hash) ?? 0;
    for (const owner of owners) {
      const count = userTaskCount.get(owner.hash) ?? 0;
      if (count < minTasks) {
        selectedUser = owner;
        minTasks = count;
      }
    }

    // guild_id 优先用缓存，未命中实时获取（与 Go 一致：此处不回写缓存）
    let guildId = selectedUser.channel_guild_ids[channelId] ?? '';
    if (guildId === '') guildId = await extractGuildIDFromChannelNumber(channelId);

    tasks.push({ channelId, guildId, userHash: selectedUser.hash, cookie: selectedUser.cookie });
    userTaskCount.set(selectedUser.hash, (userTaskCount.get(selectedUser.hash) ?? 0) + 1);
  }
  return tasks;
}

/** 并发执行所有频道搜索任务（Go executeTasks，信号量=并发限制器） */
async function executeTasks(tasks: ChannelTask[], keyword: string): Promise<SearchResult[]> {
  const limit = createLimiter(MAX_CONCURRENT_CHANNELS);
  const settled = await Promise.allSettled(
    tasks.map((t) => limit(() => searchSingleChannel(keyword, t.cookie, t.channelId, t.guildId))),
  );
  const allResults: SearchResult[] = [];
  for (const s of settled) {
    if (s.status === 'fulfilled') allResults.push(...s.value);
  }
  return allResults;
}

/** 执行搜索（Go SearchWithResult：结果不在插件内过滤，交由 Service 层按链接标题精确过滤） */
async function doSearch(keyword: string): Promise<SearchResult[]> {
  await ensureInit();

  // 1. 获取所有有效用户
  let activeUsers = await getActiveUsers();
  if (activeUsers.length === 0) return [];

  // 2. 限制用户数量（取最近活跃的）
  if (activeUsers.length > MAX_CONCURRENT_USERS) {
    activeUsers = [...activeUsers]
      .sort((a, b) => Date.parse(b.last_access_at) - Date.parse(a.last_access_at))
      .slice(0, MAX_CONCURRENT_USERS);
  }

  // 3. 收集并去重频道，智能分配给用户
  const tasks = await buildChannelTasks(activeUsers);

  // 4. 并发执行所有任务，返回原始结果
  return executeTasks(tasks, keyword);
}

// ============ Web 路由（Go RegisterWebRoutes：/qqpd/:param 的 GET/POST） ============

/** 判断是否为十六进制字符串 */
function isHexString(s: string): boolean {
  return /^[0-9a-fA-F]+$/.test(s);
}

/** hash 生成（Go generateHash：sha256(qq+salt) 完整 hex，不截取） */
function generateHash(qq: string): string {
  const salt = process.env['QQPD_HASH_SALT'] || 'pansou_qqpd_secret_2025';
  return createHash('sha256').update(qq + salt).digest('hex');
}

/** 从 URL 或纯文本中提取频道号（Go normalizeChannel） */
function normalizeChannel(input: string): string {
  const trimmed = input.trim();
  if (trimmed.includes('pd.qq.com/g/')) {
    const parts = trimmed.split('/g/');
    if (parts.length === 2) return parts[1]!.trim();
  }
  return trimmed;
}

/** 本地时间格式化（Go time.Format "2006-01-02 15:04:05"；零值时间格式与 Go 一致） */
function formatTime(iso: string): string {
  if (iso === '') return '0001-01-01 00:00:00';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const nowISO = (): string => new Date().toISOString();
const daysFromNow = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString();

/** 成功响应（Go respondSuccess：HTTP 200 + {success:true,message,data}） */
function respondSuccess(res: ServerResponse, message: string, data: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ success: true, message, data }));
}

/** 错误响应（Go respondError：同为 HTTP 200 + success:false） */
function respondError(res: ServerResponse, message: string): void {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ success: false, message, data: null }));
}

/** 读取请求体 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer | string) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/** GET 管理页（Go handleManagePage：64 位 hex 视为 hash 直接渲染，QQ 号计算 hash 后 302 重定向） */
async function handleManagePage(
  _req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
): Promise<void> {
  await ensureInit();
  const param = params['param'] ?? '';
  if (param.length === 64 && isHexString(param)) {
    // 这是 hash，直接显示管理页面
    const html = HTML_TEMPLATE.replaceAll('HASH_PLACEHOLDER', param);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } else {
    // 这是 QQ 号，计算 hash 并重定向
    res.writeHead(302, { Location: `/qqpd/${generateHash(param)}` });
    res.end();
  }
}

/** POST 路由（Go handleManagePagePOST：按 action 分发） */
async function handleManagePagePOST(
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
): Promise<void> {
  await ensureInit();
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
    case 'refresh_qrcode':
      await handleRefreshQRCode(res, hash);
      return;
    case 'logout':
      await handleLogout(res, hash);
      return;
    case 'set_channels':
      await handleSetChannelsWithData(res, hash, reqData);
      return;
    case 'test_search':
      await handleTestSearchWithData(res, hash, reqData);
      return;
    case 'manual_login':
      // 手动设置登录状态（测试用）
      await handleManualLogin(res, hash, reqData);
      return;
    case 'check_login':
      // 检查登录状态（扫码后前端轮询调用）
      await handleCheckLogin(res, hash);
      return;
    default:
      respondError(res, `未知的操作类型: ${action}`);
  }
}

// ============ POST Action 处理（Go handleGetStatus 等逐条对齐） ============

/** 获取状态（含登录探测、二维码 30 秒缓存） */
async function handleGetStatus(res: ServerResponse, hash: string): Promise<void> {
  let user = getUserByHash(hash);
  if (user === undefined) {
    // 创建新用户（内存+文件）
    user = {
      hash,
      qq_masked: '',
      cookie: '',
      status: 'pending',
      channels: [],
      channel_guild_ids: {},
      created_at: nowISO(),
      login_at: '',
      expire_at: '',
      last_access_at: nowISO(),
    };
    await saveUser(user);
  } else {
    // 更新最后访问时间
    user.last_access_at = nowISO();
    await saveUser(user);
  }

  // 检查登录状态
  let loggedIn = false;
  if (user.status === 'active' && user.cookie !== '') {
    // active 且有 Cookie：刷新 cookies（更新 uuid 等动态字段）
    const refreshedCookie = await refreshCookie(user.cookie);
    if (refreshedCookie !== user.cookie) {
      user.cookie = refreshedCookie;
      await saveUser(user);
    }
    loggedIn = true;
  } else if (user.status === 'active' && user.cookie === '') {
    // active 但 Cookie 为空：异常，重置为 pending
    user.status = 'pending';
    user.qq_masked = '';
    await saveUser(user);
  }

  // 生成二维码（如果需要，30 秒内用缓存）
  let qrcodeBase64 = '';
  if (!loggedIn) {
    const cached = qrStates.get(hash);
    if (cached !== undefined && Date.now() - cached.qrCodeCacheTime < 30_000) {
      qrcodeBase64 = `data:image/png;base64,${cached.qrCodeCache.toString('base64')}`;
    } else {
      try {
        const { qrcodeBytes, qrsig } = await generateQRCodeWithSig();
        qrcodeBase64 = `data:image/png;base64,${qrcodeBytes.toString('base64')}`;
        qrStates.set(hash, { qrCodeCache: qrcodeBytes, qrCodeCacheTime: Date.now(), qrsig });
      } catch (err) {
        console.error(`[QQPD] 生成二维码失败: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  // 计算剩余天数
  let expiresInDays = 0;
  if (user.expire_at !== '') {
    expiresInDays = Math.trunc((Date.parse(user.expire_at) - Date.now()) / 86_400_000);
    if (expiresInDays < 0) expiresInDays = 0;
  }

  respondSuccess(res, '获取成功', {
    hash,
    logged_in: loggedIn,
    status: user.status,
    qq_masked: user.qq_masked,
    login_time: formatTime(user.login_at),
    expire_time: formatTime(user.expire_at),
    expires_in_days: expiresInDays,
    channels: user.channels,
    channel_count: user.channels.length,
    qrcode_base64: qrcodeBase64,
  });
}

/** 刷新二维码 */
async function handleRefreshQRCode(res: ServerResponse, hash: string): Promise<void> {
  if (getUserByHash(hash) === undefined) {
    respondError(res, '用户不存在');
    return;
  }
  let qrcodeBytes: Buffer;
  let qrsig: string;
  try {
    ({ qrcodeBytes, qrsig } = await generateQRCodeWithSig());
  } catch (err) {
    respondError(res, `生成二维码失败: ${err instanceof Error ? err.message : err}`);
    return;
  }
  qrStates.set(hash, { qrCodeCache: qrcodeBytes, qrCodeCacheTime: Date.now(), qrsig });
  respondSuccess(res, '二维码已刷新', {
    qrcode_base64: `data:image/png;base64,${qrcodeBytes.toString('base64')}`,
  });
}

/** 退出登录 */
async function handleLogout(res: ServerResponse, hash: string): Promise<void> {
  const user = getUserByHash(hash);
  if (user === undefined) {
    respondError(res, '用户不存在');
    return;
  }
  user.cookie = '';
  user.status = 'pending';
  user.qq_masked = '';
  try {
    await saveUser(user);
  } catch {
    respondError(res, '退出失败');
    return;
  }
  respondSuccess(res, '已退出登录', { status: 'pending' });
}

/** 检查登录状态（前端扫码后轮询） */
async function handleCheckLogin(res: ServerResponse, hash: string): Promise<void> {
  const user = getUserByHash(hash);
  if (user === undefined) {
    respondError(res, '用户不存在');
    return;
  }
  const qr = qrStates.get(hash);
  if (qr === undefined || qr.qrsig === '') {
    respondError(res, '请先刷新二维码');
    return;
  }

  let loginResult: LoginResult;
  try {
    loginResult = await checkQRLoginStatus(qr.qrsig);
  } catch (err) {
    respondError(res, err instanceof Error ? err.message : String(err));
    return;
  }

  if (loginResult.status === 'success') {
    user.cookie = loginResult.cookie;
    user.status = 'active';
    user.qq_masked = loginResult.qqMasked;
    user.login_at = nowISO();
    // QQ Cookie 实际有效期通常 2 天，设 2 天后过期（留一点缓冲时间）
    user.expire_at = daysFromNow(2);
    try {
      await saveUser(user);
    } catch (err) {
      respondError(res, `保存失败: ${err instanceof Error ? err.message : err}`);
      return;
    }
    respondSuccess(res, '登录成功', { login_status: 'success', qq_masked: loginResult.qqMasked });
  } else if (loginResult.status === 'waiting') {
    respondSuccess(res, '等待扫码', { login_status: 'waiting' });
  } else {
    // expired
    respondError(res, '二维码已失效，请刷新');
  }
}

/** 手动登录（测试用：手动设置 Cookie） */
async function handleManualLogin(res: ServerResponse, hash: string, reqData: Record<string, unknown>): Promise<void> {
  const user = getUserByHash(hash);
  if (user === undefined) {
    respondError(res, '用户不存在');
    return;
  }
  const cookie = typeof reqData['cookie'] === 'string' ? reqData['cookie'] : '';
  const qqMasked = typeof reqData['qq_masked'] === 'string' ? reqData['qq_masked'] : '';
  if (cookie === '') {
    respondError(res, '缺少cookie参数');
    return;
  }
  if (!(await testCookieValid(cookie))) {
    respondError(res, 'Cookie无效或已失效');
    return;
  }

  user.cookie = cookie;
  user.status = 'active';
  user.qq_masked = qqMasked;
  user.login_at = nowISO();
  user.expire_at = daysFromNow(2);
  try {
    await saveUser(user);
  } catch (err) {
    respondError(res, `保存失败: ${err instanceof Error ? err.message : err}`);
    return;
  }
  respondSuccess(res, '登录成功', {
    status: 'active',
    qq_masked: qqMasked,
    login_time: formatTime(user.login_at),
    expire_time: formatTime(user.expire_at),
  });
}

/** 设置频道列表（覆盖式，规范化+去重+guild_id 缓存维护） */
async function handleSetChannelsWithData(
  res: ServerResponse,
  hash: string,
  reqData: Record<string, unknown>,
): Promise<void> {
  if (!('channels' in reqData)) {
    respondError(res, '缺少channels字段');
    return;
  }
  const channels: string[] = [];
  if (Array.isArray(reqData['channels'])) {
    for (const ch of reqData['channels']) {
      if (typeof ch === 'string') channels.push(ch);
    }
  }

  const user = getUserByHash(hash);
  if (user === undefined) {
    respondError(res, '用户不存在');
    return;
  }

  // 规范化频道列表（提取频道号，去重）
  const normalizedChannels: string[] = [];
  const seen = new Set<string>();
  const invalid: string[] = [];
  for (const ch of channels) {
    const normalized = normalizeChannel(ch);
    if (normalized === '') {
      invalid.push(ch);
      continue;
    }
    if (!seen.has(normalized)) {
      normalizedChannels.push(normalized);
      seen.add(normalized);
    }
  }

  user.channel_guild_ids ??= {};

  // 批量并发获取缺失的 guild_id 并缓存
  const needFetch = normalizedChannels.filter((ch) => !(ch in user.channel_guild_ids));
  if (needFetch.length > 0) {
    await Promise.all(
      needFetch.map(async (ch) => {
        // 获取失败时与 Go 一致：落回原频道号
        user.channel_guild_ids[ch] = await extractGuildIDFromChannelNumber(ch);
      }),
    );
  }

  // 清理已删除频道的缓存
  for (const key of Object.keys(user.channel_guild_ids)) {
    if (!seen.has(key)) delete user.channel_guild_ids[key];
  }

  // 更新用户数据（内存+文件）
  user.channels = normalizedChannels;
  user.last_access_at = nowISO();
  try {
    await saveUser(user);
  } catch (err) {
    respondError(res, `保存失败: ${err instanceof Error ? err.message : err}`);
    return;
  }

  respondSuccess(res, '频道列表已更新', {
    channels: normalizedChannels,
    channel_count: normalizedChannels.length,
    invalid_channels: invalid,
    guild_ids_cached: Object.keys(user.channel_guild_ids).length,
  });
}

/** 测试搜索（限制返回条数，前端管理页直连） */
async function handleTestSearchWithData(
  res: ServerResponse,
  hash: string,
  reqData: Record<string, unknown>,
): Promise<void> {
  const keyword = typeof reqData['keyword'] === 'string' ? reqData['keyword'] : '';
  if (keyword === '') {
    respondError(res, '缺少keyword字段');
    return;
  }
  let maxResults = 10;
  if (typeof reqData['max_results'] === 'number') maxResults = Math.trunc(reqData['max_results']);

  const user = getUserByHash(hash);
  if (user === undefined || user.cookie === '') {
    respondError(res, '请先登录');
    return;
  }
  if (user.channels.length === 0) {
    respondError(res, '请先配置频道');
    return;
  }

  // 用该用户的全部频道执行真实搜索
  const tasks: ChannelTask[] = [];
  for (const channelId of user.channels) {
    let guildId = channelId in user.channel_guild_ids ? user.channel_guild_ids[channelId]! : '';
    if (guildId === '') guildId = await extractGuildIDFromChannelNumber(channelId);
    tasks.push({ channelId, guildId, userHash: user.hash, cookie: user.cookie });
  }
  let allResults = await executeTasks(tasks, keyword);
  // 不在插件内过滤，交给 Service 层；仅限制返回数量
  if (allResults.length > maxResults) allResults = allResults.slice(0, maxResults);

  const results = allResults.map((r) => ({
    unique_id: r.unique_id, // 显示来源频道
    title: r.title,
    links: r.links.map((link) => ({ type: link.type, url: link.url, password: link.password })),
  }));

  respondSuccess(res, `找到 ${results.length} 条结果`, {
    keyword,
    total_results: results.length,
    channels_searched: user.channels,
    results,
  });
}

// ============ 定期清理（Go startCleanupTask：time.Ticker 协程 → setInterval+unref） ============

function startCleanupTask(): void {
  const timer = setInterval(() => void cleanupOnce().catch((err) => {
    console.error(`[QQPD] 清理任务失败: ${err instanceof Error ? err.message : err}`);
  }), 24 * 3600 * 1000);
  timer.unref();
}

async function cleanupOnce(): Promise<void> {
  const now = Date.now();
  let deleted = 0;
  let marked = 0;
  for (const user of [...users.values()]) {
    // 删除：状态为 expired 且超过 30 天未访问
    if (user.status === 'expired' && Date.parse(user.last_access_at) < now - 30 * 86_400_000) {
      await deleteUser(user.hash);
      deleted++;
    } else if (Date.parse(user.last_access_at) < now - 90 * 86_400_000 && user.status !== 'expired') {
      // 标记：超过 90 天未访问
      user.status = 'expired';
      user.cookie = '';
      await saveUser(user);
      marked++;
    }
  }
  if (deleted > 0 || marked > 0) {
    console.log(`[QQPD] 清理任务完成: 删除 ${deleted} 个过期用户, 标记 ${marked} 个不活跃用户`);
  }
}

// ============ 插件注册（Go init() + RegisterGlobalPlugin + RegisterWebRoutes） ============

export const qqpd = definePlugin({
  name: 'qqpd',
  priority: 3, // Go NewBaseAsyncPlugin("qqpd", 3)
  // skipServiceFilter 保持默认 false：Go 版已注释掉 SkipServiceFilter，
  // 交由 Service 层按每个链接的标题精确过滤
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    // Go Search 不消费 ext，保持一致
    return doSearch(keyword);
  },
  webRoutes: [
    { method: 'GET', path: '/qqpd/:param', handler: handleManagePage },
    { method: 'POST', path: '/qqpd/:param', handler: handleManagePagePOST },
  ],
});
