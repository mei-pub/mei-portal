<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { inspectVisibleLinks } from '@/api';
import type {
  DetectionSettings,
  LinkCheckItem,
  LinkHealthRecord,
  LinkHealthState,
  MergedResults,
  MergedResultItem,
} from '@/types';
import { getDiskTypeName } from '@/utils/diskTypes';
import {
  buildHealthCacheKey,
  buildHealthRecord,
  loadDetectionSettings,
  loadLinkHealthCache,
  persistLinkHealthCache,
  pruneExpiredHealthCache,
  saveCachedLinkHealth,
} from '@/utils/linkDetection';

const props = defineProps<{
  mergedResults: MergedResults;
  loading: boolean;
  hasSearched: boolean;
  isActivelySearching: boolean;
}>();

// 当前激活的标签
const activeTab = ref('');
// 当前标签页的数据
const currentTabData = ref<MergedResultItem[]>([]);
// 虚拟列表显示的数据
const visibleItems = ref<MergedResultItem[]>([]);
// 每次加载的数量
const PAGE_SIZE = 20;
// 当前加载的页码
const currentPage = ref(1);
const listContainerRef = ref<HTMLElement | null>(null);
// 当前查看详情的结果项
const detailItem = ref<MergedResultItem | null>(null);
// 复制状态
const linkCopyStatus = ref<'idle' | 'success' | 'error'>('idle');
const passwordCopyStatus = ref<'idle' | 'success' | 'error'>('idle');
const linkCopyTimer = ref<number | null>(null);
const passwordCopyTimer = ref<number | null>(null);
const listPasswordFeedbackKey = ref('');
const listPasswordFeedbackStatus = ref<'idle' | 'success' | 'error'>('idle');
const listPasswordFeedbackTimer = ref<number | null>(null);
const detectionSettings = ref<DetectionSettings>(loadDetectionSettings());
const healthCache = ref<Record<string, LinkHealthRecord>>({});
const pendingHealthMap = ref<Record<string, true>>({});
const currentViewToken = ref('');

const supportedDetectionDiskTypes = new Set([
  'baidu',
  'quark',
  'aliyun',
  'uc',
  'tianyi',
  '123',
  'xunlei',
  '115',
  'mobile'
]);

let visibilityObserver: IntersectionObserver | null = null;
let flushTimer: number | null = null;
const queuedItems = new Map<string, LinkCheckItem>();
const inFlightKeys = new Set<string>();

// 计算所有可用的网盘类型
const diskTypes = computed(() => {
  return Object.keys(props.mergedResults || {}).sort();
});

// 判断是否有搜索结果
const hasResults = computed(() => {
  return diskTypes.value.length > 0;
});

// 判断是否显示空状态（无结果且已完成搜索）
const showEmptyState = computed(() => {
  return !hasResults.value && props.hasSearched && !props.isActivelySearching;
});

// 判断是否显示搜索中状态（无结果但正在搜索）
const showSearchingState = computed(() => {
  return !hasResults.value && props.hasSearched && props.isActivelySearching;
});

// 判断是否显示初始状态（未搜索）
const showInitialState = computed(() => {
  return !hasResults.value && !props.hasSearched;
});

const hydrateHealthCache = () => {
  const nextCache = pruneExpiredHealthCache(loadLinkHealthCache());
  healthCache.value = nextCache;
  persistLinkHealthCache(nextCache);
};

const reloadDetectionSettings = () => {
  detectionSettings.value = loadDetectionSettings();
};

const getHealthStateKey = (diskType: string, url: string) => {
  return buildHealthCacheKey(diskType, url);
};

const getLinkHealthRecord = (diskType: string, url: string) => {
  const key = getHealthStateKey(diskType, url);

  if (pendingHealthMap.value[key]) {
    return buildHealthRecord('pending', {
      checked_at: Date.now(),
      expires_at: Date.now() + 5 * 60 * 1000
    });
  }

  return healthCache.value[key] || null;
};

const getIndicatorState = (item: MergedResultItem): LinkHealthState => {
  if (!activeTab.value) return 'idle';
  return getLinkHealthRecord(activeTab.value, item.url)?.state || 'idle';
};

const getIndicatorTitle = (item: MergedResultItem) => {
  const record = getLinkHealthRecord(activeTab.value, item.url);
  if (!record) return '未检测';

  const labelMap: Record<LinkHealthState, string> = {
    idle: '未检测',
    pending: '检测中',
    ok: '链接有效',
    bad: '链接失效',
    locked: '需要提取码',
    unsupported: '暂不支持检测',
    uncertain: '检测结果不确定'
  };

  return record.summary ? `${labelMap[record.state]}: ${record.summary}` : labelMap[record.state];
};

const shouldShowIndicator = (item: MergedResultItem) => {
  return getIndicatorState(item) !== 'idle';
};

const getIndicatorClass = (item: MergedResultItem) => {
  const state = getIndicatorState(item);
  return {
    'health-indicator': true,
    'is-pending': state === 'pending',
    'is-ok': state === 'ok',
    'is-bad': state === 'bad',
    'is-locked': state === 'locked',
    'is-uncertain': state === 'uncertain',
    'is-unsupported': state === 'unsupported'
  };
};

const getHealthPriority = (item: MergedResultItem) => {
  const state = activeTab.value
    ? getLinkHealthRecord(activeTab.value, item.url)?.state || 'idle'
    : 'idle';

  switch (state) {
    case 'ok':
      return 0;
    case 'locked':
      return 1;
    case 'pending':
      return 2;
    case 'idle':
      return 3;
    case 'unsupported':
      return 4;
    case 'uncertain':
      return 5;
    case 'bad':
      return 6;
    default:
      return 3;
  }
};

const getRankedTabData = () => {
  if (!activeTab.value || !props.mergedResults[activeTab.value]) {
    return [];
  }

  const source = props.mergedResults[activeTab.value] || [];
  if (!detectionSettings.value.enabled || !supportedDetectionDiskTypes.has(activeTab.value)) {
    return source;
  }

  return source
    .map((item, index) => ({
      item,
      index,
      priority: getHealthPriority(item)
    }))
    .sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }

      return a.index - b.index;
    })
    .map(({ item }) => item);
};

