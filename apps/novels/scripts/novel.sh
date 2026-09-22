#!/bin/bash
# 书籍管理脚本 - 在指定书库下管理书籍
# 用法:
#   ./novel.sh list [书库ID]           # 列出书籍
#   ./novel.sh add <书库ID> "标题"    # 添加书籍
#   ./novel.sh delete <书籍ID>         # 删除书籍

set -e

# 加载环境变量
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/envload.sh"

CMD=$1

# 检查数据库
if [ ! -f "$HOST_DB_PATH" ]; then
    echo "错误: 数据库文件不存在: $HOST_DB_PATH"
    exit 1
fi

list_novels() {
    LIB_ID="${2:-1}"
    
    # 获取书库信息
    LIB_INFO=$(docker exec novels node -e "
const Database = require('better-sqlite3');
const db = new Database('$CONTAINER_DB_PATH');
const lib = db.prepare('SELECT * FROM libraries WHERE id = ?').get($LIB_ID);
if (lib) console.log(JSON.stringify(lib));
db.close();
" 2>/dev/null)
    
    if [ -z "$LIB_INFO" ]; then
        echo "错误: 书库 ID=$LIB_ID 不存在"
        exit 1
    fi
    
    LIB_NAME=$(echo "$LIB_INFO" | grep -o '"name":"[^"]*"' | sed 's/"name":"//;s/"//')
    echo -e "\n=== $LIB_NAME 下的书籍 ===\n"
    
    docker exec novels node -e "
const Database = require('better-sqlite3');
const db = new Database('$CONTAINER_DB_PATH');
const novels = db.prepare('SELECT * FROM novels WHERE library_id = $LIB_ID ORDER BY id').all();
if (novels.length === 0) {
    console.log('暂无书籍');
} else {
    novels.forEach(n => {
        console.log('ID: ' + n.id);
        console.log('标题: ' + n.title);
        console.log('作者: ' + (n.author || '-'));
        console.log('状态: ' + n.status);
        console.log('字数: ' + (n.word_count || 0));
        console.log('标签: ' + n.tags);
        console.log('---');
    });
}
db.close();
" 2>/dev/null || echo "请确保容器正在运行"
}

add_novel() {
    LIB_ID="$2"
    TITLE="$3"
    
    if [ -z "$TITLE" ]; then
        echo "用法: $0 add <书库ID> \"标题\" [作者]"
        exit 1
    fi
    
    AUTHOR="${4:-}"
    
    # 检查书库是否存在
    LIB_INFO=$(docker exec novels node -e "
const Database = require('better-sqlite3');
const db = new Database('$CONTAINER_DB_PATH');
const lib = db.prepare('SELECT * FROM libraries WHERE id = ?').get($LIB_ID);
if (lib) console.log(JSON.stringify(lib));
db.close();
" 2>/dev/null)
    
    if [ -z "$LIB_INFO" ]; then
        echo "错误: 书库 ID=$LIB_ID 不存在"
        exit 1
    fi
    
    echo "正在创建书籍..."
    docker exec novels node -e "
const Database = require('better-sqlite3');
const db = new Database('$CONTAINER_DB_PATH');
const now = new Date().toISOString();
const info = db.prepare(
    'INSERT INTO novels (library_id, title, author, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
).run($LIB_ID, '$TITLE', '$AUTHOR', now, now);
console.log('书籍创建成功!');
console.log('ID: ' + info.lastInsertRowid);
console.log('标题: $TITLE');
console.log('作者: $AUTHOR');
db.close();
"
}

delete_novel() {
    NOVEL_ID="$2"
    
    if [ -z "$NOVEL_ID" ]; then
        echo "用法: $0 delete <书籍ID>"
        exit 1
    fi
    
    # 获取书籍信息
    NOVEL_INFO=$(docker exec novels node -e "
const Database = require('better-sqlite3');
const db = new Database('$CONTAINER_DB_PATH');
const novel = db.prepare('SELECT * FROM novels WHERE id = ?').get($NOVEL_ID);
const chapters = db.prepare('SELECT COUNT(*) as c FROM chapters WHERE novel_id = ?').get($NOVEL_ID);
if (novel) console.log(JSON.stringify({novel: novel, chapters: chapters.c}));
db.close();
" 2>/dev/null)
    
    if [ -z "$NOVEL_INFO" ]; then
        echo "错误: 书籍 ID=$NOVEL_ID 不存在"
        exit 1
    fi
    
    CHAPTERS=$(echo "$NOVEL_INFO" | grep -o '"chapters":[0-9]*' | grep -o '[0-9]*')
    TITLE=$(echo "$NOVEL_INFO" | grep -o '"title":"[^"]*"' | sed 's/"title":"//;s/"//')
    
    if [ "$CHAPTERS" -gt 0 ]; then
        echo "错误: 该书籍下有 $CHAPTERS 个章节，请先删除所有章节"
        exit 1
    fi
    
    echo "确认删除书籍 \"$TITLE\" (ID=$NOVEL_ID)? (y/N)"
    read -r confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        echo "已取消"
        exit 0
    fi
    
    docker exec novels node -e "
const Database = require('better-sqlite3');
const db = new Database('$CONTAINER_DB_PATH');
db.prepare('DELETE FROM novels WHERE id = ?').run($NOVEL_ID);
console.log('书籍已删除');
db.close();
"
}

show_help() {
    echo "书籍管理脚本"
    echo ""
    echo "用法:"
    echo "  $0 list [书库ID]            列出书籍（默认书库ID=1）"
    echo "  $0 add <书库ID> \"标题\" [作者]  添加书籍"
    echo "  $0 delete <书籍ID>           删除书籍"
    echo ""
    echo "示例:"
    echo "  $0 list"
    echo "  $0 list 2"
    echo "  $0 add 1 \"我的小说\""
    echo "  $0 add 1 \"我的小说\" \"作者名\""
    echo "  $0 delete 3"
}

case "$CMD" in
    list)
        list_novels "$@"
        ;;
    add)
        add_novel "$@"
        ;;
    delete)
        delete_novel "$@"
        ;;
    *)
        show_help
        ;;
esac