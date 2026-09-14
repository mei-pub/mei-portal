// service/helpers —— Go internal/service/helpers.go 的复刻：随机名 / 抓页标题 / 文件存在检查

import fs from "node:fs";
import path from "node:path";

/** 视频扩展名列表（与 Go videoExtensions / TS videoPattern 对齐） */
export const videoExtensions = [
  "mp4",
  "flv",
  "avi",
  "rmvb",
  "wmv",
  "mov",
  "mkv",
  "webm",
  "mpeg",
  "mpg",
  "m4v",
  "3gp",
  "3g2",
  "f4v",
  "f4p",
  "f4a",
  "f4b",
  "ts",
  "m4a",
  "mp3",
  "aac",
];

const titleRegexp = /<title[^>]*>(.*?)<\/title>/i;
const randomChars = "abcdefghijklmnopqrstuvwxyz0123456789";

/** 生成 "YYYYMMDD-<10 位随机字符>" 格式名（与 Go RandomName 一致） */
export function randomName(): string {
  const d = new Date();
  const prefix = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  let suffix = "";
  for (let i = 0; i < 10; i++) {
    suffix += randomChars[Math.floor(Math.random() * randomChars.length)];
  }
  return `${prefix}-${suffix}`;
}

/** 抓取页面 <title>（10s 超时，仅读 64KB；失败返回 fallback，与 Go GetPageTitle 一致） */
export async function getPageTitle(
  pageURL: string,
  fallback: string,
): Promise<string> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const resp = await fetch(pageURL, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        Referer: pageURL,
      },
    });
    // 只读前 64KB
    const reader = resp.body?.getReader();
    if (!reader) {
      clearTimeout(timer);
      return fallback;
    }
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (received < 64 * 1024) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
    }
    clearTimeout(timer);
    const text = new TextDecoder("utf-8").decode(concat(chunks));
    const m = titleRegexp.exec(text);
    if (m && m.length >= 2) {
      const title = m[1]!.trim();
      if (title !== "") return title;
    }
  } catch {
    // 任何失败 → fallback
  }
  return fallback;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/**
 * 在 localPath 目录下找 name.<视频扩展名> 文件（Go CheckFileExists）。
 * 返回 [是否存在, 文件全路径]；下载器输出目录（无扩展名）也算存在。
 * 视频扩展与目录都未命中时，回退扫同目录任意 `name.*` 文件 —— 普通下载
 *（direct）的产物可能是任意扩展（zip/iso/pdf…），exists 检查不能只认视频。
 * aria2 控制文件（*.aria2，未完成/中断产物）不算存在。
 */
export function checkFileExists(
  name: string,
  localPath: string,
): [boolean, string] {
  for (const ext of videoExtensions) {
    const p = path.join(localPath, `${name}.${ext}`);
    try {
      const st = fs.statSync(p);
      if (st.isFile()) return [true, p];
    } catch {
      // 不存在 → 尝试下一扩展名
    }
  }
  // 目录形式（部分下载器输出到同名目录）
  const dirPath = path.join(localPath, name);
  try {
    if (fs.statSync(dirPath).isDirectory()) return [true, dirPath];
  } catch {
    // 不存在
  }
  // 任意扩展回退（普通下载产物）：首个 name.<ext> 文件（跳过 .aria2 控制文件）
  try {
    const prefix = `${name}.`;
    const hit = fs
      .readdirSync(localPath)
      .find((e) => e.startsWith(prefix) && !e.endsWith(".aria2"));
    if (hit) {
      const p = path.join(localPath, hit);
      if (fs.statSync(p).isFile()) return [true, p];
    }
  } catch {
    // 目录不可读 → 不存在
  }
  return [false, ""];
}

/**
 * 从磁力链接提取显示名（dn 参数，URL 解码）。
 * WHATWG URL 支持非特殊 scheme 的 magnet:?，searchParams 自动解码；
 * 无 dn（大小写不敏感）或非法链接返回 null，由调用方回退随机名。
 */
export function magnetDisplayName(url: string): string | null {
  try {
    const dn = new URL(url).searchParams.get("dn");
    if (dn && dn.trim() !== "") return dn.trim();
  } catch {
    // 非法 URL → null
  }
  return null;
}
