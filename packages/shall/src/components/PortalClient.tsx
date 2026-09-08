'use client';
// 门户主页 —— 对齐 Sun-Panel 首页能力：
// 内置应用物化为图标项统一管理；编辑模式（删除/添加）；右键菜单（打开/编辑/删除）；
// 拖拽排序（组内+跨组）；编辑弹层；风格全套（Logo/时钟/搜索/背景/边距/页脚/监控）；内网双地址
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClientPlugin } from '@/lib/categories';
import TopBar from './TopBar';
import MeiIcon from './MeiIcon';
import { isSwitchable, isAppEnabled } from '@/lib/app-toggles';
import { useHealth } from '@/lib/use-health';
import type { PanelConfig, PanelItem, PanelGroup } from '@/lib/panel-store';
import ItemIconPicker, { isImgIcon, isTextIcon, textIconContent, contrastColor } from './ItemIconPicker';
import { appHostHref } from '@/lib/app-host';
import {
  HOME_SEARCH_MODE_KEY,
  HOME_SEARCH_SCOPE_KEY,
  SEARCH_SCOPES,
  homeSearchTarget,
  parseHomeSearchMode,
  parseHomeSearchScope,
  type HomeSearchMode,
} from '@/lib/home-search';
import {
  buildEngineSearchUrl,
  resolveDefaultEngineId,
  resolveSearchEngines,
} from '@/lib/search-engines';
import { useRouter } from 'next/navigation';
import 'iconify-icon';

interface Item {
  plugin: ClientPlugin;
  url: string;
}

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const pad = (n: number) => String(n).padStart(2, '0');
/* 搜索框内右侧控制（综合筛选 / 搜索引擎下拉）统一样式 */
const RIGHT_CONTROL_STYLE: React.CSSProperties = {
  position: 'absolute', right: 8, maxWidth: 72, height: 26, padding: '0 0 0 6px',
  border: '1px solid var(--mei-border)', borderRadius: 'var(--mei-radius-sm)',
  background: 'rgba(23,32,56,0.04)', color: 'var(--mei-text-muted)', fontSize: 11,
  outline: 'none', cursor: 'pointer',
};
const GRADIENTS = [
  'linear-gradient(135deg,#6366f1,#a855f7)', 'linear-gradient(135deg,#0ea5e9,#6366f1)',
  'linear-gradient(135deg,#10b981,#0ea5e9)', 'linear-gradient(135deg,#f59e0b,#ef4444)',
  'linear-gradient(135deg,#ec4899,#a855f7)', 'linear-gradient(135deg,#14b8a6,#84cc16)',
  'linear-gradient(135deg,#f43f5e,#f59e0b)', 'linear-gradient(135deg,#8b5cf6,#ec4899)',
  'linear-gradient(135deg,#3b82f6,#14b8a6)', 'linear-gradient(135deg,#a855f7,#f43f5e)',
  'linear-gradient(135deg,#64748b,#334155)',
];
function hashGradient(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}

function itemHref(item: PanelItem, lanMode: boolean): string {
  return lanMode && item.lanUrl ? item.lanUrl : item.url;
}

/**
 * 同源子应用统一走承载页 /app（外壳不卸载，音乐连续播放）；外链新窗口。
 * navigate 传入时用客户端路由跳转 —— 整页加载会销毁常驻播放引擎。
 */
function openTarget(
  href: string,
  plugins: { id: string; url: string }[],
  navigate?: (path: string) => void
): void {
  if (/^https?:\/\//.test(href)) {
    window.open(href, '_blank');
    return;
  }
  const target = appHostHref(href, plugins) || href;
  if (navigate) navigate(target);
  else window.open(target, '_self');
}

type HealthMap = Record<string, { ok: boolean; ms: number; loading: boolean }>;

/* ============ 统一图标卡片 ============ */
function UnifiedCard({
  item, lanMode, health, disabled, editMode, iconMode, plugins, navigate,
  onEdit, onDelete, onContext, onDragStart, onDragOver, onDrop, isDragging, shouldBlockClick,
}: {
  item: PanelItem;
  lanMode: boolean;
  health?: { ok: boolean; ms: number; loading: boolean };
  disabled?: boolean;
  editMode: boolean;
  iconMode?: boolean;
  plugins: { id: string; url: string }[];
  navigate: (path: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onContext: (e: React.MouseEvent) => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  isDragging: boolean;
  shouldBlockClick: () => boolean;
}) {
  const href = itemHref(item, lanMode);
  const status = !health
    ? null
    : health.loading
    ? { color: 'var(--mei-text-faint)' }
    : health.ok
    ? { color: 'var(--mei-success)' }
    : { color: 'var(--mei-danger)' };
  // 底色：自定义色 > 内置渐变 > 白色（默认）；前景色随底色亮度自动对比
  const tileBg = item.iconColor === 'gradient'
    ? 'linear-gradient(135deg,#6366f1,#a855f7)'
    : item.iconColor || (item.builtin ? hashGradient(item.builtin) : '#ffffff');
  const tileFg = contrastColor(item.iconColor || (item.builtin ? 'gradient' : '#ffffff'));
  const iconNode = isImgIcon(item.icon) ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={item.icon} alt={item.title} style={{ width: 22, height: 22, objectFit: 'contain' }} />
  ) : isTextIcon(item.icon) ? (
    <span style={{ fontSize: 20, fontWeight: 750 }}>{textIconContent(item.icon, item.title)}</span>
  ) : (
    <MeiIcon icon={item.icon || 'lucide:link'} size={22} style={{ color: tileFg }} />
  );
  let pathText = href;
  try {
    const baseUrl = typeof window === 'undefined' ? 'http://localhost' : window.location.href;
    const displayUrl = new URL(href, baseUrl);
    pathText = `${displayUrl.hostname}${displayUrl.pathname}`;
  } catch {}
  return (
    <div
      style={{ textDecoration: 'none', display: 'flex', opacity: isDragging ? 0.35 : 1 }}
      draggable={editMode}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <button
        className="mei-app-card"
        data-disabled={disabled ? 'true' : undefined}
        data-mode={iconMode ? 'icon' : 'compact'}
        type="button"
        onClick={() => { if (shouldBlockClick()) return; if (!editMode && !disabled) openTarget(href, plugins, navigate); }}
        onContextMenu={onContext}
        title={editMode ? '拖拽排序 / 右键菜单' : item.title}
      >
        {status && (
          <span
            title={health?.ok ? `在线 ${health.ms}ms` : '离线'}
            style={{ position: 'absolute', top: 12, right: 12, width: 7, height: 7, borderRadius: '50%', background: status.color, boxShadow: `0 0 8px ${status.color}` }}
          />
        )}
        {editMode && (
          <span
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            title="删除"
            style={{
              position: 'absolute', top: 7, right: 7, width: 20, height: 20,
              borderRadius: '50%', background: 'rgba(239,68,68,0.9)', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, cursor: 'pointer', zIndex: 2, lineHeight: 1,
            }}
          >
            ×
          </span>
        )}
        {/* 图标模式：纵向居中（图标在上、名称在下）；卡片模式：图标 + 名称行（路径居右）+ 两行描述 */}
        {iconMode ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: '100%' }}>
            <div className="mei-icon-tile" style={{ flexShrink: 0, background: tileBg, color: tileFg, border: tileBg === '#ffffff' ? '1px solid rgba(23,32,56,0.1)' : undefined }}>{iconNode}</div>
            <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3, textAlign: 'center', width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
            <div className="mei-icon-tile" style={{ flexShrink: 0, background: tileBg, color: tileFg, border: tileBg === '#ffffff' ? '1px solid rgba(23,32,56,0.1)' : undefined }}>{iconNode}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* 名称行：名称在左，路径居右对齐 */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontWeight: 650, fontSize: 14, lineHeight: 1.3, letterSpacing: 0.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{item.title}</span>
                <span style={{ marginLeft: 'auto', flexShrink: 1, minWidth: 0, maxWidth: '48%', color: 'var(--mei-text-faint)', fontSize: 10.5, letterSpacing: 0.5, opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>
                  {pathText}
                </span>
              </div>
              {/* 描述：固定预留两行高度，超出截断 */}
              <div style={{
                color: 'var(--mei-text-muted)', fontSize: 12, lineHeight: 1.4, marginTop: 3,
                display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2,
                overflow: 'hidden', minHeight: '2.8em', wordBreak: 'break-all',
              }}>
                {item.description}
              </div>
            </div>
          </div>
        )}
      </button>
    </div>
  );
}

