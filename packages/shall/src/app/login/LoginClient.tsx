'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginClient() {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setErr('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        router.push('/');
        router.refresh();
        return;
      }
      const d = await res.json().catch(() => ({}));
      setErr(d.error || '登录失败');
    } catch {
      // 网络异常必须复位并提示，否则按钮永久停在「登录中…」
      setErr('网络异常，请稍后重试');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <form
        onSubmit={submit}
        style={{
          width: 340,
          padding: 'var(--mei-space-8)',
          background: 'var(--mei-surface)',
          border: '1px solid var(--mei-border)',
          borderRadius: 'var(--mei-radius-lg)',
          boxShadow: 'var(--mei-shadow)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="Mei-Portal" style={{ width: 40, height: 40, borderRadius: 'var(--mei-radius-sm)' }} />
         <div>
            <div style={{ fontWeight: 700, fontSize: 20 }}>Mei-Portal</div>
           <div style={{ fontSize: 12, color: 'var(--mei-text-muted)' }}>统一应用门户</div>
          </div>
        </div>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="用户名"
          autoFocus
          style={inputStyle}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="密码"
          style={{ ...inputStyle, marginBottom: 12 }}
        />
        {err && <div style={{ color: 'var(--mei-danger)', fontSize: 13, marginBottom: 12 }}>{err}</div>}
        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%',
            padding: 12,
            background: 'var(--mei-gradient)',
            border: 'none',
            borderRadius: 'var(--mei-radius-sm)',
            color: '#fff',
            fontWeight: 600,
            fontSize: 15,
            cursor: loading ? 'wait' : 'pointer',
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? '登录中…' : '登录'}
        </button>
        <div style={{ fontSize: 12, color: 'var(--mei-text-faint)', marginTop: 16, textAlign: 'center' }}>
          初始账户 admin / mei-portal
        </div>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  background: 'var(--mei-bg)',
  border: '1px solid var(--mei-border)',
  borderRadius: 'var(--mei-radius-sm)',
  color: 'var(--mei-text)',
  outline: 'none',
  fontSize: 15,
  marginBottom: 12,
};
