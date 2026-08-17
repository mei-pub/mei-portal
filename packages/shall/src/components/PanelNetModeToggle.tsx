'use client';
// 主页内网模式开关 —— 读写 sun-panel 的 localStorage panelStorage
import { useState } from 'react';
// 格式与 sun-panel src/utils/storage/local.ts 的 ss 封装一致：
//   JSON {data: {networkMode: 0|1, ...}, expire: null}，0=内网(lan)、1=外网(wan)
const PANEL_STORAGE_KEY = 'panelStorage';

function readPanelState(): { networkMode: number } | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(PANEL_STORAGE_KEY) || 'null');
    if (parsed && parsed.data && typeof parsed.data === 'object') return parsed.data;
    return null;
  } catch {
    return null;
  }
}

function isLanMode(): boolean {
  const state = readPanelState();
  // sun-panel 默认 wan（外网），缺省视为未开启内网模式
  return state ? state.networkMode === 0 : false;
}

function writeLanMode(lan: boolean) {
  try {
    const parsed = JSON.parse(localStorage.getItem(PANEL_STORAGE_KEY) || '{}');
    if (!parsed.data || typeof parsed.data !== 'object') parsed.data = {};
    parsed.data.networkMode = lan ? 0 : 1;
    parsed.expire = null;
    localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(parsed));
  } catch {}
}

export default function PanelNetModeToggle() {
  const [lan, setLan] = useState<boolean>(isLanMode);

  function toggle() {
    const next = !lan;
    writeLanMode(next);
    setLan(next);
    // 顶栏在 /panel 页面内时，面板需要重载才会应用新模式
    if (window.location.pathname.startsWith('/panel')) window.location.reload();
  }

  return (
    <button
      onClick={toggle}
      role="switch"
      aria-checked={lan}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
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
      <span style={{ flex: 1, opacity: lan ? 1 : 0.5, transition: 'opacity .15s' }}>主页内网模式</span>
      <span
        style={{
          width: 32,
          height: 18,
          borderRadius: 10,
          background: lan ? 'var(--mei-primary, #6366f1)' : '#d1d5db',
          position: 'relative',
          transition: 'background .15s',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: lan ? 16 : 2,
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: '#fff',
            transition: 'left .15s',
          }}
        />
      </span>
    </button>
  );
}
