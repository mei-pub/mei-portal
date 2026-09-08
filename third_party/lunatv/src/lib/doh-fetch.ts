/**
 * 经 DoH（DNS over HTTPS）解析后直连目标域名的 JSON 获取。
 *
 * 背景：本部署环境存在 DNS 污染——api.bgm.tv 被本地 resolver 解析到
 * 污染 IP（31.13.x.x = Facebook 段），直接 fetch 永远失败（fetch failed）。
 * 而域名真实托管在 Cloudflare，国内家宽直连 CF IP + SNI 完全可达（~650ms）。
 *
 * 做法：用公共 DoH（阿里/腾讯 DNS，国内可达）并行解析拿真实 A 记录并合并，
 * 然后 https.request 以「连接目标 IP + TLS SNI/HTTP Host 均为原域名」**并发竞速**直连。
 * 解析结果缓存 1 小时；任一 IP 成功即返回，坏 IP 由竞速掩盖。
 *
 * 批量请求性能（2026-09-08）：默认 agent 每次请求完整 TCP+TLS 握手（~650ms/张），
 * 首页 20+ 张封面并发冷拉会被外网隧道/反代层 RESET。三层优化：
 *   1. 共享 keep-alive agent——同 IP 的后续请求复用已建立的 TLS 连接；
 *   2. 已知好 IP 记忆——竞速胜出后记住可用 IP，后续请求先直连该 IP
 *      （复用连接 ~RTT 级），失败才回落全 IP 竞速；
 *   3. 同 host 并发收敛——无已知好 IP 时，批量并发中只有首个请求做 IP 竞速，
 *      其余请求等胜出 IP 出来后直连（复用其连接），避免整批各自对全部 IP 握手。
 */
import https from 'node:https';

const dohCache = new Map<string, { ips: string[]; expires: number }>();
const DOH_TTL_MS = 60 * 60 * 1000;
const CONNECT_TIMEOUT_MS = 6000; // 可用 IP 实测 ~650ms；坏 IP 快速失败由竞速掩盖
const DOH_ENDPOINTS = [
  'https://dns.alidns.com/resolve?name=%HOST%&type=A',
  'https://doh.pub/resolve?name=%HOST%&type=A',
];

// keep-alive 连接池：TLS 握手一次，后续请求复用（按目标 IP 复用 socket）。
// maxSockets 放宽到 32：放送页封面批量并发时集中走同一胜出 IP，避免排队
const keepAliveAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: 32,
  maxFreeSockets: 8,
});

// hostname -> 最近一次竞速胜出的可用 IP（进程级记忆）
const lastGoodIp = new Map<string, string>();
// 已知好 IP 的直连超时：复用连接时只有 RTT + 下载时间，给足余量
const KNOWN_IP_TIMEOUT_MS = 4000;

/** 查询单个 DoH 端点的 A 记录（失败抛错，由调用方合并） */
async function queryDohEndpoint(
  endpoint: string,
  hostname: string
): Promise<string[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(endpoint.replace('%HOST%', encodeURIComponent(hostname)), {
      signal: controller.signal,
      headers: { Accept: 'application/dns-json' },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      Answer?: Array<{ type?: number; data?: string }>;
    };
    return (data.Answer || [])
      .filter((a) => a.type === 1 && a.data)
      .map((a) => String(a.data));
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * DoH 解析真实 A 记录：并行查询所有 DoH 端点并**合并去重**结果。
 * 单一 DoH 的答案可能含无法直连的坏 IP（实测 bgm.tv 不同时刻解析出
 * Cloudflare IP 与自有 IP 两种），合并多源能提高拿到可用 IP 的概率。
 */
export async function resolveViaDoh(hostname: string): Promise<string[]> {
  const hit = dohCache.get(hostname);
  if (hit && hit.expires > Date.now()) return hit.ips;

  const results = await Promise.allSettled(
    DOH_ENDPOINTS.map((endpoint) => queryDohEndpoint(endpoint, hostname))
  );
  const merged: string[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      for (const ip of r.value) {
        if (!merged.includes(ip)) merged.push(ip);
      }
    }
  }
  if (!merged.length) {
    throw new Error(`DoH 解析 ${hostname} 无可用结果`);
  }
  dohCache.set(hostname, { ips: merged, expires: Date.now() + DOH_TTL_MS });
  return merged;
}

function httpsGetViaIp(
  ip: string,
  hostname: string,
  reqPath: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: ip,
        servername: hostname, // TLS SNI 用原域名，证书校验按原域名进行
        path: reqPath,
        method: 'GET',
        headers: { ...headers, Host: hostname },
        timeout: timeoutMs,
        agent: keepAliveAgent, // 连接复用：批量请求只握手一次
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks) }));
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error(`连接 ${ip} 超时`));
    });
    req.on('error', reject);
    req.end();
  });
}