/* ============ 编辑弹层（新增/编辑图标项） ============ */
function ItemFormModal({
  item, groups, onClose, onSubmit,
}: {
  item: PanelItem;
  groups: { id: string; name: string }[];
  onClose: () => void;
  onSubmit: (item: PanelItem) => void;
}) {
  const [form, setForm] = useState<PanelItem>(item);
  const [newGroup, setNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const input: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 10,
    fontSize: 13, border: '1px solid var(--mei-border-strong)', outline: 'none',
    color: 'var(--mei-text)', background: '#fff',
  };
  const label: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--mei-text-muted)', margin: '10px 0 4px' };
  return (
    <div
      data-no-pagedrag
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(10,14,26,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{ width: 760, maxWidth: 'calc(100vw - 32px)', borderRadius: 18, padding: 20, background: 'rgba(255,255,255,0.97)', border: '1px solid var(--mei-border-strong)', boxShadow: 'var(--mei-shadow-lg)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 15, fontWeight: 700 }}>{form.id ? '编辑图标项' : '添加图标项'}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={label}>标题</label>
            <input style={input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="必填" />
          </div>
          <div>
            <label style={label}>分组</label>
            {/* 选择已有分组（显示名称）或切换到新建模式输入名称；新名称在 upsertItem 生成随机唯一 id */}
            {newGroup ? (
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  style={input}
                  value={newGroupName}
                  autoFocus
                  placeholder="输入新分组名称"
                  onChange={(e) => { setNewGroupName(e.target.value); setForm({ ...form, groupId: e.target.value }); }}
                  onKeyDown={(e) => { if (e.key === 'Escape') { setNewGroup(false); setNewGroupName(''); setForm({ ...form, groupId: '' }); } }}
                />
                <button
                  type="button"
                  onClick={() => { setNewGroup(false); setNewGroupName(''); setForm({ ...form, groupId: '' }); }}
                  style={{ border: '1px solid var(--mei-border-strong)', borderRadius: 10, padding: '0 12px', cursor: 'pointer', fontSize: 13, color: 'var(--mei-text-muted)', whiteSpace: 'nowrap' }}
                >取消</button>
              </div>
            ) : (
              <select
                style={input}
                value={groups.some((g) => g.id === form.groupId) ? form.groupId : ''}
                onChange={(e) => {
                  if (e.target.value === '__new__') {
                    setNewGroup(true);
                    setNewGroupName('');
                  } else {
                    setForm({ ...form, groupId: e.target.value });
                  }
                }}
              >
                <option value=''>未分组</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                <option value='__new__'>＋ 新建分组…</option>
              </select>
            )}
          </div>
        </div>
        <label style={label}>描述</label>
        <input style={input} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="可选" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={label}>地址</label>
            <input style={input} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://… 或 /path" />
          </div>
          <div>
            <label style={label}>内网地址（可选）</label>
            <input style={input} value={form.lanUrl} onChange={(e) => setForm({ ...form, lanUrl: e.target.value })} placeholder="http://192.168.x.x…" />
          </div>
        </div>

        <label style={label}>图标（图标库 / 文字 / 图片，含底色）</label>
        <ItemIconPicker
          icon={form.icon}
          iconColor={form.iconColor || ''}
          title={form.title}
          itemUrl={form.url}
          onIcon={(icon) => setForm({ ...form, icon })}
          onColor={(c) => setForm({ ...form, iconColor: c })}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 10, borderRadius: 12, border: '1px solid var(--mei-border-strong)', background: 'transparent', color: 'var(--mei-text-muted)', fontSize: 13, cursor: 'pointer' }}>取消</button>
          <button
            onClick={() => { if (form.title.trim() && form.url.trim()) onSubmit({ ...form, id: form.id || `c${Date.now()}` }); }}
            style={{ flex: 1, padding: 10, borderRadius: 12, border: 'none', background: 'var(--mei-gradient)', color: '#fff', fontSize: 13, fontWeight: 650, cursor: 'pointer' }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============ 主页 ============ */
export default function PortalClient({ items, panel: initialPanel }: { items: Item[]; panel: PanelConfig }) {
  const router = useRouter();
  const [panel, setPanel] = useState(initialPanel);
  // 本地配置同步真源：所有变更先写 ref 再写 state，避免连续操作读到过期闭包里的 panel
  const panelRef = useRef(initialPanel);
  const applyPanel = useCallback((next: PanelConfig) => {
    panelRef.current = next;
    setPanel(next);
  }, []);
  const editModeRef = useRef(false);
  // 小说站点列表（首页站点图标项数据源，尊重 ns-open 可见性）
  const [novelSites, setNovelSites] = useState<Array<{ slug: string; name: string; type: 'normal' | 'secret'; icon?: string; iconColor?: string; description?: string }>>([]);
  const reloadNovelSites = useCallback(() => {
    fetch('/api/novels/sites', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setNovelSites(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, []);
  useEffect(() => { reloadNovelSites(); }, [reloadNovelSites]);
  // 客户端同步配置（确保 hydration 后拿到最新配置；无论背景图有无都同步，保证删除背景也生效）
  useEffect(() => {
    const sync = () => fetch('/api/panel', { credentials: 'include' })
      .then(r => r.json())
      .then(cfg => {
        if (!cfg || !cfg.background || !cfg.style) return;
        // 编辑排序时后台只同步外观，避免旧 items 覆盖正在排的顺序
        if (editModeRef.current) applyPanel({ ...panelRef.current, background: cfg.background, style: cfg.style });
        else applyPanel(cfg);
      })
      .catch(() => {});
    sync();
    // 顶栏滑块/主题切换保存后广播 mei-panel-change，这里实时刷新（否则遮罩/模糊/主题不生效）
    // 自身保存已乐观更新，跳过 source=portal，避免用可能未落盘的旧配置覆盖本地排序
    const onPanelChange = (e: Event) => {
      if ((e as CustomEvent).detail?.source === 'portal') return;
      sync();
    };
    window.addEventListener('mei-panel-change', onPanelChange);
    return () => window.removeEventListener('mei-panel-change', onPanelChange);
  }, [applyPanel]);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  // 首页搜索框模式：web=网页搜索（Enter 用所选引擎跳外部，默认）| all=综合搜索（Enter 进 /search 聚合页）
  // 选择记忆在 localStorage；SSR 首帧一律按 web 渲染，hydration 后再读记忆，避免水合不一致
  const [searchMode, setSearchMode] = useState<HomeSearchMode>('web');
  useEffect(() => {
    try { setSearchMode(parseHomeSearchMode(localStorage.getItem(HOME_SEARCH_MODE_KEY))); } catch {}
  }, []);
  const switchSearchMode = useCallback((mode: HomeSearchMode) => {
    setSearchMode(mode);
    try { localStorage.setItem(HOME_SEARCH_MODE_KEY, mode); } catch {}
  }, []);
  // 综合搜索筛选范围（记忆在 localStorage，与模式独立）
  const [searchScope, setSearchScope] = useState('all');
  useEffect(() => {
    try { setSearchScope(parseHomeSearchScope(localStorage.getItem(HOME_SEARCH_SCOPE_KEY))); } catch {}
  }, []);
  const switchSearchScope = useCallback((scope: string) => {
    setSearchScope(scope);
    try { localStorage.setItem(HOME_SEARCH_SCOPE_KEY, scope); } catch {}
  }, []);
  const [now, setNow] = useState<Date | null>(null);
  const [sys, setSys] = useState<{ memory: { percent: number; used: number; total: number }; loadavg: number[]; cpuCount: number } | null>(null);
  const [lanMode, setLanMode] = useState(false);
  const [editMode, setEditMode] = useState(false);
  editModeRef.current = editMode;
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: PanelItem } | null>(null);
  const [editing, setEditing] = useState<PanelItem | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  // 分组分页
  // 用分组 id 而非索引记忆当前页：进入/退出编辑模式时 pages 形态会变化，
  // 按 id 锚定可避免激活页跳到空的「常用」页导致图标全消失
  const [pageId, setPageId] = useState('');
  const [dragPage, setDragPage] = useState<{ startX: number; startIdx: number; offset: number; active: boolean } | null>(null);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const health = useHealth() as HealthMap;
  const style = panel.style;
  // 插件路径表：首页图标点击时用于判断该地址属于哪个子应用（→ 走 /app 承载页）
  const hostPlugins = useMemo(
    () => items.map((it) => ({ id: it.plugin.id, url: it.url })),
    [items]
  );
  const navigate = useCallback((path: string) => router.push(path), [router]);
  // 有效搜索引擎列表与默认引擎（面板未自定义时回落内置种子，见 lib/search-engines）
  const engines = useMemo(() => resolveSearchEngines(panel?.style), [panel?.style]);
  const defaultEngineId = useMemo(() => resolveDefaultEngineId(panel?.style, engines), [panel?.style, engines]);

  // 时钟
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // favicon 联动：主页使用设置里配置的 Logo 作为网站图标（与子应用注入顶栏行为一致）
  useEffect(() => {
    const icon = panel.style?.logoImage || '/logo.svg';
    // 只改写 href、绝不 remove()：Next/React 把 <link rel=icon> 当 hoistable resource 托管，
    // 外部删除后其 parentNode 变 null，下一次路由卸载会抛
    // 「Cannot read properties of null (reading 'removeChild')」并整页白屏（连带销毁常驻播放器）。
    const existing = document.querySelectorAll<HTMLLinkElement>(
      'link[rel="icon"],link[rel="shortcut icon"],link[rel="apple-touch-icon"]'
    );
    if (existing.length) {
      existing.forEach((el) => {
        el.href = icon;
      });
      return;
    }
    const link = document.createElement('link');
    link.rel = 'icon';
    link.href = icon;
    document.head.appendChild(link);
  }, [panel.style?.logoImage]);

  // 统一身份改造后子应用不再各自持有登录态，无需补发 cookie/token。

  // 内网模式
  useEffect(() => {
    try { setLanMode(localStorage.getItem('mei-lan-mode') === '1'); } catch {}
    const onLan = () => { try { setLanMode(localStorage.getItem('mei-lan-mode') === '1'); } catch {} };
    window.addEventListener('storage', onLan);
    window.addEventListener('mei-lan-change', onLan as EventListener);
    return () => { window.removeEventListener('storage', onLan); window.removeEventListener('mei-lan-change', onLan as EventListener); };
  }, []);

  // 系统监控
  useEffect(() => {
    if (!style?.systemMonitorShow) return;
    const load = () => fetch('/api/system').then((r) => r.json()).then(setSys).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [style?.systemMonitorShow]);

  // ⌘K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 方向键翻页
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (editMode) return;
      const idx = pagesRef.current.findIndex((p) => p.id === pageId);
      const cur = idx >= 0 ? idx : 0;
      if (e.key === 'ArrowLeft' && !e.ctrlKey && !e.metaKey) {
        const target = pagesRef.current[Math.max(0, cur - 1)];
        if (target) setPageId(target.id);
      }
      if (e.key === 'ArrowRight' && !e.ctrlKey && !e.metaKey) {
        const target = pagesRef.current[cur + 1];
        if (target) setPageId(target.id);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editMode, pageId]);

  // 全局鼠标拖拽翻页（mousedown/mousemove/mouseup 全部全局监听，无区域限制）
  // 防护：输入框/弹层内不触发；拖拽后抑制卡片点击，避免误打开应用
  const swiperRef = useRef<HTMLDivElement>(null);
  const dragMovedRef = useRef(false);
  const pagesRef = useRef<Array<{ id: string; name: string; items: PanelItem[]; group?: PanelGroup }>>([]);
  useEffect(() => {
    const mouseDown = (e: MouseEvent) => {
      // 编辑模式：锁定分组切换，避免鼠标拖拽翻页与卡片拖拽排序冲突
      if (editMode) return;
      const t = e.target as HTMLElement | null;
      if (t && t.closest('input, textarea, select, [contenteditable="true"], [data-no-pagedrag]')) return;
      dragMovedRef.current = false;
      const idx = pagesRef.current.findIndex((p) => p.id === pageId);
      setDragPage({ startX: e.clientX, startIdx: idx >= 0 ? idx : 0, offset: 0, active: true });
    };
    const mouseMove = (e: MouseEvent) => {
      if (dragPage?.active) {
        const d = e.clientX - dragPage.startX;
        if (Math.abs(d) > 8) dragMovedRef.current = true;
        setDragPage({ ...dragPage, offset: d });
      }
    };
    const mouseUp = () => {
      if (dragPage?.active) {
        const threshold = 80;
        if (dragPage.offset < -threshold) {
          const target = pagesRef.current[dragPage.startIdx + 1];
          if (target) setPageId(target.id);
        } else if (dragPage.offset > threshold) {
          const target = pagesRef.current[Math.max(0, dragPage.startIdx - 1)];
          if (target) setPageId(target.id);
        }
        setDragPage(null);
        // click 事件在 mouseup 之后同步触发，先置标志再在宏任务中复位
        setTimeout(() => { dragMovedRef.current = false; }, 0);
      }
    };
    document.addEventListener('mousedown', mouseDown);
    document.addEventListener('mousemove', mouseMove);
    document.addEventListener('mouseup', mouseUp);
    return () => {
      document.removeEventListener('mousedown', mouseDown);
      document.removeEventListener('mousemove', mouseMove);
      document.removeEventListener('mouseup', mouseUp);
    };
  }, [dragPage, pageId, editMode]);

  // 点击关闭右键菜单
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  // 自动保存（items/groups/removedBuiltin 变更后调用）
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const savePanel = useCallback((next: PanelConfig, tip = '已保存') => {
    applyPanel(next);
    // 串行落盘：连续快速拖拽时按调用顺序持久化，最终服务端状态等于最后一次操作
    saveChainRef.current = saveChainRef.current
      .catch(() => {})
      .then(async () => {
        try {
          const res = await fetch('/api/panel', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            credentials: 'include', body: JSON.stringify(next),
          });
          if (res.ok) setToast(tip); else setToast('保存失败');
          // 广播配置变更（顶栏滑块/主题状态同步）
          window.dispatchEvent(new CustomEvent('mei-panel-change', { detail: { source: 'portal' } }));
        } catch { setToast('保存失败'); }
        setTimeout(() => setToast(''), 1500);
      });
  }, [applyPanel]);

  // 框内切换搜索引擎 = 设为默认（与设置页「设为默认」同一字段，自动落盘）
  const switchSearchEngine = useCallback((id: string) => {
    const cur = panelRef.current;
    savePanel({ ...cur, style: { ...cur.style, searchEngine: id } }, '已设为默认搜索引擎');
  }, [savePanel]);

  /* ---- 管理操作 ---- */
  const upsertItem = async (item: PanelItem) => {
    const cur = panelRef.current;
    // 分组归一：输入可能是分组 id 或分组名称（datalist 选出来的是名称）；
    // 名称必须映射回 id，否则渲染时匹配不上分组，全部落到「常用」
    let groupId = item.groupId.trim();
    let groups = cur.groups;
    if (groupId) {
      const byId = groups.find((g) => g.id === groupId);
      const byName = groups.find((g) => g.name === groupId);
      if (byId) {
        groupId = byId.id;
      } else if (byName) {
        groupId = byName.id;
      } else {
        // 新名称 → 自动创建新分组（随机唯一 id；必须进入保存的 next，否则服务端没有该分组）
        const newGroup = { id: `g${Date.now()}${Math.random().toString(36).slice(2, 8)}`, name: groupId };
        groups = [...groups, newGroup];
        groupId = newGroup.id;
      }
    }
    const finalItem = { ...item, groupId };
    const exists = cur.items.some((i) => i.id === finalItem.id);
    const next = exists
      ? { ...cur, groups, items: cur.items.map((i) => (i.id === finalItem.id ? finalItem : i)) }
      : { ...cur, groups, items: [...cur.items, finalItem] };
    setEditing(null);
    savePanel(next, exists ? '已更新' : '已添加');
  };

  const deleteItem = (item: PanelItem) => {
    if (!confirm(`删除「${item.title}」？`)) return;
    const cur = panelRef.current;
    const next: PanelConfig = {
      ...cur,
      items: cur.items.filter((i) => i.id !== item.id),
      removedBuiltin: item.builtin && !cur.removedBuiltin.includes(item.builtin)
        ? [...cur.removedBuiltin, item.builtin]
        : cur.removedBuiltin,
    };
    savePanel(next, '已删除');
  };

  // 拖拽：把 dragId 项移动到 target 项附近（同组或跨组）
  // 向下拖 → 插到目标之后；向上拖 → 插到目标之前，保证相邻一格交换也能生效
  const moveBefore = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const cur = panelRef.current;
    const list = [...cur.items];
    const from = list.findIndex((i) => i.id === dragId);
    const rawTo = list.findIndex((i) => i.id === targetId);
    if (from < 0 || rawTo < 0) return;
    const [it] = list.splice(from, 1);
    // 移除后目标索引可能前移，需重新定位
    const to = list.findIndex((i) => i.id === targetId);
    const target = to >= 0 ? list[to] : null;
    it.groupId = target ? target.groupId : it.groupId;
    const insertAt = from < rawTo ? to + 1 : to;
    list.splice(insertAt >= 0 ? insertAt : list.length, 0, it);
    setDragId(null);
    savePanel({ ...cur, items: list }, '已排序');
  };
  // 拖拽到组末尾（追加到该组最后一个项之后）
  const moveToGroupEnd = (groupId: string) => {
    if (!dragId) return;
    const cur = panelRef.current;
    const list = [...cur.items];
    const from = list.findIndex((i) => i.id === dragId);
    if (from < 0) return;
    const [it] = list.splice(from, 1);
    it.groupId = groupId;
    let lastIdx = -1;
    list.forEach((i, idx) => { if (i.groupId === groupId) lastIdx = idx; });
    list.splice(lastIdx + 1, 0, it);
    setDragId(null);
    savePanel({ ...cur, items: list }, '已移动');
  };

  /* ---- 过滤与分组 ---- */
  const q = query.trim().toLowerCase();
  const matchText = (t: string, d: string) => !q || t.toLowerCase().includes(q) || d.toLowerCase().includes(q);
  const visibleItems = useMemo(
    () => panel.items.filter((i) => matchText(i.title, i.description)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [panel.items, query]
  );
  const isSwitchedOff = (item: PanelItem) => !!(item.builtin && isSwitchable(item.builtin) && !isAppEnabled(item.builtin));
  const healthOf = (item: PanelItem) => (item.builtin ? health[item.builtin] : undefined);

  // 小说站点：每个可见站点一个独立图标项（客户端动态获取，尊重 ns-open 可见性；编辑模式不注入）
  const siteItems: PanelItem[] = useMemo(
    () => (editMode ? [] : novelSites
      .filter((s) => matchText(s.name, s.description || ''))
      .map((s) => ({
        id: `nsite-${s.slug}`,
        groupId: 'g-novel-sites',
        title: s.name,
        description: s.description || (s.type === 'secret' ? '隐秘站点' : '小说站点'),
        url: `/novels/s/${s.slug}`,
        lanUrl: '',
        icon: s.icon || 'lucide:book-open',
        iconColor: s.iconColor || '',
      }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [novelSites, editMode, query]
  );

  const ungrouped = visibleItems.filter((i) => !i.groupId || !panel.groups.some((g) => g.id === i.groupId));
  const grouped = panel.groups
    .map((g) => ({ group: g, list: visibleItems.filter((i) => i.groupId === g.id) }))
    .filter((s) => s.list.length > 0 || editMode);

  // 分页：第0页=常用(未分组)，1+页=分组，末页=小说站点（有可见站点时）
  const pages: Array<{ id: string; name: string; items: PanelItem[]; group?: PanelGroup }> = [
    { id: 'default', name: '常用', items: ungrouped },
    ...grouped.map(g => ({ id: g.group.id, name: g.group.name, items: g.list, group: g.group })),
    ...(siteItems.length > 0 ? [{ id: 'g-novel-sites', name: '小说站点', items: siteItems }] : []),
  ].filter(p => p.items.length > 0 || editMode || query);
  pagesRef.current = pages;
  // 按分组 id 锚定当前页：进入/退出编辑模式时 pages 形态会变化，
  // 找不到（如小说站点页在编辑态被清空）时落到第一个有图标的页，避免停在空「常用」页
  const pageIdx = (() => {
    const i = pages.findIndex((p) => p.id === pageId);
    if (i >= 0) return i;
    const first = pages.findIndex((p) => p.items.length > 0);
    return first >= 0 ? first : 0;
  })();
  const activePage = pages[pageIdx] || pages[0];

  // 分页切换（含方向键和拖拽）
  const goPage = (dir: number) => {
    const idx = pages.findIndex((p) => p.id === pageId);
    const cur = idx >= 0 ? idx : 0;
    const next = Math.max(0, Math.min(pages.length - 1, cur + dir));
    const target = pages[next];
    if (target) setPageId(target.id);
  };

  // 隐秘小说站点命令：open:{标识}:{密码} / close:{标识}:{密码}
  const GATE_CMD = /^(open|close):([A-Za-z0-9][A-Za-z0-9-]*):(.+)$/;
  async function runGateCommand(action: 'open' | 'close', slug: string, password: string) {
    try {
      const res = await fetch('/api/novels/gate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action, slug, password }),
      });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (res.ok) {
        setToast(action === 'open' ? `隐秘站点「${data.name || slug}」已开启` : `隐秘站点「${data.name || slug}」已关闭`);
        reloadNovelSites();
      } else {
        setToast(String(data.error || '操作失败'));
      }
    } catch {
      setToast('小说服务暂不可用');
    }
    setTimeout(() => setToast(''), 2000);
  }

  function submitSearch() {
    const q = query.trim();
    // 隐秘站点命令优先（无论是否有应用匹配）
    const gate = q.match(GATE_CMD);
    if (gate) {
      setQuery('');
      void runGateCommand(gate[1] as 'open' | 'close', gate[2], gate[3]);
      return;
    }
    if (!q) return;
    // 综合搜索：客户端路由进 /search 聚合页（scope 由框内筛选决定，外壳不重载、播放不中断）
    if (searchMode === 'all') {
      navigate(homeSearchTarget(q, searchScope));
      return;
    }
    // 网页搜索：有应用匹配时 Enter 不动作（点卡片打开）；无匹配才用所选引擎跳转
    if (visibleItems.length > 0) return;
    const engine = engines.find((e) => e.id === style?.searchEngine) || engines[0];
    window.open(buildEngineSearchUrl(engine, q), '_blank');
  }

  const clock = now ? { hh: pad(now.getHours()), mm: pad(now.getMinutes()), ss: pad(now.getSeconds()) } : { hh: '--', mm: '--', ss: '--' };
  const dateText = now ? `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 · ${WEEKDAYS[now.getDay()]}` : '';
  const maxW = style?.maxWidth || 1180;
  // 深浅主色调：深色背景 → 文字浅色（dark）；浅色背景 → 文字深色（light，默认）
  const themeMode = style?.themeMode === 'dark' ? 'dark' : 'light';
  const textColor = style?.iconTextColor || undefined;

  const iconMode = style?.iconStyle === 'icon';
  const renderCard = (item: PanelItem, pageIconMode: boolean) => (
    <UnifiedCard
      key={item.id}
      item={item}
      lanMode={lanMode}
      plugins={hostPlugins}
      navigate={navigate}
      health={healthOf(item)}
      disabled={isSwitchedOff(item)}
      editMode={editMode}
      iconMode={pageIconMode}
      isDragging={dragId === item.id}
      onEdit={() => setEditing(item)}
      onDelete={() => deleteItem(item)}
      onContext={(e) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, item });
      }}
      onDragStart={() => setDragId(item.id)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        // 阻止冒泡：落点落在卡片上只做卡片级排序，不触发分组的「移到组尾」
        e.stopPropagation();
        moveBefore(item.id);
      }}
      shouldBlockClick={() => dragMovedRef.current}
    />
  );

  return (
    // isolation: isolate 让负 z-index 的背景层在本组件层叠上下文内绘制，避免被 body 背景遮盖
    // data-mei-theme：深浅主色调适配（深色背景文字浅色，浅色背景文字深色），变量覆写见 globals.css
    <div data-mei-theme={themeMode} style={{ minHeight: '100vh', position: 'relative', isolation: 'isolate' }}>
      {/* 背景 */}
      {panel?.background?.url ? (
        <>
          <div aria-hidden style={{ position: 'fixed', inset: 0, zIndex: -3, backgroundImage: `url(${panel.background.url})`, backgroundSize: 'cover', backgroundPosition: 'center', filter: panel.background.blur ? `blur(${panel.background.blur}px)` : undefined, transform: panel.background.blur ? 'scale(1.06)' : undefined }} />
          {/* 遮罩颜色随主色调：深色主题压暗背景保证浅文字可读；浅色主题提亮背景保证深文字可读 */}
          <div aria-hidden style={{ position: 'fixed', inset: 0, zIndex: -2, background: themeMode === 'dark' ? `rgba(7,10,19,${panel.background.mask})` : `rgba(244,247,252,${panel.background.mask})` }} />
        </>
      ) : (
        <div className="mei-aurora" aria-hidden>
          <div className="blob blob-1" /><div className="blob blob-2" /><div className="blob blob-3" />
        </div>
      )}

      <TopBar query="" onSearch={() => {}} showSearch={false} transparent />

      <main
        style={{
          maxWidth: maxW, margin: '0 auto',
          paddingTop: `${style?.marginTop ?? 4}%`, paddingBottom: `${style?.marginBottom ?? 6}%`,
          paddingLeft: 'var(--mei-space-6)', paddingRight: 'var(--mei-space-6)',
        }}
      >
        {/* Logo + 时钟 + 监控 */}
        <section style={{ textAlign: 'center', marginBottom: 30 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', justifyContent: 'center' }}>
            {/* Logo：未设置自定义图片时用默认 Logo */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={style?.logoImage || '/logo.svg'} alt="logo" style={{ maxHeight: 56, maxWidth: style?.logoImage ? 260 : 56, objectFit: 'contain', borderRadius: style?.logoImage ? undefined : 14 }} />
            {style?.logoText ? (
              <span style={{ fontSize: 32, fontWeight: 800, letterSpacing: 1, color: textColor, textShadow: '0 2px 24px rgba(99,102,241,0.25)' }}>{style.logoText}</span>
            ) : null}
            <span style={{ color: 'var(--mei-text-faint)', fontSize: 20 }}>|</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 34, fontWeight: 250, letterSpacing: 1, color: textColor, textShadow: '0 1px 18px rgba(99,102,241,0.18)' }}>
              {clock.hh}:{clock.mm}
              {style?.clockShowSecond && <span style={{ fontSize: 20, color: 'var(--mei-text-muted)' }}>:{clock.ss}</span>}
            </span>
          </div>
          <div style={{ color: textColor || 'var(--mei-text-muted)', fontSize: 13, letterSpacing: 1.5, marginTop: 4 }}>{dateText}</div>
          {style?.systemMonitorShow && sys && (
            <div style={{ display: 'inline-flex', gap: 16, marginTop: 12, padding: '6px 16px', borderRadius: 'var(--mei-radius-full)', background: 'var(--mei-surface)', border: '1px solid var(--mei-border)', backdropFilter: 'blur(14px)', fontSize: 12, color: 'var(--mei-text-muted)' }}>
              <span>内存 {sys.memory.percent}%（{sys.memory.used}/{sys.memory.total}MB）</span>
              <span>CPU 负载 {sys.loadavg[0]}（{sys.cpuCount} 核）</span>
            </div>
          )}
        </section>

        {/* 搜索框：框内左侧模式切换 + 右侧按模式显示筛选/引擎 */}
        {style?.searchBoxShow !== false && (
          <section style={{ maxWidth: 640, margin: '0 auto 32px' }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              {/* 模式切换：综合（/search 聚合页）/ 网页（外部引擎）—— 框内左侧 */}
              <div
                data-no-pagedrag
                role="group"
                aria-label="搜索模式"
                title={searchMode === 'all' ? '综合搜索：聚合全站资源（右侧可筛选类型）' : '网页搜索：跳转所选搜索引擎'}
                style={{
                  position: 'absolute', left: 8, zIndex: 1, display: 'inline-flex', alignItems: 'center', gap: 1, padding: 2,
                  borderRadius: 'var(--mei-radius-full)', background: 'rgba(23,32,56,0.055)',
                  border: '1px solid var(--mei-border)',
                }}
              >
                {([['all', '综合'], ['web', '网页']] as const).map(([mode, label]) => {
                  const active = searchMode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={active}
                      onClick={() => switchSearchMode(mode)}
                      style={{
                        border: 'none', borderRadius: '999px', padding: '3px 8px', fontSize: 11,
                        lineHeight: 1.3, cursor: 'pointer', transition: 'all .18s ease',
                        background: active ? 'var(--mei-gradient)' : 'transparent',
                        color: active ? '#fff' : 'var(--mei-text-muted)',
                        fontWeight: active ? 650 : 500,
                        boxShadow: active ? '0 0 8px rgba(129,140,248,0.35)' : 'none',
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitSearch(); }}
                placeholder={searchMode === 'all' ? '综合搜索影视 / 音乐 / 网盘 / 工具…' : '搜索应用与链接，或直接搜索网页…'}
                style={{
                  width: '100%', padding: '14px 88px 14px 96px', fontSize: 14,
                  color: 'var(--mei-text)', background: 'var(--mei-surface)',
                  backdropFilter: 'blur(22px) saturate(1.5)', WebkitBackdropFilter: 'blur(22px) saturate(1.5)',
                  border: '1px solid var(--mei-border)', borderRadius: 'var(--mei-radius-full)',
                  outline: 'none', transition: 'var(--mei-transition)', boxShadow: 'var(--mei-shadow-sm)',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(99,102,248,0.55)'; e.currentTarget.style.boxShadow = 'var(--mei-glow)'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--mei-border)'; e.currentTarget.style.boxShadow = 'var(--mei-shadow-sm)'; }}
              />
              {/* 右侧控制：综合 = 范围筛选；网页 = 搜索引擎（选择即设为默认） */}
              {searchMode === 'all' ? (
                <select
                  aria-label="综合搜索筛选"
                  title="综合搜索筛选：按资源类型直达对应频道"
                  value={searchScope}
                  onChange={(e) => switchSearchScope(e.target.value)}
                  style={RIGHT_CONTROL_STYLE}
                >
                  {SEARCH_SCOPES.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              ) : (
                <select
                  aria-label="搜索引擎"
                  title="搜索引擎（选择即设为默认，可在设置页管理）"
                  value={defaultEngineId}
                  onChange={(e) => switchSearchEngine(e.target.value)}
                  style={RIGHT_CONTROL_STYLE}
                >
                  {engines.map((eng) => (
                    <option key={eng.id} value={eng.id}>{eng.name}</option>
                  ))}
                </select>
              )}
            </div>
          </section>
        )}

        {/* 编辑模式提示条 */}
        {editMode && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, padding: '8px 14px', borderRadius: 'var(--mei-radius)', background: 'var(--mei-gradient-soft)', border: '1px solid rgba(99,102,241,0.3)', fontSize: 12, color: 'var(--mei-text-muted)' }}>
            <MeiIcon icon="lucide:settings-2" size={14} />
            编辑模式：拖拽卡片排序 / 跨组移动，右键或 × 删除，点击 + 添加。所有修改自动保存。
          </div>
        )}

        {/* ===== 分页容器：macOS 应用页切屏风格 ===== */}
        <div
          style={{ position: 'relative', overflow: 'hidden', userSelect: 'none' }}
          onTouchStart={(e) => { if (editMode) return; setTouchStartX(e.touches[0].clientX); }}
          onTouchEnd={(e) => { if (editMode) { setTouchStartX(null); return; } if (touchStartX !== null) { const d = e.changedTouches[0].clientX - touchStartX; if (d < -80) goPage(1); else if (d > 80) goPage(-1); setTouchStartX(null); } }}
        >
          {/* 页面指示器 */}
          {pages.length > 1 && !editMode && !query && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 14 }}>
              <button onClick={() => goPage(-1)} disabled={pageIdx <= 0} style={{ border: 'none', background: 'transparent', color: 'var(--mei-text-faint)', cursor: 'pointer', fontSize: 16, opacity: pageIdx <= 0 ? 0.3 : 1 }}>◀</button>
              {pages.map((p, i) => (
                <button
                  key={p.id}
                  onClick={() => setPageId(p.id)}
                  style={{
                    border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                    padding: '4px 10px', borderRadius: 'var(--mei-radius-full)', fontSize: 12,
                    color: i === pageIdx ? 'var(--mei-primary)' : 'var(--mei-text-faint)',
                    fontWeight: i === pageIdx ? 650 : 400,
                  }}
                >
                  <span style={{ width: i === pageIdx ? 6 : 5, height: i === pageIdx ? 6 : 5, borderRadius: '50%', background: i === pageIdx ? 'var(--mei-primary)' : 'var(--mei-border-strong)', transition: 'all .2s' }} />
                  {p.name} · {p.items.length}
                </button>
              ))}
              <button onClick={() => goPage(1)} disabled={pageIdx >= pages.length - 1} style={{ border: 'none', background: 'transparent', color: 'var(--mei-text-faint)', cursor: 'pointer', fontSize: 16, opacity: pageIdx >= pages.length - 1 ? 0.3 : 1 }}>▶</button>
            </div>
          )}
          <div
            ref={swiperRef}
            style={{
              display: 'flex', alignItems: 'flex-start', transition: 'transform .3s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
              transform: dragPage?.active ? `translateX(calc(-${pageIdx * 100}% + ${dragPage.offset}px))` : `translateX(-${pageIdx * 100}%)`,
            }}
          >
            {pages.map((page, pi) => {
              // 分组布局：分组级 iconStyle 优先，缺省跟随全局
              const pageMode: 'icon' | 'compact' = page.group?.iconStyle === 'icon' ? 'icon' : page.group?.iconStyle === 'info' ? 'compact' : (iconMode ? 'icon' : 'compact');
              const pageIconMode = pageMode === 'icon';
              return (
              <section
                key={page.id}
                style={{ minWidth: '100%', width: '100%', flexShrink: 0, boxSizing: 'border-box', paddingRight: style?.marginX || 0 }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => moveToGroupEnd(page.id === 'default' ? '' : page.id)}
              >
                {/* 分组标题行：名称 + hover 显示的操作区（布局切换 toggle + 新增图标按钮） */}
                <div className="mei-group-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--mei-space-3)' }}>
                  <span style={{ fontSize: 12, letterSpacing: 2, color: 'var(--mei-text-faint)' }}>
                    {page.name} · {page.items.length}
                    {lanMode && <span style={{ marginLeft: 8, fontSize: 11, letterSpacing: 0, color: 'var(--mei-primary)' }}>内网模式</span>}
                  </span>
                  <span className="mei-group-ops" data-no-pagedrag style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: editMode ? 1 : undefined }}>
                    <button
                      onClick={() => setEditMode((v) => !v)}
                      title={editMode ? '完成编辑' : '编辑主页'}
                      className="mei-group-op-btn"
                      style={{ cursor: 'pointer' }}
                    >
                      <MeiIcon icon={editMode ? 'lucide:check' : 'lucide:pencil'} size={13} />
                    </button>
                    <button
                      onClick={() => {
                        const cur = panelRef.current;
                        if (page.group) {
                          const next = pageIconMode ? 'info' : 'icon';
                          const groups: PanelGroup[] = cur.groups.map(g => g.id === page.group!.id ? { ...g, iconStyle: next as 'icon' | 'info' } : g);
                          savePanel({ ...cur, groups }, next === 'icon' ? '已切换为图标布局' : '已切换为卡片布局');
                        } else {
                          const next = iconMode ? 'info' : 'icon';
                          savePanel({ ...cur, style: { ...cur.style, iconStyle: next as 'icon' | 'info' } }, next === 'icon' ? '已切换为图标布局' : '已切换为卡片布局');
                        }
                      }}
                      title={pageIconMode ? '当前：图标布局（点击切换为卡片布局）' : '当前：卡片布局（点击切换为图标布局）'}
                      className="mei-layout-toggle"
                      style={{ cursor: 'pointer' }}
                    >
                      <span className={pageIconMode ? '' : 'on'}><MeiIcon icon="lucide:layout-template" size={12} /></span>
                      <span className={pageIconMode ? 'on' : ''}><MeiIcon icon="lucide:layout-grid" size={12} /></span>
                    </button>
                    <button
                      onClick={() => setEditing({ id: '', groupId: page.id === 'default' ? '' : page.id, title: '', description: '', url: '', lanUrl: '', icon: 'lucide:link', iconColor: '' })}
                      title="新增图标项"
                      className="mei-group-op-btn"
                    >
                      <MeiIcon icon="lucide:plus" size={13} />
                    </button>
                  </span>
                </div>
                <div className="mei-card-grid" data-mode={pageMode}>
                  {page.items.map((item) => renderCard(item, pageIconMode))}
                  {editMode && pageIdx === pi && (
                    <button
                      onClick={() => setEditing({ id: '', groupId: page.id === 'default' ? '' : page.id, title: '', description: '', url: '', lanUrl: '', icon: 'lucide:link', iconColor: '' })}
                      style={{ minHeight: 72, borderRadius: 'var(--mei-radius)', border: '2px dashed var(--mei-border-strong)', background: 'transparent', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: 'var(--mei-text-faint)', fontSize: 12 }}
                    >
                      <span style={{ fontSize: 26, lineHeight: 1 }}>+</span>
                      添加图标项
                    </button>
                  )}
                </div>
              </section>
              );
            })}
          </div>
        </div>

        {/* 空态 */}
        {q && visibleItems.length === 0 && (
          <div className="mei-empty">没有匹配「{query}」的应用，按 Enter 进行{searchMode === 'all' ? '综合' : '网页'}搜索</div>
        )}

        {/* 页脚 */}
        {style?.footerHtml && (
          <section style={{ marginTop: 40, textAlign: 'center', color: 'var(--mei-text-muted)' }} dangerouslySetInnerHTML={{ __html: style.footerHtml }} />
        )}
      </main>

      {/* 右键菜单 */}
      {contextMenu && (
        <div
          data-no-pagedrag
          style={{
            position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 1001,
            minWidth: 130, borderRadius: 12, padding: 5,
            background: 'rgba(255,255,255,0.97)', border: '1px solid var(--mei-border-strong)',
            boxShadow: 'var(--mei-shadow-lg)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {[
            { label: '打开', fn: () => openTarget(itemHref(contextMenu.item, lanMode), hostPlugins, navigate) },
            { label: '编辑', fn: () => setEditing(contextMenu.item) },
            { label: '删除', fn: () => deleteItem(contextMenu.item), danger: true },
          ].map((a) => (
            <button
              key={a.label}
              onClick={() => { setContextMenu(null); a.fn(); }}
              style={{
                display: 'block', width: '100%', padding: '7px 12px', border: 'none',
                background: 'transparent', borderRadius: 8, cursor: 'pointer', fontSize: 13,
                color: a.danger ? 'var(--mei-danger)' : 'var(--mei-text)', textAlign: 'left',
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      {/* 编辑/添加弹层 */}
      {editing && (
        <ItemFormModal
          item={editing}
          groups={panel.groups}
          onClose={() => setEditing(null)}
          onSubmit={upsertItem}
        />
      )}

      {/* 保存 toast */}
      {toast && (
        <div style={{
          position: 'fixed', left: '50%', bottom: 30, transform: 'translateX(-50%)', zIndex: 1002,
          padding: '8px 20px', borderRadius: 'var(--mei-radius-full)',
          background: 'rgba(13,18,32,0.85)', color: '#fff', fontSize: 13,
          boxShadow: 'var(--mei-shadow-lg)',
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}
