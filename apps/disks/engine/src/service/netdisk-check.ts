// 各网盘分享链接私有 API 探测 —— pansou Go service/check_service.go 的 TS 复刻并经真实链接实测校准
// 设计约定（与 check.ts 的分层降级契约）：
// - 返回 { state: 'ok'|'bad'|'locked', summary } 表示接口给出确定判定；
// - 返回 null 表示接口不可用（网络错误 / 超时 / 风控 / 响应无法解析 / 无法判定），
//   调用方必须降级到通用页面探测，**接口调用失败绝不等于链接失效**。
// 实测基准（2026-09，样例来自公开分享页）：
// - 夸克  drive-h.quark.cn   sharepage/token        真链 code=0 / 假链 41006 分享不存在
// - UC    pc-api.uc.cn       sharepage/token        真链 code=0 / 假链 41006（pr 必须为 UCBrowser）
// - 百度  pan.baidu.com      share/verify+list      错码 errno=-9 / 假链 errno=105 / 正确码 randsk→list=0
// - 阿里  api.aliyundrive.com get_share_by_anonymous 假链 NotFound.ShareLink / 取消 ShareLink.Cancelled
// - 115   115cdn.com         webapi/share/snap      真链 state=true / 错码 4100008 / 假链 990002 / 已取消 4100010
// - 123   www.123684.com     b/api/share/info       真链 code=0 / 假链 5104、5107
// - 天翼  cloud.189.cn       getShareInfoByCodeV2  真链 shareVO XML / 假链 error XML ShareInfoNotFound
// - 迅雷  api-pan.xunlei.com drive/v1/share         真链 share_status=OK / 错码 PASS_CODE_ERROR / 假链 invalid_argument
// - 移动  share-kd-njs.yun.139.com getOutLinkInfoV6 真链 resultCode=0 / 假链 200000727 外链不存在（AES-128-CBC）
// - pikpak / 光雅快传：无公开匿名接口，直接降级页面探测

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** 私有 API 判定结果（null = 降级页面探测） */
export interface NetdiskApiVerdict {
  state: 'ok' | 'bad' | 'locked';
  summary: string;
}

interface ApiFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** 每个探测请求的超时，3-5 秒量级 */
  timeoutMs?: number;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const API_TIMEOUT_MS = 5_000;
const MAX_API_BODY_BYTES = 64 * 1024;

const BAD_WORDS = ['不存在', '失效', '违规', '过期', '取消', '已删除', '删除', 'not found', 'forbidden'];
const LOCK_WORDS = ['提取码', '访问码', '请输入密码', '密码错误', 'receive_code'];

function containsAny(text: string, words: string[]): boolean {
  const lower = text.toLowerCase();
  return words.some((w) => lower.includes(w.toLowerCase()));
}

/** 接口请求封装：自带 UA/超时/响应体限额，任何异常都归一化为 null（降级信号） */
async function apiFetch(
  url: string,
  opts: ApiFetchOptions = {},
): Promise<{ status: number; text: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? API_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: { 'User-Agent': UA, ...opts.headers },
      redirect: 'follow',
      body: opts.body,
      signal: controller.signal,
    });
    const reader = resp.body?.getReader();
    if (!reader) return { status: resp.status, text: await resp.text() };
    const decoder = new TextDecoder();
    let out = '';
    let received = 0;
    let overflow = false;
    while (received < MAX_API_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      out += decoder.decode(value, { stream: true });
    }
    if (received >= MAX_API_BODY_BYTES) {
      overflow = true;
      reader.cancel().catch(() => {});
    }
    if (overflow && out.length === 0) return null;
    return { status: resp.status, text: out };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parseJson<T = Record<string, unknown>>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function urlParam(value: string): string {
  return encodeURIComponent(value);
}

// ---------------- 夸克 / UC（同源码表：0 成功，41008 需提取码，41004/41006/41010/41011 失效） ----------------

interface QuarkTokenResp {
  code?: number;
  message?: string;
  data?: { stoken?: string };
}

