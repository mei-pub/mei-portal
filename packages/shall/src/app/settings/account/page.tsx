'use client';
// 账号与安全：修改账户名 / 修改密码（门户原生实现，渲染于 SettingsShell 右侧容器）
import { useEffect, useState } from 'react';
import MeiIcon from '@/components/MeiIcon';
import SettingsShell from '@/components/SettingsShell';

const card: React.CSSProperties = {
  background: 'var(--mei-surface)', border: '1px solid var(--mei-border)',
  borderRadius: 'var(--mei-radius-lg)', padding: 20, marginBottom: 16,
  boxShadow: 'var(--mei-shadow-sm)',
};
const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 10,
  fontSize: 13, border: '1px solid var(--mei-border-strong)', outline: 'none',
  color: 'var(--mei-text)', background: '#fff',
};
const label: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--mei-text-muted)', marginBottom: 5 };
const btnPrimary: React.CSSProperties = {
  padding: '9px 22px', borderRadius: 'var(--mei-radius-full)', border: 'none',
  background: 'var(--mei-gradient)', color: '#fff', fontSize: 13, fontWeight: 650,
  cursor: 'pointer', boxShadow: 'var(--mei-glow)',
};

export default function AccountPage() {
  const [username, setUsername] = useState('');
  const [nameForm, setNameForm] = useState({ newUsername: '', oldPassword: '' });
  const [pwForm, setPwForm] = useState({ oldPassword: '', newPassword: '', confirm: '' });
  const [nameMsg, setNameMsg] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setUsername(d.username || ''))
      .catch(() => {});
  }, []);

  function afterChange(ok: boolean, msg: string, setter: (s: string) => void) {
    setter(msg);
    if (ok) setTimeout(() => { window.location.href = '/login'; }, 1200);
  }

  async function submitUsername(e: React.FormEvent) {
    e.preventDefault();
    setBusy('name');
    setNameMsg('');
    try {
      const res = await fetch('/api/auth/password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ newUsername: nameForm.newUsername, oldPassword: nameForm.oldPassword }),
      });
      const data = await res.json();
      afterChange(res.ok, res.ok ? '账户名已修改，请重新登录…' : data.error || '修改失败', setNameMsg);
    } catch { setNameMsg('修改失败'); }
    setBusy('');
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (pwForm.newPassword !== pwForm.confirm) { setPwMsg('两次输入的新密码不一致'); return; }
    setBusy('pw');
    setPwMsg('');
    try {
      const res = await fetch('/api/auth/password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ oldPassword: pwForm.oldPassword, newPassword: pwForm.newPassword }),
      });
      const data = await res.json();
      afterChange(res.ok, res.ok ? '密码已修改，请重新登录…' : data.error || '修改失败', setPwMsg);
    } catch { setPwMsg('修改失败'); }
    setBusy('');
  }

  const msgStyle = (m: string): React.CSSProperties => ({
    fontSize: 12, marginTop: 10,
    color: m.includes('失败') || m.includes('错误') || m.includes('不一致') || m.includes('不合法') ? 'var(--mei-danger)' : 'var(--mei-success)',
  });

  return (
    <SettingsShell>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '4px 4px 40px' }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 4px' }}>账号与安全</h1>
        <p style={{ fontSize: 12.5, color: 'var(--mei-text-muted)', margin: '0 0 20px' }}>
          当前账户：<b>{username || '…'}</b>。修改账户名或密码后需要重新登录。
        </p>

        <form style={card} onSubmit={submitUsername}>
          <h2 style={{ fontSize: 14.5, fontWeight: 700, margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <MeiIcon icon="lucide:user" size={16} /> 修改账户名
          </h2>
          <label style={label}>新账户名（2-32 位字母/数字/-/_）</label>
          <input style={{ ...input, marginBottom: 12 }} value={nameForm.newUsername} onChange={(e) => setNameForm({ ...nameForm, newUsername: e.target.value })} placeholder={username} />
          <label style={label}>当前密码（验证身份）</label>
          <input type="password" style={{ ...input, marginBottom: 14 }} value={nameForm.oldPassword} onChange={(e) => setNameForm({ ...nameForm, oldPassword: e.target.value })} />
          <button type="submit" disabled={busy === 'name' || !nameForm.newUsername || !nameForm.oldPassword} style={{ ...btnPrimary, opacity: busy === 'name' ? 0.6 : 1 }}>
            {busy === 'name' ? '提交中…' : '修改账户名'}
          </button>
          {nameMsg && <p style={msgStyle(nameMsg)}>{nameMsg}</p>}
        </form>

        <form style={card} onSubmit={submitPassword}>
          <h2 style={{ fontSize: 14.5, fontWeight: 700, margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <MeiIcon icon="lucide:key-round" size={16} /> 修改密码
          </h2>
          <label style={label}>当前密码</label>
          <input type="password" style={{ ...input, marginBottom: 12 }} value={pwForm.oldPassword} onChange={(e) => setPwForm({ ...pwForm, oldPassword: e.target.value })} />
          <label style={label}>新密码（至少 4 位）</label>
          <input type="password" style={{ ...input, marginBottom: 12 }} value={pwForm.newPassword} onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })} />
          <label style={label}>确认新密码</label>
          <input type="password" style={{ ...input, marginBottom: 14 }} value={pwForm.confirm} onChange={(e) => setPwForm({ ...pwForm, confirm: e.target.value })} />
          <button type="submit" disabled={busy === 'pw' || !pwForm.oldPassword || !pwForm.newPassword} style={{ ...btnPrimary, opacity: busy === 'pw' ? 0.6 : 1 }}>
            {busy === 'pw' ? '提交中…' : '修改密码'}
          </button>
          {pwMsg && <p style={msgStyle(pwMsg)}>{pwMsg}</p>}
        </form>
      </div>
    </SettingsShell>
  );
}
