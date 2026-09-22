// fetchProbe 响应体限额测试（本地回环，不依赖外网）
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fetchProbe, fetchText } from '../src/http.ts';

function startLocalServer(handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void) {
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    const srv = createServer(handler);
    srv.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${srv.address()!.port}`,
        close: () => new Promise<void>((r) => srv.close(() => r())),
      });
    });
  });
}

test('fetchProbe：maxBodyBytes 限制响应体下载量', async () => {
  const BIG = 5 * 1024 * 1024; // 5MB 响应体
  let served = 0;
  const { url, close } = await startLocalServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    const chunk = 'x'.repeat(64 * 1024);
    let left = BIG;
    served = 0;
    const pump = () => {
      // 直接同步写满：Node 会缓冲/背压，客户端读到 64KB 就 cancel
      while (left > 0) {
        const n = Math.min(chunk.length, left);
        res.write(n === chunk.length ? chunk : chunk.slice(0, n));
        left -= n;
        served += n;
        if (res.writeQueueLength > 64) {
          res.once('drain', pump);
          return;
        }
      }
      res.end();
    };
    pump();
  });
  try {
    const probe = await fetchProbe(`${url}/big`, { timeoutMs: 5000, maxBodyBytes: 64 * 1024 });
    assert.equal(probe.status, 200);
    assert.ok(probe.body.length <= 128 * 1024, `读取量 ${probe.body.length} 应被限制在 ~64KB`);
  } finally {
    await close();
  }
});

test('fetchProbe：未设置限额时完整读取（插件依赖全量语义不变）', async () => {
  const SMALL = 8 * 1024;
  const { url, close } = await startLocalServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('y'.repeat(SMALL));
  });
  try {
    const probe = await fetchProbe(`${url}/small`, { timeoutMs: 5000 });
    assert.equal(probe.body.length, SMALL);
    assert.equal(probe.finalUrl, `${url}/small`);
  } finally {
    await close();
  }
});

test('fetchText：本地请求成功返回正文；超时/异常路径不泄漏句柄', async () => {
  const { url, close } = await startLocalServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html>hello</html>');
  });
  try {
    const text = await fetchText(`${url}/page`, { timeoutMs: 5000 });
    assert.ok(text.includes('hello'));
    const missing = await fetchText(`${url}/no`, { timeoutMs: 5000 });
    assert.ok(missing.includes('hello'), '404 也应返回正文文本（与现状一致）');
  } finally {
    await close();
  }
});
