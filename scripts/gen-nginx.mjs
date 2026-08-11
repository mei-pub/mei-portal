// =============================================================================
// 从 plugins/*/manifest.yml 生成 nginx conf.d/*.conf
// 这是"插件清单驱动网关"的核心：新增应用无需手写 nginx 配置。
// 用法: node scripts/gen-nginx.mjs
// =============================================================================
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PLUGINS_DIR = join(ROOT, 'plugins');
const CONF_DIR = join(ROOT, 'gateway', 'nginx', 'conf.d');

const shellOrigin = process.env.SHELL_ORIGIN || 'http://${ROOT_DOMAIN}';
// 注意：nginx 不解释 ${ROOT_DOMAIN}，我们用 envsubst 在容器启动时替换。
// SHELL_ORIGIN 由 docker-compose 的 environment 注入。

const dirs = readdirSync(PLUGINS_DIR).filter((d) => {
  if (d.startsWith('_') || d.startsWith('.')) return false;
  return statSync(join(PLUGINS_DIR, d)).isDirectory();
});

mkdirSync(CONF_DIR, { recursive: true });

// WebSocket 升级映射（前置）
const header = `# 由 scripts/gen-nginx.mjs 自动生成，请勿手改。
# 修改 plugins/*/manifest.yml 后重新运行 node scripts/gen-nginx.mjs

map \$http_upgrade \$connection_upgrade {
    default upgrade;
    ''      close;
}
`;

function appServer(manifest) {
  const { id, endpoint, ingress, theme } = manifest;
  const host = ingress.host || `\${SUBDOMAIN_${id.toUpperCase()}}.\${ROOT_DOMAIN}`;
  const blocks = [
    `# ${id} — ${manifest.name || ''}`,
    `server {`,
    `    listen 80;`,
    `    server_name ${host};`,
    ``,
    `    # theme loader 注入：剥离 iframe 头 + sub_filter`,
    `    proxy_hide_header X-Frame-Options;`,
    `    proxy_hide_header Content-Security-Policy;`,
    `    proxy_hide_header Content-Security-Policy-Report-Only;`,
    `    sub_filter_types text/html;`,
    `    sub_filter '</head>' '<script src="\${SHELL_ORIGIN}/__theme/loader.js" data-app="${id}"></script></head>';`,
    `    sub_filter_once on;`,
    ``,
    `    location / {`,
    `        proxy_pass ${endpoint};`,
    `        proxy_set_header Host \$host;`,
    `        proxy_set_header X-Real-IP \$remote_addr;`,
    `        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;`,
    `        proxy_set_header X-Forwarded-Proto \$scheme;`,
    `        proxy_set_header Upgrade \$http_upgrade;`,
    `        proxy_set_header Connection \$connection_upgrade;`,
    `        proxy_http_version 1.1;`,
    `        proxy_read_timeout 300s;`,
    `        proxy_send_timeout 300s;`,
    `        proxy_buffering off;`,
    `    }`,
    `}`,
  ];
  return blocks.join('\n');
}

let body = '';
const generated = [];
for (const dir of dirs) {
  const file = join(PLUGINS_DIR, dir, 'manifest.yml');
  let doc;
  try {
    doc = yaml.load(readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`跳过 ${dir}：${e.message}`);
    continue;
  }
  if (doc.ingress?.mode !== 'subdomain') continue;
  body += '\n' + appServer(doc) + '\n';
  generated.push(doc.id);
}

writeFileSync(join(CONF_DIR, '00-apps.conf'), header + body);

console.log(`✓ 生成 gateway/nginx/conf.d/00-apps.conf`);
console.log(`  含 ${generated.length} 个应用: ${generated.join(', ')}`);
