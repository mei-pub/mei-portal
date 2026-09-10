/**
 * 数据迁移脚本：从 novels-data.json 迁移到 SQLite (novels.db)
 * 
 * 用法：npx tsx scripts/migrate-json-to-sqlite.ts
 * 
 * 读取现有的 novels-data.json，创建默认书库，并将所有数据导入 SQLite。
 */

import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';

// Resolve paths
const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), './data');
const JSON_PATH = path.join(DATA_DIR, 'novels-data.json');
const DB_PATH = path.join(DATA_DIR, 'novels.db');

interface JsonData {
  novels: {
    id: number;
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
    volumes?: { id: number; title: string; position: number }[];
  }[];
  chapters: {
    id: number;
    novel_id: number;
    title: string;
    content: string;
    chapter_order: number;
    word_count: number;
    created_at: string;
  }[];
  settings: {
    siteName: string;
    password: string;
  };
  nextNovelId: number;
  nextChapterId: number;
}

function migrate() {
  console.log('=== JSON to SQLite Migration ===');
  console.log(`JSON path: ${JSON_PATH}`);
  console.log(`DB path: ${DB_PATH}`);

  if (!fs.existsSync(JSON_PATH)) {
    console.log('No novels-data.json found. Nothing to migrate.');
    console.log('The app will create a fresh SQLite database on first launch.');
    return;
  }

  const rawData = fs.readFileSync(JSON_PATH, 'utf-8');
  const data: JsonData = JSON.parse(rawData);

  console.log(`Found ${data.novels.length} novels, ${data.chapters.length} chapters`);

  // Check if DB already exists
  if (fs.existsSync(DB_PATH)) {
    console.log('SQLite database already exists. Skipping migration.');
    return;
  }

  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Create database
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create tables
  db.exec(`
    CREATE TABLE libraries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      password TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE novels (
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

    CREATE TABLE volumes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      position INTEGER DEFAULT 0,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    CREATE TABLE chapters (
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

  // Use a transaction for atomic migration
  const migrateAll = db.transaction(() => {
    // 1. Create default library
    const now = new Date().toISOString();
    const siteName = data.settings?.siteName || '小说书架';
    const sitePassword = data.settings?.password || '';

    const libInfo = db.prepare(
      'INSERT INTO libraries (name, password, created_at, updated_at) VALUES (?, ?, ?, ?)'
    ).run(siteName, sitePassword, now, now);
    const libraryId = libInfo.lastInsertRowid;
    console.log(`Created default library: "${siteName}" (id: ${libraryId})`);

    // 2. Migrate novels
    const insertNovel = db.prepare(
      `INSERT INTO novels (id, library_id, title, author, description, cover_url, category, tags, status, word_count, rating, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const novel of data.novels) {
      insertNovel.run(
        novel.id,
        libraryId,
        novel.title,
        novel.author || '',
        novel.description || '',
        novel.cover_url || '',
        novel.category || '',
        JSON.stringify(novel.tags || []),
        novel.status || 'ongoing',
        novel.word_count || 0,
        novel.rating ?? 0,
        novel.created_at || now,
        novel.updated_at || now
      );
    }
    console.log(`Migrated ${data.novels.length} novels`);

    // 3. Migrate volumes
    const insertVolume = db.prepare(
      'INSERT INTO volumes (novel_id, title, position) VALUES (?, ?, ?)'
    );
    let volumeCount = 0;
    for (const novel of data.novels) {
      if (novel.volumes && novel.volumes.length > 0) {
        for (const vol of novel.volumes) {
          insertVolume.run(novel.id, vol.title, vol.position || 0);
          volumeCount++;
        }
      }
    }
    console.log(`Migrated ${volumeCount} volumes`);

    // 4. Migrate chapters
    const insertChapter = db.prepare(
      `INSERT INTO chapters (id, novel_id, title, content, chapter_order, word_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    for (const chapter of data.chapters) {
      insertChapter.run(
        chapter.id,
        chapter.novel_id,
        chapter.title,
        chapter.content || '',
        chapter.chapter_order || 0,
        chapter.word_count || 0,
        chapter.created_at || now
      );
    }
    console.log(`Migrated ${data.chapters.length} chapters`);
  });

  migrateAll();
  db.close();

  console.log('\nMigration completed successfully!');
  console.log(`SQLite database created at: ${DB_PATH}`);
  console.log('\nYou can now safely delete or archive the old novels-data.json file.');
}

try {
  migrate();
} catch (error) {
  console.error('Migration failed:', error);
  process.exit(1);
}
