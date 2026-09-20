import {
  CloudDownloadOutlined,
  DockerOutlined,
  PaperClipOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { useMemoizedFn } from "ahooks";
import {
  App,
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Radio,
  Segmented,
  Select,
  Spin,
  Switch,
  Upload,
} from "antd";
import { forwardRef, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { ADD_TO_LIST, DOWNLOAD_NOW } from "@/const";
import { usePlatform } from "@/hooks/use-platform";
import { createDownloadTasks } from "@/api/download-task";
import { useDockerApi } from "@/hooks/use-docker-api";
import { appStoreSelector, useAppStore } from "@/store/app";
import { downloadFormSelector, useConfigStore } from "@/store/config";
import { tdApp } from "@/utils";
import { DownloadTask, DownloadType } from "@mediago/shared-common";
import { BatchUrlTextarea } from "./batchurl-textarea";

const { TextArea } = Input;

/** 下载大类：普通下载（直链文件）/ 视频下载（站点流媒体）/ 磁力下载（BT）。
 *  三类执行路径与表单形态完全不同，先选大类再细分 —— 大类决定 URL 校验、
 *  名称可空性、headers 显隐；视频类内部再由 subtype 细分下载器 */
export type DownloadCategory = "normal" | "video" | "magnet";

// ---- 磁力内容文件树与类型筛选（与综合搜索磁力弹层同构逻辑）----

interface MagnetTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  /** 子树全部文件 index（1-based，目录级勾选用） */
  indexes: number[];
  children: MagnetTreeNode[];
}

const MAGNET_FILE_TYPES: Array<{ key: string; label: string; exts: Set<string> }> = [
  { key: "video", label: "视频", exts: new Set("mp4 mkv avi mov wmv flv ts m2ts webm rmvb mpg mpeg m4v vob 3gp".split(" ")) },
  { key: "audio", label: "音频", exts: new Set("mp3 flac ape wav aac m4a ogg wma dsf opus".split(" ")) },
  { key: "subtitle", label: "字幕", exts: new Set("srt ass ssa sub idx sup vtt scc".split(" ")) },
  { key: "image", label: "图片", exts: new Set("jpg jpeg png gif webp bmp tif tiff svg".split(" ")) },
  { key: "doc", label: "文档", exts: new Set("pdf epub mobi txt doc docx xls xlsx ppt pptx chm nfo md html".split(" ")) },
  { key: "archive", label: "压缩包", exts: new Set("zip rar 7z tar gz bz2 xz iso exe apk dmg".split(" ")) },
];

function magnetFileTypeOf(path: string): string {
  const last = path.split("/").pop() || "";
  const dot = last.lastIndexOf(".");
  const ext = dot >= 0 ? last.slice(dot + 1).toLowerCase() : "";
  for (const t of MAGNET_FILE_TYPES) {
    if (t.exts.has(ext)) return t.key;
  }
  return "other";
}

function buildMagnetTree(files: Array<{ index: number; path: string; size: number }>): MagnetTreeNode[] {
  const root: MagnetTreeNode = { name: "", path: "", isDir: true, size: 0, indexes: [], children: [] };
  for (const f of files) {
    const parts = f.path.split("/").filter(Boolean);
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const isFile = i === parts.length - 1;
      const pathSoFar = parts.slice(0, i + 1).join("/");
      let next = cur.children.find((c) => c.isDir === !isFile && c.path === pathSoFar);
      if (!next) {
        next = { name: parts[i], path: pathSoFar, isDir: !isFile, size: 0, indexes: [], children: [] };
        cur.children.push(next);
      }
      next.size += f.size;
      next.indexes.push(f.index);
      cur = next;
    }
  }
  const sortNodes = (nodes: MagnetTreeNode[]) => {
    nodes.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
    nodes.forEach((n) => sortNodes(n.children));
  };
  sortNodes(root.children);
  return root.children;
}

/** 类型筛选：保留匹配文件与其祖先目录；"all" = 原树 */
function filterMagnetTree(nodes: MagnetTreeNode[], type: string): MagnetTreeNode[] {
  if (type === "all") return nodes;
  const out: MagnetTreeNode[] = [];
  for (const n of nodes) {
    if (!n.isDir) {
      if (magnetFileTypeOf(n.path) === type) out.push(n);
    } else {
      const children = filterMagnetTree(n.children, type);
      if (children.length > 0) out.push({ ...n, children });
    }
  }
  return out;
}

function fmtTreeSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "--";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** 磁力下载的输入方式：粘贴磁力链接 / 上传 BT 种子文件 */
export type MagnetInputMode = "magnet" | "torrent";

/** /api/upload/torrent 的响应（种子元数据） */
export interface TorrentUploadResult {
  /** 种子文件上传模式：服务端落盘的 .torrent 路径（bt url 白名单内） */
  path?: string;
  /** 磁力解析模式：qBittorrent 种子 hash（discard/续用定位） */
  hash?: string;
  name: string;
  size: number;
  files: Array<{ index: number; path: string; size: number }> | null;
  /** 磁力解析：已在 BT 引擎中存在（含未完成续传 / qB WebUI 手加） */
  existed?: boolean;
  /** 已存在且下载完成（重新下载 = 删旧重下，UI 需二次确认） */
  completed?: boolean;
}

