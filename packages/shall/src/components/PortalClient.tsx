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
import 'iconify-icon';

interface Item {
  plugin: ClientPlugin;
  url: string;
}

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const pad = (n: number) => String(n).padStart(2, '0');
const SEARCH_ENGINES: Record<string, string> = {
  bing: 'https://www.bing.com/search?q=',
  google: 'https://www.google.com/search?q=',
  baidu: 'https://www.baidu.com/s?wd=',
  duckduckgo: 'https://duckduckgo.com/?q=',
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

type HealthMap = Record<string, { ok: boolean; ms: number; loading: boolean }>;

/* ============ 统一图标卡片 ============ */
function UnifiedCard({
  item, lanMode, health, disabled, editMode, iconMode,
  onEdit, onDelete, onContext, onDragStart, onDragOver, onDrop, isDragging, shouldBlockClick,
}: {
  item: PanelItem;
  lanMode: boolean;
  health?: { ok: boolean; ms: number; loading: boolean };
  disabled?: boolean;
  editMode: boolean;
  iconMode?: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onContext: (e: React.MouseEvent) => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  isDragging: boolean;
  shouldBlockClick: () => boolean;
}) {
  const href = lanMode && item.lanUrl ? item.lanUrl : item.url;
  const external = /^https?:\/\//.test(href);
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
  const pathText = item.builtin ? (item.builtin.startsWith('tutorial-') ? '/novels' : `/${item.builtin.split('-')[0]}`) : href.replace(/^https?:\/\//, '').split('/')[0];
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
        onClick={() => { if (shouldBlockClick()) return; if (!editMode && !disabled) window.open(href, external ? '_blank' : '_self'); }}
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
            <label style={label}>分组（输入名称快速创建新分组）</label>
            <input
              style={input}
              placeholder="留空=未分组，输入新名称=新建"
              value={form.groupId}
              onChange={(e) => setForm({ ...form, groupId: e.target.value })}
              list="group-list"
            />
            <datalist id="group-list">
              {groups.map((g) => <option key={g.id} value={g.name} />)}
            </datalist>
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
  const [panel, setPanel] = useState(initialPanel);
  // 客户端同步配置（确保 hydration 后拿到最新配置；无论背景图有无都同步，保证删除背景也生效）
  useEffect(() => {
    fetch('/api/panel', { credentials: 'include' })
      .then(r => r.json())
      .then(cfg => { if (cfg && cfg.background && cfg.style) setPanel(cfg); })
      .catch(() => {});
  }, []);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [sys, setSys] = useState<{ memory: { percent: number; used: number; total: number }; loadavg: number[]; cpuCount: number } | null>(null);
  const [lanMode, setLanMode] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: PanelItem } | null>(null);
  const [editing, setEditing] = useState<PanelItem | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  // 分组分页
  const [pageIdx, setPageIdx] = useState(0);
  const [dragPage, setDragPage] = useState<{ startX: number; startIdx: number; offset: number; active: boolean } | null>(null);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const health = useHealth() as HealthMap;
  const style = panel.style;

  // 时钟
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

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
      if (e.key === 'ArrowLeft' && !e.ctrlKey && !e.metaKey) { setPageIdx(i => Math.max(0, i - 1)); }
      if (e.key === 'ArrowRight' && !e.ctrlKey && !e.metaKey) { setPageIdx(i => i + 1); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 全局鼠标拖拽翻页（mousedown/mousemove/mouseup 全部全局监听，无区域限制）
  // 防护：输入框/弹层内不触发；拖拽后抑制卡片点击，避免误打开应用
  const swiperRef = useRef<HTMLDivElement>(null);
  const dragMovedRef = useRef(false);
  useEffect(() => {
    const mouseDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest('input, textarea, select, [contenteditable="true"], [data-no-pagedrag]')) return;
      dragMovedRef.current = false;
      setDragPage({ startX: e.clientX, startIdx: pageIdx, offset: 0, active: true });
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
        if (dragPage.offset < -threshold) setPageIdx(i => i + 1);
        else if (dragPage.offset > threshold) setPageIdx(i => Math.max(0, i - 1));
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
  }, [dragPage, pageIdx]);

  // 点击关闭右键菜单
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  // 自动保存（items/groups/removedBuiltin 变更后调用）
  const savePanel = useCallback(async (next: PanelConfig, tip = '已保存') => {
    setPanel(next);
    try {
      const res = await fetch('/api/panel', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify(next),
      });
      if (!res.ok) { setToast('保存失败'); } else { setToast(tip); }
    } catch { setToast('保存失败'); }
    setTimeout(() => setToast(''), 1500);
  }, []);

  /* ---- 管理操作 ---- */
  const upsertItem = async (item: PanelItem) => {
    // 自动创建新分组：如果 groupId 是一个新名称（不在现有分组列表中），则自动创建分组
    let groupId = item.groupId;
    const groupExists = !groupId || !groupId.trim() || panel.groups.some(g => g.name === groupId.trim() || g.id === groupId);
    if (!groupExists && groupId.trim()) {
      const newGroup = { id: `g${Date.now()}`, name: groupId.trim() };
      setPanel({ ...panel, groups: [...panel.groups, newGroup] });
      groupId = newGroup.id;
    }
    const finalItem = { ...item, groupId: groupExists ? groupId : groupId };
    const exists = panel.items.some((i) => i.id === finalItem.id);
    const next = exists
      ? { ...panel, items: panel.items.map((i) => (i.id === finalItem.id ? finalItem : i)) }
      : { ...panel, items: [...panel.items, finalItem] };
    setEditing(null);
    savePanel(next, exists ? '已更新' : '已添加');
  };

  const deleteItem = (item: PanelItem) => {
    if (!confirm(`删除「${item.title}」？`)) return;
    const next: PanelConfig = {
      ...panel,
      items: panel.items.filter((i) => i.id !== item.id),
      removedBuiltin: item.builtin && !panel.removedBuiltin.includes(item.builtin)
        ? [...panel.removedBuiltin, item.builtin]
        : panel.removedBuiltin,
    };
    savePanel(next, '已删除');
  };

  // 拖拽：把 dragId 项移动到 target 项之前（同组或跨组）
  const moveBefore = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const list = [...panel.items];
    const from = list.findIndex((i) => i.id === dragId);
    if (from < 0) return;
    const [it] = list.splice(from, 1);
    const to = list.findIndex((i) => i.id === targetId);
    const target = to >= 0 ? list[to] : null;
    it.groupId = target ? target.groupId : it.groupId;
    list.splice(to >= 0 ? to : list.length, 0, it);
    setDragId(null);
    savePanel({ ...panel, items: list }, '已排序');
  };
  // 拖拽到组末尾（追加到该组最后一个项之后）
  const moveToGroupEnd = (groupId: string) => {
    if (!dragId) return;
    const list = [...panel.items];
    const from = list.findIndex((i) => i.id === dragId);
    if (from < 0) return;
    const [it] = list.splice(from, 1);
    it.groupId = groupId;
    let lastIdx = -1;
    list.forEach((i, idx) => { if (i.groupId === groupId) lastIdx = idx; });
    list.splice(lastIdx + 1, 0, it);
    setDragId(null);
    savePanel({ ...panel, items: list }, '已移动');
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

  const ungrouped = visibleItems.filter((i) => !i.groupId || !panel.groups.some((g) => g.id === i.groupId));
  const grouped = panel.groups
    .map((g) => ({ group: g, list: visibleItems.filter((i) => i.groupId === g.id) }))
    .filter((s) => s.list.length > 0 || editMode);

  // 分页：第0页=常用(未分组)，1+页=分组
  const pages: Array<{ id: string; name: string; items: PanelItem[]; group?: PanelGroup }> = [{ id: 'default', name: '常用', items: ungrouped }, ...grouped.map(g => ({ id: g.group.id, name: g.group.name, items: g.list, group: g.group }))].filter(p => p.items.length > 0 || editMode || query);
  const activePage = pages[pageIdx] || pages[0];

  // 分页切换（含方向键和拖拽）
  const goPage = (dir: number) => {
    setPageIdx(i => Math.max(0, Math.min(pages.length - 1, i + dir)));
  };

  function submitSearch() {
    const q = query.trim();
    if (!q || visibleItems.length > 0) return;
    const engine = SEARCH_ENGINES[style?.searchEngine || 'bing'] || SEARCH_ENGINES.bing;
    window.open(engine + encodeURIComponent(q), '_blank');
  }

  const clock = now ? { hh: pad(now.getHours()), mm: pad(now.getMinutes()), ss: pad(now.getSeconds()) } : { hh: '--', mm: '--', ss: '--' };
  const dateText = now ? `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 · ${WEEKDAYS[now.getDay()]}` : '';
  const maxW = style?.maxWidth || 1180;
  const textColor = style?.iconTextColor || undefined;

  const iconMode = style?.iconStyle === 'icon';
  // 分组标题行操作按钮样式（新增 / 布局切换常驻入口）
  const groupOpBtn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    border: '1px solid var(--mei-border)', background: 'var(--mei-surface)',
    backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
    borderRadius: 'var(--mei-radius-full)', padding: '4px 10px',
    color: 'var(--mei-text-muted)', fontSize: 11.5, cursor: 'pointer',
    transition: 'var(--mei-transition)',
  };
  const renderCard = (item: PanelItem, pageIconMode: boolean) => (
    <UnifiedCard
      key={item.id}
      item={item}
      lanMode={lanMode}
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
      onDrop={() => moveBefore(item.id)}
      shouldBlockClick={() => dragMovedRef.current}
    />
  );

  return (
    // isolation: isolate 让负 z-index 的背景层在本组件层叠上下文内绘制，避免被 body 背景遮盖
    <div style={{ minHeight: '100vh', position: 'relative', isolation: 'isolate' }}>
      {/* 背景 */}
      {panel?.background?.url ? (
        <>
          <div aria-hidden style={{ position: 'fixed', inset: 0, zIndex: -3, backgroundImage: `url(${panel.background.url})`, backgroundSize: 'cover', backgroundPosition: 'center', filter: panel.background.blur ? `blur(${panel.background.blur}px)` : undefined, transform: panel.background.blur ? 'scale(1.06)' : undefined }} />
          <div aria-hidden style={{ position: 'fixed', inset: 0, zIndex: -2, background: `rgba(7,10,19,${panel.background.mask})` }} />
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
            {style?.logoImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={style.logoImage} alt="logo" style={{ maxHeight: 56, maxWidth: 260, objectFit: 'contain' }} />
            ) : style?.logoText ? (
              <span style={{ fontSize: 32, fontWeight: 800, letterSpacing: 1, color: textColor, textShadow: '0 2px 24px rgba(99,102,241,0.25)' }}>{style.logoText}</span>
            ) : null}
            {(style?.logoImage || style?.logoText) && <span style={{ color: 'var(--mei-text-faint)', fontSize: 20 }}>|</span>}
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

        {/* 搜索框 */}
        {style?.searchBoxShow !== false && (
          <section style={{ maxWidth: 560, margin: '0 auto 32px' }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <span style={{ position: 'absolute', left: 18, color: 'var(--mei-text-faint)', pointerEvents: 'none', display: 'inline-flex' }}>
                <MeiIcon icon="lucide:search" size={18} />
              </span>
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitSearch(); }}
                placeholder="搜索应用与链接，或直接搜索网页…"
                style={{
                  width: '100%', padding: '14px 90px 14px 46px', fontSize: 14,
                  color: 'var(--mei-text)', background: 'var(--mei-surface)',
                  backdropFilter: 'blur(22px) saturate(1.5)', WebkitBackdropFilter: 'blur(22px) saturate(1.5)',
                  border: '1px solid var(--mei-border)', borderRadius: 'var(--mei-radius-full)',
                  outline: 'none', transition: 'var(--mei-transition)', boxShadow: 'var(--mei-shadow-sm)',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(99,102,248,0.55)'; e.currentTarget.style.boxShadow = 'var(--mei-glow)'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--mei-border)'; e.currentTarget.style.boxShadow = 'var(--mei-shadow-sm)'; }}
              />
              <span style={{ position: 'absolute', right: 14, border: 'none', background: 'rgba(23,32,56,0.04)', borderRadius: 'var(--mei-radius-sm)', padding: '4px 8px', fontSize: 11.5, color: 'var(--mei-text-muted)', pointerEvents: 'none' }}>
                {style?.searchEngine === 'google' ? 'Google' : style?.searchEngine === 'baidu' ? '百度' : style?.searchEngine === 'duckduckgo' ? 'Duck' : '必应'}
              </span>
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
          onTouchStart={(e) => { setTouchStartX(e.touches[0].clientX); }}
          onTouchEnd={(e) => { if (touchStartX !== null) { const d = e.changedTouches[0].clientX - touchStartX; if (d < -80) setPageIdx(i => i + 1); else if (d > 80) setPageIdx(i => Math.max(0, i - 1)); setTouchStartX(null); } }}
        >
          {/* 页面指示器 */}
          {pages.length > 1 && !editMode && !query && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 14 }}>
              <button onClick={() => goPage(-1)} disabled={pageIdx <= 0} style={{ border: 'none', background: 'transparent', color: 'var(--mei-text-faint)', cursor: 'pointer', fontSize: 16, opacity: pageIdx <= 0 ? 0.3 : 1 }}>◀</button>
              {pages.map((p, i) => (
                <button
                  key={p.id}
                  onClick={() => setPageIdx(i)}
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
                {/* 分组标题行：左侧名称，右侧常驻操作入口（布局切换 + 新增） */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--mei-space-3)' }}>
                  <span style={{ fontSize: 12, letterSpacing: 2, color: 'var(--mei-text-faint)' }}>
                    {page.name} · {page.items.length}
                    {lanMode && <span style={{ marginLeft: 8, fontSize: 11, letterSpacing: 0, color: 'var(--mei-primary)' }}>内网模式</span>}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <button
                      onClick={() => {
                        if (page.group) {
                          const next = pageIconMode ? 'info' : 'icon';
                          const groups: PanelGroup[] = panel.groups.map(g => g.id === page.group!.id ? { ...g, iconStyle: next as 'icon' | 'info' } : g);
                          savePanel({ ...panel, groups }, next === 'icon' ? '已切换为图标布局' : '已切换为卡片布局');
                        } else {
                          const next = iconMode ? 'info' : 'icon';
                          savePanel({ ...panel, style: { ...panel.style, iconStyle: next as 'icon' | 'info' } }, next === 'icon' ? '已切换为图标布局' : '已切换为卡片布局');
                        }
                      }}
                      title={pageIconMode ? '切换为卡片布局' : '切换为图标布局'}
                      style={groupOpBtn}
                    >
                      <MeiIcon icon={pageIconMode ? 'lucide:layout-grid' : 'lucide:layout-template'} size={13} />
                      {pageIconMode ? '卡片布局' : '图标布局'}
                    </button>
                    <button
                      onClick={() => setEditing({ id: '', groupId: page.id === 'default' ? '' : page.id, title: '', description: '', url: '', lanUrl: '', icon: 'lucide:link', iconColor: '' })}
                      title="新增图标项"
                      style={groupOpBtn}
                    >
                      <MeiIcon icon="lucide:plus" size={13} />
                      新增
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
          <div className="mei-empty">没有匹配「{query}」的应用，按 Enter 进行网页搜索</div>
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
            { label: '打开', fn: () => { const h = lanMode && contextMenu.item.lanUrl ? contextMenu.item.lanUrl : contextMenu.item.url; window.open(h, /^https?:\/\//.test(h) ? '_blank' : '_self'); } },
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

      {/* 编辑模式切换（右下浮动按钮） */}
      <button
        onClick={() => setEditMode((v) => !v)}
        title={editMode ? '完成编辑' : '编辑主页'}
        style={{
          position: 'fixed', right: 22, bottom: 22, zIndex: 900,
          width: 46, height: 46, borderRadius: '50%', border: 'none', cursor: 'pointer',
          background: editMode ? 'linear-gradient(135deg,#10b981,#059669)' : 'var(--mei-gradient)',
          color: '#fff', fontSize: 19, boxShadow: '0 8px 28px rgba(99,102,241,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {editMode ? '✓' : '✎'}
      </button>

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
