import { useState, useEffect } from 'react'
import { RotateCcw, Clock, ArrowRightToLine } from 'lucide-react'
import { Button, Loading } from '@/components/ui'
import { useEditorStore } from '@/stores/editorStore'
import { VersionRepository } from '@/services/versionRepository'
import type { VersionHistory } from '@/types'

interface VersionPanelProps {
  onClose: () => void
}

export function VersionPanel({ onClose }: VersionPanelProps) {
  const [versions, setVersions] = useState<VersionHistory[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const currentProject = useEditorStore((s) => s.currentProject)
  const versionSaveCount = useEditorStore((s) => s.versionSaveCount)
  const setContentFromVersion = useEditorStore((s) => s.setContentFromVersion)

  useEffect(() => {
    if (currentProject) {
      loadVersions()
    }
  }, [currentProject, versionSaveCount])

  const loadVersions = async () => {
    if (!currentProject) return

    setIsLoading(true)
    try {
      const data = await VersionRepository.getByProjectId(currentProject.id)
      setVersions(data)
    } catch (error) {
      console.error('Failed to load versions:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleRestore = async (version: VersionHistory) => {
    setContentFromVersion(version.content)
    setSelectedId(version.id)
  }

  const formatTime = (date: Date) => {
    return new Date(date).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="absolute right-4 top-4 bottom-4 w-72 flex flex-col bg-surface rounded-lg shadow-lg border border-border z-50">
      {/* Header */}
      <div className="flex justify-between items-center border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
            <ArrowRightToLine className="h-4 w-4" />
          </Button>
          <h2 className="font-medium text-primary">版本历史</h2>
        </div>
        <p className="text-xs text-muted">{versions.length} 个版本</p>
      </div>

      {/* Version List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Loading size="sm" />
          </div>
        ) : versions.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center text-muted">
            <Clock className="mb-2 h-8 w-8 opacity-50" />
            <p className="text-sm">没有版本记录</p>
          </div>
        ) : (
          <div className="space-y-1 p-2">
            {versions.map((version, index) => (
              <div
                key={version.id}
                className={`cursor-pointer border p-3 transition-colors ${
                  selectedId === version.id
                    ? 'border-primary bg-background'
                    : 'border-transparent hover:bg-background'
                }`}
                onClick={() => handleRestore(version)}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {index === 0 ? '当前版本' : `v${versions.length - index}`}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRestore(version)
                    }}
                  >
                    <RotateCcw className="h-3 w-3" />
                  </Button>
                </div>
                <p className="text-xs text-muted">{version.changeSummary}</p>
                <p className="mt-1 text-xs text-muted">
                  {formatTime(version.timestamp)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