/** 具体下载类型 → 大类（外部 ref 接口与编辑回填仍以 DownloadType 进出） */
const CATEGORY_OF_TYPE: Record<DownloadType, DownloadCategory> = {
  direct: "normal",
  m3u8: "video",
  bilibili: "video",
  youtube: "video",
  mediago: "video",
  bt: "magnet",
};

/** 大类默认下载类型（video 的细分由 subtype 决定） */
const TYPE_OF_CATEGORY: Record<DownloadCategory, DownloadType> = {
  normal: DownloadType.direct,
  video: DownloadType.m3u8,
  magnet: DownloadType.bt,
};

/** 内置保存目录（media core 侧约定，独立于影视/音乐对接目录 movie/music）。
 *  值 = media core folder 字段的内置 key，落盘 <下载根>/<key>；
 *  label 由渲染时 t(`builtinDir_${key}`) 提供（支持 i18n） */
const BUILTIN_FOLDER_KEYS = ["bt", "files", "video"] as const;
const DEFAULT_FOLDER_OF_CATEGORY: Record<DownloadCategory, string> = {
  normal: "files",
  video: "video",
  magnet: "bt",
};

/** 从磁力链接解析 dn（display name，URL 解码）—— 输入时即时预填任务名 */
function parseMagnetDisplayName(url: string): string {
  try {
    const dn = new URL(url).searchParams.get("dn");
    return dn?.trim() ?? "";
  } catch {
    return "";
  }
}

export interface DownloadFormItem {
  batch?: boolean;
  batchList?: string;
  name?: string;
  type?: DownloadType;
  category?: DownloadCategory;
  subtype?: DownloadType;
  magnetMode?: MagnetInputMode;
  headers?: string;
  url?: string;
  id?: number;
  folder?: string;
}

export interface DownloadFormProps {
  isEdit?: boolean;
  destroyOnClose?: boolean;
  onFormVisibleChange?: (open: boolean) => void;
  onConfirm?: (values: DownloadFormItem) => void;
  id: string;
}

export interface DownloadFormRef {
  setFieldsValue: (value: DownloadFormItem) => void;
  getFieldsValue: () => DownloadFormItem;
  openModal: (value: DownloadFormItem) => void;
}

export interface DownloadTaskForm extends DownloadTask {
  batch?: boolean;
  batchList?: string;
}

