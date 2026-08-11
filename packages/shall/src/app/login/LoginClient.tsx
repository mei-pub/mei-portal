'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginClient() {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    if (res.ok) {
      router.push('/');
      router.refresh();
    } else {
      setErr('密码错误');
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <form
        onSubmit={submit}
        style={{
          width: 320,
          padding: 'var(--mei-space-8)',
          background: 'var(--mei-surface)',
          backdropFilter: 'var(--mei-blur)',
          WebkitBackdropFilter: 'var(--mei-blur)',
          border: '1px solid var(--mei-border)',
          borderRadius: 'var(--mei-radius-lg)',
          boxShadow: 'var(--mei-shadow)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 'var(--mei-radius-sm)',
              background: 'var(--mei-gradient)',
            }}
          />
          <div style={{ fontWeight: 700, fontSize: 20 }}>mei-allin</div>
        </div>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="入口密码"
          autoFocus
          style={{
            width: '100%',
            padding: '12px 14px',
            background: 'var(--mei-bg-elevated)',
            border: '1px solid var(--mei-border)',
            borderRadius: 'var(--mei-radius-sm)',
            color: 'var(--mei-text)',
            outline: 'none',
            fontSize: 15,
            marginBottom: 12,
          }}
        />
        {err && (
          <div style={{ color: 'var(--mei-danger)', fontSize: 13, marginBottom: 12 }}>{err}</div>
        )}
        <button
          type="submit"
          style={{
            width: '100%',
            padding: '12px',
            background: 'var(--mei-gradient)',
            border: 'none',
            borderRadius: 'var(--mei-radius-sm)',
            color: '#fff',
            fontWeight: 600,
            fontSize: 15,
            cursor: 'pointer',
          }}
        >
          进入
        </button>
      </form>
    </div>
  );
}
