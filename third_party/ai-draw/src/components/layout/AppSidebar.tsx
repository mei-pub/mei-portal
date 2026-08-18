import {useLocation, useNavigate} from 'react-router-dom'
import {ChevronLeft, ChevronRight, Plus} from 'lucide-react'
import {NAV_ITEMS} from '@/constants'
import {useSystemStore} from '@/stores/systemStore'
import {useAuthStore} from '@/stores/authStore'
import {
  Logo,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui'

interface AppSidebarProps {
  onCreateProject?: () => void
}

// mei-allin 集成：
// - GitHub 入口已移除；存储模式锁死本地（storageModeStore 强制 local），不再提供切换入口
// - 个人设置/管理后台入口迁移到门户设置集成页，侧栏不再显示（路由保留供集成页 iframe 直达）
// - 左下角用户头像/退出登录浮动入口已移除（登录态由门户统一管理）
export function AppSidebar({ onCreateProject }: AppSidebarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const showAbout = useSystemStore((state) => state.showAbout)
  const isCollapsed = useSystemStore((state) => state.sidebarCollapsed)
  const setSidebarCollapsed = useSystemStore((state) => state.setSidebarCollapsed)
  const logoColor = useSystemStore((state) => state.logoColor)
  const language = useSystemStore((state) => state.language)
  const i18nTexts = useSystemStore((state) => state.i18nTexts)
  const user = useAuthStore((state) => state.user)

  return (
    <TooltipProvider delayDuration={0}>
      <aside className="fixed left-0 top-0 z-40 flex h-screen w-[72px] flex-col items-center border-r border-border bg-surface py-4 transition-all duration-300">
        {/* Logo */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => navigate('/')}
              className="mb-6 flex h-10 w-10 items-center justify-center rounded-xl shadow-sm transition-transform hover:scale-105 active:scale-95"
              style={{ backgroundColor: logoColor }}
            >
              <Logo className="h-6 w-6" style={{ color: 'white' }} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{i18nTexts.btnBackHome[language]}</TooltipContent>
        </Tooltip>

        {/* New Project Button */}
        {onCreateProject && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onCreateProject}
                className="group mb-6 flex flex-col items-center justify-center gap-1"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-dashed border-border bg-background transition-all group-hover:border-primary group-hover:text-primary">
                  <Plus className="h-5 w-5 text-muted-foreground group-hover:text-primary" />
                </div>
                {!isCollapsed && <span className="text-[10px] font-medium text-muted-foreground group-hover:text-primary">{language === 'zh' ? '新建' : 'New'}</span>}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{i18nTexts.btnNewProject[language]}</TooltipContent>
          </Tooltip>
        )}

        {/* Navigation Items */}
        <nav className="flex flex-1 flex-col items-center gap-4 w-full px-2">
          {NAV_ITEMS.map((item, index) => {
            if (item.path === '/about' && !showAbout) return null
            if ('adminOnly' in item && item.adminOnly && user?.role !== 'admin') return null
            // 个人设置/管理后台 → 门户设置集成页
            if (item.path === '/profile' || item.path === '/admin') return null

            const isActive = location.pathname === item.path

            // Get translated label
            let label = item.label
            if (item.path === '/') label = i18nTexts.menuHome[language]
            else if (item.path === '/projects') label = i18nTexts.menuProjects[language]
            else if (item.path === '/profile') label = i18nTexts.menuProfile[language]
            else if (item.path === '/admin') label = i18nTexts.menuAdmin[language]
            else if (item.path === '/about') label = i18nTexts.menuAbout[language]

            return (
              <Tooltip key={index}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => navigate(item.path)}
                    className={`group flex w-full flex-col items-center justify-center gap-1 rounded-xl py-2 transition-all ${
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted/50 hover:text-primary'
                    }`}
                  >
                    <item.icon className={`h-5 w-5 ${isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-primary'}`} />
                    {!isCollapsed && (
                      <span className={`text-[10px] font-medium ${isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-primary'}`}>
                        {label}
                      </span>
                    )}
                  </button>
                </TooltipTrigger>
                {isCollapsed && <TooltipContent side="right">{label}</TooltipContent>}
              </Tooltip>
            )
          })}
        </nav>

        {/* Bottom Actions */}
        <div className="mt-auto flex flex-col items-center gap-4 w-full px-2 pb-2">

          {/* Collapse Toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setSidebarCollapsed(!isCollapsed)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/50 hover:text-primary"
              >
                {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{isCollapsed ? i18nTexts.expandMenu[language] : i18nTexts.collapseMenu[language]}</TooltipContent>
          </Tooltip>

          {/* mei-allin：左下角用户头像/退出登录浮动入口已移除（登录态由门户统一管理） */}
        </div>
      </aside>
    </TooltipProvider>
  )
}
