import {useLocation, useNavigate} from 'react-router-dom'
import {useEffect, useState} from 'react'
import {Dialog, DialogContent} from '@/components/ui'
import {ProjectsPage} from '@/pages/ProjectsPage'

interface AppSidebarProps {
  onCreateProject?: () => void
}

// mei-allin 集成：原 72px 固定侧栏改为左侧中段可折叠浮动小面板
// 三个行动：系统首页 / 新建 / 文件管理（弹层打开 ProjectsPage）
export function AppSidebar({ onCreateProject }: AppSidebarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [projectsOpen, setProjectsOpen] = useState(false)

  // 路由变化（如从文件管理里进入编辑器）时收起面板并关闭弹层
  useEffect(() => {
    setOpen(false)
    setProjectsOpen(false)
  }, [location.pathname])

  const stroke = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  } as const

  const actions = [
    {
      label: '首页',
      title: '系统首页',
      icon: (
        <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" {...stroke}>
          <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          <path d="M9 22V12h6v10"/>
        </svg>
      ),
      onClick: () => navigate('/'),
    },
    {
      label: '新建',
      title: '新建项目',
      icon: (
        <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" {...stroke}>
          <path d="M12 5v14M5 12h14"/>
        </svg>
      ),
      onClick: () => (onCreateProject ? onCreateProject() : setProjectsOpen(true)),
    },
    {
      label: '文件',
      title: '文件管理',
      icon: (
        <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" {...stroke}>
          <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z"/>
        </svg>
      ),
      onClick: () => setProjectsOpen(true),
    },
  ]

  return (
    <>
      <div className="fixed left-3 top-1/2 -translate-y-1/2 z-40 flex flex-col items-center gap-1 p-1.5 rounded-2xl bg-white/75 dark:bg-gray-900/70 backdrop-blur-xl border border-black/10 dark:border-white/10 shadow-lg">
        {!open ? (
          <button
            onClick={() => setOpen(true)}
            title="展开菜单"
            className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-500 hover:bg-gray-900/5 hover:text-indigo-600 dark:text-gray-400 dark:hover:bg-white/10 transition-colors"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" {...stroke}>
              <path d="M3 7h18M3 12h18M3 17h18"/>
            </svg>
          </button>
        ) : (
          <>
            {actions.map(a => (
              <button
                key={a.label}
                onClick={a.onClick}
                title={a.title}
                className="w-10 h-11 rounded-xl flex flex-col items-center justify-center text-gray-500 hover:bg-gray-900/5 hover:text-indigo-600 dark:text-gray-400 dark:hover:bg-white/10 transition-colors"
              >
                {a.icon}
                <span className="text-[9px] leading-none mt-0.5">{a.label}</span>
              </button>
            ))}
            <button
              onClick={() => setOpen(false)}
              title="收起"
              className="w-10 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-900/5 dark:hover:bg-white/10 transition-colors"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" {...stroke}>
                <path d="m15 18-6-6 6-6"/>
              </svg>
            </button>
          </>
        )}
      </div>

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
