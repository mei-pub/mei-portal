// t.me 网页版搜索结果解析 —— Go util/parser_util.go 的复刻（goquery → cheerio）
import * as cheerio from 'cheerio';
import type { Link, SearchResult } from './types.ts';
import {
  ALIYUN_PAN_PATTERN,
  ALL_PAN_LINKS_PATTERN,
  BAIDU_PAN_PATTERN,
  GUANGYA_PAN_PATTERN,
  MOBILE_PAN_PATTERN,
  PAN115_PATTERN,
  PAN123_PATTERN,
  QUARK_PAN_PATTERN,
  TIANYI_PAN_PATTERN,
  UC_PAN_PATTERN,
  XUNLEI_PAN_PATTERN,
  clean115PanURL,
  clean123PanURL,
  cleanAliyunPanURL,
  cleanBaiduPanURL,
  cleanTianyiPanURL,
  cleanUCPanURL,
  extractNetDiskLinks,
  extractPassword,
  getLinkType,
  normalizeUrl,
} from './regex.ts';

/** 根据关键词裁剪标题，保留最前关键词前的部分（Go CutTitleByKeywords） */
export function cutTitleByKeywords(title: string, keywords: string[]): string {
  let minIdx = -1;
  for (const kw of keywords) {
    const idx = title.indexOf(kw);
    if (idx >= 0 && (minIdx === -1 || idx < minIdx)) minIdx = idx;
  }
  if (minIdx > 0) return title.slice(0, minIdx).trim();
  return title.trim();
}

function isSupportedLink(url: string): boolean {
  const u = url.toLowerCase();
  return (
    BAIDU_PAN_PATTERN.test(u) ||
    TIANYI_PAN_PATTERN.test(u) ||
    UC_PAN_PATTERN.test(u) ||
    PAN123_PATTERN.test(u) ||
    GUANGYA_PAN_PATTERN.test(u) ||
    QUARK_PAN_PATTERN.test(u) ||
    XUNLEI_PAN_PATTERN.test(u) ||
    PAN115_PATTERN.test(u) ||
    MOBILE_PAN_PATTERN.test(u) ||
    ALL_PAN_LINKS_PATTERN.test(u)
  );
}

function normalizeBaiduPanURL(url: string, password: string): string {
  url = cleanBaiduPanURL(url);
  if (url.includes('?pwd=')) return url;
  if (password !== '') {
    const pwd = password.length > 4 ? password.slice(0, 4) : password;
    return `${url}?pwd=${pwd}`;
  }
  return url;
}

/** 从消息 HTML 和文本中提取标题（Go extractTitle） */
function extractTitle(htmlContent: string, textContent: string): string {
  const brIndex = htmlContent.indexOf('<br');
  if (brIndex > 0) {
    const firstLineHTML = htmlContent.slice(0, brIndex);
    const firstLine = cheerio.load(`<div>${firstLineHTML}</div>`)('div').text().trim();
    if (firstLine.startsWith('名称：')) return firstLine.slice('名称：'.length).trim();
    if (!(firstLine.startsWith('#') && !firstLine.includes('名称'))) return firstLine;
  }

  const lines = textContent.split('\n');
  if (lines.length === 0) return '';
  const firstLine = lines[0].trim();

  if (firstLine.startsWith('#')) {
    for (const line of lines) {
      const l = line.trim();
      if (l.startsWith('名称：')) return l.slice('名称：'.length).trim();
    }
    if (lines.length > 1) {
      const secondLine = lines[1].trim();
      if (secondLine.startsWith('名称：')) return secondLine.slice('名称：'.length).trim();
      if (secondLine !== '' && !secondLine.startsWith('#')) return cutTitleByKeywords(secondLine, ['简介', '描述']);
    }
  }
  if (firstLine.startsWith('名称：')) return firstLine.slice('名称：'.length).trim();
  return cutTitleByKeywords(firstLine, ['简介', '描述']);
}

function extractFirstURL(text: string): string {
  let end = text.length;
  for (const sep of [' ', '\n', '\r']) {
    const idx = text.indexOf(sep);
    if (idx > 0 && idx < end) end = idx;
  }
  return text.slice(0, end).trim();
}

function extractWorkTitleBeforeColon(text: string): string {
  let t = text.trim();
  const netdiskNames = [
    '夸克网盘', '夸克云盘', '夸克',
    '百度网盘', '百度云盘', '百度云', '百度',
    '迅雷网盘', '迅雷云盘', '迅雷',
    '阿里云盘', '阿里网盘', '阿里云', '阿里',
    '天翼云盘', '天翼网盘', '天翼云', '天翼',
    'UC网盘', 'UC云盘', 'UC',
    '移动云盘', '移动云', '移动',
    '115网盘', '115云盘', '115',
    '123网盘', '123云盘', '123',
    'PikPak网盘', 'PikPak',
    '网盘', '云盘',
  ];
  for (const name of netdiskNames) {
    if (t.endsWith(name)) {
      t = t.slice(0, -name.length).trim();
      break;
    }
  }
  return t;
}

