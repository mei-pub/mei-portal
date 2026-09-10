// Gying 账号型搜索插件 —— Go pansou/plugin/gying/gying.go 的代码级移植
// 站点资源搜索引擎（默认 https://www.xn--wcv59z.com），账号登录后经
// /search?q=&type=0&mode=2 取 _obj.search JSON，再并发抓 /res/downurl/<type>/<id> 详情。
// 除搜索外注册 Web 管理页路由（GET/POST /gying/:param），服务端渲染 HTML 管理账号与站点配置。
//
// 与 Go 版的差异（均为约束下的有意取舍）：
// 1. cloudscraper 降级：不新增 npm 依赖，用原生 fetch + Chrome UA + 会话 cookie jar 近似实现。
//    Go 版过 CF 盾依赖 cloudscraper 的 TLS 指纹；本实现若站点启用 CF 严格防护可能失败。
//    插件自身的反爬 challenge（PoW 大数平方取模 / sha256 nonce 求解）是插件代码而非
//    cloudscraper 能力，已完整移植（requestWithChallengeRetry 的两轮重试语义不变）。
// 2. Go 基础设施协程已删：启动时 initDefaultAccounts 重登协程（会话改为搜索时惰性恢复 +
//    403 自动重登）、startSessionKeepAlive（3 分钟保活轮询）、startCleanupTask（24 小时过期/
//    不活跃清理）、applyProxyToScraper（SOCKS/HTTP 代理与连接池；Node fetch 直连，与
//    src/http.ts 部署形态一致）、未被调用的 encryptCookie/decryptCookie 死代码、空的
//    DefaultAccounts 列表。
// 3. Go 插件级 searchCache 未移植：框架（Service 层）已负责超时/缓存/后台补全，Go 注释本身
//    也说明 Service 层已有缓存；ext.refresh 由框架缓存语义承接，本插件不再自建缓存。
// 4. solveLegacyHashChallenge 的多 worker 求解改为单线程顺序循环（Go 为 GOMAXPROCS 个
//    goroutine 分片），覆盖同一 nonce 空间、产出一致；diff 很大时会阻塞事件循环。

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from '../config.ts';
import { createLimiter } from '../http.ts';
import type { Link, SearchResult } from '../types.ts';
import { definePlugin } from './shared.ts';

// ============ 插件配置参数（Go 常量区） ============

const MAX_CONCURRENT_USERS = 10; // 最多使用的用户数
const MAX_CONCURRENT_DETAILS = 50; // 最大并发详情请求数
const DEFAULT_GYING_BASE_URL = 'https://www.xn--wcv59z.com';
const GYING_CONFIG_FILE_NAME = 'gying_config.json';
const REQUEST_TIMEOUT_MS = 30_000; // 单请求超时（Go cloudscraper 默认 30s）
const CHALLENGE_MIN_SOLVE_MS = 3000; // PoW 最短求解时长（Go 同款防时序指纹等待）

/** Go legacyGyingHosts：旧站点域名 → 迁移回默认站点 */
const LEGACY_GYING_HOSTS = new Set(['gying.net', 'www.gying.net', 'xn--wcv59z.com']);

// ============ 正则（Go 顶部 var 区逐条对应） ============

