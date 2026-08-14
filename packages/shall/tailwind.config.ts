import type { Config } from 'tailwindcss';

/**
 * Tailwind 配置 —— 仅用于蜘蛛纸牌游戏组件（SpiderSolitaire.tsx）
 * Shell 门户本身使用 tokens.css + inline styles，不依赖 Tailwind。
 * content 仅扫描 SpiderSolitaire 组件，避免生成无关 CSS。
 *
 * 重要：preflight 已禁用（corePlugins.preflight = false），
 * 避免重置 button/h1 等元素样式污染 Shell 门户和蜘蛛纸牌以外的页面。
 * 蜘蛛纸牌需要的样式全部通过 Tailwind utilities + inline style 提供。
 */
const config: Config = {
  content: [
    './src/components/SpiderSolitaire.tsx',
    './src/app/games/**/*.{ts,tsx}',
  ],
  // 禁用 preflight（基础样式重置），避免与 Shell globals.css 冲突
  // preflight 会重置 button 的 background/border，导致 Shell 顶栏按钮样式丢失
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
