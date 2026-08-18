// 内联 SVG 图标库 —— 摆脱 iconify CDN 依赖（离线可用，避免 Logo 加载失败）
// 图标名与 plugins.json / settings-entries.ts 中的 iconify 命名保持一致
import type { CSSProperties } from 'react';

type P = { size?: number; style?: CSSProperties; className?: string };

const S = ({ children, size = 16, style, className }: P & { children: React.ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flexShrink: 0, ...style }}
    className={className}
    aria-hidden
  >
    {children}
  </svg>
);

const ICONS: Record<string, (p: P) => JSX.Element> = {
  // 门户/顶栏
  'lucide:search': (p) => (
    <S {...p}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </S>
  ),
  'lucide:settings': (p) => (
    <S {...p}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </S>
  ),
  // 应用图标
  'lucide:download': (p) => (
    <S {...p}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </S>
  ),
  'lucide:layout-dashboard': (p) => (
    <S {...p}>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </S>
  ),
  'lucide:music': (p) => (
    <S {...p}>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </S>
  ),
  'lucide:pen-tool': (p) => (
    <S {...p}>
      <path d="m12 19 7-7 3 3-7 7-3-3z" />
      <path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
      <circle cx="11" cy="11" r="1.5" />
    </S>
  ),
  'lucide:tv': (p) => (
    <S {...p}>
      <rect x="2" y="7" width="20" height="15" rx="2" />
      <polyline points="17 2 12 7 7 2" />
    </S>
  ),
  'lucide:network': (p) => (
    <S {...p}>
      <rect x="16" y="16" width="6" height="6" rx="1" />
      <rect x="2" y="16" width="6" height="6" rx="1" />
      <rect x="9" y="2" width="6" height="6" rx="1" />
      <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" />
      <path d="M12 12V8" />
    </S>
  ),
  'lucide:book-open': (p) => (
    <S {...p}>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </S>
  ),
  'lucide:wrench': (p) => (
    <S {...p}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </S>
  ),
  // 设置入口
  'lucide:settings-2': (p) => (
    <S {...p}>
      <path d="M20 7h-9" />
      <path d="M14 17H5" />
      <circle cx="17" cy="17" r="3" />
      <circle cx="7" cy="7" r="3" />
    </S>
  ),
  'lucide:plug': (p) => (
    <S {...p}>
      <path d="M12 22v-5" />
      <path d="M9 8V2" />
      <path d="M15 8V2" />
      <path d="M6 8h12v4a6 6 0 0 1-12 0z" />
    </S>
  ),
  'lucide:user': (p) => (
    <S {...p}>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </S>
  ),
  'lucide:shield': (p) => (
    <S {...p}>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1 1 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    </S>
  ),
  'lucide:server': (p) => (
    <S {...p}>
      <rect x="2" y="2" width="20" height="8" rx="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </S>
  ),
  'lucide:scroll-text': (p) => (
    <S {...p}>
      <path d="M15 12h-5" />
      <path d="M15 8h-5" />
      <path d="M19 17V5a2 2 0 0 0-2-2H4" />
      <path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" />
    </S>
  ),
  'lucide:library': (p) => (
    <S {...p}>
      <path d="m16 6 4 14" />
      <path d="M12 6v14" />
      <path d="M8 8v12" />
      <path d="M4 4v16" />
    </S>
  ),
  // 蜘蛛纸牌（自绘）
  'game-icons:spider': (p) => (
    <S {...p}>
      <circle cx="12" cy="13" r="3.2" />
      <circle cx="12" cy="8" r="2" />
      <path d="M12 10.5v1" />
      <path d="M9.5 12 5 8.5 3 4" />
      <path d="M9.3 13.5 4 13 1.5 10.5" />
      <path d="M9.6 15 5.5 17.5 4.5 21" />
      <path d="M14.5 12 19 8.5 21 4" />
      <path d="M14.7 13.5 20 13l2.5-2.5" />
      <path d="M14.4 15 18.5 17.5l1 3.5" />
    </S>
  ),
};

export default function MeiIcon({ icon, size = 16, style, className }: { icon: string } & P) {
  const Render = ICONS[icon];
  if (Render) return <Render size={size} style={style} className={className} />;
  // 兜底：首字母圆片
  const letter = (icon.split(':').pop() || '?').charAt(0).toUpperCase();
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: '1.5px solid currentColor',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.55,
        fontWeight: 700,
        flexShrink: 0,
        ...style,
      }}
      className={className}
      aria-hidden
    >
      {letter}
    </span>
  );
}
