// 统一数据备份/恢复引擎：读 /data 下的各应用数据，打包为 Zip，
// 支持整包覆盖与合并去重两种恢复路径。
import AdmZip from 'adm-zip';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BACKUP_SCOPES, type BackupMode, type BackupScope } from './backup-scopes.ts';

const SUPERVISOR_CONF = process.env.SUPERVISOR_CONF || '/etc/supervisor/supervisord.conf';

export type BrowserData = Record<string, Record<string, string>>;

export interface BackupMeta {
  app: string;
  version: number;
  exportedAt: string;
  scopes: BackupScope[];
  accounts: Array<{ uid: string; username: string }>;
}

export interface ScopeCounts {
  files?: number;
  added?: number;
  updated?: number;
  skipped?: number;
  sites?: number;
  novels?: number;
  volumes?: number;
  chapters?: number;
}

export interface RestoreResult {
  ok: boolean;
  scopes: BackupScope[];
  mode: BackupMode;
  restored: Record<string, ScopeCounts>;
  browserData: BrowserData;
  restarted: string[];
  restartWarning?: string;
}

const PROGRAM_BY_SCOPE: Partial<Record<BackupScope, string>> = {
  lunatv: 'lunatv',
  solara: 'solara',
  mediago: 'mediago',
  'ai-draw': 'ai-draw',
  tutorial: 'tutorial',
  'mei-link': 'mei-link',
};

const SQLITE_TABLES: Record<string, { table: string; pk: string }[]> = {
  'ai-draw': [
    { table: 'users', pk: 'id' },
    { table: 'projects', pk: 'id' },
    { table: 'groups', pk: 'id' },
    { table: 'versions', pk: 'id' },
    { table: 'settings', pk: 'key' },
    { table: 'example_projects', pk: 'id' },
    { table: 'local_users', pk: 'id' },
    { table: 'ai_chat_logs', pk: 'id' },
    { table: 'file_creation_logs', pk: 'id' },
  ],
};

function dataPath(rel: string): string {
  const base = path.resolve(process.env.DATA_DIR || '/data');
  const root = base + path.sep;
  const resolved = path.resolve(base, rel);
  if (!resolved.startsWith(root)) throw new Error('非法备份路径');
  return resolved;
}

function readIfExists(rel: string): Buffer | null {
  try {
    return fs.readFileSync(dataPath(rel));
  } catch {
    return null;
  }
}

