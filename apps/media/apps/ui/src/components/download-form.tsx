import {
  CloudDownloadOutlined,
  DockerOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { useAsyncEffect, useMemoizedFn } from "ahooks";
import {
  App,
  AutoComplete,
  Button,
  Form,
  Input,
  Modal,
  Segmented,
  Select,
  Switch,
} from "antd";
import { forwardRef, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { ADD_TO_LIST, DOWNLOAD_NOW } from "@/const";
import { usePlatform } from "@/hooks/use-platform";
import { createDownloadTasks, getDownloadFolders } from "@/api/download-task";
import { useDockerApi } from "@/hooks/use-docker-api";
import { appStoreSelector, useAppStore } from "@/store/app";
import { downloadFormSelector, useConfigStore } from "@/store/config";
import { tdApp } from "@/utils";
import { DownloadTask, DownloadType } from "@mediago/shared-common";
import { BatchUrlTextarea } from "./batchurl-textarea";

const { TextArea } = Input;

/** 下载大类：普通下载（直链文件）/ 视频下载（站点流媒体）/ 磁力下载（BT）。
 *  三类执行路径与表单形态完全不同，先选大类再细分 —— 大类决定 URL 校验、
 *  名称可空性、headers 显隐；视频类内部再由 subtype 细分下载器 */
export type DownloadCategory = "normal" | "video" | "magnet";

/** 具体下载类型 → 大类（外部 ref 接口与编辑回填仍以 DownloadType 进出） */
const CATEGORY_OF_TYPE: Record<DownloadType, DownloadCategory> = {
  direct: "normal",
  m3u8: "video",
  bilibili: "video",
  youtube: "video",
  mediago: "video",
  bt: "magnet",
};

/** 大类默认下载类型（video 的细分由 subtype 决定） */
const TYPE_OF_CATEGORY: Record<DownloadCategory, DownloadType> = {
  normal: DownloadType.direct,
  video: DownloadType.m3u8,
  magnet: DownloadType.bt,
};

export interface DownloadFormItem {
  batch?: boolean;
  batchList?: string;
  name?: string;
  type?: DownloadType;
  category?: DownloadCategory;
  subtype?: DownloadType;
  headers?: string;
  url?: string;
  id?: number;
  folder?: string;
}

export interface DownloadFormProps {
  isEdit?: boolean;
  destroyOnClose?: boolean;
  onFormVisibleChange?: (open: boolean) => void;
  onConfirm?: (values: DownloadFormItem) => void;
  id: string;
}

export interface DownloadFormRef {
  setFieldsValue: (value: DownloadFormItem) => void;
  getFieldsValue: () => DownloadFormItem;
  openModal: (value: DownloadFormItem) => void;
}

export interface DownloadTaskForm extends DownloadTask {
  batch?: boolean;
  batchList?: string;
}

interface Options {
  label: string;
  value: string;
}

export default forwardRef<DownloadFormRef, DownloadFormProps>(
  function DownloadForm(
    { isEdit, destroyOnClose, onFormVisibleChange, id, onConfirm },
    ref,
  ) {
    const { enableDocker } = useAppStore(useShallow(appStoreSelector));
    const [modalOpen, setModalOpen] = useState(false);
    const [form] = Form.useForm<DownloadFormItem>();
    const { t } = useTranslation();
    const { message } = App.useApp();
    const { setLastDownloadTypes, setLastIsBatch } = useConfigStore(
      useShallow(downloadFormSelector),
    );
    const [folders, setFolders] = useState<Options[]>([]);
    const [videoFolders, setVideoFolders] = useState<string[]>([]);
    const { contextMenu } = usePlatform();
    const { addVideosToDocker } = useDockerApi();

    useAsyncEffect(async () => {
      if (modalOpen) {
        try {
          const fetchedFolders = await getDownloadFolders();
          if (Array.isArray(fetchedFolders)) {
            setVideoFolders(fetchedFolders);
            setFolders(() =>
              fetchedFolders.map((f) => ({
                value: f,
                label: f,
              })),
            );
          }
        } catch {
          // Go Core may not be ready yet, ignore
        }
      }
    }, [modalOpen]);

    useImperativeHandle(ref, () => {
      // 外部（侧栏/嗅探弹层/编辑回填）都以 DownloadType 传入；表单内部
      // 用大类+细分驱动 UI，type 只在提交时映射回去
      const applyValue = (value: DownloadFormItem) => {
        const { type, subtype, ...rest } = value;
        const patch: DownloadFormItem = { ...rest };
        if (type) {
          const category = CATEGORY_OF_TYPE[type] ?? "video";
          patch.category = category;
          // 非 video 大类的旧 subtype 残留不携带（切回视频类避免显示错值）
          if (category === "video") patch.subtype = subtype ?? type;
        }
        form.setFieldsValue(patch);
      };
      return {
        openModal: (value) => {
          setModalOpen(true);
          // Defer so the Form is mounted before setting values
          queueMicrotask(() => applyValue(value));
        },
        setFieldsValue: (value) => {
          applyValue(value);
        },
        getFieldsValue: () => {
          return form.getFieldsValue();
        },
      };
    }, []);

    /** 表单当前大类 → 提交用 DownloadType（video 细分缺失回 m3u8） */
    const formType = useMemoizedFn((): DownloadType => {
      const { category, subtype } = form.getFieldsValue();
      if (category === "video") {
        return subtype ?? DownloadType.m3u8;
      }
      if (category) {
        return TYPE_OF_CATEGORY[category];
      }
      return DownloadType.m3u8; // 未设置（理论不可达：initialValues 有默认）
    });

    const handleValuesChange = useMemoizedFn(
      (values: Record<string, unknown>) => {
        const { category, subtype, batch } = values;
        if (category || subtype) {
          const cat =
            (category as DownloadCategory) ??
            form.getFieldValue("category") ??
            "video";
          const type =
            cat === "video"
              ? ((subtype as DownloadType) ??
                form.getFieldValue("subtype") ??
                DownloadType.m3u8)
              : TYPE_OF_CATEGORY[cat];
          setLastDownloadTypes(type);
        }
        if (batch !== null && batch !== undefined) {
          setLastIsBatch(batch);
        }
      },
    );

    const afterOpenChange = useMemoizedFn((open: boolean) => {
      onFormVisibleChange?.(open);

      if (!open) {
        form.resetFields();
      }
    });

    const handleSave = useMemoizedFn(async () => {
      try {
        await form.validateFields();
      } catch {
        return;
      }

      try {
        const tasks = await getFormItems();
        await createDownloadTasks(tasks);
        // Badge increments via the "download-create" SSE event
        // (apps/ui/src/api/events.ts); drives both the main window and
        // the overlay-dialog WebContents from a single source.
        setModalOpen(false);
        onConfirm?.(form.getFieldsValue());
        tdApp.onEvent(ADD_TO_LIST, { id });
      } catch (e: unknown) {
        message.error((e as Error)?.message || t("pleaseEnterCorrectFormInfo"));
      }
    });

    const handleAddToDocker = useMemoizedFn(async () => {
      try {
        await form.validateFields();
      } catch {
        return;
      }

      try {
        const tasks = await getFormItems();
        await addVideosToDocker({ items: tasks });

        message.success(t("addToDockerSuccess"));
      } catch (e: unknown) {
        message.error((e as Error)?.message || t("pleaseEnterCorrectFormInfo"));
      }
    });

    const handleDownloadNow = useMemoizedFn(async () => {
      try {
        await form.validateFields();
      } catch {
        return;
      }
      try {
        const tasks = await getFormItems();
        await createDownloadTasks(tasks, true);
        // Badge increments via the "download-create" SSE event; see
        // handleSave comment.
        setModalOpen(false);
        onConfirm?.(form.getFieldsValue());
        tdApp.onEvent(DOWNLOAD_NOW, { id });
      } catch (e: unknown) {
        message.error((e as Error)?.message || t("pleaseEnterCorrectFormInfo"));
      }
    });

    const handleSearchFolder = useMemoizedFn((val: string) => {
      return setFolders(() => {
        const videoOptions = videoFolders.map((f) => ({ value: f, label: f }));
        if (!val) return videoOptions;
        return [{ value: val, label: val }, ...videoOptions];
      });
    });

    const getFormItems = useMemoizedFn(async () => {
      const { batch } = form.getFieldsValue();
      const type = formType();
      if (batch) {
        const { batchList = "", headers } = form.getFieldsValue();

        const tasks: Omit<DownloadTask, "id">[] = await Promise.all(
          batchList.split("\n").map(async (line: string) => {
            const [url, customName, folder] = line.trim().split(" ");
            return {
              url: url.trim(),
              name: customName?.trim(),
              headers,
              type,
              folder,
            };
          }),
        );

        return tasks;
      } else {
        const { name = "", url = "", headers, folder } = form.getFieldsValue();

        const task: Omit<DownloadTask, "id"> = {
          name,
          url,
          headers,
          type,
          folder,
        };

        return [task];
      }
    });

    return (
      <Modal
        open={modalOpen}
        key={isEdit ? "edit" : "new"}
        title={isEdit ? t("editDownload") : t("newDownload")}
        width={500}
        onCancel={() => setModalOpen(false)}
        afterOpenChange={afterOpenChange}
        destroyOnHidden={destroyOnClose}
        footer={[
          <Button key="cancel" onClick={() => setModalOpen(false)}>
            {t("cancel")}
          </Button>,
          enableDocker && (
            <Button
              key="docker"
              onClick={handleAddToDocker}
              icon={<DockerOutlined />}
            >
              {t("addToDocker")}
            </Button>
          ),
          <Button
            key="submit"
            onClick={handleSave}
            icon={<UnorderedListOutlined />}
          >
            {t("addToList")}
          </Button>,
          <Button
            key="link"
            type="primary"
            onClick={handleDownloadNow}
            icon={<CloudDownloadOutlined />}
          >
            {t("downloadNow")}
          </Button>,
        ]}
      >
        <Form
          form={form}
          autoFocus
          labelCol={{ span: 5 }}
          layout="horizontal"
          colon={false}
          initialValues={{ category: "video", subtype: "m3u8" }}
          onValuesChange={handleValuesChange}
        >
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>
          <Form.Item hidden={isEdit} label={t("batchDownload")} name={"batch"}>
            <Switch />
          </Form.Item>
          <Form.Item
            key="category"
            name="category"
            label={t("taskCategory")}
            rules={[
              {
                required: true,
                message: t("pleaseEnterCorrectFormInfo"),
              },
            ]}
          >
            <Segmented
              block
              disabled={isEdit}
              options={[
                { label: t("normalDownload"), value: "normal" },
                { label: t("videoDownload"), value: "video" },
                { label: t("magnetDownload"), value: "magnet" },
              ]}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {(formInstance) => {
              // 视频类才细分下载器；普通/磁力的执行路径由大类唯一确定
              if (formInstance.getFieldValue("category") !== "video") {
                return null;
              }
              return (
                <Form.Item
                  key="subtype"
                  name="subtype"
                  label={t("videoType")}
                  rules={[
                    {
                      required: true,
                      message: t("pleaseEnterVideoName"),
                    },
                  ]}
                >
                  <Select
                    disabled={isEdit}
                    options={[
                      {
                        label: t("streamMedia"),
                        value: "m3u8",
                      },
                      {
                        label: t("bilibiliMedia"),
                        value: "bilibili",
                      },
                      {
                        label: t("youtubeMedia"),
                        value: "youtube",
                      },
                      {
                        label: t("mediagoMedia"),
                        value: "mediago",
                      },
                    ]}
                    placeholder={t("pleaseSelectVideoType")}
                  />
                </Form.Item>
              );
            }}
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {(formInstance) => {
              const isBatch = formInstance.getFieldValue("batch");
              if (isBatch) {
                return null;
              }
              const { category, subtype } = formInstance.getFieldsValue();
              const isMagnet = category === "magnet";
              const isNormal = category === "normal";
              return (
                <Form.Item
                  shouldUpdate
                  name="name"
                  label={isNormal ? t("fileLabel") : t("videoName")}
                  rules={[
                    {
                      // 视频类的 bilibili 抓页面标题；磁力的落盘名由种子决定
                      //（dn/FILE 行回写）——都可留空；普通下载与其它视频源必填
                      required: !(
                        isMagnet ||
                        (category === "video" && subtype === "bilibili")
                      ),
                      message: t("pleaseEnterCorrectFormInfo"),
                    },
                  ]}
                >
                  <Input
                    placeholder={
                      isMagnet
                        ? t("btVideoNamePlaceholder")
                        : t("pleaseEnterVideoName")
                    }
                    onContextMenu={() =>
                      contextMenu.show([
                        { key: "copy", label: t("copy") },
                        { key: "paste", label: t("paste") },
                      ])
                    }
                  />
                </Form.Item>
              );
            }}
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {(formInstance) => {
              if (isEdit || !formInstance.getFieldValue("batch")) {
                return null;
              }
              return (
                <Form.Item
                  label={t("videoLink")}
                  name="batchList"
                  required
                  rules={[
                    {
                      required: true,
                      message: t("pleaseEnterVideoLink"),
                    },
                    {
                      validator: (_, value) => {
                        const lines = value.split("\n");
                        for (const line of lines) {
                          const params = line.trim().split(" ");
                          if (params.length > 3) {
                            return Promise.reject(
                              new Error(t("pleaseEnterCorrectBatchList")),
                            );
                          }
                          const [url] = params;
                          if (!/^(https?):\/\/.+|^magnet:\?.+/.test(url)) {
                            return Promise.reject(
                              new Error(t("pleaseEnterCorrectBatchList")),
                            );
                          }
                        }
                        return Promise.resolve();
                      },
                    },
                  ]}
                >
                  <BatchUrlTextarea
                    rows={5}
                    placeholder={t("videoLikeDescription")}
                    onContextMenu={() =>
                      contextMenu.show([
                        { key: "copy", label: t("copy") },
                        { key: "paste", label: t("paste") },
                      ])
                    }
                  />
                </Form.Item>
              );
            }}
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {(formInstance) => {
              if (formInstance.getFieldValue("batch") && !isEdit) {
                return null;
              }
              const isMagnet =
                formInstance.getFieldsValue().category === "magnet";
              const isNormal =
                formInstance.getFieldsValue().category === "normal";
              return (
                <Form.Item
                  name="url"
                  label={isNormal ? t("fileLinkLabel") : t("videoLink")}
                  required
                  rules={[
                    {
                      required: true,
                      message: t("pleaseEnterOnlineVideoUrl"),
                    },
                    {
                      // 磁力类只接受 magnet:（无 //）；普通/视频类走 file/http(s)/ftp 直链
                      pattern: isMagnet
                        ? /^magnet:\?.+/
                        : /^(file|https?|ftp):\/\/.+/,
                      message: t("pleaseEnterCorrectVideoLink"),
                    },
                  ]}
                >
                  <Input
                    placeholder={
                      isMagnet
                        ? t("btUrlPlaceholder")
                        : t("pleaseEnterOnlineVideoUrlOrDragM3U8Here")
                    }
                    onContextMenu={() =>
                      contextMenu.show([
                        { key: "copy", label: t("copy") },
                        { key: "paste", label: t("paste") },
                      ])
                    }
                    onDrop={(e) => {
                      const file = e.dataTransfer.files[0] as File & {
                        path: string;
                      };
                      formInstance.setFieldValue("url", `file://${file.path}`);
                      formInstance.validateFields(["url"]);
                    }}
                  />
                </Form.Item>
              );
            }}
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {(formInstance) => {
              if (formInstance.getFieldValue("batch")) {
                return null;
              }
              return (
                <Form.Item name="folder" label={t("folder")}>
                  <AutoComplete
                    placeholder={t("pleaseInputVideoFolder")}
                    optionFilterProp="label"
                    options={folders}
                    onSearch={handleSearchFolder}
                  />
                </Form.Item>
              );
            }}
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {(formInstance) => {
              const { category, subtype, batch } =
                formInstance.getFieldsValue();
              // headers 只对视频类的流媒体 / MediaGo 且单任务有意义
              if (
                !(
                  category === "video" &&
                  (subtype === "m3u8" || subtype === "mediago") &&
                  !batch
                )
              ) {
                return null;
              }
              return (
                <Form.Item label={t("additionalHeaders")} name="headers">
                  <TextArea
                    rows={4}
                    placeholder={t("additionalHeadersDescription")}
                    onContextMenu={() =>
                      contextMenu.show([
                        { key: "copy", label: t("copy") },
                        { key: "paste", label: t("paste") },
                      ])
                    }
                  />
                </Form.Item>
              );
            }}
          </Form.Item>
        </Form>
      </Modal>
    );
  },
);
