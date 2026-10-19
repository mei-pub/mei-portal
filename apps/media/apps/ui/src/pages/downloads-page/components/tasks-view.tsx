import { useMemoizedFn } from "ahooks";
import {
  App,
  Button,
  Dropdown,
} from "antd";
import {
  AppstoreOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  DashboardOutlined,
  FolderOutlined,
  MoreOutlined,
  RestOutlined,
  SortAscendingOutlined,
  TagsOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DownloadList } from "@/pages/home-page/components/download-list";
import { DownloadFilter } from "@mediago/shared-common";
import { http } from "@/utils";

/**
 * 任务视图(复刻 FluxDown 控制台「下载」页):
 * 状态页签(全部/等待中/下载中/已暂停/已完成/未完成/失败,由 DownloadList
 * 内化)+ 分组(不分组/按队列/按协议)+ 排序(添加时间/大小/速度)+
 * 显示已完成 + 全部暂停/恢复(引擎原生口)+ 清理无效任务(文件重扫)。
 * 任务表本身复用 DownloadList(SSE 进度/右键菜单/批量/删除级联)。
 * 全局速度条由页面顶栏承载(控制台 header 形态)。
 */

export type TasksGroupKey = "none" | "queue" | "protocol";
export type TasksSortKey = "added" | "size" | "speed";

export const TasksView = ({
  initialFilter,
  onOpenNew,
}: {
  initialFilter?: string;
  onOpenNew?: () => void;
}) => {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [group, setGroup] = useState<TasksGroupKey>("none");
  const [sort, setSort] = useState<TasksSortKey>("added");
  const [showDone, setShowDone] = useState(true);

  const cleanInvalid = useMemoizedFn(async () => {
    try {
      await http.post("/api/downloads/engine-rescan");
      message.success(t("engineRescanDone"));
    } catch (e: unknown) {
      message.error((e as Error)?.message || t("pleaseEnterCorrectFormInfo"));
    }
  });

  // 单行工具条扩展:单个「⋯」整理菜单承载二级视图控制(分组/排序/显示已完成)
  // 与三级维护操作(清理无效);一级过滤=状态页签,批量起停=列表工具条按钮。
  const toolbarExtra = (
    <Dropdown
      menu={{
        selectable: true,
        selectedKeys: [group, sort],
        items: [
          {
            key: "group",
            icon: <UnorderedListOutlined />,
            label: t("groupBy"),
            children: [
              { key: "none", icon: <AppstoreOutlined />, label: t("groupNone") },
              { key: "queue", icon: <UnorderedListOutlined />, label: t("groupQueue") },
              { key: "protocol", icon: <TagsOutlined />, label: t("groupProtocol") },
            ],
          },
          {
            key: "sort",
            icon: <SortAscendingOutlined />,
            label: t("sortBy"),
            children: [
              { key: "added", icon: <ClockCircleOutlined />, label: t("sortAdded") },
              { key: "size", icon: <FolderOutlined />, label: t("sortSize") },
              { key: "speed", icon: <DashboardOutlined />, label: t("sortSpeed") },
            ],
          },
          { type: "divider" },
          {
            key: "showDone",
            icon: showDone ? (
              <CheckOutlined />
            ) : (
              <span className="inline-block w-3.5" />
            ),
            label: t("showDone"),
          },
          { type: "divider" },
          { key: "clean", icon: <RestOutlined />, label: t("cleanInvalid") },
        ],
        onClick: ({ key }) => {
          if (key === "none" || key === "queue" || key === "protocol") {
            setGroup(key as TasksGroupKey);
          } else if (key === "added" || key === "size" || key === "speed") {
            setSort(key as TasksSortKey);
          } else if (key === "showDone") {
            setShowDone((v) => !v);
          } else if (key === "clean") {
            void cleanInvalid();
          }
        },
      }}
    >
      <Button size="small" icon={<MoreOutlined />} title={t("more")} />
    </Dropdown>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* 任务表:全部类型混排 + 状态页签 + 分组/排序扩展(单行工具条) + SSE + 右键 + 批量 */}
      <DownloadList
        filter={DownloadFilter.all}
        taskType={undefined}
        showDone={showDone}
        groupKey={group}
        sortKey={sort}
        initialStatus={initialFilter}
        onOpenNew={onOpenNew}
        toolbarExtra={toolbarExtra}
      />
    </div>
  );
};
