// 文件管理页（mei-portal 主应用风格重构版）
// 前端逻辑与原实现一致：分组管理 / 搜索 / 排序 / 分页 / 重命名 / 移动 / 删除 / 预览 / 导入新建
// 视觉对齐门户：极光背景下的玻璃拟态卡片 + 靛紫渐变强调
import {useEffect, useState} from 'react'
import {useLocation, useNavigate} from 'react-router-dom'
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Folder,
  FolderOpen,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Upload,
} from 'lucide-react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Loading,
  Logo,
} from '@/components/ui'
import {AppSidebar, CreateProjectDialog, ImportProjectDialog} from '@/components/layout'
import {formatDate} from '@/lib/utils'
import type {Group, Project} from '@/types'
import {ProjectRepository} from '@/services/projectRepository'
import {GroupRepository} from '@/services/groupRepository'
import {VersionRepository} from '@/services/versionRepository'
import {buildHtmlSrcDoc} from '@/lib/htmlShells'
import {buildPptSrcDoc} from '@/lib/htmlPpt/srcdocBuilder'
import {sanitizeHtml} from '@/lib/validators/html'
import {useSystemStore} from '@/stores/systemStore'

// 主应用风格常量（与门户 tokens 对齐）
const glass = 'bg-white/70 backdrop-blur-xl border border-black/10 shadow-[0_8px_28px_rgba(23,32,56,0.08)]'
const gradientText = 'bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent'
const gradientBtn = 'rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 text-white shadow-[0_4px_14px_rgba(99,102,241,0.35)] hover:opacity-90 border-0'

