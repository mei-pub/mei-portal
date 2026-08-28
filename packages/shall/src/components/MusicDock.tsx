'use client';
// 门户常驻音乐播放条 —— 跨应用始终存在，收起后紧贴浏览器底部
// 收起态与顶栏/左侧面板同构：localStorage 记忆 + 贴边渐变把手 + mei-music-dock-set 事件编程控制
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import MeiIcon from './MeiIcon';
import { getMusicEngine, songKey, type Song } from '@/lib/music-engine';

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const MODE_ICON: Record<string, string> = {
  order: 'lucide:list',
  shuffle: 'lucide:shuffle',
  repeat: 'lucide:repeat',
};
const MODE_LABEL: Record<string, string> = {
  order: '顺序播放',
  shuffle: '随机播放',
  repeat: '单曲循环',
};

export default function MusicDock() {
  const engine = useMemo(() => (typeof window === 'undefined' ? null : getMusicEngine()), []);
  const snap = useSyncExternalStore(
    engine ? engine.subscribe : () => () => {},
    engine ? engine.getSnapshot : () => null,
    () => null
  );
  const [queueOpen, setQueueOpen] = useState(false);
  const [toast, setToast] = useState('');
  const queueRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!engine) return;
    const eng = engine;
    void engine.boot();
    // iframe 内音乐应用的播放指令 → 外壳引擎（音频不随子应用切换而中断）
    function onMessage(ev: MessageEvent) {
      if (ev.origin !== window.location.origin) return;
      const data = ev.data;
      if (!data || data.source !== 'mei-music-guest') return;
      const reply = (payload: unknown) => {
        (ev.source as Window | null)?.postMessage(
          { source: 'mei-music-host', type: 'state', state: payload },
          window.location.origin
        );
      };
      switch (data.type) {
        case 'hello':
          reply(eng.guestState());
          break;
        case 'set-queue':
          eng.replaceData(data.data || {});
          if (data.queue) eng.setQueue(data.queue.type, data.queue.index ?? 0, data.queue.playlistId || '');
          if (data.play !== false) void eng.playIndex(eng.index);
          break;
        case 'replace-data':
          eng.replaceData(data.data || {});
          break;
        case 'play-index':
          void eng.playIndex(Number(data.index));
          break;
        case 'toggle':
          eng.toggle();
          break;
        case 'next':
          eng.next();
          break;
        case 'prev':
          eng.prev();
          break;
        case 'cycle-mode':
          eng.cycleMode();
          break;
        case 'seek':
          eng.seekTo(Number(data.ratio));
          break;
        case 'toggle-favorite':
          eng.toggleFavorite(data.song);
          break;
        default:
          break;
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [engine]);

  // 广播状态给所有 iframe，使子应用 UI 与常驻播放条一致
  useEffect(() => {
    if (!engine || !snap) return;
    const payload = { source: 'mei-music-host', type: 'state', state: engine.guestState() };
    document.querySelectorAll('iframe').forEach((frame) => {
      try {
        frame.contentWindow?.postMessage(payload, window.location.origin);
      } catch {}
    });
  }, [engine, snap]);

  // 编程收起：与 mei-topbar-set / mei-panel-set 同构
  useEffect(() => {
    if (!engine) return;
    const eng = engine;
    function onSet(e: Event) {
      const detail = (e as CustomEvent).detail || {};
      eng.setDockCollapsed(!!detail.collapsed);
    }
    window.addEventListener('mei-music-dock-set', onSet);
    return () => window.removeEventListener('mei-music-dock-set', onSet);
  }, [engine]);

  useEffect(() => {
    if (!snap?.error) return;
    setToast(snap.error);
    const t = setTimeout(() => {
      setToast('');
      engine?.clearError();
    }, 2400);
    return () => clearTimeout(t);
  }, [snap?.error, engine]);

  useEffect(() => {
    if (!queueOpen) return;
    function onDocClick(e: MouseEvent) {
      if (queueRef.current && !queueRef.current.contains(e.target as Node)) setQueueOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [queueOpen]);

  if (!engine || !snap || !snap.song) return null;

  const song = snap.song as Song;
  const cover = engine.picUrl(song);
  const faved = engine.isFavorite(song);
  const ratio = snap.duration > 0 ? snap.currentTime / snap.duration : 0;

  if (snap.dockCollapsed) {
    return (
      <>
        <button
          className="mei-dock-handle"
          title={`展开播放条 · ${song.name}`}
          onClick={() => engine.setDockCollapsed(false)}
        >
          <span className="mei-dock-handle-bars" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span className="mei-dock-handle-text">{song.name}</span>
          <MeiIcon icon={snap.playing ? 'lucide:pause' : 'lucide:play'} size={13} />
        </button>
        {dockStyles}
      </>
    );
  }

  const queueItems = [
    { type: 'temp' as const, id: '', label: '临时列表', count: snap.temp.length },
    ...snap.playlists.map((pl) => ({ type: 'playlist' as const, id: pl.id, label: pl.name, count: pl.songs.length })),
    { type: 'fav' as const, id: '', label: '我的收藏', count: snap.favorites.length },
  ];

  return (
    <>
      <div className="mei-dock" role="region" aria-label="音乐播放条">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="mei-dock-cover"
          src={cover}
          alt=""
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
          }}
        />
        <div className="mei-dock-meta">
          <div className="mei-dock-name">{song.name}</div>
          <div className="mei-dock-artist">
            {song.artist}
            {song.album ? ` · ${song.album}` : ''}
          </div>
        </div>
        <div className="mei-dock-controls">
          <button className="mei-dock-btn" title={MODE_LABEL[snap.mode]} onClick={() => engine.cycleMode()}>
            <MeiIcon icon={MODE_ICON[snap.mode]} size={16} />
          </button>
          <button className="mei-dock-btn" title="上一首" onClick={() => engine.prev()}>
            <MeiIcon icon="lucide:skip-back" size={16} />
          </button>
          <button
            className="mei-dock-btn main"
            title={snap.playing ? '暂停' : '播放'}
            onClick={() => engine.toggle()}
          >
            <MeiIcon icon={snap.loading ? 'lucide:loader' : snap.playing ? 'lucide:pause' : 'lucide:play'} size={18} />
          </button>
          <button className="mei-dock-btn" title="下一首" onClick={() => engine.next()}>
            <MeiIcon icon="lucide:skip-forward" size={16} />
          </button>
        </div>
        <div className="mei-dock-progress">
          <span className="mei-dock-time">{fmt(snap.currentTime)}</span>
          <input
            className="mei-dock-slider"
            type="range"
            min={0}
            max={1000}
            value={Math.round(ratio * 1000)}
            onChange={(e) => engine.seekTo(Number(e.target.value) / 1000)}
          />
          <span className="mei-dock-time">{fmt(snap.duration)}</span>
        </div>
        <div className="mei-dock-right">
          <button
            className={`mei-dock-btn${faved ? ' faved' : ''}`}
            title={faved ? '取消收藏' : '加入收藏'}
            onClick={() => {
              const added = engine.toggleFavorite(song);
              setToast(added ? '已加入收藏' : '已取消收藏');
            }}
          >
            <MeiIcon icon={faved ? 'lucide:heart' : 'lucide:heart'} size={16} />
          </button>
          <div ref={queueRef} style={{ position: 'relative' }}>
            <button
              className="mei-dock-tag"
              title="当前播放队列（点击切换）"
              onClick={() => setQueueOpen((v) => !v)}
            >
              {snap.queueLabel}
            </button>
            {queueOpen && (
              <div className="mei-dock-menu">
                <div className="mei-dock-menu-title">切换播放队列</div>
                {queueItems.map((it) => {
                  const active =
                    snap.queueType === it.type && (it.type !== 'playlist' || snap.playlistId === it.id);
                  return (
                    <button
                      key={`${it.type}:${it.id}`}
                      className={`mei-dock-menu-item${active ? ' active' : ''}`}
                      onClick={() => {
                        engine.setQueue(it.type, 0, it.id);
                        void engine.playIndex(0);
                        setQueueOpen(false);
                      }}
                    >
                      <span>{it.label}</span>
                      <span className="cnt">{it.count} 首</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <a className="mei-dock-btn" href={engine.playerPageHref()} title="打开音乐播放页">
            <MeiIcon icon="lucide:music" size={16} />
          </a>
          <button className="mei-dock-btn" title="收起播放条" onClick={() => engine.setDockCollapsed(true)}>
            <MeiIcon icon="lucide:chevron-down" size={16} />
          </button>
        </div>
      </div>
      {toast && <div className="mei-dock-toast">{toast}</div>}
      {dockStyles}
    </>
  );
}

// 播放条样式：与门户玻璃拟态一致，作用域全部前缀 mei-dock- 避免污染子应用
const dockStyles = (
  <style>{`
  .mei-dock {
    position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 9998;
    width: min(960px, calc(100vw - 28px)); height: 76px;
    display: flex; align-items: center; gap: 14px; padding: 0 18px; box-sizing: border-box;
    border-radius: 999px; background: rgba(255,255,255,0.88); border: 1px solid rgba(23,32,56,0.10);
    box-shadow: 0 18px 52px rgba(23,32,56,0.18); backdrop-filter: blur(24px) saturate(1.6);
    -webkit-backdrop-filter: blur(24px) saturate(1.6);
    font-family: "Inter","Noto Sans SC","PingFang SC",sans-serif; color: #1c2333;
  }
  .mei-dock * { box-sizing: border-box; }
  .mei-dock-cover { width: 48px; height: 48px; border-radius: 12px; object-fit: cover; flex-shrink: 0;
    background: linear-gradient(135deg, rgba(99,102,241,0.12), rgba(168,85,247,0.12)); }
  .mei-dock-meta { width: 170px; min-width: 0; flex-shrink: 0; }
  .mei-dock-name { font-size: 13px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mei-dock-artist { font-size: 11px; color: #5d6778; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mei-dock-controls, .mei-dock-right { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
  .mei-dock-btn { width: 36px; height: 36px; border: none; border-radius: 50%; background: transparent;
    color: #1c2333; display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
    transition: all .15s; text-decoration: none; }
  .mei-dock-btn:hover { background: rgba(23,32,56,0.06); }
  .mei-dock-btn.main { width: 44px; height: 44px; color: #fff;
    background: linear-gradient(135deg,#6366f1,#a855f7); box-shadow: 0 4px 14px rgba(99,102,241,0.4); }
  .mei-dock-btn.faved { color: #ec4899; background: rgba(236,72,153,0.10); }
  .mei-dock-progress { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; }
  .mei-dock-time { font-size: 11px; color: #98a1b3; font-variant-numeric: tabular-nums; flex-shrink: 0; }
  .mei-dock-slider { flex: 1; -webkit-appearance: none; appearance: none; height: 5px; border-radius: 99px;
    background: rgba(23,32,56,0.12); outline: none; cursor: pointer; }
  .mei-dock-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 13px; height: 13px;
    border-radius: 50%; background: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.2); cursor: pointer; }
  .mei-dock-tag { max-width: 96px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    padding: 5px 11px; border-radius: 999px; border: none; font-size: 10.5px; font-weight: 700; cursor: pointer;
    background: linear-gradient(135deg, rgba(99,102,241,0.12), rgba(168,85,247,0.12)); color: #6366f1; }
  .mei-dock-menu { position: absolute; right: 0; bottom: 44px; min-width: 210px; padding: 6px; z-index: 9999;
    border-radius: 16px; background: rgba(255,255,255,0.96); border: 1px solid rgba(23,32,56,0.10);
    box-shadow: 0 18px 52px rgba(23,32,56,0.18); backdrop-filter: blur(20px); }
  .mei-dock-menu-title { padding: 7px 10px 5px; font-size: 10.5px; font-weight: 800; letter-spacing: 1.2px; color: #98a1b3; }
  .mei-dock-menu-item { display: flex; align-items: center; gap: 9px; width: 100%; padding: 8px 10px; border: none;
    border-radius: 10px; background: transparent; font-size: 12.5px; color: #1c2333; text-align: left; cursor: pointer; }
  .mei-dock-menu-item:hover { background: rgba(99,102,241,0.08); }
  .mei-dock-menu-item.active { color: #6366f1; font-weight: 700;
    background: linear-gradient(135deg, rgba(99,102,241,0.10), rgba(168,85,247,0.10)); }
  .mei-dock-menu-item .cnt { margin-left: auto; font-size: 10.5px; color: #98a1b3; }
  .mei-dock-handle { position: fixed; left: 50%; bottom: 0; transform: translateX(-50%); z-index: 9998;
    height: 24px; max-width: 260px; padding: 0 14px; border: none; border-radius: 14px 14px 0 0; cursor: pointer;
    display: inline-flex; align-items: center; gap: 8px; color: #fff;
    background: linear-gradient(180deg,#a855f7,#6366f1); box-shadow: 0 -4px 14px rgba(99,102,241,0.45);
    font-family: "Inter","Noto Sans SC","PingFang SC",sans-serif; font-size: 11.5px; transition: height .18s ease; }
  .mei-dock-handle:hover { height: 30px; }
  .mei-dock-handle-text { max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mei-dock-handle-bars { display: inline-flex; align-items: flex-end; gap: 2px; height: 11px; }
  .mei-dock-handle-bars i { width: 2px; background: rgba(255,255,255,0.9); border-radius: 1px;
    animation: meiDockBars 1s ease-in-out infinite; }
  .mei-dock-handle-bars i:nth-child(1) { height: 5px; animation-delay: 0s; }
  .mei-dock-handle-bars i:nth-child(2) { height: 11px; animation-delay: .18s; }
  .mei-dock-handle-bars i:nth-child(3) { height: 7px; animation-delay: .36s; }
  @keyframes meiDockBars { 0%,100% { transform: scaleY(0.5); } 50% { transform: scaleY(1); } }
  .mei-dock-toast { position: fixed; left: 50%; bottom: 106px; transform: translateX(-50%); z-index: 9999;
    padding: 9px 22px; border-radius: 999px; background: rgba(13,18,32,0.88); color: #fff; font-size: 13px;
    box-shadow: 0 18px 52px rgba(23,32,56,0.20); pointer-events: none; }
  @media (max-width: 760px) {
    .mei-dock { gap: 8px; padding: 0 12px; }
    .mei-dock-meta { width: 110px; }
    .mei-dock-time, .mei-dock-tag { display: none; }
  }
  `}</style>
);

export { songKey };
