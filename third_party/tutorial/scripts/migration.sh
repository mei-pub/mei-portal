#!/bin/bash
# 数据迁移脚本 - 从 novels-data.json 迁移到 SQLite
# 用法:
#   ./migration.sh                    # 交互式
#   ./migration.sh --force            # 强制覆盖现有数据库

set -e

# 加载环境变量
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/envload.sh"

FORCE=false
if [ "$1" == "--force" ]; then
    FORCE=true
fi

echo "=== JSON to SQLite Migration ==="
echo "JSON: $HOST_DATA_DIR/novels-data.json"
echo "DB: $HOST_DB_PATH"
echo "容器内路径: /app/data/novels-data.json"

# 检查宿主机上的 JSON 文件
if [ ! -f "$HOST_DATA_DIR/novels-data.json" ]; then
    echo ""
    echo "错误: novels-data.json 不存在: $HOST_DATA_DIR/novels-data.json"
    echo "请确保 JSON 文件存在于指定目录"
    exit 1
fi

# 检查数据库是否已存在
if [ -f "$HOST_DB_PATH" ]; then
    if [ "$FORCE" == "false" ]; then
        echo ""
        echo "数据库已存在: $HOST_DB_PATH"
        echo "使用 --force 参数可强制重新迁移（会清空现有数据）"
        echo ""
        # 交互式询问
        read -p "是否强制重新迁移? (会清空现有数据) (y/N): " confirm
        if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
            echo "已取消"
            exit 0
        fi
    fi
    
    # 备份现有数据库
    BACKUP_PATH="$HOST_DB_PATH.backup.$(date +%Y%m%d_%H%M%S)"
    cp "$HOST_DB_PATH" "$BACKUP_PATH"
    rm -f "$HOST_DB_PATH" "$HOST_DB_PATH-wal" "$HOST_DB_PATH-shm"
    echo "已备份现有数据库到: $BACKUP_PATH"
fi

# 确保宿主机目录存在
mkdir -p "$HOST_DATA_DIR"

# 执行迁移 - 在容器内进行
# 容器内路径固定为 /app/data
CONTAINER_DATA_DIR="/app/data"

echo ""
echo "开始迁移..."

echo "检查容器内文件..."
docker exec novels node -e "
const fs = require('fs');
const path = require('path');
const jsonPath = '/app/data/novels-data.json';
const dbPath = '/app/data/novels.db';
console.log('JSON exists:', fs.existsSync(jsonPath));
console.log('JSON path:', jsonPath);
console.log('DB path:', dbPath);
"

docker exec novels node -e "
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// 容器内固定路径
const DATA_DIR = '/app/data';
const JSON_PATH = path.join(DATA_DIR, 'novels-data.json');
const DB_PATH = path.join(DATA_DIR, 'novels.db');

if (!fs.existsSync(JSON_PATH)) {
    console.error('JSON file not found:', JSON_PATH);
    process.exit(1);
}

// 读取 JSON
const rawData = fs.readFileSync(JSON_PATH, 'utf-8');
const data = JSON.parse(rawData);

console.log('Found ' + data.novels.length + ' novels, ' + data.chapters.length + ' chapters');

// 创建数据库
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 创建表
db.exec(\`
CREATE TABLE IF NOT EXISTS libraries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    password TEXT NOT NULL DEFAULT '',
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
\`);

// 迁移事务
const now = new Date().toISOString();
const siteName = data.settings?.siteName || '小说书架';
const sitePassword = data.settings?.password || '';

// 创建默认书库
const libInfo = db.prepare(
    'INSERT INTO libraries (name, password, created_at, updated_at) VALUES (?, ?, ?, ?)'
).run(siteName, sitePassword, now, now);
const libraryId = libInfo.lastInsertRowid;
console.log('Created library: ' + siteName + ' (id: ' + libraryId + ')');

// 迁移小说
const insertNovel = db.prepare(
    \`INSERT INTO novels (id, library_id, title, author, description, cover_url, category, tags, status, word_count, rating, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\`
);
for (const novel of data.novels) {
    insertNovel.run(
        novel.id, libraryId, novel.title, novel.author || '', novel.description || '',
        novel.cover_url || '', novel.category || '', JSON.stringify(novel.tags || []),
        novel.status || 'ongoing', novel.word_count || 0, novel.rating ?? 0,
        novel.created_at || now, novel.updated_at || now
    );
}
console.log('Migrated ' + data.novels.length + ' novels');

// 迁移卷
const insertVolume = db.prepare('INSERT INTO volumes (novel_id, title, position) VALUES (?, ?, ?)');
let volumeCount = 0;
for (const novel of data.novels) {
    if (novel.volumes && novel.volumes.length > 0) {
        for (const vol of novel.volumes) {
            insertVolume.run(novel.id, vol.title, vol.position || 0);
            volumeCount++;
        }
    }
}
console.log('Migrated ' + volumeCount + ' volumes');

// 迁移章节
const insertChapter = db.prepare(
    \`INSERT INTO chapters (id, novel_id, title, content, chapter_order, word_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)\`
);
for (const chapter of data.chapters) {
    insertChapter.run(
        chapter.id, chapter.novel_id, chapter.title, chapter.content || '',
        chapter.chapter_order || 0, chapter.word_count || 0, chapter.created_at || now
    );
}
console.log('Migrated ' + data.chapters.length + ' chapters');

db.close();
console.log('');
console.log('Migration completed successfully!');
console.log('DB: ' + DB_PATH);
"

echo ""
echo "迁移完成！"