const clearPendingForKeys = (keys: string[]) => {
  if (!keys.length) return;

  const nextMap = { ...pendingHealthMap.value };
  keys.forEach((key) => {
    delete nextMap[key];
    inFlightKeys.delete(key);
  });
  pendingHealthMap.value = nextMap;
};

const resetInspectionQueue = () => {
  queuedItems.clear();
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  pendingHealthMap.value = {};
  inFlightKeys.clear();
  currentViewToken.value = `${activeTab.value || 'empty'}-${Date.now()}`;
};

const scheduleFlush = () => {
  if (flushTimer || !detectionSettings.value.enabled) return;

  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flushInspectionQueue();
  }, 220);
};

const saveHealthResult = (diskType: string, url: string, record: LinkHealthRecord) => {
  saveCachedLinkHealth(diskType, url, record);
  healthCache.value = {
    ...healthCache.value,
    [getHealthStateKey(diskType, url)]: record
  };
};

const flushInspectionQueue = async () => {
  if (!detectionSettings.value.enabled || queuedItems.size === 0) return;

  const batchEntries = Array.from(queuedItems.entries()).slice(0, 6);
  batchEntries.forEach(([key]) => queuedItems.delete(key));

  const pendingMap = { ...pendingHealthMap.value };
  const items = batchEntries.map(([key, item]) => {
    pendingMap[key] = true;
    inFlightKeys.add(key);
    return item;
  });
  pendingHealthMap.value = pendingMap;

  try {
    const response = await inspectVisibleLinks(items, currentViewToken.value);

    response.results.forEach((result) => {
      const record = buildHealthRecord(result.state, {
        summary: result.summary,
        normalized_url: result.normalized_url,
        checked_at: result.checked_at,
        expires_at: result.expires_at
      });

      saveHealthResult(result.disk_type, result.url, record);
    });
  } catch (error) {
    const fallbackRecord = buildHealthRecord('uncertain', {
      summary: '检测服务暂不可用',
      checked_at: Date.now(),
      expires_at: Date.now() + 5 * 60 * 1000
    });

    items.forEach((item) => {
      saveHealthResult(item.disk_type, item.url, fallbackRecord);
    });
    console.error('链接检测失败:', error);
  } finally {
    clearPendingForKeys(batchEntries.map(([key]) => key));

    if (queuedItems.size > 0) {
      scheduleFlush();
    }
  }
};

const queueItemInspection = (item: MergedResultItem) => {
  if (!detectionSettings.value.enabled || !activeTab.value) return;
  if (!supportedDetectionDiskTypes.has(activeTab.value)) return;

  const key = getHealthStateKey(activeTab.value, item.url);
  if (queuedItems.has(key) || inFlightKeys.has(key)) return;

  const cached = healthCache.value[key];
  if (cached && cached.expires_at > Date.now()) return;

  queuedItems.set(key, {
    disk_type: activeTab.value,
    url: item.url,
    password: item.password
  });
  scheduleFlush();
};

const rebuildVisibilityObserver = () => {
  if (visibilityObserver) {
    visibilityObserver.disconnect();
    visibilityObserver = null;
  }

  if (!detectionSettings.value.enabled || !listContainerRef.value || !activeTab.value) {
    return;
  }

  visibilityObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting || entry.intersectionRatio < 0.35) return;

        const index = Number((entry.target as HTMLElement).dataset.visibleIndex ?? '-1');
        if (Number.isNaN(index) || index < 0) return;

        const item = visibleItems.value[index];
        if (!item) return;

        queueItemInspection(item);
      });
    },
    {
      root: listContainerRef.value,
      threshold: [0.35, 0.6]
    }
  );

  listContainerRef.value
    .querySelectorAll<HTMLElement>('.result-item')
    .forEach((element) => visibilityObserver?.observe(element));
};

// 监听结果变化，智能选择标签
watch(
  () => props.mergedResults,
  (newVal) => {
    if (newVal && Object.keys(newVal).length > 0) {
      nextTick(() => {
        // 如果当前没有选中标签，或者当前选中的标签在新数据中不存在，则选择第一个标签
        const availableTypes = Object.keys(newVal);
        if (!activeTab.value || !availableTypes.includes(activeTab.value)) {
          activeTab.value = availableTypes[0] || '';
        }
        updateCurrentTabData();
        resetInspectionQueue();
      });
    } else {
      // 当没有结果时，清空当前数据
      activeTab.value = '';
      currentTabData.value = [];
      visibleItems.value = [];
      resetInspectionQueue();
    }
  },
  { immediate: true, deep: true }
);

// 监听标签页切换
watch(
  () => activeTab.value,
  () => {
    currentPage.value = 1;
    updateCurrentTabData();
    resetInspectionQueue();
  }
);

watch(
  () => detectionSettings.value.enabled,
  (enabled) => {
    if (!enabled) {
      resetInspectionQueue();
      updateCurrentTabData();
      return;
    }

    updateCurrentTabData();
  }
);

watch(
  () => [
    activeTab.value,
    detectionSettings.value.enabled,
    Object.keys(pendingHealthMap.value).sort().join('|'),
    Object.entries(healthCache.value)
      .map(([key, record]) => `${key}:${record.state}:${record.checked_at}`)
      .sort()
      .join('|')
  ],
  () => {
    if (!activeTab.value) return;
    updateCurrentTabData();
  }
);

watch(
  () => [
    activeTab.value,
    detectionSettings.value.enabled,
    visibleItems.value.map((item) => `${item.url}|${item.password || ''}`).join('||')
  ],
  () => {
    nextTick(() => {
      rebuildVisibilityObserver();
    });
  }
);

