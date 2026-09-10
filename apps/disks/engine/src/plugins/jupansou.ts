// 聚盘搜插件 —— Go plugin/jupansou 的代码级移植
// 站点 dyuzi.com：先 GET /api/search/session 建立 search_token 会话（Go cookiejar，
// 此处以响应 Set-Cookie 透传实现），再以 SSE 读取 /api/search/stream 的逐条结果，
// 非直链的加密 URL 经 POST /api/transfer（multipart）兑换为分享链接。
// 有意简化：Go 的 http.Transport 连接池参数在事件循环下无意义，已删；
//           cookiejar 换成会话内单次透传（同一 search 范围内等价）；
//           Go 协程乱序 append（mutex 保护），此处按流顺序收集（allSettled），结果确定性更好。

import { createHash } from 'node:crypto';
import { createLimiter } from '../http.ts';
import type { SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const BASE_URL = 'https://dyuzi.com';
const REQUEST_TIMEOUT = 20_000;
const STREAM_TIMEOUT = 3_000;
const MAX_RETRIES = 3;
const MAX_CONCURRENCY = 8;

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

interface StreamItem {
  title: string;
  name: string;
  url: string;
  disk_type: string;
  is_type: number;
}

interface TransferResponse {
  success: boolean;
  data?: { share_url?: string; pwd?: string; file_name?: string };
}

/** 建立搜索会话并取回 Cookie（Go ensureSearchSession + cookiejar） */
async function ensureSearchSession(): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const resp = await fetch(`${BASE_URL}/api/search/session`, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'application/json',
        Referer: `${BASE_URL}/`,
        'X-Requested-With': 'XMLHttpRequest',
      },
      signal: controller.signal,
    });
    if (resp.status !== 200) throw new Error(`[jupansou] 搜索会话返回状态码: ${resp.status}`);
    // 取 name=value 部分，拼成 Cookie 头（Go cookiejar 自动管理）
    const cookies = resp.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .filter((c) => c !== '');
    return cookies.join('; ');
  } catch (err) {
    throw new Error(`[jupansou] 搜索会话请求失败: ${err instanceof Error ? err.message : err}`);
  } finally {
    clearTimeout(timer);
  }
}

