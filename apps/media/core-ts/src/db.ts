// db —— Go internal/db + repo 的复刻：better-sqlite3；表 video/favorite/conversion（camelCase 列名，与 GORM AutoMigrate 一致）

import Database from 'better-sqlite3';
import path from 'node:path';

export interface Video {
  id: number;
  name: string;
  type: string;
  url: string;
  folder: string | null;
  headers: string | null;
  isLive: boolean;
  status: string;
  createdDate: string;
  updatedDate: string;
}

export interface Favorite {
  id: number;
  title: string;
  url: string;
  icon: string | null;
  createdDate: string;
  updatedDate: string;
}

export interface Conversion {
  id: number;
  name: string | null;
  path: string;
  status: string;
  outputPath: string;
  outputFormat: string;
  quality: string;
  progress: number;
  error: string | null;
  createdDate: string;
  updatedDate: string;
}

interface VideoRow {
  id: number; name: string; type: string; url: string;
  folder: string | null; headers: string | null; isLive: number;
  status: string; createdDate: string; updatedDate: string;
}
interface FavoriteRow {
  id: number; title: string; url: string; icon: string | null;
  createdDate: string; updatedDate: string;
}
interface ConversionRow {
  id: number; name: string | null; path: string; status: string;
  outputPath: string; outputFormat: string; quality: string;
  progress: number; error: string | null; createdDate: string; updatedDate: string;
}

const now = (): string => new Date().toISOString();

function toVideo(r: VideoRow): Video {
  return { ...r, isLive: !!r.isLive };
}

