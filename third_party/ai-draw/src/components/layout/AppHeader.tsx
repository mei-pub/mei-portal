import {ChevronDown} from 'lucide-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui'
import {useSystemStore} from '@/stores/systemStore'
import {ENGINES} from '@/constants'

// mei-allin 集成：顶栏仅保留绘图引擎选择
// 文档入口/滚动通知/语言切换（锁死中文）/用户与退出 已迁移到门户设置集成页
export function AppHeader() {
  const defaultEngine = useSystemStore((state) => state.defaultEngine)
  const setDefaultEngine = useSystemStore((state) => state.setDefaultEngine)
  const language = useSystemStore((state) => state.language)
  const i18nTexts = useSystemStore((state) => state.i18nTexts)

  return (
    <header className="relative flex items-center justify-between px-8 py-4">
      <div className="flex items-center gap-4 z-10">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="gap-2 rounded-full border-border bg-surface">
              <span className="text-sm font-medium">
                {ENGINES.find(e => e.value === defaultEngine)?.label || 'Draw.io'}
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            {ENGINES.map((engine) => {
              const getEngineDesc = (value: string) => {
                switch (value) {
                  case 'mermaid':
                    return i18nTexts.engineMermaidDesc[language]
                  case 'excalidraw':
                    return i18nTexts.engineExcalidrawDesc[language]
                  case 'drawio':
                    return i18nTexts.engineDrawioDesc[language]
                  default:
                    return engine.description
                }
              }

              return (
                <DropdownMenuItem
                  key={engine.value}
                  onClick={() => setDefaultEngine(engine.value)}
                  className="flex flex-col items-start gap-1 py-2"
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="font-medium">{engine.label}</span>
                    {defaultEngine === engine.value && (
                      <span className="h-2 w-2 rounded-full bg-primary" />
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {getEngineDesc(engine.value)}
                  </span>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
