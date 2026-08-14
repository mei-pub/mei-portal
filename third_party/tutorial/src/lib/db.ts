import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';

// Resolve DATA_DIR: support relative paths (resolved against cwd)
const _rawDir = process.env.DATA_DIR || process.cwd();
const DATA_DIR = path.isAbsolute(_rawDir) ? _rawDir : path.resolve(process.cwd(), _rawDir);

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'novels.db');

// Initialize SQLite database
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables if not exist
db.exec(`
  CREATE TABLE IF NOT EXISTS libraries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    password TEXT NOT NULL DEFAULT '',
    hidden INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS novels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    library_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    author TEXT DEFAULT '',
    description TEXT DEFAULT '',
    cover_url TEXT DEFAULT '',
    category TEXT DEFAULT '',
    tags TEXT DEFAULT '[]',
    status TEXT DEFAULT 'ongoing',
    word_count INTEGER DEFAULT 0,
    rating INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (library_id) REFERENCES libraries(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS volumes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    position INTEGER DEFAULT 0,
    FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS chapters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT DEFAULT '',
    chapter_order INTEGER DEFAULT 0,
    word_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
  );
`);

// 老库迁移：补充 hidden 列
try {
  db.exec('ALTER TABLE libraries ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0');
} catch {
  // 列已存在，忽略
}

// ── DEFAULT_LIB_SEED: 首次启动若无 library 则创建默认无密码 library ──
const libCount = db.prepare('SELECT COUNT(*) as c FROM libraries').get() as { c: number };
if (libCount && libCount.c === 0) {
  db.prepare("INSERT INTO libraries (name, password) VALUES (?, ?)").run('我的书架', '');
  console.log('[tutorial] 已创建默认书架');
}

// ── Interfaces ──

export interface Library {
  id: number;
  name: string;
  password: string;
  hidden: number;
  created_at: string;
  updated_at: string;
}

export interface Novel {
  id: number;
  library_id: number;
  title: string;
  author: string;
  description: string;
  cover_url: string;
  category: string;
  tags: string[];
  status: string;
  word_count: number;
  rating: number;
  created_at: string;
  updated_at: string;
  volumes?: Volume[];
}

export interface Volume {
  id: number;
  novel_id: number;
  title: string;
  position: number;
}

export interface Chapter {
  id: number;
  novel_id: number;
  title: string;
  content: string;
  chapter_order: number;
  word_count: number;
  created_at: string;
}

// ── Helper: parse tags from JSON string ──
function parseNovelRow(row: Record<string, unknown>): Novel {
  return {
    ...(row as Omit<Novel, 'tags'>),
    tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags || [],
  };
}

