#!/bin/bash
# 章节管理脚本 - 管理书籍下的章节
# 用法:
#   ./chapter.sh list <书籍ID>        # 列出章节
#   ./chapter.sh add <书籍ID> "标题"  # 添加章节
#   ./chapter.sh content <章节ID>      # 查看章节内容
#   ./chapter.sh update <章节ID> "内容" # 更新章节内容
#   ./chapter.sh delete <章节ID>       # 删除章节

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

list_chapters() {
    NOVEL_ID="$2"
    
    if [ -z "$NOVEL_ID" ]; then
        echo "用法: $0 list <书籍ID>"
        exit 1
    fi
    
    echo -e "\n=== 书籍 ID=$NOVEL_ID 的章节 ===\n"
    
    docker exec novels node -e "
const Database = require('better-sqlite3');
const db = new Database('$CONTAINER_DB_PATH');
const chapters = db.prepare('SELECT id, title, chapter_order, word_count, created_at FROM chapters WHERE novel_id = $NOVEL_ID ORDER BY chapter_order, id').all();
if (chapters.length === 0) {
    console.log('暂无章节');
} else {
    console.log('共 ' + chapters.length + ' 章:');
    console.log('');
    chapters.forEach(c => {
        console.log('[' + c.chapter_order + '] ' + c.id + '. ' + c.title + ' (' + (c.word_count || 0) + '字)');
    });
}
db.close();
" 2>/dev/null || echo "请确保容器正在运行"
}

add_chapter() {
    NOVEL_ID="$2"
    TITLE="$3"
    
    if [ -z "$TITLE" ]; then
        echo "用法: $0 add <书籍ID> \"标题\""
        exit 1
    fi
    
    # 获取当前最大 chapter_order
    MAX_ORDER=$(docker exec novels node -e "
const Database = require('better-sqlite3');
const db = new Database('$CONTAINER_DB_PATH');
const result = db.prepare('SELECT MAX(chapter_order) as max_order FROM chapters WHERE novel_id = $NOVEL_ID').get();
console.log(result?.max_order || 0);
db.close();
" 2>/dev/null)
    
    NEW_ORDER=$((MAX_ORDER + 1))
    
    echo "正在创建章节..."
    docker exec novels node -e "
const Database = require('better-sqlite3');
const db = new Database('$CONTAINER_DB_PATH');
const now = new Date().toISOString();
const info = db.prepare(
    'INSERT INTO chapters (novel_id, title, chapter_order, created_at) VALUES (?, ?, ?, ?)'
).run($NOVEL_ID, '$TITLE', $NEW_ORDER, now);
console.log('章节创建成功!');
console.log('ID: ' + info.lastInsertRowid);
console.log('标题: $TITLE');
console.log('排序: ' + $NEW_ORDER);
db.close();
"
}

show_content() {
    CHAPTER_ID="$2"
    
    if [ -z "$CHAPTER_ID" ]; then
        echo "用法: $0 content <章节ID>"
        exit 1
    fi
    
    docker exec novels node -e "
const Database = require('better-sqlite3');
const db = new Database('$CONTAINER_DB_PATH');
const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get($CHAPTER_ID);
if (chapter) {
    console.log('标题: ' + chapter.title);
    console.log('字数: ' + (chapter.word_count || 0));
    console.log('排序: ' + chapter.chapter_order);
    console.log('---');
    console.log(chapter.content || '(无内容)');
} else {
    console.log('章节 ID=$CHAPTER_ID 不存在');
}
db.close();
" 2>/dev/null || echo "请确保容器正在运行"
}

update_content() {
    CHAPTER_ID="$2"
    shift 2
    CONTENT="$*"
    
    if [ -z "$CHAPTER_ID" ] || [ -z "$CONTENT" ]; then
        echo "用法: $0 update <章节ID> <内容>"
        exit 1
    fi
    
    # 计算字数
    WORD_COUNT=$(echo "$CONTENT" | wc -c 2>/dev/null || echo "0")
    
    docker exec novels node -e "
const Database = require('better-sqlite3');
const db = new Database('$CONTAINER_DB_PATH');
const now = new Date().toISOString();
db.prepare('UPDATE chapters SET content = ?, word_count = ?, updated_at = ? WHERE id = ?')
    .run('$CONTENT', $WORD_COUNT, now, $CHAPTER_ID);
console.log('章节内容已更新');
db.close();
"
}

delete_chapter() {
    CHAPTER_ID="$2"
    
    if [ -z "$CHAPTER_ID" ]; then
        echo "用法: $0 delete <章节ID>"
        exit 1
    fi
    
    # 获取章节信息
    CHAPTER_INFO=$(docker exec novels node -e "
const Database = require('better-sqlite3');
const db = new Database('$CONTAINER_DB_PATH');
const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get($CHAPTER_ID);
if (chapter) console.log(JSON.stringify(chapter));
db.close();
" 2>/dev/null)
    
    if [ -z "$CHAPTER_INFO" ]; then
        echo "错误: 章节 ID=$CHAPTER_ID 不存在"
        exit 1
    fi
    
    TITLE=$(echo "$CHAPTER_INFO" | grep -o '"title":"[^"]*"' | sed 's/"title":"//;s/"//')
    
    echo "确认删除章节 \"$TITLE\" (ID=$CHAPTER_ID)? (y/N)"
    read -r confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        echo "已取消"
        exit 0
    fi
    
    docker exec novels node -e "
const Database = require('better-sqlite3');
const db = new Database('$CONTAINER_DB_PATH');
db.prepare('DELETE FROM chapters WHERE id = ?').run($CHAPTER_ID);
console.log('章节已删除');
db.close();
"
}

show_help() {
    echo "章节管理脚本"
    echo ""
    echo "用法:"
    echo "  $0 list <书籍ID>             列出章节"
    echo "  $0 add <书籍ID> \"标题\"       添加章节"
    echo "  $0 content <章节ID>           查看章节内容"
    echo "  $0 update <章节ID> <内容>     更新章节内容"
    echo "  $0 delete <章节ID>            删除章节"
    echo ""
    echo "示例:"
    echo "  $0 list 1"
    echo "  $0 add 1 \"第一章 初入江湖\""
    echo "  $0 content 1"
    echo "  $0 delete 3"
}

case "$CMD" in
    list)
        list_chapters "$@"
        ;;
    add)
        add_chapter "$@"
        ;;
    content)
        show_content "$@"
        ;;
    update)
        update_content "$@"
        ;;
    delete)
        delete_chapter "$@"
        ;;
    *)
        show_help
        ;;
esac