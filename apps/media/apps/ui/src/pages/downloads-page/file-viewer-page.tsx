// 快速查看独立页（新窗口全屏）：/view?task=<id>
// 与详情侧栏共用 FileViewerContent 本体；经 /api/downloads/:id 拉「{success,data}
// 信封」拿任务本体（file/name/status）——data 即任务（/api/tasks/:id 不存在，
// 单任务详情在 /api/downloads/:id）。
import { Empty, Spin } from "antd";
import { type FC, useEffect, useState } from "react";
import { appFileUrl } from "@/api/download-center";
import { FileViewerContent, FileViewerHeader } from "./components/file-viewer";

interface FetchedTask {
  id: number;
  name?: string;
  file?: string;
  status?: string;
  exists?: boolean;
}

/** 产物文件名：file 相对路径取 basename；bt 目录产物退回任务名 */
const displayNameOf = (task: FetchedTask | null): string => {
  if (!task) return "";
  const file = task.file || "";
  if (file) return file.split("/").pop() || file.split("\\").pop() || task.name || "";
  return task.name || "";
};

const FileViewerPage: FC = () => {
  const taskId = (() => {
    const v = Number(new URLSearchParams(window.location.search).get("task"));
    return Number.isFinite(v) && v > 0 ? v : null;
  })();
  const [task, setTask] = useState<FetchedTask | null>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!taskId) {
      setFailed(true);
      setLoaded(true);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`/api/downloads/${taskId}`, {
          credentials: "include",
        });
        const payload = (await res.json()) as { data?: FetchedTask };
        if (!alive) return;
        if (payload?.data) {
          setTask(payload.data);
        } else {
          setFailed(true);
        }
      } catch {
        if (alive) setFailed(true);
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [taskId]);

  const fileName = displayNameOf(task);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#F4F6FB] p-4 dark:bg-[#18191C]">
      <div className="mx-auto flex min-h-0 w-full max-w-[1100px] flex-1 flex-col overflow-hidden rounded-2xl border border-black/[0.06] bg-white p-4 shadow-[0_1px_3px_rgba(16,24,40,0.08)] dark:border-white/[0.08] dark:bg-[#1F2024]">
        {loaded && task && !failed ? (
          <>
            <FileViewerHeader taskId={task.id} fileName={fileName} />
            <FileViewerContent
              url={appFileUrl(`files/${task.id}`)}
              fileName={fileName}
            />
          </>
        ) : loaded ? (
          <div className="flex flex-1 items-center justify-center">
            <Empty description={taskId ? "任务不存在或服务不可用" : "缺少任务参数（/view?task=<id>）"} imageStyle={{ height: 56 }} />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <Spin size="small" />
          </div>
        )}
      </div>
    </div>
  );
};

export default FileViewerPage;