function writeAtomic(rel: string, buf: Buffer): void {
  const target = dataPath(rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.backup.tmp`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, target);
}

function removeWal(rel: string): void {
  for (const ext of ['-wal', '-shm']) {
    try {
      fs.unlinkSync(`${dataPath(rel)}${ext}`);
    } catch {
      // 忽略不存在的 -wal/-shm
    }
  }
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function asArray(raw: unknown): unknown[] {
  return Array.isArray(raw) ? (raw as unknown[]) : [];
}

function safeJson(buf: Buffer | null | undefined): Record<string, unknown> {
  if (!buf) return {};
  try {
    return asRecord(JSON.parse(buf.toString('utf8')));
  } catch {
    return {};
  }
}

function parseJsonAny(buf: Buffer | null | undefined): unknown {
  if (!buf) return null;
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return null;
  }
}

function songKey(song: unknown): string {
  const s = asRecord(song);
  return `${String(s.source || 'netease')}:${String(s.id || '')}`;
}

function mergeSongs(cur: unknown[], inc: unknown[]): unknown[] {
  const out = [...cur];
  const seen = new Set(out.map(songKey));
  for (const item of inc) {
    const key = songKey(item);
    if (!seen.has(key)) {
      out.push(item);
      seen.add(key);
    }
  }
  return out;
}

function mergePlaylistArrays(cur: unknown[], inc: unknown[]): unknown[] {
  const out = cur.map((item) => {
    const record = asRecord(item);
    const incoming = inc.find((x) => String(asRecord(x).id) === String(record.id));
    if (!incoming) return item;
    return { ...record, songs: mergeSongs(asArray(record.songs), asArray(asRecord(incoming).songs)) };
  });
  const seen = new Set(out.map((p) => String(asRecord(p).id || '')));
  for (const item of inc) {
    const id = String(asRecord(item).id || '');
    if (!seen.has(id)) {
      out.push(item);
      seen.add(id);
    }
  }
  return out;
}

function mergeById(cur: unknown[], inc: unknown[], keyFn: (item: Record<string, unknown>) => string): unknown[] {
  const out = [...cur];
  const index = new Map(out.map((item, i) => [keyFn(asRecord(item)), i]));
  for (const item of inc) {
    const key = keyFn(asRecord(item));
    if (index.has(key)) {
      out[index.get(key)!] = item;
    } else {
      index.set(key, out.length);
      out.push(item);
    }
  }
  return out;
}

function mergeMusicState(curRaw: unknown, incRaw: unknown): Record<string, unknown> {
  const cur = asRecord(curRaw);
  const inc = asRecord(incRaw);
  const curPlaylists = asArray(cur.playlists);
  const incPlaylists = asArray(inc.playlists);
  const mergedPlaylists = mergePlaylistArrays(curPlaylists, incPlaylists);
  const curFavorites = asArray(cur.favorites);
  const incFavorites = asArray(inc.favorites);
  const curTemp = asArray(cur.temp);
  const incTemp = asArray(inc.temp);
  return {
    ...inc,
    playlists: mergedPlaylists,
    favorites: mergeSongs(curFavorites, incFavorites),
    temp: mergeSongs(curTemp, incTemp),
    revision: Math.max(Number(cur.revision) || 0, Number(inc.revision) || 0),
    updatedAt: String(inc.updatedAt || cur.updatedAt || ''),
  };
}

function mergePanel(curRaw: unknown, incRaw: unknown): Record<string, unknown> {
  const cur = asRecord(curRaw);
  const inc = asRecord(incRaw);
  return {
    ...inc,
    background: { ...asRecord(cur.background), ...asRecord(inc.background) },
    style: { ...asRecord(cur.style), ...asRecord(inc.style) },
    groups: mergeById(
      asArray(cur.groups),
      asArray(inc.groups),
      (g) => String(g.id || ''),
    ),
    items: mergeById(
      asArray(cur.items),
      asArray(inc.items),
      (i) => String(i.id || ''),
    ),
    removedBuiltin: Array.from(new Set([...asArray(cur.removedBuiltin), ...asArray(inc.removedBuiltin)])),
  };
}

function mergeLunatvAdmin(curRaw: unknown, incRaw: unknown): Record<string, unknown> {
  const cur = asRecord(curRaw);
  const inc = asRecord(incRaw);
  const curUser = asRecord(cur.UserConfig);
  const incUser = asRecord(inc.UserConfig);
  return {
    ConfigSubscribtion: { ...asRecord(cur.ConfigSubscribtion), ...asRecord(inc.ConfigSubscribtion) },
    ConfigFile: inc.ConfigFile ?? cur.ConfigFile ?? '',
    SiteConfig: { ...asRecord(cur.SiteConfig), ...asRecord(inc.SiteConfig) },
    UserConfig: {
      Users: mergeById(
        asArray(curUser.Users),
        asArray(incUser.Users),
        (u) => String(u.username || ''),
      ),
      Tags: mergeById(
        asArray(curUser.Tags),
        asArray(incUser.Tags),
        (t) => String(t.name || ''),
      ),
    },
    SourceConfig: mergeById(
      asArray(cur.SourceConfig),
      asArray(inc.SourceConfig),
      (s) => String(s.key || ''),
    ),
    CustomCategories: mergeById(
      asArray(cur.CustomCategories),
      asArray(inc.CustomCategories),
      (c) => `${c.query || ''}:${c.type || ''}`,
    ),
    LiveConfig: mergeById(
      asArray(cur.LiveConfig),
      asArray(inc.LiveConfig),
      (l) => String(l.key || ''),
    ),
  };
}

function writeTempDb(buf: Buffer): string {
  const tmp = path.join(os.tmpdir(), `mei-backup-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
  fs.writeFileSync(tmp, buf);
  return tmp;
}

function quoteIdent(name: string): string {
  return `\`${String(name).replace(/`/g, '``')}\``;
}

