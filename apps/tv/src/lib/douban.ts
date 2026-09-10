import { getCacheTime } from './config';
import { cachedFetchJson } from './api-cache';

/**
 * 通用的豆瓣数据获取函数（带进程内存缓存）
 * - 自托管无 CDN，HTTP 缓存头不生效；每次实时抓取是页面打开慢的主因
 * - TTL 取站点配置缓存时间，封顶 30 分钟（热门榜单半小时内足够新鲜）
 * - 同参数并发请求自动去重；上游失败不缓存、下次重试
 * @param url 请求的URL
 * @returns Promise<T> 返回指定类型的数据
 */
export async function fetchDoubanData<T>(url: string): Promise<T> {
  const cacheTime = await getCacheTime();
  const ttlMs = Math.min(cacheTime, 1800) * 1000;
  return cachedFetchJson<T>(`douban:${url}`, ttlMs, async () => {
    // 添加超时控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时

    // 设置请求选项，包括信号和头部
    const fetchOptions = {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        Referer: 'https://movie.douban.com/',
        Accept: 'application/json, text/plain, */*',
        Origin: 'https://movie.douban.com',
      },
    };

    try {
      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  });
}
