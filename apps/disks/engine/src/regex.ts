// 网盘链接正则与清理 —— Go util/regex_util.go 的逐函数复刻

export const ALL_PAN_LINKS_PATTERN =
  /(?:magnet:\?xt=urn:btih:[a-zA-Z0-9]+|ed2k:\/\/\|file\|[^|]+\|\d+\|[A-Fa-f0-9]+\|\/?|https?:\/\/(?:(?:[\w.-]+\.)?(?:pan\.(?:baidu|quark)\.cn|(?:www\.)?(?:alipan|aliyundrive)\.com|drive\.uc\.cn|cloud\.189\.cn|(?:www\.)?(?:yun|caiyun)\.139\.com|caiyun\.feixin\.10086\.cn|(?:www\.)?123(?:684|685|912|pan|592)\.(?:com|cn)|115\.com|115cdn\.com|anxia\.com|pan\.xunlei\.com|mypikpak\.com|guangyapan\.com))(?:\/[^\s'"<>()]*)?)/i;

export const BAIDU_PAN_PATTERN = /https?:\/\/pan\.baidu\.com\/s\/[a-zA-Z0-9_-]+(\?pwd=[a-zA-Z0-9]{4})?/;
export const QUARK_PAN_PATTERN = /https?:\/\/pan\.quark\.cn\/s\/[a-zA-Z0-9]+/;
export const XUNLEI_PAN_PATTERN = /https?:\/\/pan\.xunlei\.com\/s\/[a-zA-Z0-9]+(\?pwd=[a-zA-Z0-9]{4})?(#)?/;
export const TIANYI_PAN_PATTERN = /https?:\/\/cloud\.189\.cn\/t\/[a-zA-Z0-9]+(%[0-9A-Fa-f]{2})*(（[^）]*）)?/;
export const UC_PAN_PATTERN = /https?:\/\/drive\.uc\.cn\/s\/[a-zA-Z0-9]+(\?public=\d)?/;
export const PAN123_PATTERN =
  /https?:\/\/(www\.)?123(684|865|685|912|pan|592)\.(com|cn)\/s\/[a-zA-Z0-9_-]+(\?(%E6%8F%90%E5%8F%96%E7%A0%81|提取码)[:：][a-zA-Z0-9]+)?/;
export const PAN115_PATTERN =
  /https?:\/\/(115\.com|115cdn\.com|anxia\.com)\/s\/[a-zA-Z0-9]+(\?password=[a-zA-Z0-9]{4})?(#)?/;
export const ALIYUN_PAN_PATTERN = /https?:\/\/(www\.)?(alipan|aliyundrive)\.com\/s\/[a-zA-Z0-9]+/;
export const GUANGYA_PAN_PATTERN = /https?:\/\/(www\.)?guangyapan\.com\/s\/[a-zA-Z0-9_-]+/;
export const MOBILE_PAN_PATTERN =
  /https?:\/\/((www\.)?yun\.139\.com\/shareweb\/#\/w\/i\/[a-zA-Z0-9]+|(www\.)?caiyun\.139\.com\/(w\/i\/[a-zA-Z0-9]+|m\/i\?[a-zA-Z0-9]+)[^\s<>"']*|caiyun\.feixin\.10086\.cn\/[a-zA-Z0-9]+)/;

export const PASSWORD_PATTERN = /(?:(?:提取|访问|提取密|密)码|pwd)[：:]\s*([a-zA-Z0-9]{4})([^a-zA-Z0-9]|$)/i;
export const URL_PASSWORD_PATTERN = /[?&]pwd=([a-zA-Z0-9]{4})([^a-zA-Z0-9]|$)/i;
export const BAIDU_PASSWORD_PATTERN =
  /(?:链接：.*?提取码：|密码：|提取码：|pwd=|pwd:|pwd：)([a-zA-Z0-9]{4})([^a-zA-Z0-9]|$)/i;

const P123_DOMAINS = ['123684.com', '123685.com', '123865.com', '123912.com', '123pan.com', '123pan.cn', '123592.com'];

/** 获取链接类型（Go GetLinkType） */
export function getLinkType(url: string): string {
  let u = url.toLowerCase();
  if (u.includes('链接：') || u.includes('链接:')) {
    u = u.split('链接')[1] ?? '';
    if (u.startsWith('：') || u.startsWith(':')) u = u.slice(1);
    u = u.trim();
  }
  if (u.includes('ed2k:')) return 'ed2k';
  if (u.startsWith('magnet:')) return 'magnet';
  if (u.includes('pan.baidu.com')) return 'baidu';
  if (u.includes('pan.quark.cn')) return 'quark';
  if (u.includes('alipan.com') || u.includes('aliyundrive.com')) return 'aliyun';
  if (u.includes('guangyapan.com')) return 'guangya';
  if (u.includes('cloud.189.cn')) return 'tianyi';
  if (u.includes('drive.uc.cn')) return 'uc';
  if (u.includes('caiyun.139.com') || u.includes('yun.139.com') || u.includes('caiyun.feixin.10086.cn')) return 'mobile';
  if (u.includes('115.com') || u.includes('115cdn.com') || u.includes('anxia.com')) return '115';
  if (u.includes('mypikpak.com')) return 'pikpak';
  if (u.includes('pan.xunlei.com')) return 'xunlei';
  if (P123_DOMAINS.some((d) => u.includes(d))) return '123';
  return 'others';
}

function trimAtMarkers(url: string, markers: string[]): string {
  let minEnd = url.length;
  for (const marker of markers) {
    const idx = url.indexOf(marker);
    if (idx > 0 && idx < minEnd) minEnd = idx;
  }
  return minEnd < url.length ? url.slice(0, minEnd) : url;
}

export function cleanBaiduPanURL(url: string): string {
  if (url.includes('https://pan.baidu.com/s/')) {
    url = url.slice(url.indexOf('https://pan.baidu.com/s/'));
    url = trimAtMarkers(url, [' ', '\n', '\t', '，', '。', '；', ';', ',']);
    if (url.includes('?pwd=')) {
      const pwdIdx = url.indexOf('?pwd=');
      if (pwdIdx >= 0 && url.length > pwdIdx + 5) {
        // 只保留 ?pwd= 后 4 位密码（?pwd=xxxx 共 9 字符）
        const end = pwdIdx + 9;
        return end <= url.length ? url.slice(0, end) : url;
      }
    }
  }
  return url;
}

export function cleanTianyiPanURL(url: string): string {
  if (url.includes('https://cloud.189.cn/t/')) {
    url = url.slice(url.indexOf('https://cloud.189.cn/t/'));
    url = trimAtMarkers(url, [' ', '\n', '\t', '，', '。', '；', ';', ',', '实时', '天翼', '更多']);
    try {
      url = decodeURIComponent(url);
    } catch {
      /* 解码失败保留原样 */
    }
  }
  return url;
}

export function cleanUCPanURL(url: string): string {
  if (url.includes('https://drive.uc.cn/s/')) {
    url = url.slice(url.indexOf('https://drive.uc.cn/s/'));
    url = trimAtMarkers(url, [' ', '\n', '\t', '，', '。', '；', ';', ',', '网盘', '123', '夸克', '阿里', '百度']);
    if (url.includes('?public=')) {
      const idx = url.indexOf('?public=');
      if (idx > 0) return idx + 9 <= url.length ? url.slice(0, idx + 9) : url.slice(0, idx + 8);
    }
  }
  return url;
}

export function clean123PanURL(url: string): string {
  const domainHit = P123_DOMAINS.find((d) => url.includes(`${d}/s/`));
  if (!domainHit) return url;
  const startIdx = url.indexOf(`${domainHit}/s/`);
  const hasProtocol = url.startsWith('http://') || url.startsWith('https://');
  if (!hasProtocol) {
    url = 'https://' + url.slice(startIdx);
  } else if (startIdx > 0) {
    const protocolIdx = url.indexOf('://');
    url = url.slice(0, protocolIdx + 3) + url.slice(startIdx);
  }
  url = trimAtMarkers(url, [
    ' ',
    '\n',
    '\t',
    '，',
    '。',
    '；',
    ';',
    ',',
    '📁',
    '🔍',
    '标签',
    '🏷',
    '📎',
    '🔗',
    '📌',
    '📋',
    '📂',
    '🗂️',
    '🔖',
    '📚',
    '🔒',
    '🔓',
  ]);
  return url.replace('%E6%8F%90%E5%8F%96%E7%A0%81', '提取码');
}

export function clean115PanURL(url: string): string {
  const hit = ['115.com/s/', '115cdn.com/s/', 'anxia.com/s/'].find((d) => url.includes(d));
  if (!hit) return url;
  const startIdx = url.indexOf(hit);
  const hasProtocol = url.startsWith('http://') || url.startsWith('https://');
  if (!hasProtocol) {
    url = 'https://' + url.slice(startIdx);
  } else if (startIdx > 0) {
    const protocolIdx = url.indexOf('://');
    url = url.slice(0, protocolIdx + 3) + url.slice(startIdx);
  }
  if (url.includes('?password=')) {
    const pwdIdx = url.indexOf('?password=');
    if (pwdIdx > 0 && pwdIdx + 14 <= url.length) return url.slice(0, pwdIdx + 14);
  }
  const hashIdx = url.indexOf('#');
  if (hashIdx > 0) return url.slice(0, hashIdx);
  return url;
}

export function cleanAliyunPanURL(url: string): string {
  const hit = ['www.alipan.com/s/', 'alipan.com/s/', 'www.aliyundrive.com/s/', 'aliyundrive.com/s/'].find((d) =>
    url.includes(d),
  );
  if (!hit) return url;
  const startIdx = url.indexOf(hit);
  const hasProtocol = url.startsWith('http://') || url.startsWith('https://');
  if (!hasProtocol) {
    url = 'https://' + url.slice(startIdx);
  } else if (startIdx > 0) {
    const protocolIdx = url.indexOf('://');
    url = url.slice(0, protocolIdx + 3) + url.slice(startIdx);
  }
  return trimAtMarkers(url, [
    ' ',
    '\n',
    '\t',
    '，',
    '。',
    '；',
    ';',
    ',',
    '📁',
    '🔍',
    '标签',
    '🏷',
    '📎',
    '🔗',
    '📌',
    '📋',
    '📂',
    '🔖',
    '📚',
    '🔒',
    '🔓',
  ]);
}

export function cleanMobilePanURL(url: string): string {
  const prefixes = [
    'https://yun.139.com/shareweb/#/w/i/',
    'http://yun.139.com/shareweb/#/w/i/',
    'https://www.yun.139.com/shareweb/#/w/i/',
    'http://www.yun.139.com/shareweb/#/w/i/',
    'https://caiyun.139.com/w/i/',
    'http://caiyun.139.com/w/i/',
    'https://www.caiyun.139.com/w/i/',
    'http://www.caiyun.139.com/w/i/',
    'https://caiyun.139.com/m/i?',
    'http://caiyun.139.com/m/i?',
    'https://www.caiyun.139.com/m/i?',
    'http://www.caiyun.139.com/m/i?',
    'https://caiyun.feixin.10086.cn/',
    'http://caiyun.feixin.10086.cn/',
  ];
  const prefix = prefixes.find((p) => url.includes(p));
  if (!prefix) return url;
  url = url.slice(url.indexOf(prefix));
  url = trimAtMarkers(url, [' ', '\n', '\t', '，', '。', '；', ';', ',', '访问码', '提取码', '密码', '链接', '网盘']);
  return url.trim();
}

function isValidPassword(password: string): boolean {
  return /^[a-zA-Z0-9]+$/.test(password);
}

/** 提取链接密码（Go ExtractPassword） */
export function extractPassword(content: string, url: string): string {
  // 天翼云盘访问码：（访问码：xxxx）或 URL 编码形式
  if (url.includes('cloud.189.cn')) {
    const m = url.match(/(?:（访问码：|%EF%BC%88%E8%AE%BF%E9%97%AE%E7%A0%81%EF%BC%9A)([a-zA-Z0-9]+)(?:）|%EF%BC%89)/);
    if (m) return m[1];
  }
  // 迅雷网盘 pwd 参数
  if (url.includes('pan.xunlei.com') && url.includes('?pwd=')) {
    const m = url.match(/\?pwd=([a-zA-Z0-9]{4})/);
    if (m) return m[1];
  }
  // URL 中的密码
  const urlMatch = url.match(URL_PASSWORD_PATTERN);
  if (urlMatch) return urlMatch[1];
  // 115 网盘 password 参数
  if ((url.includes('115.com') || url.includes('115cdn.com') || url.includes('anxia.com')) && url.includes('password=')) {
    const m = url.match(/password=([a-zA-Z0-9]{4})/);
    if (m) return m[1];
  }
  // 123 网盘提取码（URL 内）
  if (P123_DOMAINS.some((d) => url.includes(d)) && (url.includes('提取码') || url.includes('%E6%8F%90%E5%8F%96%E7%A0%81'))) {
    const m = url.match(/(?:提取码|%E6%8F%90%E5%8F%96%E7%A0%81)[:：]([a-zA-Z0-9]+)/);
    if (m) return m[1];
    const parts = url.split('提取码');
    if (parts.length > 1) {
      const rest = parts[1];
      const codeStart = rest.search(/[:：]/);
      if (codeStart >= 0 && codeStart + 1 < rest.length) {
        let code = rest.slice(codeStart + 1).trim();
        const endIdx = code.search(/[ \t\n\r，。；;,)，]/);
        if (endIdx > 0) code = code.slice(0, endIdx);
        code = code.trim();
        if (code !== '' && code.length <= 6 && isValidPassword(code)) return code;
      }
    }
  }
  // 内容中的提取码
  if (content.includes('提取码')) {
    const parts = content.split('提取码');
    for (const part of parts) {
      if (part === '') continue;
      const codeStart = part.search(/[:：]/);
      if (codeStart >= 0 && codeStart + 1 < part.length) {
        let code = part.slice(codeStart + 1).trim();
        const endIdx = code.search(/[ \t\n\r，。；;,]/);
        if (endIdx > 0) code = code.slice(0, endIdx);
        else if (code.length > 6) {
          // 无明显结束标记时假设 4-6 位
          for (let i = 4; i <= 6 && i <= code.length; i++) {
            if (isValidPassword(code.slice(0, i))) {
              code = code.slice(0, i);
              break;
            }
          }
          if (code.length > 6) code = code.slice(0, 4);
        }
        code = code.trim();
        if (code !== '' && isValidPassword(code)) return code;
      }
    }
  }
  // 百度网盘特定格式
  if (url.toLowerCase().includes('pan.baidu.com')) {
    const m = content.match(BAIDU_PASSWORD_PATTERN);
    if (m) return m[1];
  }
  // 通用密码提取
  const general = content.match(PASSWORD_PATTERN);
  if (general) return general[1];
  return '';
}

function normalizeURLForComparison(url: string): string {
  const idx = url.indexOf('://');
  if (idx >= 0) url = url.slice(idx + 3);
  return url.replace('%E6%8F%90%E5%8F%96%E7%A0%81', '提取码');
}

function matchAll(text: string, pattern: RegExp): string[] {
  return text.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g')) ?? [];
}

/** 从文本中提取所有网盘链接（Go ExtractNetDiskLinks） */
export function extractNetDiskLinks(text: string): string[] {
  const links: string[] = [];
  const seen = (cleanURL: string, mode: 'exact' | 'contains' = 'exact'): boolean => {
    for (const existing of links) {
      const a = normalizeURLForComparison(existing);
      const b = normalizeURLForComparison(cleanURL);
      if (mode === 'exact' ? a === b : a === b || a.includes(b) || b.includes(a)) return true;
    }
    return false;
  };
  const push = (url: string, mode: 'exact' | 'contains' = 'exact') => {
    let u = url;
    if (u.endsWith('https')) u = u.slice(0, -5);
    if (u !== '' && !seen(u, mode)) links.push(u);
  };

  for (const m of matchAll(text, BAIDU_PAN_PATTERN)) push(cleanBaiduPanURL(m));
  for (const m of matchAll(text, TIANYI_PAN_PATTERN)) push(cleanTianyiPanURL(m));
  for (const m of matchAll(text, UC_PAN_PATTERN)) push(cleanUCPanURL(m));
  for (const m of matchAll(text, PAN123_PATTERN)) push(clean123PanURL(m));
  for (const m of matchAll(text, PAN115_PATTERN)) push(clean115PanURL(m));
  for (const m of matchAll(text, ALIYUN_PAN_PATTERN)) push(cleanAliyunPanURL(m));
  for (const m of matchAll(text, GUANGYA_PAN_PATTERN)) push(m.trim());
  for (const m of matchAll(text, MOBILE_PAN_PATTERN)) push(cleanMobilePanURL(m));
  for (const m of matchAll(text, QUARK_PAN_PATTERN)) push(m, 'contains');
  for (const m of matchAll(text, XUNLEI_PAN_PATTERN)) push(m, 'contains');

  // 通用模式兜底（跳过已单独处理的网盘域名）
  const handled = [
    'pan.baidu.com',
    'pan.quark.cn',
    'pan.xunlei.com',
    'guangyapan.com',
    'cloud.189.cn',
    'drive.uc.cn',
    'yun.139.com',
    'caiyun.139.com',
    'caiyun.feixin.10086.cn',
    ...P123_DOMAINS,
  ];
  for (const m of matchAll(text, ALL_PAN_LINKS_PATTERN)) {
    if (handled.some((d) => m.includes(d))) continue;
    push(m);
  }
  return links;
}

/** URL 标准化：解码编码中文用于去重（Go normalizeUrl） */
export function normalizeUrl(rawUrl: string): string {
  try {
    return decodeURIComponent(rawUrl);
  } catch {
    return rawUrl;
  }
}
