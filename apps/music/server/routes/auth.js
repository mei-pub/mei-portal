/**
 * 认证中间件 —— 移植自 functions/_middleware.ts（authMiddleware 部分）
 *
 * 逻辑完全一致：
 *   - 公开路径（/login, /api/login, 静态资源文件）直接放行
 *   - 其余路径检查 cookie auth === btoa(PASSWORD)
 *   - 验证失败则重定向到 /login
 */

const PUBLIC_PATH_PATTERNS = [
  /^\/login(?:\/|$)/,
  /^\/api\/login(?:\/|$)/,
];

const PUBLIC_FILE_EXTENSIONS = new Set([
  '.css', '.js', '.png', '.svg', '.jpg', '.jpeg',
  '.gif', '.webp', '.ico', '.txt', '.map', '.json',
  '.woff', '.woff2',
]);

function hasPublicExtension(pathname) {
  const lastDotIndex = pathname.lastIndexOf('.');
  if (lastDotIndex === -1) return false;
  return PUBLIC_FILE_EXTENSIONS.has(pathname.slice(lastDotIndex).toLowerCase());
}

function isPublicPath(pathname) {
  return (
    PUBLIC_PATH_PATTERNS.some(pattern => pattern.test(pathname)) ||
    hasPublicExtension(pathname)
  );
}

// mei-portal 统一身份：主应用会话校验（带短 TTL 缓存，避免每个请求都回调门户）
const SHELL_URL = process.env.MEI_SHELL_URL || 'http://127.0.0.1:3010';
const verifyCache = new Map();
const CACHE_TTL = 30 * 1000;
const NEGATIVE_TTL = 5 * 1000;

async function isPortalSessionValid(credential) {
  const cached = verifyCache.get(credential);
  if (cached && cached.exp > Date.now()) return cached.ok;
  let ok = false;
  try {
    const res = await fetch(`${SHELL_URL}/api/auth/verify`, {
      headers: { Authorization: `Bearer ${credential}` },
      signal: AbortSignal.timeout(4000),
    });
    ok = res.ok;
  } catch {
    ok = false;
  }
  verifyCache.set(credential, { ok, exp: Date.now() + (ok ? CACHE_TTL : NEGATIVE_TTL) });
  return ok;
}

/**
 * @param {string|null} password - 来自环境变量 PASSWORD
 * @returns {import('express').RequestHandler}
 */
module.exports = function createAuthMiddleware(password) {
  return async (req, res, next) => {
    // 未配置密码时，全部放行
    if (typeof password !== 'string') return next();

    // 公开路径直接放行
    if (isPublicPath(req.path)) return next();

    // mei-portal 统一身份：校验主应用会话（mei-auth），由门户 /api/auth/verify 裁决。
    // 会话有效 → 放行；无效 → 跳门户登录页（根路径 /login 即 Shell 登录页）。
    const portalCredential =
      (req.cookies && req.cookies['mei-auth']) ||
      (/^Bearer\s+(.+)$/i.exec(req.headers.authorization || '') || [])[1];
    if (portalCredential && (await isPortalSessionValid(portalCredential))) return next();

    // 验证失败，重定向到登录页
    return res.redirect(302, '/login');
  };
};
