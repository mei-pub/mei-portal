// 消息正文中的「链接-标题」配对启发式 —— Go service/search_service.go L628-987 的逐函数复刻
// 这是 merged_by_type 分组质量的核心：为消息里每个网盘链接找到它对应的作品标题。

import {
  ALIYUN_PAN_PATTERN,
  BAIDU_PAN_PATTERN,
  MOBILE_PAN_PATTERN,
  PAN115_PATTERN,
  PAN123_PATTERN,
  QUARK_PAN_PATTERN,
  TIANYI_PAN_PATTERN,
  UC_PAN_PATTERN,
  XUNLEI_PAN_PATTERN,
  normalizeUrl,
} from '../regex.ts';

const LINK_REGEX = /https?:\/\/[^\s"']+/;

/** 标题清理：去前缀词与表情符号（Go cleanTitle） */
export function cleanTitle(title: string): string {
  let t = title.trim();
  for (const prefix of ['名称：', '标题：', '片名：', '名称:', '标题:', '片名:']) {
    if (t.startsWith(prefix)) {
      t = t.slice(prefix.length);
      break;
    }
  }
  // 移除表情符号与特殊符号类字符（\p{So}\p{Sk}）
  t = t.replace(/[\p{So}\p{Sk}]/gu, '');
  return t.trim();
}

/** 是否标准链接行（Go isLinkLine） */
function isLinkLine(line: string): boolean {
  const lower = line.toLowerCase();
  return (
    lower.startsWith('链接：') ||
    lower.startsWith('地址：') ||
    lower.startsWith('资源地址：') ||
    lower.startsWith('网盘：') ||
    lower.startsWith('网盘地址：') ||
    lower.startsWith('链接:')
  );
}

/** 是否链接前缀词/网盘名称（Go isLinkPrefix） */
function isLinkPrefix(text: string): boolean {
  const t = text.toLowerCase().trim();
  const standard = ['链接', '地址', '资源地址', '网盘', '网盘地址'];
  if (standard.includes(t)) return true;
  const cloudDiskNames = [
    '夸克', '夸克网盘', 'quark', '夸克云盘',
    '百度', '百度网盘', 'baidu', '百度云', 'bdwp', 'bdpan',
    '迅雷', '迅雷网盘', 'xunlei', '迅雷云盘',
    '115', '115网盘', '115云盘',
    '123', '123pan', '123网盘', '123云盘',
    '阿里', '阿里云', '阿里云盘', 'aliyun', 'alipan', '阿里网盘',
    '光鸭', '光鸭云盘', '光鸭网盘', 'guangya',
    '天翼', '天翼云', '天翼云盘', 'tianyi', '天翼网盘',
    'uc', 'uc网盘', 'uc云盘',
    '移动', '移动云', '移动云盘', 'caiyun', '彩云',
    'pikpak', 'pikpak网盘',
  ];
  return cloudDiskNames.includes(t);
}

/** 从链接行提取可能标题（"标题：链接" 格式，Go extractTitleFromLinkLine） */
function extractTitleFromLinkLine(line: string): string {
  const full = line.split('：', 2);
  if (full.length === 2 && !full[0].includes('http') && !isLinkPrefix(full[0])) return cleanTitle(full[0]);
  const half = line.split(':', 2);
  if (half.length === 2 && !half[0].includes('http') && !isLinkPrefix(half[0])) return cleanTitle(half[0]);
  return '';
}

/** 从链接前的文本提取标题（Go extractTitleBeforeLink） */
function extractTitleBeforeLink(text: string): string {
  const t = text.trim();
  const idx = t.indexOf('链接：');
  if (idx > 0) return cleanTitle(t.slice(0, idx));
  const titlePattern = /([^链地资网\s]+?(?:\([^)]+\))?(?:\s*\d+K)?(?:\s*臻彩)?(?:\s*MAX)?(?:\s*HDR)?(?:\s*更(?:新)?\d+集))$/;
  const m = t.match(titlePattern);
  if (m) return cleanTitle(m[1]);
  return cleanTitle(t);
}