async function quarkFamilyTokenApi(
  apiUrl: string,
  origin: string,
  shareId: string,
  passcode: string,
): Promise<NetdiskApiVerdict | null> {
  const r = await apiFetch(apiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, referer: `${origin}/` },
    body: JSON.stringify({ pwd_id: shareId, passcode, support_visit_limit_private_share: true }),
  });
  if (!r) return null;
  const data = parseJson<QuarkTokenResp>(r.text);
  if (!data || typeof data.code !== 'number') return null; // 非 JSON（风控页等）→ 降级
  const message = data.message ?? '';
  if (data.code === 0) {
    if (data.data?.stoken) return { state: 'ok', summary: '链接有效' };
    return null; // 码 0 但缺 stoken，无法确认
  }
  if (data.code === 41008 || containsAny(message, LOCK_WORDS)) {
    return { state: 'locked', summary: message || '需要提取码' };
  }
  if ([41004, 41006, 41010, 41011].includes(data.code) || containsAny(message, BAD_WORDS)) {
    return { state: 'bad', summary: message || '链接失效' };
  }
  return null; // 未知错误码 → 保守降级
}

function extractShareIdFromPath(url: string, host: string): string {
  const m = url.match(new RegExp(`${host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/s/([A-Za-z0-9]+)`));
  return m?.[1] ?? '';
}

/** 夸克：drive-h.quark.cn sharepage/token */
export async function checkQuarkApi(url: string, password: string): Promise<NetdiskApiVerdict | null> {
  const shareId = extractShareIdFromPath(url, 'pan.quark.cn');
  if (!shareId) return null;
  let passcode = password;
  if (!passcode) {
    try {
      passcode = new URL(url).searchParams.get('pwd') ?? '';
    } catch {
      passcode = '';
    }
  }
  return quarkFamilyTokenApi(
    'https://drive-h.quark.cn/1/clouddrive/share/sharepage/token?pr=ucpro&fr=pc',
    'https://pan.quark.cn',
    shareId,
    passcode,
  );
}

/** UC：pc-api.uc.cn sharepage/token（pr 必须为 UCBrowser，实测 pr=ucpro 会误报分享不存在） */
export async function checkUcApi(url: string, password: string): Promise<NetdiskApiVerdict | null> {
  const shareId = extractShareIdFromPath(url, 'drive.uc.cn');
  if (!shareId) return null;
  let passcode = password;
  if (!passcode) {
    try {
      passcode = new URL(url).searchParams.get('pwd') ?? '';
    } catch {
      passcode = '';
    }
  }
  return quarkFamilyTokenApi(
    'https://pc-api.uc.cn/1/clouddrive/share/sharepage/token?pr=UCBrowser&fr=pc',
    'https://drive.uc.cn',
    shareId,
    passcode,
  );
}

// ---------------- 百度（verify 换 BDCLND，再 share/list；surl 必须去掉前导 1） ----------------

interface BaiduResp {
  errno?: number;
  errmsg?: string;
  err_msg?: string;
  randsk?: string;
  list?: unknown[];
}

/** /s/1abc → surl=abc；/share/init?surl=abc → surl=abc（verify 接口的前导 1 要剥掉，实测不剥会误判） */
function extractBaiduSurl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return '';
  }
  let shareId = '';
  if (u.pathname.startsWith('/s/')) shareId = u.pathname.slice(3);
  else if (u.pathname.startsWith('/share/init')) shareId = u.searchParams.get('surl') ?? '';
  if (!shareId) return '';
  return shareId.startsWith('1') && shareId.length > 1 ? shareId.slice(1) : shareId;
}