// 更新当前标签页数据
const updateCurrentTabData = () => {
  if (!activeTab.value || !props.mergedResults[activeTab.value]) {
    currentTabData.value = [];
    visibleItems.value = [];
    return;
  }
  
  currentTabData.value = getRankedTabData();
  loadMoreItems();
};

// 加载更多数据
const loadMoreItems = () => {
  const start = 0;
  const end = currentPage.value * PAGE_SIZE;
  visibleItems.value = currentTabData.value.slice(start, end);
};

// 处理滚动加载更多
const handleScroll = (e: Event) => {
  const target = e.target as HTMLElement;
  const scrollBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
  
  // 当滚动到底部100px时，加载更多数据
  if (scrollBottom < 100 && visibleItems.value.length < currentTabData.value.length) {
    currentPage.value++;
    loadMoreItems();
  }
};

// 打开链接
const openLink = (url: string) => {
  window.open(url, '_blank', 'noopener,noreferrer');
};

// ===== 用内置下载中心下载（磁力）=====
// 点击行动点 → 本页弹层原地处理（不打断搜索+下载）：自动解析磁力内容 →
// 文件勾选确认 / 改名 / 选保存目录 → 创建任务。全流程调 media core API
// （同源 /downloads/api/…），完成后留在搜索页 toast 提示，绝不静默直投、不跳页。
const isMagnetUrl = (url: string) => /^magnet:\?/i.test((url || '').trim());
const getMagnetDisplayName = (url: string): string => {
  try {
    return (new URL(url).searchParams.get('dn') || '').trim();
  } catch {
    return '';
  }
};

// 内置保存目录（与 media core 下载中心表单同一套内置 key）
const DL_FOLDERS = [
  { value: 'bt', label: '磁力下载 (bt)' },
  { value: 'files', label: '普通文件 (files)' },
  { value: 'video', label: '视频下载 (video)' },
];

interface MagnetDialogState {
  visible: boolean;
  url: string;
  resolving: boolean;
  error: string;
  meta: { path: string; name: string; size: number; files: Array<{ index: number; path: string; size: number }> | null } | null;
  name: string;
  selected: number[];
  folder: string;
  creating: boolean;
}
const magnetDialog = ref<MagnetDialogState>({
  visible: false,
  url: '',
  resolving: false,
  error: '',
  meta: null,
  name: '',
  selected: [],
  folder: 'bt',
  creating: false,
});

const resolveMagnet = async (url: string) => {
  magnetDialog.value.resolving = true;
  magnetDialog.value.error = '';
  try {
    const res = await fetch('/downloads/api/downloads/resolve-magnet', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.data) {
      throw new Error(payload?.message || `HTTP ${res.status}`);
    }
    magnetDialog.value.meta = payload.data;
    magnetDialog.value.name = payload.data.name || getMagnetDisplayName(url);
    magnetDialog.value.selected = payload.data.files?.map((f: { index: number }) => f.index) ?? [];
  } catch (err) {
    magnetDialog.value.meta = null;
    magnetDialog.value.error = (err instanceof Error && err.message) || '磁力解析失败，请稍后重试';
  } finally {
    magnetDialog.value.resolving = false;
  }
};

const downloadViaCenter = (item: MergedResultItem) => {
  const magnet = item.url.trim();
  magnetDialog.value = {
    ...magnetDialog.value,
    visible: true,
    url: magnet,
    resolving: false,
    error: '',
    meta: null,
    name: getMagnetDisplayName(magnet),
    selected: [],
    folder: 'bt',
    creating: false,
  };
  void resolveMagnet(magnet);
};

const closeMagnetDialog = () => {
  magnetDialog.value.visible = false;
};

const toggleMagnetFile = (index: number, checked: boolean) => {
  const cur = magnetDialog.value.selected;
  magnetDialog.value.selected = checked
    ? [...cur, index]
    : cur.filter((i) => i !== index);
};

const magnetAllSelected = computed(() => {
  const files = magnetDialog.value.meta?.files;
  return !!files && magnetDialog.value.selected.length === files.length;
});

const magnetSelectAll = (checked: boolean) => {
  magnetDialog.value.selected = checked
    ? (magnetDialog.value.meta?.files ?? []).map((f) => f.index)
    : [];
};

// 勾选 → aria2 --select-file 索引串（全选/未选 = 全部文件，不传）
const deriveSelectFile = () => {
  const files = magnetDialog.value.meta?.files;
  if (!files || files.length === 0) return '';
  const sel = magnetDialog.value.selected;
  if (sel.length === 0 || sel.length === files.length) return '';
  return [...sel].sort((a, b) => a - b).join(',');
};

// 原地下载结果轻提示（2.6s 自动消失）
const dlToast = ref('');
let dlToastTimer: number | null = null;
const setDlToast = (text: string) => {
  dlToast.value = text;
  if (dlToastTimer) window.clearTimeout(dlToastTimer);
  dlToastTimer = window.setTimeout(() => {
    dlToast.value = '';
  }, 2600);
};

const createMagnetTask = async () => {
  const st = magnetDialog.value;
  if (!st.meta) return;
  st.creating = true;
  try {
    const res = await fetch('/downloads/api/downloads', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tasks: [{
          name: st.name.trim() || st.meta.name,
          type: 'bt',
          url: st.meta.path,
          folder: st.folder,
          selectFile: deriveSelectFile() || undefined,
        }],
        startDownload: true,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    st.visible = false;
    setDlToast('已开始下载，可在下载中心「磁力」tab 查看进度');
  } catch (err) {
    console.warn('创建磁力下载任务失败:', err);
    st.error = '创建下载任务失败，请稍后重试';
  } finally {
    st.creating = false;
  }
};

// 通用复制函数（支持降级处理）
const copyToClipboard = async (text: string): Promise<boolean> => {
  // 方法1: 优先使用现代 Clipboard API（安全上下文可用）
  if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.warn('Clipboard API 失败，尝试降级方案:', err);
    }
  }
  
  // 方法2: 降级使用传统 execCommand 方法 (兼容HTTP)
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    
    const successful = document.execCommand('copy');
    document.body.removeChild(textarea);
    
    return successful;
  } catch (err) {
    console.error('复制失败:', err);
    return false;
  }
};

