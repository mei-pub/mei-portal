import { QrcodeOutlined } from "@ant-design/icons";
import { DownloadFilter } from "@mediago/shared-common";
import { useMemoizedFn } from "ahooks";
import { Modal, Pagination, Popover, QRCode } from "antd";
import { type FC, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { FolderIcon } from "@/assets/svg";
import DownloadForm, {
  type DownloadFormItem,
  type DownloadFormRef,
} from "@/components/download-form";
import { HomeDownloadButton } from "@/components/home-download-button";
import PageContainer from "@/components/page-container";
import { Button } from "@/components/ui/button";
import { CLICK_DOWNLOAD } from "@/const";
import { usePlatform } from "@/hooks/use-platform";
import { useEnvPath } from "@/hooks/use-config";
import { useTasks } from "@/hooks/use-tasks";
import { appStoreSelector, useAppStore } from "@/store/app";
import { downloadFormSelector, useConfigStore } from "@/store/config";
import { isWeb, tdApp } from "@/utils";
import { DownloadList } from "./components/download-list";
import { useUrlInvoke } from "@/hooks/use-url-invoke";

interface Props {
  filter?: DownloadFilter;
}

const HomePage: FC<Props> = ({ filter = DownloadFilter.list }) => {
  const { shell } = usePlatform();
  // 弹层打开"下载完成"页（同一组件按 done 过滤渲染，无路由依赖）
  const [doneOpen, setDoneOpen] = useState(false);
  const appStore = useAppStore(useShallow(appStoreSelector));
  const { t } = useTranslation();
  const newFormRef = useRef<DownloadFormRef>(null);
  const homeId = useId();
  const { lastIsBatch, lastDownloadTypes } = useConfigStore(
    useShallow(downloadFormSelector),
  );

  const { pagination, total, mutate, setPage, setPageSize } = useTasks(filter);
  const { envPath } = useEnvPath();

  useUrlInvoke({
    onOpenForm: (item: DownloadFormItem) => {
      newFormRef.current?.openModal(item);
    },
    refresh: () => {
      mutate();
    },
  });

  const handleChangePage = useMemoizedFn((page: number, pageSize: number) => {
    setPage(page);
    setPageSize(pageSize);
  });

  const handleOpenForm = useMemoizedFn(() => {
    tdApp.onEvent(CLICK_DOWNLOAD);
    const item: DownloadFormItem = {
      batch: lastIsBatch,
      type: lastDownloadTypes,
    };
    newFormRef.current?.openModal(item);
  });

  const handleConfirm = useMemoizedFn(async () => {
    mutate();
  });

  return (
    <PageContainer
      className="bg-white/85 dark:bg-[#1F2024] flex flex-col flex-1 min-h-0 h-full rounded-xl border border-black/5 shadow-sm p-3 gap-3 overflow-hidden"
    >
      <DownloadList filter={filter} />

      <Pagination
        className="flex justify-end"
        current={pagination.page}
        pageSize={pagination.pageSize}
        onChange={handleChangePage}
        total={total}
      />

      <DownloadForm
        id={homeId}
        ref={newFormRef}
        destroyOnClose
        onConfirm={handleConfirm}
      />

      <Modal
        open={doneOpen}
        onCancel={() => setDoneOpen(false)}
        footer={null}
        title={null}
        width="78%"
        styles={{ body: { height: "70vh", overflow: "auto", paddingTop: 8 } }}
        destroyOnHidden
      >
        {/* 标题由内嵌 HomePage 的 PageContainer 提供（downloadComplete），避免重复 */}
        <div className="h-full">
          <HomePage filter={DownloadFilter.done} />
        </div>
      </Modal>
    </PageContainer>
  );
};

export default HomePage;