export async function checkBaiduApi(url: string, password: string): Promise<NetdiskApiVerdict | null> {
  const shortUrl = extractBaiduSurl(url);
  if (!shortUrl) return null;
  let pwd = password;
  if (!pwd) {
    try {
      pwd = new URL(url).searchParams.get('pwd') ?? '';
    } catch {
      pwd = '';
    }
  }

  let bdclnd = '';
  if (pwd) {
    const verifyUrl = `https://pan.baidu.com/share/verify?surl=${urlParam(shortUrl)}&pwd=${urlParam(pwd)}&t=${Date.now()}`;
    const r = await apiFetch(verifyUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', referer: url },
      body: `pwd=${urlParam(pwd)}&vcode=&vcode_str=`,
    });
    if (!r) return null;
    const data = parseJson<BaiduResp>(r.text);
    if (!data || typeof data.errno !== 'number') return null;
    if (data.errno === 0) bdclnd = data.randsk ?? '';
    else if (data.errno === -9 || data.errno === -12) return { state: 'locked', summary: '提取码错误或缺失' };
    else if (data.errno === 105 || data.errno === -7) return { state: 'bad', summary: '链接失效' };
    else return null; // 风控（如 9019 need verify / -62）→ 降级
  }

  const listUrl = `https://pan.baidu.com/share/list?web=1&page=1&num=20&order=time&desc=1&showempty=0&shorturl=${urlParam(
    shortUrl,
  )}&root=1&clienttype=0`;
  const headers: Record<string, string> = {
    accept: 'application/json, text/plain, */*',
    referer: url,
  };
  if (bdclnd) headers.cookie = `BDCLND=${bdclnd}`;
  const r = await apiFetch(listUrl, { headers });
  if (!r) return null;
  const data = parseJson<BaiduResp>(r.text);
  if (!data || typeof data.errno !== 'number') return null;
  const message = data.errmsg ?? data.err_msg ?? '';
  if (data.errno === 0) {
    if (data.list && data.list.length > 0) return { state: 'ok', summary: '链接有效' };
    return { state: 'bad', summary: '链接失效' };
  }
  if (data.errno === -9 || data.errno === -12) return { state: 'locked', summary: '需要提取码' };
  if ([-7, 105, 115, 117, 145].includes(data.errno) || containsAny(message, BAD_WORDS)) {
    return { state: 'bad', summary: message || '链接失效' };
  }
  return null;
}

// ---------------- 阿里（get_share_by_anonymous，错误码 ShareLink.* / NotFound.ShareLink） ----------------

interface AliyunResp {
  code?: string;
  message?: string;
  share_name?: string;
  share_title?: string;
  file_count?: number;
  has_pwd?: boolean;
  share_status?: string;
}

