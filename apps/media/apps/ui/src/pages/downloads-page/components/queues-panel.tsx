import { useMemoizedFn } from "ahooks";
import {
  App,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Tag,
  Typography,
} from "antd";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { http } from "@/utils";

/**
 * 命名队列面板（对齐 FluxDown 控制台队列管理，风格沿用主应用）：
 * 队列 CRUD / 起停。0.5.4 引擎面实证：update 仅支持改名（限速与排程
 * 字段一律 invalidArgument）——限速按只读展示，schedule/reorder 无效不接。
 * 内置 main / later 不可删（引擎侧拒绝，UI 直接隐藏删除入口）。
 */

interface EngineQueue {
  queueId: string;
  name: string;
  position: number;
  isRunning: boolean;
  maxConcurrent: number;
  defaultSaveDir: string;
  defaultSegments: number;
  defaultUserAgent: string;
  speedLimitKbps: number;
  uploadLimitKbps: number;
  scheduleEnabled: boolean;
  scheduleDays: number;
  scheduleStart: string;
  scheduleStop: string;
}

const QUEUES_KEY = "/api/downloads/engine-queues";
/** 任务列表（按队列计数展示；engineTaskId 在库 = 引擎任务归属该队列） */
const TASKS_KEY = "/api/downloads";
/** 内置队列（引擎保留，不可删除） */
const BUILTIN_QUEUES = new Set(["main", "later"]);

const fmtKbps = (kbps: number): string =>
  kbps > 0 ? `${(kbps / 1024).toFixed(kbps >= 1024 ? 1 : 0)} MB/s` : "∞";

