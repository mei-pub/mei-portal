/**
 * 本地音乐源提供方 —— 移植自 coco-downloader（github.com/markcxx/coco-downloader）
 *
 * 背景：上游 music-api.gdstudio.xyz 已下线 qq/kugou/migu/ximalaya 源（请求返回
 * 400 "Value of `source` is not supported"），kuwo 源也只能搜索无法解析播放地址。
 * 这里在服务端直连各平台官方/可用接口实现这些源：
 *   - qq    ：vkeys 腾讯音乐接口（搜索 + 播放地址 + 封面）
 *   - kugou ：酷狗官方搜索 + 90svip/尘归归/海棠 播放地址降级链 + 官方歌词
 *   - kuwo  ：仅覆盖播放地址（antiserver 直链），搜索/封面/歌词仍走 gdstudio
 *   - migu  ：咪咕官方 c.musicapp.migu.cn 接口（搜索 + listen-url 播放地址）
 *
 * 返回结构与 gdstudio 保持一致，前端无感知：
 *   search(name, count, page) → [{id,name,artist[],album,pic_id,url_id,lyric_id,source}]
 *   url(id)                   → {url, br, size}
 *   lyric(id)                 → {lrc}
 *   pic(id)                   → 封面 URL 字符串（路由层 302 跳转）
 */

const qq = require('./qq');
const kugou = require('./kugou');
const kuwo = require('./kuwo');
const migu = require('./migu');

const providers = {
  qq,
  kugou,
  kuwo,
  migu,
};

/** 获取本地源提供方（未实现返回 null，由路由层回退到 gdstudio 上游） */
function getProvider(source) {
  return providers[source] || null;
}

module.exports = { getProvider };
