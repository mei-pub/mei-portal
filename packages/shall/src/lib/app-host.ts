// 子应用打开方式：同源子路径统一走承载页 /app，外壳（含常驻音乐播放引擎）不卸载。
// 外部域名仍然新窗口打开。

export interface HostPluginRef {
  id: string;
  url: string;
}

export function isExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** 返回承载页地址；无法匹配到插件（自定义链接）时返回 null，调用方按原样跳转 */
export function appHostHref(path: string, plugins: HostPluginRef[]): string | null {
  if (!path || isExternalUrl(path)) return null;
  const matched = plugins.find((p) => p.url && !isExternalUrl(p.url) && path.startsWith(p.url));
  if (!matched) return null;
  return `/app?${new URLSearchParams({ app: matched.id, path }).toString()}`;
}
