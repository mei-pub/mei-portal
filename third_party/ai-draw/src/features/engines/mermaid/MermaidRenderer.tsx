import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react'
import mermaid from 'mermaid'
import elkLayouts from '@mermaid-js/layout-elk'
import tidyTreeLayouts from '@mermaid-js/layout-tidy-tree'
import Editor from '@monaco-editor/react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { useEditorStore } from '@/stores/editorStore'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/Tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/Dropdown'
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Download,
  Image,
  ArrowRight,
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  LayoutGrid,
  GitBranch,
  Network,
  Code,
  X,
  Copy,
  Check,
  Play,
  Undo2,
} from 'lucide-react'

interface MermaidRendererProps {
  code: string
  className?: string
}

export interface MermaidRendererRef {
  exportAsSvg: () => void
  exportAsPng: () => void
  exportAsSource: () => void
  showSourceCode: () => void
  hideSourceCode: () => void
  toggleSourceCode: () => void
}

type LayoutEngine = 'dagre' | 'elk' | 'tidy-tree'
type Direction = 'TB' | 'BT' | 'LR' | 'RL'

const DIRECTION_LABELS: Record<Direction, string> = {
  TB: '从上到下',
  BT: '从下到上',
  LR: '从左到右',
  RL: '从右到左',
}

const DIRECTION_ICONS: Record<Direction, typeof ArrowDown> = {
  TB: ArrowDown,
  BT: ArrowUp,
  LR: ArrowRight,
  RL: ArrowLeft,
}

const MIN_SCALE = 0.1
const MAX_SCALE = 5
const SCALE_STEP = 0.1

// Register layout loaders once
let elkRegistered = false
let tidyTreeRegistered = false

async function registerElkLayouts() {
  if (!elkRegistered) {
    mermaid.registerLayoutLoaders(elkLayouts)
    elkRegistered = true
  }
}

async function registerTidyTreeLayouts() {
  if (!tidyTreeRegistered) {
    mermaid.registerLayoutLoaders(tidyTreeLayouts)
    tidyTreeRegistered = true
  }
}

