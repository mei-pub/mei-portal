import { useMemoizedFn } from "ahooks";
import {
  App,
  Badge,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Tag,
  Typography,
} from "antd";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import { PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { http } from "@/utils";

/**
 * RSS 订阅面板（对齐 FluxDown 控制台的 RSS 管理能力，风格沿用主应用）：
 * 源 CRUD（含规则：包含/排除模式、智能剧集归一、体积上下限）、feed 校验
 * 预览、条目列表（强制下载/忽略/全部已读）、手动刷新。数据全部经
 * /api/downloads/rss/*（core 代理 daemon.rss.*）。
 */

interface RssSource {
  sourceId: string;
  url: string;
  name: string;
  enabled: boolean;
  autoDownload: boolean;
  startPaused: boolean;
  saveDir: string;
  intervalMinutes: number;
  includePattern: string;
  excludePattern: string;
  useRegex: boolean;
  smartEpisode: boolean;
  sizeMinBytes: number;
  sizeMaxBytes: number;
  maxPerFetch: number;
  cookies: string;
  userAgent: string;
  lastFetchAt: number;
  lastSuccessAt: number;
  lastError: string;
  failCount: number;
  seeded: boolean;
  unreadCount: number;
}

interface RssItem {
  guid: string;
  title: string;
  link: string;
  enclosureUrl: string;
  enclosureLength: number;
  pubDate: number;
  status: number;
  taskId: string;
  reason: string;
}

interface SourceForm {
  url: string;
  name: string;
  enabled: boolean;
  autoDownload: boolean;
  startPaused: boolean;
  intervalMinutes: number | null;
  includePattern: string;
  excludePattern: string;
  useRegex: boolean;
  smartEpisode: boolean;
  sizeMinMB: number | null;
  sizeMaxMB: number | null;
  maxPerFetch: number | null;
}

const SOURCES_KEY = "/api/downloads/rss/sources";

const emptyForm = (): SourceForm => ({
  url: "",
  name: "",
  enabled: true,
  autoDownload: true,
  startPaused: false,
  intervalMinutes: null,
  includePattern: "",
  excludePattern: "",
  useRegex: false,
  smartEpisode: true,
  sizeMinMB: null,
  sizeMaxMB: null,
  maxPerFetch: null,
});

function fmtTime(unixSec: number): string {
  return unixSec > 0 ? new Date(unixSec * 1000).toLocaleString() : "—";
}

/** 条目状态 → 标签（对齐引擎 RssItemDto.status 语义） */
const ITEM_STATUS: Record<number, { label: string; color: string }> = {
  0: { label: "rssItemNew", color: "processing" },
  1: { label: "rssItemDownloaded", color: "success" },
  2: { label: "rssItemIgnored", color: "default" },
  3: { label: "rssItemSkipped", color: "default" },
  4: { label: "rssItemDupEpisode", color: "warning" },
  5: { label: "rssItemHistory", color: "default" },
};

const RssPanel = () => {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [form] = Form.useForm<SourceForm>();
  const [editing, setEditing] = useState<RssSource | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validateResult, setValidateResult] = useState<{
    feedTitle: string;
    count: number;
    error: string;
  } | null>(null);
  const [itemsSource, setItemsSource] = useState<RssSource | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: sources, mutate } = useSWR<RssSource[]>(
    SOURCES_KEY,
    () => http.get(SOURCES_KEY) as Promise<RssSource[]>,
    { refreshInterval: 30000, revalidateOnFocus: false },
  );

  const { data: items, mutate: mutateItems } = useSWR<RssItem[]>(
    itemsSource ? `/api/downloads/rss/sources/${itemsSource.sourceId}/items` : null,
    (key: string) => http.get(key) as Promise<RssItem[]>,
    { revalidateOnFocus: false },
  );

  useEffect(() => {
    if (itemsSource) void mutateItems();
  }, [itemsSource, mutateItems]);

  const openCreate = useMemoizedFn(() => {
    setEditing(null);
    setValidateResult(null);
    form.setFieldsValue(emptyForm());
    setFormOpen(true);
  });

  const openEdit = useMemoizedFn((src: RssSource) => {
    setEditing(src);
    setValidateResult(null);
    form.setFieldsValue({
      url: src.url,
      name: src.name,
      enabled: src.enabled,
      autoDownload: src.autoDownload,
      startPaused: src.startPaused,
      intervalMinutes: src.intervalMinutes > 0 ? src.intervalMinutes : null,
      includePattern: src.includePattern,
      excludePattern: src.excludePattern,
      useRegex: src.useRegex,
      smartEpisode: src.smartEpisode,
      sizeMinMB:
        src.sizeMinBytes > 0 ? Math.round(src.sizeMinBytes / 1048576) : null,
      sizeMaxMB:
        src.sizeMaxBytes > 0 ? Math.round(src.sizeMaxBytes / 1048576) : null,
      maxPerFetch: src.maxPerFetch > 0 ? src.maxPerFetch : null,
    });
    setFormOpen(true);
  });

  const validateUrl = useMemoizedFn(async () => {
    const url = form.getFieldValue("url");
    if (!url) return;
    setValidating(true);
    try {
      const r = (await http.post("/api/downloads/rss/validate", {
        url,
      })) as unknown as {
        feedTitle?: string;
        items?: unknown[];
        error?: string;
      };
      setValidateResult({
        feedTitle: r?.feedTitle ?? "",
        count: Array.isArray(r?.items) ? r.items.length : 0,
        error: r?.error ?? "",
      });
    } catch (e: unknown) {
      message.error((e as Error)?.message || t("pleaseEnterCorrectFormInfo"));
    } finally {
      setValidating(false);
    }
  });

  const save = useMemoizedFn(async () => {
    try {
      await form.validateFields();
    } catch {
      return;
    }
    const v = form.getFieldsValue();
    const payload = {
      url: v.url,
      name: v.name ?? "",
      enabled: v.enabled,
      autoDownload: v.autoDownload,
      startPaused: v.startPaused,
      intervalMinutes: v.intervalMinutes ?? 0,
      includePattern: v.includePattern ?? "",
      excludePattern: v.excludePattern ?? "",
      useRegex: v.useRegex,
      smartEpisode: v.smartEpisode,
      sizeMinBytes: v.sizeMinMB ? Math.round(v.sizeMinMB * 1048576) : 0,
      sizeMaxBytes: v.sizeMaxMB ? Math.round(v.sizeMaxMB * 1048576) : 0,
      maxPerFetch: v.maxPerFetch ?? 0,
    };
    setSaving(true);
    try {
      if (editing) {
        await http.put(SOURCES_KEY, { ...payload, sourceId: editing.sourceId });
      } else {
        await http.post(SOURCES_KEY, payload);
      }
      message.success(t("rssSaved"));
      setFormOpen(false);
      await mutate();
    } catch (e: unknown) {
      message.error((e as Error)?.message || t("pleaseEnterCorrectFormInfo"));
    } finally {
      setSaving(false);
    }
  });

  const toggleField = useMemoizedFn(
    async (src: RssSource, field: "enabled" | "autoDownload", value: boolean) => {
      try {
        await http.put(SOURCES_KEY, { ...src, [field]: value });
        await mutate();
      } catch (e: unknown) {
        message.error((e as Error)?.message || t("pleaseEnterCorrectFormInfo"));
      }
    },
  );

  const refreshSource = useMemoizedFn(async (src: RssSource) => {
    try {
      await http.post(
        `/api/downloads/rss/sources/${src.sourceId}/refresh`,
      );
      message.success(t("rssRefreshed"));
      await mutate();
    } catch (e: unknown) {
      message.error((e as Error)?.message || t("pleaseEnterCorrectFormInfo"));
    }
  });

  const removeSource = useMemoizedFn(async (src: RssSource) => {
    try {
      await http.delete(`/api/downloads/rss/sources/${src.sourceId}`);
      message.success(t("delete"));
      await mutate();
    } catch (e: unknown) {
      message.error((e as Error)?.message || t("pleaseEnterCorrectFormInfo"));
    }
  });

  const itemAction = useMemoizedFn(
    async (guid: string, action: "download" | "ignore" | "readAll") => {
      if (!itemsSource) return;
      setBusy(true);
      try {
        await http.post(
          `/api/downloads/rss/sources/${itemsSource.sourceId}/action`,
          { guid, action },
        );
        await mutateItems();
        await mutate();
      } catch (e: unknown) {
        message.error((e as Error)?.message || t("pleaseEnterCorrectFormInfo"));
      } finally {
        setBusy(false);
      }
    },
  );

  const renderItems = (): ReactNode => {
    if (!items || items.length === 0) {
      return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />;
    }
    return (
      <div className="flex flex-col gap-2">
        {items.map((it) => {
          const st = ITEM_STATUS[it.status] ?? ITEM_STATUS[0]!;
          return (
            <div
              key={it.guid}
              className="flex flex-row items-center gap-2 rounded-lg border border-black/5 px-3 py-2 dark:border-white/10"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="truncate text-sm" title={it.link}>
                  {it.title}
                </div>
                <div className="flex flex-row items-center gap-2 text-xs text-gray-400">
                  <Tag color={st.color} className="m-0">
                    {t(st.label)}
                  </Tag>
                  <span>{fmtTime(it.pubDate)}</span>
                  {it.enclosureLength > 0 ? (
                    <span>
                      {Math.max(1, Math.round(it.enclosureLength / 1048576))} MB
                    </span>
                  ) : null}
                </div>
              </div>
              {(it.status === 0 || it.status === 3) && it.enclosureUrl ? (
                <Space size="small">
                  <Button
                    size="small"
                    loading={busy}
                    onClick={() => void itemAction(it.guid, "download")}
                  >
                    {t("rssForceDownload")}
                  </Button>
                  <Button
                    size="small"
                    onClick={() => void itemAction(it.guid, "ignore")}
                  >
                    {t("rssIgnore")}
                  </Button>
                </Space>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      {/* 工具栏 */}
      <div className="flex shrink-0 flex-row items-center justify-between px-1">
        <Typography.Text type="secondary" className="text-xs">
          {t("rssPanelDesc")}
        </Typography.Text>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void mutate()}>
            {t("refresh")}
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={openCreate}
          >
            {t("rssAddSource")}
          </Button>
        </Space>
      </div>

      {/* 源列表 */}
      {(sources ?? []).length === 0 ? (
        <div className="flex h-full min-h-[280px] flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-black/[0.08] bg-black/[0.015] py-10 dark:border-white/[0.08] dark:bg-white/[0.02]">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6366F1]/10 to-[#8B5CF6]/15 text-[#6366F1] dark:text-[#A78BFA]">
            <svg
              className="h-6 w-6"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 11a9 9 0 0 1 9 9" />
              <path d="M4 4a16 16 0 0 1 16 16" />
              <circle cx="5" cy="19" r="1" />
            </svg>
          </span>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {t("rssEmpty")}
          </span>
          <Button
            type="primary"
            size="small"
            icon={<PlusOutlined />}
            onClick={openCreate}
          >
            {t("rssAddSource")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {(sources ?? []).map((src) => (
            <Card
              key={src.sourceId}
              size="small"
              variant="borderless"
              className="bg-white/85 dark:bg-[#27292F]"
            >
              <div className="flex flex-row items-center gap-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-row items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {src.name || src.url}
                    </span>
                    {src.unreadCount > 0 ? (
                      <Badge count={src.unreadCount} size="small" />
                    ) : null}
                    {!src.enabled ? (
                      <Tag color="default">{t("engineDown")}</Tag>
                    ) : null}
                    {src.autoDownload ? (
                      <Tag color="blue">{t("rssAutoDownload")}</Tag>
                    ) : (
                      <Tag color="default">{t("rssCollectMode")}</Tag>
                    )}
                  </div>
                  <Typography.Text
                    type="secondary"
                    className="truncate text-xs"
                    title={src.url}
                  >
                    {src.url}
                  </Typography.Text>
                  <div className="flex flex-row flex-wrap items-center gap-3 text-xs text-gray-400">
                    <span>
                      {t("rssLastFetch")}: {fmtTime(src.lastFetchAt)}
                    </span>
                    <span>
                      {t("rssIntervalMinutes", {
                        min: src.intervalMinutes > 0 ? src.intervalMinutes : 30,
                      })}
                    </span>
                    {src.lastError ? (
                      <span className="text-rose-500" title={src.lastError}>
                        {t("failReason")}: {src.lastError.slice(0, 50)}
                      </span>
                    ) : null}
                  </div>
                </div>
                <Space size="small">
                  <Switch
                    size="small"
                    checked={src.enabled}
                    onChange={(v) => void toggleField(src, "enabled", v)}
                  />
                  <Button
                    size="small"
                    icon={<SearchOutlined />}
                    onClick={() => setItemsSource(src)}
                  >
                    {t("rssItems")}
                  </Button>
                  <Button
                    size="small"
                    onClick={() => void refreshSource(src)}
                  >
                    {t("refresh")}
                  </Button>
                  <Button size="small" onClick={() => openEdit(src)}>
                    {t("edit")}
                  </Button>
                  <Popconfirm
                    title={t("delete")}
                    onConfirm={() => void removeSource(src)}
                  >
                    <Button size="small" danger>
                      {t("delete")}
                    </Button>
                  </Popconfirm>
                </Space>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* 添加/编辑源 */}
      <Modal
        title={editing ? t("edit") : t("rssAddSource")}
        open={formOpen}
        onCancel={() => setFormOpen(false)}
        width={520}
        footer={[
          <Button key="cancel" onClick={() => setFormOpen(false)}>
            {t("cancel")}
          </Button>,
          <Button key="save" type="primary" loading={saving} onClick={() => void save()}>
            {t("save")}
          </Button>,
        ]}
      >
        <Form form={form} layout="vertical" initialValues={emptyForm()}>
          <Form.Item
            label={t("rssFeedUrl")}
            name="url"
            rules={[{ required: true, message: t("pleaseEnterCorrectUrl") }]}
          >
            <Space.Compact className="w-full">
              <Input
                placeholder="https://example.com/feed.xml"
                onChange={() => setValidateResult(null)}
              />
              <Button
                loading={validating}
                onClick={() => void validateUrl()}
              >
                {t("rssValidate")}
              </Button>
            </Space.Compact>
          </Form.Item>
          {validateResult ? (
            <Typography.Text
              type={validateResult.error ? "danger" : "success"}
              className="mb-2 block text-xs"
            >
              {validateResult.error
                ? `${t("rssValidateFailed")}: ${validateResult.error}`
                : `${t("rssValidateOk")}：${validateResult.feedTitle} · ${validateResult.count} ${t("rssItems")}`}
            </Typography.Text>
          ) : null}
          <Form.Item label={t("siteName")} name="name">
            <Input placeholder={t("rssNamePlaceholder")} />
          </Form.Item>
          <div className="grid grid-cols-2 gap-x-4">
            <Form.Item
              label={t("rssEnabled")}
              name="enabled"
              valuePropName="checked"
              className="mb-2"
            >
              <Switch />
            </Form.Item>
            <Form.Item
              label={t("rssAutoDownload")}
              tooltip={t("rssAutoDownloadTooltip")}
              name="autoDownload"
              valuePropName="checked"
              className="mb-2"
            >
              <Switch />
            </Form.Item>
            <Form.Item
              label={t("rssStartPaused")}
              tooltip={t("rssStartPausedTooltip")}
              name="startPaused"
              valuePropName="checked"
              className="mb-2"
            >
              <Switch />
            </Form.Item>
            <Form.Item
              label={t("rssInterval")}
              tooltip={t("rssIntervalTooltip")}
              name="intervalMinutes"
              className="mb-2"
            >
              <InputNumber min={0} precision={0} className="w-full" placeholder="30" />
            </Form.Item>
            <Form.Item
              label={t("rssIncludePattern")}
              tooltip={t("rssPatternTooltip")}
              name="includePattern"
              className="mb-2"
            >
              <Input placeholder="1080p | 2160p" />
            </Form.Item>
            <Form.Item
              label={t("rssExcludePattern")}
              name="excludePattern"
              className="mb-2"
            >
              <Input placeholder="cam | ts" />
            </Form.Item>
            <Form.Item
              label={t("rssUseRegex")}
              name="useRegex"
              valuePropName="checked"
              className="mb-2"
            >
              <Switch />
            </Form.Item>
            <Form.Item
              label={t("rssSmartEpisode")}
              tooltip={t("rssSmartEpisodeTooltip")}
              name="smartEpisode"
              valuePropName="checked"
              className="mb-2"
            >
              <Switch />
            </Form.Item>
            <Form.Item label={t("rssSizeMinMB")} name="sizeMinMB" className="mb-2">
              <InputNumber min={0} precision={0} className="w-full" />
            </Form.Item>
            <Form.Item label={t("rssSizeMaxMB")} name="sizeMaxMB" className="mb-2">
              <InputNumber min={0} precision={0} className="w-full" />
            </Form.Item>
            <Form.Item
              label={t("rssMaxPerFetch")}
              tooltip={t("rssMaxPerFetchTooltip")}
              name="maxPerFetch"
              className="mb-0"
            >
              <InputNumber min={0} max={100} precision={0} className="w-full" />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      {/* 条目列表 */}
      <Drawer
        title={
          <Space>
            <span className="truncate">{itemsSource?.name || t("rssItems")}</span>
            <Button size="small" onClick={() => void itemAction("", "readAll")}>
              {t("rssReadAll")}
            </Button>
          </Space>
        }
        open={itemsSource !== null}
        onClose={() => setItemsSource(null)}
        width={460}
      >
        {renderItems()}
      </Drawer>
    </div>
  );
};

export default RssPanel;
