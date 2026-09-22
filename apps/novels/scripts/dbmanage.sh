#!/bin/bash
# 数据库管理工具 - 集成书库、书籍、章节管理及数据迁移
# 支持交互式菜单和命令行参数两种模式
# 用法:
#   ./dbmanage.sh                    # 交互式菜单
#   ./dbmanage.sh lib list           # 书库管理 - 列出
#   ./dbmanage.sh lib add "名称"     # 书库管理 - 添加
#   ./dbmanage.sh novel list [ID]    # 书籍管理 - 列出
#   ./dbmanage.sh novel add 1 "书名" # 书籍管理 - 添加
#   ./dbmanage.sh chapter list 1     # 章节管理 - 列出
#   ./dbmanage.sh chapter add 1 "章名"# 章节管理 - 添加
#   ./dbmanage.sh migrate             # 数据迁移
#   ./dbmanage.sh help                # 显示帮助

set -e

# 加载环境变量
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/envload.sh"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印带颜色的标题
print_header() {
    echo -e "${BLUE}=== $1 ===${NC}"
}

print_success() {
    echo -e "${GREEN}$1${NC}"
}

print_error() {
    echo -e "${RED}错误: $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}$1${NC}"
}

# 检查数据库
check_db() {
    if [ ! -f "$HOST_DB_PATH" ]; then
        print_error "数据库文件不存在: $HOST_DB_PATH"
        echo "请先运行迁移: $0 migrate"
        return 1
    fi
    return 0
}

# ==================== 书库管理 ====================
lib_list() {
    echo -e "\n${BLUE}=== 书库列表 ===${NC}\n"
    docker exec novels node -e "
const Database = require('better-sqlite3');
const db = new Database('$CONTAINER_DB_PATH');
const libs = db.prepare('SELECT id, name, password, created_at FROM libraries ORDER BY id').all();
if (libs.length === 0) {
    console.log('暂无书库');
} else {
    libs.forEach(lib => {
        console.log('ID: ' + lib.id + ' | 名称: ' + lib.name + ' | 密码: ' + (lib.password ? '已设置' : '无') + ' | 创建: ' + lib.created_at);
    });
}
db.close();
" 2>/dev/null || print_error "请确保容器正在运行"
}

