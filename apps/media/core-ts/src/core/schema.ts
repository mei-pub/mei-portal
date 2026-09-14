// core/schema —— Go internal/core/schema/loader.go 的复刻：DefaultSchemas 参数表 + JSON 覆盖

import fs from "node:fs";
import { logger } from "../logger.ts";

export interface ArgSpec {
  /** 命令行参数名列表（多个则依次重复出现） */
  argsName: string[];
  /** 文件名后缀；"@@AUTO@@" 表示从 URL 推断扩展名 */
  postfix?: string;
}

export interface ConsoleReg {
  percent: string;
  speed: string;
  error: string;
  start: string;
  isLive: string;
}

export interface Schema {
  type: string;
  args: { [key: string]: ArgSpec };
  consoleReg: ConsoleReg;
}

export interface SchemaList {
  schemas: Schema[];
}

export function getByType(sl: SchemaList, t: string): Schema | undefined {
  return sl.schemas.find((s) => s.type === t);
}

/** 内置默认 Schema（与 Go DefaultSchemas / Node 版 config.json 逐条对齐） */
export function defaultSchemas(): SchemaList {
  return {
    schemas: [
      {
        type: "m3u8",
        args: {
          url: { argsName: [] },
          localDir: { argsName: ["--tmp-dir", "--save-dir"] },
          name: { argsName: ["--save-name"] },
          headers: { argsName: ["--header"] },
          deleteSegments: { argsName: ["--del-after-done"] },
          proxy: { argsName: ["--custom-proxy"] },
          __common__: {
            argsName: [
              "--no-log",
              "--auto-select",
              "--ui-language",
              "zh-CN",
              "--live-real-time-merge",
              "--check-segments-count",
              "false",
            ],
          },
        },
        consoleReg: {
          percent: "([\\d.]+)%",
          speed: "([\\d.]+[GMK]Bps)",
          error: "ERROR",
          start: "保存文件名:",
          isLive: "检测到直播流",
        },
      },
      {
        type: "bilibili",
        args: {
          url: { argsName: [] },
          localDir: { argsName: ["--work-dir"] },
          name: { argsName: ["--file-pattern"] },
          __common__: {
            argsName: ["--use-app-api", "--encoding-priority", "avc,hevc,av1"],
          },
        },
        consoleReg: {
          percent: "([\\d.]+)%",
          speed: "([\\d.]+\\s[GMK]B/s)",
          error: "ERROR",
          start: "开始下载",
          isLive: "检测到直播流",
        },
      },
      {
        // direct 下载走 aria2c。连接数/分片/限速/重试不再写死（原 -x 16 -s 16 -k 1M），
        // 由 aria2Common 动态注入（下载中心设置页「下载引擎」，conf.aria2）
        type: "direct",
        args: {
          localDir: { argsName: ["-d"] },
          name: { argsName: ["-o"], postfix: "@@AUTO@@" },
          url: { argsName: [] },
          // 标记：buildArgs 从运行时配置拼装通用引擎参数（连接数/分片/限速/重试）
          aria2Common: { argsName: [] },
          __common__: {
            argsName: [
              "--console-log-level=notice",
              "--summary-interval=1",
              "--allow-overwrite=true",
              "--auto-file-renaming=false",
              "--check-certificate=false",
            ],
          },
        },
        consoleReg: {
          percent: "\\((\\d+)%\\)",
          // summary 行尾部带 ']'（DL:3MiB]），排除括号避免速度值带尾巴
          speed: "DL:([^\\]\\s]+)",
          error: "errorCode=\\d+|exception",
          start: "Download (started|Results:)",
          isLive: "",
        },
      },
      {
        // 磁力（BT）下载走 aria2c：seed-time=0 下载完成即退出（aria2 默认下载完
        // 继续做种不退出，任务会永远停在 downloading；下载中心不做种）。
        // 实测（aria2 1.36.0，管道输出 console-log-level=notice + summary-interval=1）：
        //   metadata 阶段：[#gid 0B/0B CN:2 SD:0 DL:0B] / FILE: [MEMORY][METADATA]<dn>
        //   下载阶段：[#gid 1.5MiB/3.7GiB(0%) CN:1 DL:0B] / FILE: <落盘绝对路径>
        // percent/speed 正则与 direct 相同（(N%) / DL:xxx）；DL:0B 让 parser 自动 ready。
        // 注意：不定义 name —— BT 落盘名由种子元数据决定（aria2c -o 只对单文件种子
        // 有效且会强改文件名），实际种子名由 service 层解析 FILE:/Download Results 回写。
        // DHT/LPD/PEX/端口/tracker 等由 aria2Bt 动态注入（conf.aria2.bt）。
        // error 置空：首次运行 DHT 路由表不存在、IPv6 bind 失败都会打 [ERROR] errorCode=1
        //（无害启动噪声，magnet/direct 共有），真失败由进程退出码判定；任务日志有全量输出。
        type: "bt",
        args: {
          localDir: { argsName: ["-d"] },
          url: { argsName: [] },
          // 标记：通用引擎参数（限速/重试）+ BT 参数（DHT/端口/tracker）动态注入
          aria2Common: { argsName: [] },
          aria2Bt: { argsName: [] },
          __common__: {
            argsName: [
              "--seed-time=0",
              "--console-log-level=notice",
              "--summary-interval=1",
              "--allow-overwrite=true",
              "--auto-file-renaming=false",
              "--check-certificate=false",
            ],
          },
        },
        consoleReg: {
          percent: "\\((\\d+)%\\)",
          speed: "DL:([^\\]\\s]+)",
          error: "",
          start: "Downloading \\d+ item",
          isLive: "",
        },
      },
      {
        type: "youtube",
        args: {
          url: { argsName: [] },
          localDir: { argsName: ["-P"] },
          name: { argsName: ["-o"] },
          headers: { argsName: ["--add-header"] },
          proxy: { argsName: ["--proxy"] },
          __common__: {
            argsName: ["--no-mtime", "--progress", "--newline", "--no-colors"],
          },
        },
        consoleReg: {
          percent: "([\\d.]+)%",
          speed: "([\\d.]+\\s?[MKG]?i?B/s)",
          error: "ERROR",
          start: "\\[download\\] Destination:",
          isLive: "\\[live\\]",
        },
      },
      {
        type: "mediago",
        args: {
          url: { argsName: [] },
          localDir: { argsName: ["--save-dir", "--tmp-dir"] },
          name: { argsName: ["--save-name"] },
          headers: { argsName: ["--header"] },
          deleteSegments: { argsName: ["--del-after-done"] },
          proxy: { argsName: ["--proxy"] },
          __common__: { argsName: ["--auto-select", "--thread-count", "8"] },
        },
        consoleReg: {
          percent: "([\\d.]+)%",
          speed: "([\\d.]+\\s?[MKG]?B/s)",
          error: "Error:",
          start: "\\[download\\] \\d+ segments",
          isLive: "is_live:\\s*true|\\[live\\]",
        },
      },
    ],
  };
}

/**
 * 从 JSON 文件加载 Schema；文件不存在时返回内置默认值（与 Go LoadSchemasFromJSON 一致）。
 */
export function loadSchemasFromJSON(p: string): SchemaList {
  logger.debug(`Loading schemas from file: ${p}`);
  try {
    const raw = fs.readFileSync(p, "utf8");
    const sl = JSON.parse(raw) as SchemaList;
    logger.info(
      `Schemas loaded successfully: ${p} count=${sl.schemas?.length ?? 0}`,
    );
    return sl;
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      logger.info(`Schema file not found, using built-in defaults: ${p}`);
      return defaultSchemas();
    }
    logger.error(
      `Failed to read/parse schema file: ${p}: ${err?.message ?? err}`,
    );
    // Go 版解析失败直接 Fatal；这里保持一致 —— 让启动失败
    throw err;
  }
}
