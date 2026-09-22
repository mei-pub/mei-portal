// 磁力熊（CLXIONG）磁力搜索插件 —— Go plugin/clxiong 的复刻（磁力源，跳过 Service 层过滤）
// 站点 www.cilixiong.org（帝国 CMS）。契约：POST /e/search/index.php 表单 → 301/302
// 从 Location 提取 searchid → GET 结果列表 → 并发抓详情页 .mv_down 磁力链接。

import * as cheerio from 'cheerio';
import { createLimiter } from '../http.ts';
import type { Link, SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const BASE_URL = 'https://www.cilixiong.org';
const SEARCH_URL = 'https://www.cilixiong.org/e/search/index.php';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2_000; // Go RetryDelay
const MAX_RESULTS = 30;
const DETAIL_TIMEOUT_MS = 20_000;
const DETAIL_CONCURRENCY = 5; // Go 信号量容量

const SEARCH_HEADERS = {
  'User-Agent': USER_AGENT,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
};

/** 从 Location 头提取 searchid（Go extractSearchIDFromLocation） */
function extractSearchIDFromLocation(location: string): string {
  return location.match(/searchid=(\d+)/)?.[1] ?? '';
}

/** 第一步：POST 搜索获取 searchid（Go getSearchID） */
async function getSearchID(keyword: string): Promise<string> {
  const form = new URLSearchParams();
  form.set('classid', '1,2'); // 1=电影，2=剧集
  form.set('show', 'title'); // 搜索字段
  form.set('tempid', '1'); // 模板ID
  form.set('keyboard', keyword); // 搜索关键词

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    let lastErr: unknown = null;
    let resp: Response | null = null;
    // 重试机制（Go：期望 301/302，不自动跟随重定向，手动处理 Location）
    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        resp = await fetch(SEARCH_URL, {
          method: 'POST',
          headers: {
            ...SEARCH_HEADERS,
            'Content-Type': 'application/x-www-form-urlencoded',
            Referer: BASE_URL + '/',
          },
          body: form.toString(),
          redirect: 'manual', // http.ErrUseLastResponse：保留 302 响应
          signal: controller.signal,
        });
        if (resp.status === 302 || resp.status === 301) {
          lastErr = null;
          break;
        }
      } catch (err) {
        resp = null;
        lastErr = err;
      }
      if (i < MAX_RETRIES - 1) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
    if (lastErr) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    if (!resp || (resp.status !== 302 && resp.status !== 301)) {
      throw new Error('期望302重定向，但得到状态码: ' + (resp ? resp.status : 'nil'));
    }

    const location = resp.headers.get('Location') ?? '';
    if (location === '') throw new Error('重定向响应中没有Location头部');
    const searchID = extractSearchIDFromLocation(location);
    if (searchID === '') throw new Error(`无法从Location中提取searchid: ${location}`);
    return searchID;
  } finally {
    clearTimeout(timer);
  }
}

/** 从 style 属性提取背景图片 URL（Go extractImageFromStyle） */
function extractImageFromStyle(style: string): string {
  return style.match(/url\(['"]?([^'"]+)['"]?\)/)?.[1] ?? '';
}

/** 生成唯一 ID（Go generateUniqueID）：路径数字，失败退化为 hash*31 */
function generateUniqueID(detailPath: string): string {
  const m = detailPath.match(/\/(?:drama|movie)\/(\d+)\.html/);
  if (m) return `clxiong-${m[1]}`;
  let hash = 0;
  for (const ch of detailPath) {
    hash = hash * 31 + ch.codePointAt(0)!;
  }
  hash = Math.abs(hash);
  return `clxiong-${hash}`;
}

