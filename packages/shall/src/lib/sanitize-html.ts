// 最小 HTML 白名单 sanitizer —— 纯字符串实现，无第三方依赖、无 DOM 依赖
//（PortalClient 是 'use client' 组件但仍会 SSR，Node 环境没有 DOMParser）。
// 用于面板「页脚自定义 HTML」这类管理员可编辑但会注入页面的内容：
// 剥离脚本载体与事件属性，保留基本排版标签，防存储型 XSS。

/** 允许保留的标签（其余标签剥掉、保留其内部文本） */
const ALLOWED_TAGS = new Set([
  'a', 'b', 'strong', 'i', 'em', 'u', 's', 'small', 'sub', 'sup',
  'br', 'hr', 'p', 'div', 'span', 'blockquote', 'pre', 'code',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'img', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
]);

/** 整块连内容一起删除的危险元素（脚本/样式/嵌套文档/表单载体） */
const DROP_WITH_CONTENT = ['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'form'];

/** 各标签允许的属性；style 值单独消毒 */
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'title', 'target', 'rel']),
  img: new Set(['src', 'alt', 'title', 'width', 'height', 'loading']),
};
const GLOBAL_ATTRS = new Set(['style', 'class']);

/** URL 属性 scheme 白名单：http(s)/mailto/相对路径/锚点；img 额外放行 data:image/ */
function safeUrl(value: string, isImgSrc: boolean): boolean {
  const v = value.trim().toLowerCase().replace(/[\u0000-\u001f]/g, '');
  if (v.startsWith('javascript:') || v.startsWith('vbscript:')) return false;
  if (v.startsWith('data:')) return isImgSrc && /^data:image\//.test(v);
  if (/^(https?:|mailto:|\/|#|\.\/|\.\.\/)/.test(v)) return true;
  // 无 scheme 的裸值（如 www.example.com）按相对路径放行
  return !/^[a-z][a-z0-9+.-]*:/.test(v);
}

/** style 属性值消毒：禁止 expression/url()/import 等可执行向量，只留常规声明字符 */
function safeStyle(value: string): string {
  if (/expression|url\s*\(|@import|javascript:/i.test(value)) return '';
  // 仅放行常见声明字符，杜绝借实体/控制字符绕过
  return /^[a-zA-Z0-9;:%#.,()\s\-_'"]*$/.test(value) ? value : '';
}

/** 解析并消毒属性串，返回形如 ' href="…"' 的安全片段 */
function sanitizeAttrs(tag: string, attrText: string): string {
  const allowed = ALLOWED_ATTRS[tag] || new Set<string>();
  const out: string[] = [];
  const re = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrText)) !== null) {
    const name = m[1].toLowerCase();
    const value = m[3] ?? m[4] ?? m[5] ?? '';
    if (/^on/i.test(name)) continue; // 事件属性一律剔除
    if (!allowed.has(name) && !GLOBAL_ATTRS.has(name)) continue;
    if (name === 'href' || name === 'src') {
      if (!safeUrl(value, tag === 'img' && name === 'src')) continue;
    }
    if (name === 'style') {
      const s = safeStyle(value);
      if (!s) continue;
      out.push(` style="${s.replace(/"/g, '&quot;')}"`);
      continue;
    }
    if (name === 'target' && value !== '_blank') continue;
    if (name === 'rel') continue; // rel 由下方的 _blank 补丁统一写入
    out.push(` ${name}="${value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`);
  }
  // 新窗口外链强制带上 noopener，防 tabnabbing
  if (tag === 'a' && out.some((a) => a.startsWith(' target='))) {
    out.push(' rel="noopener noreferrer"');
  }
  return out.join('');
}

/**
 * 白名单消毒：返回可直接用于 dangerouslySetInnerHTML 的 HTML。
 * 规则：危险元素整块删除；白名单外标签剥壳留文本；事件属性/javascript: URL 一律剔除。
 */
export function sanitizeHtml(input: string): string {
  if (!input) return '';
  let html = String(input);
  // 注释先删（防止借注释拆分标签绕过后续匹配）
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  // 危险元素连内容整块删除（非贪婪配对，逐标签处理）
  for (const tag of DROP_WITH_CONTENT) {
    const paired = new RegExp(`<\\s*${tag}\\b[^>]*>[\\s\\S]*?<\\s*/\\s*${tag}\\s*>`, 'gi');
    html = html.replace(paired, '');
    html = html.replace(new RegExp(`<\\s*/?\\s*${tag}\\b[^>]*>`, 'gi'), '');
  }
  // 逐标签白名单过滤：匹配不到白名单的标签剥壳（保留内部文本）
  html = html.replace(
    /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g,
    (_m, closing: string, rawTag: string, attrText: string) => {
      const tag = rawTag.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) return '';
      if (closing) return `</${tag}>`;
      const voidTag = tag === 'br' || tag === 'hr' || tag === 'img';
      const attrs = sanitizeAttrs(tag, attrText);
      return `<${tag}${attrs}${voidTag ? ' /' : ''}>`;
    }
  );
  return html;
}
