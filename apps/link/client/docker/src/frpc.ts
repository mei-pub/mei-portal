import { spawn, type ChildProcess } from "node:child_process";
import { cleanFrpcLogLine, isFrpcDisconnected, isFrpcLoginSuccess } from "./frpc-log.ts";

export class FrpcProcess {
  private child?: ChildProcess;
  private connected = false;
  private readonly bin: string;

  constructor(bin: string) { this.bin = bin; }

  running() { return !!this.child && this.child.exitCode === null; }
  isConnected() { return this.running() && this.connected; }

  start(configPath: string, onLine: (line: string) => void, onExit: (code: number) => void, onDisconnect?: () => void) {
    this.stop();
    this.connected = false;
    this.child = spawn(this.bin, ["-c", configPath], { stdio: ["ignore", "pipe", "pipe"] });
    for (const stream of [this.child.stdout, this.child.stderr]) {
      let pending = "";
      stream?.on("data", data => {
        pending += String(data);
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() || "";
        for (const rawLine of lines) {
          if (isFrpcLoginSuccess(rawLine)) this.connected = true;
          // 掉线后 frpc 进程仍然活着，必须靠日志把连接态降下来，
          // 否则门户会一直误报「已连接」，自动重连永远不会触发。
          else if (this.connected && isFrpcDisconnected(rawLine)) {
            this.connected = false;
            onDisconnect?.();
          }
          const line = cleanFrpcLogLine(rawLine);
          if (line) onLine(line);
        }
      });
    }
    this.child.on("exit", code => {
      this.connected = false;
      onExit(code ?? 1);
    });
  }

  stop() {
    this.connected = false;
    if (this.running()) this.child!.kill("SIGTERM");
  }
}