const clearCopyFeedbackTimers = () => {
  if (linkCopyTimer.value) {
    clearTimeout(linkCopyTimer.value);
    linkCopyTimer.value = null;
  }

  if (passwordCopyTimer.value) {
    clearTimeout(passwordCopyTimer.value);
    passwordCopyTimer.value = null;
  }
};

const clearListPasswordFeedbackTimer = () => {
  if (listPasswordFeedbackTimer.value) {
    clearTimeout(listPasswordFeedbackTimer.value);
    listPasswordFeedbackTimer.value = null;
  }
};

const resetCopyStatus = () => {
  clearCopyFeedbackTimers();
  linkCopyStatus.value = 'idle';
  passwordCopyStatus.value = 'idle';
};

const getResultItemKey = (item: MergedResultItem, index: number) => {
  return `${index}-${item.url}-${item.password ?? ''}`;
};

const getListPasswordStatus = (item: MergedResultItem, index: number) => {
  if (listPasswordFeedbackKey.value !== getResultItemKey(item, index)) {
    return 'idle';
  }

  return listPasswordFeedbackStatus.value;
};

const copyListPassword = async (item: MergedResultItem, index: number) => {
  if (!item.password) return;

  const success = await copyToClipboard(item.password);

  clearListPasswordFeedbackTimer();
  listPasswordFeedbackKey.value = getResultItemKey(item, index);
  listPasswordFeedbackStatus.value = success ? 'success' : 'error';
  listPasswordFeedbackTimer.value = window.setTimeout(() => {
    listPasswordFeedbackKey.value = '';
    listPasswordFeedbackStatus.value = 'idle';
    listPasswordFeedbackTimer.value = null;
  }, 1800);
};

const setCopyStatus = (type: 'link' | 'password', success: boolean) => {
  const status = success ? 'success' : 'error';
  const timerRef = type === 'link' ? linkCopyTimer : passwordCopyTimer;
  const statusRef = type === 'link' ? linkCopyStatus : passwordCopyStatus;

  if (timerRef.value) {
    clearTimeout(timerRef.value);
  }

  statusRef.value = status;
  timerRef.value = window.setTimeout(() => {
    statusRef.value = 'idle';
    timerRef.value = null;
  }, 1800);
};

const openTitleDetail = (item: MergedResultItem) => {
  detailItem.value = item;
  resetCopyStatus();
};

const closeTitleDetail = () => {
  detailItem.value = null;
  resetCopyStatus();
};

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && detailItem.value) {
    closeTitleDetail();
  }
};

const copyDetailField = async (type: 'link' | 'password') => {
  if (!detailItem.value) return;

  const text = type === 'link' ? detailItem.value.url : detailItem.value.password;
  if (!text) return;

  const success = await copyToClipboard(text);
  setCopyStatus(type, success);
};

const getCopyButtonText = (type: 'link' | 'password') => {
  const status = type === 'link' ? linkCopyStatus.value : passwordCopyStatus.value;

  if (status === 'success') {
    return '复制成功';
  }

  if (status === 'error') {
    return '复制失败';
  }

  return type === 'link' ? '复制链接' : '复制密码';
};

const getDetailPasswordText = () => {
  if (passwordCopyStatus.value === 'success') {
    return '复制成功';
  }

  if (passwordCopyStatus.value === 'error') {
    return '复制失败';
  }

  return detailItem.value?.password ?? '';
};

// 格式化日期时间
const formatDateTime = (dateTimeStr?: string) => {
  if (!dateTimeStr) return '';
  
  try {
    const date = new Date(dateTimeStr);
    return date.toLocaleString('zh-CN', { 
      year: 'numeric', 
      month: '2-digit', 
      day: '2-digit'
    });
  } catch (e) {
    return dateTimeStr;
  }
};

// 获取网盘类型中文名称
const getDiskName = (type: string) => {
  return getDiskTypeName(type);
};

watch(detailItem, (newVal) => {
  document.body.style.overflow = newVal ? 'hidden' : '';
});

onMounted(() => {
  hydrateHealthCache();
  reloadDetectionSettings();
  window.addEventListener('keydown', handleKeydown);
  window.addEventListener('storage', reloadDetectionSettings);
  window.addEventListener('config:saved', reloadDetectionSettings);
  nextTick(() => {
    rebuildVisibilityObserver();
  });
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
  window.removeEventListener('storage', reloadDetectionSettings);
  window.removeEventListener('config:saved', reloadDetectionSettings);
  document.body.style.overflow = '';
  clearCopyFeedbackTimers();
  clearListPasswordFeedbackTimer();
  if (visibilityObserver) {
    visibilityObserver.disconnect();
    visibilityObserver = null;
  }
  resetInspectionQueue();
});

</script>

