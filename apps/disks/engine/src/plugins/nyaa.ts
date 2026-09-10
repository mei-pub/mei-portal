// Nyaa BT 搜索插件 —— Go plugin/nyaa 的复刻（磁力源，跳过 Service 层过滤）

import * as cheerio from 'cheerio';
import { fetchTextWithRetry } from '../http.ts';
import type { SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const SITE_URL = 'https://nyaa.si';
const VIEW_ID_REGEX = /\/view\/(\d+)/;

export const nyaa = definePlugin({
  name: 'nyaa',
  priority: 3,
  skipServiceFilter: true, // 磁力搜索插件：宽泛结果
  async search(keyword: string, ext: Record<string, unknown>): Promise<SearchResult[]> {
    // 支持英文搜索优化（ext.title_en）
    let searchKeyword = keyword;
    const titleEn = ext['title_en'];
    if (typeof titleEn === 'string' && titleEn !== '') searchKeyword = titleEn;

    const searchURL = `${SITE_URL}/?f=0&c=0_0&q=${encodeURIComponent(searchKeyword)}`;
    const html = await fetchTextWithRetry(
      searchURL,
      {
        timeoutMs: 10_000,
        headers: {
          'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
          Referer: SITE_URL,
        },
      },
      3,
    );

    const $ = cheerio.load(html);
    const table = $('table.torrent-list tbody');
    if (table.length === 0) return [];

    const results: SearchResult[] = [];
    table.find('tr').each((_i, row) => {
      const s = $(row);
      // 分类
      const category = s.find('td:nth-child(1) a').attr('title') ?? '';
      // 标题与详情链接
      const titleLink = s.find("td[colspan='2'] a");
      if (titleLink.length === 0) return;
      let title = titleLink.text().trim();
      if (title === '') title = titleLink.attr('title') ?? '';
      const detailHref = titleLink.attr('href') ?? '';
      const idMatch = detailHref.match(VIEW_ID_REGEX);
      if (!idMatch) return;

      // 磁力链接
      const magnetURL = s.find("td.text-center a[href^='magnet:']").attr('href');
      if (!magnetURL) return;

      // 文件大小
      const tds = s.find('td.text-center');
      const size = tds.eq(1).text().trim();

      // 发布时间
      const tsStr = s.find('td.text-center[data-timestamp]').attr('data-timestamp');
      const timestamp = tsStr ? parseInt(tsStr, 10) : 0;
      const datetime = timestamp > 0 ? new Date(timestamp * 1000).toISOString() : new Date().toISOString();

      // 种子统计（倒数第3/2/1个）
      let seeders = '0';
      let leechers = '0';
      let downloads = '0';
      if (tds.length >= 6) {
        seeders = tds.eq(tds.length - 3).text().trim();
        leechers = tds.eq(tds.length - 2).text().trim();
        downloads = tds.eq(tds.length - 1).text().trim();
      }

      const contentParts: string[] = [];
      if (category !== '') contentParts.push(`分类: ${category}`);
      if (size !== '') contentParts.push(`大小: ${size}`);
      contentParts.push(`做种: ${seeders}`, `下载: ${leechers}`, `完成: ${downloads}`);

      results.push({
        message_id: '',
        unique_id: `nyaa-${idMatch[1]}`,
        channel: '',
        datetime,
        title,
        content: contentParts.join(' | '),
        links: [{ type: 'magnet', url: magnetURL, password: '' }],
        tags: [category, `做种:${seeders}`, `下载:${leechers}`, `完成:${downloads}`].filter((t) => t !== ''),
      });
    });

    return filterResultsByKeyword(results, searchKeyword);
  },
});
