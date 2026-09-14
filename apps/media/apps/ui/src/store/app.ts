import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import i18n from "../i18n";
import { resolveAppLanguage } from "../utils";
import { AppLanguage, AppStore, AppTheme } from "@mediago/shared-common";
import { persist } from "zustand/middleware";

const initialState: AppStore = {
  local: "",
  promptTone: true,
  proxy: "",
  useProxy: false,
  deleteSegments: true,
  openInNewWindow: false,
  theme: AppTheme.System,
  useExtension: false,
  isMobile: false,
  maxRunner: 2,
  language: AppLanguage.System,
  showTerminal: false,
  privacy: false,
  machineId: "",
  downloadProxySwitch: false,
  autoUpgrade: true,
  audioMuted: true,
  enableMobilePlayer: false,
  blockAds: true,
  allowBeta: false,
  enableDocker: false,
  dockerUrl: "",
  closeMainWindow: false,
  apiKey: "",
  // 与 core-ts server.ts appStoreDefaults.aria2 / configSetKey 回源对齐；
  // 服务端 normalizeAria2Options 兜底，这里保持结构完整供 Form initialValues
  aria2: {
    connections: 16,
    splits: 16,
    minSplitSize: "1M",
    speedLimit: "",
    maxTries: 5,
    retryWait: 0,
    bt: {
      enableDht: true,
      enableLpd: true,
      enablePex: true,
      listenPort: "",
      uploadLimit: "",
      maxPeers: 55,
      trackers: "",
    },
  },
};

type Actions = {
  setAppStore: (values: Partial<AppStore>) => void;
};

export const useAppStore = create<AppStore & Actions>()(
  immer(
    persist(
      (set) => ({
        ...initialState,
        setAppStore: (values) =>
          set((state) => {
            const { language } = values;
            if (language) {
              i18n.changeLanguage(resolveAppLanguage(language));
            }

            Object.entries(values).forEach(([key, val]) => {
              (state as any)[key] = val;
            });
          }),
      }),
      {
        name: "appstore-storage",
      },
    ),
  ),
);

export const appStoreSelector = (state: AppStore & Actions) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { setAppStore, ...appStore } = state;
  return appStore;
};

export const setAppStoreSelector = (state: AppStore & Actions) => {
  return { setAppStore: state.setAppStore };
};
