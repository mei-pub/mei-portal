"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minRows?: number;
  defaultMode?: "visual" | "source";
}

// ── HTML → Markdown Converter (rich, preserves structure + images) ──
function htmlToMarkdown(html: string): Promise<string> {
  const div = document.createElement("div");
  div.innerHTML = html;

  // Remove unwanted elements
  div.querySelectorAll("script, style, meta, link, noscript, svg, button, input, textarea, select, form, nav, footer, header").forEach(el => el.remove());

  return convertNode(div);
}

/** 粘贴时处理 Markdown 图片 alt 文本中的 [] */
function escapeTextBrackets(text: string): string {
  // 匹配 Markdown 图片语法，对 alt 部分中的 [] 转为中文括号
  return text.replace(/!\[([^\]]*)\]\(([^)]*)\)/g, (match: string, alt: string, src: string) => {
    const safeAlt = alt.replace(/\[/g, "【").replace(/\]/g, "】");
    return `![${safeAlt}](${src})`;
  });
}

async function convertNode(node: Node): Promise<string> {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent || "").replace(/\s+/g, " ");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  // Hidden elements
  if (el.style?.display === "none" || el.style?.visibility === "hidden") return "";

  // Process children recursively
  const childrenPromises = Array.from(node.childNodes).map(child => convertNode(child));
  const children = await Promise.all(childrenPromises);
  const inner = children.join("");

  switch (tag) {
    // Images: convert to base64
    case "img": {
      const src = el.getAttribute("src") || "";
      const alt = el.getAttribute("alt") || "";
      if (!src) return "";
      // Skip tiny images (icons, tracking pixels)
      const w = el.getAttribute("width");
      const h = el.getAttribute("height");
      if (w && parseInt(w) < 10) return "";
      if (h && parseInt(h) < 10) return "";
      // Try to convert external URL to base64
      const finalSrc = await tryConvertToBase64(src);
      // 转义 alt 文本中的 [] 字符，防止破坏 Markdown 图片语法
      const safeAlt = alt.replace(/\[/g, "【").replace(/\]/g, "】");
      return `\n\n![${safeAlt}](${finalSrc})\n\n`;
    }

    // Headings
    case "h1": return `\n\n# ${inner.trim()}\n\n`;
    case "h2": return `\n\n## ${inner.trim()}\n\n`;
    case "h3": return `\n\n### ${inner.trim()}\n\n`;
    case "h4": return `\n\n#### ${inner.trim()}\n\n`;
    case "h5": return `\n\n##### ${inner.trim()}\n\n`;
    case "h6": return `\n\n###### ${inner.trim()}\n\n`;

    // Block elements
    case "p": return `\n\n${inner.trim()}\n\n`;
    case "div": return `\n${inner}\n`;
    case "br": return "\n";
    case "hr": return "\n\n---\n\n";
    case "blockquote": {
      const lines = inner.trim().split("\n");
      return `\n\n${lines.map((l: string) => `> ${l}`).join("\n")}\n\n`;
    }

    // Inline formatting
    case "strong": case "b": return `**${inner}**`;
    case "em": case "i": return `*${inner}*`;
    case "u": return inner; // no underline in markdown
    case "del": case "s": case "strike": return `~~${inner}~~`;
    case "code": return `\`${inner}\``;

    // Preformatted
    case "pre": {
      const codeEl = el.querySelector("code");
      const codeText = codeEl ? codeEl.textContent || "" : el.textContent || "";
      return `\n\n\`\`\`\n${codeText.trim()}\n\`\`\`\n\n`;
    }

    // Links
    case "a": {
      const href = el.getAttribute("href") || "";
      return `[${inner}](${href})`;
    }

    // Lists
    case "ul": case "ol": return `\n\n${inner}\n\n`;
    case "li": {
      const parent = el.parentElement;
      const isOrdered = parent?.tagName.toLowerCase() === "ol";
      // Find index among sibling li elements
      let index = 1;
      if (parent) {
        for (const sibling of Array.from(parent.children)) {
          if (sibling === el) break;
          if (sibling.tagName.toLowerCase() === "li") index++;
        }
      }
      const prefix = isOrdered ? `${index}. ` : "- ";
      const lines = inner.trim().split("\n");
      return `${prefix}${lines[0]}${lines.length > 1 ? "\n  " + lines.slice(1).join("\n  ") : ""}\n`;
    }

    // Table (basic support)
    case "table": {
      const rows = el.querySelectorAll("tr");
      const tableLines: string[] = [];
      let headerDone = false;
      rows.forEach((row, ri) => {
        const cells = Array.from(row.querySelectorAll("th, td"));
        const texts = cells.map(c => c.textContent?.trim() || "");
        tableLines.push(`| ${texts.join(" | ")} |`);
        // Add header separator after first row if it has th
        if (!headerDone && (row.querySelector("th") || ri === 0)) {
          tableLines.push(`| ${texts.map(() => "---").join(" | ")} |`);
          headerDone = true;
        }
      });
      return `\n\n${tableLines.join("\n")}\n\n`;
    }

    // Skip these
    case "figure": return inner;
    case "figcaption": return `\n_${inner.trim()}_\n`;
    case "span": return inner;

    // Default: pass through
    default: return inner;
  }
}

