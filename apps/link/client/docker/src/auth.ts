import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

type Stored = { user: string; salt: string; hash: string };
export class AuthService {
  private sessions = new Map<string, number>();
  private dataDir: string;
  constructor(dataDir: string) { this.dataDir = dataDir; }
  private file() { return join(this.dataDir, "auth.json"); }
  // mei-allin：会话持久化 —— 此前存内存，容器重启即全部失效（登录态"又失效了"的根因）
  private sessionsFile() { return join(this.dataDir, "sessions.json"); }
  private async persistSessions() {
    try {
      const live: Record<string, number> = {};
      const now = Date.now();
      for (const [t, exp] of this.sessions) if (exp > now) live[t] = exp;
      await writeFile(this.sessionsFile(), JSON.stringify(live), { mode: 0o600 });
    } catch { /* 持久化失败不阻断登录 */ }
  }
  private async restoreSessions() {
    try {
      const raw = JSON.parse(await readFile(this.sessionsFile(), "utf8")) as Record<string, number>;
      const now = Date.now();
      for (const [t, exp] of Object.entries(raw)) if (exp > now) this.sessions.set(t, exp);
    } catch { /* 无存档或损坏则从空开始 */ }
  }
  private restored = false;
  private async ensureRestored() {
    if (this.restored) return;
    this.restored = true;
    await this.restoreSessions();
  }
  async initialize(env = process.env) {
    await mkdir(this.dataDir, { recursive: true });
    await this.ensureRestored();
    try { await readFile(this.file()); return; } catch {}
    const password = env.MEILINK_ADMIN_PASSWORD;
    if (!password) throw new Error("MEILINK_ADMIN_PASSWORD is required on first start");
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, salt, 32).toString("hex");
    await writeFile(this.file(), JSON.stringify({ user: env.MEILINK_ADMIN_USER || "admin", salt, hash }), { mode: 0o600 });
  }
  async login(user: string, password: string) {
    const stored: Stored = JSON.parse(await readFile(this.file(), "utf8"));
    const hash = scryptSync(password, stored.salt, 32);
    if (user !== stored.user || !timingSafeEqual(hash, Buffer.from(stored.hash, "hex"))) return null;
    const token = randomBytes(32).toString("base64url");
    // mei-allin：会话 30 天，与门户 mei-auth cookie 生命周期对齐
    // （此前 24h：浏览器 cookie 还有效但服务端会话已过期 → 打开管理页又要二次登录）
    this.sessions.set(token, Date.now() + 30 * 86400000);
    await this.persistSessions();
    return token;
  }
  // mei-allin 统一身份：主应用会话令牌（mei-auth cookie 值）即视为已登录
  private portalTokenCache: { value: string; exp: number } | null = null;
  private async portalSessionToken(): Promise<string> {
    const now = Date.now();
    if (this.portalTokenCache && this.portalTokenCache.exp > now) return this.portalTokenCache.value;
    try {
      const userFile = process.env.MEI_SHELL_USER_FILE || "/data/shell/user.json";
      const user = JSON.parse(await readFile(userFile, "utf8"));
      const token = createHash("sha256").update(`${user.username}:${user.hash}`).digest("hex");
      this.portalTokenCache = { value: token, exp: now + 30_000 };
      return token;
    } catch {
      this.portalTokenCache = { value: "", exp: now + 5_000 };
      return "";
    }
  }
  async valid(cookie = "") {
    await this.ensureRestored();
    const portal = /(?:^|;\s*)mei-auth=([^;]+)/.exec(cookie)?.[1];
    if (portal) {
      try {
        if (decodeURIComponent(portal) === (await this.portalSessionToken())) return true;
      } catch { /* 非法编码按未登录处理 */ }
    }
    const token = /(?:^|; )meilink_session=([^;]+)/.exec(cookie)?.[1];
    return !!token && (this.sessions.get(token) || 0) > Date.now();
  }
  async logout(cookie = "") {
    const token = /(?:^|; )meilink_session=([^;]+)/.exec(cookie)?.[1];
    if (token) { this.sessions.delete(token); await this.persistSessions(); }
  }
}
