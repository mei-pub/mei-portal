// core/bencode —— BitTorrent bencode 解码（种子文件上传时的元数据提取）。
// 只需读 info 字典的 name/length/files，容错优先：任何结构异常抛 Error 由
// 调用方拒绝该文件。字符串值保留为 Buffer（文件路径段按 UTF-8 解码）。

import crypto from "node:crypto";

export interface TorrentFileEntry {
  /** 1-based 索引（与 aria2 --select-file 的文件编号一致） */
  index: number;
  /** 相对种子内路径（多文件段拼接；单文件 = name） */
  path: string;
  size: number;
}

export interface TorrentMeta {
  /** 种子名（info.name；单文件即文件名，多文件即目录名） */
  name: string;
  /** 总字节数（info.length 或 files 求和） */
  size: number;
  /** 多文件种子内容清单（单文件为 null） */
  files: TorrentFileEntry[] | null;
}

type BValue = number | Buffer | BValue[] | { [key: string]: BValue };

class Decoder {
  // 注意：--experimental-strip-types 不支持 TS 参数属性，字段须显式赋值
  private pos: number;
  private readonly buf: Buffer;

  constructor(buf: Buffer) {
    this.buf = buf;
    this.pos = 0;
  }

  decode(): BValue {
    if (this.pos >= this.buf.length) throw new Error("unexpected end");
    const c = this.buf[this.pos]!;
    if (c === 0x69) return this.decodeInt(); // 'i'
    if (c === 0x6c) return this.decodeList(); // 'l'
    if (c === 0x64) return this.decodeDict(); // 'd'
    if (c >= 0x30 && c <= 0x39) return this.decodeStr();
    throw new Error(`invalid bencode at ${this.pos}`);
  }

  private decodeInt(): number {
    const end = this.buf.indexOf(0x65, this.pos); // 'e'
    if (end < 0) throw new Error("unterminated int");
    const n = Number.parseInt(
      this.buf.subarray(this.pos + 1, end).toString("ascii"),
      10,
    );
    if (!Number.isFinite(n)) throw new Error("bad int");
    this.pos = end + 1;
    return n;
  }

  private decodeStr(): Buffer {
    const colon = this.buf.indexOf(0x3a, this.pos); // ':'
    if (colon < 0) throw new Error("unterminated string");
    const len = Number.parseInt(
      this.buf.subarray(this.pos, colon).toString("ascii"),
      10,
    );
    if (!Number.isFinite(len) || len < 0 || colon + 1 + len > this.buf.length) {
      throw new Error("bad string length");
    }
    const out = this.buf.subarray(colon + 1, colon + 1 + len);
    this.pos = colon + 1 + len;
    return out;
  }

  private decodeList(): BValue[] {
    this.pos += 1; // 'l'
    const out: BValue[] = [];
    while (this.buf[this.pos] !== 0x65) {
      if (this.pos >= this.buf.length) throw new Error("unterminated list");
      out.push(this.decode());
    }
    this.pos += 1;
    return out;
  }

  private decodeDict(): { [key: string]: BValue } {
    this.pos += 1; // 'd'
    const out: { [key: string]: BValue } = {};
    while (this.buf[this.pos] !== 0x65) {
      if (this.pos >= this.buf.length) throw new Error("unterminated dict");
      const key = this.decodeStr().toString("utf8");
      out[key] = this.decode();
    }
    this.pos += 1;
    return out;
  }
}

function toStr(v: unknown): string {
  if (Buffer.isBuffer(v)) return v.toString("utf8");
  if (typeof v === "string") return v;
  return "";
}