// ── 计算纯文字字数（排除Markdown语法、图片等）──
export function calculateWordCount(content: string): number {
  if (!content) return 0;
  let text = content.replace(/<[^>]+>/g, '');
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '');
  text = text.replace(/<img[^>]+>/gi, '');
  text = text.replace(/```[\s\S]*?```/g, '');
  text = text.replace(/`[^`]+`/g, '');
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  text = text.replace(/^#{1,6}\s+/gm, '');
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/\*([^*]+)\*/g, '$1');
  text = text.replace(/__([^_]+)__/g, '$1');
  text = text.replace(/_([^_]+)_/g, '$1');
  text = text.replace(/~~([^~]+)~~/g, '$1');
  text = text.replace(/^>+\s*/gm, '');
  text = text.replace(/^\s*[-*+]\s+/gm, '');
  text = text.replace(/^\s*\d+\.\s+/gm, '');
  text = text.replace(/^[-*_]{3,}$/gm, '');
  text = text.replace(/&[a-zA-Z]+;/g, '');
  text = text.replace(/&#[0-9]+;/g, '');
  text = text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9，。！？、；：""''（）【】《》…—\s]/g, ' ');
  text = text.replace(/\s+/g, '');
  return text.length;
}

// ══════════════════════════════════════
// Library (书库) CRUD
// ══════════════════════════════════════

export function getLibraries(): Omit<Library, 'password'>[] {
  const rows = db.prepare('SELECT id, name, hidden, created_at, updated_at FROM libraries ORDER BY id').all();
  return rows as Omit<Library, 'password'>[];
}

/** Get all libraries WITH passwords (only use for auth matching) */
export function getLibrariesWithPasswords(): Library[] {
  return db.prepare('SELECT * FROM libraries ORDER BY id').all() as Library[];
}

export function getHiddenLibraries(): Omit<Library, 'password'>[] {
  const rows = db.prepare('SELECT id, name, hidden, created_at, updated_at FROM libraries WHERE hidden = 1 ORDER BY id').all();
  return rows as Omit<Library, 'password'>[];
}

export function getLibraryById(id: number): Library | null {
  const row = db.prepare('SELECT * FROM libraries WHERE id = ?').get(id);
  return (row as Library) || null;
}

export function createLibrary(input: { name: string; password?: string; hidden?: boolean }): Library {
  const now = new Date().toISOString();
  const stmt = db.prepare('INSERT INTO libraries (name, password, hidden, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
  const info = stmt.run(input.name, input.password || '', input.hidden ? 1 : 0, now, now);
  return getLibraryById(info.lastInsertRowid as number)!;
}

export function setLibraryHidden(id: number, hidden: boolean): boolean {
  const lib = getLibraryById(id);
  if (!lib) return false;
  const now = new Date().toISOString();
  db.prepare('UPDATE libraries SET hidden = ?, updated_at = ? WHERE id = ?').run(hidden ? 1 : 0, now, id);
  return true;
}

export function updateLibrary(id: number, input: { name?: string; password?: string }): boolean {
  const lib = getLibraryById(id);
  if (!lib) return false;
  const now = new Date().toISOString();
  const name = input.name ?? lib.name;
  const password = input.password !== undefined ? input.password : lib.password;
  db.prepare('UPDATE libraries SET name = ?, password = ?, updated_at = ? WHERE id = ?').run(name, password, now, id);
  return true;
}

export function deleteLibrary(id: number): boolean {
  const info = db.prepare('DELETE FROM libraries WHERE id = ?').run(id);
  return info.changes > 0;
}

// ══════════════════════════════════════
// Novel (书籍) CRUD
// ══════════════════════════════════════

export function getAllNovels(libraryId: number): Novel[] {
  const rows = db.prepare(
    'SELECT * FROM novels WHERE library_id = ? ORDER BY updated_at DESC'
  ).all(libraryId);
  return rows.map(r => parseNovelRow(r as Record<string, unknown>));
}

export function getNovelById(id: number, libraryId: number): (Novel & { chapters: Omit<Chapter, 'content'>[]; volumes: Volume[] }) | null {
  const row = db.prepare('SELECT * FROM novels WHERE id = ? AND library_id = ?').get(id, libraryId);
  if (!row) return null;
  const novel = parseNovelRow(row as Record<string, unknown>);

  const chapters = db.prepare(
    'SELECT id, novel_id, title, chapter_order, word_count, created_at FROM chapters WHERE novel_id = ? ORDER BY chapter_order ASC'
  ).all(id) as Omit<Chapter, 'content'>[];

  const volumes = db.prepare(
    'SELECT * FROM volumes WHERE novel_id = ?'
  ).all(id) as Volume[];

  return { ...novel, chapters, volumes };
}

export function createNovel(libraryId: number, input: { title: string; author?: string; description?: string; cover_url?: string; category?: string; tags?: string[]; status?: string }): Novel {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO novels (library_id, title, author, description, cover_url, category, tags, status, word_count, rating, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`
  );
  const info = stmt.run(
    libraryId, input.title, input.author || '', input.description || '',
    input.cover_url || '', input.category || '', JSON.stringify(input.tags || []),
    input.status || 'ongoing', now, now
  );
  return parseNovelRow(
    db.prepare('SELECT * FROM novels WHERE id = ?').get(info.lastInsertRowid) as Record<string, unknown>
  );
}

