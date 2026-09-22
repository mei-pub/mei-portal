import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { connect } from "node:net";
import { generateFrpcToml, type ServerConfig } from "./config.ts";
import { FrpcProcess } from "./frpc.ts";
import { toProxyDefinition } from "./proxy.ts";
import { routeText } from "./display.ts";
import { mergeRuntimeStatus } from "./runtime-status.ts";
import { DataStore, type Tunnel } from "./store.ts";
import { classifySetupError, type SetupErrorInfo } from "./setup-error.ts";
import { DEFAULT_RECONNECT, decideReconnect, normalizeReconnect, totalAllowedAttempts, type ReconnectSettings } from "./reconnect.ts";

export type TunnelInput = Omit<Tunnel, "id" | "status" | "runtimeStatus" | "remoteAddr" | "errorMessage" | "createdAt" | "updatedAt">;
const validPort = (value: number) => Number.isInteger(value) && value >= 1 && value <= 65535;

export class TunnelManager {
  private frpc: FrpcProcess;
  private events: Array<{ timestamp: string; message: string; level: string }> = [];
  private config: ServerConfig | null = null;
  private current: Tunnel[] = [];
  private store: DataStore;
  /** 自动重连偏好：独立于服务器配置持久化，未配置服务器前也允许先保存。 */
  private reconnect: ReconnectSettings = { ...DEFAULT_RECONNECT };
  /** 用户期望隧道处于连接态：start 置 true，主动 stop 置 false。自动重连只在 true 时进行。 */
  private desiredConnected = false;
  /** 自动重连运行时状态，供 /api/status 暴露给前端。 */
  private reconnectState: {
    attempts: number;
    lastAttemptAt: string | null;
    nextAttemptAt: string | null;
    lastError: string;
    stoppedReason: string;
    /** primary=按所选方式重试；escalated=reconnect 打满后升级到重启的第二段 */
    phase: "primary" | "escalated";
  } = { attempts: 0, lastAttemptAt: null, nextAttemptAt: null, lastError: "", stoppedReason: "", phase: "primary" };
  /** 升级与耗尽各只记一次日志，避免巡检循环把同一条刷满日志面板。 */
  private escalationLogged = false;
  private exhaustedLogged = false;
  /** 已记过日志的设置故障码，故障码变化时才再记一次。 */
  private setupLoggedCode = "";
  private monitorTimer: ReturnType<typeof setTimeout> | null = null;
  /** 一次重连正在进行中，避免监控循环与用户操作并发拉起两次 frpc。 */
  private reconnecting = false;

  constructor(store: DataStore, frpcBin: string) { this.store = store; this.frpc = new FrpcProcess(frpcBin); }
  async load() {
    await this.store.init();
    const config = await this.store.config();
    this.config = config ? this.normalizedConfig(config) : null;
    // 独立的重连偏好优先；旧版本把它存在 config.json 里，作为回退。
    const saved = await this.store.reconnect();
    this.reconnect = saved ? normalizeReconnect(saved) : normalizeReconnect(this.config?.reconnect ?? DEFAULT_RECONNECT);
    this.current = await this.store.tunnels();
  }
  status() {
    return {
      configured: !!this.config,
      running: this.frpc.running(),
      connected: this.frpc.isConnected(),
      pid: 0,
      desiredConnected: this.desiredConnected,
      reconnect: this.reconnectSettings(),
      reconnectState: { ...this.reconnectState },
      // 设置类故障随状态一起下发，前端轮询到即可弹层引导，无需等用户点操作再报错
      setup: this.reconnectState.lastError ? classifySetupError(this.reconnectState.lastError) : null,
    };
  }
  logs() { return this.events; }
  clearLogs() { this.events = []; }
  tunnels() { return this.current.map(tunnel => ({ ...tunnel, route: routeText(tunnel, this.config || {}) })); }
  serverConfig() { return this.config ? { ...this.config, authToken: "", adminPassword: "", reconnect: this.reconnectSettings() } : null; }
  reconnectSettings(): ReconnectSettings { return normalizeReconnect(this.reconnect); }