function tableColumns(db: DatabaseSync, table: string): string[] {
  return db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all().map((r) => String(r.name));
}

function tableExists(db: DatabaseSync, table: string): boolean {
  return !!db.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').get('table', table);
}

function sqliteSnapshotBuffer(srcRel: string): Buffer | null {
  const src = dataPath(srcRel);
  if (!fs.existsSync(src)) return null;
  const tmp = path.join(os.tmpdir(), `mei-snapshot-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
  const db = new DatabaseSync(src);
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  const buf = fs.readFileSync(tmp);
  fs.unlinkSync(tmp);
  return buf;
}

function mergeSqliteByKey(
  targetRel: string,
  srcBuf: Buffer,
  table: string,
  keyCols: string[],
  updateOnConflict: boolean,
  preserveCols: string[] = [],
): { added: number; updated: number; skipped: number } {
  const srcTmp = writeTempDb(srcBuf);
  const dst = new DatabaseSync(dataPath(targetRel));
  const src = new DatabaseSync(srcTmp, { readOnly: true });
  let added = 0;
  let updated = 0;
  let skipped = 0;
  try {
    if (!tableExists(dst, table) || !tableExists(src, table)) {
      return { added, updated, skipped };
    }
    const cols = tableColumns(src, table);
    const insertCols = cols.filter((c) => !preserveCols.includes(c));
    const updateCols = cols.filter((c) => !preserveCols.includes(c));
    const where = keyCols.map((c) => `${quoteIdent(c)} = ?`).join(' AND ');
    const existing = dst.prepare(`SELECT 1 AS x FROM ${quoteIdent(table)} WHERE ${where}`);
    const insert = dst.prepare(
      `INSERT INTO ${quoteIdent(table)} (${insertCols.join(', ')}) VALUES (${insertCols.map(() => '?').join(', ')})`,
    );
    const update = dst.prepare(
      `UPDATE ${quoteIdent(table)} SET ${updateCols.map((c) => `${quoteIdent(c)} = ?`).join(', ')} WHERE ${where}`,
    );
    dst.exec('BEGIN');
    try {
      for (const row of src.prepare(`SELECT * FROM ${quoteIdent(table)}`).all()) {
        const keyParams = keyCols.map((c) => row[c]);
        if (existing.get(...keyParams)) {
          if (updateOnConflict) {
            update.run(...updateCols.map((c) => row[c]), ...keyParams);
            updated++;
          } else {
            skipped++;
          }
        } else {
          insert.run(...insertCols.map((c) => row[c]));
          added++;
        }
      }
      dst.exec('COMMIT');
    } catch (err) {
      dst.exec('ROLLBACK');
      throw err;
    }
  } finally {
    src.close();
    dst.close();
    try {
      fs.unlinkSync(srcTmp);
    } catch {
      // 忽略临时文件清理失败
    }
  }
  return { added, updated, skipped };
}

function mergeSolaraDb(srcBuf: Buffer): { added: number; updated: number } {
  const srcTmp = writeTempDb(srcBuf);
  const dst = new DatabaseSync(dataPath('solara/solara.db'));
  const src = new DatabaseSync(srcTmp, { readOnly: true });
  let added = 0;
  let updated = 0;
  try {
    for (const table of ['playback_store', 'favorites_store']) {
      if (!tableExists(dst, table) || !tableExists(src, table)) continue;
      const insert = dst.prepare(
        `INSERT OR IGNORE INTO ${quoteIdent(table)} (key, value, updated_at) VALUES (?, ?, ?)`,
      );
      const rows = src.prepare(`SELECT key, value, updated_at FROM ${quoteIdent(table)}`).all();
      for (const row of rows) {
        const res = insert.run(String(row.key), row.value == null ? '' : String(row.value), String(row.updated_at || new Date().toISOString()));
        added += Number(res.changes) || 0;
      }
    }
    const collectionKeys: Array<{ key: string; table: string }> = [
      { key: 'meiMusicPlaylists.v1', table: 'playback_store' },
      { key: 'favoriteSongs', table: 'favorites_store' },
    ];
    for (const { key, table } of collectionKeys) {
      const srcRow = src.prepare(`SELECT value FROM ${quoteIdent(table)} WHERE key = ?`).get(key);
      const dstRow = dst.prepare(`SELECT value FROM ${quoteIdent(table)} WHERE key = ?`).get(key);
      if (!srcRow) continue;
      let merged: unknown;
      try {
        const curArr = dstRow && dstRow.value ? JSON.parse(String(dstRow.value)) : [];
        const incArr = JSON.parse(String(srcRow.value));
        merged =
          Array.isArray(curArr) && Array.isArray(incArr)
            ? key === 'meiMusicPlaylists.v1'
              ? mergePlaylistArrays(asArray(curArr), asArray(incArr))
              : mergeSongs(asArray(curArr), asArray(incArr))
            : srcRow.value;
      } catch {
        merged = srcRow.value;
      }
      dst.prepare(`INSERT OR REPLACE INTO ${quoteIdent(table)} (key, value, updated_at) VALUES (?, ?, datetime('now'))`).run(key, JSON.stringify(merged));
      updated++;
    }
  } finally {
    src.close();
    dst.close();
    try {
      fs.unlinkSync(srcTmp);
    } catch {
      // 忽略
    }
  }
  return { added, updated };
}

function slugifySite(name: string, fallbackId?: number): string {
  const s = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || `site-${fallbackId ?? Date.now()}`;
}

function mergeTutorialDb(srcBuf: Buffer): ScopeCounts {
  const srcTmp = writeTempDb(srcBuf);
  const src = new DatabaseSync(srcTmp, { readOnly: true });
  const dst = new DatabaseSync(dataPath('tutorial/novels.db'));
  const counts: ScopeCounts = { sites: 0, novels: 0, volumes: 0, chapters: 0, skipped: 0 };
  try {
    const libCols = new Set(tableColumns(src, 'libraries'));
    const novCols = new Set(tableColumns(src, 'novels'));
    const srcLibs = src.prepare('SELECT * FROM libraries ORDER BY id').all();
    const libIdMap = new Map<number, number>();
    const findLibBySlug = dst.prepare('SELECT id FROM libraries WHERE slug = ?');
    const insLib = dst.prepare(
      'INSERT INTO libraries (name, slug, type, password, icon, icon_color, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const genLibSlug = (name: string, id: number) => {
      let base = slugifySite(name, id);
      let slug = base;
      let n = 2;
      while (findLibBySlug.get(slug)) {
        slug = `${base}-${n++}`;
      }
      return slug;
    };
    dst.exec('BEGIN');
    try {
      for (const lib of srcLibs) {
        const slug = lib.slug && libCols.has('slug') ? String(lib.slug) : genLibSlug(String(lib.name || ''), Number(lib.id));
        const type =
          (libCols.has('type') && String(lib.type) === 'secret') ||
          Number(lib.hidden) === 1 ||
          (lib.password && String(lib.password) !== '')
            ? 'secret'
            : 'normal';
        const password = type === 'secret' ? String(lib.password || '') : '';
        const exist = findLibBySlug.get(slug);
        if (exist) {
          libIdMap.set(Number(lib.id), Number(exist.id));
          counts.skipped = (counts.skipped || 0) + 1;
          continue;
        }
        const now = new Date().toISOString();
        const info = insLib.run(
          String(lib.name || ''),
          slug,
          type,
          password,
          String(lib.icon || ''),
          String(lib.icon_color || ''),
          String(lib.description || ''),
          now,
          now,
        );
        libIdMap.set(Number(lib.id), Number(info.lastInsertRowid));
        counts.sites = (counts.sites || 0) + 1;
      }

      const srcNovels = src.prepare('SELECT * FROM novels ORDER BY id').all();
      const novelIdMap = new Map<number, number>();
      const findNovelBySlug = dst.prepare('SELECT id FROM novels WHERE slug = ?');
      const insNovel = dst.prepare(
        'INSERT INTO novels (slug, library_id, title, author, description, cover_url, icon, icon_color, category, tags, status, word_count, rating, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      const genNovelSlug = (title: string, id: number) => {
        let base = slugifySite(title, id).replace(/^site-/, 'novel-');
        let slug = base;
        let n = 2;
        while (findNovelBySlug.get(slug)) {
          slug = `${base}-${n++}`;
        }
        return slug;
      };
      for (const nov of srcNovels) {
        const newLibId = libIdMap.get(Number(nov.library_id));
        if (newLibId == null) {
          counts.skipped = (counts.skipped || 0) + 1;
          continue;
        }
        const slug = nov.slug && novCols.has('slug') ? String(nov.slug) : genNovelSlug(String(nov.title || ''), Number(nov.id));
        if (findNovelBySlug.get(slug)) {
          counts.skipped = (counts.skipped || 0) + 1;
          continue;
        }
        const now = new Date().toISOString();
        const info = insNovel.run(
          slug,
          newLibId,
          String(nov.title || ''),
          String(nov.author || ''),
          String(nov.description || ''),
          String(nov.cover_url || ''),
          novCols.has('icon') ? String(nov.icon || '') : '',
          novCols.has('icon_color') ? String(nov.icon_color || '') : '',
          String(nov.category || ''),
          String(nov.tags || '[]'),
          String(nov.status || 'ongoing'),
          Number(nov.word_count) || 0,
          Number(nov.rating) || 0,
          now,
          now,
        );
        novelIdMap.set(Number(nov.id), Number(info.lastInsertRowid));
        counts.novels = (counts.novels || 0) + 1;
      }

      if (tableExists(src, 'volumes') && tableExists(dst, 'volumes')) {
        const srcVols = src.prepare('SELECT * FROM volumes ORDER BY id').all();
        const insVol = dst.prepare('INSERT INTO volumes (novel_id, title, position) VALUES (?, ?, ?)');
        const findVol = dst.prepare('SELECT id FROM volumes WHERE novel_id = ? AND title = ?');
        for (const v of srcVols) {
          const nid = novelIdMap.get(Number(v.novel_id));
          if (nid == null || findVol.get(nid, String(v.title || ''))) continue;
          insVol.run(nid, String(v.title || ''), Number(v.position) || 0);
          counts.volumes = (counts.volumes || 0) + 1;
        }
      }

      const srcChapters = src.prepare('SELECT * FROM chapters ORDER BY novel_id, chapter_order').all();
      const insChapter = dst.prepare(
        'INSERT INTO chapters (novel_id, title, content, chapter_order, word_count, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      );
      const findChapter = dst.prepare('SELECT id FROM chapters WHERE novel_id = ? AND chapter_order = ? AND title = ?');
      for (const ch of srcChapters) {
        const nid = novelIdMap.get(Number(ch.novel_id));
        if (nid == null || findChapter.get(nid, Number(ch.chapter_order) || 0, String(ch.title || ''))) continue;
        insChapter.run(
          nid,
          String(ch.title || ''),
          String(ch.content || ''),
          Number(ch.chapter_order) || 0,
          Number(ch.word_count) || 0,
          String(ch.created_at || new Date().toISOString()),
        );
        counts.chapters = (counts.chapters || 0) + 1;
      }
      dst.exec('COMMIT');
    } catch (err) {
      dst.exec('ROLLBACK');
      throw err;
    }
  } finally {
    src.close();
    dst.close();
    try {
      fs.unlinkSync(srcTmp);
    } catch {
      // 忽略
    }
  }
  return counts;
}

function mergeMusicFiles(entries: Map<string, Buffer>): ScopeCounts {
  let files = 0;
  for (const [zipPath, buf] of entries) {
    if (!zipPath.startsWith('solara/music/')) continue;
    const name = path.basename(zipPath);
    if (!name.endsWith('.json')) continue;
    const rel = `shell/music/${name}`;
    const merged = mergeMusicState(safeJson(readIfExists(rel)), safeJson(buf));
    writeAtomic(rel, Buffer.from(JSON.stringify(merged, null, 2)));
    files++;
  }
  return { files };
}

function scopeDir(scope: BackupScope): string | null {
  if (scope === 'pansou') return null;
  return `${scope}/`;
}

function mapRestorePath(zipPath: string): { rel: string; sqlite: boolean } | null {
  const allowed = (basename: string, set: string[]): boolean => set.includes(basename);
  if (zipPath.startsWith('panel/')) {
    const rel = zipPath.slice('panel/'.length);
    return allowed(rel, ['panel.json']) ? { rel: `shell/${rel}`, sqlite: false } : null;
  }
  if (zipPath.startsWith('lunatv/')) {
    const rel = zipPath.slice('lunatv/'.length);
    return allowed(rel, ['admin-config.json']) ? { rel: `lunatv/${rel}`, sqlite: false } : null;
  }
  if (zipPath.startsWith('mediago/')) {
    const rel = zipPath.slice('mediago/'.length);
    return allowed(rel, ['config.json', 'mediago.db']) ? { rel: `mediago/${rel}`, sqlite: rel.endsWith('.db') } : null;
  }
  if (zipPath.startsWith('solara/')) {
    const rel = zipPath.slice('solara/'.length);
    if (rel === 'solara.db') return { rel: 'solara/solara.db', sqlite: true };
    if (rel.startsWith('music/') && rel.endsWith('.json')) {
      return { rel: `shell/music/${path.basename(rel)}`, sqlite: false };
    }
    return null;
  }
  if (zipPath.startsWith('ai-draw/')) {
    const rel = zipPath.slice('ai-draw/'.length);
    return allowed(rel, ['database.sqlite']) ? { rel: `ai-draw/${rel}`, sqlite: true } : null;
  }
  if (zipPath.startsWith('tutorial/')) {
    const rel = zipPath.slice('tutorial/'.length);
    return allowed(rel, ['novels.db']) ? { rel: `tutorial/${rel}`, sqlite: true } : null;
  }
  if (zipPath.startsWith('mei-link/')) {
    const rel = zipPath.slice('mei-link/'.length);
    return allowed(rel, ['config.json', 'reconnect.json', 'tunnels.json', 'frpc.toml'])
      ? { rel: `mei-link/${rel}`, sqlite: false }
      : null;
  }
  return null;
}

function isServerFileForScope(zipPath: string, scope: BackupScope): boolean {
  const dir = scopeDir(scope);
  return !!dir && zipPath.startsWith(dir) && mapRestorePath(zipPath) !== null;
}

function mergeJsonFile(rel: string, zipPath: string, entries: Map<string, Buffer>): void {
  const buf = entries.get(zipPath);
  if (!buf) return;
  if (zipPath === 'mei-link/tunnels.json') {
    const merged = mergeById(
      asArray(parseJsonAny(readIfExists(rel))),
      asArray(parseJsonAny(buf)),
      (t) => String(t.id || ''),
    );
    writeAtomic(rel, Buffer.from(JSON.stringify(merged, null, 2)));
    return;
  }
  const incoming = safeJson(buf);
  const current = safeJson(readIfExists(rel));
  let merged: unknown = { ...current, ...incoming };
  if (zipPath === 'panel/panel.json') merged = mergePanel(current, incoming);
  if (zipPath === 'lunatv/admin-config.json') merged = mergeLunatvAdmin(current, incoming);
  writeAtomic(rel, Buffer.from(JSON.stringify(merged, null, 2)));
}

function mergeScope(scope: BackupScope, entries: Map<string, Buffer>): ScopeCounts {
  const counts: ScopeCounts = { files: 0 };
  const files: Array<{ rel: string; zipPath: string; sqlite: boolean }> = [];
  for (const zipPath of entries.keys()) {
    if (!isServerFileForScope(zipPath, scope)) continue;
    if (scope === 'solara' && zipPath.startsWith('solara/music/')) continue;
    const mapped = mapRestorePath(zipPath);
    if (mapped) files.push({ rel: mapped.rel, zipPath, sqlite: mapped.sqlite });
  }
  counts.files = files.length;
  for (const file of files) {
    const buf = entries.get(file.zipPath);
    if (!buf) continue;
    if (!fs.existsSync(dataPath(file.rel))) {
      writeAtomic(file.rel, buf);
      if (file.sqlite) removeWal(file.rel);
      continue;
    }
    if (file.sqlite) {
      if (file.zipPath === 'solara/solara.db') {
        const result = mergeSolaraDb(buf);
        counts.added = (counts.added || 0) + result.added;
        counts.updated = (counts.updated || 0) + result.updated;
      } else if (file.zipPath === 'tutorial/novels.db') {
        const result = mergeTutorialDb(buf);
        Object.assign(counts, result);
      } else if (file.zipPath === 'mediago/mediago.db') {
        const result = mergeSqliteByKey('mediago/mediago.db', buf, 'video', ['name'], true, ['id']);
        counts.added = (counts.added || 0) + result.added;
        counts.updated = (counts.updated || 0) + result.updated;
        const fav = mergeSqliteByKey('mediago/mediago.db', buf, 'favorite', ['url'], true, ['id']);
        counts.added = (counts.added || 0) + fav.added;
        counts.updated = (counts.updated || 0) + fav.updated;
        const conv = mergeSqliteByKey('mediago/mediago.db', buf, 'conversion', ['path', 'outputFormat'], true, ['id']);
        counts.added = (counts.added || 0) + conv.added;
        counts.updated = (counts.updated || 0) + conv.updated;
      } else if (file.zipPath.startsWith('ai-draw/')) {
        for (const item of SQLITE_TABLES['ai-draw'] || []) {
          const result = mergeSqliteByKey('ai-draw/database.sqlite', buf, item.table, [item.pk], false);
          counts.added = (counts.added || 0) + result.added;
          counts.skipped = (counts.skipped || 0) + result.skipped;
        }
      }
    } else if (file.rel.endsWith('.toml') || !file.rel.endsWith('.json')) {
      writeAtomic(file.rel, buf);
    } else {
      mergeJsonFile(file.rel, file.zipPath, entries);
    }
  }
  if (scope === 'solara') {
    const music = mergeMusicFiles(entries);
    counts.files = (counts.files || 0) + (music.files || 0);
  }
  return counts;
}

function collectScopeFiles(scope: BackupScope): Array<{ zipPath: string; buffer: Buffer }> {
  const out: Array<{ zipPath: string; buffer: Buffer }> = [];
  const push = (zipPath: string, rel: string) => {
    const buf = readIfExists(rel);
    if (buf) out.push({ zipPath, buffer: buf });
  };
  const pushSqlite = (zipPath: string, rel: string) => {
    const buf = sqliteSnapshotBuffer(rel);
    if (buf) out.push({ zipPath, buffer: buf });
  };
  if (scope === 'panel') {
    push('panel/panel.json', 'shell/panel.json');
  } else if (scope === 'lunatv') {
    push('lunatv/admin-config.json', 'lunatv/admin-config.json');
  } else if (scope === 'solara') {
    pushSqlite('solara/solara.db', 'solara/solara.db');
    const dir = dataPath('shell/music');
    if (fs.existsSync(dir)) {
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.json')) continue;
        const buf = readIfExists(`shell/music/${name}`);
        if (buf) out.push({ zipPath: `solara/music/${name}`, buffer: buf });
      }
    }
  } else if (scope === 'mediago') {
    push('mediago/config.json', 'mediago/config.json');
    pushSqlite('mediago/mediago.db', 'mediago/mediago.db');
  } else if (scope === 'ai-draw') {
    pushSqlite('ai-draw/database.sqlite', 'ai-draw/database.sqlite');
  } else if (scope === 'tutorial') {
    pushSqlite('tutorial/novels.db', 'tutorial/novels.db');
  } else if (scope === 'mei-link') {
    for (const name of ['config.json', 'reconnect.json', 'tunnels.json', 'frpc.toml']) {
      push(`mei-link/${name}`, `mei-link/${name}`);
    }
  }
  return out;
}

function readAccountSummary(): Array<{ uid: string; username: string }> {
  try {
    const user = JSON.parse(fs.readFileSync(dataPath('shell/user.json'), 'utf8'));
    return [{ uid: String(user.uid || ''), username: String(user.username || '') }];
  } catch {
    return [];
  }
}

export function buildBackupZip(opts: { scopes: BackupScope[]; browserData?: BrowserData }): Buffer {
  const scopes = BACKUP_SCOPES.filter((s) => opts.scopes.includes(s));
  const zip = new AdmZip();
  const meta: BackupMeta = {
    app: 'mei-allin',
    version: 1,
    exportedAt: new Date().toISOString(),
    scopes,
    accounts: readAccountSummary(),
  };
  zip.addFile('meta.json', Buffer.from(JSON.stringify(meta, null, 2)));
  for (const scope of scopes) {
    for (const entry of collectScopeFiles(scope)) {
      zip.addFile(entry.zipPath, entry.buffer);
    }
    const browser = opts.browserData?.[scope] || {};
    zip.addFile(`browser/${scope}.json`, Buffer.from(JSON.stringify(browser, null, 2)));
  }
  return zip.toBuffer();
}

export function parseBackupZip(buf: Buffer): { meta: BackupMeta; entries: Map<string, Buffer> } {
  const zip = new AdmZip(buf);
  const entries = new Map<string, Buffer>();
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    entries.set(entry.entryName.replace(/\\/g, '/'), entry.getData());
  }
  const metaRaw = entries.get('meta.json');
  if (!metaRaw) throw new Error('备份包缺少 meta.json');
  let meta: BackupMeta;
  try {
    meta = JSON.parse(metaRaw.toString('utf8')) as BackupMeta;
  } catch {
    throw new Error('备份包 meta.json 无效');
  }
  if (meta.app !== 'mei-allin' || meta.version !== 1) throw new Error('不支持的备份包版本');
  if (!Array.isArray(meta.scopes)) throw new Error('备份包缺少范围信息');
  return { meta, entries };
}

function restartPrograms(programs: string[]): { restarted: string[]; warning?: string } {
  if (programs.length === 0) return { restarted: [] };
  try {
    const bin = process.env.SUPERVISORCTL_BIN || 'supervisorctl';
    execFileSync(bin, ['-c', SUPERVISOR_CONF, 'restart', ...programs], {
      stdio: 'pipe',
      timeout: 120000,
    });
    return { restarted: programs };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      restarted: [],
      warning: `数据已写入，但自动重启失败（${message}）。请手动重启受影响应用后生效。`,
    };
  }
}

export function restoreBackupZip(buf: Buffer, mode: BackupMode): RestoreResult {
  const { meta, entries } = parseBackupZip(buf);
  const browserData: BrowserData = {};
  const restored: Record<string, ScopeCounts> = {};
  for (const scope of meta.scopes) {
    if (!BACKUP_SCOPES.includes(scope)) continue;
    const browser = entries.get(`browser/${scope}.json`);
    if (browser) {
      try {
        const parsed = JSON.parse(browser.toString('utf8')) as Record<string, string>;
        browserData[scope] = parsed && typeof parsed === 'object' ? parsed : {};
      } catch {
        browserData[scope] = {};
      }
    }
    if (mode === 'replace') {
      let files = 0;
      for (const [zipPath, fileBuf] of entries) {
        if (!isServerFileForScope(zipPath, scope)) continue;
        const mapped = mapRestorePath(zipPath);
        if (!mapped) continue;
        writeAtomic(mapped.rel, fileBuf);
        if (mapped.sqlite) removeWal(mapped.rel);
        files++;
      }
      restored[scope] = { files };
    } else {
      restored[scope] = mergeScope(scope, entries);
    }
  }
  const programs = new Set<string>();
  for (const scope of meta.scopes) {
    const program = PROGRAM_BY_SCOPE[scope];
    if (program && [...entries.keys()].some((p) => isServerFileForScope(p, scope))) {
      programs.add(program);
    }
  }
  const restart = restartPrograms([...programs]);
  return {
    ok: true,
    scopes: meta.scopes,
    mode,
    restored,
    browserData,
    restarted: restart.restarted,
    restartWarning: restart.warning,
  };
}