<template>
  <div class="results-wrapper">
    <!-- 初始状态 -->
    <div v-if="showInitialState" class="empty-state">
      <div class="empty-icon">
        <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
        </svg>
      </div>
      <p class="empty-title">输入关键词开始搜索</p>
    </div>
    
    <!-- 搜索中状态 -->
    <div v-else-if="showSearchingState" class="searching-state">
      <div class="searching-icon">
        <div class="searching-spinner"></div>
      </div>
      <p class="searching-title">正在搜索资源中...</p>
      <p class="searching-subtitle">资源搜索可能需要一些时间，请耐心等待</p>
    </div>
    
    <!-- 搜索无结果状态 -->
    <div v-else-if="showEmptyState" class="empty-state">
      <div class="empty-icon">
        <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
      </div>
      <p class="empty-title">未找到相关资源</p>
      <p class="empty-subtitle">请尝试其他关键词</p>
    </div>
    
    <!-- 搜索结果 -->
    <div v-else-if="hasResults" class="results-container">
      <!-- 标签页 -->
      <div class="tabs">
        <button 
          v-for="type in diskTypes" 
          :key="type"
          class="tab-button"
          :class="{ active: activeTab === type }"
          @click="activeTab = type"
        >
          {{ getDiskName(type) }} ({{ mergedResults[type]?.length || 0 }})
        </button>
      </div>
      
      <!-- 内容区域 -->
      <div class="tab-content">
        <div v-if="!currentTabData.length" class="empty-tab">
          <p>暂无数据</p>
        </div>
        
        <div ref="listContainerRef" v-else class="result-list" @scroll="handleScroll">
          <div 
            v-for="(item, index) in visibleItems" 
            :key="index" 
            class="result-item"
            :data-visible-index="index"
          >
            <!-- 标题行（移动端单独占一行） -->
            <div class="result-header">
              <button
                type="button"
                class="result-title-button"
                :title="item.note"
                @click="openTitleDetail(item)"
              >
                <span class="result-title-row">
                  <span class="result-title">{{ item.note }}</span>
                  <span
                    v-if="shouldShowIndicator(item)"
                    :class="getIndicatorClass(item)"
                    :title="getIndicatorTitle(item)"
                  ></span>
                </span>
              </button>
              <!-- 桌面端：数据来源+时间与标题同行 -->
              <div class="result-meta desktop-only" v-if="item.source || item.datetime">
                <span v-if="item.source" class="result-source">{{ item.source }}</span>
                <span v-if="item.source && item.datetime" class="meta-separator">·</span>
                <span v-if="item.datetime" class="result-date">{{ formatDateTime(item.datetime) }}</span>
              </div>
            </div>
            
            <!-- 移动端：数据来源+时间单独一行 -->
            <div class="result-meta mobile-only" v-if="item.source || item.datetime">
              <span v-if="item.source" class="result-source">{{ item.source }}</span>
              <span v-if="item.source && item.datetime" class="meta-separator">·</span>
              <span v-if="item.datetime" class="result-date">{{ formatDateTime(item.datetime) }}</span>
            </div>
            
            <!-- 第二行：链接和提取码 -->
            <div class="result-row">
              <div class="result-link" @click="openLink(item.url)">{{ item.url }}</div>
              <!-- 磁力链接：行动点 → 唤起下载中心新建下载弹层（先确认再下载） -->
              <button
                v-if="isMagnetUrl(item.url)"
                type="button"
                class="dl-center-icon-btn"
                title="用内置下载中心下载（磁力 / BT）"
                @click="downloadViaCenter(item)"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              </button>
              <button
                v-if="item.password"
                type="button"
                class="result-password"
                :class="{
                  copied: getListPasswordStatus(item, index) === 'success',
                  'copy-failed': getListPasswordStatus(item, index) === 'error'
                }"
                @click="copyListPassword(item, index)"
              >
                <template v-if="getListPasswordStatus(item, index) === 'success'">
                  复制成功
                </template>
                <template v-else-if="getListPasswordStatus(item, index) === 'error'">
                  复制失败
                </template>
                <template v-else>
                  提取码: <span class="password-value">{{ item.password }}</span>
                </template>
              </button>
            </div>
          </div>
          
          <div v-if="visibleItems.length < currentTabData.length" class="loading-more">
            <div class="loading-spinner"></div>
            <span>加载更多...</span>
          </div>
        </div>
      </div>
      
      <!-- 持续搜索提示 -->
      <div v-if="isActivelySearching" class="ongoing-search-hint">
        <div class="hint-spinner"></div>
        <span>正在持续搜索更多资源...</span>
      </div>
    </div>

    <Teleport to="body">
      <Transition name="detail-fade">
        <div v-if="detailItem" class="detail-overlay" @click="closeTitleDetail">
          <div class="detail-dialog" @click.stop>
            <div class="detail-header">
              <div class="detail-heading">
                <p class="detail-label">完整标题</p>
                <h3 class="detail-title">{{ detailItem.note }}</h3>
              </div>
              <button
                type="button"
                class="detail-close"
                aria-label="关闭标题详情"
                @click="closeTitleDetail"
              >
                <svg class="detail-close-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
              </button>
            </div>

            <div v-if="detailItem.source || detailItem.datetime" class="detail-meta">
              <span v-if="detailItem.source" class="result-source">{{ detailItem.source }}</span>
              <span v-if="detailItem.source && detailItem.datetime" class="meta-separator">·</span>
              <span v-if="detailItem.datetime" class="result-date">{{ formatDateTime(detailItem.datetime) }}</span>
            </div>

            <div class="detail-actions">
              <button
                type="button"
                class="detail-copy-btn"
                :class="{
                  success: linkCopyStatus === 'success',
                  error: linkCopyStatus === 'error'
                }"
                @click="copyDetailField('link')"
              >
                {{ getCopyButtonText('link') }}
              </button>

              <button
                v-if="detailItem.password"
                type="button"
                class="detail-password-action"
                :class="{
                  success: passwordCopyStatus === 'success',
                  error: passwordCopyStatus === 'error'
                }"
                @click="copyDetailField('password')"
              >
                <template v-if="passwordCopyStatus === 'idle'">
                  <span class="detail-password-label">提取码:</span>
                  <span class="detail-password-content">{{ detailItem.password }}</span>
                </template>
                <template v-else>
                  {{ getDetailPasswordText() }}
                </template>
              </button>
            </div>

            <button
              type="button"
              class="detail-link-preview"
              :title="detailItem.url"
              @click="openLink(detailItem.url)"
            >
              {{ detailItem.url }}
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 磁力下载确认弹层：原地解析（文件勾选 / 改名 / 选目录）→ 创建任务，
         不跳转下载中心，搜索+下载行为不中断 -->
    <Teleport to="body">
      <Transition name="detail-fade">
        <div v-if="magnetDialog.visible" class="detail-overlay" @click="closeMagnetDialog">
          <div class="detail-dialog magnet-dialog" @click.stop>
            <div class="detail-header">
              <div class="detail-heading">
                <p class="magnet-heading">下载到内置下载中心（磁力 / BT）</p>
                <p class="magnet-url-line" :title="magnetDialog.url">{{ magnetDialog.url }}</p>
              </div>
              <button type="button" class="detail-close" aria-label="关闭" @click="closeMagnetDialog">
                <svg class="detail-close-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
              </button>
            </div>

            <!-- 解析中 -->
            <div v-if="magnetDialog.resolving" class="magnet-resolving">
              <span class="magnet-spinner"></span>
              <span>正在解析磁力内容，连接网络节点中（最长约 45 秒）…</span>
            </div>

            <!-- 解析失败 -->
            <div v-else-if="magnetDialog.error && !magnetDialog.meta" class="magnet-error-card">
              <div class="magnet-error-main">
                <p class="magnet-error-text">{{ magnetDialog.error }}</p>
                <p class="magnet-error-hint">磁力资源可能已失效，可稍后重试或直接复制链接到其它下载器</p>
              </div>
              <div class="magnet-error-actions">
                <button type="button" class="magnet-btn magnet-btn-ghost" @click="closeMagnetDialog">取消</button>
                <button type="button" class="magnet-btn magnet-btn-primary" @click="resolveMagnet(magnetDialog.url)">重试解析</button>
              </div>
            </div>

            <!-- 解析成功：内容勾选 / 改名 / 选目录 → 创建 -->
            <template v-else-if="magnetDialog.meta">
              <div v-if="magnetDialog.error" class="magnet-error-inline">{{ magnetDialog.error }}</div>
              <div class="magnet-form-row">
                <label class="magnet-label">任务名称</label>
                <input v-model="magnetDialog.name" type="text" class="magnet-input" placeholder="留空使用种子名" />
              </div>
              <div v-if="magnetDialog.meta.files && magnetDialog.meta.files.length > 0" class="magnet-files">
                <label class="magnet-check-all">
                  <input
                    type="checkbox"
                    :checked="magnetAllSelected"
                    @change="magnetSelectAll(($event.target as HTMLInputElement).checked)"
                  />
                  全选（{{ magnetDialog.selected.length }}/{{ magnetDialog.meta.files.length }}）
                </label>
                <div class="magnet-file-list">
                  <label v-for="f in magnetDialog.meta.files" :key="f.index" class="magnet-file">
                    <input
                      type="checkbox"
                      :checked="magnetDialog.selected.includes(f.index)"
                      @change="toggleMagnetFile(f.index, ($event.target as HTMLInputElement).checked)"
                    />
                    <span class="magnet-file-path" :title="f.path">{{ f.path }}</span>
                    <span class="magnet-file-size">{{ f.size }} B</span>
                  </label>
                </div>
              </div>
              <div class="magnet-form-row">
                <label class="magnet-label">保存目录</label>
                <select v-model="magnetDialog.folder" class="magnet-input">
                  <option v-for="f in DL_FOLDERS" :key="f.value" :value="f.value">{{ f.label }}</option>
                </select>
              </div>
              <div class="magnet-actions">
                <button type="button" class="magnet-btn magnet-btn-ghost" :disabled="magnetDialog.creating" @click="closeMagnetDialog">取消</button>
                <button type="button" class="magnet-btn magnet-btn-primary" :disabled="magnetDialog.creating" @click="createMagnetTask">
                  {{ magnetDialog.creating ? '创建中…' : '开始下载' }}
                </button>
              </div>
            </template>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 原地下载结果轻提示 -->
    <Teleport to="body">
      <Transition name="detail-fade">
        <div v-if="dlToast" class="dl-toast">{{ dlToast }}</div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.results-wrapper {
  width: 100%;
}

