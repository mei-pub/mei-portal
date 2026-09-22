import {ChevronDown} from 'lucide-react'
import {Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui'
import {useSystemStore} from '@/stores/systemStore'
import {ENGINES} from '@/constants'

// mei-portal：绘图引擎选择（自 AppHeader 顶栏迁入编辑器输入区，位于模型选择右侧、发送按钮之前）
export function EngineSelector() {
  const defaultEngine = useSystemStore((state) => state.defaultEngine)
  const setDefaultEngine = useSystemStore((state) => state.setDefaultEngine)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
          title="绘图引擎"
        >
          <span className="max-w-20 truncate">{ENGINES.find(e => e.value === defaultEngine)?.label || 'Draw.io'}</span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {ENGINES.map(engine => (
          <DropdownMenuItem
            key={engine.value}
            onClick={() => setDefaultEngine(engine.value)}
            className="flex items-center justify-between py-1.5"
          >
            <span className="text-xs">{engine.label}</span>
            {defaultEngine === engine.value && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
