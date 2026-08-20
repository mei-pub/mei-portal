// 面板预设分组（客户端/服务端共用，纯常量，禁止引入 node 模块）
// 固定 id：删除后服务端 normalize 会自动恢复

export interface PresetGroup {
  id: string;
  name: string;
}

export const PRESET_GROUPS: PresetGroup[] = [
  { id: 'g-builtin', name: '内置应用' },
  { id: 'g-default', name: '默认分组' },
];

export const PRESET_GROUP_IDS: ReadonlySet<string> = new Set(PRESET_GROUPS.map((g) => g.id));
export const BUILTIN_GROUP_ID = 'g-builtin';
export const DEFAULT_GROUP_ID = 'g-default';
