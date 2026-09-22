'use client';

import { useEffect, useState } from 'react';
import {
  Alert,
  Pill,
  SettingsButton,
  SettingsPage,
  SettingsSection,
  Toggle,
} from '@/components/SettingsUI';
import { readJsonStorage, writeJsonStorage } from '@/lib/app-settings-client';

const GENRES = ['流行', '摇滚', '古典音乐', '民谣', '电子', '嘻哈', '爵士', '轻音乐', 'R&B', '金属', '朋克', '蓝调', '雷鬼', '世界音乐', '拉丁', '新世纪', '古风', '动漫', '影视原声', '说唱'];
const SOURCES = [
  { value: 'netease', label: '网易云音乐', desc: '曲库全，推荐准确' },
  { value: 'qq', label: 'QQ音乐', desc: '腾讯音乐平台（本地源直连）' },
  { value: 'kugou', label: '酷狗音乐', desc: '酷狗曲库（本地源直连）' },
  { value: 'kuwo', label: '酷我音乐', desc: '无损音质支持好' },
  { value: 'migu', label: '咪咕音乐', desc: '中国移动音乐平台（本地源直连）' },
  { value: 'joox', label: 'JOOX音乐', desc: '东南亚曲库' },
  { value: 'bilibili', label: '哔哩哔哩', desc: 'B站音频区' },
  { value: 'youtube', label: 'YouTube（实验性）', desc: '自动令牌解析，可能受网络与平台风控影响' },
];
const DEFAULT_SOURCES = ['netease', 'qq', 'kugou', 'kuwo', 'migu', 'joox', 'youtube'];

const DOWNLOAD_MODES = [
  { value: 'local', label: '本地电脑', desc: '触发浏览器下载，保存到当前设备' },
  { value: 'server', label: '本地服务器', desc: '保存到服务器 /downloads/music/<歌手>/，可跨设备播放' },
  { value: 'both', label: '两者都要', desc: '本地与服务器同时各存一份' },
  { value: 'ask', label: '每次询问', desc: '每次下载时弹层选择去向' },
];

export default function SolaraSettings() {
  const [genres, setGenres] = useState<string[]>(GENRES);
  const [sources, setSources] = useState<string[]>(DEFAULT_SOURCES);
  // 下载方式（音乐应用 js/mei/api.js 的 getDownloadMode 同一 localStorage key）：
  // 下载按钮的默认去向。所有音乐配置统一在设置后台维护（应用内不再设独立设置页）
  const [downloadMode, setDownloadMode] = useState<string>('local');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setGenres(readJsonStorage('radarSettings', { genres: GENRES }).genres || GENRES);
    setSources(readJsonStorage('mei-music-sources', DEFAULT_SOURCES));
    const mode = localStorage.getItem('mei-download-mode');
    setDownloadMode(DOWNLOAD_MODES.some((m) => m.value === mode) ? mode! : 'local');
  }, []);

  function toggleGenre(name: string) {
    setGenres(genres.includes(name) ? genres.filter((v) => v !== name) : [...genres, name]);
  }

  function toggleSource(value: string) {
    if (sources.includes(value) && sources.length === 1) {
      setError('至少保留一个启用源');
      return;
    }
    setError('');
    setSources(sources.includes(value) ? sources.filter((v) => v !== value) : [...sources, value]);
  }

  function save() {
    if (!genres.length) {
      setError('请至少选择一个风格');
      return;
    }
    if (!sources.length) {
      setError('请至少保留一个启用源');
      return;
    }
    writeJsonStorage('radarSettings', { genres });
    writeJsonStorage('mei-music-sources', sources);
    localStorage.setItem('mei-download-mode', downloadMode);
    localStorage.setItem('mei-youtube-source-migrated-v1', '1');
    const current = localStorage.getItem('searchSource');
    if (current && !sources.includes(current)) localStorage.setItem('searchSource', sources[0]);
    setMessage('音乐设置已保存，刷新播放器后生效');
    setError('');
  }

  return (
    <SettingsPage
      icon="lucide:music"
      title="音乐播放设置"
      description="管理探索雷达风格、音乐源启停与下载方式。"
      actions={
        <>
          <Pill tone="neutral">{sources.length} 个源启用</Pill>
          <SettingsButton onClick={() => { setSources(DEFAULT_SOURCES); setMessage('已恢复默认源，尚未保存'); }}>恢复默认</SettingsButton>
          <SettingsButton variant="primary" onClick={save}>保存设置</SettingsButton>
        </>
      }
    >
      {error ? <Alert tone="error" title={error} /> : message ? <Alert tone="success" title={message} /> : null}
      <SettingsSection title="探索雷达风格" description="控制发现页随机推荐的曲风池。">
        <div className="genre-cloud">
          {GENRES.map((name) => (
            <button key={name} className={genres.includes(name) ? 'active' : ''} onClick={() => toggleGenre(name)}>
              {name}
            </button>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="音乐源" description="解析失败时播放器会自动尝试其他启用源。">
        <div className="source-grid">
          {SOURCES.map((s) => (
            <Toggle
              key={s.value}
              checked={sources.includes(s.value)}
              onChange={() => toggleSource(s.value)}
              label={s.label}
              description={s.desc}
            />
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        title="下载方式"
        description="应用内各下载入口（搜索结果 / 播放列表 / 收藏 / 播放页 / 播放条）的默认去向。"
      >
        <div className="source-grid">
          {DOWNLOAD_MODES.map((m) => (
            <Toggle
              key={m.value}
              checked={downloadMode === m.value}
              onChange={() => setDownloadMode(m.value)}
              label={m.label}
              description={m.desc}
            />
          ))}
        </div>
      </SettingsSection>

      <style>{`
        .genre-cloud{display:flex;flex-wrap:wrap;gap:7px;}
        .genre-cloud button{height:29px;padding:0 12px;border:1px solid var(--mei-border);border-radius:99px;background:rgba(255,255,255,.66);font-size:11.5px;font-weight:720;color:var(--mei-text-muted);cursor:pointer;transition:var(--mei-transition);}
        .genre-cloud button.active{border-color:rgba(99,102,241,.4);background:rgba(99,102,241,.1);color:var(--mei-primary);}
        .source-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;}
        @media(max-width:820px){.source-grid{grid-template-columns:repeat(2,minmax(0,1fr));}}
        @media(max-width:480px){.source-grid{grid-template-columns:1fr;}}
      `}</style>
    </SettingsPage>
  );
}
