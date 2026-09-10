// mei-allin：左侧窄浮动面板（全应用统一：Logo + 纵向名称 + 图标入口）
// 工具箱：入口为各大工具分类；折叠态为左缘小把手；localStorage 记忆
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import { categoriesConfig } from '@tools/index';
const STORE_KEY = 'mei-float-omni-tools';
const styles = {
  panel: {
    position: 'fixed' as const,
    left: 8,
    top: '50%',
    transform: 'translateY(-50%)',
    zIndex: 1200,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 4,
    padding: 4,
    borderRadius: 22,
    background: 'rgba(255,255,255,0.78)',
    border: '1px solid rgba(23,32,56,0.10)',
    boxShadow: '0 8px 28px rgba(23,32,56,0.10)',
    backdropFilter: 'blur(22px) saturate(1.5)',
    WebkitBackdropFilter: 'blur(22px) saturate(1.5)'
  },
  info: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 6,
    padding: '6px 2px',
    border: 'none',
    background: 'transparent',
    borderRadius: 16,
    cursor: 'pointer'
  },
  logo: {
    width: 30,
    height: 30,
    borderRadius: 9,
    background: 'linear-gradient(135deg,#6366f1 0%,#a855f7 55%,#ec4899 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontSize: 15,
    fontWeight: 800,
    boxShadow: '0 4px 12px rgba(99,102,241,0.35)'
  },
  name: {
    writingMode: 'vertical-rl' as const,
    textOrientation: 'upright' as const,
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.18em',
    lineHeight: 1,
    color: '#1c2333',
    maxHeight: 96,
    overflow: 'hidden',
    userSelect: 'none' as const
  },
  divider: { width: 24, height: 1, background: 'rgba(23,32,56,0.10)', flexShrink: 0 },
  items: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 2,
    maxHeight: '46vh',
    overflowY: 'auto' as const,
    scrollbarWidth: 'none' as const
  },
  handle: {
    position: 'fixed' as const,
    left: 0,
    top: '50%',
    transform: 'translateY(-50%)',
    zIndex: 1200,
    width: 20,
    height: 56,
    border: 'none',
    borderRadius: '0 10px 10px 0',
    background: 'linear-gradient(180deg,#6366f1,#a855f7)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: '0 8px 28px rgba(23,32,56,0.10)'
  },
  collapse: {
    width: 34,
    height: 22,
    flexShrink: 0,
    border: 'none',
    borderRadius: 8,
    background: 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#98a1b3',
    cursor: 'pointer'
  }
};
function itemStyle(active: boolean) {
  return {
    width: 34,
    height: 34,
    flexShrink: 0,
    border: 'none',
    borderRadius: 12,
    background: active
      ? 'linear-gradient(135deg,rgba(99,102,241,0.12),rgba(236,72,153,0.10))'
      : 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: active ? '#6366f1' : '#5d6778',
    cursor: 'pointer',
    transition: 'all .15s'
  } as const;
}
export default function MeiPanel() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(STORE_KEY) !== '1');
    } catch {
      setOpen(true);
    }
  }, []);
  const toggle = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(STORE_KEY, next ? '0' : '1');
    } catch {
      // ignore
    }
  };
  const activeCategory = location.pathname.startsWith('/categories/')
    ? location.pathname.split('/')[2]
    : '';
  if (!open) {
    return (
      <button style={styles.handle} title="展开面板" onClick={() => toggle(true)}>
        <Icon icon="lucide:chevron-right" width={16} />
      </button>
    );
  }
  return (
    <nav style={styles.panel}>
      <button style={styles.info} title="Mei Tools 工具箱" onClick={() => navigate('/')}>
        <span style={styles.logo}>M</span>
        <span style={styles.name}>工具箱</span>
      </button>
      <div style={styles.divider} />
      <div style={styles.items}>
        {categoriesConfig.map((cat) => (
          <button
            key={cat.type}
            style={itemStyle(activeCategory === cat.type)}
            title={t(cat.title as never) as unknown as string}
            onClick={() => navigate(`/categories/${cat.type}`)}
          >
            <Icon icon={cat.icon as string} width={16} />
          </button>
        ))}
      </div>
      <div style={styles.divider} />
      <button style={styles.collapse} title="收起面板" onClick={() => toggle(false)}>
        <Icon icon="lucide:chevron-left" width={14} />
      </button>
    </nav>
  );
}
