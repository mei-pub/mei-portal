/**
 * 简单的加密/解密工具
 * 使用 XOR 加密和 Base64 编码来混淆敏感信息
 */

/**
 * 生成一个基于时间戳的密钥
 */
function generateKey(): string {
  const timestamp = Date.now().toString()
  // 使用固定的盐值和时间戳的一部分来生成密钥
  const salt = 'AI_DRAW_SECRET_2024'
  // 取时间戳的前10位（秒级），这样在同一秒内生成的密钥相同
  const key = timestamp.slice(0, 10) + salt
  return key
}

/**
 * XOR 加密/解密
 */
function xorCipher(text: string, key: string): string {
  let result = ''
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length))
  }
  return result
}

/**
 * 加密敏感信息
 * @param value - 要加密的值
 * @returns 加密后的字符串，格式：timestamp|encrypted_base64
 */
export function encryptSensitive(value: string): string {
  if (!value) return ''

  // 历史实现是 XOR + Base64，但「密钥」（时间戳 + 硬编码盐）随密文一起传输，
  // 任何人拿到载荷即可还原，等于明文，只是传输混淆、没有实际安全意义。
  // 现改为明文直传（传输安全由 HTTPS / 同源反代负责）；服务端 decryptSensitive
  // 保留对旧格式（timestamp|base64）的兼容解密，读到旧值原样可用。
  return value
}

/**
 * 解密敏感信息
 * @param encrypted - 加密的字符串，格式：timestamp|encrypted_base64
 * @returns 解密后的原始值
 */
export function decryptSensitive(encrypted: string): string {
  if (!encrypted) return ''

  try {
    const [timestamp, base64] = encrypted.split('|')
    if (!timestamp || !base64) return ''

    const key = timestamp + 'AI_DRAW_SECRET_2024'
    const encryptedText = atob(base64)
    const decrypted = xorCipher(encryptedText, key)

    return decrypted
  } catch (error) {
    console.error('Decrypt error:', error)
    return ''
  }
}