/** 已知好 IP 快速通道：直连记忆中的可用 IP（复用 keep-alive 连接），
 *  失败（连接失效/IP 不可用）由调用方回落全 IP 竞速 */
async function tryKnownIp(
  hostname: string,
  reqPath: string,
  headers: Record<string, string>,
  validate: (status: number) => boolean
): Promise<{ body: Buffer } | null> {
  const ip = lastGoodIp.get(hostname);
  if (!ip) return null;
  try {
    const { status, body } = await httpsGetViaIp(
      ip,
      hostname,
      reqPath,
      headers,
      KNOWN_IP_TIMEOUT_MS
    );
    if (validate(status)) return { body };
    lastGoodIp.delete(hostname);
  } catch {
    // 连接失效：清掉坏 IP 不再占用快速通道，交由竞速重新发现
    lastGoodIp.delete(hostname);
  }
  return null;
}

/** 对全部 IP 并发竞速执行单个尝试，首个成功者胜出（Promise.any），整体限时 */
function raceIps<T>(
  ips: string[],
  attempt: (ip: string) => Promise<T>,
  timeoutMs: number,
  hostname: string
): Promise<T> {
  const overall = Promise.any(
    ips.map((ip) =>
      attempt(ip).catch((error: Error) => {
        throw new Error(`${ip}: ${error.message}`);
      })
    )
  );
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`全部 IP 尝试超时（${hostname}: ${ips.join(', ')}）`)),
      timeoutMs
    )
  );
  return Promise.race([overall, timeout]);
}

/** 一次全 IP 竞速：胜出 IP 记入好 IP 记忆，响应体供发现者直接复用 */
function raceOnce(
  hostname: string,
  reqPath: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<{ ip: string; body: Buffer }> {
  return resolveViaDoh(hostname).then((ips) =>
    raceIps(
      ips,
      async (ip) => {
        const { status, body } = await httpsGetViaIp(ip, hostname, reqPath, headers, CONNECT_TIMEOUT_MS);
        if (status !== 200) throw new Error(`HTTP ${status}`);
        return { ip, body };
      },
      timeoutMs,
      hostname
    )
  );
}

// 同 hostname 在飞的竞速：批量并发且无已知好 IP 时，只有首个请求做发现，
// 其余请求等胜出 IP 出来后直连自己的路径（复用其 keep-alive 连接）
const inflightRace = new Map<string, Promise<{ ip: string; body: Buffer }>>();

/** DoH 直连取响应体：已知好 IP 快速通道 → 并发收敛 → 独立竞速 */
async function fetchBodyWithDoh(
  hostname: string,
  reqPath: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<Buffer> {
  const known = await tryKnownIp(hostname, reqPath, headers, (s) => s === 200);
  if (known) return known.body;

  const running = inflightRace.get(hostname);
  if (running) {
    try {
      const { ip } = await running;
      const { status, body } = await httpsGetViaIp(ip, hostname, reqPath, headers, KNOWN_IP_TIMEOUT_MS);
      if (status === 200) return body;
    } catch {
      // 胜出 IP 对本路径不可用：回落独立竞速
    }
  }

  const ownRace = raceOnce(hostname, reqPath, headers, timeoutMs);
  if (!inflightRace.has(hostname)) {
    inflightRace.set(hostname, ownRace);
    ownRace
      .then(
        ({ ip }) => lastGoodIp.set(hostname, ip),
        () => {}
      )
      .finally(() => {
        if (inflightRace.get(hostname) === ownRace) inflightRace.delete(hostname);
      });
  }
  const { body } = await ownRace;
  return body;
}

/** DoH 解析 + IP 直连获取 JSON（api.bgm.tv 等） */
export async function fetchJsonWithDoh(
  hostname: string,
  reqPath: string,
  headers: Record<string, string> = {},
  timeoutMs = 20000
): Promise<unknown> {
  const body = await fetchBodyWithDoh(hostname, reqPath, headers, timeoutMs);
  return JSON.parse(body.toString('utf8'));
}

/** DoH 解析 + IP 直连获取二进制内容（图片等） */
export async function fetchBufferWithDoh(
  hostname: string,
  reqPath: string,
  headers: Record<string, string> = {},
  timeoutMs = 20000
): Promise<Buffer> {
  return fetchBodyWithDoh(hostname, reqPath, headers, timeoutMs);
}