.empty-state, .searching-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem 1rem;
  text-align: center;
  background-color: #fff;
  border-radius: 0.75rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.empty-icon {
  width: 4rem;
  height: 4rem;
  background-color: #f3f4f6;
  border-radius: 9999px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1rem;
}

.empty-icon .icon {
  width: 2rem;
  height: 2rem;
  color: #9ca3af;
}

.searching-icon {
  width: 4rem;
  height: 4rem;
  background-color: #f0f9ff;
  border-radius: 9999px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1rem;
}

.searching-spinner {
  width: 2rem;
  height: 2rem;
  border: 3px solid #e5e7eb;
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.empty-title, .searching-title {
  font-size: 1.125rem;
  font-weight: 500;
  color: #4b5563;
  margin-bottom: 0.5rem;
}

.empty-subtitle, .searching-subtitle {
  font-size: 0.875rem;
  color: #6b7280;
}

.results-container {
  background-color: #fff;
  border-radius: 0.75rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  overflow: hidden;
}

.tabs {
  display: flex;
  overflow-x: auto;
  overflow-y: hidden;
  border-bottom: 1px solid #e5e7eb;
  background-color: #f9fafb;
  padding: 0 1rem;
  scrollbar-width: thin;
}

.tab-button {
  padding: 0.75rem 1rem;
  white-space: nowrap;
  font-size: 0.875rem;
  color: #4b5563;
  background: transparent;
  border: none;
  cursor: pointer;
  position: relative;
  transition: all 0.2s ease;
}

.tab-button:hover {
  color: #3b82f6;
}

.tab-button.active {
  color: #3b82f6;
  font-weight: 500;
}

.tab-button.active::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 0;
  width: 100%;
  height: 2px;
  background-color: #3b82f6;
}

.tab-content {
  min-height: 300px;
}

.empty-tab {
  padding: 3rem 1rem;
  text-align: center;
  color: #6b7280;
}

.result-list {
  max-height: 600px;
  overflow-y: auto;
  padding: 1rem;
}

.result-item {
  padding: 0.75rem;
  border-bottom: 1px solid #f3f4f6;
  transition: background-color 0.2s ease;
}

.result-item:hover {
  background-color: #f9fafb;
}

.result-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.result-row:last-child {
  margin-bottom: 0;
}

