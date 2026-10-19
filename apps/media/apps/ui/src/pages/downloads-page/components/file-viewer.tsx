// 快速查看（文本/图片/PDF 等可即时渲染的产物文件）——
// 侧栏嵌入（FileViewerDrawer）与新窗口全屏独立页（/view?task=..）共用本体。
// 数据源：/files/:id 应用内附件直链（任意扩展产物均可回拉）。
//   图片：<img> 直接渲染（Content-Disposition 不影响子资源渲染，可流式渐进）
//   文本：fetch 限长读取 → <pre>（保留原始排版；超大文件截断并提示）
//   PDF：fetch → blob objectURL → <iframe>（绕过附件 disposition，浏览器内渲染；
//        体积超限时退化为提示 + 下载到本机）
import { App, Button, Empty, Spin } from "antd";
import { DownloadOutlined, ExportOutlined, EyeOutlined } from "@ant-design/icons";
import { useMemoizedFn } from "ahooks";
import {
  type FC,
  useEffect,
  useState,
} from "react";
import { DownloadStatus, type DownloadTask } from "@mediago/shared-common";
import { appFileUrl } from "@/api/download-center";
import type { DownloadTaskDetails } from "@/hooks/use-tasks";

const IMAGE_EXT = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
  "avif",
]);
const TEXT_EXT = new Set([
  "txt",
  "log",
  "json",
  "md",
  "csv",
  "xml",
  "yaml",
  "yml",
  "srt",
  "ass",
  "vtt",
  "conf",
  "ini",
  "nfo",
  "html",
  "htm",
  "js",
  "mjs",
  "ts",
  "tsx",
  "jsx",
  "css",
  "py",
  "sh",
  "bat",
  "cmd",
  "toml",
  "env",
  "properties",
]);

export type QuickViewKind = "image" | "pdf" | "text" | null;

