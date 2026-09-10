#!/bin/bash
# 书库管理脚本 - 在生产服务器上直接执行，无需重新构建镜像
# 用法:
#   ./library.sh list                    # 列出所有书库
#   ./library.sh add "书库名称" [密码]   # 添加书库
#   ./library.sh delete <ID>            # 删除书库

set -e

# 从 envload.sh 加载环境变量
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/envload.sh"

CMD=$1

list_libraries() {
    if [ ! -f "$HOST_DB_PATH" ]; then
        echo "错误: 数据库文件不存在: $HOST_DB_PATH"
        echo "请确保 HOST_DATA_DIR 指向正确目录"
        exit 1
    fi
    echo -e "\n=== 书库列表 ===\n"
    docker exec novels node -e "
const Database = require('better-sqlite3');
const db = new Database('$CONTAINER_DB_PATH');
const libs = db.prepare('SELECT id, name, password, created_at FROM libraries ORDER BY id').all();
if (libs.length === 0) {
    console.log('暂无书库');
} else {
    libs.forEach(lib => {
        console.log('ID: ' + lib.id);
        console.log('名称: ' + lib.name);
        console.log('密码: ' + (lib.password ? '已设置' : '无'));
        console.log('创建时间: ' + lib.created_at);
        console.log('---');
    });
}
db.close();
" 2>/dev/null || echo "请确保容器名称为 'novels'"
}

add_library() {
    NAME="$2"
    PASSWORD="${3:-}"
    
    if [ -z "$NAME" ]; then
        echo "用法: $0 add \"书库名称\" [密码]"
        exit 1
    fi
    
    if [ ! -f "$HOST_DB_PATH" ]; then
        echo "错误: 数据库文件不存在: $HOST_DB_PATH"
        exit 1
    fi
    
    echo "正在创建书库..."
    docker exec novels node -e "
const Database = require('better-sqlite3');
const db = new Database('$CONTAINER_DB_PATH');
const now = new Date().toISOString();
const info = db.prepare('INSERT INTO libraries (name, password, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run('$NAME', '$PASSWORD', now, now);
console.log('书库创建成功!');
console.log('ID: ' + info.lastInsertRowid);
console.log('名称: $NAME');
console.log('密码: ' + ('$PASSWORD' ? '已设置' : '无'));
db.close();
"
}

delete_library() {
    ID="$2"
    
    if [ -z "$ID" ]; then
        echo "用法: $0 delete <ID>"
        exit 1
    fi
    
    # 先获取书库信息
    INFO=$(docker exec novels node -e "
const Database = require('better-sqlite3');
const db = new Database('$CONTAINER_DB_PATH');
const lib = db.prepare('SELECT * FROM libraries WHERE id = ?').get($ID);
const count = db.prepare('SELECT COUNT(*) as c FROM libraries').get();
const novels = db.prepare('SELECT COUNT(*) as c FROM novels WHERE library_id = ?').get($ID);
if (lib) {
    console.log(JSON.stringify({lib: lib, total: count.c, novels: novels.c}));
}
db.close();
" 2>/dev/null)
    
    if [ -z "$INFO" ] || [ "$INFO" = "undefined" ]; then
        echo "错误: 书库 ID=$ID 不存在"
        exit 1
    fi
    
    TOTAL=$(echo "$INFO" | grep -o '"total":[0-9]*' | grep -o '[0-9]*')
    NOVELS=$(echo "$INFO" | grep -o '"novels":[0-9]*' | grep -o '[0-9]*')
    NAME=$(echo "$INFO" | grep -o '"name":"[^"]*"' | sed 's/"name":"//;s/"//')
    
    if [ "$TOTAL" -le 1 ]; then
        echo "错误: 不能删除最后一个书库"
        exit 1
    fi
    
    if [ "$NOVELS" -gt 0 ]; then
        echo "错误: 该书库下有 $NOVELS 本小说，请先删除所有小说"
        exit 1
    fi
    
    echo "确认删除书库 \"$NAME\" (ID=$ID)? (y/N)"
    read -r confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        echo "已取消"
        exit 0
    fi
    
    docker exec novels node -e "
const Database = require('better-sqlite3');
const db = new Database('$CONTAINER_DB_PATH');
db.prepare('DELETE FROM libraries WHERE id = ?').run($ID);
console.log('书库已删除');
db.close();
"
}

case "$CMD" in
    list)
        list_libraries
        ;;
    add)
        add_library "$@"
        ;;
    delete)
        delete_library "$@"
        ;;
    *)
        echo "书库管理脚本"
        echo ""
        echo "用法:"
        echo "  $0 list                    列出所有书库"
        echo "  $0 add \"书库名称\" [密码]   添加书库"
        echo "  $0 delete <ID>             删除书库"
        echo ""
        echo "示例:"
        echo "  $0 list"
        echo "  $0 add \"我的第二个书库\""
        echo "  $0 add \"工作笔记\" \"password123\""
        echo "  $0 delete 2"
        ;;
esac