export async function checkAliyunApi(url: string, _password: string): Promise<NetdiskApiVerdict | null> {
  let shareId = '';
  try {
    const parts = new URL(url).pathname.replace(/^\//, '').split('/');
    shareId = parts[parts.length - 1] ?? '';
  } catch {
    return null;
  }
  if (!shareId) return null;
  const r = await apiFetch(
    `https://api.aliyundrive.com/adrive/v3/share_link/get_share_by_anonymous?share_id=${urlParam(shareId)}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://www.alipan.com',
        referer: 'https://www.alipan.com/',
        'x-canary': 'client=web,app=share,version=v2.3.1',
      },
      body: JSON.stringify({ share_id: shareId }),
    },
  );
  if (!r) return null;
  const data = parseJson<AliyunResp>(r.text);
  if (!data) return null;
  const code = (data.code ?? '').trim().toLowerCase();
  if (code) {
    if (containsAny(code, ['sharelink', 'notfound', 'cancelled', 'canceled', 'forbidden', 'expired'])) {
      return { state: 'bad', summary: data.message || data.code || '链接失效' };
    }
    if (containsAny(code, ['exceed', 'frequency', 'limit'])) return null; // 风控限流 → 降级
    return null; // 未知错误码 → 保守降级
  }
  if (r.status === 200 && (data.share_name || data.share_title || (data.file_count ?? 0) > 0)) {
    if (data.has_pwd) return { state: 'locked', summary: '链接有效，需要提取码' };
    return { state: 'ok', summary: '链接有效' };
  }
  return null;
}

// ---------------- 115（webapi/share/snap，需访问码；4100008=码错，990002=参数错，4100010=已取消） ----------------

interface Pan115Resp {
  state?: boolean;
  error?: string;
  errno?: number;
  data?: {
    list?: unknown[];
    count?: number;
    share_state?: number;
    shareinfo?: { snap_id?: string; share_title?: string; share_state?: number; forbid_reason?: string };
  };
}

export async function check115Api(url: string, password: string): Promise<NetdiskApiVerdict | null> {
  let shareCode = '';
  let pwdFromUrl = '';
  try {
    const u = new URL(url);
    const parts = u.pathname.replace(/^\//, '').split('/');
    shareCode = parts[parts.length - 1] ?? '';
    pwdFromUrl = u.searchParams.get('password') ?? '';
  } catch {
    return null;
  }
  if (!shareCode) return null;
  const receiveCode = password || pwdFromUrl;
  const r = await apiFetch(
    `https://115cdn.com/webapi/share/snap?share_code=${urlParam(shareCode)}&offset=0&limit=20&receive_code=${urlParam(
      receiveCode,
    )}&cid=`,
    {
      headers: {
        referer: `https://115cdn.com/s/${shareCode}`,
        'x-requested-with': 'XMLHttpRequest',
      },
    },
  );
  if (!r) return null;
  const data = parseJson<Pan115Resp>(r.text);
  if (!data) return null;
  if (data.state && data.errno === 0) {
    const share = data.data?.shareinfo;
    if ((data.data?.list?.length ?? 0) > 0 || (data.data?.count ?? 0) > 0 || share?.snap_id || share?.share_title) {
      return { state: 'ok', summary: '链接有效' };
    }
    const shareState = data.data?.share_state ?? share?.share_state ?? -1;
    if (shareState === 1) return { state: 'ok', summary: '链接有效' };
    const reason = (share?.forbid_reason ?? '').trim();
    if (reason) {
      if (containsAny(reason, LOCK_WORDS)) return { state: 'locked', summary: reason };
      return { state: 'bad', summary: reason };
    }
    return { state: 'bad', summary: `链接状态异常(share_state=${shareState})` };
  }
  const error = data.error ?? '';
  if (containsAny(error, ['访问码', ...LOCK_WORDS])) return { state: 'locked', summary: error || '需要提取码' };
  if (containsAny(error, ['参数错误', '不存在', '失效', '取消', '违规', '删除', 'forbid'])) {
    return { state: 'bad', summary: error || '链接失效' };
  }
  return null;
}

// ---------------- 123（123684 b/api/share/info 跨域通用：5104 已失效，5107 页面不存在） ----------------

interface Pan123Resp {
  code?: number;
  message?: string;
  data?: { ShareName?: string; HasPwd?: boolean; Expired?: boolean };
}

export async function check123Api(url: string, _password: string): Promise<NetdiskApiVerdict | null> {
  const m = url.match(/123(?:684|685|865|912|592|pan)\.(?:com|cn)\/s\/([a-zA-Z0-9-]+)/);
  if (!m) return null;
  // 123 各域名后端同源，统一走 123684（123pan.com 主域对 b/api 有 SPA 风控）
  const r = await apiFetch(`https://www.123684.com/b/api/share/info?sharekey=${urlParam(m[1])}`, {
    headers: { accept: 'application/json, text/plain, */*', platform: 'web', referer: 'https://www.123684.com/' },
  });
  if (!r) return null;
  const data = parseJson<Pan123Resp>(r.text);
  if (!data || typeof data.code !== 'number') return null;
  const message = data.message ?? '';
  if (data.code === 0) {
    if (data.data?.Expired) return { state: 'bad', summary: '分享已过期' };
    if (data.data?.HasPwd) return { state: 'locked', summary: '需要提取码' };
    return { state: 'ok', summary: '链接有效' };
  }
  if (containsAny(message, ['失效', '不存在', '格式异常', '长度异常'])) {
    return { state: 'bad', summary: message || '链接失效' };
  }
  return null;
}

// ---------------- 天翼（getShareInfoByCodeV2，XML 响应：shareVO=有效，error+已知码=失效） ----------------

const TIANYI_BAD_CODES = [
  'ShareInfoNotFound',
  'ShareNotFound',
  'FileNotFound',
  'ShareExpiredError',
  'ShareAuditNotPass',
  'FolderNotFound',
];

