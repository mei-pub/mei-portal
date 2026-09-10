/**
 * 登录接口 —— 移植自 functions/api/login.ts
 * POST /api/login
 */

const { Router } = require('express');

// mei-allin：30 天，与门户 mei-auth cookie 对齐（原 48h，过期后 /music 会被 302 踢回登录页）
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * @param {string|null} password
 * @returns {import('express').Router}
 */
module.exports = function createLoginRouter(password) {
  const router = Router();

  router.post('/', async (req, res) => {
    const body = req.body || {};
    const providedPassword = typeof body.password === 'string' ? body.password : '';

    // 未配置密码时直接成功
    if (typeof password !== 'string') {
      return res.json({ success: true });
    }

    if (providedPassword === password) {
      const encoded = Buffer.from(password).toString('base64'); // 等价于 btoa(password)
      const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';

      const cookieParts = [
        // mei-allin：原名 auth 与 lunatv 同源同名冲突，改为 solara-auth
        `solara-auth=${encoded}`,
        `Max-Age=${MAX_AGE_SECONDS}`,
        'Path=/',
        'SameSite=Lax',
        'HttpOnly',
      ];
      if (isHttps) cookieParts.push('Secure');

      res.setHeader('Set-Cookie', cookieParts.join('; '));
      return res.json({ success: true });
    }

    return res.status(401).json({ success: false });
  });

  return router;
};
