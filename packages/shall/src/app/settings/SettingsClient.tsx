'use client';
import { useEffect, useState } from 'react';
import TopBar from '@/components/TopBar';
import AppToggles from '@/components/AppToggles';

export default function SettingsClient() {
  const [disguised, setDisguised] = useState(false);

  useEffect(() => {
    try { setDisguised(localStorage.getItem('mei-disguise') === 'true'); } catch {}
  }, []);

  function toggleDisguise() {
    const next = !disguised;
    try { localStorage.setItem('mei-disguise', next ? 'true' : 'false'); } catch {}
    window.location.reload();
  }

  function logout() {
    fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
      .then(() => { window.location.href = '/'; });
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      <TopBar query="" onSearch={() => {}} />
      <main style={{ maxWidth: 640, margin: '0 auto', padding: 'var(--mei-space-6)' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px' }}>设置</h1>
        <p style={{ color: 'var(--mei-text-muted)', fontSize: 13, margin: '0 0 24px' }}>
          应用开关仅保存在当前浏览器（localStorage），不影响其他设备。
        </p>

        <section
          style={{
            background: 'var(--mei-surface)',
            border: '1px solid var(--mei-border)',
            borderRadius: 'var(--mei-radius-sm)',
            padding: 'var(--mei-space-4)',
            marginBottom: 'var(--mei-space-5)',
          }}
        >
          <h2 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px' }}>应用开关</h2>
          <p style={{ color: 'var(--mei-text-muted)', fontSize: 12, margin: '0 0 8px' }}>
            关闭后该应用在门户首页置灰，需重新开启才能进入。
          </p>
          <AppToggles />
        </section>

        <section
          style={{
            background: 'var(--mei-surface)',
            border: '1px solid var(--mei-border)',
            borderRadius: 'var(--mei-radius-sm)',
            padding: 'var(--mei-space-4)',
            marginBottom: 'var(--mei-space-5)',
          }}
        >
          <h2 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px' }}>隐藏模式</h2>
          <p style={{ color: 'var(--mei-text-muted)', fontSize: 12, margin: '0 0 8px' }}>
            开启后门户仅显示蜘蛛纸牌；在游戏中输入书架密码或主密码可解锁。
          </p>
          <button
            onClick={toggleDisguise}
            style={{
              padding: '8px 14px',
              borderRadius: 'var(--mei-radius-full)',
              border: `1px solid ${disguised ? 'var(--mei-primary)' : 'var(--mei-border)'}`,
              background: disguised ? 'var(--mei-primary-soft)' : 'transparent',
              color: disguised ? 'var(--mei-primary)' : 'var(--mei-text-muted)',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {disguised ? '🃏 退出隐藏模式' : '🃏 进入隐藏模式'}
          </button>
        </section>

        <section
          style={{
            background: 'var(--mei-surface)',
            border: '1px solid var(--mei-border)',
            borderRadius: 'var(--mei-radius-sm)',
            padding: 'var(--mei-space-4)',
          }}
        >
          <h2 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px' }}>账号</h2>
          <button
            onClick={logout}
            style={{
              padding: '8px 14px',
              borderRadius: 'var(--mei-radius-full)',
              border: '1px solid var(--mei-border)',
              background: 'transparent',
              color: 'var(--mei-text-muted)',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            退出登录
          </button>
        </section>
      </main>
    </div>
  );
}