const CHALLENGE_JSON_PATTERN = /const\s+json\s*=\s*(\{[\s\S]*?\})\s*;\s*const\s+jss\s*=/; // Go (?s)
const SEARCH_DATA_PATTERN = /_obj\s*\.\s*search\s*=\s*(\{[\s\S]*?\})\s*;/; // Go (?s)
const ACCESS_CODE_BLOCK_REGEX = /[（(]\s*访问码[:：]\s*[^)）]+[)）]/g;
const YEAR_SUFFIX_REGEX = /[（(]\d{4}[)）]/g;
const BAIDU_LINK_REGEX = /https?:\/\/pan\.baidu\.com\/s\/[a-zA-Z0-9_-]+(?:\?pwd=[a-zA-Z0-9]{4})?/;
const QUARK_LINK_REGEX = /https?:\/\/pan\.quark\.cn\/s\/[a-zA-Z0-9]+/;
const ALIYUN_LINK_REGEX = /https?:\/\/(?:www\.)?(?:alipan|aliyundrive)\.com\/s\/[a-zA-Z0-9]+/;
const XUNLEI_LINK_REGEX = /https?:\/\/pan\.xunlei\.com\/s\/[a-zA-Z0-9]+(?:\?pwd=[a-zA-Z0-9]{4})?/;
const TIANYI_LINK_REGEX = /https?:\/\/cloud\.189\.cn\/(?:t\/|web\/share\?code=)[a-zA-Z0-9]+/;
const TIANYI_SHARE_CODE_REGEX = /sharecode=([a-zA-Z0-9]+)/i;
const TIANYI_CLOUD_REGEX = /https?:\/\/(?:www\.)?tianyi\.cloud\/[^\s<>"']+/;
const UC_LINK_REGEX = /https?:\/\/drive\.uc\.cn\/s\/[a-zA-Z0-9]+(?:\?public=\d+)?/;
const LINK_123_REGEX = /https?:\/\/(?:www\.)?123(?:684|685|865|912|pan|592)\.(?:com|cn)\/s\/[a-zA-Z0-9_-]+(?:\?pwd=[a-zA-Z0-9]{4,8})?/;
const LINK_115_REGEX = /https?:\/\/(?:115\.com|115cdn\.com|anxia\.com)\/s\/[a-zA-Z0-9]+(?:\?password=[a-zA-Z0-9]{4,8})?/;
const MOBILE_YUN_LINK_REGEX = /https?:\/\/yun\.139\.com\/shareweb\/#\/w\/i\/[a-zA-Z0-9]+/;
const MOBILE_CAIYUN_LINK_REGEX = /https?:\/\/(?:www\.)?caiyun\.139\.com\/(?:w\/i\/[a-zA-Z0-9]+|m\/i\?[a-zA-Z0-9]+)[^\s<>"']*/;
const MOBILE_FEIXIN_LINK_REGEX = /https?:\/\/caiyun\.feixin\.10086\.cn\/[a-zA-Z0-9]+/;
const EXACT_PASSWORD_REGEX = /^[a-zA-Z0-9]{4,8}$/;
const MAGNET_HASH_REGEX = /^[a-f0-9]{40}$/i;

/** Go inlinePasswordPatterns（提取码内联提取，按序命中） */
const INLINE_PASSWORD_PATTERNS: RegExp[] = [
  /[?&]pwd=([a-zA-Z0-9]{4,8})/i,
  /[?&]password=([a-zA-Z0-9]{4,8})/i,
  /访问码[:：]\s*([a-zA-Z0-9]{4,8})/,
  /提取码[:：]\s*([a-zA-Z0-9]{4,8})/,
  /密码[:：]\s*([a-zA-Z0-9]{4,8})/,
];

/** Go gyingPanTypeMap：网盘类型编码 → 标准类型名 */
const GYING_PAN_TYPE_MAP: Record<number, string> = {
  0: 'xunlei',
  1: 'baidu',
  2: 'quark',
  3: 'tianyi',
  4: 'mobile',
  5: '115',
  6: '123',
  7: 'uc',
  8: 'aliyun',
};

// ============ HTML 模板（Go HTMLTemplate 逐字节复刻，HASH_PLACEHOLDER 运行时替换） ============

const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PanSou Gying搜索配置</title>
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
        .form-group {
            margin-bottom: 15px;
        }
        .form-group label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
        }
        .form-group input {
            width: 100%;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 6px;
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
        .notice {
            background: #fff7d6;
            color: #744210;
            padding: 12px 15px;
            border-radius: 6px;
            margin-bottom: 15px;
            border: 1px solid #f6e05e;
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
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔍 PanSou Gying搜索</h1>
            <p>配置你的专属搜索服务</p>
            <p style="font-size: 12px; margin-top: 10px; opacity: 0.8;">
                🔗 当前地址: <span id="current-url">HASH_PLACEHOLDER</span>
            </p>
        </div>

        <div class="section" id="site-section">
            <div class="section-title">🌐 站点地址</div>

            <div class="status-box">
                <div class="status-item">
                    <span>当前站点</span>
                    <span id="base-url-current">-</span>
                </div>
            </div>

            <div class="form-group">
                <label>站点地址</label>
                <input type="text" id="base-url" placeholder="例如: https://www.教父.com">
            </div>
            <button class="btn btn-primary" onclick="saveBaseURL()">保存站点地址</button>
            <p style="margin-top: 10px; font-size: 12px; color: #666;">
                修改站点地址后，会清空当前登录状态，需要重新登录账号。
            </p>
        </div>

        <div class="section" id="login-section">
            <div class="section-title">🔐 登录状态</div>

            <div class="notice">登录前请先确认上方站点地址是否正确。</div>

            <div id="logged-in-view" class="hidden">
                <div class="status-box">
                    <div class="status-item">
                        <span>状态</span>
                        <span><strong style="color: #48bb78;">✅ 已登录</strong></span>
                    </div>
                    <div class="status-item">
                        <span>用户名</span>
                        <span id="username-display">-</span>
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
                <div id="alert-box"></div>
                <div class="form-group">
                    <label>用户名</label>
                    <input type="text" id="username" placeholder="输入用户名">
                </div>
                <div class="form-group">
                    <label>密码</label>
                    <input type="password" id="password" placeholder="输入密码">
                </div>
                <button class="btn btn-primary" onclick="login()">登录</button>
            </div>
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

            <p style="margin-bottom: 15px;">你可以通过API程序化管理：</p>

            <details>
                <summary style="cursor: pointer; padding: 10px 0; font-weight: bold;">登录</summary>
                <div style="background: #2d3748; color: #68d391; padding: 10px; border-radius: 6px; font-family: monospace; font-size: 12px; overflow-x: auto;">curl -X POST https://your-domain.com/gying/HASH_PLACEHOLDER \\
  -H "Content-Type: application/json" \\
  -d '{"action": "login", "username": "user", "password": "pass"}'</div>
            </details>
        </div>
    </div>

    <script>
        const HASH = 'HASH_PLACEHOLDER';
        const API_URL = '/gying/' + HASH;
        let statusCheckInterval = null;

        window.onload = function() {
            updateStatus();
            loadConfig();
            startStatusPolling();
        };

        function startStatusPolling() {
            statusCheckInterval = setInterval(updateStatus, 5000);
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

                    document.getElementById('username-display').textContent = data.username || '-';
                    document.getElementById('login-time').textContent = data.login_time || '-';
                    document.getElementById('expire-info').textContent = '剩余 ' + (data.expires_in_days || 0) + ' 天';
                } else {
                    document.getElementById('logged-in-view').classList.add('hidden');
                    document.getElementById('not-logged-in-view').classList.remove('hidden');
                }
            }
        }

        async function loadConfig() {
            const result = await postAction('get_config');
            if (result.success && result.data) {
                const baseURL = result.data.base_url || '';
                document.getElementById('base-url').value = baseURL;
                document.getElementById('base-url-current').textContent = baseURL || '-';
            }
        }

        function showAlert(message, type = 'success') {
            const alertBox = document.getElementById('alert-box');
            alertBox.innerHTML = '<div class="alert alert-' + type + '">' + message + '</div>';
            setTimeout(() => {
                alertBox.innerHTML = '';
            }, 3000);
        }

        async function login() {
            const username = document.getElementById('username').value.trim();
            const password = document.getElementById('password').value.trim();

            if (!username || !password) {
                showAlert('请输入用户名和密码', 'error');
                return;
            }

            const result = await postAction('login', { username, password });
            if (result.success) {
                showAlert(result.message);
                updateStatus();
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

        async function saveBaseURL() {
            const baseURL = document.getElementById('base-url').value.trim();

            if (!baseURL) {
                showAlert('请输入站点地址', 'error');
                return;
            }

            const result = await postAction('update_config', { base_url: baseURL });
            if (result.success) {
                showAlert(result.message);
                loadConfig();
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
                        html += '[' + link.type + '] ';
                        if (link.work_title) {
                            html += '<strong>' + link.work_title + '</strong><br>';
                        }
                        html += link.url;
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

// ============ 数据结构（Go struct 区） ============

/** Go SearchData：搜索页 _obj.search JSON */
interface SearchData {
  q?: string;
  wd?: string[];
  n?: string;
  l?: {
    title?: string[];
    year?: number[];
    d?: string[];
    i?: string[];
    info?: string[];
    daoyan?: string[];
    zhuyan?: string[];
  };
}

/** Go DetailData：详情接口 JSON */
interface DetailData {
  code?: number;
  wp?: boolean;
  downlist?: {
    imdb?: string;
    type?: { a?: string[]; b?: string[] };
    hex?: string;
    list?: {
      m?: string[]; // 磁力hash
      t?: string[]; // 资源名称
      s?: string[]; // 文件大小
      e?: unknown[];
      p?: string[]; // 资源分组标识
      u?: string[];
      k?: unknown[];
      n?: string[]; // 更新时间
    };
  };
  panlist?: {
    id?: string[];
    name?: string[];
    p?: string[]; // 提取码数组
    url?: string[]; // 链接数组
    type?: number[]; // 类型标识
    user?: string[];
    time?: string[]; // 分享时间
    tname?: string[]; // 网盘类型名称
  };
}

/** Go ChallengePageData：反爬验证页 JSON */
interface ChallengePageData {
  id?: string;
  challenge?: string[];
  diff?: number;
  salt?: string;
  n?: string;
  x?: string;
  t?: number;
}

/** Go User（JSON 字段名与 Go 一致；时间为 ISO 串，零时间序列化为 0001-01-01T00:00:00Z） */
interface UserRecord {
  hash: string;
  username: string;
  encryptedPassword: string;
  cookie: string;
  status: string; // pending/active/expired
  createdAt: Date | null;
  loginAt: Date | null;
  expireAt: Date | null;
  lastAccessAt: Date | null;
}

/** Go GyingConfig */
interface GyingConfigFile {
  base_url: string;
  updated_at: string;
}

// ============ 工具函数 ============

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 错误文本是否含 403（Go strings.Contains(err.Error(), "403")） */
function is403Error(err: unknown): boolean {
  return errText(err).includes('403');
}

/** Go generateHash：sha256(username + salt) 十六进制 */
function generateHash(username: string): string {
  const salt = process.env['GYING_HASH_SALT'] || 'pansou_gying_secret_2025';
  return createHash('sha256').update(username + salt).digest('hex');
}

/** Go isHexString */
function isHexString(s: string): boolean {
  return /^[0-9a-fA-F]*$/.test(s);
}

/** Go Format("2006-01-02 15:04:05")：本地时间 */
function formatLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 零时间按 Go 渲染为 0001-01-02 00:00:00 */
function formatLocalOrZero(d: Date | null): string {
  return d === null ? '0001-01-02 00:00:00' : formatLocal(d);
}

/** 解析持久化时间串；Go 零时间（0001-…）与非法值归一为 null */
function parseStoredTime(value: unknown): Date | null {
  if (typeof value !== 'string' || value === '' || value.startsWith('0001-')) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtRFC3339(d: Date | null): string {
  return d === null ? '0001-01-01T00:00:00Z' : d.toISOString();
}

/** 序列化 User（字段名与 Go JSON tag 一致，MarshalIndent 两空格） */
function serializeUser(user: UserRecord): string {
  return JSON.stringify(
    {
      hash: user.hash,
      username: user.username,
      encrypted_password: user.encryptedPassword,
      cookie: user.cookie,
      status: user.status,
      created_at: fmtRFC3339(user.createdAt),
      login_at: fmtRFC3339(user.loginAt),
      expire_at: fmtRFC3339(user.expireAt),
      last_access_at: fmtRFC3339(user.lastAccessAt),
    },
    null,
    2,
  );
}

function parseUser(data: string): UserRecord {
  const raw = JSON.parse(data) as Record<string, unknown>;
  return {
    hash: typeof raw['hash'] === 'string' ? raw['hash'] : '',
    username: typeof raw['username'] === 'string' ? raw['username'] : '',
    encryptedPassword: typeof raw['encrypted_password'] === 'string' ? raw['encrypted_password'] : '',
    cookie: typeof raw['cookie'] === 'string' ? raw['cookie'] : '',
    status: typeof raw['status'] === 'string' ? raw['status'] : 'pending',
    createdAt: parseStoredTime(raw['created_at']),
    loginAt: parseStoredTime(raw['login_at']),
    expireAt: parseStoredTime(raw['expire_at']),
    lastAccessAt: parseStoredTime(raw['last_access_at']),
  };
}

// ============ 密码加密/解密（Go encryptPassword / decryptPassword，AES-256-GCM 同格式） ============

const PASSWORD_AES_KEY = Buffer.from('gying-secret-key-32bytes-long!!!', 'utf8'); // Go 固定 32 字节密钥

function encryptPassword(password: string): string {
  const nonce = randomBytes(12); // GCM 标准 12 字节 nonce
  const cipher = createCipheriv('aes-256-gcm', PASSWORD_AES_KEY, nonce);
  const ciphertext = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag(); // 16 字节
  return Buffer.concat([nonce, ciphertext, tag]).toString('base64'); // nonce || ct || tag，与 Go Seal 一致
}

function decryptPassword(encrypted: string): string {
  const raw = Buffer.from(encrypted, 'base64');
  if (raw.length < 12 + 16) throw new Error('ciphertext too short');
  const nonce = raw.subarray(0, 12);
  const tag = raw.subarray(raw.length - 16);
  const ciphertext = raw.subarray(12, raw.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', PASSWORD_AES_KEY, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// ============ 插件状态与持久化（Go GyingPlugin 字段 + StorageDir） ============

let storageDir = '';
let currentBaseURL = ''; // 空则用默认（Go getBaseURL 语义）
const users = new Map<string, UserRecord>(); // 内存缓存：hash -> User（Go sync.Map users）
const sessions = new Map<string, GyingSession>(); // 会话缓存：hash -> Session（Go sync.Map scrapers）

let initPromise: Promise<void> | null = null;

/** 惰性初始化（对应 Go Initialize：建目录、加载站点配置、加载全部用户） */
function ensureInitialized(): Promise<void> {
  if (initPromise === null) {
    initPromise = initialize().catch((err: unknown) => {
      initPromise = null; // 失败后允许重试
      throw err;
    });
  }
  return initPromise;
}

async function initialize(): Promise<void> {
  storageDir = join(config.cachePath, 'gying_users');
  await mkdir(storageDir, { recursive: true });
  await loadConfigFile();
  await loadAllUsers();
}

function configPath(): string {
  return join(storageDir, GYING_CONFIG_FILE_NAME);
}

function getBaseURL(): string {
  return currentBaseURL === '' ? DEFAULT_GYING_BASE_URL : currentBaseURL;
}

function getLoginPageURL(): string {
  return getBaseURL();
}

function getLoginAPIURL(): string {
  return `${getBaseURL()}/user/login`;
}

function getWarmupDetailURL(): string {
  return `${getBaseURL()}/mv/wkMn`;
}

/** Go normalizeBaseURL：校验并把 Unicode 域名转 ASCII（Node URL 自动做 IDNA/punycode） */
function normalizeBaseURL(raw: string): string {
  let baseURL = raw.trim().replace(/\/+$/, '');
  if (baseURL === '') throw new Error('站点地址不能为空');
  if (!baseURL.startsWith('http://') && !baseURL.startsWith('https://')) baseURL = `https://${baseURL}`;

  let parsed: URL;
  try {
    parsed = new URL(baseURL);
  } catch (err) {
    throw new Error(`站点地址格式错误: ${errText(err)}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('站点地址必须以 http:// 或 https:// 开头');
  }
  if (parsed.hostname === '') throw new Error('站点地址缺少域名');
  if (parsed.search !== '' || parsed.hash !== '') throw new Error('站点地址不能包含参数或锚点');
  if (parsed.pathname !== '' && parsed.pathname !== '/') throw new Error('站点地址不能包含路径');

  // HTTP 客户端对 Unicode 域名的 IDNA 转换不一致（Go 注释同款问题）；
  // Node 的 WHATWG URL 解析时已统一转 punycode ASCII，这里直接取 hostname。
  let host = parsed.hostname;
  if (parsed.port !== '') host += `:${parsed.port}`;
  return `${parsed.protocol}//${host}`;
}

/** Go isLegacyGyingBaseURL */
function isLegacyGyingBaseURL(baseURL: string): boolean {
  try {
    const hostname = new URL(baseURL).hostname.toLowerCase();
    return LEGACY_GYING_HOSTS.has(hostname.replace(/\.$/, ''));
  } catch {
    return false;
  }
}

/** Go loadConfig：加载站点配置，旧域名自动迁移回默认站点 */
async function loadConfigFile(): Promise<void> {
  currentBaseURL = DEFAULT_GYING_BASE_URL;

  let data: string;
  try {
    data = await readFile(configPath(), 'utf8');
  } catch {
    return; // 配置不存在 → 用默认
  }

  let saved: { base_url?: unknown };
  try {
    saved = JSON.parse(data) as { base_url?: unknown };
  } catch (err) {
    throw new Error(`加载站点配置失败: ${errText(err)}`);
  }
  const savedURL = typeof saved.base_url === 'string' ? saved.base_url : '';
  if (savedURL === '') return;

  const baseURL = normalizeBaseURL(savedURL);
  if (isLegacyGyingBaseURL(baseURL)) {
    try {
      await saveConfigFile(DEFAULT_GYING_BASE_URL);
    } catch (err) {
      throw new Error(`迁移旧站点配置失败: ${errText(err)}`);
    }
    currentBaseURL = DEFAULT_GYING_BASE_URL;
    return;
  }
  currentBaseURL = baseURL;
}

async function saveConfigFile(baseURL: string): Promise<void> {
  const conf: GyingConfigFile = { base_url: baseURL, updated_at: new Date().toISOString() };
  await writeFile(configPath(), JSON.stringify(conf, null, 2), 'utf8');
}

/** Go resetSessionsForBaseURLChange：清空全部会话，用户回退到 pending */
async function resetSessionsForBaseURLChange(): Promise<void> {
  sessions.clear();
  const now = new Date();
  for (const user of users.values()) {
    user.cookie = '';
    user.status = 'pending';
    user.lastAccessAt = now;
    try {
      await persistUser(user);
    } catch (err) {
      console.error(`[Gying] 切换站点后保存用户状态失败: ${errText(err)}`);
    }
  }
}

/** Go updateBaseURL：校验 → 落盘 → 变更时清空会话 */
async function updateBaseURL(rawBaseURL: string): Promise<string> {
  const baseURL = normalizeBaseURL(rawBaseURL);
  const oldBaseURL = getBaseURL(); // 含默认值语义；失败时原样写回
  currentBaseURL = baseURL;
  try {
    await saveConfigFile(baseURL);
  } catch (err) {
    currentBaseURL = oldBaseURL;
    throw err;
  }
  if (baseURL !== oldBaseURL) await resetSessionsForBaseURLChange();
  return baseURL;
}

/** Go loadAllUsers：把存储目录里的用户文件（仅 active）加载进内存 */
async function loadAllUsers(): Promise<void> {
  let files: string[];
  try {
    files = await readdir(storageDir);
  } catch {
    return;
  }

  let totalFiles = 0;
  let loadedCount = 0;
  let skippedInactive = 0;

  for (const name of files) {
    if (name === GYING_CONFIG_FILE_NAME || !name.endsWith('.json')) continue;
    totalFiles++;

    let data: string;
    try {
      data = await readFile(join(storageDir, name), 'utf8');
    } catch {
      continue;
    }
    let user: UserRecord;
    try {
      user = parseUser(data);
    } catch {
      continue;
    }

    // 过滤条件：status 必须是 active（会话在搜索时惰性恢复）
    if (user.status !== 'active') {
      skippedInactive++;
      continue;
    }
    users.set(user.hash, user);
    loadedCount++;
  }

  console.log(`[Gying] 用户加载完成: 总文件=${totalFiles}, 已加载=${loadedCount}, 跳过(非active)=${skippedInactive}`);
}

/** Go saveUser：内存 + 落盘 */
async function saveUser(user: UserRecord): Promise<void> {
  users.set(user.hash, user);
  await persistUser(user);
}

/** Go persistUser */
async function persistUser(user: UserRecord): Promise<void> {
  await writeFile(join(storageDir, `${user.hash}.json`), serializeUser(user), 'utf8');
}

/** Go deleteUser */
async function deleteUser(hash: string): Promise<void> {
  users.delete(hash);
  await unlink(join(storageDir, `${hash}.json`));
}

/** Go getActiveUsers：active 且带 cookie 的用户 */
function getActiveUsers(): UserRecord[] {
  return [...users.values()].filter((u) => u.status === 'active' && u.cookie !== '');
}

// ============ 会话（Go cloudscraper 实例的 fetch 降级近似） ============

// Chrome UA + 浏览器头近似 cloudscraper 的默认请求头（无 TLS 指纹模拟）
const SESSION_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9',
};

/** Go parseCookieString */
function parseCookieString(cookieStr: string): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of cookieStr.split(';')) {
    const trimmed = part.trim();
    const idx = trimmed.indexOf('=');
    if (idx > 0) cookies.set(trimmed.slice(0, idx), trimmed.slice(idx + 1));
  }
  return cookies;
}

/** 单账号会话：cookie jar + 统一超时的 fetch 封装（对应一个 cloudscraper 实例） */
class GyingSession {
  private readonly cookies = new Map<string, string>();

  constructor(cookieStr = '') {
    for (const [name, value] of parseCookieString(cookieStr)) this.cookies.set(name, value);
  }

  /** Go exportCookies：按名称排序导出 "n=v; n2=v2"（本实现全部 cookie 都属于同一站点） */
  exportCookies(): string {
    return [...this.cookies.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  /** 发请求：自动带 cookie、回收 Set-Cookie（对应 cloudscraper 的 jar 管理） */
  async request(
    method: string,
    requestURL: string,
    contentType = '',
    requestBody = '',
  ): Promise<{ status: number; text: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = { ...SESSION_HEADERS };
      if (contentType !== '') headers['Content-Type'] = contentType;
      const cookieHeader = this.exportCookies();
      if (cookieHeader !== '') headers['Cookie'] = cookieHeader;

      const resp = await fetch(requestURL, {
        method,
        headers,
        body: requestBody !== '' ? requestBody : undefined,
        redirect: 'follow',
        signal: controller.signal,
      });

      // Go collectSetCookies：回收响应里的 Set-Cookie 到 jar
      for (const setCookie of resp.headers.getSetCookie()) {
        const cookiePart = (setCookie.split(';')[0] ?? '').trim();
        const idx = cookiePart.indexOf('=');
        if (idx > 0) this.cookies.set(cookiePart.slice(0, idx), cookiePart.slice(idx + 1));
      }
      return { status: resp.status, text: await resp.text() };
    } finally {
      clearTimeout(timer);
    }
  }
}

// ============ Cookie 与反爬处理 ============

/** Go isBotChallengePage */
function isBotChallengePage(text: string): boolean {
  if (text === '') return false;
  const hasVerifyText =
    text.includes('正在确认你是不是机器人') ||
    text.includes('浏览器安全验证') ||
    text.includes('安全验证') ||
    text.includes('正在进行浏览器计算验证');
  if (!hasVerifyText) return false;
  return (
    CHALLENGE_JSON_PATTERN.test(text) ||
    text.includes('powSolve-') ||
    text.includes('pow.worker-') ||
    text.includes('const jss=') ||
    text.includes('/res/pow')
  );
}

/** Go isLoginShell */
function isLoginShell(text: string): boolean {
  if (text === '') return false;
  return (
    text.includes("_BT.PC.HTML('login')") ||
    text.includes('_BT.PC.HTML("login")') ||
    text.includes("_BT.PC.HTML('nologin')") ||
    text.includes('_BT.PC.HTML("nologin")') ||
    text.includes('未登录，访问受限')
  );
}

/** Go requestWithChallengeRetry：请求遇机器人验证页则求解后重试一次 */
async function requestWithChallengeRetry(
  session: GyingSession,
  method: string,
  requestURL: string,
  contentType = '',
  requestBody = '',
): Promise<{ status: number; text: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await session.request(method, requestURL, contentType, requestBody);
    if (isBotChallengePage(res.text)) {
      if (attempt === 1) throw new Error('重试后仍然进入机器人验证页');
      await solveBotChallenge(session, requestURL, res.text);
      continue; // 求解成功后重试原请求
    }
    return res;
  }
  throw new Error('请求重试次数已耗尽');
}

/** Go solveBotChallenge：页面内嵌 challenge → PoW 或旧版哈希；无内嵌数据则取远程 PoW */
async function solveBotChallenge(session: GyingSession, requestURL: string, body: string): Promise<void> {
  const match = CHALLENGE_JSON_PATTERN.exec(body);
  if (!match) {
    await solveRemotePowChallenge(session, requestURL);
    return;
  }

  let challenge: ChallengePageData;
  try {
    challenge = JSON.parse(match[1] ?? '') as ChallengePageData;
  } catch (err) {
    throw new Error(`解析验证数据失败: ${errText(err)}`);
  }

  if (challenge.id && challenge.n && challenge.x && (challenge.t ?? 0) > 0) {
    await solvePowChallenge(session, requestURL, challenge);
    return;
  }
  await solveLegacyHashChallenge(session, requestURL, challenge);
}

/** Go solveRemotePowChallenge：从 /res/pow 取验证数据并提交 */
async function solveRemotePowChallenge(session: GyingSession, requestURL: string): Promise<void> {
  const powURL = buildPowURL(requestURL);
  const res = await requestWithChallengeRetry(session, 'GET', powURL);
  if (res.status !== 200) throw new Error(`获取PoW验证数据失败: HTTP ${res.status}`);

  let challenge: ChallengePageData;
  try {
    challenge = JSON.parse(res.text) as ChallengePageData;
  } catch (err) {
    throw new Error(`解析PoW验证数据失败: ${errText(err)}`);
  }
  if (!challenge.n || !challenge.x || !((challenge.t ?? 0) > 0)) throw new Error('PoW验证数据无效');

  const y = await computePowResult(challenge);
  await submitChallengeVerification(session, powURL, `y=${y}`);
}

/** Go buildPowURL：改写为 /res/pow，清掉 query/fragment */
function buildPowURL(requestURL: string): string {
  const parsed = new URL(requestURL);
  return `${parsed.protocol}//${parsed.host}/res/pow`;
}

/** Go solvePowChallenge：action=verify&id=..&y=.. */
async function solvePowChallenge(session: GyingSession, requestURL: string, challenge: ChallengePageData): Promise<void> {
  const y = await computePowResult(challenge);
  const form = `action=verify&id=${encodeURIComponent(challenge.id ?? '')}&y=${y}`;
  await submitChallengeVerification(session, requestURL, form);
}

function parseHexBigInt(value: string): bigint | null {
  if (!/^[+]?[0-9a-fA-F]+$/.test(value)) return null;
  try {
    return BigInt(`0x${value}`);
  } catch {
    return null;
  }
}

/** Go computePowResult：y = x，重复 t 次 y = y² mod N；保底 3 秒求解时长 */
async function computePowResult(challenge: ChallengePageData): Promise<string> {
  const modulus = challenge.n ? parseHexBigInt(challenge.n) : null;
  if (modulus === null || modulus <= 0n) throw new Error('PoW验证数据无效: N');
  let y = challenge.x ? parseHexBigInt(challenge.x) : null;
  if (y === null || y < 0n) throw new Error('PoW验证数据无效: x');
  const t = challenge.t ?? 0;
  if (t <= 0) throw new Error('PoW验证数据无效: t');

  const start = Date.now();
  for (let i = 0; i < t; i++) {
    y = (y! * y!) % modulus;
  }
  const elapsed = Date.now() - start;
  if (elapsed < CHALLENGE_MIN_SOLVE_MS) await sleep(CHALLENGE_MIN_SOLVE_MS - elapsed); // Go 同款防时序指纹等待
  return y!.toString(16);
}

/**
 * Go solveLegacyHashChallenge：对每个目标哈希在 nonce∈[0,diff] 内找
 * sha256(nonce + salt) 命中（Go 多 goroutine 分片，这里顺序覆盖同一空间，结果一致）。
 */
async function solveLegacyHashChallenge(
  session: GyingSession,
  requestURL: string,
  challenge: ChallengePageData,
): Promise<void> {
  const targets = challenge.challenge ?? [];
  if (!challenge.id || !challenge.salt || !((challenge.diff ?? 0) > 0) || targets.length === 0) {
    throw new Error('验证数据无效');
  }

  const salt = challenge.salt;
  const remaining = new Map<string, number[]>();
  const nonces: number[] = new Array(targets.length).fill(0);
  targets.forEach((target, idx) => {
    const hash = target.toLowerCase();
    const arr = remaining.get(hash) ?? [];
    arr.push(idx);
    remaining.set(hash, arr);
  });

  const targetsLen = targets.length;
  let solved = 0;
  for (let nonce = 0; nonce <= (challenge.diff ?? 0); nonce++) {
    if (solved >= targetsLen) break;
    const hash = createHash('sha256').update(`${nonce}${salt}`).digest('hex');
    const indexes = remaining.get(hash);
    if (indexes && indexes.length > 0) {
      nonces[indexes[0]!] = nonce;
      solved++;
      if (indexes.length === 1) remaining.delete(hash);
      else remaining.set(hash, indexes.slice(1));
      if (solved >= targetsLen) break;
    }
  }

  if (solved !== targetsLen && remaining.size > 0) throw new Error('无法完成机器人验证');

  // url.Values.Encode：键按字典序，nonce[] 重复键 → nonce%5B%5D=（QueryEscape 转义方括号）
  const parts = ['action=verify', `id=${encodeURIComponent(challenge.id)}`];
  for (const nonce of nonces) parts.push(`nonce%5B%5D=${nonce}`);
  await submitChallengeVerification(session, requestURL, parts.join('&'));
}

/** Go submitChallengeVerification：提交验证表单并校验结果 */
async function submitChallengeVerification(session: GyingSession, requestURL: string, form: string): Promise<void> {
  const res = await session.request('POST', requestURL, 'application/x-www-form-urlencoded', form);
  if (isBotChallengePage(res.text)) throw new Error('机器人验证出现循环');

  let verifyResp: { success?: boolean; msg?: string };
  try {
    verifyResp = JSON.parse(res.text) as { success?: boolean; msg?: string };
  } catch (err) {
    throw new Error(`解析验证响应失败: ${errText(err)}`);
  }
  if (!verifyResp.success) {
    throw new Error(verifyResp.msg ? `机器人验证失败: ${verifyResp.msg}` : '机器人验证失败');
  }
}

// ============ 登录逻辑 ============

/**
 * Go doLogin 三步登录：
 * 1. GET 登录页（取 PHPSESSID）
 * 2. POST /user/login（取 BT_auth 等认证 cookie，code==200 判定成功）
 * 3. GET 详情页 /mv/wkMn（触发 vrg_sc 等防爬 cookie）
 */
async function doLogin(username: string, password: string): Promise<{ session: GyingSession; cookie: string }> {
  const session = new GyingSession();

  // 步骤1：GET 登录页
  let pageRes: { status: number; text: string };
  try {
    pageRes = await requestWithChallengeRetry(session, 'GET', getLoginPageURL());
  } catch (err) {
    throw new Error(`访问登录页面失败: ${errText(err)}`);
  }
  if (pageRes.status !== 200) throw new Error(`访问登录页面失败: HTTP ${pageRes.status}`);

  // 步骤2：POST 登录
  const postData = `code=&siteid=1&dosubmit=1&cookietime=10506240&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
  let loginRes: { status: number; text: string };
  try {
    loginRes = await requestWithChallengeRetry(session, 'POST', getLoginAPIURL(), 'application/x-www-form-urlencoded', postData);
  } catch (err) {
    throw new Error(`登录POST请求失败: ${errText(err)}`);
  }

  let loginResp: Record<string, unknown>;
  try {
    loginResp = JSON.parse(loginRes.text) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`JSON解析失败: ${errText(err)}, 响应内容: ${loginRes.text}`);
  }

  // code 字段兼容 int/float/string（Go 同款多类型解析）
  let codeValue: number;
  const codeInterface = loginResp['code'];
  if (typeof codeInterface === 'number' && Number.isFinite(codeInterface)) {
    codeValue = Math.trunc(codeInterface);
  } else if (typeof codeInterface === 'string' && codeInterface.trim() !== '' && !Number.isNaN(Number(codeInterface))) {
    codeValue = Math.trunc(Number(codeInterface));
  } else {
    throw new Error(`无法解析code字段，类型: ${codeInterface === null ? 'null' : typeof codeInterface}, 值: ${String(codeInterface)}`);
  }

  if (codeValue !== 200) throw new Error(`登录失败: code=${codeValue}, 响应=${loginRes.text}`);

  // 步骤3：GET 详情页收集防爬 cookie（失败不影响登录）
  try {
    await requestWithChallengeRetry(session, 'GET', getWarmupDetailURL());
  } catch {
    /* Go 同样忽略该步失败 */
  }

  const cookie = session.exportCookies();
  return { session, cookie };
}

/** Go reloginUser：解密密码重新登录并更新会话/用户 */
async function reloginUser(user: UserRecord): Promise<void> {
  let password: string;
  try {
    password = decryptPassword(user.encryptedPassword);
  } catch (err) {
    throw new Error(`解密密码失败: ${errText(err)}`);
  }

  const { session, cookie } = await doLogin(user.username, password);
  sessions.set(user.hash, session);

  user.cookie = cookie;
  user.loginAt = new Date();
  user.expireAt = addMonthsUTC(new Date(), 4); // Go AddDate(0,4,0)：121 天有效期
  user.status = 'active';
  try {
    await saveUser(user);
  } catch (err) {
    console.error(`[Gying] 重新登录后保存用户失败: ${errText(err)}`);
  }
}

/** Go syncUserCookiesFromScraper：搜索后把会话里的最新 cookie 回写到用户档案 */
async function syncUserCookiesFromSession(user: UserRecord, session: GyingSession): Promise<void> {
  const cookieStr = session.exportCookies();
  if (cookieStr === '' || cookieStr === user.cookie) return;
  user.cookie = cookieStr;
  user.lastAccessAt = new Date();
  await saveUser(user);
}

// ============ 搜索逻辑 ============

/** Go executeSearchTasks：并发用各账号会话搜索，按 unique_id 去重 */
async function executeSearchTasks(activeUsers: UserRecord[], keyword: string): Promise<SearchResult[]> {
  const settled = await Promise.allSettled(
    activeUsers.map(async (user) => {
      // 会话不存在时用已保存 cookie 惰性恢复（Go 同款兜底；失效则 403 → 重登）
      let session = sessions.get(user.hash);
      if (!session) {
        session = new GyingSession(user.cookie);
        sessions.set(user.hash, session);
      }
      return searchWithScraperWithRetry(keyword, session, user);
    }),
  );

  const allResults: SearchResult[] = [];
  for (const s of settled) {
    if (s.status === 'fulfilled') allResults.push(...s.value);
  }
  return deduplicateResults(allResults);
}

/** Go searchWithScraperWithRetry：403 自动重新登录后重试一次 */
async function searchWithScraperWithRetry(
  keyword: string,
  session: GyingSession,
  user: UserRecord,
): Promise<SearchResult[]> {
  let results: SearchResult[];
  try {
    results = await searchWithScraper(keyword, session);
  } catch (err) {
    if (!is403Error(err)) throw err;

    // 403：重新登录后用新会话重试
    try {
      await reloginUser(user);
    } catch (reloginErr) {
      throw new Error(`403错误且重新登录失败: ${errText(reloginErr)}`);
    }
    const newSession = sessions.get(user.hash);
    if (!newSession) throw new Error('重新登录后未找到scraper实例');
    try {
      results = await searchWithScraper(keyword, newSession);
    } catch (err2) {
      throw new Error(`重新登录后搜索仍然失败: ${errText(err2)}`);
    }
    try {
      await syncUserCookiesFromSession(user, newSession);
    } catch {
      /* Go 仅 DebugLog 记录 */
    }
    return results;
  }

  // 成功后同步 cookie（失败仅记录）
  try {
    await syncUserCookiesFromSession(user, session);
  } catch {
    /* Go 仅 DebugLog 记录 */
  }
  return results;
}

/** Go searchWithScraper：搜索页 → _obj.search JSON → 并发详情 */
async function searchWithScraper(keyword: string, session: GyingSession): Promise<SearchResult[]> {
  const searchURL = `${getBaseURL()}/search?q=${encodeURIComponent(keyword)}&type=0&mode=2`;
  const res = await requestWithChallengeRetry(session, 'GET', searchURL);

  if (res.status === 403) throw new Error('HTTP 403 Forbidden - 可能需要重新登录');

  const match = SEARCH_DATA_PATTERN.exec(res.text);
  if (isLoginShell(res.text)) throw new Error('HTTP 403 Forbidden - 需要重新登录');
  if (!match) throw new Error('未找到搜索结果数据');

  let searchData: SearchData;
  try {
    searchData = JSON.parse(match[1] ?? '') as SearchData;
  } catch (err) {
    throw new Error(`解析搜索数据失败: ${errText(err)}`);
  }

  // 刷新防爬 cookies（访问详情页触发 vrg_sc 等；失败忽略）
  try {
    await requestWithChallengeRetry(session, 'GET', getWarmupDetailURL());
  } catch {
    /* 忽略 */
  }

  return fetchAllDetails(searchData, session, keyword);
}

/** Go fetchAllDetails：并发抓详情（信号量 50），任一详情 403 则整体抛错触发重登 */
async function fetchAllDetails(searchData: SearchData, session: GyingSession, keyword: string): Promise<SearchResult[]> {
  const items = searchData.l?.i ?? [];
  const titles = searchData.l?.title ?? [];
  const keywordLower = keyword.toLowerCase();
  const results: SearchResult[] = [];

  let has403 = false;
  let first403: Error | null = null;
  const limit = createLimiter(MAX_CONCURRENT_DETAILS);

  await Promise.all(
    items.map(async (item, index) => {
      // 已遇到 403 则放弃剩余任务
      if (has403) return;
      // 标题数组越界或标题不含关键词 → 跳过
      if (index >= titles.length) return;
      const title = titles[index] ?? '';
      if (!title.toLowerCase().includes(keywordLower)) return;

      try {
        const detail = await fetchDetail(item ?? '', searchData.l?.d?.[index] ?? '', session);
        const result = buildResult(detail, searchData, index);
        if (result.title !== '' && result.links.length > 0) results.push(result);
      } catch (err) {
        if (is403Error(err) && !has403) {
          has403 = true;
          first403 = err instanceof Error ? err : new Error(errText(err));
        }
      }
    }),
  );

  if (first403 !== null) throw first403;
  return results;
}

/** Go fetchDetail：GET /res/downurl/<type>/<id> 并校验 code */
async function fetchDetail(resourceID: string, resourceType: string, session: GyingSession): Promise<DetailData> {
  const detailURL = `${getBaseURL()}/res/downurl/${resourceType}/${resourceID}`;
  const res = await requestWithChallengeRetry(session, 'GET', detailURL);

  if (res.status === 403) throw new Error('HTTP 403 Forbidden');
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  if (isLoginShell(res.text)) throw new Error('HTTP 403 Forbidden');

  let detail: DetailData;
  try {
    detail = JSON.parse(res.text) as DetailData;
  } catch (err) {
    throw err instanceof Error ? err : new Error(errText(err));
  }
  if (detail.code === 403) throw new Error('详情接口返回 code=403，登录状态可能已失效');
  return detail;
}

/** Go deduplicateResults：按 unique_id 去重 */
function deduplicateResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const deduplicated: SearchResult[] = [];
  for (const result of results) {
    if (seen.has(result.unique_id)) continue;
    seen.add(result.unique_id);
    deduplicated.push(result);
  }
  return deduplicated;
}

// ============ 时间解析（Go parseUpdateTime / parseRelativeTime / collectDetailTimes） ============

/** Go Truncate(24h)：截断到 UTC 日界 */
function truncateDay(d: Date): Date {
  return new Date(Math.floor(d.getTime() / 86_400_000) * 86_400_000);
}

/** Go AddDate：按 UTC 年月日字段做日历运算（JS Date.UTC 与 Go time.Date 的进位规则一致） */
function calendarShift(d: Date, years: number, months: number, days: number): Date {
  return new Date(
    Date.UTC(
      d.getUTCFullYear() + years,
      d.getUTCMonth() + months,
      d.getUTCDate() + days,
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
    ),
  );
}

function addMonthsUTC(d: Date, months: number): Date {
  return calendarShift(d, 0, months, 0);
}

/** Go parseRelativeTime：今天/昨天/N天前/N月前/N年前 → 截断到日；解析失败返回 null */
function parseRelativeTime(timeStr: string, baseTime: Date): Date | null {
  const str = timeStr.trim();
  if (str === '') return null;

  switch (str) {
    case '今天':
      return truncateDay(baseTime);
    case '昨天':
      return truncateDay(calendarShift(baseTime, 0, 0, -1));
    default: {
      if (str.endsWith('天前')) {
        const days = parseInt(str.slice(0, -2), 10);
        if (!Number.isNaN(days) && days >= 0) return truncateDay(calendarShift(baseTime, 0, 0, -days));
      } else if (str.endsWith('月前')) {
        const months = parseInt(str.slice(0, -2), 10);
        if (!Number.isNaN(months) && months >= 0) return truncateDay(calendarShift(baseTime, 0, -months, 0));
      } else if (str.endsWith('年前')) {
        const years = parseInt(str.slice(0, -2), 10);
        if (!Number.isNaN(years) && years >= 0) return truncateDay(calendarShift(baseTime, -years, 0, 0));
      }
      return null;
    }
  }
}

/** Go parseLinkTime：解析失败返回零时间（此处用 null 表示，序列化时省略字段） */
function parseLinkTime(timeStr: string, baseTime: Date): Date | null {
  return parseRelativeTime(timeStr, baseTime);
}

/** Go parseUpdateTime：取相对时间数组里最新的一个；全失败返回当前时间 */
function parseUpdateTime(timeStrs: string[]): Date {
  if (timeStrs.length === 0) return new Date();

  const now = new Date();
  let latestTime: Date | null = null;
  for (const timeStr of timeStrs) {
    if (timeStr === '') continue;
    const parsed = parseRelativeTime(timeStr, now);
    if (parsed !== null && (latestTime === null || parsed.getTime() > latestTime.getTime())) {
      latestTime = parsed;
    }
  }
  return latestTime ?? new Date();
}

/** Go collectDetailTimes：网盘分享时间 + 磁力更新时间 */
function collectDetailTimes(detail: DetailData): string[] {
  return [...(detail.panlist?.time ?? []), ...(detail.downlist?.list?.n ?? [])];
}

// ============ 结果构建与链接提取（Go buildResult / extractLinks 系列） ============

/** Go safeString */
function safeString(items: string[] | undefined, index: number): string {
  if (index < 0 || index >= (items?.length ?? 0)) return '';
  return (items?.[index] ?? '').trim();
}

/** Go safeInt */
function safeInt(items: number[] | undefined, index: number, fallback: number): number {
  if (index < 0 || index >= (items?.length ?? 0)) return fallback;
  return items?.[index] ?? fallback;
}

/** Go buildResult */
function buildResult(detail: DetailData | null, searchData: SearchData, index: number): SearchResult {
  const titles = searchData.l?.title ?? [];
  if (index >= titles.length) {
    return { message_id: '', unique_id: '', channel: '', datetime: '', title: '', content: '', links: [] };
  }

  let title = titles[index] ?? '';
  const resourceType = searchData.l?.d?.[index] ?? '';
  const resourceID = searchData.l?.i?.[index] ?? '';

  // 年份拼进标题：遮天（2023）
  const years = searchData.l?.year ?? [];
  let year = 0;
  if (index < years.length && (years[index] ?? 0) > 0) {
    year = years[index]!;
    title = `${title}（${year}）`;
  }

  // 描述：信息 | 导演 | 主演
  const contentParts: string[] = [];
  const info = safeString(searchData.l?.info, index);
  if (info !== '') contentParts.push(info);
  const daoyan = safeString(searchData.l?.daoyan, index);
  if (daoyan !== '') contentParts.push(`导演: ${daoyan}`);
  const zhuyan = safeString(searchData.l?.zhuyan, index);
  if (zhuyan !== '') contentParts.push(`主演: ${zhuyan}`);

  // 网盘 + 磁力链接
  const links = extractLinks(detail, title);

  const tags: string[] = [];
  if (year > 0) tags.push(String(year));

  const datetime = detail === null ? new Date() : parseUpdateTime(collectDetailTimes(detail));

  return {
    message_id: '',
    unique_id: `gying-${resourceType}-${resourceID}`,
    channel: '', // 插件结果 Channel 为空
    datetime: datetime.toISOString(),
    title,
    content: contentParts.join(' | '),
    links,
    tags,
  };
}

/** Go extractLinks */
function extractLinks(detail: DetailData | null, resultTitle: string): Link[] {
  if (detail === null) return [];
  const now = new Date();
  const seen = new Set<string>();
  const links: Link[] = [];
  links.push(...extractPanLinks(detail, resultTitle, now, seen));
  links.push(...extractMagnetLinks(detail, resultTitle, now, seen));
  return links;
}

/** Go extractPanLinks */
function extractPanLinks(detail: DetailData, resultTitle: string, now: Date, seen: Set<string>): Link[] {
  const urls = detail.panlist?.url ?? [];
  const links: Link[] = [];

  for (let i = 0; i < urls.length; i++) {
    const rawURL = safeString(urls, i);
    const typeCode = safeInt(detail.panlist?.type, i, -1);
    const typeName = getPanTypeName(detail, typeCode);

    const linkURL = normalizePanURL(rawURL, typeCode, typeName);
    const linkType = determineLinkType(linkURL, typeCode, typeName);
    if (linkURL === '' || linkType === 'others') continue;

    const seenKey = `${linkType}:${linkURL.toLowerCase()}`;
    if (seen.has(seenKey)) continue;
    seen.add(seenKey);

    const linkTime = parseLinkTime(safeString(detail.panlist?.time, i), now);
    const resourceName = safeString(detail.panlist?.name, i);
    const password = extractPassword(rawURL, safeString(detail.panlist?.p, i));

    links.push({
      type: linkType,
      url: linkURL,
      password,
      ...(linkTime !== null ? { datetime: linkTime.toISOString() } : {}), // Go 零时间此处省略
      work_title: buildLinkWorkTitle(resultTitle, resourceName),
    });
  }
  return links;
}

/** Go extractMagnetLinks：从 downlist 手动拼磁力链接 */
function extractMagnetLinks(detail: DetailData, resultTitle: string, now: Date, seen: Set<string>): Link[] {
  const hashes = detail.downlist?.list?.m ?? [];
  if (hashes.length === 0) return [];

  const links: Link[] = [];
  for (let i = 0; i < hashes.length; i++) {
    const infoHash = (hashes[i] ?? '').trim().toLowerCase();
    if (!MAGNET_HASH_REGEX.test(infoHash)) continue;

    const seenKey = `magnet:${infoHash}`;
    if (seen.has(seenKey)) continue;
    seen.add(seenKey);

    let resourceName = safeString(detail.downlist?.list?.t, i);
    if (resourceName === '') resourceName = safeString(detail.downlist?.list?.s, i);

    const magnetURL = buildMagnetURL(infoHash, resourceName);
    if (magnetURL === '') continue;

    const linkTime = parseLinkTime(safeString(detail.downlist?.list?.n, i), now);
    links.push({
      type: 'magnet',
      url: magnetURL,
      password: '',
      ...(linkTime !== null ? { datetime: linkTime.toISOString() } : {}),
      work_title: buildLinkWorkTitle(resultTitle, resourceName),
    });
  }
  return links;
}

/** Go getPanTypeName：typeCode 越界返回空 */
function getPanTypeName(detail: DetailData, typeCode: number): string {
  const tnames = detail.panlist?.tname ?? [];
  if (typeCode < 0 || typeCode >= tnames.length) return '';
  return (tnames[typeCode] ?? '').trim();
}

/** Go determineLinkType：先看 URL，再看类型编码和名称兜底 */
function determineLinkType(linkURL: string, typeCode: number, typeName: string): string {
  const lowerURL = linkURL.trim().toLowerCase();
  const lowerTypeName = typeName.trim().toLowerCase();

  if (lowerURL.startsWith('magnet:?xt=urn:btih:')) return 'magnet';
  if (lowerURL.includes('pan.quark.cn')) return 'quark';
  if (lowerURL.includes('drive.uc.cn')) return 'uc';
  if (lowerURL.includes('pan.baidu.com')) return 'baidu';
  if (lowerURL.includes('aliyundrive.com') || lowerURL.includes('alipan.com')) return 'aliyun';
  if (lowerURL.includes('pan.xunlei.com')) return 'xunlei';
  if (lowerURL.includes('cloud.189.cn') || lowerURL.includes('content.21cn.com') || lowerURL.includes('tianyi.cloud')) return 'tianyi';
  if (lowerURL.includes('yun.139.com') || lowerURL.includes('caiyun.139.com') || lowerURL.includes('feixin.10086.cn')) return 'mobile';
  if (lowerURL.includes('115.com') || lowerURL.includes('115cdn.com') || lowerURL.includes('anxia.com')) return '115';
  if (
    lowerURL.includes('123684.com') ||
    lowerURL.includes('123685.com') ||
    lowerURL.includes('123865.com') ||
    lowerURL.includes('123912.com') ||
    lowerURL.includes('123pan.com') ||
    lowerURL.includes('123pan.cn') ||
    lowerURL.includes('123592.com')
  ) {
    return '123';
  }

  const mappedType = GYING_PAN_TYPE_MAP[typeCode];
  if (mappedType !== undefined) return mappedType;

  if (lowerTypeName.includes('天翼')) return 'tianyi';
  if (lowerTypeName.includes('移动') || lowerTypeName.includes('彩云')) return 'mobile';
  if (lowerTypeName.includes('百度')) return 'baidu';
  if (lowerTypeName.includes('夸克')) return 'quark';
  if (lowerTypeName.includes('迅雷')) return 'xunlei';
  if (lowerTypeName.includes('阿里')) return 'aliyun';
  if (lowerTypeName.includes('115')) return '115';
  if (lowerTypeName.includes('123')) return '123';
  if (lowerTypeName.includes('uc')) return 'uc';
  return 'others';
}

/** Go normalizePanURL：去掉「（访问码:…）」说明后按类型提取干净链接 */
function normalizePanURL(rawURL: string, typeCode: number, typeName: string): string {
  let url = rawURL.trim().replace(ACCESS_CODE_BLOCK_REGEX, '').trim();
  const linkType = determineLinkType(url, typeCode, typeName);

  switch (linkType) {
    case 'baidu':
      return url.match(BAIDU_LINK_REGEX)?.[0] ?? '';
    case 'quark':
      return url.match(QUARK_LINK_REGEX)?.[0] ?? '';
    case 'aliyun':
      return url.match(ALIYUN_LINK_REGEX)?.[0] ?? '';
    case 'xunlei':
      return url.match(XUNLEI_LINK_REGEX)?.[0] ?? '';
    case 'tianyi': {
      const code = extractTianyiShareCode(url);
      if (code !== '') return `https://cloud.189.cn/t/${code}`;
      const tMatch = url.match(TIANYI_LINK_REGEX)?.[0];
      if (tMatch !== undefined) return tMatch;
      return url.match(TIANYI_CLOUD_REGEX)?.[0] ?? '';
    }
    case 'mobile': {
      const yunMatch = url.match(MOBILE_YUN_LINK_REGEX)?.[0];
      if (yunMatch !== undefined) return yunMatch;
      const caiyunMatch = url.match(MOBILE_CAIYUN_LINK_REGEX)?.[0];
      if (caiyunMatch !== undefined) return caiyunMatch;
      return url.match(MOBILE_FEIXIN_LINK_REGEX)?.[0] ?? '';
    }
    case '115':
      return url.match(LINK_115_REGEX)?.[0] ?? '';
    case '123':
      return url.match(LINK_123_REGEX)?.[0] ?? '';
    case 'uc':
      return url.match(UC_LINK_REGEX)?.[0] ?? '';
    default:
      return '';
  }
}

/** Go extractTianyiShareCode */
function extractTianyiShareCode(rawURL: string): string {
  const match = TIANYI_SHARE_CODE_REGEX.exec(rawURL);
  return match ? (match[1] ?? '').trim() : '';
}

/** Go extractPassword：先从 URL/说明提取，再退回 panlist 提取码字段 */
function extractPassword(rawText: string, fallback: string): string {
  const fromText = extractPasswordFromText(rawText);
  if (fromText !== '') return fromText;
  return normalizePassword(fallback);
}

/** Go extractPasswordFromText */
function extractPasswordFromText(text: string): string {
  for (const pattern of INLINE_PASSWORD_PATTERNS) {
    const match = pattern.exec(text);
    if (match && match.length > 1) return normalizePassword(match[1] ?? '');
  }
  return '';
}

/** Go normalizePassword：清洗提取码（无密码语义归空、长度 4-8 校验） */
function normalizePassword(raw: string): string {
  let password = raw.trim();
  if (password === '') return '';

  password = password.replace(/^[.。!！,，;；:：#*· ]+|[.。!！,，;；:：#*· ]+$/gu, '');
  const lower = password.toLowerCase();
  if (lower === '无提取码' || lower.includes('无密码') || password.includes('无需')) return '';

  if (EXACT_PASSWORD_REGEX.test(password)) return password;

  for (const pattern of INLINE_PASSWORD_PATTERNS) {
    const match = pattern.exec(password);
    if (match && match.length > 1) {
      const candidate = (match[1] ?? '').trim();
      if (EXACT_PASSWORD_REGEX.test(candidate)) return candidate;
    }
  }
  return '';
}

/** Go buildMagnetURL：magnet:?xt=urn:btih:<hash>[&dn=<名称>] */
function buildMagnetURL(infoHash: string, resourceName: string): string {
  const hash = infoHash.trim().toLowerCase();
  if (!MAGNET_HASH_REGEX.test(hash)) return '';
  let magnetURL = `magnet:?xt=urn:btih:${hash}`;
  const name = resourceName.trim();
  if (name !== '') magnetURL += `&dn=${encodeURIComponent(name)}`;
  return magnetURL;
}

/** Go buildLinkWorkTitle：资源名包含结果标题时用资源名，否则「标题 - 资源名」 */
function buildLinkWorkTitle(resultTitle: string, resourceName: string): string {
  const rTitle = resultTitle.trim();
  const rName = resourceName.trim();

  if (rName === '') return rTitle;

  const resultKey = normalizeTitleForCompare(rTitle);
  const resourceKey = normalizeTitleForCompare(rName);
  if (resultKey !== '' && resourceKey.includes(resultKey)) return rName;

  if (rTitle === '') return rName;
  return `${rTitle} - ${rName}`;
}

/** Go normalizeTitleForCompare：去年份后缀、小写、去掉分隔与括号符号 */
function normalizeTitleForCompare(title: string): string {
  return title
    .replace(YEAR_SUFFIX_REGEX, '')
    .trim()
    .toLowerCase()
    .replace(/[ \-_.：:（）()[\]【】/]/gu, '');
}

// ============ HTTP 路由处理（Go RegisterWebRoutes → webRoutes） ============

/** 读取请求体（node:http 原生流拼 Buffer） */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Go respondSuccess（HTTP 200，body {success:true,...}） */
function respondSuccess(res: ServerResponse, message: string, data: unknown): void {
  const body = JSON.stringify({ success: true, message, data });
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

/** Go respondError */
function respondError(res: ServerResponse, message: string): void {
  const body = JSON.stringify({ success: false, message, data: null });
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

/** Go handleManagePage（GET /gying/:param）：hash 出管理页，用户名 302 跳 hash */
async function handleManagePage(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
  const param = params['param'] ?? '';

  if (param.length === 64 && isHexString(param)) {
    const html = HTML_TEMPLATE.split('HASH_PLACEHOLDER').join(param);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } else {
    res.writeHead(302, { Location: `/gying/${generateHash(param)}` });
    res.end();
  }
}

/** Go handleManagePagePOST（POST /gying/:param）：action 分发 */
async function handleManagePagePOST(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
  const hash = params['param'] ?? '';

  let reqData: Record<string, unknown> | null;
  try {
    reqData = JSON.parse(await readBody(req)) as Record<string, unknown> | null;
  } catch (err) {
    respondError(res, `无效的请求格式: ${errText(err)}`);
    return;
  }

  const action = reqData?.['action'];
  if (typeof action !== 'string' || action === '') {
    respondError(res, '缺少action字段');
    return;
  }
  const body = reqData ?? {};

  try {
    await ensureInitialized();
    switch (action) {
      case 'get_status':
        await handleGetStatus(res, hash);
        return;
      case 'get_config':
        handleGetConfig(res);
        return;
      case 'login':
        await handleLogin(res, hash, body);
        return;
      case 'logout':
        await handleLogout(res, hash);
        return;
      case 'update_config':
        await handleUpdateConfig(res, body);
        return;
      case 'test_search':
        await handleTestSearch(res, hash, body);
        return;
      default:
        respondError(res, `未知的操作类型: ${action}`);
    }
  } catch (err) {
    // 各 handler 落盘失败等异常统一 500（Go 版由 gin recovery 兜底）
    console.error(`[Gying] 管理接口 ${action} 异常: ${err instanceof Error ? err.stack : errText(err)}`);
    if (!res.headersSent) {
      const e = JSON.stringify({ success: false, message: `内部错误: ${errText(err)}`, data: null });
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(e);
    } else {
      res.end();
    }
  }
}

/** Go handleGetStatus */
async function handleGetStatus(res: ServerResponse, hash: string): Promise<void> {
  let user = users.get(hash);
  const now = new Date();
  if (user === undefined) {
    user = { hash, username: '', encryptedPassword: '', cookie: '', status: 'pending', createdAt: now, loginAt: null, expireAt: null, lastAccessAt: now };
    await saveUser(user);
  } else {
    user.lastAccessAt = now;
    await saveUser(user);
  }

  const loggedIn = user.status === 'active' && user.cookie !== '';

  let expiresInDays = 0;
  if (user.expireAt !== null) {
    expiresInDays = Math.trunc((user.expireAt.getTime() - Date.now()) / 3_600_000 / 24);
    if (expiresInDays < 0) expiresInDays = 0;
  }

  respondSuccess(res, '获取成功', {
    hash,
    logged_in: loggedIn,
    status: user.status,
    username: user.username,
    login_time: formatLocalOrZero(user.loginAt),
    expire_time: formatLocalOrZero(user.expireAt),
    expires_in_days: expiresInDays,
  });
}

/** Go handleGetConfig */
function handleGetConfig(res: ServerResponse): void {
  respondSuccess(res, '获取成功', { base_url: getBaseURL() });
}

/** Go handleUpdateConfig */
async function handleUpdateConfig(res: ServerResponse, reqData: Record<string, unknown>): Promise<void> {
  const baseURL = typeof reqData['base_url'] === 'string' ? reqData['base_url'] : '';
  if (baseURL.trim() === '') {
    respondError(res, '缺少站点地址');
    return;
  }

  let savedBaseURL: string;
  try {
    savedBaseURL = await updateBaseURL(baseURL);
  } catch (err) {
    respondError(res, `保存站点地址失败: ${errText(err)}`);
    return;
  }

  respondSuccess(res, '站点地址已保存，当前登录状态已清空，请重新登录', { base_url: savedBaseURL });
}

/** Go handleLogin */
async function handleLogin(res: ServerResponse, hash: string, reqData: Record<string, unknown>): Promise<void> {
  const username = typeof reqData['username'] === 'string' ? reqData['username'] : '';
  const password = typeof reqData['password'] === 'string' ? reqData['password'] : '';
  if (username === '' || password === '') {
    respondError(res, '缺少用户名或密码');
    return;
  }

  const { session, cookie } = await doLogin(username, password);
  sessions.set(hash, session);

  const encryptedPassword = encryptPassword(password);
  const now = new Date();
  const existing = users.get(hash);
  const user: UserRecord = {
    hash,
    username,
    encryptedPassword,
    cookie,
    status: 'active',
    createdAt: existing?.createdAt ?? now, // Go 对已有用户会把 CreatedAt 写成零时间，此处保留原值
    loginAt: now,
    expireAt: addMonthsUTC(now, 4), // 121 天有效期
    lastAccessAt: now,
  };

  try {
    await saveUser(user);
  } catch (err) {
    respondError(res, `保存失败: ${errText(err)}`);
    return;
  }

  respondSuccess(res, '登录成功', { status: 'active', username: user.username });
}

/** Go handleLogout */
async function handleLogout(res: ServerResponse, hash: string): Promise<void> {
  const user = users.get(hash);
  if (user === undefined) {
    respondError(res, '用户不存在');
    return;
  }

  user.cookie = '';
  user.status = 'pending';
  try {
    await saveUser(user);
  } catch {
    respondError(res, '退出失败');
    return;
  }

  respondSuccess(res, '已退出登录', { status: 'pending' });
}

/** Go handleTestSearch：管理页测试搜索（限 10 条） */
async function handleTestSearch(res: ServerResponse, hash: string, reqData: Record<string, unknown>): Promise<void> {
  const keyword = typeof reqData['keyword'] === 'string' ? reqData['keyword'] : '';
  if (keyword === '') {
    respondError(res, '缺少keyword字段');
    return;
  }

  const user = users.get(hash);
  if (user === undefined || user.cookie === '') {
    respondError(res, '请先登录');
    return;
  }

  const session = sessions.get(hash);
  if (session === undefined) {
    respondError(res, '用户scraper实例不存在，请重新登录');
    return;
  }

  let results: SearchResult[];
  try {
    results = await searchWithScraperWithRetry(keyword, session, user);
  } catch (err) {
    respondError(res, `搜索失败: ${errText(err)}`);
    return;
  }

  const maxResults = 10;
  const limited = results.length > maxResults ? results.slice(0, maxResults) : results;

  const frontendResults = limited.map((r) => ({
    title: r.title,
    links: r.links.map((link) => ({
      type: link.type,
      url: link.url,
      password: link.password,
      work_title: link.work_title ?? '',
    })),
  }));

  respondSuccess(res, `找到 ${frontendResults.length} 条结果`, {
    keyword,
    total_results: frontendResults.length,
    results: frontendResults,
  });
}

// ============ 插件定义（Go init() + RegisterGlobalPlugin） ============

export const gying = definePlugin({
  name: 'gying',
  priority: 3, // Go NewBaseAsyncPlugin("gying", 3)
  skipServiceFilter: false, // Go 未跳过 Service 层过滤
  // 纯搜索实现：框架负责超时/缓存/后台补全。
  // Go 的 ext.refresh 用于绕过插件自身缓存；本插件无自建缓存，该键由框架缓存语义承接（原样透传）。
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    await ensureInitialized();

    const activeUsers = getActiveUsers();
    if (activeUsers.length === 0) return [];

    // 超出上限时取最近访问的 MaxConcurrentUsers 个（Go 按 LastAccessAt 降序截取）
    let selected = activeUsers;
    if (selected.length > MAX_CONCURRENT_USERS) {
      selected = [...selected]
        .sort((a, b) => (b.lastAccessAt?.getTime() ?? 0) - (a.lastAccessAt?.getTime() ?? 0))
        .slice(0, MAX_CONCURRENT_USERS);
    }

    return executeSearchTasks(selected, keyword);
  },
  webRoutes: [
    { method: 'GET', path: '/gying/:param', handler: handleManagePage },
    { method: 'POST', path: '/gying/:param', handler: handleManagePagePOST },
  ],
});
