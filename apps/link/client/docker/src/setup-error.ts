// 服务端设置类故障的统一分类。
//
// 背景：隧道的启动/域名拉取/代理下发失败，绝大多数根因不是「操作本身错了」，而是
// 服务端设置缺失或不匹配（未配服务器、token 不对、frps 未开管理接口、子域名根域冲突…）。
// 这类失败直接把底层英文报错抛给用户毫无指导性，必须归一成「去设置页改哪一项」。
//
// 本模块只做纯粹的字符串归类，不含 IO，便于单测覆盖。

/** 设置类故障码。前端据此决定弹层文案与聚焦字段。 */
export type SetupErrorCode =
  | "server-not-configured"
  | "server-login-failed"
  | "server-unreachable"
  | "admin-api-unreachable"
  | "admin-credentials-invalid"
  | "management-not-configured"
  | "management-api-disabled"
  | "management-token-invalid"
  | "management-unreachable"
  | "subdomain-conflict";

export interface SetupErrorInfo {
  code: SetupErrorCode;
  /** 弹层标题 */
  title: string;
  /** 说明「哪里没配好」 */
  message: string;
  /** 指引「去设置页改什么」 */
  hint: string;
  /** 打开设置面板后需要聚焦高亮的表单字段名 */
  fields: string[];
  /**
   * 这类故障是否值得自动重试。
   * 端口连不上、管理接口没起来既可能是配置错，也可能只是服务端在重启或网络抖动，
   * 属于自动重连最该救回来的场景，所以标 true（仍然弹层提示，但后台继续尝试）。
   * 认证不符、域名冲突、压根没配这类，重试多少次都不会变好，标 false。
   */
  retryable: boolean;
}

const CATALOG: Record<SetupErrorCode, Omit<SetupErrorInfo, "code">> = {
  "server-not-configured": {
    title: "尚未配置隧道服务器",
    message: "还没有填写 FRP 服务端地址与认证信息，隧道无法建立连接。",
    hint: "前往设置填写服务器地址、端口与认证 Token，保存后再连接。",
    fields: ["serverAddr", "serverPort", "authToken"],
    retryable: false,
  },
  "server-login-failed": {
    title: "服务端拒绝了本次登录",
    message: "已经连上服务器端口，但 FRP 登录没有成功，通常是认证 Token 与服务端不一致。",
    hint: "前往设置核对认证 Token（可用「拉取配置」从管理页自动填充），必要时检查 TLS 开关是否与服务端一致。",
    fields: ["authToken", "tlsEnabled"],
    retryable: false,
  },
  "server-unreachable": {
    title: "连不上隧道服务器",
    message: "服务器地址或端口无法建立 TCP 连接，服务端可能未启动、端口未放通或地址填错。",
    hint: "前往设置用「测试连接」核对地址与端口，并确认服务端 frps 正在运行。",
    fields: ["serverAddr", "serverPort"],
    // 服务端重启中 / 网络抖动也长这样，自动重连必须继续救
    retryable: true,
  },
  "admin-api-unreachable": {
    title: "本地 frpc 管理接口未就绪",
    message: "frpc 进程没有在预期端口上开出管理接口，多为 Admin 端口被占用或配置有误。",
    hint: "前往设置检查 Admin 端口/用户/密码，换一个未被占用的端口后重新连接。",
    fields: ["adminPort", "adminUser", "adminPassword"],
    // 也可能只是上一个 frpc 进程端口未释放，重启一次往往就好
    retryable: true,
  },
  "admin-credentials-invalid": {
    title: "本地 frpc 管理接口鉴权失败",
    message: "管理接口返回未授权，保存的 Admin 用户或密码与 frpc 实际使用的不一致。",
    hint: "前往设置重新填写 Admin 用户与密码，保存后会重写 frpc 配置并生效。",
    fields: ["adminUser", "adminPassword"],
    retryable: false,
  },
  "management-not-configured": {
    title: "未配置服务端管理页",
    message: "域名目录与一键拉取配置依赖服务端管理页地址和拉取 Token，当前为空。",
    hint: "前往设置填写管理页地址与域名拉取 Token；不配置也可以手动填写域名。",
    fields: ["managementURL", "domainAPIToken"],
    retryable: false,
  },
  "management-api-disabled": {
    title: "服务端未开放域名接口",
    message: "管理页存在，但没有启用域名接口（服务端缺少 MEILINK_DOMAIN_API_TOKEN）。",
    hint: "在服务端补上 MEILINK_DOMAIN_API_TOKEN 并重启，再回到设置填写同样的 Token。",
    fields: ["domainAPIToken"],
    retryable: false,
  },
  "management-token-invalid": {
    title: "域名拉取 Token 不正确",
    message: "管理页返回未授权，本地保存的域名拉取 Token 与服务端不一致。",
    hint: "前往设置重新填写域名拉取 Token，需与服务端 MEILINK_DOMAIN_API_TOKEN 完全一致。",
    fields: ["domainAPIToken"],
    retryable: false,
  },
  "management-unreachable": {
    title: "连不上服务端管理页",
    message: "管理页地址无法访问，可能是地址填错、服务未启动或网络不通。",
    hint: "前往设置核对管理页地址（形如 http://vps:17500），确认服务端管理服务在运行。",
    fields: ["managementURL"],
    retryable: true,
  },
  "subdomain-conflict": {
    title: "域名与服务端子域名根域冲突",
    message: "所填泛域名属于服务端已托管的子域名根域，frps 不允许这种重叠配置。",
    hint: "前往设置调整子域名根域，或在隧道里改用一个独立域名。",
    fields: ["subDomainHost"],
    retryable: false,
  },
};

