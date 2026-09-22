const ansiControlSequence = /\u001B\[[0-?]*[ -/]*[@-~]/g;

export function cleanFrpcLogLine(line: string): string | null {
  const cleaned = line.replace(ansiControlSequence, "").trim();
  if (!cleaned) return null;
  // These are produced by our own status polling and otherwise flood the log.
  if (cleaned.includes("[http/middleware.go:") && /http (request|response):/.test(cleaned)) return null;
  return cleaned;
}

export function isFrpcLoginSuccess(line: string): boolean {
  return cleanFrpcLogLine(line)?.includes("login to server success") ?? false;
}

/**
 * 识别「已经登录成功后又掉线」的日志。
 *
 * frpc 在连接建立后掉线并不会退出进程（它自己会重连），因此仅靠进程存活判断连接态
 * 会让门户长期误报「已连接」，自动重连也就永远不会触发。这里把 frpc 自述的掉线/
 * 重连日志作为连接态复位的依据。
 */
export function isFrpcDisconnected(line: string): boolean {
  const cleaned = cleanFrpcLogLine(line);
  if (!cleaned) return false;
  return /i\/o deadline reached|connection to server (?:was )?(?:closed|lost)|try to reconnect to server|reconnect to server error|control connection closed|read message error|heartbeat timeout|connect to server error/i.test(cleaned);
}