export async function checkTianyiApi(url: string, password: string): Promise<NetdiskApiVerdict | null> {
  let shareCode = '';
  let referer = url;
  let pwd = password;
  try {
    const u = new URL(url);
    if (u.pathname.startsWith('/t/')) shareCode = u.pathname.slice(3).split('/')[0];
    if (!shareCode) shareCode = u.searchParams.get('code') ?? '';
    const m = url.match(/（访问码[：:]\s*([a-zA-Z0-9]+)）/);
    if (m) pwd = m[1];
  } catch {
    return null;
  }
  if (!shareCode) return null;
  // 带码分享：shareCode 参数要拼「（访问码：xxx）」，与分享页 URL 中的形态一致
  const shareCodeParam = pwd ? `${shareCode}（访问码：${pwd}）` : shareCode;
  const r = await apiFetch(
    `https://cloud.189.cn/api/open/share/getShareInfoByCodeV2.action?noCache=${Math.random()}&shareCode=${urlParam(
      shareCodeParam,
    )}`,
    { headers: { referer, 'sign-type': '1' } },
  );
  if (!r) return null;
  const text = r.text;
  if (text.includes('<shareVO')) {
    const shareId = text.match(/<shareId>(\d+)<\/shareId>/)?.[1];
    const fileName = text.match(/<fileName>([^<]*)<\/fileName>/)?.[1];
    const needAccessCode = text.match(/<needAccessCode>(\d+)<\/needAccessCode>/)?.[1];
    if ((shareId && shareId !== '0') || fileName || needAccessCode === '1') return { state: 'ok', summary: '链接有效' };
    return null;
  }
  const errCode = text.match(/<code>([^<]+)<\/code>/)?.[1];
  const errMsg = text.match(/<message>([^<]*)<\/message>/)?.[1] ?? '';
  if (errCode) {
    const known = TIANYI_BAD_CODES.find((c) => errCode.includes(c) || errMsg.includes(c));
    if (known) return { state: 'bad', summary: known };
    if (containsAny(`${errCode} ${errMsg}`, LOCK_WORDS)) return { state: 'locked', summary: errMsg || '需要访问码' };
    return { state: 'bad', summary: errCode || errMsg || '链接失效' };
  }
  if (containsAny(text, LOCK_WORDS)) return { state: 'locked', summary: '需要访问码' };
  return null;
}

// ---------------- 迅雷（captcha init + drive/v1/share；OK=有效，PASS_CODE_ERROR=码错） ----------------

const XL_CLIENT_ID = 'ZUBzD9J_XPXfn7f7';
const XL_DEVICE_ID = '5505bd0cab8c9469b98e5891d9fb3e0d';
const XL_CLIENT_VERSION = '1.10.0.2633';
const XL_PACKAGE_NAME = 'com.xunlei.browser';

let xlCaptchaTokenCache = { token: '', expiresAt: 0 };

function buildXunleiCaptchaSignature(): { timestamp: string; signature: string } {
  const timestamp = String(Date.now());
  let content = `${XL_CLIENT_ID}${XL_CLIENT_VERSION}${XL_PACKAGE_NAME}${XL_DEVICE_ID}${timestamp}`;
  const parts = [
    'uWRwO7gPfdPB/0NfPtfQO+71',
    'F93x+qPluYy6jdgNpq+lwdH1ap6WOM+nfz8/V',
    '0HbpxvpXFsBK5CoTKam',
    'dQhzbhzFRcawnsZqRETT9AuPAJ+wTQso82mRv',
    'SAH98AmLZLRa6DB2u68sGhyiDh15guJpXhBzI',
    'unqfo7Z64Rie9RNHMOB',
    '7yxUdFADp3DOBvXdz0DPuKNVT35wqa5z0DEyEvf',
    'RBG',
    'ThTWPG5eC0UBqlbQ+04nZAptqGCdpv9o55A',
  ];
  for (const part of parts) {
    content = createHash('md5').update(content + part).digest('hex');
  }
  return { timestamp, signature: `1.${content}` };
}