export default forwardRef<DownloadFormRef, DownloadFormProps>(
  function DownloadForm(
    { isEdit, destroyOnClose, onFormVisibleChange, id, onConfirm },
    ref,
  ) {
    const { enableDocker } = useAppStore(useShallow(appStoreSelector));
    const [modalOpen, setModalOpen] = useState(false);
    const [form] = Form.useForm<DownloadFormItem>();
    const { t } = useTranslation();
    const { message } = App.useApp();
    const { setLastDownloadTypes, setLastIsBatch } = useConfigStore(
      useShallow(downloadFormSelector),
    );
    const { contextMenu } = usePlatform();
    const { addVideosToDocker } = useDockerApi();

    // 磁力下载（种子文件模式）：上传解析结果 + 内容勾选状态
    const [torrentMeta, setTorrentMeta] = useState<TorrentUploadResult | null>(
      null,
    );
    const [selectedFiles, setSelectedFiles] = useState<number[]>([]);
    // 内容清单的目录折叠与类型筛选（多层级目录树渲染）
    const [typeFilter, setTypeFilter] = useState<string>("all");
    const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
    const [uploading, setUploading] = useState(false);
    // 用户手动改过任务名后，dn/种子名不再自动覆盖
    const nameTouchedRef = useRef(false);
    // 磁力链接内容解析（创建前强制流程）：防抖自动触发 + 去重 + 解析中状态
    const [magnetResolving, setMagnetResolving] = useState(false);
    const resolvedMagnetRef = useRef("");
    const magnetDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
      null,
    );

    useImperativeHandle(ref, () => {
      // 外部（侧栏/嗅探弹层/编辑回填）都以 DownloadType 传入；表单内部
      // 用大类+细分驱动 UI，type 只在提交时映射回去
      const applyValue = (value: DownloadFormItem) => {
        const { type, subtype, ...rest } = value;
        const patch: DownloadFormItem = { ...rest };
        if (type) {
          const category = CATEGORY_OF_TYPE[type] ?? "video";
          patch.category = category;
          // 非 video 大类的旧 subtype 残留不携带（切回视频类避免显示错值）
          if (category === "video") patch.subtype = subtype ?? type;
          // 预选大类时保存目录跟随（setFieldsValue 不触发 onValuesChange，
          // folder 会残留 initialValues 的 video → 磁力任务落错目录）
          if (
            value.folder === undefined &&
            category !== "video" &&
            DEFAULT_FOLDER_OF_CATEGORY[category]
          ) {
            patch.folder = DEFAULT_FOLDER_OF_CATEGORY[category];
          }
        }
        form.setFieldsValue(patch);
      };
      return {
        openModal: (value) => {
          setModalOpen(true);
          // Defer so the Form is mounted before setting values
          queueMicrotask(() => {
            applyValue(value);
            // 磁力深链（网盘搜索 new=magnet 唤起等）：预填即自动解析内容，
            // 用户在弹层内完成勾选/改名/选目录确认后才创建任务
            const url = String(value.url ?? "").trim();
            if (
              (value.category === "magnet" || value.type === DownloadType.bt) &&
              /^magnet:\?.+/.test(url)
            ) {
              void resolveMagnetUrl(url);
            }
          });
        },
        setFieldsValue: (value) => {
          applyValue(value);
        },
        getFieldsValue: () => {
          return form.getFieldsValue();
        },
      };
    }, []);

    /** 表单当前大类 → 提交用 DownloadType（video 细分缺失回 m3u8） */
    const formType = useMemoizedFn((): DownloadType => {
      const { category, subtype } = form.getFieldsValue();
      if (category === "video") {
        return subtype ?? DownloadType.m3u8;
      }
      if (category) {
        return TYPE_OF_CATEGORY[category];
      }
      return DownloadType.m3u8; // 未设置（理论不可达：initialValues 有默认）
    });

    const handleValuesChange = useMemoizedFn(
      (values: Record<string, unknown>) => {
        const { category, subtype, batch, url } = values;
        if (category || subtype) {
          const cat =
            (category as DownloadCategory) ??
            form.getFieldValue("category") ??
            "video";
          const type =
            cat === "video"
              ? ((subtype as DownloadType) ??
                form.getFieldValue("subtype") ??
                DownloadType.m3u8)
              : TYPE_OF_CATEGORY[cat];
          setLastDownloadTypes(type);
          // 大类切换 → 保存目录自动切到对应内置目录（可手动改选其它内置目录）
          if (category) {
            form.setFieldValue("folder", DEFAULT_FOLDER_OF_CATEGORY[cat]);
          }
        }
        // 磁力链接输入：即时识别 dn 预填任务名（用户已手动改名则不覆盖），
        // 并防抖自动解析内容（粘贴/手工编辑都触发；同链接不重复解析）
        if (typeof url === "string" && url.startsWith("magnet:")) {
          const cat = form.getFieldValue("category");
          if (cat === "magnet") {
            if (!nameTouchedRef.current) {
              const dn = parseMagnetDisplayName(url);
              if (dn !== "" && !form.getFieldValue("name")) {
                form.setFieldValue("name", dn);
              }
            }
            if (magnetDebounceRef.current) {
              clearTimeout(magnetDebounceRef.current);
            }
            const target = url.trim();
            if (target !== resolvedMagnetRef.current) {
              magnetDebounceRef.current = setTimeout(() => {
                magnetDebounceRef.current = null;
                void resolveMagnetUrl(target);
              }, 600);
            }
          }
        }
        // 磁力输入方式切换：清空上一模式的解析产物（上传种子 ↔ 链接解析互不沿用）；
        // 切回链接模式且已有合法磁力 → 立即解析
        if (values.magnetMode) {
          setTorrentMeta(null);
          setSelectedFiles([]);
          if (values.magnetMode === "magnet") {
            const cur = String(form.getFieldValue("url") ?? "").trim();
            if (/^magnet:\?.+/.test(cur)) {
              void resolveMagnetUrl(cur);
            }
          }
        }
        if (batch !== null && batch !== undefined) {
          setLastIsBatch(batch);
        }
      },
    );

    const afterOpenChange = useMemoizedFn((open: boolean) => {
      onFormVisibleChange?.(open);

      if (!open) {
        form.resetFields();
        // 种子文件模式的临时状态一并清空
        setTorrentMeta(null);
        setSelectedFiles([]);
        nameTouchedRef.current = false;
        resolvedMagnetRef.current = "";
        if (magnetDebounceRef.current) {
          clearTimeout(magnetDebounceRef.current);
          magnetDebounceRef.current = null;
        }
      }
    });

    // BT 种子文件上传：base64 → /api/upload/torrent（服务端解析 info.name/files
    // 并落盘 torrents 目录），返回的 path 作任务 url；name 自动预填（可改）
    const handleTorrentUpload = useMemoizedFn(async (file: File) => {
      setUploading(true);
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(new Error("read failed"));
          reader.readAsDataURL(file);
        });
        const base64 = dataUrl.split(",")[1] ?? "";
        const res = await fetch("/api/upload/torrent", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: base64 }),
        });
        const payload = (await res.json().catch(() => null)) as {
          success?: boolean;
          data?: TorrentUploadResult;
          message?: string;
        } | null;
        if (!res.ok || !payload?.data) {
          throw new Error(payload?.message || `HTTP ${res.status}`);
        }
        setTorrentMeta(payload.data);
        setTypeFilter("all");
        setCollapsedDirs(new Set());
        setSelectedFiles(payload.data.files?.map((f) => f.index) ?? []);
        if (!nameTouchedRef.current) {
          form.setFieldValue("name", payload.data.name);
        }
        message.success(t("torrentParsed"));
      } catch (e: unknown) {
        message.error((e as Error)?.message || t("pleaseEnterCorrectFormInfo"));
      } finally {
        setUploading(false);
      }
      return false; // 阻止 antd Upload 默认上传行为
    });

    // 磁力链接内容解析（创建前强制流程，对齐迅雷）：POST /api/downloads/resolve-magnet
    // → qBittorrent 引擎抓 metadata（常驻温热 DHT，秒级）→ 种子真名/大小/文件清单。
    // 解析成功后展示文件勾选/名称预填；失败清空 torrentMeta 强制校验拦截提交。
    // 表单取消/关闭时 discard 暂存种子（不留引擎半成品）。
    const discardMagnetStaging = useMemoizedFn(async (hash: string) => {
      try {
        await fetch("/api/downloads/discard-magnet", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hash }),
        });
      } catch {
        // 引擎不可达时暂存种子由超时/下次解析覆盖兜底
      }
    });

    const resolveMagnetUrl = useMemoizedFn(async (magnet: string) => {
      const url = magnet.trim();
      if (!/^magnet:\?.+/.test(url) || url === resolvedMagnetRef.current) {
        return;
      }
      setMagnetResolving(true);
      try {
        const res = await fetch("/api/downloads/resolve-magnet", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        const payload = (await res.json().catch(() => null)) as {
          success?: boolean;
          data?: TorrentUploadResult;
          message?: string;
        } | null;
        if (!res.ok || !payload?.data) {
          throw new Error(payload?.message || `HTTP ${res.status}`);
        }
        const meta = payload.data;
        resolvedMagnetRef.current = url;
        setTorrentMeta(meta);
        setTypeFilter("all");
        setCollapsedDirs(new Set());
        setSelectedFiles(meta.files?.map((f) => f.index) ?? []);
        if (!nameTouchedRef.current) {
          form.setFieldValue("name", meta.name);
        }
        if (meta.completed) {
          // 已下载完成：重新下载 = 删旧重下（含引擎内文件），二次确认
          Modal.confirm({
            title: t("magnetAlreadyDownloaded"),
            content: t("magnetAlreadyDownloadedDesc"),
            okText: t("redownload"),
            cancelText: t("cancel"),
            onOk: async () => {
              if (meta.hash) await discardMagnetStaging(meta.hash);
              // 弃置后重新解析（引擎重新抓元数据，提交即全新任务）
              setTorrentMeta(null);
              setSelectedFiles([]);
              resolvedMagnetRef.current = "";
              await resolveMagnetUrl(url);
            },
          });
        } else if (meta.existed) {
          message.info(t("magnetExistedResume"));
        } else {
          message.success(t("torrentParsed"));
        }
      } catch (e: unknown) {
        setTorrentMeta(null);
        setSelectedFiles([]);
        resolvedMagnetRef.current = "";
        message.error((e as Error)?.message || t("magnetResolveFailed"));
      } finally {
        setMagnetResolving(false);
      }
    });

    // 内容勾选 → --select-file 索引串（全选/未选 = 下载全部，不传）
    const deriveSelectFile = useMemoizedFn((): string => {
      const files = torrentMeta?.files;
      if (!files || files.length === 0) return "";
      if (selectedFiles.length === 0 || selectedFiles.length === files.length) {
        return "";
      }
      return [...selectedFiles].sort((a, b) => a - b).join(",");
    });

    // 磁力任务创建前的强制校验：必须先完成内容解析（勾选文件/确认名称）才能
    // 创建 —— 与迅雷一致，禁止未解析的磁力直接成任务
    const ensureMagnetResolved = useMemoizedFn((): boolean => {
      const { category, batch } = form.getFieldsValue();
      if (category !== "magnet" || batch) return true;
      if (magnetResolving) {
        message.warning(t("magnetResolving"));
        return false;
      }
      if (!torrentMeta) {
        message.warning(t("pleaseResolveMagnetFirst"));
        return false;
      }
      return true;
    });

    // 关闭弹层：未提交且有磁力解析暂存种子 → 弃置（不留引擎半成品）；
    // 提交成功路径（任务续用暂存种子迁移到任务目录）不弃置
    const closeModal = useMemoizedFn((submitted: boolean) => {
      setModalOpen(false);
      const meta = torrentMeta;
      if (!submitted && meta?.hash && !meta.existed) {
        void discardMagnetStaging(meta.hash);
      }
    });

    const handleSave = useMemoizedFn(async () => {
      try {
        await form.validateFields();
      } catch {
        return;
      }
      if (!ensureMagnetResolved()) return;

      try {
        const tasks = await getFormItems();
        await createDownloadTasks(tasks);
        // Badge increments via the "download-create" SSE event
        // (apps/ui/src/api/events.ts); drives both the main window and
        // the overlay-dialog WebContents from a single source.
        closeModal(true);
        onConfirm?.(form.getFieldsValue());
        tdApp.onEvent(ADD_TO_LIST, { id });
      } catch (e: unknown) {
        message.error((e as Error)?.message || t("pleaseEnterCorrectFormInfo"));
      }
    });

    const handleAddToDocker = useMemoizedFn(async () => {
      try {
        await form.validateFields();
      } catch {
        return;
      }
      if (!ensureMagnetResolved()) return;

      try {
        const tasks = await getFormItems();
        await addVideosToDocker({ items: tasks });

        message.success(t("addToDockerSuccess"));
      } catch (e: unknown) {
        message.error((e as Error)?.message || t("pleaseEnterCorrectFormInfo"));
      }
    });

    const handleDownloadNow = useMemoizedFn(async () => {
      try {
        await form.validateFields();
      } catch {
        return;
      }
      if (!ensureMagnetResolved()) return;
      try {
        const tasks = await getFormItems();
        await createDownloadTasks(tasks, true);
        // Badge increments via the "download-create" SSE event; see
        // handleSave comment.
        closeModal(true);
        onConfirm?.(form.getFieldsValue());
        tdApp.onEvent(DOWNLOAD_NOW, { id });
      } catch (e: unknown) {
        message.error((e as Error)?.message || t("pleaseEnterCorrectFormInfo"));
      }
    });

    const getFormItems = useMemoizedFn(async () => {
      const { batch } = form.getFieldsValue();
      const type = formType();
      if (batch) {
        const { batchList = "", headers, folder } = form.getFieldsValue();

        const tasks: Omit<DownloadTask, "id">[] = await Promise.all(
          batchList.split("\n").map(async (line: string) => {
            const [url, customName] = line.trim().split(" ");
            return {
              url: url.trim(),
              name: customName?.trim(),
              headers,
              type,
              folder,
            };
          }),
        );

        return tasks;
      } else {
        const { name = "", headers, folder } = form.getFieldsValue();
        let { url = "" } = form.getFieldsValue();
        // 磁力任务：url = 磁力原文（qBittorrent 按 btih 定位，解析暂存种子
        // 迁移到任务目录续传）；种子文件上传任务：url = 服务端落盘的
        // .torrent 路径（白名单内）。内容勾选派生 select-file
        // （全选/未选 = 全部）
        let selectFile: string | undefined;
        if (type === DownloadType.bt && torrentMeta) {
          if (torrentMeta.path) {
            url = torrentMeta.path;
          } else if (!/^magnet:/i.test(url)) {
            // antd store 竞态兜底：磁力输入框 DOM 仍有合法磁力时以 DOM 为准
            const el = document.getElementById("url") as HTMLInputElement | null;
            const domUrl = el?.value.trim() ?? "";
            if (/^magnet:\?.+/i.test(domUrl)) url = domUrl;
          }
          selectFile = deriveSelectFile() || undefined;
        }

        const task: Omit<DownloadTask, "id"> = {
          name,
          url,
          headers,
          type,
          folder,
          selectFile,
        } as Omit<DownloadTask, "id">;

        return [task];
      }
    });

    return (
      <Modal
        open={modalOpen}
        key={isEdit ? "edit" : "new"}
        title={isEdit ? t("editDownload") : t("newDownload")}
        width={500}
        onCancel={() => closeModal(false)}
        afterOpenChange={afterOpenChange}
        destroyOnHidden={destroyOnClose}
        footer={[
          <Button key="cancel" onClick={() => closeModal(false)}>
            {t("cancel")}
          </Button>,
          enableDocker && (
            <Button
              key="docker"
              onClick={handleAddToDocker}
              icon={<DockerOutlined />}
            >
              {t("addToDocker")}
            </Button>
          ),
          <Button
            key="submit"
            onClick={handleSave}
            icon={<UnorderedListOutlined />}
          >
            {t("addToList")}
          </Button>,
          <Button
            key="link"
            type="primary"
            onClick={handleDownloadNow}
            icon={<CloudDownloadOutlined />}
          >
            {t("downloadNow")}
          </Button>,
        ]}
      >
        <Form
          form={form}
          autoFocus
          labelCol={{ span: 5 }}
          layout="horizontal"
          colon={false}
          initialValues={{
            category: "video",
            subtype: "m3u8",
            magnetMode: "magnet",
            folder: "video",
          }}
          onValuesChange={handleValuesChange}
        >
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>
          <Form.Item hidden={isEdit} label={t("batchDownload")} name={"batch"}>
            <Switch />
          </Form.Item>
          <Form.Item
            key="category"
            name="category"
            label={t("taskCategory")}
            rules={[
              {
                required: true,
                message: t("pleaseEnterCorrectFormInfo"),
              },
            ]}
          >
            <Segmented
              block
              disabled={isEdit}
              options={[
                { label: t("normalDownload"), value: "normal" },
                { label: t("videoDownload"), value: "video" },
                { label: t("magnetDownload"), value: "magnet" },
              ]}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {(formInstance) => {
              // 视频类才细分下载器；普通/磁力的执行路径由大类唯一确定
              if (formInstance.getFieldValue("category") !== "video") {
                return null;
              }
              return (
                <Form.Item
                  key="subtype"
                  name="subtype"
                  label={t("videoType")}
                  rules={[
                    {
                      required: true,
                      message: t("pleaseEnterVideoName"),
                    },
                  ]}
                >
                  <Select
                    disabled={isEdit}
                    options={[
                      {
                        label: t("streamMedia"),
                        value: "m3u8",
                      },
                      {
                        label: t("bilibiliMedia"),
                        value: "bilibili",
                      },
                      {
                        label: t("youtubeMedia"),
                        value: "youtube",
                      },
                      {
                        label: t("mediagoMedia"),
                        value: "mediago",
                      },
                    ]}
                    placeholder={t("pleaseSelectVideoType")}
                  />
                </Form.Item>
              );
            }}
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {(formInstance) => {
              const isBatch = formInstance.getFieldValue("batch");
              if (isBatch) {
                return null;
              }
              const { category, subtype } = formInstance.getFieldsValue();
              const isMagnet = category === "magnet";
              const isNormal = category === "normal";
              return (
                <Form.Item
                  shouldUpdate
                  name="name"
                  label={
                    isMagnet
                      ? t("magnetNameLabel")
                      : isNormal
                        ? t("fileLabel")
                        : t("videoName")
                  }
                  rules={[
                    {
                      // 视频类的 bilibili 抓页面标题；磁力的落盘名由 dn/种子
                      // 自动读取（可改）——都可留空；普通下载与其它视频源必填
                      required: !(
                        isMagnet ||
                        (category === "video" && subtype === "bilibili")
                      ),
                      message: t("pleaseEnterCorrectFormInfo"),
                    },
                  ]}
                >
                  <Input
                    placeholder={
                      isMagnet
                        ? t("magnetNamePlaceholder")
                        : isNormal
                          ? t("fileNamePlaceholder")
                          : t("pleaseEnterVideoName")
                    }
                    onChange={() => {
                      nameTouchedRef.current = true;
                    }}
                    onContextMenu={() =>
                      contextMenu.show([
                        { key: "copy", label: t("copy") },
                        { key: "paste", label: t("paste") },
                      ])
                    }
                  />
                </Form.Item>
              );
            }}
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {(formInstance) => {
              if (isEdit || !formInstance.getFieldValue("batch")) {
                return null;
              }
              return (
                <Form.Item
                  label={t("videoLink")}
                  name="batchList"
                  required
                  rules={[
                    {
                      required: true,
                      message: t("pleaseEnterVideoLink"),
                    },
                    {
                      validator: (_, value) => {
                        const lines = value.split("\n");
                        for (const line of lines) {
                          const params = line.trim().split(" ");
                          if (params.length > 3) {
                            return Promise.reject(
                              new Error(t("pleaseEnterCorrectBatchList")),
                            );
                          }
                          const [url] = params;
                          if (!/^(https?):\/\/.+|^magnet:\?.+/.test(url)) {
                            return Promise.reject(
                              new Error(t("pleaseEnterCorrectBatchList")),
                            );
                          }
                        }
                        return Promise.resolve();
                      },
                    },
                  ]}
                >
                  <BatchUrlTextarea
                    rows={5}
                    placeholder={t("videoLikeDescription")}
                    onContextMenu={() =>
                      contextMenu.show([
                        { key: "copy", label: t("copy") },
                        { key: "paste", label: t("paste") },
                      ])
                    }
                  />
                </Form.Item>
              );
            }}
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {(formInstance) => {
              const { category, batch } = formInstance.getFieldsValue();
              // 磁力类（单任务）才出现输入方式切换：粘贴磁力链接 / 上传种子文件
              if (category !== "magnet" || batch) {
                return null;
              }
              return (
                <Form.Item name="magnetMode" label={t("magnetInputMode")}>
                  <Radio.Group
                    options={[
                      { label: t("magnetModeLink"), value: "magnet" },
                      { label: t("magnetModeTorrent"), value: "torrent" },
                    ]}
                    optionType="button"
                    buttonStyle="solid"
                  />
                </Form.Item>
              );
            }}
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {(formInstance) => {
              if (formInstance.getFieldValue("batch") && !isEdit) {
                return null;
              }
              const { category, magnetMode } = formInstance.getFieldsValue();
              const isMagnet = category === "magnet";
              const isNormal = category === "normal";
              const files = torrentMeta?.files ?? null;
              const allIndexes = files?.map((f) => f.index) ?? [];
              const allSelected =
                files !== null && selectedFiles.length === allIndexes.length;
              // 内容清单（磁力链接解析成功 / 种子文件上传 共用）：多层级
              // 目录树渲染 + 分文件类型筛选 + 已选汇总，勾选 → --select-file
              const renderFileList = () => {
                if (!files || files.length === 0) return null;
                const tree = buildMagnetTree(files);
                const visibleTree = filterMagnetTree(tree, typeFilter);
                const typeCounts = new Map<string, number>();
                for (const f of files) {
                  const tp = magnetFileTypeOf(f.path);
                  typeCounts.set(tp, (typeCounts.get(tp) || 0) + 1);
                }
                const selectedSize = files
                  .filter((f) => selectedFiles.includes(f.index))
                  .reduce((s, f) => s + f.size, 0);
                const toggleSubtree = (indexes: number[], checked: boolean) =>
                  setSelectedFiles((prev) =>
                    checked
                      ? [...new Set([...prev, ...indexes])]
                      : prev.filter((i) => !indexes.includes(i)),
                  );
                const toggleDir = (p: string) =>
                  setCollapsedDirs((cur) => {
                    const next = new Set(cur);
                    if (next.has(p)) next.delete(p);
                    else next.add(p);
                    return next;
                  });
                const renderNodes = (nodes: MagnetTreeNode[], depth: number): ReactNode[] =>
                  nodes.map((n) => {
                    if (!n.isDir) {
                      return (
                        <label
                          key={n.path}
                          className="flex cursor-pointer items-center gap-2 py-0.5"
                          style={{ paddingLeft: depth * 14 + 4 }}
                        >
                          <Checkbox
                            checked={selectedFiles.includes(n.indexes[0])}
                            onChange={(e) =>
                              setSelectedFiles((prev) =>
                                e.target.checked
                                  ? [...prev, n.indexes[0]]
                                  : prev.filter((i) => i !== n.indexes[0]),
                              )
                            }
                          />
                          <span className="min-w-0 flex-1 truncate text-xs" title={n.path}>
                            {n.name}
                          </span>
                          <span className="shrink-0 text-[11px] text-black/40 dark:text-white/40">
                            {fmtTreeSize(n.size)}
                          </span>
                        </label>
                      );
                    }
                    const collapsed = collapsedDirs.has(n.path);
                    const checkedCount = n.indexes.filter((i) =>
                      selectedFiles.includes(i),
                    ).length;
                    return [
                      <div
                        key={n.path}
                        className="flex items-center gap-1.5 rounded bg-black/[0.03] py-1 pr-2 dark:bg-white/[0.06]"
                        style={{ paddingLeft: depth * 14 + 4 }}
                      >
                        <button
                          type="button"
                          className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded text-black/40 hover:text-blue-500 dark:text-white/40"
                          onClick={() => toggleDir(n.path)}
                          aria-label={collapsed ? "展开目录" : "折叠目录"}
                        >
                          {collapsed ? "▸" : "▾"}
                        </button>
                        <Checkbox
                          checked={checkedCount === n.indexes.length}
                          indeterminate={checkedCount > 0 && checkedCount < n.indexes.length}
                          onChange={(e) => toggleSubtree(n.indexes, e.target.checked)}
                        />
                        <span
                          className="min-w-0 flex-1 cursor-pointer truncate text-xs font-semibold"
                          onClick={() => toggleDir(n.path)}
                          title={n.path}
                        >
                          {n.name}
                        </span>
                        <span className="shrink-0 text-[11px] text-black/40 dark:text-white/40">
                          {n.children.length} 项 · {fmtTreeSize(n.size)}
                        </span>
                      </div>,
                      ...(!collapsed ? renderNodes(n.children, depth + 1) : []),
                    ];
                  });
                const rendered = renderNodes(visibleTree, 0);
                return (
                  <Form.Item label={t("torrentContent")}>
                    <div className="rounded-lg border border-black/5 p-2 dark:border-white/10">
                      <div className="mb-1.5 flex flex-wrap gap-1" aria-label="文件类型筛选">
                        <button
                          type="button"
                          className={`rounded-full border px-2.5 py-0.5 text-[11px] ${typeFilter === "all" ? "border-transparent bg-blue-500 text-white" : "border-black/10 text-black/60 hover:border-blue-400 hover:text-blue-500 dark:border-white/15 dark:text-white/60"}`}
                          onClick={() => setTypeFilter("all")}
                        >
                          全部 {files.length}
                        </button>
                        {MAGNET_FILE_TYPES.filter((tp) => (typeCounts.get(tp.key) || 0) > 0).map((tp) => (
                          <button
                            key={tp.key}
                            type="button"
                            className={`rounded-full border px-2.5 py-0.5 text-[11px] ${typeFilter === tp.key ? "border-transparent bg-blue-500 text-white" : "border-black/10 text-black/60 hover:border-blue-400 hover:text-blue-500 dark:border-white/15 dark:text-white/60"}`}
                            onClick={() => setTypeFilter(typeFilter === tp.key ? "all" : tp.key)}
                          >
                            {tp.label} {typeCounts.get(tp.key)}
                          </button>
                        ))}
                      </div>
                      <div className="max-h-56 overflow-auto">
                        {rendered.length > 0 ? (
                          rendered
                        ) : (
                          <p className="py-3 text-center text-xs text-black/40 dark:text-white/40">
                            该类型下没有文件
                          </p>
                        )}
                      </div>
                      <div className="mt-1.5 flex items-center gap-2 border-t border-black/5 pt-1.5 text-xs text-black/50 dark:border-white/10 dark:text-white/50">
                        <Checkbox
                          checked={allSelected}
                          indeterminate={!allSelected && selectedFiles.length > 0}
                          onChange={(e) =>
                            setSelectedFiles(e.target.checked ? allIndexes : [])
                          }
                        >
                          {t("torrentSelectAll")}
                        </Checkbox>
                        <span className="ml-auto">
                          已选 {selectedFiles.length}/{files.length} 个 ·{" "}
                          {fmtTreeSize(selectedSize)}
                        </span>
                      </div>
                    </div>
                  </Form.Item>
                );
              };
              // 磁力（种子文件模式）：上传 .torrent → 服务端解析预填名称与
              // 内容清单；任务 url 用服务端落盘路径，不再手输链接
              if (isMagnet && magnetMode === "torrent") {
                return (
                  <>
                    <Form.Item label={t("torrentFile")} required>
                      <Upload
                        accept=".torrent"
                        maxCount={1}
                        showUploadList={false}
                        beforeUpload={(file) => {
                          void handleTorrentUpload(file);
                          return false;
                        }}
                      >
                        <Button
                          icon={<PaperClipOutlined />}
                          loading={uploading}
                        >
                          {t("selectTorrentFile")}
                        </Button>
                      </Upload>
                      {torrentMeta && (
                        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {torrentMeta.name} · {torrentMeta.path}
                        </div>
                      )}
                    </Form.Item>
                    {renderFileList()}
                  </>
                );
              }
              return (
                <>
                  <Form.Item
                    name="url"
                    label={
                      isMagnet
                        ? t("magnetUrlLabel")
                        : isNormal
                          ? t("fileLinkLabel")
                          : t("videoLink")
                    }
                    required
                    rules={[
                      {
                        required: true,
                        message: t("pleaseEnterOnlineVideoUrl"),
                      },
                      {
                        // 磁力类只接受 magnet:（无 //）；普通/视频类走 file/http(s)/ftp 直链
                        pattern: isMagnet
                          ? /^magnet:\?.+/
                          : /^(file|https?|ftp):\/\/.+/,
                        message: isMagnet
                          ? t("pleaseEnterCorrectMagnetLink")
                          : t("pleaseEnterCorrectVideoLink"),
                      },
                    ]}
                  >
                    <Input
                      placeholder={
                        isMagnet
                          ? t("btUrlPlaceholder")
                          : isNormal
                            ? t("fileUrlPlaceholder")
                            : t("pleaseEnterOnlineVideoUrlOrDragM3U8Here")
                      }
                      onContextMenu={() =>
                        contextMenu.show([
                          { key: "copy", label: t("copy") },
                          { key: "paste", label: t("paste") },
                        ])
                      }
                      onDrop={(e) => {
                        if (isMagnet) return; // 磁力不接受文件拖拽（种子走上传）
                        const file = e.dataTransfer.files[0] as File & {
                          path: string;
                        };
                        formInstance.setFieldValue(
                          "url",
                          `file://${file.path}`,
                        );
                        formInstance.validateFields(["url"]);
                      }}
                    />
                  </Form.Item>
                  {isMagnet && (
                    <Form.Item label={t("torrentFile")} required>
                      {/* 磁力链接：自动/手动解析状态行 —— 解析完成才能创建任务 */}
                      {magnetResolving ? (
                        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                          <Spin size="small" />
                          {t("magnetResolving")}
                        </div>
                      ) : torrentMeta ? (
                        <div className="text-xs text-emerald-600 dark:text-emerald-400">
                          {t("torrentParsed")}：{torrentMeta.name} ·{" "}
                          {t("engineQbittorrent")}
                          {torrentMeta.existed
                            ? ` · ${t("magnetExistedResume")}`
                            : ""}
                        </div>
                      ) : (
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {t("magnetResolveHint")}
                        </div>
                      )}
                    </Form.Item>
                  )}
                  {isMagnet && renderFileList()}
                </>
              );
            }}
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {(formInstance) => {
              // 保存目录只能从内置目录选择（按文件类型落盘）；编辑旧任务时
              // folder 可能是非内置值（影视分类/剧名）——兜底追加一个选项展示
              const cur = formInstance.getFieldValue("folder");
              const folderOptions: Array<{ value: string; label: string }> =
                BUILTIN_FOLDER_KEYS.map((k) => ({
                  value: k,
                  label: t(`builtinDir_${k}`),
                }));
              if (
                typeof cur === "string" &&
                cur !== "" &&
                !(BUILTIN_FOLDER_KEYS as readonly string[]).includes(cur)
              ) {
                folderOptions.push({ value: cur, label: cur });
              }
              return (
                <Form.Item
                  name="folder"
                  label={t("saveDir")}
                  rules={[
                    {
                      required: true,
                      message: t("pleaseSelectSaveDir"),
                    },
                  ]}
                >
                  <Select
                    placeholder={t("pleaseSelectSaveDir")}
                    options={folderOptions}
                  />
                </Form.Item>
              );
            }}
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {(formInstance) => {
              const { category, subtype, batch } =
                formInstance.getFieldsValue();
              // headers 只对视频类的流媒体 / MediaGo 且单任务有意义
              if (
                !(
                  category === "video" &&
                  (subtype === "m3u8" || subtype === "mediago") &&
                  !batch
                )
              ) {
                return null;
              }
              return (
                <Form.Item label={t("additionalHeaders")} name="headers">
                  <TextArea
                    rows={4}
                    placeholder={t("additionalHeadersDescription")}
                    onContextMenu={() =>
                      contextMenu.show([
                        { key: "copy", label: t("copy") },
                        { key: "paste", label: t("paste") },
                      ])
                    }
                  />
                </Form.Item>
              );
            }}
          </Form.Item>
        </Form>
      </Modal>
    );
  },
);
