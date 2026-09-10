// api/sse —— Go internal/api/sse/hub.go 的复刻：客户端注册 + 事件广播

export interface SSEEvent {
  name: string;
  data: unknown;
}

type Client = (evt: SSEEvent) => void;

/** SSE Hub：维护已连接客户端，向全部客户端广播事件 */
export class Hub {
  private clients = new Set<Client>();

  subscribe(client: Client): void {
    this.clients.add(client);
  }

  unsubscribe(client: Client): void {
    this.clients.delete(client);
  }

  broadcast(name: string, data: unknown): void {
    const evt: SSEEvent = { name, data };
    for (const client of this.clients) {
      try {
        client(evt);
      } catch {
        // 单个客户端写失败不影响其他客户端
      }
    }
  }
}