function isSingleLineFormat(lines: string[]): boolean {
  let count = 0;
  for (const line of lines) {
    const l = line.trim();
    if (l === '') continue;
    if (l.includes('丨') && l.includes('：') && (l.includes('http://') || l.includes('https://'))) count++;
  }
  return count > Math.floor(lines.length / 3);
}

/** 为每个链接提取作品标题（Go extractWorkTitlesForLinks） */
function extractWorkTitlesForLinks(links: Link[], messageText: string, defaultTitle: string): Link[] {
  if (links.length === 0) return links;
  // 链接数 <= 4：同一作品的不同网盘链接
  if (links.length <= 4) {
    return links.map((l) => ({ ...l, work_title: defaultTitle }));
  }

  const lines = messageText.split('\n');
  if (isSingleLineFormat(lines)) {
    // 单行格式："作品名丨网盘：链接" / "作品名 网盘：链接"
    const urlToWorkTitle = new Map<string, string>();
    for (const line of lines) {
      const l = line.trim();
      if (l === '') continue;
      let workTitle = '';
      let linkURL = '';
      if (l.includes('丨')) {
        const parts = l.split('丨');
        if (parts.length >= 2) {
          workTitle = parts[0].trim();
          const rest = parts[1];
          const idx = rest.indexOf('http');
          if (idx >= 0) linkURL = extractFirstURL(rest.slice(idx));
        }
      } else if (l.includes('：')) {
        const colonIdx = l.indexOf('：');
        if (colonIdx > 0) {
          workTitle = extractWorkTitleBeforeColon(l.slice(0, colonIdx));
          const after = l.slice(colonIdx + '：'.length);
          const idx = after.indexOf('http');
          if (idx >= 0) linkURL = extractFirstURL(after.slice(idx));
        }
      }
      if (workTitle !== '' && linkURL !== '') urlToWorkTitle.set(normalizeUrl(linkURL), workTitle);
    }
    return links.map((l) => ({
      ...l,
      work_title: urlToWorkTitle.get(normalizeUrl(l.url)) ?? defaultTitle,
    }));
  }
  // 其他格式：无法精确匹配时统一默认标题（与 Go extractWorkTitlesFromContext 一致）
  return links.map((l) => ({ ...l, work_title: defaultTitle }));
}