.result-title-button {
  appearance: none;
  border: none;
  background: transparent;
  padding: 0;
  margin: 0;
  width: 100%;
  min-width: 0;
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: pointer;
}

.result-title-button:focus-visible {
  outline: 2px solid #93c5fd;
  outline-offset: 2px;
  border-radius: 0.25rem;
}

.result-title {
  display: block;
  width: 100%;
  font-size: 0.95rem;
  font-weight: 500;
  color: #111827;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-title-row {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  min-width: 0;
  gap: 0.45rem;
}

.health-indicator {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 9999px;
  flex: 0 0 auto;
  background: #cbd5e1;
}

.health-indicator.is-pending {
  background: #60a5fa;
  animation: pulse-dot 1.1s ease-in-out infinite;
}

.health-indicator.is-ok {
  background: #22c55e;
}

.health-indicator.is-bad {
  background: #ef4444;
}

.health-indicator.is-locked {
  background: #f59e0b;
}

.health-indicator.is-uncertain,
.health-indicator.is-unsupported {
  background: #94a3b8;
}

/* 标题行布局 */
.result-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  width: 100%;
}

/* 桌面端：数据来源与标题同行 */
.result-meta.desktop-only {
  display: flex;
  align-items: center;
  margin-left: 0.75rem;
  white-space: nowrap;
  flex-shrink: 0;
}

/* 移动端：数据来源单独一行 */
.result-meta.mobile-only {
  display: none;
  align-items: center;
  margin-top: 0.375rem;
  margin-bottom: 0.25rem;
}

/* 响应式显示控制 */
@media (max-width: 768px) {
  .desktop-only {
    display: none !important;
  }
  
  .mobile-only {
    display: flex !important;
  }
  
  .result-header {
    flex-direction: column;
    align-items: flex-start;
  }
  
  .result-title {
    width: 100%;
    margin-bottom: 0;
  }
  
  /* 移动端数据来源标签优化 */
  .result-source {
    font-size: 0.6875rem;
    padding: 0.0625rem 0.25rem;
  }
}

.result-source {
  font-size: 0.75rem;
  color: #3b82f6;
  font-weight: 500;
  background-color: #eff6ff;
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
  border: 1px solid #bfdbfe;
}

.meta-separator {
  font-size: 0.75rem;
  color: #9ca3af;
  margin: 0 0.375rem;
}

.result-date {
  font-size: 0.75rem;
  color: #6b7280;
}

.result-link {
  font-size: 0.875rem;
  color: #3b82f6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  flex: 1;
}

.result-link:hover {
  text-decoration: underline;
}

.result-password {
  appearance: none;
  border: none;
  background: transparent;
  padding: 0;
  font-size: 0.75rem;
  color: #6b7280;
  margin-left: 0.75rem;
  white-space: nowrap;
  cursor: pointer;
  transition: all 0.2s ease;
}

.result-password:hover {
  color: #4b5563;
}

.result-password:focus-visible {
  outline: 2px solid #93c5fd;
  outline-offset: 2px;
  border-radius: 0.25rem;
}

.result-password.copied {
  color: #059669;
  display: inline-flex;
  align-items: center;
  padding: 0.3rem 0.7rem;
  border-radius: 9999px;
  background: #ecfdf5;
  border: 1px solid #d1fae5;
  line-height: 1;
}

.result-password.copy-failed {
  color: #dc2626;
}

.password-value {
  color: #10b981;
  font-weight: 500;
}

/* 磁力行内行动点：唤起下载中心新建弹层（图标按钮，不占文字空间） */
.dl-center-icon-btn {
  appearance: none;
  border: 1px solid #e5e7eb;
  background: #fff;
  color: #4b5563;
  width: 26px;
  height: 26px;
  margin-left: 0.5rem;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.dl-center-icon-btn:hover {
  color: #6366f1;
  border-color: #c7d2fe;
  background: #eef2ff;
}

.dl-center-icon-btn:focus-visible {
  outline: 2px solid #93c5fd;
  outline-offset: 2px;
}

/* ---- 磁力下载确认弹层（原地处理，不跳转） ---- */
.magnet-dialog {
  max-width: 480px;
  width: calc(100vw - 32px);
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px 22px;
  box-sizing: border-box;
}

.magnet-heading {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 700;
  color: #111827;
  line-height: 1.4;
}

/* 磁力链接：小号弱化展示，单行截断（完整链接见 title 提示） */
.magnet-url-line {
  margin: 0;
  font-size: 12px;
  font-weight: 400;
  color: #9ca3af;
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 360px;
}

.magnet-resolving {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 13px;
  color: #6b7280;
  padding: 26px 0;
}

.magnet-spinner {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid #c7d2fe;
  border-top-color: #6366f1;
  animation: magnetSpin 0.8s linear infinite;
  flex-shrink: 0;
}

@keyframes magnetSpin {
  to { transform: rotate(360deg); }
}

/* 解析失败：错误卡片 + 右对齐操作按钮 */
.magnet-error-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px 16px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 12px;
}

.magnet-error-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.magnet-error-text {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: #dc2626;
}

.magnet-error-hint {
  margin: 0;
  font-size: 12px;
  color: #9ca3af;
  line-height: 1.5;
}

.magnet-error-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.magnet-error-inline {
  padding: 8px 10px;
  background: #fef2f2;
  border-radius: 8px;
  border: 1px solid #fecaca;
  font-size: 12.5px;
  color: #dc2626;
}

/* 弹层内统一按钮：ghost 次要 / primary 主操作 */
.magnet-btn {
  appearance: none;
  height: 34px;
  padding: 0 16px;
  font-size: 13px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid transparent;
}

.magnet-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.magnet-btn-ghost {
  background: #fff;
  border-color: #e5e7eb;
  color: #6b7280;
}

.magnet-btn-ghost:hover:not(:disabled) {
  color: #374151;
  border-color: #d1d5db;
}

.magnet-btn-primary {
  background: #6366f1;
  color: #fff;
  border: none;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
}

