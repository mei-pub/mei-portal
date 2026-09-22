// AI 绘图设置（合并页）：个人设置 + 系统设置 两个 tab，替代原两个独立设置页
// 门户设置中心只保留这一个入口
import { useState } from 'react'
import { ProfilePage } from './ProfilePage'
import { AdminPage } from './AdminPage'

export function SettingsPage() {
  const [tab, setTab] = useState<'profile' | 'admin'>('profile')
  return (
    <div>
      {/* 合并 tab 切换：固定顶部，毛玻璃 */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 60,
          display: 'flex',
          justifyContent: 'center',
          padding: '12px 16px',
          background: 'rgba(244,246,251,0.82)',
          backdropFilter: 'blur(18px)',
          WebkitBackdropFilter: 'blur(18px)',
          borderBottom: '1px solid rgba(23,32,56,0.08)',
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            gap: 4,
            padding: 4,
            borderRadius: 999,
            background: 'rgba(23,32,56,0.06)',
          }}
        >
          {(
            [
              { id: 'profile', label: '个人设置' },
              { id: 'admin', label: '系统设置' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: '6px 22px',
                borderRadius: 999,
                border: 'none',
                fontSize: 13,
                cursor: 'pointer',
                background: tab === t.id ? '#fff' : 'transparent',
                color: tab === t.id ? '#1c2333' : '#5d6778',
                fontWeight: tab === t.id ? 650 : 400,
                boxShadow: tab === t.id ? '0 1px 4px rgba(23,32,56,0.12)' : 'none',
                transition: 'all .15s',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'profile' ? <ProfilePage /> : <AdminPage />}
    </div>
  )
}