/** 解析 t.me/s/<channel> 搜索结果页（Go ParseSearchResults） */
export function parseSearchResults(html: string, channel: string): SearchResult[] {
  const $ = cheerio.load(html);
  const results: SearchResult[] = [];

  $('.tgme_widget_message_wrap').each((_i, wrap) => {
    const messageDiv = $(wrap).find('.tgme_widget_message');
    const dataPost = messageDiv.attr('data-post');
    if (!dataPost) return;
    const parts = dataPost.split('/');
    if (parts.length !== 2) return;
    const messageID = parts[1];

    const timeStr = messageDiv.find('.tgme_widget_message_date time').attr('datetime');
    if (!timeStr) return;
    const datetime = new Date(timeStr);
    if (Number.isNaN(datetime.getTime())) return;

    const messageTextElem = messageDiv.find('.tgme_widget_message_text');
    const messageHTML = messageTextElem.html() ?? '';
    const messageText = messageTextElem.text();

    const title = extractTitle(messageHTML, messageText);

    const links: Link[] = [];
    const foundLinks = new Set<string>();
    // 各网盘「基链 → 密码」映射（确保每链接只保留一个版本）
    const baiduLinkPasswords = new Map<string, string>();
    const tianyiLinkPasswords = new Map<string, string>();
    const ucLinkPasswords = new Map<string, string>();
    const pan123LinkPasswords = new Map<string, string>();
    const pan115LinkPasswords = new Map<string, string>();
    const aliyunLinkPasswords = new Map<string, string>();

    const recordSpecial = (linkType: string, linkURL: string, password: string) => {
      switch (linkType) {
        case 'baidu': {
          const base = linkURL.includes('?pwd=') ? linkURL.slice(0, linkURL.indexOf('?pwd=')) : linkURL;
          if (password !== '') baiduLinkPasswords.set(base, password);
          break;
        }
        case 'tianyi': {
          const base = cleanTianyiPanURL(linkURL);
          if (password !== '' || !tianyiLinkPasswords.has(base)) tianyiLinkPasswords.set(base, password);
          break;
        }
        case 'uc': {
          const base = cleanUCPanURL(linkURL);
          if (password !== '' || !ucLinkPasswords.has(base)) ucLinkPasswords.set(base, password);
          break;
        }
        case '123': {
          const base = clean123PanURL(linkURL);
          if (password !== '' || !pan123LinkPasswords.has(base)) pan123LinkPasswords.set(base, password);
          break;
        }
        case '115': {
          const base = clean115PanURL(linkURL);
          if (password !== '' || !pan115LinkPasswords.has(base)) pan115LinkPasswords.set(base, password);
          break;
        }
        case 'aliyun': {
          const base = cleanAliyunPanURL(linkURL);
          if (password !== '' || !aliyunLinkPasswords.has(base)) aliyunLinkPasswords.set(base, password);
          break;
        }
        default: {
          const normalized = normalizeUrl(linkURL);
          if (!foundLinks.has(normalized)) {
            foundLinks.add(normalized);
            links.push({ type: linkType, url: normalized, password });
          }
        }
      }
    };

    // 1. a 标签链接
    messageTextElem.find('a').each((_j, a) => {
      const href = $(a).attr('href');
      if (!href || !isSupportedLink(href)) return;
      const linkType = getLinkType(href);
      const password = extractPassword(messageText, href);
      recordSpecial(linkType, href, password);
    });

    // 2. 文本中提取的链接
    for (const linkURL of extractNetDiskLinks(messageText)) {
      const linkType = getLinkType(linkURL);
      const password = extractPassword(messageText, linkURL);
      recordSpecial(linkType, linkURL, password);
    }

    // 3. 各网盘归一化输出
    for (const [base, password] of baiduLinkPasswords) {
      const normalized = normalizeBaiduPanURL(base, password);
      if (!foundLinks.has(normalized)) {
        foundLinks.add(normalized);
        links.push({ type: 'baidu', url: normalized, password });
      }
    }
    for (const [base, password] of tianyiLinkPasswords) {
      const normalized = cleanTianyiPanURL(base);
      if (!foundLinks.has(normalized)) {
        foundLinks.add(normalized);
        links.push({ type: 'tianyi', url: normalized, password });
      }
    }
    for (const [base, password] of ucLinkPasswords) {
      const normalized = cleanUCPanURL(base);
      if (!foundLinks.has(normalized)) {
        foundLinks.add(normalized);
        links.push({ type: 'uc', url: normalized, password });
      }
    }
    for (const [base, password] of pan123LinkPasswords) {
      const normalized = clean123PanURL(base);
      if (!foundLinks.has(normalized)) {
        foundLinks.add(normalized);
        links.push({ type: '123', url: normalized, password });
      }
    }
    for (const [base, password] of pan115LinkPasswords) {
      const normalized = clean115PanURL(base);
      if (!foundLinks.has(normalized)) {
        foundLinks.add(normalized);
        links.push({ type: '115', url: normalized, password });
      }
    }
    for (const [base, password] of aliyunLinkPasswords) {
      const normalized = cleanAliyunPanURL(base);
      if (!foundLinks.has(normalized)) {
        foundLinks.add(normalized);
        links.push({ type: 'aliyun', url: normalized, password });
      }
    }

    // 标签（#话题）
    const tags: string[] = [];
    messageTextElem.find("a[href^='?q=%23']").each((_j, a) => {
      const tag = $(a).text();
      if (tag.startsWith('#')) tags.push(tag.slice(1));
    });

    // 图片（只从消息气泡区提取，排除头像）
    const images: string[] = [];
    const foundImages = new Set<string>();
    const bubble = messageDiv.find('.tgme_widget_message_bubble');
    bubble.find('.tgme_widget_message_photo_wrap').each((_j, photoWrap) => {
      const style = $(photoWrap).attr('style');
      if (style) {
        const m = style.match(/background-image:url\(['"]?([^'")]+)['"]?\)/);
        if (m && !foundImages.has(m[1])) {
          foundImages.add(m[1]);
          images.push(m[1]);
        }
      }
    });
    bubble.find('img').each((_j, img) => {
      const src = $(img).attr('src');
      if (src && !foundImages.has(src)) {
        foundImages.add(src);
        images.push(src);
      }
    });

    // 只保留含链接的消息
    if (links.length > 0) {
      const withTitles = extractWorkTitlesForLinks(links, messageText, title);
      results.push({
        message_id: messageID,
        unique_id: `${channel}_${messageID}`,
        channel,
        datetime: datetime.toISOString(),
        title,
        content: messageText,
        links: withTitles,
        tags,
        images,
      });
    }
  });

  return results;
}
