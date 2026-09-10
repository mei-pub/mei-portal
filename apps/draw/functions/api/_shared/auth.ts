import type { Env } from './types'

/**
 * 验证访问密码
 * @returns { valid: boolean, exempt: boolean }
 * - valid: 请求是否有效（密码正确或无需密码）
 * - exempt: 是否免除配额消耗
 */
export function validateAccessPassword(request: Request, env: Env): { valid: boolean; exempt: boolean } {
  const password = request.headers.get('X-Access-Password')
  const configuredPassword = env.ACCESS_PASSWORD

  // 后端未配置密码，所有请求都有效但不免除配额
  if (!configuredPassword) {
    return { valid: true, exempt: false }
  }

  // 请求携带密码
  if (password) {
    if (password === configuredPassword) {
      return { valid: true, exempt: true }
    }
    // 密码错误
    return { valid: false, exempt: false }
  }

  // 未携带密码，有效但不免除配额
  return { valid: true, exempt: false }
}
