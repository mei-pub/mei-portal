'use client';
// 文档与帮助：各应用帮助页（原生渲染，门户风格，渲染于 SettingsShell 右侧容器）
import { useParams } from 'next/navigation';
import MeiIcon from '@/components/MeiIcon';
import SettingsShell from '@/components/SettingsShell';

interface HelpSection { title: string; body: string[] }
interface HelpDoc { name: string; icon: string; intro: string; sections: HelpSection[] }

const DOCS: Record<string, HelpDoc> = {
  portal: {
    name: '门户使用指南', icon: 'lucide:home',
    intro: 'mei-allin 统一应用门户：一个入口管理所有自托管应用。',
    sections: [
      { title: '首页图标项', body: ['卡片支持点击直达应用；编辑模式下可拖拽排序、跨分组拖动。', '卡片右键（或长按）呼出操作菜单：编辑、双地址切换、删除。', '布局可在卡片模式与图标模式间切换（分组标题行的切换按钮）。'] },
      { title: '分组与分页', body: ['未分组的项显示在「常用」页；分组页按分组管理中的顺序排列。', '内置应用自动归入「内置应用」预设分组。'] },
      { title: '内网模式', body: ['首页右上角设置面板可开启内网模式：配置了双地址的链接将优先使用内网地址。'] },
      { title: '隐秘站点命令', body: ['在首页搜索框输入 open:{站点标识}:{开启密码} 可开启隐秘小说站点。', '输入 close:{站点标识}:{开启密码} 可关闭（面板不可见且路径不可访问）。'] },
    ],
  },
  lunatv: {
    name: '影视门户帮助', icon: 'lucide:tv',
    intro: '聚合多个影视资源站的搜索与在线播放。',
    sections: [
      { title: '搜索与播放', body: ['首页搜索框输入影片名进行聚合搜索，结果按资源站分组展示。', '点击结果进入播放页，支持选集、播放记录同步与收藏。'] },
      { title: '影视源管理', body: ['「设置 → 影视源管理」中可启用/停用资源站、检测连通性、添加自定义源。', '内置 14 个精选源；检测失败的源建议停用以保证搜索速度。'] },
      { title: '常见问题', body: ['搜索无结果：先检查各源连通性（源管理页一键检测）。', '播放失败：部分源站有地区限制，可切换其他源的同一影片。'] },
    ],
  },
  solara: {
    name: '音乐播放帮助', icon: 'lucide:music',
    intro: '沉浸式音乐播放器，支持歌单、歌词与多音质。',
    sections: [
      { title: '基本使用', body: ['搜索歌曲/歌手/专辑，点击即可播放。', '支持收藏、歌单管理与歌词滚动显示。'] },
      { title: '音乐源', body: ['「设置 → 音乐播放设置」可管理音乐源，内置多个源可切换。'] },
    ],
  },
  mediago: {
    name: '媒体下载帮助', icon: 'lucide:download',
    intro: 'm3u8/流媒体视频下载工具。',
    sections: [
      { title: '新建下载', body: ['点击「新建下载」粘贴视频页面或 m3u8 链接，自动解析下载。', '支持批量任务与下载完成后自动合并转码。'] },
      { title: '设置', body: ['「设置 → 媒体下载设置」可配置下载目录、并发数、代理等。'] },
    ],
  },
  pansou: {
    name: '网盘搜索与 API', icon: 'lucide:search',
    intro: '聚合网盘资源搜索（TG 频道 + 多插件），并提供 HTTP API 供外部调用。',
    sections: [
      { title: '搜索使用', body: ['输入关键词搜索阿里云盘、夸克、百度等网盘资源。', '「设置 → 网盘搜索设置」可启停频道与插件源、配置磁力搜索。'] },
      { title: 'HTTP API', body: ['GET /search/api/search?kw={关键词}&res=merge 返回聚合结果（JSON）。', '可用参数：kw（关键词）、res（结果类型 merge/all）、src（来源过滤）。', '在门户同源部署下，外部调用地址为 http://<host>:7777/search/api/search。'] },
    ],
  },
  'ai-draw': {
    name: 'AI 绘图使用手册', icon: 'lucide:pen-tool',
    intro: 'AI 驱动的图表绘制：Excalidraw 手绘风、Mermaid 代码图、Drawio 流程图。',
    sections: [
      { title: '三种绘图模式', body: ['Excalidraw：适合自由手绘风格的架构草图。', 'Mermaid：用文本描述生成流程图、时序图、甘特图等。', 'Drawio：专业流程图编辑，支持复杂排版。'] },
      { title: 'AI 生成', body: ['输入自然语言描述，AI 自动生成图表代码并渲染。', '可基于已有图表继续对话修改。'] },
      { title: '设置', body: ['「设置 → AI 绘图设置」配置模型服务与默认参数。'] },
    ],
  },
  tutorial: {
    name: '小说阅读帮助', icon: 'lucide:book-open',
    intro: '个人小说站点：多站点管理、章节编辑、全文导入与沉浸阅读。',
    sections: [
      { title: '站点类型', body: ['普通站点：公开可访问，无需密码。', '隐秘站点：需开启密码，未开启时路径不可访问；通过首页搜索框 open:标识:密码 开启。'] },
      { title: '路径体系', body: ['站点：/novels/s/{站点标识}；书籍：/novels/s/{站点标识}/novels/{书籍标识}。', '标识在创建时可自定义（小写字母/数字/中划线），全局唯一。'] },
      { title: '数据备份', body: ['「设置 → 数据备份/恢复」可按应用选择备份范围，支持 Zip 与 WebDAV/S3 云端恢复。'] },
    ],
  },
  'mei-link': {
    name: '内网穿透帮助', icon: 'lucide:network',
    intro: '基于 frp 的内网穿透客户端管理。',
    sections: [
      { title: '基本流程', body: ['在「隧道服务器设置」中配置 frp 服务器地址与令牌。', '添加隧道：本地端口 → 远程端口映射，启动后即可从外网访问。'] },
      { title: '运行日志', body: ['「隧道运行日志」查看连接状态与错误信息，排查连接失败问题。'] },
    ],
  },
  'omni-tools': {
    name: '工具箱帮助', icon: 'lucide:wrench',
    intro: '隐私优先的本地工具集合：图片、PDF、文本处理等。',
    sections: [
      { title: '特点', body: ['所有处理在浏览器本地完成，文件不上传服务器。', '支持图片压缩/转换、PDF 合并拆分、文本 diff 等常用工具。'] },
    ],
  },
};

