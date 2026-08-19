'use client';
// 主页内网模式开关（自研主页版，localStorage mei-lan-mode）
// 开启后自定义图标项优先使用内网地址（lanUrl）
import { useState } from 'react';

export default function PanelNetModeToggle() {
  const [lan, setLan] = useState<boolean>(() => {
    try { return localStorage.getItem('mei-lan-mode') === '1'; } catch { return false; }
  });

  function toggle() {
    const next = !lan;
    try { localStorage.setItem('mei-lan-mode', next ? '1' : '0'); } catch {}
    setLan(next);
    // 通知同页/其他标签页
    window.dispatchEvent(new Event('mei-lan-change'));
  }

  return (
    <button
      onClick={toggle}
      role="switch"
      aria-checked={lan}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 2,
        width: '100%',
        padding: '8px 10px',
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        borderRadius: 'var(--mei-radius-sm, 8px)',
        color: 'var(--mei-text, #1f2937)',
        fontSize: 13,
        textAlign: 'left',
      }}
    >
      <span style={{ width: '100%', display: 'flex', alignItems: 'center', opacity: lan ? 1 : 0.5, transition: 'opacity .15s' }}>
        主页内网模式
        <span
          style={{
            width: 32, height: 18, borderRadius: 10,
            background: lan ? 'var(--mei-primary, #6366f1)' : '#c9cedb',
            position: 'relative', transition: 'background .15s', flexShrink: 0, marginLeft: 'auto',
          }}
        >
          <span
            style={{
              position: 'absolute', top: 2, left: lan ? 16 : 2,
              width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left .15s',
            }}
          />
        </span>
      </span>
      <span style={{ fontSize: 10.5, lineHeight: 1.3, color: 'var(--mei-text-faint, #9aa3b8)' }}>
        开启后主页自定义链接优先使用内网地址打开
      </span>
    </button>
  );
}
