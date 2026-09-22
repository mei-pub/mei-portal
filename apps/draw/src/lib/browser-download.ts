/**
 * 浏览器下载的安全封装（与 apps/tools 的 triggerBrowserDownload 对齐）。
 *
 * 绝对禁止在 click 的同一同步任务里 revokeObjectURL：浏览器下载子系统在
 * click 之后才异步读取 blob 数据，同步 revoke 会抢在取数前销毁数据源，
 * 下载项将永远停留在「下载中」。必须延迟释放（1000ms）。
 */
const DOWNLOAD_URL_REVOKE_DELAY_MS = 1000;

/** 以指定文件名触发浏览器下载 blob 内容，object URL 延迟释放。 */
export function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // 禁止同步 revoke —— 见 DOWNLOAD_URL_REVOKE_DELAY_MS 注释
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_REVOKE_DELAY_MS);
}