function toNum(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * 计算种子文件的 infohash（info 字典原始字节的 sha1，小写 hex）。
 * 不做完整解码 —— 从根字典起按 bencode 键值对齐遍历定位 `info` 键后
 * 扫描配对区间：公共 torrent 缓存返回体必须与磁力 btih 一致（防缓存
 * 污染 / 错内容）。不能用 indexOf("4:info")——文件路径等字符串内容里
 * 恰好出现 "4:info" 字节时会被误导（实测踩过：75 文件种子算出错 hash）。
 * 结构异常返回 null，由调用方拒绝。
 */
export function torrentInfoHash(buf: Buffer): string | null {
  if (buf[0] !== 0x64) return null; // 根必须是 dict 'd'

  /** 读取 p 处的一个完整 bencode 值；返回结束位（'e'/串尾的下一位），失败 -1。
   *  注意标量（整数/字符串）读到一个即返回——不能像容器那样继续循环，
   *  否则字符串 value 之后的顶层结构会被当作容器成员整体吞掉（实测踩过：
   *  comment 字符串后接 created by 键，扁平扫描一路吞到文件尾）。 */
  const readValue = (p: number): number => {
    for (;;) {
      if (p < 0 || p >= buf.length) return -1;
      const c = buf[p]!;
      if (c === 0x69) {
        // 'i' 整数到 'e'
        const e = buf.indexOf(0x65, p);
        return e < 0 ? -1 : e + 1;
      } else if (c === 0x6c || c === 0x64) {
        // 'l'/'d' 容器：内部成员依次读取直到配对 'e'
        let q = p + 1;
        for (;;) {
          if (q >= buf.length) return -1;
          if (buf[q] === 0x65) return q + 1;
          q = readValue(q);
          if (q < 0) return -1;
        }
      } else if (c >= 0x30 && c <= 0x39) {
        // 字符串长度前缀
        const colon = buf.indexOf(0x3a, p);
        if (colon < 0) return -1;
        const len = Number.parseInt(
          buf.subarray(p, colon).toString("ascii"),
          10,
        );
        if (!Number.isFinite(len) || len < 0) return -1;
        return colon + 1 + len;
      } else {
        return -1;
      }
    }
  };

  /** 读取 p 处的 bencode 字符串键；返回 [key 字节, value 起始位]，失败 null */
  const readKey = (p: number): [Buffer, number] | null => {
    const colon = buf.indexOf(0x3a, p);
    if (colon < 0) return null;
    const len = Number.parseInt(buf.subarray(p, colon).toString("ascii"), 10);
    if (!Number.isFinite(len) || len < 0) return null;
    const keyStart = colon + 1;
    return [buf.subarray(keyStart, keyStart + len), keyStart + len];
  };

  // 顶层键值对齐遍历：只有根字典的键 "info" 才是目标，字符串内容不算
  let p = 1;
  const infoKey = Buffer.from("info");
  for (;;) {
    if (p >= buf.length || buf[p] === 0x65) return null; // 遍历完没找到
    const kv = readKey(p);
    if (!kv) return null;
    const [key, valStart] = kv;
    if (key.equals(infoKey)) {
      const end = readValue(valStart);
      if (end < 0) return null;
      return crypto
        .createHash("sha1")
        .update(buf.subarray(valStart, end))
        .digest("hex");
    }
    p = readValue(valStart); // 跳过该键的 value，继续下一键
    if (p < 0) return null;
  }
}

/**
 * 提取种子元数据（info.name / 总大小 / 多文件清单）。
 * 文件索引从 1 开始递增（与 aria2 --select-file 编号一致）。
 */
export function extractTorrentMeta(buf: Buffer): TorrentMeta {
  const root = new Decoder(buf).decode();
  if (
    typeof root !== "object" ||
    Array.isArray(root) ||
    Buffer.isBuffer(root)
  ) {
    throw new Error("torrent root must be a dict");
  }
  const info = root["info"];
  if (
    typeof info !== "object" ||
    info === null ||
    Array.isArray(info) ||
    Buffer.isBuffer(info)
  ) {
    throw new Error("missing info dict");
  }
  const name = toStr(info["name"]).trim();
  if (name === "") throw new Error("missing info name");

  const filesRaw = info["files"];
  if (Array.isArray(filesRaw) && filesRaw.length > 0) {
    const files: TorrentFileEntry[] = [];
    let total = 0;
    filesRaw.forEach((f, i) => {
      if (
        typeof f !== "object" ||
        f === null ||
        Array.isArray(f) ||
        Buffer.isBuffer(f)
      )
        return;
      const segs = Array.isArray(f["path"])
        ? f["path"].map(toStr).filter((s) => s !== "")
        : [];
      const size = toNum(f["length"]);
      total += size;
      files.push({
        index: i + 1,
        path: segs.join("/") || `${name}/${i + 1}`,
        size,
      });
    });
    if (files.length === 0) throw new Error("empty files list");
    return { name, size: total, files };
  }
  return { name, size: toNum(info["length"]), files: null };
}