// Convert image URL to base64 via server-side proxy (bypasses CORS)
async function tryConvertToBase64(src: string): Promise<string> {
  if (src.startsWith("data:")) return src; // Already base64
  if (!src.startsWith("http")) return src; // Skip non-http URLs

  try {
    const apiUrl = `/api/fetch-image?url=${encodeURIComponent(src)}`;
    const res = await fetch(apiUrl);
    if (!res.ok) return src;
    const data = await res.json();
    return data.dataUrl || src;
  } catch {
    return src; // Fallback to original URL
  }
}

// ── Simple Markdown → HTML (for visual mode rendering) ──
function mdToHtml(md: string): string {
  if (!md) return "";

  let result = md;
  result = result
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Images
  result = result.replace(/!\[([^\]]*)\]\((data:[^)]+)\)/g, (_m, alt, src) =>
    `<img src="${src}" alt="${alt}" contenteditable="false" style="max-width:100%;height:auto;border-radius:6px;margin:8px 0;display:block;border:1px solid #e5e7eb;cursor:default" />`
  );
  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, src) =>
    `<img src="${src}" alt="${alt}" contenteditable="false" style="max-width:100%;height:auto;border-radius:6px;margin:8px 0;display:block;border:1px solid #e5e7eb;cursor:default" />`
  );

  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  result = result.replace(/\*(.+?)\*/g, "<em>$1</em>");
  result = result.replace(/^### (.+)$/gm, "<div style='font-size:1.1em;font-weight:600;margin:0.8em 0 0.3em;color:#1f2937'>$1</div>");
  result = result.replace(/^## (.+)$/gm, "<div style='font-size:1.2em;font-weight:600;margin:0.8em 0 0.3em;color:#1f2937'>$1</div>");
  result = result.replace(/^# (.+)$/gm, "<div style='font-size:1.4em;font-weight:700;margin:0.8em 0 0.3em;color:#111827'>$1</div>");
  result = result.replace(/^(---|\*\*\*)$/gm, "<hr style='border:none;border-top:1px solid #e5e7eb;margin:1em 0' />");

  const blocks = result.split(/\n\n+/);
  result = blocks.map((block) => {
    const trimmed = block.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("<div") || trimmed.startsWith("<img") || trimmed.startsWith("<hr")) return trimmed;
    return `<div style="margin:0 0 0.5em;line-height:1.8">${trimmed.replace(/\n/g, "<br/>")}</div>`;
  }).join("");

  return result;
}

// ── contentEditable innerHTML → Markdown (for sync) ──
function editableHtmlToMd(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return extractEditableText(div);
}

function extractEditableText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  if (tag === "img") {
    const src = el.getAttribute("src") || "";
    const alt = el.getAttribute("alt") || "";
    return `\n![${alt}](${src})\n`;
  }

  const isBlock = ["div", "p", "h1", "h2", "h3", "h4", "h5", "h6", "br", "hr", "li", "blockquote"].includes(tag);
  const inner = Array.from(node.childNodes).map(extractEditableText).join("");

  if (tag === "strong" || tag === "b") return `**${inner}**`;
  if (tag === "em" || tag === "i") return `*${inner}*`;
  if (tag === "br") return "\n";
  if (tag === "hr") return "\n---\n";

  return `${isBlock ? "\n" : ""}${inner}${isBlock ? "\n" : ""}`;
}

/**
 * MarkdownEditor: visual/source dual-mode editor
 * - Visual mode: contentEditable with live Markdown rendering
 * - Source mode: plain textarea
 * - Paste from web: HTML → Markdown (preserves headings, bold, italic, images, lists)
 * - Paste images: screenshot/clipboard images → base64
 * - Drag & drop images
 */