/** SSE 流式读取：网络错误与非 200 均退避重试（Go doJuPansouRequestWithRetry）；超时中断保留已读条目 */
async function fetchStreamItems(searchURL: string, cookie: string): Promise<StreamItem[]> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STREAM_TIMEOUT);
    const items: StreamItem[] = []; // 已完整读取的条目（跨中断保留）
    try {
      const resp = await fetch(searchURL, {
        headers: {
          'User-Agent': BROWSER_UA,
          Accept: 'text/event-stream',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          Connection: 'keep-alive',
          Referer: `${BASE_URL}/`,
          Origin: BASE_URL,
          'X-Requested-With': 'XMLHttpRequest',
          ...(cookie !== '' ? { Cookie: cookie } : {}),
        },
        signal: controller.signal,
      });
      if (resp.status !== 200) {
        lastErr = new Error(`[jupansou] 接口返回状态码: ${resp.status}`);
        continue;
      }

      await readSSEBody(resp, items);
      return items;
    } catch (err) {
      // Go：流读取出错但已有条目时保留部分结果继续；完全无条目时走重试
      if (items.length > 0) return items;
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`[jupansou] 请求失败: 重试 ${MAX_RETRIES} 次后失败: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
}

/** 增量读取 SSE 流：逐行解析追加到 items，超时中断时已完整读取的行得以保留（Go bufio.Scanner 语义） */
async function readSSEBody(resp: Response, items: StreamItem[]): Promise<void> {
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        const item = parseSSELine(line);
        if (item !== null) items.push(item);
      }
    }
  } catch (err) {
    if (items.length > 0) return; // 保留部分结果
    throw err;
  }
}

/** 解析单条 SSE 行：data: 前缀，跳过 [DONE]（Go scanner 循环体） */
function parseSSELine(rawLine: string): StreamItem | null {
  const line = rawLine.trim();
  if (!line.startsWith('data:')) return null;
  const payload = line.slice('data:'.length).trim();
  if (payload === '' || payload === '[DONE]') return null;

  let item: StreamItem;
  try {
    item = JSON.parse(payload) as StreamItem;
  } catch {
    return null;
  }
  item.title = (item.title ?? '').trim();
  item.name = (item.name ?? '').trim();
  item.url = (item.url ?? '').trim();
  if (item.title === '' || item.url === '') return null;
  return item;
}

/** 直链提取查询参数密码（Go extractJuPansouPassword） */
function extractPasswordFromURL(rawURL: string): string {
  try {
    const u = new URL(rawURL);
    for (const key of ['pwd', 'code', 'passcode']) {
      const value = (u.searchParams.get(key) ?? '').trim();
      if (value !== '') return value;
    }
  } catch {
    /* URL 非法返回空 */
  }
  return '';
}

/** 兑换单条结果：直链直用，加密链接 POST /api/transfer（Go exchangeURL） */
async function exchangeURL(item: StreamItem, cookie: string): Promise<{ shareURL: string; password: string } | null> {
  if (item.url.startsWith('http://') || item.url.startsWith('https://')) {
    return { shareURL: item.url, password: extractPasswordFromURL(item.url) };
  }

  const form = new FormData();
  form.append('link', item.url);
  if (item.disk_type !== '') form.append('type', item.disk_type);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const resp = await fetch(`${BASE_URL}/api/transfer`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Origin: BASE_URL,
        Referer: `${BASE_URL}/`,
        'User-Agent': BROWSER_UA,
        ...(cookie !== '' ? { Cookie: cookie } : {}),
      },
      body: form, // Node fetch 自动生成 multipart/form-data + boundary（Go mime/multipart 等价）
      signal: controller.signal,
    });
    if (resp.status !== 200) return null;
    const payload = (await resp.json()) as TransferResponse;
    if (!payload.success) return null;
    const shareURL = (payload.data?.share_url ?? '').trim();
    if (shareURL === '') return null;
    return { shareURL, password: (payload.data?.pwd ?? '').trim() };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 链接类型归一化：disk_type > is_type > URL 兜底（Go mapJuPansouLinkType） */
function mapLinkType(isType: number, diskType: string, rawURL: string): string {
  const normalized = diskType.trim().toLowerCase();
  if (normalized !== '') {
    if (['quark', 'baidu', 'aliyun', 'uc', 'xunlei', 'tianyi', '115', '123', 'mobile', 'pikpak', 'magnet', 'ed2k'].includes(normalized)) {
      return normalized;
    }
  }
  if (isType === 0) return 'quark';
  if (isType === 1) return 'aliyun';
  if (isType === 2) return 'baidu';
  if (isType === 3) return 'uc';
  if (isType === 4) return 'xunlei';
  const urlValue = rawURL.toLowerCase();
  if (urlValue.includes('pan.quark.cn')) return 'quark';
  if (urlValue.includes('pan.baidu.com')) return 'baidu';
  if (urlValue.includes('alipan.com') || urlValue.includes('aliyundrive.com')) return 'aliyun';
  if (urlValue.includes('drive.uc.cn')) return 'uc';
  if (urlValue.includes('pan.xunlei.com')) return 'xunlei';
  return 'others';
}

export const jupansou = definePlugin({
  name: 'jupansou',
  priority: 3,
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    const cookie = await ensureSearchSession();

    const searchURL = `${BASE_URL}/api/search/stream?keyword=${encodeURIComponent(keyword)}&type=all`;
    const items = await fetchStreamItems(searchURL, cookie);

    // 流中可能混有宽泛的第三方条目，兑换前先按标题过滤，避免无谓的 transfer 请求
    const keywordLower = keyword.trim().toLowerCase();
    const filteredItems = keywordLower === '' ? items : items.filter((item) => item.title.toLowerCase().includes(keywordLower));

    // 并发兑换（Go semaphore 8），按流顺序收集，shareURL 去重
    const limit = createLimiter(MAX_CONCURRENCY);
    const settled = await Promise.allSettled(filteredItems.map((item) => limit(() => exchangeURL(item, cookie))));

    const results: SearchResult[] = [];
    const seen = new Set<string>();
    settled.forEach((s, idx) => {
      if (s.status !== 'fulfilled' || s.value === null) return;
      const { shareURL, password } = s.value;
      if (seen.has(shareURL)) return;
      seen.add(shareURL);

      const item = filteredItems[idx];
      const linkType = mapLinkType(item.is_type, item.disk_type, shareURL);
      results.push({
        message_id: '',
        unique_id: `jupansou-${createHash('md5').update(shareURL).digest('hex')}`,
        channel: '', // 插件结果 Channel 必须为空
        datetime: new Date().toISOString(),
        title: item.title,
        content: '来源: 聚盘搜',
        tags: [linkType],
        links: [{ type: linkType, url: shareURL, password }],
      });
    });
    return filterResultsByKeyword(results, keyword);
  },
});