async function fetchXunleiCaptchaToken(): Promise<string> {
  if (xlCaptchaTokenCache.token && Date.now() < xlCaptchaTokenCache.expiresAt) return xlCaptchaTokenCache.token;
  const { timestamp, signature } = buildXunleiCaptchaSignature();
  const r = await apiFetch('https://xluser-ssl.xunlei.com/v1/shield/captcha/init', {
    method: 'POST',
    headers: {
      accept: 'application/json;charset=UTF-8',
      'content-type': 'application/json',
      'x-device-id': XL_DEVICE_ID,
      'x-client-id': XL_CLIENT_ID,
      'x-client-version': XL_CLIENT_VERSION,
    },
    body: JSON.stringify({
      action: 'get:/drive/v1/share',
      captcha_token: '',
      client_id: XL_CLIENT_ID,
      device_id: XL_DEVICE_ID,
      meta: {
        timestamp,
        captcha_sign: signature,
        client_version: XL_CLIENT_VERSION,
        package_name: XL_PACKAGE_NAME,
      },
      redirect_uri: 'xlaccsdk01://xunlei.com/callback?state=harbor',
    }),
  });
  if (!r) return '';
  const data = parseJson<{ captcha_token?: string; url?: string }>(r.text);
  if (!data || data.url) return ''; // 触发人机校验 → 降级
  const token = data.captcha_token ?? '';
  if (token) xlCaptchaTokenCache = { token, expiresAt: Date.now() + 60_000 };
  return token;
}

interface XunleiResp {
  error?: string;
  error_code?: number;
  error_description?: string;
  share_status?: string;
  share_status_text?: string;
  share_id?: string;
  share_name?: string;
  file_count?: number;
}