/** 有换行符的配对（Go extractLinkTitlePairsWithNewlines） */
function extractLinkTitlePairsWithNewlines(content: string): Map<string, string> {
  const linkTitleMap = new Map<string, string>();
  const lines = content.split('\n');

  // 第一遍：识别标题-链接对
  let lastTitle = '';
  let lastTitleIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;

    const links = line.match(new RegExp(LINK_REGEX.source, 'g')) ?? [];
    if (links.length > 0) {
      const standard = isLinkLine(line);
      if (standard && lastTitle !== '') {
        for (const link of links) linkTitleMap.set(link, lastTitle);
      } else if (!standard) {
        const titleFromLine = extractTitleFromLinkLine(line);
        if (titleFromLine !== '') {
          for (const link of links) linkTitleMap.set(link, titleFromLine);
        } else if (lastTitle !== '') {
          for (const link of links) linkTitleMap.set(link, lastTitle);
        }
      }
    } else {
      // 当前行无链接，可能是标题行：下一行是链接行则当前行是标题
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        if (isLinkLine(nextLine) || LINK_REGEX.test(nextLine)) {
          lastTitle = cleanTitle(line);
          lastTitleIndex = i;
        }
      } else {
        lastTitle = cleanTitle(line);
        lastTitleIndex = i;
      }
    }
  }

  // 第二遍：未配对链接向最近上文标题对齐
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;
    const links = line.match(new RegExp(LINK_REGEX.source, 'g')) ?? [];
    if (links.length === 0) continue;
    for (const link of links) {
      if (linkTitleMap.has(link)) continue;
      let nearestTitle = '';
      for (let j = i - 1; j >= 0; j--) {
        if (
          j === lastTitleIndex ||
          (j + 1 < lines.length && LINK_REGEX.test(lines[j + 1]) && !LINK_REGEX.test(lines[j]))
        ) {
          const candidate = cleanTitle(lines[j]);
          if (candidate !== '') {
            nearestTitle = candidate;
            break;
          }
        }
      }
      if (nearestTitle !== '') linkTitleMap.set(link, nearestTitle);
    }
  }

  return linkTitleMap;
}

/** 无换行符的配对：用各网盘精确正则定位链接、按位置切割（Go extractLinkTitlePairsWithoutNewlines） */
function extractLinkTitlePairsWithoutNewlines(content: string): Map<string, string> {
  const linkTitleMap = new Map<string, string>();
  const linkPatterns = [
    TIANYI_PAN_PATTERN,
    BAIDU_PAN_PATTERN,
    QUARK_PAN_PATTERN,
    ALIYUN_PAN_PATTERN,
    MOBILE_PAN_PATTERN,
    UC_PAN_PATTERN,
    PAN123_PATTERN,
    PAN115_PATTERN,
    XUNLEI_PAN_PATTERN,
  ];

  // 收集所有链接及位置
  const allLinks: Array<{ url: string; pos: number }> = [];
  for (const pattern of linkPatterns) {
    const matches = content.match(new RegExp(pattern.source, 'g')) ?? [];
    for (const match of matches) {
      const pos = content.indexOf(match);
      if (pos >= 0) allLinks.push({ url: match, pos });
    }
  }
  allLinks.sort((a, b) => a.pos - b.pos);

  // URL 标准化去重（保持出现顺序）
  const uniqueNormalized = new Set<string>();
  const links: string[] = [];
  for (const { url } of allLinks) {
    const normalized = normalizeUrl(url);
    if (!uniqueNormalized.has(normalized)) {
      uniqueNormalized.add(normalized);
      links.push(url);
    }
  }
  if (links.length === 0) return linkTitleMap;

  // 用链接位置切割内容为段落
  const segments: string[] = new Array(links.length + 1).fill('');
  let lastPos = 0;
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const idx = content.slice(lastPos).indexOf(link);
    if (idx === -1) continue;
    const pos = idx + lastPos;
    if (pos > lastPos) segments[i] = content.slice(lastPos, pos);
    lastPos = pos + link.length;
  }
  if (lastPos < content.length) segments[links.length] = content.slice(lastPos);

  // 每个链接的标题在它所在段落的末尾
  for (let i = 0; i < links.length; i++) {
    const title = extractTitleBeforeLink(segments[i]);
    if (title !== '') linkTitleMap.set(links[i], title);
  }
  return linkTitleMap;
}

/** 提取链接-标题对应关系（Go extractLinkTitlePairs 入口） */
export function extractLinkTitlePairs(content: string): Map<string, string> {
  if (content.includes('\n')) return extractLinkTitlePairsWithNewlines(content);
  return extractLinkTitlePairsWithoutNewlines(content);
}