export default function HelpPage() {
  const params = useParams();
  const app = params.app as string;
  const doc = DOCS[app];

  if (!doc) {
    return (
      <SettingsShell>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
          <p style={{ color: 'var(--mei-text-muted)' }}>帮助文档不存在</p>
        </div>
      </SettingsShell>
    );
  }

  return (
    <SettingsShell>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '4px 4px 40px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <span style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--mei-gradient)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', boxShadow: 'var(--mei-glow)' }}>
            <MeiIcon icon={doc.icon} size={20} />
          </span>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>{doc.name}</h1>
        </div>
        <p style={{ fontSize: 13.5, color: 'var(--mei-text-muted)', margin: '0 0 22px', lineHeight: 1.7 }}>{doc.intro}</p>

        {doc.sections.map((s) => (
          <section key={s.title} style={{ background: 'var(--mei-surface)', border: '1px solid var(--mei-border)', borderRadius: 'var(--mei-radius-lg)', padding: 18, marginBottom: 14, boxShadow: 'var(--mei-shadow-sm)' }}>
            <h2 style={{ fontSize: 14.5, fontWeight: 700, margin: '0 0 10px' }}>{s.title}</h2>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--mei-text)', lineHeight: 1.9 }}>
              {s.body.map((line, i) => <li key={i}>{line}</li>)}
            </ul>
          </section>
        ))}
      </div>
    </SettingsShell>
  );
}