const QueuesPanel = () => {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data: queues, mutate } = useSWR<EngineQueue[]>(
    QUEUES_KEY,
    () => http.get(QUEUES_KEY) as Promise<EngineQueue[]>,
    { refreshInterval: 30000, revalidateOnFocus: false },
  );

  // 任务计数（FluxDown 队列视图同款展示）：引擎 queue.list 不带计数，
  // 从任务列表按 queueId 归组（空 = 引擎默认 Main Queue → main）
  const { data: taskPage } = useSWR<{ total: number; list: Array<{ queueId: string | null; status: string }> }>(
    TASKS_KEY,
    () => http.get(TASKS_KEY) as Promise<{ total: number; list: Array<{ queueId: string | null; status: string }> }>,
    { refreshInterval: 30000, revalidateOnFocus: false },
  );
  const countOf = (queueId: string): { total: number; active: number } => {
    const rows = (taskPage?.list ?? []).filter(
      (r) => (r.queueId ?? "main") === queueId,
    );
    return {
      total: rows.length,
      active: rows.filter((r) => r.status !== "success").length,
    };
  };

  const createQueue = useMemoizedFn(async () => {
    const name = newName.trim();
    if (name === "") return;
    setSaving(true);
    try {
      await http.post(QUEUES_KEY, { name });
      message.success(t("queueCreated"));
      setAddOpen(false);
      setNewName("");
      await mutate();
    } catch (e: unknown) {
      message.error((e as Error)?.message || t("pleaseEnterCorrectFormInfo"));
    } finally {
      setSaving(false);
    }
  });

  const renameQueue = useMemoizedFn(async (q: EngineQueue, name: string) => {
    const next = name.trim();
    if (next === "" || next === q.name) return;
    try {
      await http.put(QUEUES_KEY, { queueId: q.queueId, name: next });
      message.success(t("queueRenamed"));
      await mutate();
    } catch (e: unknown) {
      message.error((e as Error)?.message || t("pleaseEnterCorrectFormInfo"));
    }
  });

  const toggleQueue = useMemoizedFn(async (q: EngineQueue, run: boolean) => {
    try {
      await http.post(`${QUEUES_KEY}/${q.queueId}/${run ? "start" : "stop"}`);
      await mutate();
    } catch (e: unknown) {
      message.error((e as Error)?.message || t("pleaseEnterCorrectFormInfo"));
    }
  });

  const deleteQueue = useMemoizedFn(async (q: EngineQueue) => {
    setBusy(true);
    try {
      await http.delete(`${QUEUES_KEY}/${q.queueId}`);
      message.success(t("delete"));
      await mutate();
    } catch (e: unknown) {
      message.error((e as Error)?.message || t("pleaseEnterCorrectFormInfo"));
    } finally {
      setBusy(false);
    }
  });

  const renderLimits = (q: EngineQueue): ReactNode => {
    const { total, active } = countOf(q.queueId);
    return (
      <div className="flex flex-row flex-wrap items-center gap-3 text-xs text-gray-400">
        <span>
          任务 {total}
          {active > 0 ? <span className="text-[#3B82F6]"> · 活动 {active}</span> : null}
        </span>
        <span>
          {t("queueDownLimit")}: {fmtKbps(q.speedLimitKbps)}
        </span>
        <span>
          {t("queueUpLimit")}: {fmtKbps(q.uploadLimitKbps)}
        </span>
        {q.defaultSegments > 0 ? (
          <span>
            {t("segmentsCount")}: {q.defaultSegments}
          </span>
        ) : null}
        {q.maxConcurrent > 0 ? (
          <span>
            {t("queueMaxConcurrent")}: {q.maxConcurrent}
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      {/* 工具栏 */}
      <div className="flex shrink-0 flex-row items-center justify-between px-1">
        <Typography.Text type="secondary" className="text-xs">
          {t("queuePanelDesc")}
        </Typography.Text>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void mutate()}>
            {t("refresh")}
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setAddOpen(true)}
          >
            {t("queueAdd")}
          </Button>
        </Space>
      </div>

      {/* 队列卡片 */}
      {!queues || queues.length === 0 ? (
        <Empty
          className="flex flex-1 items-center justify-center"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span className="text-xs text-gray-400">{t("queueEmpty")}</span>
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {queues.map((q) => {
            const builtin = BUILTIN_QUEUES.has(q.queueId);
            return (
              <Card
                key={q.queueId}
                size="small"
                variant="borderless"
                className="bg-white/85 dark:bg-[#27292F]"
              >
                <div className="flex flex-row items-center gap-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-row items-center gap-2">
                      <Typography.Text
                        className="text-sm font-medium"
                        editable={{
                          tooltip: t("queueRename"),
                          onChange: (v) => void renameQueue(q, v),
                          triggerType: ["icon"] as const,
                        }}
                      >
                        {q.name}
                      </Typography.Text>
                      {builtin ? (
                        <Tag color="geekblue">{t("queueBuiltin")}</Tag>
                      ) : null}
                      {q.isRunning ? (
                        <Tag color="processing">{t("queueRunning")}</Tag>
                      ) : (
                        <Tag color="default">{t("engineDown")}</Tag>
                      )}
                    </div>
                    {renderLimits(q)}
                  </div>
                  <Space size="small">
                    <Switch
                      size="small"
                      checked={q.isRunning}
                      onChange={(v) => void toggleQueue(q, v)}
                    />
                    {!builtin ? (
                      <Popconfirm
                        title={t("queueDeleteConfirm")}
                        onConfirm={() => void deleteQueue(q)}
                      >
                        <Button size="small" danger loading={busy}>
                          {t("delete")}
                        </Button>
                      </Popconfirm>
                    ) : null}
                  </Space>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* 新建队列 */}
      <Modal
        title={t("queueAdd")}
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        width={420}
        footer={[
          <Button key="cancel" onClick={() => setAddOpen(false)}>
            {t("cancel")}
          </Button>,
          <Button
            key="save"
            type="primary"
            loading={saving}
            onClick={() => void createQueue()}
          >
            {t("save")}
          </Button>,
        ]}
      >
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t("queueNamePlaceholder")}
          maxLength={64}
          onPressEnter={() => void createQueue()}
        />
        <Typography.Text type="secondary" className="mt-2 block text-xs">
          {t("queueCreateHint")}
        </Typography.Text>
      </Modal>
    </div>
  );
};

export default QueuesPanel;
