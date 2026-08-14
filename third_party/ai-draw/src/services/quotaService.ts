/**
 * 配额管理服务
 * 管理每日使用配额和访问密码
 */

const QUOTA_STORAGE_KEY = 'ai-draw-quota'
const PASSWORD_STORAGE_KEY = 'ai-draw-access-password'

interface QuotaData {
  date: string // 格式: "2025-12-25"
  used: number // 已使用次数
}

/**
 * 获取今天的日期字符串
 */
function getTodayString(): string {
  return new Date().toISOString().split('T')[0]
}

/**
 * 获取配额数据
 */
function getQuotaData(): QuotaData {
  const stored = localStorage.getItem(QUOTA_STORAGE_KEY)
  if (!stored) {
    return { date: getTodayString(), used: 0 }
  }

  try {
    const data: QuotaData = JSON.parse(stored)
    // 如果不是今天的数据，重置
    if (data.date !== getTodayString()) {
      return { date: getTodayString(), used: 0 }
    }
    return data
  } catch {
    return { date: getTodayString(), used: 0 }
  }
}

/**
 * 保存配额数据
 */
function saveQuotaData(data: QuotaData): void {
  localStorage.setItem(QUOTA_STORAGE_KEY, JSON.stringify(data))
}

export const quotaService = {
  /**
   * 获取每日配额上限
   */
  getDailyQuota(): number {
    const quota = import.meta.env.VITE_DAILY_QUOTA
    return quota ? parseInt(quota, 10) : 10 // 默认 10 次
  },

  /**
   * 获取今日已使用次数
   */
  getUsedCount(): number {
    return getQuotaData().used
  },

  /**
   * 获取剩余次数
   */
  getRemainingCount(): number {
    const quota = this.getDailyQuota()
    const used = this.getUsedCount()
    return Math.max(0, quota - used)
  },

  /**
   * 是否还有配额
   */
  hasQuotaRemaining(): boolean {
    return this.getRemainingCount() > 0
  },

  /**
   * 消耗一次配额
   */
  consumeQuota(): void {
    const data = getQuotaData()
    data.used += 1
    saveQuotaData(data)
  },

  /**
   * 获取存储的访问密码
   */
  getAccessPassword(): string {
    return localStorage.getItem(PASSWORD_STORAGE_KEY) || ''
  },

  /**
   * 保存访问密码
   */
  setAccessPassword(password: string): void {
    localStorage.setItem(PASSWORD_STORAGE_KEY, password)
  },

  /**
   * 清除访问密码
   */
  clearAccessPassword(): void {
    localStorage.removeItem(PASSWORD_STORAGE_KEY)
  },

  /**
   * 是否已设置访问密码
   */
  hasAccessPassword(): boolean {
    return !!this.getAccessPassword()
  },
}
