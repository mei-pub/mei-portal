// 全量数据导出/导入（zip / SQLite），导入兼容旧 schema（无 slug/type/icon 列、hidden 书架模型）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import AdmZip from 'adm-zip';
import { slugifySite } from './db';

const _rawDir = process.env.DATA_DIR || process.cwd();
const DATA_DIR = path.isAbsolute(_rawDir) ? _rawDir : path.resolve(process.cwd(), _rawDir);
const DB_PATH = path.join(DATA_DIR, 'novels.db');

function checkpoint() {
  const db = new Database(DB_PATH);
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
}

export function exportSqliteBuffer(): Buffer {
  checkpoint();
  return fs.readFileSync(DB_PATH);
}

export function exportZipBuffer(): Buffer {
  const zip = new AdmZip();
  zip.addFile('novels.db', exportSqliteBuffer());
  zip.addFile('meta.json', Buffer.from(JSON.stringify({ app: 'mei-novels', version: 2, exportedAt: new Date().toISOString() }, null, 2)));
  return zip.toBuffer();
}

interface LibRow { id: number; name: string; password?: string; hidden?: number; slug?: string | null; type?: string; icon?: string; icon_color?: string; description?: string; }
interface NovelRow { id: number; library_id: number; slug?: string | null; title: string; author?: string; description?: string; cover_url?: string; icon?: string; icon_color?: string; category?: string; tags?: string; status?: string; word_count?: number; rating?: number; created_at?: string; updated_at?: string; }
interface VolumeRow { id: number; novel_id: number; title: string; position?: number; }
interface ChapterRow { id: number; novel_id: number; title: string; content?: string; chapter_order?: number; word_count?: number; created_at?: string; }

function tableCols(db: Database.Database, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
}

/** 从 SQLite buffer 合并导入（幂等：站点按 slug 去重，书籍按 slug 去重，章节按 (novel,order,title) 去重） */
export function importSqliteBuffer(buf: Buffer): { sites: number; novels: number; chapters: number; skipped: number } {
  const tmp = path.join(os.tmpdir(), `mei-import-${Date.now()}.db`);
  fs.writeFileSync(tmp, buf);
  const src = new Database(tmp, { readonly: true });
  const dst = new Database(DB_PATH);
  let sites = 0, novels = 0, chapters = 0, skipped = 0;
  try {
    const libCols = tableCols(src, 'libraries');
    const novCols = tableCols(src, 'novels');
    const srcLibs = src.prepare('SELECT * FROM libraries ORDER BY id').all() as LibRow[];
    const libIdMap = new Map<number, number>();

    const findLibBySlug = dst.prepare('SELECT id FROM libraries WHERE slug = ?');
    const insLib = dst.prepare("INSERT INTO libraries (name, slug, type, password, icon, icon_color, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const genLibSlug = (name: string, id: number) => {
      let base = slugifySite(name, id);
      let slug = base, n = 2;
      while (findLibBySlug.get(slug)) { slug = `${base}-${n++}`; }
      return slug;
    };

    const tx = dst.transaction(() => {
      for (const lib of srcLibs) {
        // 旧 schema 兼容：无 slug → 生成；hidden/有密码 → 隐秘站点
        const slug = lib.slug && libCols.has('slug') ? lib.slug : genLibSlug(lib.name, lib.id);
        const type = (libCols.has('type') && lib.type === 'secret') || lib.hidden === 1 || (lib.password && lib.password !== '') ? 'secret' : 'normal';
        const password = type === 'secret' ? (lib.password || '') : '';
        const exist = findLibBySlug.get(slug) as { id: number } | undefined;
        if (exist) {
          libIdMap.set(lib.id, exist.id);
          skipped++;
          continue;
        }
        const now = new Date().toISOString();
        const info = insLib.run(lib.name, slug, type, password, lib.icon || '', lib.icon_color || '', lib.description || '', now, now);
        libIdMap.set(lib.id, info.lastInsertRowid as number);
        sites++;
      }

      const findNovelBySlug = dst.prepare('SELECT id FROM novels WHERE slug = ?');
      const insNovel = dst.prepare(`INSERT INTO novels (slug, library_id, title, author, description, cover_url, icon, icon_color, category, tags, status, word_count, rating, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const genNovelSlug = (title: string, id: number) => {
        let base = slugifySite(title, id).replace(/^site-/, 'novel-');
        let slug = base, n = 2;
        while (findNovelBySlug.get(slug)) { slug = `${base}-${n++}`; }
        return slug;
      };
      const srcNovels = src.prepare('SELECT * FROM novels ORDER BY id').all() as NovelRow[];
      const novelIdMap = new Map<number, number>();
      for (const nov of srcNovels) {
        const newLibId = libIdMap.get(nov.library_id);
        if (!newLibId) { skipped++; continue; }
        const slug = nov.slug && novCols.has('slug') ? nov.slug : genNovelSlug(nov.title, nov.id);
        if (findNovelBySlug.get(slug)) { skipped++; continue; }
        const now = new Date().toISOString();
        const info = insNovel.run(
          slug, newLibId, nov.title, nov.author || '', nov.description || '', nov.cover_url || '',
          novCols.has('icon') ? nov.icon || '' : '', novCols.has('icon_color') ? nov.icon_color || '' : '',
          nov.category || '', nov.tags || '[]', nov.status || 'ongoing', nov.word_count || 0, nov.rating || 0,
          nov.created_at || now, nov.updated_at || now
        );
        novelIdMap.set(nov.id, info.lastInsertRowid as number);
        novels++;
      }

      // 分卷 + 章节（id 重映射，按内容去重保证幂等）
      try {
        const srcVols = src.prepare('SELECT * FROM volumes ORDER BY id').all() as VolumeRow[];
        const insVol = dst.prepare('INSERT INTO volumes (novel_id, title, position) VALUES (?, ?, ?)');
        const findVol = dst.prepare('SELECT id FROM volumes WHERE novel_id = ? AND title = ?');
        for (const v of srcVols) {
          const nid = novelIdMap.get(v.novel_id);
          if (!nid || findVol.get(nid, v.title)) continue;
          insVol.run(nid, v.title, v.position || 0);
        }
      } catch { /* 旧库可能无 volumes 表 */ }
      const srcChapters = src.prepare('SELECT * FROM chapters ORDER BY novel_id, chapter_order').all() as ChapterRow[];
      const insChapter = dst.prepare('INSERT INTO chapters (novel_id, title, content, chapter_order, word_count, created_at) VALUES (?, ?, ?, ?, ?, ?)');
      const findChapter = dst.prepare('SELECT id FROM chapters WHERE novel_id = ? AND chapter_order = ? AND title = ?');
      for (const ch of srcChapters) {
        const nid = novelIdMap.get(ch.novel_id);
        if (!nid || findChapter.get(nid, ch.chapter_order || 0, ch.title)) continue;
        insChapter.run(nid, ch.title, ch.content || '', ch.chapter_order || 0, ch.word_count || 0, ch.created_at || new Date().toISOString());
        chapters++;
      }
    });
    tx();
  } finally {
    src.close();
    dst.close();
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
  return { sites, novels, chapters, skipped };
}

/** 从 zip buffer 导入（取包内第一个 .db/.sqlite） */
export function importZipBuffer(buf: Buffer): { sites: number; novels: number; chapters: number; skipped: number } {
  const zip = new AdmZip(buf);
  const entry = zip.getEntries().find((e) => /\.(db|sqlite|sqlite3)$/i.test(e.entryName));
  if (!entry) throw new Error('zip 包内未找到 SQLite 数据库文件');
  return importSqliteBuffer(entry.getData());
}
