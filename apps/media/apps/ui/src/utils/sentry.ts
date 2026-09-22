import {
  init,
  browserTracingIntegration,
  replayIntegration,
} from "@sentry/electron/renderer";
import { init as reactInit } from "@sentry/react";
import { isWeb } from ".";

if (isWeb) {
  reactInit({
    dsn: import.meta.env.APP_SENTRY_DSN,
    sendDefaultPii: true,
    release: import.meta.env.APP_VERSION,
    environment: import.meta.env.MODE,
  });
} else {
  init(
    {
      sendDefaultPii: true,
      integrations: [browserTracingIntegration(), replayIntegration()],
      tracesSampleRate: 1.0,
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1.0,
      _experiments: { enableLogs: true },
      release: import.meta.env.APP_VERSION,
      environment: import.meta.env.MODE,
    },
    // @sentry/react 与 @sentry/electron 内部 SDK 版本存在 skew，renderer 侧
    // 复用 reactInit 是既定运行时行为，此处仅做类型桥接
    reactInit as unknown as Parameters<typeof init>[1],
  );
}