function EngineBadge({ type }: { type: Project['engineType'] }) {
  const cls =
    type === 'excalidraw'
      ? 'bg-blue-50 text-blue-600'
      : type === 'drawio'
        ? 'bg-green-50 text-green-600'
        : type === 'html'
          ? 'bg-orange-50 text-orange-600'
          : type === 'html-ppt'
            ? 'bg-pink-50 text-pink-600'
            : 'bg-purple-50 text-purple-600'
  return <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${cls}`}>{type.toUpperCase()}</span>
}

export function ProjectsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const navigate = useNavigate()
  const location = useLocation()
  const language = useSystemStore((state) => state.language)
  const i18nTexts = useSystemStore((state) => state.i18nTexts)
  const [projects, setProjects] = useState<Project[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize] = useState(18)
  const [total, setTotal] = useState(0)
  const [sortBy, setSortBy] = useState<'createdAt' | 'updatedAt'>('updatedAt')

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [renameTarget, setRenameTarget] = useState<Project | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [isRenaming, setIsRenaming] = useState(false)
  const [isCreateGroupDialogOpen, setIsCreateGroupDialogOpen] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [isCreatingGroup, setIsCreatingGroup] = useState(false)
  const [editGroupTarget, setEditGroupTarget] = useState<Group | null>(null)
  const [editGroupName, setEditGroupName] = useState('')
  const [isEditingGroup, setIsEditingGroup] = useState(false)
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<Group | null>(null)
  const [isDeletingGroup, setIsDeletingGroup] = useState(false)
  const [moveProjectTarget, setMoveProjectTarget] = useState<Project | null>(null)
  const [targetGroupId, setTargetGroupId] = useState<string>('')
  const [isMovingProject, setIsMovingProject] = useState(false)
  const [previewProject, setPreviewProject] = useState<Project | null>(null)

  useEffect(() => {
    loadData()
  }, [page, selectedGroupId, searchQuery, sortBy])

  useEffect(() => {
    if (location.state?.openCreateDialog) {
      setIsCreateDialogOpen(true)
      navigate(location.pathname, { replace: true, state: {} })
    }
  }, [location.state])

  const loadData = async () => {
    setIsLoading(true)
    try {
      const { items, total } = await ProjectRepository.getAll(page, pageSize, searchQuery, selectedGroupId, sortBy)
      const groupsData = await GroupRepository.getAll()
      setProjects(items)
      setTotal(total)
      setGroups(groupsData)
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  // --- Project Actions ---
  const handleDelete = async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      await ProjectRepository.delete(deleteTarget.id)
      setDeleteTarget(null)
      loadData()
    } catch (error) {
      console.error('Failed to delete project:', error)
    } finally {
      setIsDeleting(false)
    }
  }

  const handleRename = async () => {
    if (!renameTarget || !newTitle.trim()) return
    setIsRenaming(true)
    try {
      await ProjectRepository.update(renameTarget.id, { title: newTitle.trim() })
      setRenameTarget(null)
      setNewTitle('')
      loadData()
    } catch (error) {
      console.error('Failed to rename project:', error)
    } finally {
      setIsRenaming(false)
    }
  }

  const handleMoveProject = async () => {
    if (!moveProjectTarget) return
    setIsMovingProject(true)
    try {
      await ProjectRepository.update(moveProjectTarget.id, { groupId: targetGroupId || null } as any)
      setMoveProjectTarget(null)
      setTargetGroupId('')
      loadData()
    } catch (error) {
      console.error('Failed to move project:', error)
    } finally {
      setIsMovingProject(false)
    }
  }

  const openRenameDialog = (project: Project) => {
    setRenameTarget(project)
    setNewTitle(project.title)
  }

  const handleOpenInNewWindow = async (project: Project) => {
    try {
      const latest = await VersionRepository.getLatest(project.id)
      const rawHtml = latest?.content ?? ''
      const sanitized = sanitizeHtml(rawHtml)
      const themeId = project.styleVariant ?? ''
      const srcDoc = project.engineType === 'html-ppt'
        ? buildPptSrcDoc({ themeId, body: sanitized, title: project.title, activeIndex: 0, includeNavScript: true })
        : buildHtmlSrcDoc(themeId, sanitized, project.title)
      const blob = new Blob([srcDoc], { type: 'text/html;charset=utf-8' })
      const href = URL.createObjectURL(blob)
      const win = window.open(href, '_blank')
      if (!win) console.warn('[ProjectsPage] Popup blocked; preview URL:', href)
      setTimeout(() => URL.revokeObjectURL(href), 60_000)
    } catch (error) {
      console.error('Failed to open project in new window:', error)
    }
  }

  // --- Group Actions ---
  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return
    setIsCreatingGroup(true)
    try {
      await GroupRepository.create(newGroupName.trim())
      setNewGroupName('')
      setIsCreateGroupDialogOpen(false)
      loadData()
    } catch (error) {
      console.error('Failed to create group:', error)
    } finally {
      setIsCreatingGroup(false)
    }
  }

  const handleEditGroup = async () => {
    if (!editGroupTarget || !editGroupName.trim()) return
    setIsEditingGroup(true)
    try {
      await GroupRepository.update(editGroupTarget.id, editGroupName.trim())
      setEditGroupTarget(null)
      setEditGroupName('')
      loadData()
    } catch (error) {
      console.error('Failed to update group:', error)
    } finally {
      setIsEditingGroup(false)
    }
  }

  const handleDeleteGroup = async () => {
    if (!deleteGroupTarget) return
    setIsDeletingGroup(true)
    try {
      await GroupRepository.delete(deleteGroupTarget.id)
      if (selectedGroupId === deleteGroupTarget.id) setSelectedGroupId(null)
      setDeleteGroupTarget(null)
      loadData()
    } catch (error) {
      console.error('Failed to delete group:', error)
    } finally {
      setIsDeletingGroup(false)
    }
  }

  const selectedGroupName =
    selectedGroupId === null
      ? i18nTexts.projectsAllFiles[language]
      : selectedGroupId === 'uncategorized'
        ? i18nTexts.projectsUncategorized[language]
        : groups.find((g) => g.id === selectedGroupId)?.name || i18nTexts.projectsPageTitle[language]

  const groupBtnCls = (active: boolean) =>
    `flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[13px] transition-all ${
      active
        ? 'bg-gradient-to-br from-indigo-500/10 to-pink-500/10 text-indigo-600 font-semibold border border-indigo-300/40'
        : 'text-gray-600 hover:bg-black/5 border border-transparent'
    }`

  return (
    <div className={embedded ? 'flex h-full overflow-hidden' : 'flex min-h-screen overflow-hidden'}>
      {!embedded && <AppSidebar onCreateProject={() => setIsCreateDialogOpen(true)} />}

      <main className={embedded ? 'flex flex-1 h-full min-h-0 gap-3 p-3' : 'flex flex-1 min-h-0 gap-4 p-4 pt-[84px]'}>
        {/* 左列：搜索 + 分组（玻璃卡片） */}
        <div className={`flex w-60 flex-col rounded-2xl ${glass} overflow-hidden`}>
          <div className="flex items-center justify-between px-4 pt-4 pb-3">
            <h2 className={`text-[15px] font-extrabold tracking-tight ${gradientText}`}>{i18nTexts.projectsPageTitle[language]}</h2>
            <button
              className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-black/5 hover:text-indigo-500"
              onClick={() => setIsCreateGroupDialogOpen(true)}
              title={i18nTexts.projectsNew[language]}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          <div className="px-3 pb-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder={i18nTexts.projectsSearchPlaceholder[language]}
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setPage(1)
                }}
                className="h-9 rounded-full border-black/10 bg-white/80 pl-8 pr-3 text-[13px] focus:border-indigo-400"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
            <button onClick={() => { setSelectedGroupId(null); setPage(1) }} className={groupBtnCls(selectedGroupId === null)}>
              <Folder className="h-4 w-4" />
              {i18nTexts.projectsAllFiles[language]}
              <span className="ml-auto text-[11px] opacity-60">{total}</span>
            </button>
            <button onClick={() => { setSelectedGroupId('uncategorized'); setPage(1) }} className={groupBtnCls(selectedGroupId === 'uncategorized')}>
              <FolderOpen className="h-4 w-4" />
              {i18nTexts.projectsUncategorized[language]}
            </button>
            {groups.map((group) => (
              <div key={group.id} className="group/item relative">
                <button onClick={() => { setSelectedGroupId(group.id); setPage(1) }} className={groupBtnCls(selectedGroupId === group.id)}>
                  <Folder className="h-4 w-4" />
                  <span className="truncate">{group.name}</span>
                  <span className="ml-auto text-[11px] opacity-60">{group.projectCount || 0}</span>
                </button>
                <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover/item:opacity-100">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:bg-black/5">
                        <MoreVertical className="h-3 w-3" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => { setEditGroupTarget(group); setEditGroupName(group.name) }}>重命名</DropdownMenuItem>
                      <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={() => setDeleteGroupTarget(group)}>删除</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 右列：文件网格（玻璃卡片） */}
        <div className={`flex flex-1 flex-col overflow-hidden rounded-2xl ${glass}`}>
          <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-black/5">
            <div className="flex items-center gap-3 min-w-0">
              <h1 className="truncate text-[15px] font-bold text-gray-800">{selectedGroupName}</h1>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex h-7 items-center gap-1 rounded-full border border-black/10 bg-white/70 px-3 text-[11px] text-gray-500 transition-colors hover:border-indigo-300 hover:text-indigo-500">
                    {sortBy === 'updatedAt' ? i18nTexts.projectsSortUpdated[language] : i18nTexts.projectsSortCreated[language]}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => { setSortBy('updatedAt'); setPage(1) }} className={sortBy === 'updatedAt' ? 'bg-primary/10 text-primary' : ''}>
                    {i18nTexts.projectsSortByUpdated[language]}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { setSortBy('createdAt'); setPage(1) }} className={sortBy === 'createdAt' ? 'bg-primary/10 text-primary' : ''}>
                    {i18nTexts.projectsSortByCreated[language]}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setIsImportDialogOpen(true)}
                className="flex h-8 items-center gap-1.5 rounded-full border border-black/10 bg-white/80 px-4 text-xs font-semibold text-gray-600 transition-colors hover:border-indigo-300 hover:text-indigo-500"
              >
                <Upload className="h-3.5 w-3.5" />
                {i18nTexts.projectsImport[language]}
              </button>
              <button onClick={() => setIsCreateDialogOpen(true)} className={`flex h-8 items-center gap-1.5 px-4 text-xs font-semibold ${gradientBtn}`}>
                <Plus className="h-3.5 w-3.5" />
                {i18nTexts.projectsNew[language]}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {isLoading ? (
              <div className="flex h-full items-center justify-center"><Loading size="lg" /></div>
            ) : projects.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center">
                <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-black/10 bg-white/50 p-12">
                  <Sparkles className="mb-4 h-10 w-10 text-indigo-300" />
                  <p className="mb-4 text-sm text-gray-500">{searchQuery ? '未找到匹配的文件' : '暂无文件'}</p>
                  {!searchQuery && (
                    <button onClick={() => setIsCreateDialogOpen(true)} className={`px-6 py-2 text-sm ${gradientBtn}`}>
                      创建你的第一个文件
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {projects.map((project) => (
                  <div
                    key={project.id}
                    className="group relative cursor-pointer overflow-hidden rounded-2xl border border-black/5 bg-white/60 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-indigo-300/50 hover:shadow-[0_10px_30px_rgba(99,102,241,0.15)]"
                    onClick={() => setPreviewProject(project)}
                    onDoubleClick={() => navigate(`/editor/${project.id}`)}
                  >
                    <div className="absolute left-2 top-2 z-10 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-indigo-500 shadow-sm backdrop-blur-sm hover:bg-white"
                        onClick={(e) => { e.stopPropagation(); navigate(`/editor/${project.id}`) }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="absolute right-2 top-2 z-10 opacity-0 transition-opacity group-hover:opacity-100">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-gray-500 shadow-sm backdrop-blur-sm hover:bg-white"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreVertical className="h-3.5 w-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openRenameDialog(project) }}>重命名</DropdownMenuItem>
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setMoveProjectTarget(project); setTargetGroupId(project.groupId || '') }}>移动到...</DropdownMenuItem>
                          <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={(e) => { e.stopPropagation(); setDeleteTarget(project) }}>删除</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <div className="flex h-32 items-center justify-center bg-gradient-to-br from-indigo-50/60 to-purple-50/40 p-5 border-b border-black/5">
                      {project.thumbnail ? (
                        <img src={project.thumbnail} alt={project.title} className="h-full w-full object-contain" />
                      ) : (
                        <Logo className="h-8 w-8 text-indigo-200" />
                      )}
                    </div>

                    <div className="p-3.5 text-left w-full">
                      <h3 className="mb-2 truncate pl-0.5 text-[13px] font-semibold text-gray-800 group-hover:text-indigo-600">{project.title}</h3>
                      <div className="flex items-center justify-between gap-2">
                        <EngineBadge type={project.engineType} />
                        <p className="text-[10px] text-gray-400">{formatDate(project.updatedAt)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {total > pageSize && (
              <div className="mt-4 flex items-center justify-center gap-3 border-t border-black/5 py-4">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-black/10 bg-white/80 text-gray-500 transition-colors hover:border-indigo-300 hover:text-indigo-500 disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-xs text-gray-500">{page} / {Math.ceil(total / pageSize)}</span>
                <button
                  onClick={() => setPage((p) => Math.min(Math.ceil(total / pageSize), p + 1))}
                  disabled={page >= Math.ceil(total / pageSize)}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-black/10 bg-white/80 text-gray-500 transition-colors hover:border-indigo-300 hover:text-indigo-500 disabled:opacity-40"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </main>

      <CreateProjectDialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen} />
      <ImportProjectDialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen} />

      {/* Rename Dialog */}
      <Dialog open={!!renameTarget} onOpenChange={() => setRenameTarget(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader><DialogTitle>重命名文件</DialogTitle></DialogHeader>
          <Input className="my-4" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="文件名称" onKeyDown={(e) => { if (e.key === 'Enter') handleRename() }} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)} className="rounded-full">取消</Button>
            <Button onClick={handleRename} disabled={isRenaming || !newTitle.trim()} className={gradientBtn}>{isRenaming ? '保存中...' : '保存'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>删除文件</DialogTitle>
            <DialogDescription className="my-4">确定要删除 &quot;{deleteTarget?.title}&quot; 吗？此操作无法撤销。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} className="rounded-full">取消</Button>
            <Button onClick={handleDelete} disabled={isDeleting} className="rounded-full bg-red-600 text-white hover:bg-red-700 border-0">{isDeleting ? '删除中...' : '删除'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Group Dialog */}
      <Dialog open={isCreateGroupDialogOpen} onOpenChange={setIsCreateGroupDialogOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader><DialogTitle>新建分组</DialogTitle></DialogHeader>
          <Input className="my-4" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="分组名称" onKeyDown={(e) => { if (e.key === 'Enter') handleCreateGroup() }} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateGroupDialogOpen(false)} className="rounded-full">取消</Button>
            <Button onClick={handleCreateGroup} disabled={isCreatingGroup || !newGroupName.trim()} className={gradientBtn}>{isCreatingGroup ? '创建中...' : '创建'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Group Dialog */}
      <Dialog open={!!editGroupTarget} onOpenChange={() => setEditGroupTarget(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader><DialogTitle>重命名分组</DialogTitle></DialogHeader>
          <Input className="my-4" value={editGroupName} onChange={(e) => setEditGroupName(e.target.value)} placeholder="分组名称" onKeyDown={(e) => { if (e.key === 'Enter') handleEditGroup() }} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditGroupTarget(null)} className="rounded-full">取消</Button>
            <Button onClick={handleEditGroup} disabled={isEditingGroup || !editGroupName.trim()} className={gradientBtn}>{isEditingGroup ? '保存中...' : '保存'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Group Dialog */}
      <Dialog open={!!deleteGroupTarget} onOpenChange={() => setDeleteGroupTarget(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>删除分组</DialogTitle>
            <DialogDescription className="my-4">确定要删除分组 &quot;{deleteGroupTarget?.name}&quot; 吗？组内的文件将变为未分组状态。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteGroupTarget(null)} className="rounded-full">取消</Button>
            <Button onClick={handleDeleteGroup} disabled={isDeletingGroup} className="rounded-full bg-red-600 text-white hover:bg-red-700 border-0">{isDeletingGroup ? '删除中...' : '删除'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move Project Dialog */}
      <Dialog open={!!moveProjectTarget} onOpenChange={() => setMoveProjectTarget(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader><DialogTitle>移动文件到分组</DialogTitle></DialogHeader>
          <div className="my-4 space-y-2">
            <button onClick={() => setTargetGroupId('')} className={`flex w-full items-center gap-2 rounded-xl border p-3 text-sm transition-colors ${targetGroupId === '' ? 'border-indigo-400 bg-indigo-50 text-indigo-600' : 'border-black/10 hover:bg-black/5'}`}>
              <FolderOpen className="h-4 w-4" />
              未分组
            </button>
            {groups.map((group) => (
              <button key={group.id} onClick={() => setTargetGroupId(group.id)} className={`flex w-full items-center gap-2 rounded-xl border p-3 text-sm transition-colors ${targetGroupId === group.id ? 'border-indigo-400 bg-indigo-50 text-indigo-600' : 'border-black/10 hover:bg-black/5'}`}>
                <Folder className="h-4 w-4" />
                {group.name}
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveProjectTarget(null)} className="rounded-full">取消</Button>
            <Button onClick={handleMoveProject} disabled={isMovingProject} className={gradientBtn}>{isMovingProject ? '移动中...' : '移动'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Project Preview Dialog */}
      <Dialog open={!!previewProject} onOpenChange={() => setPreviewProject(null)}>
        <DialogContent className="max-w-3xl p-0 overflow-hidden bg-transparent border-none shadow-none">
          <div className="relative flex flex-col items-center justify-center">
            <div className="relative w-full overflow-hidden rounded-2xl bg-white shadow-2xl">
              {previewProject && (previewProject.engineType === 'html' || previewProject.engineType === 'html-ppt') && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleOpenInNewWindow(previewProject)}
                  className="absolute top-3 right-14 z-10 rounded-full h-9 px-4 gap-1.5 shadow-sm bg-white/95 backdrop-blur"
                  title={i18nTexts.projectsOpenInNewWindow[language]}
                >
                  <ExternalLink className="h-4 w-4" />
                  <span className="hidden sm:inline">{i18nTexts.projectsOpenInNewWindow[language]}</span>
                </Button>
              )}
              <div className="flex min-h-[400px] items-center justify-center bg-gradient-to-br from-indigo-50/50 to-purple-50/30 p-8">
                {previewProject?.thumbnail ? (
                  <img src={previewProject.thumbnail} alt={previewProject.title} className="max-h-[60vh] max-w-full rounded-md object-contain shadow-lg" />
                ) : (
                  <div className="flex flex-col items-center justify-center text-gray-400">
                    <Logo className="mb-4 h-24 w-24 opacity-20" />
                    <p>{i18nTexts.projectsNoPreview[language]}</p>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between border-t border-black/5 bg-white p-6">
                <div className="mr-4 flex flex-1 flex-col gap-2">
                  <h2 className={`truncate text-xl font-extrabold ${gradientText}`} title={previewProject?.title}>{previewProject?.title}</h2>
                  <div className="flex items-center gap-4 text-xs text-gray-400">
                    <span>{i18nTexts.projectsCreateTime[language]}：{previewProject && formatDate(previewProject.createdAt, true)}</span>
                    <span className="h-3 w-px bg-black/10"></span>
                    <span>{i18nTexts.projectsUpdateTime[language]}：{previewProject && formatDate(previewProject.updatedAt, true)}</span>
                  </div>
                </div>
                <Button onClick={() => { if (previewProject) navigate(`/editor/${previewProject.id}`) }} className={`h-12 shrink-0 px-8 text-base ${gradientBtn}`}>
                  {i18nTexts.projectsEnterEdit[language]}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