export default function MarkdownEditor({ value, onChange, placeholder, minRows = 25, defaultMode = "visual" }: MarkdownEditorProps) {
  const [mode, setMode] = useState<"visual" | "source">(defaultMode);
  const editorRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isInternalUpdate = useRef(false);
  const isPasting = useRef(false);

  // Sync visual ← value
  useEffect(() => {
    if (mode === "visual" && editorRef.current && !isInternalUpdate.current && !isPasting.current) {
      const html = mdToHtml(value);
      editorRef.current.innerHTML = html;
    }
    isInternalUpdate.current = false;
  }, [value, mode]);

  // Visual input → sync back to value
  const handleVisualInput = useCallback(() => {
    if (!editorRef.current || isPasting.current) return;
    isInternalUpdate.current = true;
    const md = editableHtmlToMd(editorRef.current.innerHTML);
    onChange(md);
  }, [onChange]);

  // ── Paste handler ──
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const items = e.clipboardData?.items;
    const htmlData = e.clipboardData.getData("text/html");
    const textData = e.clipboardData.getData("text/plain");

    // Check for direct image in clipboard (screenshot)
    let hasDirectImage = false;
    for (const item of Array.from(items || [])) {
      if (item.type.startsWith("image/")) {
        hasDirectImage = true;
        break;
      }
    }

    if (hasDirectImage) {
      // Handle direct image paste
      for (const item of Array.from(items || [])) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (!file) continue;
          const reader = new FileReader();
          reader.onload = (ev) => {
            const dataUrl = ev.target?.result as string;
            const md = `\n\n![image](${dataUrl})\n\n`;
            if (mode === "source") {
              const ta = textareaRef.current;
              if (ta) {
                const pos = ta.selectionStart;
                onChange(value.substring(0, pos) + md + value.substring(ta.selectionEnd));
                setTimeout(() => { ta.selectionStart = ta.selectionEnd = pos + md.length; }, 0);
              }
            } else {
              onChange(value + md);
            }
          };
          reader.readAsDataURL(file);
          break;
        }
      }
      return;
    }

    // Handle text/HTML paste
    if (htmlData) {
      // Paste from web page: convert HTML → Markdown (async for image conversion)
      isPasting.current = true;
      htmlToMarkdown(htmlData).then((md) => {
        isPasting.current = false;
        // 粘贴时对普通文本内容中的 [] 做转义处理，保留图片语法 []
        const cleanedMd = escapeTextBrackets(md);
        if (mode === "visual") {
          // In visual mode, append markdown to existing value, re-render
          isInternalUpdate.current = true;
          const newVal = value + "\n\n" + cleanedMd;
          onChange(newVal);
          // Re-render visual
          if (editorRef.current) {
            editorRef.current.innerHTML = mdToHtml(newVal);
          }
        } else {
          // Source mode: insert at cursor
          const ta = textareaRef.current;
          if (ta) {
            const pos = ta.selectionStart;
            const newVal = value.substring(0, pos) + cleanedMd + value.substring(ta.selectionEnd);
            onChange(newVal);
            setTimeout(() => { ta.selectionStart = ta.selectionEnd = pos + cleanedMd.length; }, 0);
          } else {
            onChange(value + "\n\n" + cleanedMd);
          }
        }
      });
    } else if (textData) {
      // Plain text paste
      // 粘贴时对普通文本内容中的 [] 做转义处理，保留图片语法 []
      const cleanedText = escapeTextBrackets(textData);
      if (mode === "visual") {
        document.execCommand("insertText", false, cleanedText);
        handleVisualInput();
      } else {
        const ta = textareaRef.current;
        if (ta) {
          const pos = ta.selectionStart;
          onChange(value.substring(0, pos) + cleanedText + value.substring(ta.selectionEnd));
          setTimeout(() => { ta.selectionStart = ta.selectionEnd = pos + cleanedText.length; }, 0);
        }
      }
    }
  }, [mode, value, onChange, handleVisualInput]);

  // ── Drop handler ──
  const handleDrop = useCallback((e: React.DragEvent) => {
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/"));
    if (files.length === 0) return;
    e.preventDefault();
    const file = files[0];
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      onChange(value + `\n\n![${file.name}](${dataUrl})\n\n`);
    };
    reader.readAsDataURL(file);
  }, [value, onChange]);

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); }, []);

  return (
    <div className="border border-[var(--border)] rounded-lg overflow-hidden bg-white">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 border-b border-[var(--border)]">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setMode("visual")}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${mode === "visual" ? "bg-[var(--primary)] text-white" : "text-[var(--muted)] hover:bg-gray-200"}`}>
            可视化
          </button>
          <button type="button" onClick={() => setMode("source")}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${mode === "source" ? "bg-[var(--primary)] text-white" : "text-[var(--muted)] hover:bg-gray-200"}`}>
            源码
          </button>
        </div>
        <div className="text-[10px] text-[var(--muted)]">
          支持粘贴网页内容(含图片) · 截图粘贴 · 拖拽图片 · Markdown
        </div>
      </div>

      {/* Visual Editor */}
      {mode === "visual" && (
        <div ref={editorRef} contentEditable onInput={handleVisualInput} onPaste={handlePaste}
          onDrop={handleDrop} onDragOver={handleDragOver}
          className="w-full px-4 py-3 text-sm leading-relaxed focus:outline-none min-h-[500px]"
          style={{ minHeight: `${minRows * 20}px` }} data-placeholder={placeholder}
          suppressContentEditableWarning />
      )}

      {/* Source Editor */}
      {mode === "source" && (
        <textarea ref={textareaRef} rows={minRows} value={value}
          onChange={e => onChange(e.target.value)} onPaste={handlePaste}
          className="w-full px-4 py-3 text-sm focus:outline-none focus:ring-0 resize-y leading-relaxed font-mono"
          style={{ minHeight: `${minRows * 20}px` }} placeholder={placeholder} />
      )}

      <style jsx>{`
        [data-placeholder]:empty:before {
          content: attr(data-placeholder);
          color: #9ca3af;
          pointer-events: none;
          white-space: pre-wrap;
        }
      `}</style>
    </div>
  );
}
