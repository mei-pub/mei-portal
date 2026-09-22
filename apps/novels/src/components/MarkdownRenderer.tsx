"use client";

import { useMemo, useRef } from "react";

interface MarkdownRendererProps {
  content: string;
  style?: React.CSSProperties;
  className?: string;
  /** 内联字体样式，会应用到所有文本元素上（用于iOS Safari兼容） */
  textStyle?: React.CSSProperties;
}

/**
 * 完整 Markdown 渲染器
 * 支持：标题、粗体、斜体、删除线、图片、链接、代码(行内/块)、
 *       引用、有序/无序列表、表格、分隔线、段落
 */
export default function MarkdownRenderer({ content, style, className, textStyle }: MarkdownRendererProps) {
  // Use ref to cache the last rendered HTML to avoid unnecessary re-renders
  const lastHtmlRef = useRef<string>("");
  const lastContentRef = useRef<string>("");

  // Convert textStyle to inline CSS string for elements
  const textStyleString = useMemo(() => {
    if (!textStyle) return "";
    const styles: string[] = [];
    if (textStyle.fontSize) styles.push(`font-size:${textStyle.fontSize}`);
    if (textStyle.fontFamily) styles.push(`font-family:${textStyle.fontFamily}`);
    if (textStyle.lineHeight) styles.push(`line-height:${textStyle.lineHeight}`);
    return styles.join(";") + ";";
  }, [textStyle]);

  const html = useMemo(() => {
    // Skip if content hasn't changed
    if (content === lastContentRef.current && lastHtmlRef.current) {
      return lastHtmlRef.current;
    }

    if (!content) {
      lastContentRef.current = "";
      lastHtmlRef.current = "";
      return "";
    }

    const result = parseMarkdown(content, textStyleString);

    lastContentRef.current = content;
    lastHtmlRef.current = result;
    return result;
  }, [content, textStyleString]);

  return (
    <div className={className} style={style} dangerouslySetInnerHTML={{ __html: html }} />
  );
}

