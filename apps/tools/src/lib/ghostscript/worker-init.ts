export const COMPRESS_ACTION = 'compress-pdf';
export const PROTECT_ACTION = 'protect-pdf';

export async function compressWithGhostScript(dataStruct: {
  psDataURL: string;
}): Promise<string> {
  const worker = getWorker();
  worker.postMessage({
    data: { ...dataStruct, type: COMPRESS_ACTION },
    target: 'wasm'
  });
  return getListener(worker);
}

export async function protectWithGhostScript(dataStruct: {
  psDataURL: string;
}): Promise<string> {
  const worker = getWorker();
  worker.postMessage({
    data: { ...dataStruct, type: PROTECT_ACTION },
    target: 'wasm'
  });
  return getListener(worker);
}

const getListener = (worker: Worker): Promise<string> => {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener('message', listener);
      worker.removeEventListener('error', errorListener);
      worker.removeEventListener('messageerror', messageErrorListener);
    };
    const listener = (e: MessageEvent) => {
      cleanup();
      setTimeout(() => worker.terminate(), 0);
      resolve(e.data);
    };
    // worker 内部异常（wasm 加载失败、脚本错误）只触发 error/messageerror，
    // 不监听的话调用方 Promise 永久 pending，worker 实例也随之泄漏
    const fail = (message: string) => {
      cleanup();
      worker.terminate();
      reject(new Error(message));
    };
    const errorListener = () =>
      fail('PDF 处理 Worker 发生错误，请重试或刷新页面');
    const messageErrorListener = () =>
      fail('PDF 处理 Worker 返回的数据无法反序列化');
    worker.addEventListener('message', listener);
    worker.addEventListener('error', errorListener);
    worker.addEventListener('messageerror', messageErrorListener);
  });
};

const getWorker = () => {
  return new Worker(new URL('./background-worker.js', import.meta.url), {
    type: 'module'
  });
};