  async testConnection(addr: string, port: number) {
    if (!addr.trim() || !Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, err: "服务器地址或端口无效" };
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = connect({ host: addr.trim(), port });
        const timer = setTimeout(() => socket.destroy(new Error("连接超时")), 5_000);
        socket.once("connect", () => { clearTimeout(timer); socket.end(); resolve(); });
        socket.once("error", error => { clearTimeout(timer); reject(error); });
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, err: error instanceof Error ? error.message : "连接失败" };
    }
  }

  private log(message: string, level = "info") { this.events.unshift({ timestamp: new Date().toISOString(), message, level }); this.events = this.events.slice(0, 100); }
  async saveConfig(input: ServerConfig) {
    const previous = this.config;
    const config = this.normalizedConfig({
      ...previous,
      ...input,
      authToken: input.authToken || previous?.authToken || "",
      adminPassword: input.adminPassword || previous?.adminPassword || "",
    } as ServerConfig);
    this.config = config;
    await this.store.saveConfig(config);
    await writeFile(join(this.store.dir, "frpc.toml"), generateFrpcToml(config, this.store.dir), { mode: 0o600 });
    this.log("服务器配置已保存");
    // 设置改了就让新的开关/间隔立刻生效，不必等旧定时器跑完
    if (this.desiredConnected) this.scheduleMonitor();
    else this.clearMonitor();
  }

  async start() {
    if (!this.config) throw new Error("未配置服务器");
    this.desiredConnected = true;
    // 手动连接视为新一轮：清零计数与升级/耗尽标记，否则上一轮打满后再点连接会立刻被判定为已耗尽
    this.resetReconnectState();
    try {
      await this.launch("正在启动隧道管理器...");
      this.onConnectSucceeded();
    } catch (error) {
      this.onConnectFailed(error);
      throw error;
    } finally {
      this.scheduleMonitor();
    }
  }

  /** 主动停止：清掉期望态，避免自动重连把用户刚断开的隧道又拉起来。 */
  stop() {
    this.desiredConnected = false;
    this.clearMonitor();
    this.resetReconnectState();
    this.frpc.stop();
    this.log("隧道管理器已停止");
  }

  /** 释放定时器，供进程退出或测试收尾调用。 */
  dispose() { this.clearMonitor(); this.frpc.stop(); }

  /** 完整重启：停进程后重新拉起，等价于自动重连的 restart 方式。 */
  async restart() {
    if (!this.config) throw new Error("未配置服务器");
    this.desiredConnected = true;
    this.resetReconnectState();
    this.frpc.stop();
    await new Promise(resolve => setTimeout(resolve, 500));
    try {
      await this.launch("正在重启隧道管理器...");
      this.onConnectSucceeded();
    } catch (error) {
      this.onConnectFailed(error);
      throw error;
    } finally {
      this.scheduleMonitor();
    }
  }

  /** 只保存自动重连设置，不触碰服务器凭据；保存后立即让新间隔/开关生效。 */
  async saveReconnect(settings: ReconnectSettings) {
    this.reconnect = normalizeReconnect(settings);
    await this.store.saveReconnect(this.reconnect);
    this.log(`自动重连设置已保存：${this.reconnect.enabled ? "开启" : "关闭"}，间隔 ${this.reconnect.intervalSeconds}s，方式 ${this.reconnect.mode === "restart" ? "重启" : "重新连接"}`);
    if (this.reconnect.enabled && this.desiredConnected) this.scheduleMonitor();
    else this.clearMonitor();
  }

  async saveTunnels(tunnels: Tunnel[]) { this.current = tunnels; await this.store.saveTunnels(tunnels); if (this.frpc.running()) await this.syncProxies(); }

  async createTunnel(input: TunnelInput): Promise<Tunnel> {
    const tunnel = this.normalizedTunnel(input);
    this.assertUniqueName(tunnel.name);
    await this.syncTunnel(tunnel);
    this.current.push(tunnel);
    await this.store.saveTunnels(this.current);
    this.log(`隧道 "${tunnel.name}" 已创建`);
    return { ...tunnel };
  }

  async updateTunnel(id: string, input: TunnelInput): Promise<Tunnel> {
    const index = this.current.findIndex(tunnel => tunnel.id === id);
    if (index < 0) throw new Error("隧道不存在");
    const previous = this.current[index];
    const tunnel = this.normalizedTunnel(input, previous);
    this.assertUniqueName(tunnel.name, id);
    // A disabled tunnel has already been removed from frpc Store API. Renaming it
    // must not fail merely because there is no old proxy to remove.
    if (this.frpc.running() && previous.enabled && previous.name !== tunnel.name) {
      try { await this.deleteProxy(previous.name); } catch (error) { this.log(`清理旧隧道 "${previous.name}" 失败: ${error instanceof Error ? error.message : "unknown"}`, "warning"); }
    }
    await this.syncTunnel(tunnel);
    this.current[index] = tunnel;
    await this.store.saveTunnels(this.current);
    this.log(`隧道 "${tunnel.name}" 已更新`);
    return { ...tunnel };
  }

  async deleteTunnel(id: string): Promise<void> {
    const index = this.current.findIndex(tunnel => tunnel.id === id);
    if (index < 0) throw new Error("隧道不存在");
    const [tunnel] = this.current.slice(index, index + 1);
    if (this.frpc.running() && tunnel.enabled) {
      try { await this.deleteProxy(tunnel.name); } catch (error) { this.log(`清理隧道 "${tunnel.name}" 失败: ${error instanceof Error ? error.message : "unknown"}`, "warning"); }
    }
    this.current.splice(index, 1);
    await this.store.saveTunnels(this.current);
    this.log(`隧道 "${tunnel.name}" 已删除`);
  }

  async toggleTunnel(id: string, enabled: boolean): Promise<Tunnel> {
    const index = this.current.findIndex(tunnel => tunnel.id === id);
    if (index < 0) throw new Error("隧道不存在");
    const previous = this.current[index];
    const tunnel = {
      ...previous,
      enabled,
      runtimeStatus: enabled ? "wait start" : "closed",
      errorMessage: "",
      remoteAddr: enabled ? previous.remoteAddr || "" : "",
      updatedAt: new Date().toISOString(),
    };
    if (this.frpc.running()) {
      if (enabled) await this.syncTunnel(tunnel);
      else {
        try { await this.deleteProxy(tunnel.name); } catch (error) { this.log(`禁用隧道 "${tunnel.name}" 时清理代理失败: ${error instanceof Error ? error.message : "unknown"}`, "warning"); }
      }
    }
    this.current[index] = tunnel;
    await this.store.saveTunnels(this.current);
    this.log(`隧道 "${tunnel.name}" 已${enabled ? "启用" : "禁用"}`);
    return { ...tunnel };
  }

  async refreshRuntime() {
    if (!this.config || !this.frpc.running()) {
      this.current = mergeRuntimeStatus(this.current, {});
      return this.current;
    }
    try {
      const status = await (await this.admin("/api/status")).json() as Record<string, Array<{ name: string; status?: string; remote_addr?: string; err?: string }>>;
      this.current = mergeRuntimeStatus(this.current, status);
    } catch {
      this.current = mergeRuntimeStatus(this.current, {});
    }
    return this.current;
  }

  private auth() { return `Basic ${Buffer.from(`${this.config!.adminUser}:${this.config!.adminPassword}`).toString("base64")}`; }

  /** 拉起 frpc 并完成登录与代理下发。reconnect / restart / 手动 start 共用同一条路径。 */
  private async launch(message: string) {
    this.log(message);
    // frpc 登录失败会带着真实原因自杀退出，随后 waitForAdmin 只会超时报「管理接口未就绪」，
    // 把根因盖掉并把用户引向错误的设置项。这里留住 frpc 自己的说法，失败时优先用它。
    let frpcFailure = "";
    let frpcExited = false;
    this.frpc.start(
      join(this.store.dir, "frpc.toml"),
      line => {
        this.log(`frpc: ${line}`);
        if (/login to the server failed|connect to server error|login to server failed/i.test(line)) frpcFailure = line;
      },
      code => {
        frpcExited = true;
        this.log(`frpc 进程已退出，状态码: ${code}`, "error");
        // 进程意外退出时立刻安排一次探测，不必等到下一个轮询周期
        if (this.desiredConnected) this.scheduleMonitor(1_000);
      },
      () => {
        // 掉线但进程还活着（服务端重启/网络抖动）：立刻进入重连排程
        this.log("与服务端的连接已断开，准备按自动重连设置恢复", "warning");
        if (this.desiredConnected) this.scheduleMonitor(1_000);
      },
    );
    try {
      await this.waitForAdmin();
      await this.waitForServerLogin();
      await this.syncProxies();
    } catch (error) {
      // frpc 已经死了且留下了原因：报它的原因，才能把用户引到「服务器地址/端口/Token」上
      if (frpcExited && frpcFailure) throw new Error(frpcFailure);
      throw error;
    }
    this.log("隧道管理器已连接");
  }

  private resetReconnectState() {
    this.reconnectState = { attempts: 0, lastAttemptAt: null, nextAttemptAt: null, lastError: "", stoppedReason: "", phase: "primary" };
    this.escalationLogged = false;
    this.exhaustedLogged = false;
    this.setupLoggedCode = "";
  }

  private onConnectSucceeded() {
    if (this.reconnectState.attempts > 0) this.log(`自动重连成功（第 ${this.reconnectState.attempts} 次尝试）`);
    this.resetReconnectState();
  }

  private onConnectFailed(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    this.reconnectState.lastError = message;
    const setup = classifySetupError(message);
    if (setup && !setup.retryable) {
      // 重试修不好的配置问题：停止重连并留下引导
      this.reconnectState.stoppedReason = "setup-required";
      this.reconnectState.nextAttemptAt = null;
      if (this.setupLoggedCode !== setup.code) {
        this.log(`${setup.title}：${setup.hint}`, "error");
        this.setupLoggedCode = setup.code;
      }
    } else if (setup) {
      // 可能只是服务端重启/网络抖动：提示根因，但把自动重连交给巡检继续跑
      // 同一故障码只记一次，否则每个巡检周期都会把同一条刷进日志面板
      if (this.setupLoggedCode !== setup.code) {
        this.log(`${setup.title}：${setup.message}将按自动重连设置继续尝试。`, "warning");
        this.setupLoggedCode = setup.code;
      }
    }
  }

  private clearMonitor() {
    if (this.monitorTimer) { clearTimeout(this.monitorTimer); this.monitorTimer = null; }
    this.reconnectState.nextAttemptAt = null;
  }

  /** 安排下一次连接探测。delayMs 缺省用设置里的重连间隔。 */
  private scheduleMonitor(delayMs?: number) {
    const settings = this.reconnectSettings();
    if (!settings.enabled || !this.desiredConnected) { this.clearMonitor(); return; }
    if (this.monitorTimer) clearTimeout(this.monitorTimer);
    const delay = delayMs ?? settings.intervalSeconds * 1_000;
    this.reconnectState.nextAttemptAt = new Date(Date.now() + delay).toISOString();
    this.monitorTimer = setTimeout(() => { void this.monitorTick(); }, delay);
    // 定时器不应阻止容器进程退出
    this.monitorTimer.unref?.();
  }

  /** 一次探测：断连且允许重连时按设置的方式重连，随后安排下一次。 */
  private async monitorTick() {
    this.monitorTimer = null;
    const settings = this.reconnectSettings();
    const decision = decideReconnect(settings, {
      desired: this.desiredConnected,
      configured: !!this.config,
      connected: this.frpc.isConnected(),
      attempts: this.reconnectState.attempts,
      lastError: this.reconnectState.lastError,
    });
    if (!decision.act) {
      this.reconnectState.stoppedReason = decision.reason;
      // 仍处于期望连接态时继续巡检（已连接则只是健康检查），彻底停止的情形不再排程
      if (decision.reason === "connected") { this.scheduleMonitor(); return; }
      if (decision.reason === "setup-required" || decision.reason === "attempts-exhausted") {
        // 正在进行的那次尝试还没落地就宣布「已停止」会让日志顺序倒置，等它跑完再说
        if (decision.reason === "attempts-exhausted" && this.reconnecting) { this.scheduleMonitor(1_000); return; }
        if (decision.reason === "attempts-exhausted" && !this.exhaustedLogged) {
          const total = totalAllowedAttempts(settings);
          const detail = settings.mode === "reconnect"
            ? `重新连接与重启各尝试 ${settings.maxAttempts} 次`
            : `重启尝试 ${settings.maxAttempts} 次`;
          this.log(`自动重连已停止：${detail}（共 ${total} 次）仍未恢复，最近失败：${this.reconnectState.lastError || "未知原因"}`, "error");
          this.exhaustedLogged = true;
        }
        this.clearMonitor();
        return;
      }
      this.scheduleMonitor();
      return;
    }
    if (this.reconnecting) { this.scheduleMonitor(); return; }
    this.reconnecting = true;
    // 首次进入升级段（reconnect 打满转重启）时明确记一笔，便于事后追因
    if (decision.escalated && !this.escalationLogged) {
      this.log(`重新连接已连续失败 ${settings.maxAttempts} 次，自动升级为「直接重启」方式继续尝试（最多再试 ${settings.maxAttempts} 次）`, "warning");
      this.escalationLogged = true;
    }
    this.reconnectState.attempts += 1;
    this.reconnectState.lastAttemptAt = new Date().toISOString();
    this.reconnectState.stoppedReason = "";
    this.reconnectState.phase = decision.escalated ? "escalated" : "primary";
    // 升级段里的次序从 1 重新数，日志读起来才对得上「第几次重启」
    const ordinal = decision.escalated ? this.reconnectState.attempts - settings.maxAttempts : this.reconnectState.attempts;
    const cap = settings.maxAttempts > 0 ? `/${settings.maxAttempts}` : "";
    try {
      if (decision.mode === "restart") {
        this.log(`检测到断连，正在重启隧道管理器（第 ${ordinal}${cap} 次${decision.escalated ? "，升级方式" : ""}）`, "warning");
        this.frpc.stop();
        await new Promise(resolve => setTimeout(resolve, 500));
      } else {
        this.log(`检测到断连，正在重新连接（第 ${ordinal}${cap} 次）`, "warning");
      }
      await this.launch(decision.mode === "restart" ? "正在重启隧道管理器..." : "正在重新连接服务端...");
      this.onConnectSucceeded();
    } catch (error) {
      this.onConnectFailed(error);
      const way = decision.mode === "restart" ? "重启" : "重新连接";
      this.log(`${way}失败（第 ${ordinal}${cap} 次）：${error instanceof Error ? error.message : "unknown"}`, "error");
    } finally {
      this.reconnecting = false;
      this.scheduleMonitor();
    }
  }

  private normalizedConfig(config: ServerConfig): ServerConfig {
    return {
      ...config,
      vhostHTTPPort: validPort(config.vhostHTTPPort) ? config.vhostHTTPPort : 8080,
      vhostHTTPSPort: validPort(config.vhostHTTPSPort) ? config.vhostHTTPSPort : 8443,
    };
  }
  private async admin(path: string, init: RequestInit = {}) {
    const response = await fetch(`http://127.0.0.1:${this.config!.adminPort}${path}`, { ...init, signal: AbortSignal.timeout(3_000), headers: { Authorization: this.auth(), "content-type": "application/json", ...(init.headers || {}) } });
    if (!response.ok) throw new Error(`frpc Admin API ${init.method || "GET"} ${path} failed: ${response.status}`);
    return response;
  }
  private async waitForAdmin() {
    let lastError: unknown;
    for (let attempt = 0; attempt < 30; attempt++) {
      try { if ((await fetch(`http://127.0.0.1:${this.config!.adminPort}/healthz`, { signal: AbortSignal.timeout(1_000) })).ok) return; } catch (error) { lastError = error; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(`Admin API 未就绪: ${lastError instanceof Error ? lastError.message : "timeout"}`);
  }
  private async waitForServerLogin() {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 5_000) {
      if (this.frpc.isConnected()) return;
      if (!this.frpc.running()) throw new Error("frpc exited before logging into the server");
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("frpc did not log in to the server within 5 seconds");
  }

  private async syncProxies() {
    const listed = await (await this.admin("/api/store/proxies")).json() as { proxies?: Array<{ name: string }> };
    const existing = new Set((listed.proxies || []).map(proxy => proxy.name));
    for (const tunnel of this.current.filter(tunnel => tunnel.enabled)) {
      const update = existing.has(tunnel.name);
      await this.admin(update ? `/api/store/proxies/${encodeURIComponent(tunnel.name)}` : "/api/store/proxies", { method: update ? "PUT" : "POST", body: JSON.stringify(toProxyDefinition(tunnel, this.config!.subDomainHost)) });
      existing.delete(tunnel.name);
    }
    for (const name of existing) await this.admin(`/api/store/proxies/${encodeURIComponent(name)}`, { method: "DELETE" });
  }

  private normalizedTunnel(input: TunnelInput, previous?: Tunnel): Tunnel {
    const name = input.name.trim();
    if (!name) throw new Error("隧道名称不能为空");
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) throw new Error("隧道名称仅支持字母、数字、点、下划线和连字符");
    if (!Number.isInteger(input.localPort) || input.localPort < 1 || input.localPort > 65535) throw new Error("本地端口必须在 1 到 65535 之间");
    if ((input.type === "tcp" || input.type === "udp") && input.remotePort !== undefined && (!Number.isInteger(input.remotePort) || input.remotePort < 1 || input.remotePort > 65535)) throw new Error("远程端口必须在 1 到 65535 之间");
    const customDomains = input.customDomains?.map(domain => domain.trim()).filter(Boolean) || [];
    this.assertCustomDomains(input.type, customDomains);
    const now = new Date().toISOString();
    return {
      ...input,
      id: previous?.id || crypto.randomUUID(),
      name,
      localIP: input.localIP.trim() || "127.0.0.1",
      subdomain: input.subdomain?.trim() || undefined,
      remotePort: input.remotePort || undefined,
      customDomains,
      httpUser: input.httpUser?.trim() || undefined,
      // The edit dialog intentionally does not reveal saved credentials. A blank value therefore means
      // "leave unchanged", matching the server-config password fields.
      httpPassword: input.httpPassword || previous?.httpPassword || undefined,
      hostHeaderRewrite: input.hostHeaderRewrite?.trim() || undefined,
      enabled: input.enabled !== false,
      runtimeStatus: input.enabled === false ? "closed" : previous?.runtimeStatus || "new",
      remoteAddr: previous?.remoteAddr || "",
      errorMessage: "",
      createdAt: previous?.createdAt || now,
      updatedAt: now,
    };
  }

  private assertUniqueName(name: string, exceptId?: string) {
    if (this.current.some(tunnel => tunnel.name === name && tunnel.id !== exceptId)) throw new Error("隧道名称已存在");
  }

  private assertCustomDomains(type: Tunnel["type"], domains: string[]) {
    for (const domain of domains) {
      if (!domain.includes("*")) continue;
      if (type !== "http" && type !== "https") throw new Error("泛域名仅支持 HTTP 或 HTTPS 隧道");
      if (!/^\*\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(domain)) throw new Error("泛域名格式应为 *.example.com");
      const root = this.config?.subDomainHost.trim().toLowerCase();
      const suffix = domain.slice(2).toLowerCase();
      if (root && (suffix === root || suffix.endsWith(`.${root}`))) throw new Error(`泛域名 ${domain} 不能属于子域名根域 ${root}；请改用独立域名，或在 frps 中移除该子域名根域`);
    }
  }

  private async syncTunnel(tunnel: Tunnel) {
    if (!this.frpc.running() || !tunnel.enabled) return;
    const listed = await (await this.admin("/api/store/proxies")).json() as { proxies?: Array<{ name: string }> };
    const exists = (listed.proxies || []).some(proxy => proxy.name === tunnel.name);
    await this.admin(exists ? `/api/store/proxies/${encodeURIComponent(tunnel.name)}` : "/api/store/proxies", {
      method: exists ? "PUT" : "POST", body: JSON.stringify(toProxyDefinition(tunnel, this.config!.subDomainHost)),
    });
  }

  private async deleteProxy(name: string) {
    await this.admin(`/api/store/proxies/${encodeURIComponent(name)}`, { method: "DELETE" });
  }
}