export function updateNovel(id: number, libraryId: number, input: { title?: string; author?: string; description?: string; cover_url?: string; category?: string; tags?: string[]; status?: string; rating?: number }): boolean {
  const row = db.prepare('SELECT * FROM novels WHERE id = ? AND library_id = ?').get(id, libraryId);
  if (!row) return false;
  const existing = parseNovelRow(row as Record<string, unknown>);
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE novels SET title = ?, author = ?, description = ?, cover_url = ?, category = ?, tags = ?, status = ?, rating = ?, updated_at = ? WHERE id = ?`
  ).run(
    input.title ?? existing.title,
    input.author ?? existing.author,
    input.description ?? existing.description,
    input.cover_url ?? existing.cover_url,
    input.category ?? existing.category,
    JSON.stringify(input.tags ?? existing.tags),
    input.status ?? existing.status,
    input.rating ?? existing.rating,
    now, id
  );
  return true;
}

export function deleteNovel(id: number, libraryId: number): boolean {
  const info = db.prepare('DELETE FROM novels WHERE id = ? AND library_id = ?').run(id, libraryId);
  return info.changes > 0;
}

// ══════════════════════════════════════
// Volume (分卷) CRUD
// ══════════════════════════════════════

export function createVolume(novelId: number, libraryId: number, title: string, position: number): Volume | null {
  // Verify novel belongs to library
  const novel = db.prepare('SELECT id FROM novels WHERE id = ? AND library_id = ?').get(novelId, libraryId);
  if (!novel) return null;
  const stmt = db.prepare('INSERT INTO volumes (novel_id, title, position) VALUES (?, ?, ?)');
  const info = stmt.run(novelId, title, position);
  return db.prepare('SELECT * FROM volumes WHERE id = ?').get(info.lastInsertRowid) as Volume;
}

export function updateVolume(volumeId: number, novelId: number, libraryId: number, title: string, position: number): Volume | null {
  // Verify novel belongs to library
  const novel = db.prepare('SELECT id FROM novels WHERE id = ? AND library_id = ?').get(novelId, libraryId);
  if (!novel) return null;
  const info = db.prepare('UPDATE volumes SET title = ?, position = ? WHERE id = ? AND novel_id = ?').run(title, position, volumeId, novelId);
  if (info.changes === 0) return null;
  return db.prepare('SELECT * FROM volumes WHERE id = ?').get(volumeId) as Volume;
}

export function deleteVolume(volumeId: number, novelId: number, libraryId: number): boolean {
  const novel = db.prepare('SELECT id FROM novels WHERE id = ? AND library_id = ?').get(novelId, libraryId);
  if (!novel) return false;
  const info = db.prepare('DELETE FROM volumes WHERE id = ? AND novel_id = ?').run(volumeId, novelId);
  return info.changes > 0;
}

// ══════════════════════════════════════
// Chapter (章节) CRUD
// ══════════════════════════════════════

export function getChaptersByNovelId(novelId: number, libraryId: number): Omit<Chapter, 'content'>[] {
  // Verify novel belongs to library
  const novel = db.prepare('SELECT id FROM novels WHERE id = ? AND library_id = ?').get(novelId, libraryId);
  if (!novel) return [];
  return db.prepare(
    'SELECT id, novel_id, title, chapter_order, word_count, created_at FROM chapters WHERE novel_id = ? ORDER BY chapter_order ASC'
  ).all(novelId) as Omit<Chapter, 'content'>[];
}

export function getChapterById(id: number, libraryId: number): Chapter | null {
  const row = db.prepare(
    `SELECT c.* FROM chapters c
     JOIN novels n ON c.novel_id = n.id
     WHERE c.id = ? AND n.library_id = ?`
  ).get(id, libraryId);
  return (row as Chapter) || null;
}

export function createChapter(input: { novel_id: number; library_id: number; title: string; content: string; chapter_order: number }): Chapter {
  const { novel_id, library_id, title, content, chapter_order } = input;
  const now = new Date().toISOString();
  const wordCount = calculateWordCount(content);

  const stmt = db.prepare(
    `INSERT INTO chapters (novel_id, title, content, chapter_order, word_count, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  );
  const info = stmt.run(novel_id, title, content, chapter_order || 0, wordCount, now);

  // Update novel word count and updated_at
  const totalWords = db.prepare(
    'SELECT COALESCE(SUM(word_count), 0) as total FROM chapters WHERE novel_id = ?'
  ).get(novel_id) as { total: number };
  db.prepare('UPDATE novels SET word_count = ?, updated_at = ? WHERE id = ?').run(totalWords.total, now, novel_id);

  return db.prepare('SELECT * FROM chapters WHERE id = ?').get(info.lastInsertRowid) as Chapter;
}

export function updateChapter(id: number, libraryId: number, input: { title: string; content: string; chapter_order: number }): boolean {
  // Verify chapter belongs to library
  const existing = getChapterById(id, libraryId);
  if (!existing) return false;

  const wordCount = calculateWordCount(input.content);
  db.prepare(
    'UPDATE chapters SET title = ?, content = ?, chapter_order = ?, word_count = ? WHERE id = ?'
  ).run(input.title, input.content, input.chapter_order || 0, wordCount, id);

  // Update novel word count and updated_at
  const now = new Date().toISOString();
  const totalWords = db.prepare(
    'SELECT COALESCE(SUM(word_count), 0) as total FROM chapters WHERE novel_id = ?'
  ).get(existing.novel_id) as { total: number };
  db.prepare('UPDATE novels SET word_count = ?, updated_at = ? WHERE id = ?').run(totalWords.total, now, existing.novel_id);

  return true;
}

export function deleteChapter(id: number, libraryId: number): boolean {
  const existing = getChapterById(id, libraryId);
  if (!existing) return false;

  db.prepare('DELETE FROM chapters WHERE id = ?').run(id);

  // Update novel word count and updated_at
  const now = new Date().toISOString();
  const totalWords = db.prepare(
    'SELECT COALESCE(SUM(word_count), 0) as total FROM chapters WHERE novel_id = ?'
  ).get(existing.novel_id) as { total: number };
  db.prepare('UPDATE novels SET word_count = ?, updated_at = ? WHERE id = ?').run(totalWords.total, now, existing.novel_id);

  return true;
}