/** 打开数据库并幂等建表（CREATE IF NOT EXISTS，不迁移旧库——/data/media 为新目录） */
export function openDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS video (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'm3u8',
      url TEXT NOT NULL,
      folder TEXT,
      headers TEXT,
      isLive INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ready',
      createdDate TEXT NOT NULL,
      updatedDate TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_video_name ON video(name);

    CREATE TABLE IF NOT EXISTS favorite (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      icon TEXT,
      createdDate TEXT NOT NULL,
      updatedDate TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversion (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      path TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      outputPath TEXT DEFAULT '',
      outputFormat TEXT DEFAULT '',
      quality TEXT DEFAULT 'medium',
      progress INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      createdDate TEXT NOT NULL,
      updatedDate TEXT NOT NULL
    );
  `);
  return db;
}

// ---- VideoRepository（对应 Go repo/video_repo.go）----

export class VideoRepository {
  private readonly db: Database.Database;
  constructor(db: Database.Database) {
    this.db = db;
  }

  create(video: Omit<Video, 'id' | 'createdDate' | 'updatedDate'>): Video {
    const ts = now();
    const info = this.db
      .prepare(`INSERT INTO video (name, type, url, folder, headers, isLive, status, createdDate, updatedDate)
                VALUES (@name, @type, @url, @folder, @headers, @isLive, @status, @createdDate, @updatedDate)`)
      .run({ ...video, isLive: video.isLive ? 1 : 0, createdDate: ts, updatedDate: ts });
    return this.findByIdOrFail(info.lastInsertRowid as number);
  }

  createMany(videos: Array<Omit<Video, 'id' | 'createdDate' | 'updatedDate'>>): Video[] {
    if (videos.length === 0) return [];
    const created: Video[] = [];
    const insert = this.db
      .prepare(`INSERT INTO video (name, type, url, folder, headers, isLive, status, createdDate, updatedDate)
                VALUES (@name, @type, @url, @folder, @headers, @isLive, @status, @createdDate, @updatedDate)`);
    const run = this.db.transaction((items: typeof videos) => {
      for (const v of items) {
        const ts = now();
        const info = insert.run({ ...v, isLive: v.isLive ? 1 : 0, createdDate: ts, updatedDate: ts });
        created.push(this.findByIdOrFail(info.lastInsertRowid as number));
      }
    });
    run(videos);
    return created;
  }

  private baseSelect = 'SELECT * FROM video';

  findById(id: number): Video | null {
    const row = this.db.prepare(`${this.baseSelect} WHERE id = ?`).get(id) as VideoRow | undefined;
    return row ? toVideo(row) : null;
  }

  findByIdOrFail(id: number): Video {
    const v = this.findById(id);
    if (!v) throw new Error('video_not_found');
    return v;
  }

  findByName(name: string): Video | null {
    const row = this.db.prepare(`${this.baseSelect} WHERE name = ? LIMIT 1`).get(name) as VideoRow | undefined;
    return row ? toVideo(row) : null;
  }

  findByURL(url: string): Video | null {
    const row = this.db.prepare(`${this.baseSelect} WHERE url = ? LIMIT 1`).get(url) as VideoRow | undefined;
    return row ? toVideo(row) : null;
  }

  findAll(order: 'ASC' | 'DESC'): Video[] {
    const rows = this.db.prepare(`${this.baseSelect} ORDER BY createdDate ${order}`).all() as VideoRow[];
    return rows.map(toVideo);
  }

  findByStatus(statuses: string[]): Video[] {
    if (statuses.length === 0) return [];
    const ph = statuses.map(() => '?').join(',');
    const rows = this.db
      .prepare(`${this.baseSelect} WHERE status IN (${ph})`)
      .all(...statuses) as VideoRow[];
    return rows.map(toVideo);
  }

  findWithPagination(current: number, pageSize: number, filter: string): { items: Video[]; total: number } {
    if (current <= 0) current = 1;
    if (pageSize <= 0) pageSize = 50;
    let where = '';
    const params: unknown[] = [];
    if (filter === 'done') {
      where = 'WHERE status = ?';
      params.push('success');
    } else if (filter === 'list') {
      where = 'WHERE status != ?';
      params.push('success');
    }
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM video ${where}`).get(...params) as { n: number }).n;
    const rows = this.db
      .prepare(`${this.baseSelect} ${where} ORDER BY createdDate DESC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, (current - 1) * pageSize) as VideoRow[];
    return { items: rows.map(toVideo), total };
  }

  findDistinctFolders(): string[] {
    const rows = this.db
      .prepare(`SELECT DISTINCT folder FROM video WHERE folder IS NOT NULL AND folder != ''`)
      .all() as Array<{ folder: string }>;
    return rows.map((r) => r.folder);
  }

  /** 部分更新（map 语义：给出的键全更新，含零值；对应 GORM Updates(map)） */
  update(id: number, data: { [key: string]: unknown }): Video {
    const allowed = ['name', 'type', 'url', 'folder', 'headers', 'isLive', 'status'];
    const keys = Object.keys(data).filter((k) => allowed.includes(k));
    const sets = keys.map((k) => `${k} = @${k}`).join(', ');
    if (keys.length > 0) {
      const params: Record<string, unknown> = { ...data, id, updatedDate: now() };
      if ('isLive' in data) params.isLive = data.isLive ? 1 : 0;
      this.db.prepare(`UPDATE video SET ${sets}, updatedDate = @updatedDate WHERE id = @id`).run(params);
    }
    return this.findByIdOrFail(id);
  }

  updateStatus(ids: number[], status: string): void {
    if (ids.length === 0) return;
    const ph = ids.map(() => '?').join(',');
    this.db.prepare(`UPDATE video SET status = ?, updatedDate = ? WHERE id IN (${ph})`).run(status, now(), ...ids);
  }

  updateIsLive(id: number, isLive: boolean): Video {
    this.db.prepare('UPDATE video SET isLive = ?, updatedDate = ? WHERE id = ?').run(isLive ? 1 : 0, now(), id);
    return this.findByIdOrFail(id);
  }

  delete(id: number): void {
    this.db.prepare('DELETE FROM video WHERE id = ?').run(id);
  }

  deleteMany(ids: number[]): void {
    if (ids.length === 0) return;
    const ph = ids.map(() => '?').join(',');
    this.db.prepare(`DELETE FROM video WHERE id IN (${ph})`).run(...ids);
  }
}

// ---- FavoriteRepository（对应 Go repo/favorite_repo.go）----

export class FavoriteRepository {
  private readonly db: Database.Database;
  constructor(db: Database.Database) {
    this.db = db;
  }

  create(fav: { title: string; url: string; icon: string | null }): Favorite {
    const ts = now();
    const info = this.db
      .prepare(`INSERT INTO favorite (title, url, icon, createdDate, updatedDate) VALUES (?, ?, ?, ?, ?)`)
      .run(fav.title, fav.url, fav.icon, ts, ts);
    return this.findById(info.lastInsertRowid as number)!;
  }

  createMany(favs: Array<{ title: string; url: string; icon: string | null }>): Favorite[] {
    const created: Favorite[] = [];
    const insert = this.db
      .prepare(`INSERT INTO favorite (title, url, icon, createdDate, updatedDate) VALUES (?, ?, ?, ?, ?)`);
    const run = this.db.transaction((items: typeof favs) => {
      for (const f of items) {
        const ts = now();
        const info = insert.run(f.title, f.url, f.icon, ts, ts);
        created.push(this.findById(info.lastInsertRowid as number)!);
      }
    });
    run(favs);
    return created;
  }

  private findById(id: number): Favorite | null {
    return (this.db.prepare('SELECT * FROM favorite WHERE id = ?').get(id) as FavoriteRow | undefined) ?? null;
  }

  findByURL(url: string): Favorite | null {
    const row = this.db.prepare('SELECT * FROM favorite WHERE url = ? LIMIT 1').get(url) as FavoriteRow | undefined;
    return row ?? null;
  }

  findAll(order: 'ASC' | 'DESC'): Favorite[] {
    return this.db.prepare(`SELECT * FROM favorite ORDER BY createdDate ${order}`).all() as FavoriteRow[];
  }

  delete(id: number): void {
    this.db.prepare('DELETE FROM favorite WHERE id = ?').run(id);
  }
}

// ---- ConversionRepository（对应 Go repo/conversion_repo.go）----

export class ConversionRepository {
  private readonly db: Database.Database;
  constructor(db: Database.Database) {
    this.db = db;
  }

  create(conv: { name: string | null; path: string; outputFormat: string; quality: string; status: string }): Conversion {
    const ts = now();
    const info = this.db
      .prepare(`INSERT INTO conversion (name, path, status, outputPath, outputFormat, quality, progress, createdDate, updatedDate)
                VALUES (?, ?, ?, '', ?, ?, 0, ?, ?)`)
      .run(conv.name, conv.path, conv.status, conv.outputFormat, conv.quality, ts, ts);
    return this.findByIdOrFail(info.lastInsertRowid as number);
  }

  findById(id: number): Conversion | null {
    return (this.db.prepare('SELECT * FROM conversion WHERE id = ?').get(id) as ConversionRow | undefined) ?? null;
  }

  findByIdOrFail(id: number): Conversion {
    const c = this.findById(id);
    if (!c) throw new Error('conversion_not_found');
    return c;
  }

  findWithPagination(current: number, pageSize: number): { items: Conversion[]; total: number } {
    if (current <= 0) current = 1;
    if (pageSize <= 0) pageSize = 50;
    const total = (this.db.prepare('SELECT COUNT(*) AS n FROM conversion').get() as { n: number }).n;
    const items = this.db
      .prepare(`SELECT * FROM conversion ORDER BY createdDate ASC LIMIT ? OFFSET ?`)
      .all(pageSize, (current - 1) * pageSize) as ConversionRow[];
    return { items, total };
  }

  updateStatus(id: number, status: string, progress: number, outputPath: string, errMsg: string | null): void {
    this.db
      .prepare(`UPDATE conversion SET status = ?, progress = ?, outputPath = ?, error = ?, updatedDate = ? WHERE id = ?`)
      .run(status, progress, outputPath, errMsg, now(), id);
  }

  delete(id: number): void {
    this.db.prepare('DELETE FROM conversion WHERE id = ?').run(id);
  }
}

/** DB 文件路径仅用于日志 */
export function dbDir(dbPath: string): string {
  return path.dirname(dbPath);
}