.magnet-btn-primary:hover:not(:disabled) {
  background: #4f46e5;
}

.magnet-form-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.magnet-label {
  width: 64px;
  flex-shrink: 0;
  font-size: 13px;
  color: #374151;
}

.magnet-input {
  flex: 1;
  min-width: 0;
  height: 34px;
  padding: 0 10px;
  font-size: 13px;
  color: #374151;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  outline: none;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.magnet-input:focus {
  border-color: #a5b4fc;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12);
}

.magnet-files {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.magnet-check-all {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: #374151;
  cursor: pointer;
}

.magnet-file-list {
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.magnet-file {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  cursor: pointer;
  color: #4b5563;
}

.magnet-file-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.magnet-file-size {
  flex-shrink: 0;
  color: #9ca3af;
  font-variant-numeric: tabular-nums;
}

.magnet-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 2px;
}

.dl-toast {
  position: fixed;
  left: 50%;
  bottom: 32px;
  transform: translateX(-50%);
  z-index: 10001;
  padding: 10px 20px;
  border-radius: 999px;
  background: rgba(13, 18, 32, 0.88);
  color: #fff;
  font-size: 13px;
  box-shadow: 0 18px 52px rgba(23, 32, 56, 0.2);
  pointer-events: none;
}

.detail-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(8px);
}

.detail-dialog {
  width: min(100%, 640px);
  max-height: min(80vh, 680px);
  overflow-y: auto;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 1rem;
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.2);
}

.detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.25rem 1.25rem 0.75rem;
}

.detail-heading {
  min-width: 0;
}

.detail-label {
  margin: 0 0 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: #6b7280;
}

.detail-title {
  margin: 0;
  font-size: 1rem;
  line-height: 1.7;
  font-weight: 600;
  color: #111827;
  word-break: break-word;
}

.detail-close {
  appearance: none;
  border: 1px solid #e5e7eb;
  background: #fff;
  color: #6b7280;
  width: 2rem;
  height: 2rem;
  border-radius: 9999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.detail-close:hover {
  color: #111827;
  border-color: #cbd5e1;
  background: #f8fafc;
}

.detail-close:focus-visible,
.detail-copy-btn:focus-visible,
.detail-password-action:focus-visible,
.detail-link-preview:focus-visible {
  outline: 2px solid #93c5fd;
  outline-offset: 2px;
}

.detail-close-icon {
  width: 1rem;
  height: 1rem;
}

.detail-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.375rem;
  padding: 0 1.25rem 1rem;
}

.detail-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0 1.25rem 0.875rem;
  min-width: 0;
}

.detail-password-action {
  appearance: none;
  border: none;
  background: transparent;
  padding: 0;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 0.375rem;
  min-width: 0;
  color: #6b7280;
}

.detail-password-action:hover {
  color: #047857;
}

.detail-password-action.success {
  color: #059669;
  padding: 0.3rem 0.7rem;
  border-radius: 9999px;
  background: #ecfdf5;
  border: 1px solid #d1fae5;
  line-height: 1;
}

.detail-password-action.error {
  color: #dc2626;
}

.detail-copy-btn {
  appearance: none;
  border: none;
  background: transparent;
  color: #2563eb;
  padding: 0;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.detail-copy-btn:hover {
  color: #1d4ed8;
}

.detail-copy-btn.success {
  color: #059669;
  padding: 0.3rem 0.7rem;
  border-radius: 9999px;
  background: #ecfdf5;
  border: 1px solid #d1fae5;
  line-height: 1;
}

.detail-copy-btn.error {
  color: #dc2626;
}

.detail-password-label {
  color: inherit;
  flex-shrink: 0;
}

.detail-password-content {
  color: #10b981;
  max-width: 9rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-link-preview {
  appearance: none;
  display: block;
  width: calc(100% - 2.5rem);
  margin: 0 1.25rem 1.25rem;
  padding: 0;
  text-align: left;
  border: none;
  background: transparent;
  cursor: pointer;
  color: #3b82f6;
  font-size: 0.875rem;
  line-height: 1.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: all 0.2s ease;
}

.detail-link-preview:hover {
  text-decoration: underline;
}

.detail-fade-enter-active,
.detail-fade-leave-active {
  transition: opacity 0.2s ease;
}

.detail-fade-enter-from,
.detail-fade-leave-to {
  opacity: 0;
}

.loading-more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 1rem;
  color: #6b7280;
  font-size: 0.875rem;
}

.loading-spinner, .hint-spinner {
  width: 1rem;
  height: 1rem;
  border: 2px solid #e5e7eb;
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.ongoing-search-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.75rem;
  background-color: #f0f9ff;
  color: #3b82f6;
  font-size: 0.875rem;
  border-top: 1px solid #e5e7eb;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes pulse-dot {
  0%,
  100% {
    opacity: 0.55;
    transform: scale(0.95);
  }
  50% {
    opacity: 1;
    transform: scale(1.08);
  }
}

@media (max-width: 768px) {
  .results-wrapper {
    width: 100%;
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
  }

  .results-container {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
  }

  .tabs {
    flex: 0 0 auto;
  }

  .tab-content {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
  }

  .result-list {
    flex: 1 1 auto;
    max-height: none;
    min-height: 0;
    padding: 0.5rem;
    overflow-y: auto;
    scroll-padding-bottom: 1rem;
  }
  
  .result-item {
    padding: 0.75rem 0.5rem;
  }
  
  .tab-button {
    padding: 0.5rem 0.75rem;
    font-size: 0.75rem;
  }

  .detail-dialog {
    width: 100%;
    max-height: 85vh;
    border-radius: 1rem;
  }

  .detail-header {
    padding: 1rem 1rem 0.75rem;
  }

  .detail-meta,
  .detail-actions {
    padding-left: 1rem;
    padding-right: 1rem;
  }

  .detail-link-preview {
    width: calc(100% - 2rem);
    margin-left: 1rem;
    margin-right: 1rem;
  }
}
</style>
