// =============================================================================
// 校验所有 plugins/*/manifest.yml 是否符合 schema，并做交叉一致性检查
// 用法: node scripts/validate-manifests.mjs
// =============================================================================
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PLUGINS_DIR = join(ROOT, 'plugins');
const SCHEMA_PATH = join(PLUGINS_DIR, '_schema', 'manifest.schema.json');

const ajv = new Ajv({ allErrors: true, strict: false });
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
const validate = ajv.compile(schema);

const dirs = readdirSync(PLUGINS_DIR).filter((d) => {
  if (d.startsWith('_') || d.startsWith('.')) return false;
  return statSync(join(PLUGINS_DIR, d)).isDirectory();
});

const ids = new Set();
const hosts = new Set();
let hasError = false;

for (const dir of dirs) {
  const file = join(PLUGINS_DIR, dir, 'manifest.yml');
  let doc;
  try {
    doc = yaml.load(readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`✗ ${dir}: 无法读取/解析 manifest.yml — ${e.message}`);
    hasError = true;
    continue;
  }
  if (!validate(doc)) {
    console.error(`✗ ${dir}: schema 校验失败`);
    for (const err of validate.errors) {
      console.error(`    ${err.instancePath || '(root)'} ${err.message}`);
    }
    hasError = true;
    continue;
  }
  if (doc.id !== dir) {
    console.error(`✗ ${dir}: manifest.id(${doc.id}) 与目录名(${dir})不一致`);
    hasError = true;
  }
  if (ids.has(doc.id)) {
    console.error(`✗ ${dir}: 重复的 id "${doc.id}"`);
    hasError = true;
  }
  ids.add(doc.id);
  if (doc.ingress?.host) {
    if (hosts.has(doc.ingress.host)) {
      console.error(`✗ ${dir}: 重复的 ingress.host "${doc.ingress.host}"`);
      hasError = true;
    }
    hosts.add(doc.ingress.host);
  }
  if (doc.theme?.has_skin) {
    const css = join(PLUGINS_DIR, dir, 'theme.css');
    try {
      statSync(css);
    } catch {
      console.error(`✗ ${dir}: theme.has_skin=true 但缺少 theme.css`);
      hasError = true;
    }
  }
  console.log(`✓ ${dir}`);
}

if (hasError) {
  console.error('\n校验失败，请修复上述问题。');
  process.exit(1);
}
console.log(`\n✓ 全部 ${dirs.length} 个清单校验通过`);
