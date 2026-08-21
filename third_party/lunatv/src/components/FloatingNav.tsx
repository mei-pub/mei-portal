'use client';

// mei-allin：左侧中段浮动导航面板 —— 替代原固定侧栏
// 默认展开；收起态为紧贴左缘的渐变小把手（›）；状态经 localStorage 记忆
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

const STORE_KEY = 'mei-float-lunatv';

interface NavItem {
  label: string;
  href: string;
  icon: ReactNode;
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const ITEMS: NavItem[] = [
  {
    label: '首页',
    href: '/',
    icon: (
      <svg className='h-[15px] w-[15px]' viewBox='0 0 24 24' {...stroke}>
        <path d='m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' />
        <path d='M9 22V12h6v10' />
      </svg>
    ),
  },
  {
    label: '搜索',
    href: '/search',
    icon: (
      <svg className='h-[15px] w-[15px]' viewBox='0 0 24 24' {...stroke}>
        <circle cx='11' cy='11' r='8' />
        <path d='m21 21-4.35-4.35' />
      </svg>
    ),
  },
  {
    label: '电影',
    href: '/douban?type=movie',
    icon: (
      <svg className='h-[15px] w-[15px]' viewBox='0 0 24 24' {...stroke}>
        <rect width='18' height='18' x='3' y='3' rx='2' />
        <path d='M7 3v18M3 7.5h4M3 12h18M3 16.5h4M17 3v18M17 7.5h4M17 16.5h4' />
      </svg>
    ),
  },
  {
    label: '剧集',
    href: '/douban?type=tv',
    icon: (
      <svg className='h-[15px] w-[15px]' viewBox='0 0 24 24' {...stroke}>
        <rect width='20' height='15' x='2' y='7' rx='2' />
        <path d='m17 2-5 5-5-5' />
      </svg>
    ),
  },
  {
    label: '动漫',
    href: '/douban?type=anime',
    icon: (
      <svg className='h-[15px] w-[15px]' viewBox='0 0 24 24' {...stroke}>
        <path d='M12 2c5.5 0 10 3.6 10 8s-4.5 8-10 8c-1 0-2-.1-2.9-.35L5 20l.5-3.2C3.3 15.3 2 12.8 2 10c0-4.4 4.5-8 10-8z' />
        <path d='M8.5 10.5h.01M15.5 10.5h.01M12 13.5h.01' />
      </svg>
    ),
  },
];

export default function FloatingNav({ activePath }: { activePath?: string }) {
  const pathname = usePathname();
  const current = activePath ?? pathname;
  const [open, setOpen] = useState(true);

  // 初始状态：localStorage 记忆优先，默认展开；
  // 播放页进入播放态后由播放页经 mei-panel-set 事件编程收起（不写记忆）
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      if (saved === '1') setOpen(false);
      else if (saved === '0') setOpen(true);
    } catch {
      setOpen(true);
    }
  }, []);

  // 播放页等可编程控制面板收展（不写记忆）
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ collapsed?: boolean }>).detail || {};
      setOpen(!detail.collapsed);
    };
    window.addEventListener('mei-panel-set', handler);
    return () => window.removeEventListener('mei-panel-set', handler);
  }, []);

  const toggle = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(STORE_KEY, next ? '0' : '1');
    } catch {}
  };

  return !open ? (
    // 收起态：紧贴左缘的渐变小把手
    <button
      onClick={() => toggle(true)}
      title='展开导航'
      className='fixed left-0 top-1/2 z-40 hidden h-14 w-5 -translate-y-1/2 items-center justify-center rounded-r-lg bg-gradient-to-b from-indigo-500 to-purple-500 text-white shadow-lg transition-all hover:w-7 md:flex'
    >
      <svg className='h-4 w-4' viewBox='0 0 24 24' {...stroke}>
        <path d='m9 18 6-6-6-6' />
      </svg>
    </button>
  ) : (
    <div className='fixed left-2 top-1/2 z-40 hidden -translate-y-1/2 md:flex md:flex-col md:items-center md:gap-1 md:rounded-2xl md:border md:border-black/10 md:bg-white/75 md:p-1 md:shadow-lg md:backdrop-blur-xl dark:border-white/10 dark:bg-gray-900/70'>
      {/* 应用信息区：Logo + 纵向名称（窄面板统一样式） */}
      <Link
        href='/'
        title='影视门户'
        className='flex flex-col items-center gap-1.5 rounded-xl px-0.5 py-1.5 transition-colors hover:bg-gray-900/5 dark:hover:bg-white/10'
      >
        <span className='flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-md'>
          <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><rect width='20' height='15' x='2' y='7' rx='2' ry='2'/><polyline points='17 2 12 7 7 2'/></svg>
        </span>
        <span className='select-none text-[10px] font-medium leading-none tracking-[0.18em] text-gray-700 [writing-mode:vertical-rl] dark:text-gray-300'>影视门户</span>
      </Link>
      <div className='h-px w-6 bg-black/10 dark:bg-white/10' />
      {ITEMS.map((item) => {
        // 选中态：带查询串的入口精确匹配完整路径（修复 /douban?type=* 三入口同时高亮）；
        // 无查询串的入口按路径前缀匹配
        const isActive = item.href === '/'
          ? current === '/'
          : item.href.includes('?')
            ? current === item.href
            : current.startsWith(item.href);
        return (
          <Link
            key={item.label}
            href={item.href}
            title={item.label}
            className={`flex h-[34px] w-[34px] items-center justify-center rounded-xl transition-colors ${
              isActive
                ? 'bg-green-600/10 text-green-600'
                : 'text-gray-500 hover:bg-gray-900/5 hover:text-green-600 dark:text-gray-400 dark:hover:bg-white/10'
            }`}
          >
            {item.icon}
          </Link>
        );
      })}
      <button
        onClick={() => toggle(false)}
        title='收起导航'
        className='flex h-6 w-[34px] items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-900/5 dark:hover:bg-white/10'
      >
        <svg className='h-4 w-4' viewBox='0 0 24 24' {...stroke}>
          <path d='m15 18-6-6 6-6' />
        </svg>
      </button>
    </div>
  );
}