function parseMarkdown(content: string, textStyle: string = ""): string {
  // Split into lines for block-level processing
  const lines = content.split("\n");
  const blocks: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block: ```lang ... ```
    if (line.trimStart().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(escapeHtml(lines[i]));
        i++;
      }
      i++; // skip closing ```
      blocks.push(`<pre style="background:#f8f9fa;border-radius:6px;padding:12px 16px;margin:12px 0;overflow-x:auto;border:1px solid #e5e7eb"><code${lang ? ` class="language-${lang}"` : ""}>${codeLines.join("<br/>")}</code></pre>`);
      continue;
    }

    // Empty line → paragraph break
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const sizes = ["1.6em", "1.4em", "1.2em", "1.1em", "1em", "0.9em"];
      blocks.push(`<h${level} style="font-size:${sizes[level - 1]};font-weight:700;margin:1em 0 0.5em;line-height:1.3${textStyle ? ";" + textStyle : ""}">${inlineFormat(headingMatch[2])}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line.trim())) {
      blocks.push(`<hr style="border:none;border-top:1px solid #e5e7eb;margin:1.5em 0" />`);
      i++;
      continue;
    }

    // Blockquote
    if (line.trimStart().startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i].trimStart().startsWith(">") || (lines[i].trim() === "" && i + 1 < lines.length && lines[i + 1].trimStart().startsWith(">")))) {
        const qLine = lines[i].replace(/^>\s?/, "");
        quoteLines.push(qLine);
        i++;
      }
      blocks.push(`<blockquote style="border-left:3px solid #d1d5db;padding:4px 12px;margin:12px 0;color:#6b7280;background:#f9fafb;border-radius:0 4px 4px 0${textStyle ? ";" + textStyle : ""}">${inlineFormat(quoteLines.join("<br/>"))}</blockquote>`);
      continue;
    }

    // Unordered list
    if (/^[\s]*[-*+]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[\s]*[-*+]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[\s]*[-*+]\s/, ""));
        i++;
      }
      blocks.push(`<ul style="margin:8px 0;padding-left:24px;list-style:disc">${items.map(it => `<li style="margin:2px 0${textStyle ? ";" + textStyle : ""}">${inlineFormat(it)}</li>`).join("")}</ul>`);
      continue;
    }

    // Ordered list
    if (/^[\s]*\d+[.)]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[\s]*\d+[.)]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[\s]*\d+[.)]\s/, ""));
        i++;
      }
      blocks.push(`<ol style="margin:8px 0;padding-left:24px;list-style:decimal">${items.map(it => `<li style="margin:2px 0${textStyle ? ";" + textStyle : ""}">${inlineFormat(it)}</li>`).join("")}</ol>`);
      continue;
    }

    // Table
    if (line.includes("|") && i + 1 < lines.length && /^\|?[\s-:|]+\|?$/.test(lines[i + 1].trim())) {
      const tableLines: string[] = [];
      // Header
      const headerCells = parseTableRow(line);
      tableLines.push(`<tr>${headerCells.map(c => `<th style="border:1px solid #e5e7eb;padding:6px 10px;background:#f9fafb;font-weight:600;text-align:left">${inlineFormat(c)}</th>`).join("")}</tr>`);
      i++;
      // Separator
      i++;
      // Body rows
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        const cells = parseTableRow(lines[i]);
        tableLines.push(`<tr>${cells.map(c => `<td style="border:1px solid #e5e7eb;padding:6px 10px">${inlineFormat(c)}</td>`).join("")}</tr>`);
        i++;
      }
      blocks.push(`<table style="border-collapse:collapse;margin:12px 0;width:100%;font-size:0.95em"><tbody>${tableLines.join("")}</tbody></table>`);
      continue;
    }

    // Image only line - 单独处理每个图片行
    if (/^!\[.*\]\(.*\)$/.test(line.trim())) {
      blocks.push(renderImage(line.trim()));
      i++;
      continue;
    }

    // Regular paragraph: collect consecutive non-empty, non-block lines
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !lines[i].trimStart().startsWith("```") && !lines[i].trimStart().startsWith(">") && !lines[i].match(/^#{1,6}\s/) && !/^[\s]*[-*+]\s/.test(lines[i]) && !/^[\s]*\d+[.)]\s/.test(lines[i]) && !/^(\*{3,}|-{3,}|_{3,})\s*$/.test(lines[i].trim())) {
      // 跳过纯图片行（已经单独处理了）
      if (/^!\[.*\]\(.*\)$/.test(lines[i].trim())) {
        i++;
        continue;
      }
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push(`<p style="margin:0 0 0.8em${textStyle ? ";" + textStyle : ""}">${inlineFormat(paraLines.join("<br/>"))}</p>`);
    }
  }

  return blocks.join("");
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function parseTableRow(line: string): string[] {
  return line.split("|").map(c => c.trim()).filter((c, i, arr) => !(i === 0 && c === "") && !(i === arr.length - 1 && c === ""));
}

