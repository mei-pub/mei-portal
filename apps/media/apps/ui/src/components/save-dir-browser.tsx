import {
  ArrowLeftOutlined,
  FolderAddOutlined,
  HomeOutlined,
  LoadingOutlined,
} from "@ant-design/icons";
import { useMemoizedFn } from "ahooks";
import { App, Button, Input, List, Modal, Spin } from "antd";
import { useTranslation } from "react-i18next";
import { useState, type ReactNode } from "react";

// 保存目录浏览器 —— 新建下载「保存目录」的目录树选择（对齐 FluxDown
// 控制台新建弹窗的目录浏览）。数据走 media core 的 /api/downloads/fs
// （daemon.fs.list 代理，限 /downloads 子树、仅目录）；新建目录走
// /api/downloads/fs/mkdir（core 直写，同限 /downloads 子树）。
// 产物是 folder 字段的「下载根相对」形态："/" = 下载根，"/x/y" = /downloads/x/y
// （resolveTaskDir 对前导斜杠先行判定——sanitizeFolder 会剥斜杠）。

const DOWNLOADS_ROOT = "/downloads";

interface FsListResult {
  path: string;
  parent: string;
  denied: boolean;
  dirs: Array<{ name: string; path: string }>;
}

export interface SaveDirBrowserProps {
  open: boolean;
  onClose: () => void;
  /** 选中目录（下载根相对 folder 值："/" 或 "/x/y"） */
  onSelect: (folder: string) => void;
}

export default function SaveDirBrowser({
  open,
  onClose,
  onSelect,
}: SaveDirBrowserProps) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [current, setCurrent] = useState<string>(DOWNLOADS_ROOT);
  const [result, setResult] = useState<FsListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useMemoizedFn(async (dir: string) => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/downloads/fs?path=${encodeURIComponent(dir)}`,
        { credentials: "include" },
      );
      const payload = (await res.json().catch(() => null)) as {
        success?: boolean;
        data?: FsListResult;
        message?: string;
      } | null;
      if (!res.ok || !payload?.data) {
        throw new Error(payload?.message || `HTTP ${res.status}`);
      }
      setCurrent(dir);
      setResult(payload.data);
    } catch (e: unknown) {
      message.error((e as Error)?.message || t("loadFailed"));
    } finally {
      setLoading(false);
    }
  });

  // 面包屑：/downloads 相对段 + 根标签
  const crumbs: Array<{ label: string; path: string }> = [
    { label: t("rootDir"), path: DOWNLOADS_ROOT },
  ];
  if (current.startsWith(DOWNLOADS_ROOT + "/")) {
    const rel = current.slice(DOWNLOADS_ROOT.length);
    const parts = rel.split("/").filter(Boolean);
    let acc = DOWNLOADS_ROOT;
    for (const p of parts) {
      acc = `${acc}/${p}`;
      crumbs.push({ label: p, path: acc });
    }
  }

  const createFolder = useMemoizedFn(async () => {
    const name = newName.trim();
    if (name === "") return;
    setCreating(true);
    try {
      const res = await fetch("/api/downloads/fs/mkdir", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: current, name }),
      });
      const payload = (await res.json().catch(() => null)) as {
        success?: boolean;
        message?: string;
      } | null;
      if (!res.ok || !payload?.success) {
        throw new Error(payload?.message || `HTTP ${res.status}`);
      }
      setNewName("");
      await load(`${current}/${name}`);
    } catch (e: unknown) {
      message.error((e as Error)?.message || t("loadFailed"));
    } finally {
      setCreating(false);
    }
  });

  const chooseCurrent = () => {
    // 下载根相对 folder："/"（根本身）或 "/x/y"
    const folder =
      current === DOWNLOADS_ROOT
        ? "/"
        : current.slice(DOWNLOADS_ROOT.length) || "/";
    onSelect(folder);
    onClose();
  };

  return (
    <Modal
      open={open}
      title={t("chooseSaveDir")}
      onCancel={onClose}
      width={520}
      afterOpenChange={(o) => {
        if (o && !loading && (!result || result.path !== current)) {
          void load(current);
        }
      }}
      footer={[
        <Button key="cancel" onClick={onClose}>
          {t("cancel")}
        </Button>,
        <Button key="ok" type="primary" onClick={chooseCurrent}>
          {t("selectCurrentDir")}
        </Button>,
      ]}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap py-0.5">
          {loading ? (
            <LoadingOutlined className="text-base" />
          ) : (
            <>
              {current !== DOWNLOADS_ROOT && (
                <Button
                  size="small"
                  type="text"
                  icon={<ArrowLeftOutlined />}
                  onClick={() => void load(result?.parent ?? DOWNLOADS_ROOT)}
                />
              )}
              {crumbs.map((c, i) => (
                <span key={c.path} className="flex items-center gap-1">
                  {i > 0 && <span className="text-xs opacity-50">/</span>}
                  <Button
                    size="small"
                    type="text"
                    icon={i === 0 ? <HomeOutlined /> : null}
                    onClick={() => void load(c.path)}
                  >
                    {c.label}
                  </Button>
                </span>
              ))}
            </>
          )}
        </div>
        <div className="max-h-72 overflow-y-auto rounded-lg border border-black/5 dark:border-white/10">
          <List
            size="small"
            dataSource={result?.dirs ?? []}
            locale={{ emptyText: t("noData") }}
            renderItem={(d) => (
              <List.Item
                className="cursor-pointer transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                onClick={() => void load(d.path)}
              >
                <span className="flex items-center gap-2 px-1 py-0.5">
                  <span className="text-[15px] opacity-80">📁</span>
                  {d.name}
                </span>
              </List.Item>
            )}
          />
        </div>
        <div className="flex items-center gap-2">
          <Input
            size="small"
            value={newName}
            placeholder={t("newFolderName")}
            maxLength={64}
            onChange={(e) => setNewName(e.target.value)}
            onPressEnter={() => void createFolder()}
          />
          <Button
            size="small"
            icon={<FolderAddOutlined />}
            loading={creating}
            disabled={newName.trim() === ""}
            onClick={() => void createFolder()}
          >
            {t("createFolder")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** folder 值（含根相对/内置 key/遗留相对段）→ 展示标签 */
export function folderLabelOf(folder: string, t: (k: string) => string): ReactNode {
  if (folder === "/") return `${t("rootDir")}（/downloads）`;
  if (folder.startsWith("/")) return `${t("rootDir")}${folder}`;
  return folder;
}