const extOf = (name?: string): string => {
  const base = (name || "").split(/[?#]/)[0];
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
};

/** 按文件名扩展归类快速查看能力 */
export const quickViewKindOf = (name?: string): QuickViewKind => {
  const ext = extOf(name);
  if (IMAGE_EXT.has(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (TEXT_EXT.has(ext)) return "text";
  return null;
};

/** 行操作区可用性：已成功且文件在盘、扩展名可快速渲染（媒体/音频走各自的播放） */
export const isQuickViewable = (task: DownloadTask | DownloadTaskDetails): boolean =>
  task.status === DownloadStatus.Success &&
  Boolean((task as { exists?: boolean }).exists) &&
  quickViewKindOf((task as { file?: string }).file || task.name || "") !== null;

/** 独立查看页地址（侧栏「新窗口打开全屏查看」入口；portal 部署需 /downloads 前缀） */
export const viewerPageUrl = (taskId: number): string =>
  appFileUrl(`view?task=${taskId}`);

const TEXT_LIMIT = 2 * 1024 * 1024; // 文本读取上限（2MB，超出截断）
const PDF_LIMIT = 64 * 1024 * 1024; // PDF objectURL 直载上限

type ContentState =
  | { phase: "loading" }
  | { phase: "image"; url: string }
  | { phase: "pdf"; url: string }
  | { phase: "text"; text: string; truncated: boolean }
  | { phase: "unsupported" }
  | { phase: "error"; message: string };

/** 查看正文：按扩展分类渲染（Image/PDF/Text），支持侧栏与全屏两种容器 */
export const FileViewerContent: FC<{ url: string; fileName: string }> = ({
  url,
  fileName,
}) => {
  const kind = quickViewKindOf(fileName);
  const [state, setState] = useState<ContentState>({ phase: "loading" });

  useEffect(() => {
    setState({ phase: "loading" });
    if (!kind) {
      setState({ phase: "unsupported" });
      return;
    }
    if (kind === "image") {
      setState({ phase: "image", url });
      return;
    }
    const controller = new AbortController();
    let objectUrl = "";
    void (async () => {
      try {
        const res = await fetch(url, { signal: controller.signal, credentials: "include" });
        if (!res.ok) {
          setState({
            phase: "error",
            message: `文件读取失败（HTTP ${res.status}）`,
          });
          return;
        }
        if (kind === "pdf") {
          const blob = await res.blob();
          if (blob.size > PDF_LIMIT) {
            setState({
              phase: "error",
              message: `PDF 体积 ${Math.round(blob.size / 1024 / 1024)}MB，超出浏览器内渲染上限，请「下载到本机」后查看。`,
            });
            return;
          }
          objectUrl = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
          setState({ phase: "pdf", url: objectUrl });
          return;
        }
        const blob = await res.blob();
        if (blob.size > TEXT_LIMIT) {
          const head = await blob.slice(0, TEXT_LIMIT).text();
          setState({ phase: "text", text: head, truncated: true });
          return;
        }
        setState({ phase: "text", text: await blob.text(), truncated: false });
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return;
        setState({ phase: "error", message: (e as Error)?.message || "文件读取失败" });
      }
    })();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [kind, url]);

  if (state.phase === "loading") {
    return (
      <div className="flex h-full min-h-[280px] flex-1 items-center justify-center">
        <Spin size="small" />
      </div>
    );
  }
  if (state.phase === "image") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
        <img
          src={state.url}
          alt={fileName}
          className="max-h-full max-w-full object-contain"
        />
      </div>
    );
  }
  if (state.phase === "pdf") {
    return (
      <iframe
        src={state.url}
        title={fileName}
        className="min-h-0 flex-1 rounded-lg border border-black/[0.06] bg-white dark:border-white/10"
      />
    );
  }
  if (state.phase === "text") {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <pre className="h-full w-full overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/[0.03] p-3 font-mono text-[12px] leading-[18px] text-gray-700 dark:bg-white/[0.04] dark:text-gray-200">
          {state.text}
        </pre>
        {state.truncated ? (
          <div className="shrink-0 pt-2 text-[11px] text-amber-600 dark:text-amber-400">
            文件过大，仅显示前 2MB 内容；如需完整查看请「下载到本机」。
          </div>
        ) : null}
      </div>
    );
  }
  if (state.phase === "error") {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <Empty description={state.message} imageStyle={{ height: 56 }} />
      </div>
    );
  }
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <Empty description="该文件类型不支持快速查看，可「下载到本机」后打开" imageStyle={{ height: 56 }} />
    </div>
  );
};

/** 查看头部条：文件名 + 新窗口全屏 + 下载到本机（侧栏/独立页共用） */
export const FileViewerHeader: FC<{
  fileName: string;
  taskId?: number;
  onClose?: () => void;
}> = ({ fileName, taskId, onClose }) => {
  const { message } = App.useApp();
  const download = useMemoizedFn(() => {
    window.location.href = appFileUrl(`files/${taskId}`);
    message.success("已开始下载到本机");
  });
  return (
    <div className="flex shrink-0 flex-row items-center gap-2 border-b border-black/[0.06] py-2.5 dark:border-white/[0.08]">
      <EyeOutlined className="shrink-0 text-gray-400" />
      <div
        className="min-w-0 flex-1 truncate text-[14px] font-medium text-gray-900 dark:text-gray-100"
        title={fileName}
      >
        {fileName}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {taskId ? (
          <>
            {/* 侧栏 = 半屏预览；同一查看页支持独立打开（新窗口全屏） */}
            <Button
              size="small"
              icon={<ExportOutlined />}
              title="新窗口全屏查看"
              onClick={() => openViewerPage(taskId)}
            >
              新窗口
            </Button>
            <Button
              size="small"
              icon={<DownloadOutlined />}
              title="下载到本机"
              onClick={download}
            >
              下载到本机
            </Button>
          </>
        ) : null}
        {onClose ? (
          <Button size="small" onClick={onClose}>
            关闭
          </Button>
        ) : null}
      </div>
    </div>
  );
};

/** 新窗口全屏查看页的入口动作（侧栏头部按钮用；window.open 同一查看页） */
export const openViewerPage = (taskId: number): void => {
  window.open(viewerPageUrl(taskId), "_blank", "noopener");
};
