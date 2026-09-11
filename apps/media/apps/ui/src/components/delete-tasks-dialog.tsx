// 统一删除交互（下载中心三面板 + 媒体任务列表共用）
// 规则：
//   - 全部未完成（downloading/pending/failed/stopped）：删除必然停止任务并
//     级联清理临时文件（半成品没有保留价值）→ 两钮确认（删除/取消）
//   - 含已完成：三选一 —— 仅删记录 / 删除记录和文件 / 取消。
//     未完成部分仍总是清理临时文件（与用户选择无关）
// Promise 接口：confirmDelete 返回 true（删文件）/ false（仅删记录）/ null（取消）
import { useRef, useState } from "react";
import { Button, Modal } from "antd";

export interface DeleteConfirmOptions {
  /** 未完成任务数（将停止下载并清理临时文件） */
  unfinished: number;
  /** 已完成任务数（需要用户选择是否删文件） */
  done: number;
  /** 主文案：任务名或条数描述（如 "《流浪地球2》第 1 集" / "3 个任务"） */
  label: string;
}

export function useDeleteTasks() {
  const [state, setState] = useState<DeleteConfirmOptions | null>(null);
  const resolverRef = useRef<((v: boolean | null) => void) | null>(null);

  const close = (value: boolean | null) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setState(null);
  };

  const confirmDelete = (opts: DeleteConfirmOptions) =>
    new Promise<boolean | null>((resolve) => {
      resolverRef.current = resolve;
      setState(opts);
    });

  const deleteDialog = state && (
    <Modal
      open
      title={`删除${state.label}？`}
      onCancel={() => close(null)}
      okButtonProps={{ style: { display: "none" } }}
      cancelButtonProps={{ style: { display: "none" } }}
      width={420}
      styles={{ body: { paddingTop: 8 } }}
    >
      <div className="text-sm text-[rgba(0,0,0,0.75)] dark:text-[rgba(255,255,255,0.75)]">
        {state.done > 0
          ? state.unfinished > 0
            ? `未完成任务（${state.unfinished} 项）将停止下载并清理临时文件。已完成的是否同时删除已下载文件？`
            : "任务已下载完成，是否同时删除已下载的文件？"
          : "将停止下载任务，并清理已下载的临时文件。"}
      </div>
      <div className="mt-5 flex flex-row justify-end gap-2">
        <Button onClick={() => close(null)}>取消</Button>
        {state.done > 0 && (
          <Button onClick={() => close(false)}>仅删记录</Button>
        )}
        <Button
          danger
          type="primary"
          onClick={() => close(true)}
        >
          {state.done > 0 ? "删除记录和文件" : "删除"}
        </Button>
      </div>
    </Modal>
  );

  return { confirmDelete, deleteDialog };
}