export const MermaidRenderer = forwardRef<MermaidRendererRef, MermaidRendererProps>(function MermaidRenderer({ code, className }, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgContainerRef = useRef<HTMLDivElement>(null)
  const diagramContainerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [svg, setSvg] = useState<string>('')
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [layout, setLayout] = useState<LayoutEngine>('dagre')
  const [direction, setDirection] = useState<Direction>('TB')
  const [showCodePanel, setShowCodePanel] = useState(false)
  const [copied, setCopied] = useState(false)
  const [editedCode, setEditedCode] = useState(code)
  const [hasChanges, setHasChanges] = useState(false)

  const { setContent } = useEditorStore()

  // Sync editedCode when code prop changes
  useEffect(() => {
    setEditedCode(code)
    setHasChanges(false)
  }, [code])

  // Extract balanced braces content from a string starting at given position
  const extractBalancedBraces = useCallback((str: string, startPos: number): string | null => {
    if (str[startPos] !== '{') return null

    let depth = 0
    let i = startPos

    while (i < str.length) {
      if (str[i] === '{') depth++
      else if (str[i] === '}') {
        depth--
        if (depth === 0) {
          return str.slice(startPos, i + 1)
        }
      }
      i++
    }
    return null
  }, [])

  // Parse existing %%{init: {...}}%% directive and extract config
  const parseInitDirective = useCallback((mermaidCode: string): { config: Record<string, unknown>, remainingCode: string } => {
    const lines = mermaidCode.trim().split('\n')
    let config: Record<string, unknown> = {}
    let startIndex = 0

    // Skip frontmatter if present
    if (lines[0]?.trim() === '---') {
      const endIndex = lines.findIndex((line, idx) => idx > 0 && line.trim() === '---')
      if (endIndex > 0) {
        startIndex = endIndex + 1
      }
    }

    // Check for %%{init: {...}}%% directive
    const remainingText = lines.slice(startIndex).join('\n')
    const initStartMatch = remainingText.match(/^%%\{init:\s*/)

    if (initStartMatch) {
      const configStartPos = initStartMatch[0].length
      const configContent = extractBalancedBraces(remainingText, configStartPos)

      if (configContent) {
        try {
          // Parse the JSON-like config (convert single quotes to double quotes for JSON.parse)
          const configStr = configContent.replace(/'/g, '"')
          config = JSON.parse(configStr)
        } catch {
          // Keep empty config if parsing fails
          config = {}
        }

        // Find where the init directive ends (after }}%%)
        const directiveEndPos = configStartPos + configContent.length
        const afterDirective = remainingText.slice(directiveEndPos)
        // Remove the closing }%% and any whitespace
        const afterInit = afterDirective.replace(/^\s*\}%%\s*/, '').trim()
        return { config, remainingCode: afterInit }
      }
    }

    return { config: {}, remainingCode: remainingText }
  }, [extractBalancedBraces])

  // Inject layout and direction config into mermaid code, preserving user's theme config
  const injectConfig = useCallback((mermaidCode: string, layoutEngine: LayoutEngine, dir: Direction): string => {
    const { config: existingConfig, remainingCode } = parseInitDirective(mermaidCode)

    if (!remainingCode.trim()) return mermaidCode

    const diagramLines = remainingCode.split('\n')
    const firstDiagramLine = diagramLines[0]?.trim().toLowerCase() || ''

    // Merge configs: preserve user's theme settings, add layout if needed
    const mergedConfig: Record<string, unknown> = { ...existingConfig }
    mergedConfig.layout = layoutEngine

    // if (layoutEngine === 'elk') {
    //   mergedConfig.layout = 'elk'
    // }

    // Handle direction for flowchart/graph
    if (firstDiagramLine.startsWith('graph') || firstDiagramLine.startsWith('flowchart')) {
      // Replace or add direction in the diagram declaration
      const directionPattern = /^(graph|flowchart)\s*(TB|BT|LR|RL|TD)?/i
      if (directionPattern.test(diagramLines[0])) {
        diagramLines[0] = diagramLines[0].replace(directionPattern, `$1 ${dir}`)
      }
    }

    // Build the init directive string if we have config
    let initDirective = ''
    if (Object.keys(mergedConfig).length > 0) {
      // Convert config to mermaid init format with single quotes
      const configStr = JSON.stringify(mergedConfig)
        .replace(/"/g, "'")
      initDirective = `%%{init: ${configStr}}%%\n`
    }

    return initDirective + diagramLines.join('\n')
  }, [parseInitDirective])

  const renderDiagram = useCallback(async (mermaidCode: string) => {
    try {
      // Register layout loaders as needed
      if (layout === 'elk') {
        await registerElkLayouts()
      } else if (layout === 'tidy-tree') {
        await registerTidyTreeLayouts()
      }

      // Initialize mermaid with base config
      // 使用莫兰迪色系配色，与 prompts/mermaid.ts 保持一致
      mermaid.initialize({
        startOnLoad: false,
        theme: 'base',
        securityLevel: 'loose',
        fontFamily: 'inherit',
        themeVariables: {
          // 基础颜色 - 莫兰迪蓝
          primaryColor: '#e3f2fd',
          primaryTextColor: '#0d47a1',
          primaryBorderColor: '#2196f3',
          lineColor: '#546e7a',
          // 思维导图分支配色 (cScale0-11) - 低饱和度莫兰迪色系
          cScale0: '#e3f2fd',  // 莫兰迪蓝 (主色)
          cScale1: '#fff3e0',  // 莫兰迪橙
          cScale2: '#e8f5e9',  // 莫兰迪绿
          cScale3: '#f3e5f5',  // 莫兰迪紫
          cScale4: '#fce4ec',  // 莫兰迪粉
          cScale5: '#e0f7fa',  // 莫兰迪青
          cScale6: '#fff8e1',  // 莫兰迪黄
          cScale7: '#efebe9',  // 莫兰迪棕
          cScale8: '#e8eaf6',  // 莫兰迪靛
          cScale9: '#f1f8e9',  // 莫兰迪草绿
          cScale10: '#fbe9e7', // 莫兰迪珊瑚
          cScale11: '#e1f5fe', // 莫兰迪天蓝
          // 对应的文字颜色
          cScaleLabel0: '#0d47a1',
          cScaleLabel1: '#e65100',
          cScaleLabel2: '#1b5e20',
          cScaleLabel3: '#4a148c',
          cScaleLabel4: '#880e4f',
          cScaleLabel5: '#006064',
          cScaleLabel6: '#ff6f00',
          cScaleLabel7: '#3e2723',
          cScaleLabel8: '#1a237e',
          cScaleLabel9: '#33691e',
          cScaleLabel10: '#bf360c',
          cScaleLabel11: '#01579b',
        },
      })

      const codeWithConfig = injectConfig(mermaidCode, layout, direction)

      // Validate syntax first
      await mermaid.parse(codeWithConfig)

      // Render the diagram
      const id = `mermaid-${Date.now()}`
      const { svg: renderedSvg } = await mermaid.render(id, codeWithConfig)
      setSvg(renderedSvg)
      setError(null)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Invalid Mermaid syntax'
      setError(errorMessage)
      setSvg('')
    }
  }, [injectConfig, layout, direction])

  useEffect(() => {
    if (!code.trim()) {
      setSvg('')
      setError(null)
      return
    }

    renderDiagram(code)
  }, [code, renderDiagram])

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    setScale(prev => Math.min(prev + SCALE_STEP, MAX_SCALE))
  }, [])

  const handleZoomOut = useCallback(() => {
    setScale(prev => Math.max(prev - SCALE_STEP, MIN_SCALE))
  }, [])

  const handleResetView = useCallback(() => {
    setScale(1)
    setPosition({ x: 0, y: 0 })
  }, [])

  // Native wheel event handler for proper preventDefault
  useEffect(() => {
    const container = diagramContainerRef.current
    if (!container) return

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+滚轮：缩放
        e.preventDefault()
        const delta = e.deltaY > 0 ? -SCALE_STEP : SCALE_STEP
        setScale(prev => Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev + delta)))
      } else {
        // 普通滚轮：上下滚动（平移）
        e.preventDefault()
        setPosition(prev => ({
          x: prev.x,
          y: prev.y - e.deltaY,
        }))
      }
    }

    // Use passive: false to allow preventDefault
    container.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      container.removeEventListener('wheel', handleWheel)
    }
  }, [svg])

  // Keyboard zoom
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        handleZoomIn()
      } else if (e.key === '-') {
        e.preventDefault()
        handleZoomOut()
      } else if (e.key === '0') {
        e.preventDefault()
        handleResetView()
      }
    }
  }, [handleZoomIn, handleZoomOut, handleResetView])

  // Pan controls
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsDragging(true)
      setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y })
    }
  }, [position])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging) {
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      })
    }
  }, [isDragging, dragStart])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  // Export functions
  const exportAsSvg = useCallback(() => {
    if (!svg) return

    const blob = new Blob([svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `diagram-${Date.now()}.svg`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }, [svg])

  const exportAsPng = useCallback(async () => {
    if (!svg || !svgContainerRef.current) return

    const svgElement = svgContainerRef.current.querySelector('svg')
    if (!svgElement) return

    // Get SVG dimensions
    const bbox = svgElement.getBBox()
    const width = bbox.width || svgElement.clientWidth || 800
    const height = bbox.height || svgElement.clientHeight || 600

    // Create canvas
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas size with higher resolution for better quality
    const exportScale = 2
    canvas.width = width * exportScale
    canvas.height = height * exportScale
    ctx.scale(exportScale, exportScale)

    // Fill white background
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, width, height)

    // Convert SVG to base64 data URL to avoid tainted canvas issue
    const svgData = new XMLSerializer().serializeToString(svgElement)
    const svgBase64 = btoa(unescape(encodeURIComponent(svgData)))
    const dataUrl = `data:image/svg+xml;base64,${svgBase64}`

    const img = new window.Image()
    img.onload = () => {
      ctx.drawImage(img, 0, 0, width, height)

      // Download
      const link = document.createElement('a')
      link.download = `diagram-${Date.now()}.png`
      link.href = canvas.toDataURL('image/png')
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
    img.onerror = (err) => {
      console.error('Failed to load SVG for PNG export:', err)
    }
    img.src = dataUrl
  }, [svg])

  // Export as source (.mmd file)
  const exportAsSource = useCallback(() => {
    if (!code) return

    const blob = new Blob([code], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `diagram-${Date.now()}.mmd`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }, [code])

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    exportAsSvg,
    exportAsPng,
    exportAsSource,
    showSourceCode: () => setShowCodePanel(true),
    hideSourceCode: () => setShowCodePanel(false),
    toggleSourceCode: () => setShowCodePanel(prev => !prev),
  }), [exportAsSvg, exportAsPng, exportAsSource])

  // Layout change handler
  const handleLayoutChange = useCallback((value: string) => {
    setLayout(value as LayoutEngine)
  }, [])

  // Direction change handler
  const handleDirectionChange = useCallback((value: string) => {
    setDirection(value as Direction)
  }, [])

  // Copy code handler
  const handleCopyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(editedCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy code:', err)
    }
  }, [editedCode])

  // Handle code edit (for Monaco Editor)
  const handleCodeChange = useCallback((value: string | undefined) => {
    const newCode = value || ''
    setEditedCode(newCode)
    setHasChanges(newCode !== code)
  }, [code])

  // Apply code changes
  const handleApplyCode = useCallback(() => {
    if (editedCode.trim() && editedCode !== code) {
      setContent(editedCode)
      setHasChanges(false)
    }
  }, [editedCode, code, setContent])

  // Reset code to original
  const handleResetCode = useCallback(() => {
    setEditedCode(code)
    setHasChanges(false)
  }, [code])

  if (!code.trim()) {
    return (
      <div
        className={cn(
          'flex h-full items-center justify-center text-muted',
          className
        )}
      >
        <div className="text-center">
          <p className="text-sm">No diagram yet</p>
          <p className="mt-1 text-xs">Use AI to generate one</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div
        className={cn(
          'flex h-full items-center justify-center p-4',
          className
        )}
      >
        <div className="max-w-md border border-red-300 bg-red-50 p-4">
          <p className="font-medium text-red-800">Syntax Error</p>
          <p className="mt-1 text-sm text-red-600">{error}</p>
        </div>
      </div>
    )
  }

  const DirectionIcon = DIRECTION_ICONS[direction]

  return (
    <TooltipProvider>
      <div
        ref={containerRef}
        className={cn('relative flex h-full flex-col', className)}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        {/* Toolbar */}
        <div className="flex items-center gap-1 border-b border-border bg-surface px-2 py-2">
          {/* Layout selector */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-1.5">
                    {layout === 'elk' ? (
                      <LayoutGrid className="h-4 w-4" />
                    ) : layout === 'tidy-tree' ? (
                      <Network className="h-4 w-4" />
                    ) : (
                      <GitBranch className="h-4 w-4" />
                    )}
                    <span className="text-xs">
                      {layout === 'elk' ? 'ELK' : layout === 'tidy-tree' ? 'Tidy Tree' : 'Dagre'}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>布局引擎</TooltipContent>
            </Tooltip>
            <DropdownMenuContent>
              <DropdownMenuRadioGroup value={layout} onValueChange={handleLayoutChange}>
                <DropdownMenuRadioItem value="dagre">Dagre (默认)</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="elk">ELK (层次化)</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="tidy-tree">Tidy Tree (思维导图专用)</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Direction selector */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-1.5">
                    <DirectionIcon className="h-4 w-4" />
                    <span className="text-xs">{DIRECTION_LABELS[direction]}</span>
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>图表方向</TooltipContent>
            </Tooltip>
            <DropdownMenuContent>
              <DropdownMenuRadioGroup value={direction} onValueChange={handleDirectionChange}>
                <DropdownMenuRadioItem value="TB">
                  <ArrowDown className="mr-2 h-4 w-4" />
                  从上到下
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="BT">
                  <ArrowUp className="mr-2 h-4 w-4" />
                  从下到上
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="LR">
                  <ArrowRight className="mr-2 h-4 w-4" />
                  从左到右
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="RL">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  从右到左
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="mx-1 h-4 w-px bg-border" />

          {/* Zoom controls */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={handleZoomOut}>
                <ZoomOut className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>缩小</TooltipContent>
          </Tooltip>

          <span className="min-w-[3rem] text-center text-xs text-muted">
            {Math.round(scale * 100)}%
          </span>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={handleZoomIn}>
                <ZoomIn className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>放大</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={handleResetView}>
                <RotateCcw className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>重置视图</TooltipContent>
          </Tooltip>



        </div>

        {/* Diagram container */}
        <div
          ref={diagramContainerRef}
          className="flex-1 overflow-hidden"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        >
          <div
            ref={svgContainerRef}
            className="flex h-full w-full items-center justify-center p-8"
            style={{
              transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
              transformOrigin: 'center center',
              transition: isDragging ? 'none' : 'transform 0.1s ease-out',
            }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>

        {/* Zoom hint */}
        <div className={cn(
          "absolute bottom-2 right-2 text-xs text-muted opacity-60",
          showCodePanel && "right-[340px]"
        )}>
          滚轮滚动 | Ctrl+滚轮缩放 | 拖拽平移
        </div>

        {/* Code Panel */}
        {showCodePanel && (
          <div className="absolute bottom-4 right-4 w-96 max-h-[70%] flex flex-col border border-border bg-surface shadow-lg">
            {/* Panel Header */}
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Mermaid 源码</span>
                {hasChanges && (
                  <span className="text-xs text-amber-500">• 未保存</span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCopyCode}
                      className="h-7 w-7 p-0"
                    >
                      {copied ? (
                        <Check className="h-3.5 w-3.5 text-green-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{copied ? '已复制' : '复制代码'}</TooltipContent>
                </Tooltip>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowCodePanel(false)}
                  className="h-7 w-7 p-0"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            {/* Code Editor */}
            <div className="flex-1 min-h-0 overflow-hidden">
              <Editor
                height="300px"
                defaultLanguage="mermaid"
                value={editedCode}
                onChange={handleCodeChange}
                theme="vs"
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  automaticLayout: true,
                  tabSize: 2,
                  padding: { top: 8, bottom: 8 },
                  scrollbar: {
                    verticalScrollbarSize: 8,
                    horizontalScrollbarSize: 8,
                  },
                }}
              />
            </div>
            {/* Panel Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleResetCode}
                    disabled={!hasChanges}
                    className="gap-1.5"
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                    <span className="text-xs">重置</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>重置为原始代码</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleApplyCode}
                    disabled={!hasChanges || !editedCode.trim()}
                    className="gap-1.5"
                  >
                    <Play className="h-3.5 w-3.5" />
                    <span className="text-xs">应用</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>应用代码更改</TooltipContent>
              </Tooltip>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  )
})