lib_add() {
    NAME="$2"
    PASSWORD="$3"
    
    if [ -z "$NAME" ]; then
        print_error "请提供书库名称"
        echo "用法: $0 lib add \"名称\" [密码]"
        exit 1
    fi
    
    check_db || exit 1
    
    print_warning "正在创建书库..."
    docker exec novels node -e "
const Database = require('better-sqlite3');
const db = new Database('$CONTAINER_DB_PATH');
const now = new Date().toISOString();
const info = db.prepare('INSERT INTO libraries (name, password, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run('$NAME', '$PASSWORD', now, now);
console.log('ID: ' + info.lastInsertRowid + ' | 名称: $NAME | 密码: ' + ('$PASSWORD' ? '已设置' : '无'));
db.close();
"
    print_success "书库创建成功!"
}

lib_delete() {
    ID="$2"
    
    if [ -z "$ID" ]; then
        print_error "请提供书库ID"
        exit 1
    fi
    
    check_db || exit 1
    
    # 检查书库
    INFO=$(docker exec novels node -e "
const Database = require('better-sqlite3');
const db = new Database('$CONTAINER_DB_PATH');
const lib = db.prepare('SELECT * FROM libraries WHERE id = ?').get($ID);
const count = db.prepare('SELECT COUNT(*) as c FROM libraries').get();
const novels = db.prepare('SELECT COUNT(*) as c FROM novels WHERE library_id = ?').get($ID);
if (lib) console.log(JSON.stringify({lib: lib, total: count.c, novels: novels.c}));
db.close();
" 2>/dev/null)
    
    if [ -z "$INFO" ]; then
        print_error "书库 ID=$ID 不存在"
        exit 1
    fi
    
    TOTAL=$(echo "$INFO" | grep -o '"total":[0-9]*' | grep -o '[0-9]*')
    NOVELS=$(echo "$INFO" | grep -o '"novels":[0-9]*' | grep -o '[0-9]*')
    NAME=$(echo "$INFO" | grep -o '"name":"[^"]*"' | sed 's/"name":"//;s/"//')
    
    if [ "$TOTAL" -le 1 ]; then
        print_error "不能删除最后一个书库"
        exit 1
    fi
    
    if [ "$NOVELS" -gt 0 ]; then
        print_error "该书库下有 $NOVELS 本小说，请先删除所有小说"
        exit 1
    fi
    
    print_warning "确认删除书库 \"$NAME\" (ID=$ID)? (y/N)"
    read -r confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        echo "已取消"
        exit 0
    fi
    
    docker exec novels node -e "
const Database = require('better-sqlite3');
const db = new Database('$CONTAINER_DB_PATH');
db.prepare('DELETE FROM libraries WHERE id = ?').run($ID);
db.close();
"
    print_success "书库已删除"
}

# ==================== 书籍管理 ====================
novel_list() {
    LIB_ID="${2:-1}"
    
    check_db || exit 1
    
    LIB_INFO=$(docker exec novels node -e "
const Database = require('better-sqlite3');
const db = new Database('$CONTAINER_DB_PATH');
const lib = db.prepare('SELECT * FROM libraries WHERE id = ?').get($LIB_ID);
if (lib) console.log(JSON.stringify(lib));
db.close();
" 2>/dev/null)
    
    if [ -z "$LIB_INFO" ]; then
        print_error "书库 ID=$LIB_ID 不存在"
        exit 1
    fi
    
    LIB_NAME=$(echo "$LIB_INFO" | grep -o '"name":"[^"]*"' | sed 's/"name":"//;s/"//')
    
    echo -e "\n${BLUE}=== $LIB_NAME 下的书籍 ===${NC}\n"
    
    docker exec novels node -e "
const Database = require('better-sqlite3');
const db = new Database('$CONTAINER_DB_PATH');
const novels = db.prepare('SELECT * FROM novels WHERE library_id = $LIB_ID ORDER BY id').all();
if (novels.length === 0) {
    console.log('暂无书籍');
} else {
    novels.forEach(n => {
        console.log('[' + n.id + '] ' + n.title + ' | 作者: ' + (n.author || '-') + ' | 状态: ' + n.status + ' | 字数: ' + (n.word_count || 0));
    });
}
db.close();
" 2>/dev/null || print_error "请确保容器正在运行"
}

novel_add() {
    LIB_ID="$2"
    TITLE="$3"
    AUTHOR="${4:-}"
    
    if [ -z "$TITLE" ]; then
        print_error "请提供书籍标题"
        echo "用法: $0 novel add <书库ID> \"标题\" [作者]"
        exit 1
    fi
    
    check_db || exit 1
    
    docker exec novels node -e "
const Database = require('better-sqlite3');
const db = new Database('$CONTAINER_DB_PATH');
const lib = db.prepare('SELECT * FROM libraries WHERE id = ?').get($LIB_ID);
if (!lib) { console.log('ERROR:LibraryNotFound'); process.exit(1); }
const now = new Date().toISOString();
const info = db.prepare('INSERT INTO novels (library_id, title, author, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run($LIB_ID, '$TITLE', '$AUTHOR', now, now);
console.log('ID: ' + info.lastInsertRowid + ' | 标题: $TITLE | 作者: $AUTHOR');
db.close();
" 2>/dev/null
    
    if [ $? -eq 0 ]; then
        print_success "书籍创建成功!"
    else
        print_error "创建失败，请检查书库ID是否正确"
    fi
}

novel_delete() {
    NOVEL_ID="$2"
    
    if [ -z "$NOVEL_ID" ]; then
        print_error "请提供书籍ID"
        exit 1
    fi
    
    check_db || exit 1
    
    NOVEL_INFO=$(docker exec novels node -e "
const Database = require('better-sqlite3');
const db = new Database('$CONTAINER_DB_PATH');
const novel = db.prepare('SELECT * FROM novels WHERE id = ?').get($NOVEL_ID);
const chapters = db.prepare('SELECT COUNT(*) as c FROM chapters WHERE novel_id = ?').get($NOVEL_ID);
if (novel) console.log(JSON.stringify({novel: novel, chapters: chapters.c}));
db.close();
" 2>/dev/null)
    
    if [ -z "$NOVEL_INFO" ]; then
        print_error "书籍 ID=$NOVEL_ID 不存在"
        exit 1
    fi
    
    CHAPTERS=$(echo "$NOVEL_INFO" | grep -o '"chapters":[0-9]*' | grep -o '[0-9]*')
    TITLE=$(echo "$NOVEL_INFO" | grep -o '"title":"[^"]*"' | sed 's/"title":"//;s/"//')
    
    if [ "$CHAPTERS" -gt 0 ]; then
        print_error "该书籍下有 $CHAPTERS 个章节，请先删除所有章节"
        exit 1
    fi
    
    print_warning "确认删除书籍 \"$TITLE\" (ID=$NOVEL_ID)? (y/N)"
    read -r confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        echo "已取消"
        exit 0
    fi
    
    docker exec novels node -e "
const Database = require('better-sqlite3');
const db = new Database('$CONTAINER_DB_PATH');
db.prepare('DELETE FROM novels WHERE id = ?').run($NOVEL_ID);
db.close();
"
    print_success "书籍已删除"
}

# ==================== 章节管理 ====================
chapter_list() {
    NOVEL_ID="$2"
    
    if [ -z "$NOVEL_ID" ]; then
        print_error "请提供书籍ID"
        echo "用法: $0 chapter list <书籍ID>"
        exit 1
    fi
    
    check_db || exit 1
    
    echo -e "\n${BLUE}=== 书籍 ID=$NOVEL_ID 的章节 ===${NC}\n"
    
    docker exec novels node -e "
const Database = require('better-sqlite3');
const db = new Database('$CONTAINER_DB_PATH');
const chapters = db.prepare('SELECT id, title, chapter_order, word_count FROM chapters WHERE novel_id = $NOVEL_ID ORDER BY chapter_order, id').all();
if (chapters.length === 0) {
    console.log('暂无章节');
} else {
    chapters.forEach(c => {
        console.log('[' + c.chapter_order + '] ' + c.id + '. ' + c.title + ' (' + (c.word_count || 0) + '字)');
    });
}
db.close();
" 2>/dev/null || print_error "请确保容器正在运行"
}

chapter_add() {
    NOVEL_ID="$2"
    TITLE="$3"
    
    if [ -z "$TITLE" ]; then
        print_error "请提供章节标题"
        echo "用法: $0 chapter add <书籍ID> \"标题\""
        exit 1
    fi
    
    check_db || exit 1
    
    MAX_ORDER=$(docker exec novels node -e "
const Database = require('better-sqlite3');
const db = new Database('$CONTAINER_DB_PATH');
const result = db.prepare('SELECT MAX(chapter_order) as max_order FROM chapters WHERE novel_id = $NOVEL_ID').get();
console.log(result?.max_order || 0);
db.close();
" 2>/dev/null)
    
    NEW_ORDER=$((MAX_ORDER + 1))
    
    docker exec novels node -e "
const Database = require('better-sqlite3');
const db = new Database('$CONTAINER_DB_PATH');
const now = new Date().toISOString();
const info = db.prepare('INSERT INTO chapters (novel_id, title, chapter_order, created_at) VALUES (?, ?, ?, ?)')
    .run($NOVEL_ID, '$TITLE', $NEW_ORDER, now);
console.log('ID: ' + info.lastInsertRowid + ' | 标题: $TITLE | 排序: ' + $NEW_ORDER);
db.close();
"
    print_success "章节创建成功!"
}

chapter_delete() {
    CHAPTER_ID="$2"
    
    if [ -z "$CHAPTER_ID" ]; then
        print_error "请提供章节ID"
        exit 1
    fi
    
    check_db || exit 1
    
    CHAPTER_INFO=$(docker exec novels node -e "
const Database = require('better-sqlite3');
const db = new Database('$CONTAINER_DB_PATH');
const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get($CHAPTER_ID);
if (chapter) console.log(JSON.stringify(chapter));
db.close();
" 2>/dev/null)
    
    if [ -z "$CHAPTER_INFO" ]; then
        print_error "章节 ID=$CHAPTER_ID 不存在"
        exit 1
    fi
    
    TITLE=$(echo "$CHAPTER_INFO" | grep -o '"title":"[^"]*"' | sed 's/"title":"//;s/"//')
    
    print_warning "确认删除章节 \"$TITLE\" (ID=$CHAPTER_ID)? (y/N)"
    read -r confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        echo "已取消"
        exit 0
    fi
    
    docker exec novels node -e "
const Database = require('better-sqlite3');
const db = new Database('$CONTAINER_DB_PATH');
db.prepare('DELETE FROM chapters WHERE id = ?').run($CHAPTER_ID);
db.close();
"
    print_success "章节已删除"
}

# ==================== 数据迁移 ====================
migrate() {
    print_header "JSON to SQLite 数据迁移"
    
    if [ ! -f "$HOST_DATA_DIR/novels-data.json" ]; then
        print_error "novels-data.json 不存在: $HOST_DATA_DIR/novels-data.json"
        echo "请确保 JSON 文件存在于指定目录"
        exit 1
    fi
    
    if [ -f "$HOST_DB_PATH" ]; then
        print_warning "数据库已存在"
        read -p "是否覆盖现有数据库? (会清空数据) (y/N): " confirm
        if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
            echo "已取消"
            exit 0
        fi
        BACKUP_PATH="$HOST_DB_PATH.backup.$(date +%Y%m%d_%H%M%S)"
        cp "$HOST_DB_PATH" "$BACKUP_PATH"
        print_warning "已备份到: $BACKUP_PATH"
        rm -f "$HOST_DB_PATH" "$HOST_DB_PATH-wal" "$HOST_DB_PATH-shm"
    fi
    
    mkdir -p "$HOST_DATA_DIR"
    
    print_warning "开始迁移..."
    
    docker exec novels node -e "
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// 容器内路径（宿主机 ./data 映射到 /app/data）
const CONTAINER_DATA_DIR = '/app/data';
const JSON_PATH = path.join(CONTAINER_DATA_DIR, 'novels-data.json');
const DB_PATH = path.join(CONTAINER_DATA_DIR, 'novels.db');

const rawData = fs.readFileSync(JSON_PATH, 'utf-8');
const data = JSON.parse(rawData);
console.log('发现 ' + data.novels.length + ' 本小说, ' + data.chapters.length + ' 个章节');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(\`
CREATE TABLE IF NOT EXISTS libraries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
    password TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS novels (
    id INTEGER PRIMARY KEY AUTOINCREMENT, library_id INTEGER NOT NULL, title TEXT NOT NULL,
    author TEXT DEFAULT '', description TEXT DEFAULT '', cover_url TEXT DEFAULT '',
    category TEXT DEFAULT '', tags TEXT DEFAULT '[]', status TEXT DEFAULT 'ongoing',
    word_count INTEGER DEFAULT 0, rating INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (library_id) REFERENCES libraries(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS volumes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, novel_id INTEGER NOT NULL, title TEXT NOT NULL,
    position INTEGER DEFAULT 0, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS chapters (
    id INTEGER PRIMARY KEY AUTOINCREMENT, novel_id INTEGER NOT NULL, title TEXT NOT NULL,
    content TEXT DEFAULT '', chapter_order INTEGER DEFAULT 0, word_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
);
\`);

const now = new Date().toISOString();
const siteName = data.settings?.siteName || '小说书架';
const sitePassword = data.settings?.password || '';
const libInfo = db.prepare('INSERT INTO libraries (name, password, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(siteName, sitePassword, now, now);
const libraryId = libInfo.lastInsertRowid;
console.log('创建书库: ' + siteName + ' (id: ' + libraryId + ')');

const insertNovel = db.prepare(\`INSERT INTO novels (id, library_id, title, author, description, cover_url, category, tags, status, word_count, rating, created_at, updated_at)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\`);
for (const n of data.novels) {
    insertNovel.run(n.id, libraryId, n.title, n.author || '', n.description || '',
        n.cover_url || '', n.category || '', JSON.stringify(n.tags || []),
        n.status || 'ongoing', n.word_count || 0, n.rating ?? 0, n.created_at || now, n.updated_at || now);
}
console.log('迁移 ' + data.novels.length + ' 本小说');

const insertVolume = db.prepare('INSERT INTO volumes (novel_id, title, position) VALUES (?, ?, ?)');
for (const n of data.novels) {
    if (n.volumes) for (const v of n.volumes) insertVolume.run(n.id, v.title, v.position || 0);
}
let volCount = data.novels.reduce((c, n) => c + (n.volumes?.length || 0), 0);
console.log('迁移 ' + volCount + ' 个分卷');

const insertChapter = db.prepare(\`INSERT INTO chapters (id, novel_id, title, content, chapter_order, word_count, created_at)
 VALUES (?, ?, ?, ?, ?, ?, ?)\`);
for (const c of data.chapters) {
    insertChapter.run(c.id, c.novel_id, c.title, c.content || '', c.chapter_order || 0, c.word_count || 0, c.created_at || now);
}
console.log('迁移 ' + data.chapters.length + ' 个章节');

db.close();
console.log('迁移完成! DB: ' + DB_PATH);
"
    
    print_success "迁移完成!"
}

# ==================== 交互式菜单 ====================
show_interactive_menu() {
    clear
    echo -e "${BLUE}"
    echo "╔══════════════════════════════════════╗"
    echo "║     Novels 数据库管理工具           ║"
    echo "║     Database Management Tool         ║"
    echo "╚══════════════════════════════════════╝"
    echo -e "${NC}"
    echo "数据目录: $HOST_DATA_DIR"
    echo "数据库:   $HOST_DB_PATH"
    echo ""
    echo -e "${YELLOW}请选择操作:${NC}"
    echo ""
    echo "  1. 书库管理 (Library)"
    echo "  2. 书籍管理 (Novel)"
    echo "  3. 章节管理 (Chapter)"
    echo "  4. 数据迁移 (Migration)"
    echo "  5. 查看状态"
    echo ""
    echo -e "${RED}  q. 退出${NC}"
    echo ""
    read -p "请输入选项: " choice
    
    case "$choice" in
        1)
            lib_menu
            ;;
        2)
            novel_menu
            ;;
        3)
            chapter_menu
            ;;
        4)
            migrate
            ;;
        5)
            show_status
            ;;
        q|Q)
            echo "再见!"
            exit 0
            ;;
        *)
            print_error "无效选项"
            ;;
    esac
}

lib_menu() {
    echo ""
    echo -e "${BLUE}=== 书库管理 ===${NC}"
    echo ""
    echo "  1. 列出所有书库"
    echo "  2. 添加书库"
    echo "  3. 删除书库"
    echo "  4. 返回主菜单"
    echo ""
    read -p "请输入选项: " choice
    
    case "$choice" in
        1)
            lib_list
            ;;
        2)
            read -p "书库名称: " name
            read -p "密码 (可选): " password
            lib_add "" "$name" "$password"
            ;;
        3)
            lib_list
            read -p "请输入要删除的书库ID: " id
            lib_delete "" "$id"
            ;;
        4)
            show_interactive_menu
            ;;
        *)
            print_error "无效选项"
            ;;
    esac
    
    echo ""
    read -p "按 Enter 键返回主菜单..."
    show_interactive_menu
}

novel_menu() {
    echo ""
    echo -e "${BLUE}=== 书籍管理 ===${NC}"
    echo ""
    echo "  1. 列出书籍"
    echo "  2. 添加书籍"
    echo "  3. 删除书籍"
    echo "  4. 返回主菜单"
    echo ""
    read -p "请输入选项: " choice
    
    case "$choice" in
        1)
            lib_list
            read -p "请输入书库ID (默认1): " lib_id
            lib_id="${lib_id:-1}"
            novel_list "" "$lib_id"
            ;;
        2)
            lib_list
            read -p "请输入书库ID: " lib_id
            read -p "书籍标题: " title
            read -p "作者 (可选): " author
            novel_add "" "$lib_id" "$title" "$author"
            ;;
        3)
            read -p "请输入要删除的书籍ID: " id
            novel_delete "" "$id"
            ;;
        4)
            show_interactive_menu
            ;;
        *)
            print_error "无效选项"
            ;;
    esac
    
    echo ""
    read -p "按 Enter 键返回主菜单..."
    show_interactive_menu
}

chapter_menu() {
    echo ""
    echo -e "${BLUE}=== 章节管理 ===${NC}"
    echo ""
    echo "  1. 列出章节"
    echo "  2. 添加章节"
    echo "  3. 删除章节"
    echo "  4. 返回主菜单"
    echo ""
    read -p "请输入选项: " choice
    
    case "$choice" in
        1)
            read -p "请输入书籍ID: " novel_id
            chapter_list "" "$novel_id"
            ;;
        2)
            read -p "请输入书籍ID: " novel_id
            read -p "章节标题: " title
            chapter_add "" "$novel_id" "$title"
            ;;
        3)
            read -p "请输入要删除的章节ID: " id
            chapter_delete "" "$id"
            ;;
        4)
            show_interactive_menu
            ;;
        *)
            print_error "无效选项"
            ;;
    esac
    
    echo ""
    read -p "按 Enter 键返回主菜单..."
    show_interactive_menu
}

show_status() {
    echo ""
    print_header "当前状态"
    echo ""
    echo "数据目录: $HOST_DATA_DIR"
    echo "JSON文件: $HOST_DATA_DIR/novels-data.json"
    echo "数据库:   $HOST_DB_PATH"
    echo ""
    
    if [ -f "$HOST_DB_PATH" ]; then
        print_success "数据库已存在"
        
        docker exec novels node -e "
const Database = require('better-sqlite3');
const db = new Database('$CONTAINER_DB_PATH');
const libs = db.prepare('SELECT COUNT(*) as c FROM libraries').get();
const novels = db.prepare('SELECT COUNT(*) as c FROM novels').get();
const chapters = db.prepare('SELECT COUNT(*) as c FROM chapters').get();
console.log('书库数量: ' + libs.c);
console.log('小说数量: ' + novels.c);
console.log('章节数量: ' + chapters.c);
db.close();
" 2>/dev/null
        
        lib_list
    else
        print_warning "数据库不存在，请先运行迁移"
    fi
    
    echo ""
    read -p "按 Enter 键返回..."
    show_interactive_menu
}

# ==================== 帮助信息 ====================
show_help() {
    echo "
Novels 数据库管理工具

用法:
  $0                              # 交互式菜单
  $0 help                         # 显示帮助
  
  # 书库管理
  $0 lib list                     # 列出所有书库
  $0 lib add \"名称\" [密码]        # 添加书库
  $0 lib delete <ID>              # 删除书库
  
  # 书籍管理
  $0 novel list [书库ID]          # 列出书籍
  $0 novel add <书库ID> \"标题\" [作者]  # 添加书籍
  $0 novel delete <书籍ID>        # 删除书籍
  
  # 章节管理
  $0 chapter list <书籍ID>        # 列出章节
  $0 chapter add <书籍ID> \"标题\"  # 添加章节
  $0 chapter delete <章节ID>       # 删除章节
  
  # 数据迁移
  $0 migrate                      # 从 JSON 迁移到 SQLite

示例:
  $0                              # 打开交互式菜单
  $0 lib list                     # 列出所有书库
  $0 lib add \"我的书库\" \"pass123\"  # 创建带密码的书库
  $0 novel list 1                 # 列出书库1的书籍
  $0 novel add 1 \"新书\" \"作者名\"   # 在书库1中添加书籍
  $0 chapter list 1               # 列出书籍1的章节
  $0 chapter add 1 \"第一章\"        # 在书籍1中添加章节
  $0 migrate                      # 执行数据迁移
"
}

# ==================== 主程序 ====================
CMD=$1
SUB_CMD=$2

case "$CMD" in
    lib|library)
        case "$SUB_CMD" in
            list)
                lib_list
                ;;
            add)
                lib_add "$@"
                ;;
            delete|remove)
                lib_delete "$@"
                ;;
            *)
                lib_menu
                ;;
        esac
        ;;
    novel|novels)
        case "$SUB_CMD" in
            list)
                novel_list "$@"
                ;;
            add)
                novel_add "$@"
                ;;
            delete|remove)
                novel_delete "$@"
                ;;
            *)
                novel_menu
                ;;
        esac
        ;;
    chapter|chapters)
        case "$SUB_CMD" in
            list)
                chapter_list "$@"
                ;;
            add)
                chapter_add "$@"
                ;;
            delete|remove)
                chapter_delete "$@"
                ;;
            *)
                chapter_menu
                ;;
        esac
        ;;
    migrate|migration)
        migrate
        ;;
    status|info)
        show_status
        ;;
    help|--help|-h)
        show_help
        ;;
    "")
        show_interactive_menu
        ;;
    *)
        print_error "未知命令: $CMD"
        echo ""
        show_help
        exit 1
        ;;
esac