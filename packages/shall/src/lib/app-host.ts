// 子应用打开方式：同源子路径使用顶级资源路径，外壳（含常驻音乐播放引擎）不卸载。
import { buildAppHref, type HostPluginRef } from './app-routes';

export type { HostPluginRef };

export function isExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** 返回承载页地址；无法匹配到插件（自定义链接）时返回 null，调用方按原样跳转 */
export function appHostHref(path: string, plugins: HostPluginRef[]): string | null {
  if (!path || isExternalUrl(path)) return null;
  return buildAppHref(path, plugins);
}
