// 音乐行「原始资源链接」构造：音乐下载任务在服务端只落 song（source/id/name/artist），
// 没有持久化的源 URL（音频直链是解析出的临时流，不落库）。
// 「复制链接=源地址」约定对音乐行的落地就是这首歌在音源站的页面地址——
// 由 song.source + song.id 构造。只收录可确信的源页格式；未收录/sources 缺失
// 返回空串，调用方回退到服务器落盘路径（此时复制语义标注「复制路径」）。
const SONG_PAGE_BUILDERS: Record<string, (id: string) => string> = {
  netease: (id) => `https://music.163.com/#/song?id=${encodeURIComponent(id)}`,
  qq: (id) => `https://y.qq.com/n/ryqq/songDetail/${encodeURIComponent(id)}`,
  kugou: (id) => `https://www.kugou.com/mixsong/${encodeURIComponent(id)}.html`,
  kuwo: (id) => `https://www.kuwo.cn/play_detail/${encodeURIComponent(id)}`,
  migu: (id) => `https://music.migu.cn/v3/music/song/${encodeURIComponent(id)}`,
  youtube: (id) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,
  bilibili: (id) => `https://www.bilibili.com/video/${encodeURIComponent(id)}`,
};

export function songPageUrlOf(
  song?: { id?: string | number; source?: string } | null,
): string {
  const id = song?.id;
  const source = String(song?.source ?? "").trim().toLowerCase();
  if (id === undefined || id === null || `${id}`.trim() === "") return "";
  const build = SONG_PAGE_BUILDERS[source];
  return build ? build(`${id}`.trim()) : "";
}

/** 音乐文件的服务器本地流直链（同源绝对地址）。
 *  只用于明确标注「播放链接」/「下载到本机」的动作——「复制链接」恒为
 *  源站歌曲页地址（songPageUrlOf），本地流直链不得冒充源链接（用户契约）。 */
export function musicServeUrl(path: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/music/api/download/serve?path=${encodeURIComponent(path)}`;
}
