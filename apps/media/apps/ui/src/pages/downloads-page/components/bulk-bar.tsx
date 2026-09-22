// 批量管理共享件（对标迅雷下载列表）：
//   BulkBar —— 全选三态 + 已选计数 + 动作区（按钮由调用方按面板语义定制）
//   ListSearch —— 名称过滤搜索框（前端过滤，各面板/任务列表共用）
// 注意：本模块被多页面 chunk 顶层引用，禁止模块级调用 React hook。
import { Button, Input } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { type FC, type ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";

export const BulkBar: FC<{
  checked: boolean | "indeterminate";
  selectedCount: number;
  total: number;
  onSelectAll: (checked: boolean) => void;
  /** 动作区按钮（删除/取消/开始等，含 disabled 态由调用方控制） */
  children?: ReactNode;
}> = ({ checked, selectedCount, total, onSelectAll, children }) => (
  <div className="flex flex-row items-center justify-between pb-2 pl-1">
    <div className="flex flex-row items-center gap-3">
      <Checkbox checked={checked} onCheckedChange={(v) => onSelectAll(!!v)} />
      <span
        className="cursor-pointer select-none text-sm text-[#343434] dark:text-white"
        onClick={() => onSelectAll(true)}
      >
        全选
      </span>
      {selectedCount > 0 && (
        <span className="text-xs text-[#A4A4A4] dark:text-[#6B6D72]">
          已选 {selectedCount}/{total} 项
        </span>
      )}
    </div>
    <div className="flex flex-row items-center gap-2">{children}</div>
  </div>
);

/** 名称过滤搜索框（前端过滤；clearable） */
export const ListSearch: FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}> = ({ value, onChange, placeholder }) => (
  <Input
    allowClear
    size="small"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder ?? "搜索"}
    prefix={<SearchOutlined className="text-black/30 dark:text-white/30" />}
    className="w-48"
  />
);

/** 三态全选值：全选中= true / 全未选= false / 部分= indeterminate */
export const triState = (selectedCount: number, total: number): boolean | "indeterminate" => {
  if (selectedCount === 0) return false;
  if (selectedCount >= total) return true;
  return "indeterminate";
};

/** 切换集合成员（通用选中集合操作；纯函数，不可用 hook 包装） */
export const toggleInSet = <T,>(set: Set<T>, key: T): Set<T> => {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
};

/** 批量动作按钮（统一 disabled 样式逻辑：无选中即禁用） */
export const BulkButton: FC<{
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}> = ({ disabled, danger, onClick, children }) => (
  <Button size="small" disabled={disabled} danger={danger} onClick={onClick}>
    {children}
  </Button>
);
