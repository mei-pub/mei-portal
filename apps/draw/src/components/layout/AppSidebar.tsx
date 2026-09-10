import {useLocation, useNavigate} from 'react-router-dom'
import {useEffect, useState} from 'react'
import {Dialog, DialogContent} from '@/components/ui'
import {ProjectsPage} from '@/pages/ProjectsPage'

interface AppSidebarProps {
  onCreateProject?: () => void
}

const STORE_KEY = 'mei-float-aidraw'

// mei-allin 集成：左侧中段浮动操作面板（首页 / 新建 / 文件管理弹层）
// 默认展开 + localStorage 记忆；编辑页（/editor/*）默认收起（对话区顶到左边）
export function AppSidebar({ onCreateProject }: AppSidebarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [open, setOpen] = useState<boolean | null>(null)
  const [projectsOpen, setProjectsOpen] = useState(false)
  const isEditor = location.pathname.startsWith('/editor')

  // 初始：记忆优先；无记忆时编辑页收起、其余展开
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORE_KEY)
      if (saved === '1') setOpen(false)
      else if (saved === '0') setOpen(true)
      else setOpen(!isEditor)
    } catch {
      setOpen(!isEditor)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 无记忆时切换到编辑页自动收起；离开编辑页自动展开（有手动记忆后尊重记忆）
  useEffect(() => {
    try {
      if (localStorage.getItem(STORE_KEY) !== null) return
    } catch {}
    setOpen(!isEditor)
  }, [isEditor])

  // 路由变化（如从文件管理里进入编辑器）时关闭弹层
  useEffect(() => {
    setProjectsOpen(false)
  }, [location.pathname])

  // 编辑页等可编程控制面板收展（不写记忆）
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ collapsed?: boolean }>).detail || {}
      setOpen(!detail.collapsed)
    }
    window.addEventListener('mei-panel-set', handler)
    return () => window.removeEventListener('mei-panel-set', handler)
  }, [])

  const toggle = (next: boolean) => {
    setOpen(next)
    try {
      localStorage.setItem(STORE_KEY, next ? '0' : '1')
    } catch {}
  }

  const stroke = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  } as const

  const actions = [
    {
      label: '绘图',
      title: '绘图',
      icon: (
        <svg className="h-[15px] w-[15px]" viewBox="0 0 24 24" {...stroke}>
          <path d="m12 19 7-7 3 3-7 7-3-3z"/>
          <path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
          <path d="m2 2 7.586 7.586"/>
          <circle cx="11" cy="11" r="2"/>
        </svg>
      ),
      onClick: () => navigate('/'),
    },
    {
      label: '新建',
      title: '新建项目',
      icon: (
        <svg className="h-[15px] w-[15px]" viewBox="0 0 24 24" {...stroke}>
          <path d="M12 5v14M5 12h14"/>
        </svg>
      ),
      onClick: () => (onCreateProject ? onCreateProject() : setProjectsOpen(true)),
    },
    {
      label: '文件',
      title: '文件管理',
      icon: (
        <svg className="h-[15px] w-[15px]" viewBox="0 0 24 24" {...stroke}>
          <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z"/>
        </svg>
      ),
      onClick: () => setProjectsOpen(true),
    },
  ]

  // 初始 null（SSR/首帧）按收起把手渲染，避免闪烁
  const expanded = open === true

  return (
    <>
      {!expanded ? (
        // 收起态：紧贴左缘的渐变小把手
        <button
          onClick={() => toggle(true)}
          title="展开菜单"
          className="fixed left-0 top-1/2 z-40 h-14 w-5 -translate-y-1/2 flex items-center justify-center rounded-r-lg bg-gradient-to-b from-indigo-500 to-purple-500 text-white shadow-lg transition-all hover:w-7"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" {...stroke}>
            <path d="m9 18 6-6-6-6"/>
          </svg>
        </button>
      ) : (
        <div className="fixed left-2 top-1/2 -translate-y-1/2 z-40 flex flex-col items-center gap-1 p-1 rounded-2xl bg-white/75 dark:bg-gray-900/70 backdrop-blur-xl border border-black/10 dark:border-white/10 shadow-lg">
          {/* 应用信息区：Logo + 纵向名称（窄面板统一样式） */}
          <button
            onClick={() => actions[0]?.onClick()}
            title="AI 绘图"
            className="flex flex-col items-center gap-1.5 rounded-xl px-0.5 py-1.5 transition-colors hover:bg-gray-900/5 dark:hover:bg-white/10"
          >
            <span className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 text-white shadow-md">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 19 7-7 3 3-7 7-3-3z"/><path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="m2 2 7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
            </span>
            <span className="select-none text-[10px] font-medium leading-none tracking-[0.18em] text-gray-700 [writing-mode:vertical-rl] [text-orientation:upright] dark:text-gray-300">AI绘图</span>
          </button>
          <div className="h-px w-6 bg-black/10 dark:bg-white/10" />
          {actions.map(a => (
            <button
              key={a.label}
              onClick={a.onClick}
              title={a.title}
              className="h-[34px] w-[34px] rounded-xl flex items-center justify-center text-gray-500 hover:bg-gray-900/5 hover:text-indigo-600 dark:text-gray-400 dark:hover:bg-white/10 transition-colors"
            >
              {a.icon}
            </button>
          ))}
          <button
            onClick={() => toggle(false)}
            title="收起菜单"
            className="h-6 w-[34px] rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-900/5 dark:hover:bg-white/10 transition-colors"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" {...stroke}>
              <path d="m15 18-6-6 6-6"/>
            </svg>
          </button>
        </div>
      )}

      {/* 文件管理：弹层打开 */}
      <Dialog open={projectsOpen} onOpenChange={setProjectsOpen}>
        <DialogContent className="max-w-6xl w-[94vw] h-[86vh] p-0 overflow-hidden flex flex-col gap-0">
          <div className="flex-1 min-h-0 overflow-auto">
            <ProjectsPage embedded />
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