/** 按优先级匹配：越具体的特征越靠前，避免被宽泛规则抢先命中。 */
const RULES: Array<{ code: SetupErrorCode; test: RegExp }> = [
  { code: "server-not-configured", test: /未配置服务器/ },
  { code: "management-not-configured", test: /未配置管理页地址或 token/i },
  { code: "management-api-disabled", test: /服务端未启用接口|MEILINK_DOMAIN_API_TOKEN/ },
  { code: "management-token-invalid", test: /域名拉取 token 错误/i },
  { code: "management-unreachable", test: /无法连接管理页|管理页返回 HTTP/ },
  { code: "subdomain-conflict", test: /不能属于子域名根域/ },
  { code: "admin-credentials-invalid", test: /Admin API .*failed: 401/i },
  { code: "admin-api-unreachable", test: /Admin API 未就绪|Admin API .*failed: 5\d\d/i },
  // 连不上端口的证据比「登录失败」更具体：frpc 的登录失败消息里往往同时带着
  // connection refused，若让 server-login-failed 先命中，就会把用户引去改 Token，
  // 而真正要改的是服务器地址/端口。所以先判端口层面的失败。
  { code: "server-unreachable", test: /服务器地址或端口无效|连接超时|connection refused|no route to host|ECONNREFUSED|EHOSTUNREACH|ENOTFOUND|ETIMEDOUT/i },
  { code: "server-login-failed", test: /did not log in to the server|exited before logging into the server|login to server failed|login to the server failed/i },
];

/** 识别一条错误文本是否属于「服务端设置问题」。不属于则返回 null。 */
export function classifySetupError(message: string): SetupErrorInfo | null {
  const text = String(message || "");
  if (!text) return null;
  for (const rule of RULES) {
    if (rule.test.test(text)) return { code: rule.code, ...CATALOG[rule.code] };
  }
  return null;
}

/** 组装 HTTP 错误响应体：普通错误只有 error，设置类错误额外带 setup 供前端弹层引导。 */
export function errorPayload(message: string): { error: string; setup?: SetupErrorInfo } {
  const setup = classifySetupError(message);
  return setup ? { error: message, setup } : { error: message };
}