/** 使用字符串方法解析图片，处理alt中可能包含的[]和] */
function processImagesInLine(text: string): string {
  const result: string[] = [];
  let remaining = text;
  
  while (remaining.length > 0) {
    const imgStart = remaining.indexOf("![");
    if (imgStart === -1) {
      // 没有更多图片了
      result.push(remaining);
      break;
    }
    
    // 添加图片前的文本
    if (imgStart > 0) {
      result.push(remaining.substring(0, imgStart));
    }
    
    // 解析图片
    const afterExclaim = remaining.substring(imgStart + 2);
    const bracketEnd = afterExclaim.indexOf("]");
    
    if (bracketEnd === -1 || bracketEnd >= afterExclaim.length - 2 || afterExclaim[bracketEnd + 1] !== "(") {
      // 不是有效的图片格式
      result.push("![");
      remaining = remaining.substring(imgStart + 2);
      continue;
    }
    
    const alt = afterExclaim.substring(0, bracketEnd);
    const afterBracket = afterExclaim.substring(bracketEnd + 2); // 跳过"]("
    
    // 找闭合括号
    let srcEnd = -1;
    let parenCount = 1;
    for (let j = 0; j < afterBracket.length; j++) {
      const ch = afterBracket[j];
      if (ch === "(") {
        parenCount++;
      } else if (ch === ")") {
        parenCount--;
        if (parenCount === 0) {
          srcEnd = j;
          break;
        }
      }
    }
    
    if (srcEnd === -1) {
      // 没有找到闭合括号
      result.push("![");
      remaining = remaining.substring(imgStart + 2);
      continue;
    }
    
    const src = afterBracket.substring(0, srcEnd);
    
    // 生成 img 标签
    const safeSrc = src.replace(/"/g, "&quot;");
    const safeAlt = alt.replace(/"/g, "&quot;");
    result.push(`<img src="${safeSrc}" alt="${safeAlt}" style="max-width:100%;height:auto;border-radius:6px;margin:8px 0;display:block" />`);
    
    // 继续处理剩余文本
    remaining = afterBracket.substring(srcEnd + 1);
  }
  
  return result.join("");
}

/** Inline formatting: bold, italic, strikethrough, code, images, links */
function inlineFormat(text: string): string {
  let r = text;

  // Inline code: `code` — must be before bold/italic to avoid conflicts
  r = r.replace(/`([^`]+)`/g, "<code style='background:#f3f4f6;padding:1px 5px;border-radius:3px;font-size:0.9em;color:#e11d48'>$1</code>");

  // Images: ![alt](src) - 处理alt中可能包含[]的情况
  // 使用字符串方法而非正则，确保正确解析alt中的]
  r = processImagesInLine(r);

  // Links: [text](url) - 支持超长URL和base64
  r = r.replace(/\[([^\]]+)\]\((\S*)\)/g, "<a href=\"$2\" style=\"color:#4f46e5;text-decoration:underline\" target=\"_blank\" rel=\"noopener\">$1</a>");

  // Bold+italic: ***text***
  r = r.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");

  // Bold: **text**
  r = r.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Italic: *text*
  r = r.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Strikethrough: ~~text~~
  r = r.replace(/~~(.+?)~~/g, "<del>$1</del>");

  return r;
}

function renderImage(line: string): string {
  // 使用字符串方法解析整行图片，支持alt中包含特殊字符
  const imgMatch = parseImageFromLine(line);
  if (!imgMatch) return escapeHtml(line);
  
  const [src, alt] = imgMatch;
  const safeSrc = src.replace(/"/g, "&quot;");
  const safeAlt = alt.replace(/"/g, "&quot;");
  return `<img src="${safeSrc}" alt="${safeAlt}" style="max-width:100%;height:auto;border-radius:6px;margin:12px 0;display:block" />`;
}

/** 解析单行图片，返回 [src, alt] 或 null */
function parseImageFromLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("![")) return null;
  
  const afterExclaim = trimmed.substring(2);
  const bracketEnd = afterExclaim.indexOf("]");
  
  if (bracketEnd === -1 || bracketEnd >= afterExclaim.length - 2 || afterExclaim[bracketEnd + 1] !== "(") {
    return null;
  }
  
  const alt = afterExclaim.substring(0, bracketEnd);
  const afterBracket = afterExclaim.substring(bracketEnd + 2); // 跳过"]("
  
  // 找闭合括号
  let srcEnd = -1;
  let parenCount = 1;
  for (let j = 0; j < afterBracket.length; j++) {
    const ch = afterBracket[j];
    if (ch === "(") {
      parenCount++;
    } else if (ch === ")") {
      parenCount--;
      if (parenCount === 0) {
        srcEnd = j;
        break;
      }
    }
  }
  
  if (srcEnd === -1) return null;
  
  const src = afterBracket.substring(0, srcEnd);
  return [src, alt];
}