export async function checkXunleiApi(url: string, password: string): Promise<NetdiskApiVerdict | null> {
  const m = url.match(/pan\.xunlei\.com\/s\/([^?/#]+)/);
  if (!m) return null;
  let passCode = password;
  if (!passCode) {
    try {
      passCode = new URL(url).searchParams.get('pwd') ?? '';
    } catch {
      passCode = '';
    }
  }
  const captchaToken = await fetchXunleiCaptchaToken();
  const headers: Record<string, string> = {
    accept: '*/*',
    origin: 'https://pan.xunlei.com',
    referer: 'https://pan.xunlei.com/',
    'x-client-id': XL_CLIENT_ID,
    'x-device-id': XL_DEVICE_ID,
  };
  if (captchaToken) headers['x-captcha-token'] = captchaToken;
  const r = await apiFetch(
    `https://api-pan.xunlei.com/drive/v1/share?share_id=${urlParam(m[1])}&pass_code=${urlParam(
      passCode,
    )}&limit=100&pass_code_token=&page_token=&thumbnail_size=SIZE_SMALL`,
    { headers },
  );
  if (!r) return null;
  const data = parseJson<XunleiResp>(r.text);
  if (!data) return null;
  const error = `${data.error ?? ''} ${data.error_description ?? ''}`.toLowerCase();
  if (error.includes('captcha')) return null; // 风控 → 降级
  const shareStatus = data.share_status ?? '';
  if (shareStatus === 'OK') return { state: 'ok', summary: '链接有效' };
  if (shareStatus === 'PASS_CODE_ERROR') return { state: 'locked', summary: '提取码错误或缺失' };
  if (shareStatus) {
    const text = data.share_status_text ?? '';
    if (containsAny(`${shareStatus} ${text}`, ['pass_code'])) return { state: 'locked', summary: text || '需要提取码' };
    return { state: 'bad', summary: text || `分享状态异常(${shareStatus})` };
  }
  if (data.share_id || data.share_name || (data.file_count ?? 0) > 0) return { state: 'ok', summary: '链接有效' };
  if (error.includes('invalid_argument') || containsAny(error, ['参数错误', '不存在', 'not found'])) {
    return { state: 'bad', summary: data.error_description || '链接失效' };
  }
  return null;
}

// ---------------- 移动 139（getOutLinkInfoV6，AES-128-CBC 固定 key，与 Go pansou 同参） ----------------

const MOBILE_CRYPTO_KEY = Buffer.from('PVGDwmcvfs1uV3d1', 'utf8');

function mobileEncrypt(plain: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-128-cbc', MOBILE_CRYPTO_KEY, iv);
  return Buffer.concat([iv, cipher.update(plain, 'utf8'), cipher.final()]).toString('base64');
}

function mobileDecrypt(b64: string): string | null {
  try {
    const raw = Buffer.from(b64, 'base64');
    if (raw.length < 32) return null;
    const decipher = createDecipheriv('aes-128-cbc', MOBILE_CRYPTO_KEY, raw.subarray(0, 16));
    const plain = Buffer.concat([decipher.update(raw.subarray(16)), decipher.final()]);
    return plain.toString('utf8');
  } catch {
    return null;
  }
}

export async function checkMobileApi(url: string, password: string): Promise<NetdiskApiVerdict | null> {
  const m =
    url.match(/yun\.139\.com\/shareweb\/#\/w\/i\/([^&/?#]+)/) ??
    url.match(/caiyun\.139\.com\/w\/i\/([^&/?#]+)/) ??
    url.match(/caiyun\.139\.com\/m\/i\?([a-zA-Z0-9]+)/) ??
    url.match(/caiyun\.feixin\.10086\.cn\/([a-zA-Z0-9]+)/);
  const shareId = m?.[1];
  if (!shareId) return null;
  const payload = {
    getOutLinkInfoReq: {
      account: '',
      linkID: shareId,
      passwd: password,
      caSrt: 1,
      coSrt: 1,
      srtDr: 0,
      bNum: 1,
      pCaID: 'root',
      eNum: 200,
    },
    commonAccountInfo: { account: '', accountType: 1 },
  };
  const r = await apiFetch('https://share-kd-njs.yun.139.com/yun-share/richlifeApp/devapp/IOutLink/getOutLinkInfoV6', {
    method: 'POST',
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      'hcy-cool-flag': '1',
      'x-deviceinfo': '||3|12.27.0|chrome|131.0.0.0|5c7c68368f048245e1ce47f1c0f8f2d0||windows 10|1536X695|zh-CN|||',
    },
    body: JSON.stringify(mobileEncrypt(JSON.stringify(payload))),
    timeoutMs: 5_000,
  });
  if (!r) return null;
  const decrypted = mobileDecrypt(r.text.trim());
  if (!decrypted) return null;
  const data = parseJson<{ resultCode?: string; desc?: string; data?: unknown }>(decrypted);
  if (!data) return null;
  if (data.resultCode === '0' && data.data) return { state: 'ok', summary: '链接有效' };
  const desc = data.desc ?? '';
  if (containsAny(desc, LOCK_WORDS)) return { state: 'locked', summary: desc || '需要提取码' };
  if (containsAny(desc, BAD_WORDS)) return { state: 'bad', summary: desc || '链接失效' };
  if (desc) return null; // 未知错误 → 降级
  if (data.resultCode && data.resultCode !== '0') return { state: 'bad', summary: `错误码: ${data.resultCode}` };
  return null;
}

// ---------------- 分发器：网盘类型 → 私有 API 探测（无接口的类型返回 null 走页面探测） ----------------

const API_CHECKERS: Record<string, (url: string, password: string) => Promise<NetdiskApiVerdict | null>> = {
  quark: checkQuarkApi,
  uc: checkUcApi,
  baidu: checkBaiduApi,
  aliyun: checkAliyunApi,
  115: check115Api,
  123: check123Api,
  tianyi: checkTianyiApi,
  xunlei: checkXunleiApi,
  mobile: checkMobileApi,
  // pikpak / guangya：无公开匿名接口，直接降级页面探测
};

/** 统一入口：返回 null = 接口不可用或无法判定，调用方降级页面探测 */
export async function checkNetdiskApi(
  diskType: string,
  url: string,
  password: string,
): Promise<NetdiskApiVerdict | null> {
  const checker = API_CHECKERS[diskType];
  if (!checker) return null;
  try {
    return await checker(url, password || '');
  } catch {
    return null;
  }
}
