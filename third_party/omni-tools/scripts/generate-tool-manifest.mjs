// Scan src/pages/tools/<category>/<tool>/meta.ts files and emit tool-manifest.json
// with REAL router paths (`<category>/<path>` from defineTool calls).
// The portal search (packages/shall) consumes this at runtime: locale i18n keys use
// camelCase and category namespaces that don't always match the real kebab-case
// route paths (e.g. locale 'comparison' -> real 'json-comparison', png tools nested
// under the image namespace), so deriving hrefs from locale keys produces dead links.
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const toolsDir = path.join(root, 'src', 'pages', 'tools');
const outFile = path.join(root, 'tool-manifest.json');

const entries = [];
const seen = new Set();

function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!item.isDirectory()) continue;
    const full = path.join(dir, item.name);
    const meta = path.join(full, 'meta.ts');
    if (fs.existsSync(meta)) {
      const source = fs.readFileSync(meta, 'utf8');
      const defineMatch = source.match(/defineTool\(\s*'([a-z-]+)'/);
      const pathMatch = source.match(/\bpath:\s*'([^']+)'/);
      const nameMatch = source.match(/name:\s*'([a-z-]+):([a-zA-Z0-9]+)\.title'/);
      if (defineMatch && pathMatch) {
        const [, category] = defineMatch;
        const [, toolPath] = pathMatch;
        const full_path = `${category}/${toolPath}`;
        if (!seen.has(full_path)) {
          seen.add(full_path);
          entries.push({
            path: full_path,
            ns: nameMatch ? nameMatch[1] : category,
            key: nameMatch ? nameMatch[2] : toolPath,
          });
        }
      }
    }
    walk(full);
  }
}

walk(toolsDir);
entries.sort((a, b) => a.path.localeCompare(b.path));
fs.writeFileSync(outFile, `${JSON.stringify(entries, null, 2)}\n`);
console.log(`[generate-tool-manifest] ${entries.length} tools -> ${outFile}`);