/** 第二步：GET 搜索结果页并解析（Go getSearchResults + parseSearchResults） */
async function getSearchResults(searchID: string): Promise<SearchResult[]> {
  const resultURL = `${BASE_URL}/e/search/result/?searchid=${searchID}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let html = '';
  try {
    let lastErr: unknown = null;
    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        const resp = await fetch(resultURL, {
          headers: { ...SEARCH_HEADERS, Referer: BASE_URL + '/' },
          signal: controller.signal,
        });
        if (resp.status === 200) {
          html = await resp.text();
          lastErr = null;
          break;
        }
        lastErr = new Error(`搜索结果请求失败，状态码: ${resp.status}`);
      } catch (err) {
        lastErr = err;
      }
      if (i < MAX_RETRIES - 1) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
    if (lastErr) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  } finally {
    clearTimeout(timer);
  }

  const $ = cheerio.load(html);
  const results: SearchResult[] = [];
  const now = new Date().toISOString();

  $('.row.row-cols-2.row-cols-lg-4 .col').each((i, el) => {
    const s = $(el);
    if (i >= MAX_RESULTS) return; // 限制结果数量

    // 提取详情页链接
    const linkEl = s.find("a[href*='/drama/'], a[href*='/movie/']");
    if (linkEl.length === 0) return;

    const detailPath = linkEl.attr('href') ?? '';
    if (detailPath === '') return;
    const detailURL = BASE_URL + detailPath;

    // 标题
    const title = linkEl.find('h2.h4').text().trim();
    if (title === '') return;

    // 评分 / 年份 / 海报
    const rating = s.find('.rank').text().trim();
    const year = s.find('.small').last().text().trim();
    const poster = extractImageFromStyle(s.find('.card-img').attr('style') ?? '');

    // 构建内容信息（详情页链接放入 content，供后续提取磁力链接使用）
    const contentParts: string[] = [];
    if (rating !== '') contentParts.push(`评分: ${rating}`);
    if (year !== '') contentParts.push(`年份: ${year}`);
    if (poster !== '') contentParts.push(`海报: ${poster}`);
    contentParts.push(`详情页: ${detailURL}`);

    results.push({
      message_id: '',
      unique_id: generateUniqueID(detailPath),
      channel: '', // 插件搜索结果必须为空
      datetime: now, // 搜索时间
      title,
      content: contentParts.join(' | '),
      links: [], // 初始为空，后续获取
      tags: ['磁力链接', '影视'],
    });
  });

  return results;
}

interface DetailPageInfo {
  magnetLinks: Link[];
  updateTime: string; // ISO，空串表示零值
  fileNames: string[]; // 所有文件的名称，与磁力链接对应
}

/** 获取详情页的完整信息（Go fetchDetailPageInfo + parseDetailPageInfo） */
async function fetchDetailPageInfo(detailURL: string, movieTitle: string): Promise<DetailPageInfo | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DETAIL_TIMEOUT_MS);
  let body: string | null = null;
  try {
    const resp = await fetch(detailURL, {
      headers: { ...SEARCH_HEADERS, Referer: BASE_URL + '/' },
      signal: controller.signal,
    });
    if (resp.status !== 200) return null;
    body = await resp.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }

  const $ = cheerio.load(body);
  const info: DetailPageInfo = { magnetLinks: [], updateTime: '', fileNames: [] };
  void movieTitle; // Go 保留参数（DetailPageInfo.Title），本实现不使用

  // 解析更新时间："最后更新于：2025-08-16"，支持 2006-01-02 / 2006-1-2 / 2006/01/02 / 2006/1/2
  $('.mv_detail p').each((_i, el) => {
    const text = $(el).text().trim();
    if (!text.includes('最后更新于：')) return;
    const dateStr = text.replace('最后更新于：', '').trim();
    const m = dateStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (m) {
      info.updateTime = new Date(
        Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
      ).toISOString();
    }
  });

  // 解析磁力链接（.mv_down 区域，链接文本为文件名；密码字段为空）
  $('.mv_down a[href^="magnet:"]').each((_i, el) => {
    const href = $(el).attr('href');
    if (!href || href === '') return;
    info.magnetLinks.push({ type: 'magnet', url: href, password: '' });
    info.fileNames.push($(el).text().trim());
  });

  return info;
}

/** 从 content 提取详情页 URL（Go extractDetailURLFromContent） */
function extractDetailURLFromContent(content: string): string {
  return content.match(/详情页: (https?:\/\/[^\s|]+)/)?.[1] ?? '';
}

/** 第三步：并发获取详情页磁力链接（Go fetchDetailLinksSync） */
async function fetchDetailLinksSync(results: SearchResult[]): Promise<SearchResult[]> {
  if (results.length === 0) return results;

  const limit = createLimiter(DETAIL_CONCURRENCY);
  const additionalResults: SearchResult[] = [];
  await Promise.all(
    results.map(async (result, index) => {
      const detailURL = extractDetailURLFromContent(result.content);
      if (detailURL === '') return;
      const detailInfo = await fetchDetailPageInfo(detailURL, result.title);
      if (!detailInfo || detailInfo.magnetLinks.length === 0) return;

      // 为每个磁力链接创建独立的搜索结果，这样每个链接都有自己的 note
      const baseResult = { ...result };

      // 第一个链接更新原结果
      if (detailInfo.fileNames.length > 0) {
        results[index].title = `${baseResult.title}-${detailInfo.fileNames[0]}`;
      }
      results[index].links = [detailInfo.magnetLinks[0]];
      if (detailInfo.updateTime !== '') results[index].datetime = detailInfo.updateTime;

      // 其他链接创建新的搜索结果
      for (let i = 1; i < detailInfo.magnetLinks.length; i++) {
        additionalResults.push({
          message_id: `${baseResult.message_id}-${i + 1}`,
          unique_id: `${baseResult.unique_id}-${i + 1}`,
          channel: baseResult.channel,
          content: baseResult.content,
          tags: baseResult.tags,
          images: baseResult.images,
          links: [detailInfo.magnetLinks[i]],
          title: i < detailInfo.fileNames.length ? `${baseResult.title}-${detailInfo.fileNames[i]}` : baseResult.title,
          datetime: detailInfo.updateTime !== '' ? detailInfo.updateTime : baseResult.datetime,
        });
      }
    }),
  );

  // 等价于 Go 先占满信号量再合并：额外结果统一追加在尾部
  return [...results, ...additionalResults];
}

export const clxiong = definePlugin({
  name: 'clxiong',
  priority: 2,
  skipServiceFilter: true, // 磁力源（Go NewBaseAsyncPluginWithFilter 第3参 true）
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    // 第一步：POST 搜索获取 searchid
    const searchID = await getSearchID(keyword);
    // 第二步：GET 搜索结果
    const results = await getSearchResults(searchID);
    // 第三步：并发获取详情页磁力链接
    const enhanced = await fetchDetailLinksSync(results);
    // 应用关键词过滤
    return filterResultsByKeyword(enhanced, keyword);
  },
});
