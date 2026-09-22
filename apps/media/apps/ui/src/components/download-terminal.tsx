import { type FC, type ReactNode, useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerminal } from "@xterm/xterm";
import { cn } from "@/utils";
import { usePlatform } from "@/hooks/use-platform";
import useSWR from "swr";
import { getDownloadLog } from "@/api/download-task";

interface TerminalProps {
  className?: string;
  id: number;
  header?: ReactNode;
}

const Terminal: FC<TerminalProps> = ({ className, id, header }) => {
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const { on, off } = usePlatform();
  const { data } = useSWR({ key: "download-log", args: id }, ({ args }) =>
    getDownloadLog(args),
  );

  // xterm 实例与「已写入内容」都挂在 ref 上：SWR refetch 只 append 增量，
  // 不销毁重建（重建会闪屏、丢滚动位置与选中内容）
  const termRef = useRef<{ term: XTerminal; fit: FitAddon } | null>(null);
  const writtenRef = useRef("");

  // 生命周期 effect：只在 id 变化时创建/销毁实例
  useEffect(() => {
    if (!terminalRef.current) return;

    const terminal = new XTerminal({
      fontFamily: "Consolas, 'Courier New', monospace",
      disableStdin: true,
      cursorBlink: false,
      allowProposedApi: true,
      convertEol: true,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalRef.current);
    fitAddon.fit();
    termRef.current = { term: terminal, fit: fitAddon };
    writtenRef.current = "";

    // Copy-on-shortcut. xterm doesn't bind Ctrl+C / Cmd+C to "copy
    // selection" by default (it passes them through as control chars).
    // Since stdin is disabled for this read-only log view, hijacking
    // those keys is safe — when there's a selection we copy it and tell
    // xterm to stop handling the event; otherwise we let it through.
    terminal.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== "keydown") return true;
      const isCopy =
        (ev.ctrlKey || ev.metaKey) &&
        !ev.altKey &&
        !ev.shiftKey &&
        ev.key.toLowerCase() === "c";
      if (!isCopy) return true;
      const sel = terminal.getSelection();
      if (!sel) return true;
      void navigator.clipboard.writeText(sel).catch(() => {
        /* clipboard API may be unavailable in non-secure contexts; ignore */
      });
      ev.preventDefault();
      return false;
    });

    // on/off 的 Callback 契约是 (...args: unknown[])，载荷在 [1] 位起
    const onDownloadMessage = (...args: unknown[]) => {
      const messageId = args[1] as number;
      const message = args[2] as string;
      if (id === messageId) {
        termRef.current?.term.write(message);
      }
    };

    const resize = () => {
      termRef.current?.fit.fit();
    };

    on("download-message", onDownloadMessage);
    window.addEventListener("resize", resize);

    return () => {
      off("download-message", onDownloadMessage);
      window.removeEventListener("resize", resize);
      termRef.current = null;
      writtenRef.current = "";
      terminal.dispose();
    };
  }, [id, on, off]);

  // 数据 effect：日志快照变化只写增量（依赖不含实例本身，避免重建）
  useEffect(() => {
    const inst = termRef.current;
    const log = data?.log ?? "";
    if (!inst || !log || log === writtenRef.current) return;
    // 日志被服务端截断/轮转（不再以已写内容为前缀）→ 整体重置重写
    if (
      log.length < writtenRef.current.length ||
      !log.startsWith(writtenRef.current)
    ) {
      inst.term.reset();
      writtenRef.current = "";
    }
    inst.term.write(log.slice(writtenRef.current.length));
    writtenRef.current = log;
  }, [data]);

  return (
    <div className={cn("flex flex-col", className)}>
      {header}
      <div className="flex-1">
        <div ref={terminalRef} />
      </div>
    </div>
  );
};

export default Terminal;
