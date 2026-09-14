import {
  ClearOutlined,
  CopyOutlined,
  DownloadOutlined,
  FolderOpenOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { useMemoizedFn } from "ahooks";
import {
  App,
  Badge,
  Button,
  Card,
  Form,
  type FormInstance,
  Input,
  InputNumber,
  Modal,
  Progress,
  Radio,
  Select,
  Space,
  Switch,
  Tabs,
} from "antd";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import PageContainer from "@/components/page-container";
import { CHECK_UPDATE } from "@/const";
import { usePlatform } from "@/hooks/use-platform";
import { useEnvPath } from "@/hooks/use-config";
import { setConfigValue } from "@/api/config";
import {
  exportFavorites as exportFavoritesApi,
  importFavorites,
} from "@/api/favorite";
import {
  appStoreSelector,
  setAppStoreSelector,
  useAppStore,
} from "@/store/app";
import { updateSelector, useSessionStore } from "@/store/session";
import { isWeb, tdApp } from "@/utils";
import { AppLanguage, AppStore, AppTheme } from "@mediago/shared-common";

const version = import.meta.env.APP_VERSION;

const SettingPage: React.FC = () => {
  const { dialog, shell, browser, contextMenu, update, on, off, app } =
    usePlatform();
  const { t } = useTranslation();
  const formRef = useRef<FormInstance<AppStore>>(null);
  const settings = useAppStore(useShallow(appStoreSelector));
  const { setAppStore } = useAppStore(useShallow(setAppStoreSelector));
  const { envPath } = useEnvPath();
  const { message } = App.useApp();
  const { updateAvailable, updateChecking } = useSessionStore(
    useShallow(updateSelector),
  );
  const [openUpdateModal, setOpenUpdateModal] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [updateDownloaded, setUpdateDownloaded] = useState(false);

  // Mounting all 6 cards + ~25 Form.Items in one render produces a
  // ~300ms long task on navigation (dominated by Ant Design Form.Item
  // registration + cssinjs). Render one card per animation frame so the
  // longest task is just a single card (~50ms) — no individual frame is
  // long enough to feel janky.
  const [visibleCount, setVisibleCount] = useState(1);

  const isFirstSync = useRef(true);
  useEffect(() => {
    // initialValues already seeds the form on mount; the extra
    // setFieldsValue here would force Ant Form to diff every Form.Item
    // again right after mount, which is a meaningful slice of the jank.
    if (isFirstSync.current) {
      isFirstSync.current = false;
      return;
    }
    formRef.current?.setFieldsValue(settings);
  }, [settings]);

  // Mount remaining cards one per animation frame, so each task stays
  // short enough to avoid a visible freeze.
  useEffect(() => {
    if (visibleCount >= 6) return;
    const raf = requestAnimationFrame(() => {
      setVisibleCount((c) => c + 1);
    });
    return () => cancelAnimationFrame(raf);
  }, [visibleCount]);

  const onSelectDir = useMemoizedFn(async () => {
    const paths = await dialog.open({ type: "directory" });
    const local = paths?.[0];
    if (local) {
      await setConfigValue("local", local);
      setAppStore({ local });
      formRef.current?.setFieldValue("local", local);
    }
  });

  const renderButtonLabel = useMemoizedFn(() => {
    if (isWeb) {
      return t("localDir");
    }

    return (
      <Button onClick={onSelectDir} icon={<FolderOpenOutlined />}>
        {t("selectFolder")}
      </Button>
    );
  });

  const onFormValueChange = useMemoizedFn(async (values: Partial<AppStore>) => {
    try {
      // 嵌套字段（aria2）的服务端 conf.set 是整对象替换：变更回调里只带
      // 变更子键（{aria2:{connections:3}}），直接提交会丢其它子键 ——
      // 从 form 取全量 aria2 再提交
      if (values.aria2 !== undefined) {
        const fullAria2 = formRef.current?.getFieldValue("aria2");
        if (fullAria2) {
          await setConfigValue("aria2", fullAria2);
          setAppStore({ aria2: fullAria2 });
          return;
        }
      }
      await Promise.all(
        Object.entries(values)
          .filter(([, value]) => value !== undefined && value !== null)
          .map(([key, value]) => setConfigValue(key, value)),
      );
      setAppStore(values);
    } catch (e: unknown) {
      message.error((e as Error).message);
    }
  });

  const onMenuClick = useMemoizedFn(async (_) => {
    try {
      const contents = await dialog.open({
        type: "file",
        filters: [{ name: "JSON", extensions: ["json"] }],
        readContent: true,
      });
      if (!contents?.length) return;
      const favorites = JSON.parse(contents[0]);
      if (Array.isArray(favorites)) {
        await importFavorites(favorites);
      }
      message.success(t("importFavoriteSuccess"));
    } catch {
      message.error(t("importFavoriteFailed"));
    }
  });

  const handleExportFavorite = useMemoizedFn(async () => {
    try {
      const content = await exportFavoritesApi();
      await dialog.save({
        content:
          typeof content === "string"
            ? content
            : JSON.stringify(content, null, 2),
        defaultPath: "favorites.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      message.success(t("exportFavoriteSuccess"));
    } catch {
      message.error(t("exportFavoriteFailed"));
    }
  });

  const handleCheckUpdate = useMemoizedFn(async () => {
    tdApp.onEvent(CHECK_UPDATE);
    setOpenUpdateModal(true);
    await update.check();
  });

  const handleHiddenUpdateModal = useMemoizedFn(() => {
    setOpenUpdateModal(false);
  });

  const handleUpdate = useMemoizedFn(() => {
    update.startDownload();
  });

  const handleInstallUpdate = useMemoizedFn(() => {
    update.install();
  });

  useEffect(() => {
    const onDownloadProgress = (
      _event: unknown,
      progress: { percent: number },
    ) => {
      setDownloadProgress(progress.percent);
    };
    const onDownloaded = () => {
      setUpdateDownloaded(true);
    };
    on("update:downloadProgress", onDownloadProgress);
    on("update:downloaded", onDownloaded);

    return () => {
      off("update:downloadProgress", onDownloadProgress);
      off("update:downloaded", onDownloaded);
    };
  }, []);

  const handleClearWebviewCache = useMemoizedFn(async () => {
    try {
      await browser.clearCache();
      message.success(t("clearCacheSuccess"));
    } catch {
      message.error(t("clearCacheFailed"));
    }
  });

  const cardSections: Array<{
    key: string;
    title: string;
    hidden?: boolean;
    children: React.ReactNode;
  }> = useMemo<
    Array<{
      key: string;
      title: string;
      hidden?: boolean;
      children: React.ReactNode;
    }>
  >(
    () =>
      [
        {
          key: "1",
          title: t("basicSetting"),
          children: (
            <>
              <Form.Item name="local" label={renderButtonLabel()}>
                <Input disabled placeholder={t("pleaseSelectDownloadDir")} />
              </Form.Item>
              <Form.Item
                hidden={isWeb}
                name="theme"
                label={t("downloaderTheme")}
              >
                <Select
                  options={[
                    { label: t("followSystem"), value: AppTheme.System },
                    { label: t("dark"), value: AppTheme.Dark },
                    { label: t("light"), value: AppTheme.Light },
                  ]}
                  placeholder={t("pleaseSelectTheme")}
                  allowClear={false}
                />
              </Form.Item>
              <Form.Item name="language" label={t("displayLanguage")}>
                <Select
                  options={[
                    { label: t("followSystem"), value: AppLanguage.System },
                    { label: t("chinese"), value: AppLanguage.ZH },
                    { label: t("english"), value: AppLanguage.EN },
                  ]}
                  placeholder={t("pleaseSelectLanguage")}
                  allowClear={false}
                />
              </Form.Item>
              <Form.Item
                hidden={isWeb}
                label={t("downloadPrompt")}
                name="promptTone"
              >
                <Switch />
              </Form.Item>
              <Form.Item label={t("showTerminal")} name="showTerminal">
                <Switch />
              </Form.Item>
              <Form.Item
                hidden={isWeb}
                label={t("autoUpgrade")}
                tooltip={t("autoUpgradeTooltip")}
                name="autoUpgrade"
              >
                <Switch />
              </Form.Item>
              <Form.Item
                hidden={isWeb}
                label={t("allowBetaVersion")}
                name="allowBeta"
              >
                <Switch />
              </Form.Item>
              <Form.Item
                hidden={isWeb}
                label={t("closeMainWindow")}
                name="closeMainWindow"
              >
                <Radio.Group>
                  <Radio value={true}>{t("close")}</Radio>
                  <Radio value={false}>{t("minimizeToTray")}</Radio>
                </Radio.Group>
              </Form.Item>
              <Form.Item
                label={t("enableMobilePlayer")}
                name="enableMobilePlayer"
                hidden={isWeb}
              >
                <Switch />
              </Form.Item>
            </>
          ),
        },
        {
          key: "2",
          hidden: isWeb,
          title: t("browserSetting"),
          children: !isWeb && (
            <>
              <Form.Item label={t("audioMuted")} name="audioMuted">
                <Switch />
              </Form.Item>
              <Form.Item label={t("openInNewWindow")} name="openInNewWindow">
                <Switch />
              </Form.Item>
              <Form.Item name="proxy" label={t("proxySetting")}>
                <Input
                  placeholder={t("pleaseEnterProxy")}
                  onContextMenu={() =>
                    contextMenu.show([
                      { key: "copy", label: t("copy") },
                      { key: "paste", label: t("paste") },
                    ])
                  }
                />
              </Form.Item>
              <Form.Item
                name="useProxy"
                label={t("proxySwitch")}
                rules={[
                  {
                    validator(rules, value) {
                      if (
                        value &&
                        formRef.current?.getFieldValue("proxy") === ""
                      ) {
                        return Promise.reject(t("pleaseEnterProxyFirst"));
                      }
                      return Promise.resolve();
                    },
                  },
                ]}
              >
                <Switch />
              </Form.Item>
              <Form.Item label={t("blockAds")} name="blockAds">
                <Switch />
              </Form.Item>
              <Form.Item label={t("enterMobileMode")} name="isMobile">
                <Switch />
              </Form.Item>
              <Form.Item
                label={t("useImmersiveSniffing")}
                tooltip={t("immersiveSniffingDescription")}
                name="useExtension"
              >
                <Switch />
              </Form.Item>
              <Form.Item
                label={t("privacy")}
                tooltip={t("privacyTooltip")}
                name="privacy"
              >
                <Switch />
              </Form.Item>
              <Form.Item label={t("moreAction")}>
                <Space wrap>
                  <Button
                    onClick={handleClearWebviewCache}
                    icon={<ClearOutlined />}
                  >
                    {t("clearCache")}
                  </Button>
                  <Button onClick={handleExportFavorite}>
                    <DownloadOutlined />
                    {t("exportFavorite")}
                  </Button>

                  <Button onClick={onMenuClick}>
                    <UploadOutlined />
                    {t("importFavorite")}
                  </Button>
                </Space>
              </Form.Item>
            </>
          ),
        },
        {
          key: "3",
          title: t("downloadSetting"),
          children: (
            <>
              <Form.Item hidden={!isWeb} name="proxy" label={t("proxySetting")}>
                <Input
                  placeholder={t("pleaseEnterProxy")}
                  onContextMenu={() =>
                    contextMenu.show([
                      { key: "copy", label: t("copy") },
                      { key: "paste", label: t("paste") },
                    ])
                  }
                />
              </Form.Item>
              <Form.Item
                name="downloadProxySwitch"
                label={t("downloadProxySwitch")}
                rules={[
                  {
                    validator(rules, value) {
                      if (
                        value &&
                        formRef.current?.getFieldValue("proxy") === ""
                      ) {
                        return Promise.reject(t("pleaseEnterProxyFirst"));
                      }
                      return Promise.resolve();
                    },
                  },
                ]}
              >
                <Switch />
              </Form.Item>
              <Form.Item label={t("deleteSegments")} name="deleteSegments">
                <Switch />
              </Form.Item>
              <Form.Item
                label={t("maxRunner")}
                tooltip={t("maxRunnerDescription")}
                name="maxRunner"
              >
                <InputNumber min={1} max={50} precision={0} />
              </Form.Item>
            </>
          ),
        },
        {
          key: "4",
          title: t("dockerSetting"),
          hidden: isWeb,
          children: (
            <>
              <Form.Item name="apiKey" label={t("apiKey")}>
                <Input
                  placeholder={t("pleaseEnterApiKey")}
                  onContextMenu={() =>
                    contextMenu.show([
                      { key: "copy", label: t("copy") },
                      { key: "paste", label: t("paste") },
                    ])
                  }
                />
              </Form.Item>
              <Form.Item name="dockerUrl" label={t("dockerUrl")}>
                <Input
                  placeholder={t("pleaseEnterDockerUrl")}
                  onContextMenu={() =>
                    contextMenu.show([
                      { key: "copy", label: t("copy") },
                      { key: "paste", label: t("paste") },
                    ])
                  }
                />
              </Form.Item>
              <Form.Item label={t("enableDocker")} name="enableDocker">
                <Switch />
              </Form.Item>
            </>
          ),
        },
        {
          key: "5",
          title: t("skillsSetting"),
          children: (() => {
            const coreUrl = envPath?.playerUrl
              ? envPath.playerUrl.replace(/\/player\/$/, "")
              : "";
            const apiKey = settings.apiKey || "";
            let setupCmd: string;
            if (isWeb) {
              // Server/Docker mode: need both URL and API key
              const url = coreUrl || "http://localhost:8899";
              setupCmd = apiKey
                ? `Set mediago url to ${url}, api key to ${apiKey}`
                : `Set mediago url to ${url}`;
            } else {
              // Electron mode: only need URL
              setupCmd = coreUrl
                ? `Set mediago url to ${coreUrl}`
                : "Set mediago url to http://localhost:39719";
            }
            const installCmd = t("skillsInstallCmd");
            return (
              <>
                <Form.Item
                  label={t("skillsInstall")}
                  tooltip={t("skillsInstallTooltip")}
                >
                  <Space.Compact className="w-full">
                    <Input value={installCmd} readOnly className="font-mono" />
                    <Button
                      icon={<CopyOutlined />}
                      onClick={() => {
                        navigator.clipboard.writeText(installCmd);
                        message.success(t("skillsCopied"));
                      }}
                    >
                      {t("skillsCopy")}
                    </Button>
                  </Space.Compact>
                </Form.Item>
                <Form.Item
                  label={t("skillsInit")}
                  tooltip={t("skillsInitTooltip")}
                >
                  <Space.Compact className="w-full">
                    <Input value={setupCmd} readOnly className="font-mono" />
                    <Button
                      icon={<CopyOutlined />}
                      onClick={() => {
                        navigator.clipboard.writeText(setupCmd);
                        message.success(t("skillsCopied"));
                      }}
                    >
                      {t("skillsCopy")}
                    </Button>
                  </Space.Compact>
                </Form.Item>
              </>
            );
          })(),
        },
        {
          key: "6",
          title: t("moreSettings"),
          children: (
            <>
              <Form.Item hidden={!isWeb} name="apiKey" label={t("apiKey")}>
                <Input disabled />
              </Form.Item>
              <Form.Item hidden={isWeb} label={t("moreAction")}>
                <Space wrap>
                  <Button
                    onClick={() =>
                      envPath?.configDir && shell.open(envPath.configDir)
                    }
                    icon={<FolderOpenOutlined />}
                  >
                    {t("configDir")}
                  </Button>
                  <Button
                    onClick={() =>
                      envPath?.binDir && shell.open(envPath.binDir)
                    }
                    icon={<FolderOpenOutlined />}
                  >
                    {t("binPath")}
                  </Button>
                  <Button
                    onClick={() => settings.local && shell.open(settings.local)}
                    icon={<FolderOpenOutlined />}
                  >
                    {t("localDir")}
                  </Button>
                  <Button
                    onClick={async () => {
                      const dir = await app.getExtensionDir();
                      if (dir) shell.open(dir);
                    }}
                    icon={<FolderOpenOutlined />}
                  >
                    {t("extensionDir")}
                  </Button>
                </Space>
              </Form.Item>
              <Form.Item label={t("currentVersion")}>
                <Space wrap>
                  <div>{version}</div>
                  {!isWeb && (
                    <Badge dot={updateAvailable}>
                      <Button type="text" onClick={handleCheckUpdate}>
                        {t("checkUpdate")}
                      </Button>
                    </Badge>
                  )}
                </Space>
              </Form.Item>
            </>
          ),
        },
      ].filter((item) => !item.hidden),
    [
      // Form.Items subscribe to the form store by name, so we don't need
      // the full settings object here — only the two fields that are read
      // directly inside the JSX (skillsSetting IIFE and the "open local"
      // button). Keeping the dep list narrow lets the memo survive most
      // SSE config-changed updates.
      t,
      settings.apiKey,
      settings.local,
      envPath,
      updateAvailable,
      renderButtonLabel,
      onMenuClick,
      handleExportFavorite,
      handleClearWebviewCache,
      handleCheckUpdate,
      contextMenu,
      shell,
      message,
    ],
  );

  return (
    <PageContainer title={t("setting")}>
      <div className="h-full overflow-auto px-1 py-2">
        <Form<AppStore>
          ref={formRef}
          layout="horizontal"
          labelAlign="left"
          labelCol={{ flex: "140px" }}
          wrapperCol={{ flex: "1 1 auto" }}
          colon={false}
          initialValues={settings}
          onValuesChange={onFormValueChange}
        >
          <Tabs
            defaultActiveKey="general"
            items={[
              {
                key: "general",
                label: t("generalSetting"),
                // 懒挂载：常规 tab 的卡片逐帧出现（保留原有渲染优化）
                children: (
                  <div className="gap-4 md:columns-2">
                    {cardSections.slice(0, visibleCount).map((section) => (
                      <div
                        key={section.key}
                        className="mb-4 block break-inside-avoid"
                      >
                        <Card
                          title={section.title}
                          size="small"
                          variant="borderless"
                        >
                          {section.children}
                        </Card>
                      </div>
                    ))}
                  </div>
                ),
              },
              {
                key: "engine",
                label: t("engineSetting"),
                // 下载引擎（aria2）：普通下载 / 磁力下载共用；服务端 conf.aria2
                // 驱动（buildArgs 动态注入），保存即热更新（新任务立即生效）
                children: (
                  <div className="flex flex-col gap-4">
                    <Card
                      title={t("aria2CommonSection")}
                      size="small"
                      variant="borderless"
                    >
                      <Form.Item
                        label={t("aria2Connections")}
                        tooltip={t("aria2ConnectionsTooltip")}
                        name={["aria2", "connections"]}
                      >
                        <InputNumber min={1} max={16} precision={0} />
                      </Form.Item>
                      <Form.Item
                        label={t("aria2Splits")}
                        tooltip={t("aria2SplitsTooltip")}
                        name={["aria2", "splits"]}
                      >
                        <InputNumber min={1} max={128} precision={0} />
                      </Form.Item>
                      <Form.Item
                        label={t("aria2MinSplitSize")}
                        tooltip={t("aria2MinSplitSizeTooltip")}
                        name={["aria2", "minSplitSize"]}
                      >
                        <Input placeholder="1M" />
                      </Form.Item>
                      <Form.Item
                        label={t("aria2SpeedLimit")}
                        tooltip={t("aria2SpeedLimitTooltip")}
                        name={["aria2", "speedLimit"]}
                      >
                        <Input
                          placeholder={t("aria2SpeedSizePlaceholder")}
                          onContextMenu={() =>
                            contextMenu.show([
                              { key: "copy", label: t("copy") },
                              { key: "paste", label: t("paste") },
                            ])
                          }
                        />
                      </Form.Item>
                      <Form.Item
                        label={t("aria2MaxTries")}
                        name={["aria2", "maxTries"]}
                      >
                        <InputNumber min={0} max={99} precision={0} />
                      </Form.Item>
                      <Form.Item
                        label={t("aria2RetryWait")}
                        name={["aria2", "retryWait"]}
                      >
                        <InputNumber min={0} max={60} precision={0} />
                      </Form.Item>
                    </Card>
                    <Card
                      title={t("aria2BtSection")}
                      size="small"
                      variant="borderless"
                    >
                      <Form.Item
                        label={t("aria2EnableDht")}
                        tooltip={t("aria2EnableDhtTooltip")}
                        name={["aria2", "bt", "enableDht"]}
                      >
                        <Switch />
                      </Form.Item>
                      <Form.Item
                        label={t("aria2EnableLpd")}
                        name={["aria2", "bt", "enableLpd"]}
                      >
                        <Switch />
                      </Form.Item>
                      <Form.Item
                        label={t("aria2EnablePex")}
                        name={["aria2", "bt", "enablePex"]}
                      >
                        <Switch />
                      </Form.Item>
                      <Form.Item
                        label={t("aria2ListenPort")}
                        tooltip={t("aria2ListenPortTooltip")}
                        name={["aria2", "bt", "listenPort"]}
                      >
                        <Input placeholder={t("aria2PortPlaceholder")} />
                      </Form.Item>
                      <Form.Item
                        label={t("aria2UploadLimit")}
                        tooltip={t("aria2UploadLimitTooltip")}
                        name={["aria2", "bt", "uploadLimit"]}
                      >
                        <Input
                          placeholder={t("aria2SpeedSizePlaceholder")}
                          onContextMenu={() =>
                            contextMenu.show([
                              { key: "copy", label: t("copy") },
                              { key: "paste", label: t("paste") },
                            ])
                          }
                        />
                      </Form.Item>
                      <Form.Item
                        label={t("aria2MaxPeers")}
                        name={["aria2", "bt", "maxPeers"]}
                      >
                        <InputNumber min={1} max={999} precision={0} />
                      </Form.Item>
                      <Form.Item
                        label={t("aria2BtTrackers")}
                        tooltip={t("aria2BtTrackersTooltip")}
                        name={["aria2", "bt", "trackers"]}
                      >
                        <Input.TextArea
                          rows={3}
                          placeholder={t("aria2TrackersPlaceholder")}
                          onContextMenu={() =>
                            contextMenu.show([
                              { key: "copy", label: t("copy") },
                              { key: "paste", label: t("paste") },
                            ])
                          }
                        />
                      </Form.Item>
                    </Card>
                  </div>
                ),
              },
            ]}
          />
        </Form>
      </div>

      <Modal
        title={t("updateModal")}
        open={openUpdateModal}
        onCancel={handleHiddenUpdateModal}
        footer={
          updateAvailable
            ? [
                <Button key="hidden" onClick={handleHiddenUpdateModal}>
                  {t("close")}
                </Button>,
                updateDownloaded ? (
                  <Button
                    key="install"
                    type="primary"
                    onClick={handleInstallUpdate}
                  >
                    {t("install")}
                  </Button>
                ) : (
                  <Button key="update" type="primary" onClick={handleUpdate}>
                    {t("update")}
                  </Button>
                ),
              ]
            : [
                <Button key="hidden" onClick={handleHiddenUpdateModal}>
                  {t("close")}
                </Button>,
              ]
        }
      >
        <div className="flex min-h-28 flex-col justify-center">
          {updateChecking
            ? t("checkingForUpdates")
            : updateAvailable
              ? t("updateAvailable")
              : t("updateNotAvailable")}
          {!updateChecking && updateAvailable && (
            <Progress percent={updateDownloaded ? 100 : downloadProgress} />
          )}
        </div>
      </Modal>
    </PageContainer>
  );
};

export default SettingPage;
