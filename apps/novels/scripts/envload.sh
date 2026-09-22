#!/bin/bash
# 环境变量加载脚本 - 从 .env 读取配置
# 用法: source scripts/envload.sh

# 获取脚本所在目录（支持被其他脚本 sourced）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env"

# 从 .env 加载环境变量
if [ -f "$ENV_FILE" ]; then
    # 使用 set -a 导出所有变量，或手动读取
    while IFS='=' read -r key value; do
        # 跳过注释和空行
        if [[ ! "$key" =~ ^# ]] && [ -n "$key" ]; then
            # 去除引号
            value=$(echo "$value" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
            value=$(echo "$value" | sed 's/^["'\'']\(.*\)["'\'']$/\1/')
            export "$key=$value"
        fi
    done < "$ENV_FILE"
fi

# 设置默认值
HOST_DATA_DIR="${HOST_DATA_DIR:-./data}"
DATA_DIR="${DATA_DIR:-./data}"

# 转换相对路径为绝对路径（用于宿主机执行）
if [[ "$HOST_DATA_DIR" != /* ]]; then
    # 相对路径 -> 转换为相对于项目根目录的绝对路径
    if [ -d "$PROJECT_DIR/$HOST_DATA_DIR" ]; then
        HOST_DATA_DIR="$(cd "$PROJECT_DIR/$HOST_DATA_DIR" 2>/dev/null && pwd)"
    else
        # 如果目录不存在，也尝试转换
        HOST_DATA_DIR="$(cd "$PROJECT_DIR" && mkdir -p "$HOST_DATA_DIR" && cd "$HOST_DATA_DIR" && pwd)"
    fi
fi

# 导出宿主机路径
export HOST_DATA_DIR
export HOST_DB_PATH="$HOST_DATA_DIR/novels.db"

# 容器内路径（映射到 /app/data）
export CONTAINER_DB_PATH="/app/data/novels.db"