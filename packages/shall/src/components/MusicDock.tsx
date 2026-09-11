'use client';
// 门户常驻音乐播放条 —— 跨应用始终存在，三种形态可切换：
//   full   完整形态：封面 + 曲目信息 + 全部控件 + 进度条 + 音量 + 队列面板
//   mini   缩小形态：胶囊小球，环形进度 + 封面 + 播放/暂停，占位极小
//   hidden 隐藏形态：仅保留贴底渐变把手（与顶栏/左侧面板收起态同构）
// 形态记忆到 localStorage + 账户状态，并支持 mei-music-dock-set 事件编程控制。
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import MeiIcon from './MeiIcon';
import { getMusicEngine, songKey, type DockMode, type Song } from '@/lib/music-engine';

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

// 环形进度（缩小形态用）：半径 18，周长 ≈ 113.1
const RING_R = 18;
const RING_C = 2 * Math.PI * RING_R;

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
        case 'play-now': {
          // 下载中心等外部应用触发：立即播单曲进临时队列（playNow 不动播放列表/收藏）
          const s = (data.song || {}) as Record<string, unknown>;
          eng.playNow({
            id: String(s.id || ''),
            name: String(s.name || ''),
            artist: String(s.artist || ''),
            album: String(s.album || ''),
            pic_id: String(s.pic_id || ''),
            lyric_id: String(s.lyric_id || ''),
            source: String(s.source || ''),
          });
          break;
        }
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
        case 'set-volume':
          eng.setVolume(Number(data.volume));
          break;
        case 'remove-from-queue':
          eng.removeFromQueue(Number(data.index));
          break;
        case 'set-dock-mode':
          eng.setDockMode(data.mode);
          break;
        case 'cycle-dock-mode':
          eng.cycleDockMode();
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

  // 编程切形态：与 mei-topbar-set / mei-panel-set 同构。
  // detail 支持 { mode: 'full'|'mini'|'hidden' }，也兼容旧的 { collapsed: boolean }。
  useEffect(() => {
    if (!engine) return;
    const eng = engine;
    function onSet(e: Event) {
      const detail = (e as CustomEvent).detail || {};
      if (detail.mode) {
        eng.setDockMode(detail.mode as DockMode);
        return;
      }
      if ('collapsed' in detail) {
        if (detail.collapsed) eng.setDockMode('hidden');
        else eng.restoreDock();
      }
    }
    window.addEventListener('mei-music-dock-set', onSet);
    return () => window.removeEventListener('mei-music-dock-set', onSet);
  }, [engine]);

  // 全站搜索页的「直接播放」入口：单曲进临时队列并立即播放。
  useEffect(() => {
    if (!engine) return;
    const eng = engine;
    function onPlay(e: Event) {
      const song = (e as CustomEvent).detail?.song as Song | undefined;
      if (!song) return;
      const key = songKey(song);
      eng.replaceData({ temp: [song, ...eng.temp.filter((item) => songKey(item) !== key)] });
      eng.setQueue('temp', 0, '');
      eng.setDockMode(eng.dockMode === 'hidden' ? 'full' : eng.dockMode);
      void eng.playIndex(0);
    }
    window.addEventListener('mei:music-play', onPlay);
    return () => window.removeEventListener('mei:music-play', onPlay);
  }, [engine]);

  // 全局快捷键：Alt+M 循环形态（完整 → 缩小 → 隐藏）。
  // 走快捷键而非顶栏按钮，是为了不侵入「顶栏唯一样式来源」这一约束。
  useEffect(() => {
    if (!engine) return;
    const eng = engine;
    function onKey(e: KeyboardEvent) {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.key.toLowerCase() !== 'm') return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      e.preventDefault();
      eng.cycleDockMode();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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

  // ---- 形态 3：隐藏 —— 仅贴底渐变把手 ----
  if (snap.dockMode === 'hidden') {
    return (
      <>
        <button
          className="mei-dock-handle"
          title={`展开播放条（${snap.dockLastVisible === 'mini' ? '缩小形态' : '完整形态'}） · ${song.name}`}
          onClick={() => engine.restoreDock()}
          onContextMenu={(e) => {
            // 右键直达缩小形态，省一次「展开再缩小」
            e.preventDefault();
            engine.setDockMode('mini');
          }}
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

  // ---- 形态 2：缩小 —— 环形进度小球，双击/按钮回到完整形态 ----
  if (snap.dockMode === 'mini') {
    return (
      <>
        <div className="mei-dock-mini" role="region" aria-label="音乐播放器（缩小形态）">
          <button
            className="mei-dock-mini-disc"
            title={`${snap.playing ? '暂停' : '播放'} · ${song.name} — ${song.artist}`}
            onClick={() => engine.toggle()}
          >
            <svg className="mei-dock-mini-ring" viewBox="0 0 44 44" aria-hidden>
              <circle className="track" cx="22" cy="22" r={RING_R} />
              <circle
                className="bar"
                cx="22"
                cy="22"
                r={RING_R}
                strokeDasharray={RING_C}
                strokeDashoffset={RING_C * (1 - ratio)}
              />
            </svg>
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="mei-dock-mini-cover" src={cover} alt="" />
            ) : (
              <span className="mei-dock-mini-cover mei-dock-mini-fallback" />
            )}
            <span className="mei-dock-mini-icon">
              <MeiIcon icon={snap.loading ? 'lucide:loader' : snap.playing ? 'lucide:pause' : 'lucide:play'} size={14} />
            </span>
          </button>
          <button className="mei-dock-mini-btn" title="下一首" onClick={() => engine.next()}>
            <MeiIcon icon="lucide:skip-forward" size={13} />
          </button>
          <button className="mei-dock-mini-btn" title="展开为完整形态" onClick={() => engine.setDockMode('full')}>
            <MeiIcon icon="lucide:chevron-up" size={13} />
          </button>
          <button className="mei-dock-mini-btn" title="隐藏播放条" onClick={() => engine.setDockMode('hidden')}>
            <MeiIcon icon="lucide:chevron-down" size={13} />
          </button>
        </div>
        {toast && <div className="mei-dock-toast">{toast}</div>}
        {dockStyles}
      </>
    );
  }

  const queueItems = [
    { type: 'temp' as const, id: '', label: '临时列表', count: snap.temp.length },
    ...snap.playlists.map((pl) => ({ type: 'playlist' as const, id: pl.id, label: pl.name, count: pl.songs.length })),
    { type: 'fav' as const, id: '', label: '我的收藏', count: snap.favorites.length },
  ];
  // 当前队列曲目（与引擎 queue() 同源，避免菜单里显示过期列表）
  const currentQueue: Song[] =
    snap.queueType === 'fav'
      ? snap.favorites
      : snap.queueType === 'playlist'
        ? snap.playlists.find((pl) => pl.id === snap.playlistId)?.songs || []
        : snap.temp;

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
          {/* 音量：常驻图标，hover 展开滑杆，避免占满播放条宽度 */}
          <div className="mei-dock-volume">
            <button
              className="mei-dock-btn"
              title={snap.volume === 0 ? '取消静音' : '静音'}
              onClick={() => engine.setVolume(snap.volume === 0 ? 1 : 0)}
            >
              <MeiIcon
                icon={snap.volume === 0 ? 'lucide:volume-x' : snap.volume < 0.5 ? 'lucide:volume-1' : 'lucide:volume-2'}
                size={16}
              />
            </button>
            <input
              className="mei-dock-vol-slider"
              type="range"
              min={0}
              max={100}
              value={Math.round(snap.volume * 100)}
              title={`音量 ${Math.round(snap.volume * 100)}%`}
              onChange={(e) => engine.setVolume(Number(e.target.value) / 100)}
            />
          </div>
          <div ref={queueRef} style={{ position: 'relative' }}>
            <button
              className="mei-dock-tag"
              title="当前播放队列（点击查看与切换）"
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
                      }}
                    >
                      <span>{it.label}</span>
                      <span className="cnt">{it.count} 首</span>
                    </button>
                  );
                })}
                {/* 当前队列曲目：可直接点播与移除 */}
                <div className="mei-dock-menu-title">当前队列 · {snap.queueLength} 首</div>
                <div className="mei-dock-tracks">
                  {snap.queueLength === 0 && <div className="mei-dock-tracks-empty">队列为空</div>}
                  {currentQueue.map((item, i) => (
                    <div
                      key={`${songKey(item)}:${i}`}
                      className={`mei-dock-track${i === snap.index ? ' active' : ''}`}
                    >
                      <button className="mei-dock-track-main" title={`播放「${item.name}」`} onClick={() => void engine.playIndex(i)}>
                        <span className="idx">{i === snap.index ? '▶' : i + 1}</span>
                        <span className="txt">
                          <span className="n">{item.name}</span>
                          <span className="a">{item.artist}</span>
                        </span>
                      </button>
                      <button
                        className="mei-dock-track-x"
                        title="从队列移除"
                        onClick={() => engine.removeFromQueue(i)}
                      >
                        <MeiIcon icon="lucide:x" size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <a className="mei-dock-btn" href={engine.playerPageHref()} title="打开音乐播放页">
            <MeiIcon icon="lucide:music" size={16} />
          </a>
          <button className="mei-dock-btn" title="缩小为小球" onClick={() => engine.setDockMode('mini')}>
            <MeiIcon icon="lucide:minimize-2" size={16} />
          </button>
          <button className="mei-dock-btn" title="隐藏播放条" onClick={() => engine.setDockMode('hidden')}>
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
  /* 音量：默认只露图标，hover / focus 时滑杆展开 */
  .mei-dock-volume { display: flex; align-items: center; flex-shrink: 0; }
  .mei-dock-vol-slider { width: 0; opacity: 0; margin-left: 0; -webkit-appearance: none; appearance: none;
    height: 4px; border-radius: 99px; background: rgba(23,32,56,0.12); outline: none; cursor: pointer;
    transition: width .2s ease, opacity .2s ease, margin-left .2s ease; }
  .mei-dock-volume:hover .mei-dock-vol-slider,
  .mei-dock-vol-slider:focus { width: 62px; opacity: 1; margin-left: 4px; }
  .mei-dock-vol-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 11px; height: 11px;
    border-radius: 50%; background: #6366f1; cursor: pointer; }
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
  /* 队列曲目列表 */
  .mei-dock-tracks { max-height: 216px; overflow-y: auto; overscroll-behavior: contain; }
  .mei-dock-tracks-empty { padding: 10px; font-size: 12px; color: #98a1b3; text-align: center; }
  .mei-dock-track { display: flex; align-items: center; border-radius: 10px; }
  .mei-dock-track:hover { background: rgba(99,102,241,0.08); }
  .mei-dock-track.active .n { color: #6366f1; font-weight: 700; }
  .mei-dock-track-main { display: flex; align-items: center; gap: 9px; flex: 1; min-width: 0; padding: 7px 4px 7px 10px;
    border: none; background: transparent; text-align: left; cursor: pointer; color: #1c2333; }
  .mei-dock-track-main .idx { width: 16px; flex-shrink: 0; font-size: 10.5px; color: #98a1b3;
    font-variant-numeric: tabular-nums; }
  .mei-dock-track-main .txt { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .mei-dock-track-main .n { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mei-dock-track-main .a { font-size: 10.5px; color: #98a1b3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mei-dock-track-x { width: 24px; height: 24px; margin-right: 6px; flex-shrink: 0; border: none; border-radius: 50%;
    background: transparent; color: #98a1b3; cursor: pointer; display: inline-flex; align-items: center;
    justify-content: center; opacity: 0; transition: all .15s; }
  .mei-dock-track:hover .mei-dock-track-x { opacity: 1; }
  .mei-dock-track-x:hover { background: rgba(236,72,153,0.12); color: #ec4899; }
  /* ---- 缩小形态：贴右下角的胶囊小球 ---- */
  .mei-dock-mini { position: fixed; right: 16px; bottom: 16px; z-index: 9998;
    display: flex; align-items: center; gap: 2px; padding: 5px 8px 5px 5px; box-sizing: border-box;
    border-radius: 999px; background: rgba(255,255,255,0.9); border: 1px solid rgba(23,32,56,0.10);
    box-shadow: 0 14px 40px rgba(23,32,56,0.20); backdrop-filter: blur(20px) saturate(1.6);
    -webkit-backdrop-filter: blur(20px) saturate(1.6);
    font-family: "Inter","Noto Sans SC","PingFang SC",sans-serif;
    animation: meiDockMiniIn .22s cubic-bezier(.34,1.4,.64,1); }
  .mei-dock-mini * { box-sizing: border-box; }
  @keyframes meiDockMiniIn { from { transform: translateY(10px) scale(.9); opacity: 0; } to { transform: none; opacity: 1; } }
  .mei-dock-mini-disc { position: relative; width: 44px; height: 44px; flex-shrink: 0; padding: 0; border: none;
    border-radius: 50%; background: transparent; cursor: pointer; }
  .mei-dock-mini-ring { position: absolute; inset: 0; transform: rotate(-90deg); }
  .mei-dock-mini-ring .track { fill: none; stroke: rgba(23,32,56,0.10); stroke-width: 3; }
  .mei-dock-mini-ring .bar { fill: none; stroke: #6366f1; stroke-width: 3; stroke-linecap: round;
    transition: stroke-dashoffset .25s linear; }
  .mei-dock-mini-cover { position: absolute; left: 6px; top: 6px; width: 32px; height: 32px; border-radius: 50%;
    object-fit: cover; }
  .mei-dock-mini-fallback { background: linear-gradient(135deg,#6366f1,#a855f7); }
  .mei-dock-mini-icon { position: absolute; inset: 6px; border-radius: 50%; display: flex; align-items: center;
    justify-content: center; color: #fff; background: rgba(13,18,32,0.42); opacity: 0; transition: opacity .16s; }
  .mei-dock-mini-disc:hover .mei-dock-mini-icon { opacity: 1; }
  .mei-dock-mini-btn { width: 26px; height: 26px; flex-shrink: 0; border: none; border-radius: 50%;
    background: transparent; color: #5d6778; cursor: pointer; display: inline-flex; align-items: center;
    justify-content: center; transition: all .15s; }
  .mei-dock-mini-btn:hover { background: rgba(23,32,56,0.07); color: #1c2333; }
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
