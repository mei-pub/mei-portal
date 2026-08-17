// 纯客户端安全的常量（无 node: 导入），供客户端组件引用
// 与 plugins.ts 的类型分离，避免把含 fs 的服务端模块拖入客户端 bundle。

export type Category =
  | 'media'
  | 'utility'
  | 'network'
  | 'game'
  | 'productivity'
  | 'other';

export const CATEGORY_LABELS: Record<Category, string> = {
  media: '影音',
  utility: '工具',
  network: '网络',
  game: '游戏',
  productivity: '效率',
  other: '其他',
};

// 客户端用的精简清单条目类型（去除服务端字段，可安全序列化进 props）
export interface ClientPlugin {
  id: string;
  name: string;
  description?: string;
  icon: string;
  category: Category;
  weight: number;
  url: string;
  subdomainPrefix?: string;
}
