// 热门夸克资源插件 —— Go plugin/quarkres 的复刻
// 直连 squark.cc.cd 数据库（TG频道 @quark_res 的数据面），链接经实时有效性校验。

import { fetchText } from '../http.ts';
import type { SearchResult } from '../types.ts';
import { definePlugin } from './shared.ts';

const API_BASE = 'https://squark.cc.cd/api/search?kw=';

interface ApiLink {
  type: string;
  url: string;
  password: string;
}

interface ApiItem {
  unique_id: string;
  title: string;
  content: string;
  datetime: string;
  links: ApiLink[];
}

interface ApiResp {
  code: number;
  message: string;
  total: number;
  data: ApiItem[];
}

export const quarkres = definePlugin({
  name: 'quarkres',
  priority: 2, // 数据源质量良好，链接实时校验过
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    const body = await fetchText(API_BASE + encodeURIComponent(keyword), {
      timeoutMs: 15_000,
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Referer: 'https://squark.cc.cd/',
      },
    });
    const ar = JSON.parse(body) as ApiResp;
    if (ar.code !== 200) throw new Error(`[quarkres] API error: ${ar.message}`);

    const results: SearchResult[] = [];
    for (const item of ar.data ?? []) {
      const links = (item.links ?? [])
        .filter((l) => l.url.includes('pan.quark.cn')) // 本源只有夸克
        .map((l) => ({ type: 'quark', url: l.url, password: l.password, datetime: item.datetime }));
      if (links.length === 0) continue;
      results.push({
        message_id: '',
        unique_id: item.unique_id,
        channel: '', // 插件结果 Channel 必须为空
        datetime: item.datetime,
        title: item.title,
        content: item.content,
        links,
      });
    }
    return results;
  },
});
