'use client';

import { useEffect, useState } from 'react';
import {
  Alert,
  SettingsButton,
  SettingsField,
  SettingsPage,
  SettingsSection,
  TextInput,
} from '@/components/SettingsUI';

export default function AccountClient() {
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ oldPassword: pwForm.oldPassword, newPassword: pwForm.newPassword }),
      });
      const data = await res.json();
      afterChange(res.ok, res.ok ? '密码已修改，请重新登录…' : data.error || '修改失败', setPwMsg);
    } catch { setPwMsg('修改失败'); }
    setBusy('');
  }

  return (
    <SettingsPage
      icon="lucide:user-cog"
      title="账号与安全"
      description={`当前账户：${username || '…'}。修改账户名或密码后需要重新登录。`}
    >
      <SettingsSection title="修改账户名" description="账户名用于登录标识。">
        <form onSubmit={submitUsername}>
          <div className="mei-grid">
            <SettingsField label="新账户名" hint="2-32 位字母、数字、连字符或下划线。">
              <TextInput value={nameForm.newUsername} onChange={(e) => setNameForm({ ...nameForm, newUsername: e.target.value })} placeholder={username} />
            </SettingsField>
            <SettingsField label="当前密码" hint="验证身份。">
              <TextInput type="password" value={nameForm.oldPassword} onChange={(e) => setNameForm({ ...nameForm, oldPassword: e.target.value })} />
            </SettingsField>
          </div>
          <div className="footer-actions">
            <SettingsButton variant="primary" type="submit" disabled={busy === 'name' || !nameForm.newUsername || !nameForm.oldPassword}>
              {busy === 'name' ? '提交中…' : '修改账户名'}
            </SettingsButton>
          </div>
          {nameMsg ? <Alert tone={nameMsg.includes('失败') || nameMsg.includes('错误') ? 'error' : 'success'} title={nameMsg} /> : null}
        </form>
      </SettingsSection>

      <SettingsSection title="修改密码" description="建议定期更换密码以保障安全。">
        <form onSubmit={submitPassword}>
          <div className="mei-grid">
            <SettingsField label="当前密码" span>
              <TextInput type="password" value={pwForm.oldPassword} onChange={(e) => setPwForm({ ...pwForm, oldPassword: e.target.value })} />
            </SettingsField>
            <SettingsField label="新密码" hint="至少 4 位。">
              <TextInput type="password" value={pwForm.newPassword} onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })} />
            </SettingsField>
            <SettingsField label="确认新密码">
              <TextInput type="password" value={pwForm.confirm} onChange={(e) => setPwForm({ ...pwForm, confirm: e.target.value })} />
            </SettingsField>
          </div>
          <div className="footer-actions">
            <SettingsButton variant="primary" type="submit" disabled={busy === 'pw' || !pwForm.oldPassword || !pwForm.newPassword}>
              {busy === 'pw' ? '提交中…' : '修改密码'}
            </SettingsButton>
          </div>
          {pwMsg ? <Alert tone={pwMsg.includes('失败') || pwMsg.includes('不一致') || pwMsg.includes('错误') ? 'error' : 'success'} title={pwMsg} /> : null}
        </form>
      </SettingsSection>
      <style>{`.footer-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:14px;}`}</style>
    </SettingsPage>
  );
}
