#!/bin/bash
# ── 小说站点运维脚本 ──
# 多级分组引导，覆盖分支管理、部署、监控、数据运维等场景
set -e

# ── 颜色定义 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ── 配置 ──
PROJECT_NAME="novels"
COMPOSE_FILE="docker-compose.yml"
DEFAULT_BRANCH="main"
REMOTE="origin"

# ── 工具函数 ──
print_banner() {
    clear
    echo -e "${BOLD}${CYAN}"
    echo "╔══════════════════════════════════════╗"
    echo "║       小说站点 · 运维管理面板         ║"
    echo "╚══════════════════════════════════════╝"
    echo -e "${NC}"
}

print_section() {
    echo -e "\n${BOLD}${BLUE}── $1 ──${NC}\n"
}

print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_error()   { echo -e "${RED}✗ $1${NC}"; }
print_warn()    { echo -e "${YELLOW}⚠ $1${NC}"; }
print_info()    { echo -e "${CYAN}→ $1${NC}"; }

confirm() {
    local msg="${1:-确认执行？}"
    echo -en "${YELLOW}${msg} [y/N]: ${NC}"
    read -r choice
    [[ "$choice" =~ ^[Yy]$ ]]
}

wait_enter() {
    echo -en "\n${CYAN}按回车继续...${NC}"
    read -r
}

get_current_branch() {
    git rev-parse --abbrev-ref HEAD 2>/dev/null
}

get_compose_cmd() {
    if command -v docker &>/dev/null && docker compose version &>/dev/null 2>&1; then
        echo "docker compose"
    elif command -v docker-compose &>/dev/null; then
        echo "docker-compose"
    else
        echo ""
    fi
}

# ══════════════════════════════════════════════
# 一键快捷指令
# ══════════════════════════════════════════════

quick_update_deploy() {
    print_section "⚡ 一键更新部署"
    local compose_cmd=$(get_compose_cmd)
    if [ -z "$compose_cmd" ]; then
        print_error "未找到 docker compose 命令"
        wait_enter
        return
    fi

    echo -e "  将执行以下步骤："
    echo -e "  1. 拉取最新代码"
    echo -e "  2. 构建 Docker 镜像"
    echo -e "  3. 重启服务"
    echo ""
    if ! confirm "确认执行一键更新部署？"; then
        return
    fi

    echo ""
    print_info "步骤 1/3: 拉取最新代码..."
    git pull "$REMOTE" "$(get_current_branch)" || { print_error "拉取失败"; wait_enter; return; }

    print_info "步骤 2/3: 构建镜像..."
    $compose_cmd build || { print_error "构建失败"; wait_enter; return; }

    print_info "步骤 3/3: 重启服务..."
    $compose_cmd up -d || { print_error "重启失败"; wait_enter; return; }

    echo ""
    print_success "一键更新部署完成！"
    echo -e "  服务地址: http://localhost:3000"
    wait_enter
}

quick_restart_all() {
    print_section "🔄 一键重启全部服务"
    local compose_cmd=$(get_compose_cmd)
    if [ -z "$compose_cmd" ]; then
        print_error "未找到 docker compose 命令"
        wait_enter
        return
    fi

    if ! confirm "确认重启全部服务？"; then
        return
    fi

    print_info "正在重启..."
    $compose_cmd restart && print_success "全部服务已重启" || print_error "重启失败"
    wait_enter
}

quick_stop_all() {
    print_section "🛑 一键停止全部服务"
    local compose_cmd=$(get_compose_cmd)
    if [ -z "$compose_cmd" ]; then
        print_error "未找到 docker compose 命令"
        wait_enter
        return
    fi

    if ! confirm "确认停止全部服务？"; then
        return
    fi

    print_info "正在停止..."
    $compose_cmd down && print_success "全部服务已停止" || print_error "停止失败"
    wait_enter
}

quick_backup() {
    print_section "📦 一键备份数据库"
    local data_dir="${HOST_DATA_DIR:-./data}"
    local db_file="${data_dir}/novels.db"
    local backup_dir="backups"
    mkdir -p "$backup_dir"

    if [ ! -f "$db_file" ]; then
        print_error "数据库文件不存在: ${db_file}"
        wait_enter
        return
    fi

    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_file="${backup_dir}/novels_${timestamp}.db"

    print_info "正在备份..."
    cp "$db_file" "$backup_file"
    [ -f "${db_file}-wal" ] && cp "${db_file}-wal" "${backup_file}-wal"
    [ -f "${db_file}-shm" ] && cp "${db_file}-shm" "${backup_file}-shm"

    print_success "备份完成: ${backup_file} ($(du -h "$backup_file" | cut -f1))"
    wait_enter
}

# ══════════════════════════════════════════════
# 一级菜单：运维分类
# ══════════════════════════════════════════════
main_menu() {
    while true; do
        print_banner
        echo -e "  ${BOLD}当前分支:${NC} $(get_current_branch)"
        echo -e "  ${BOLD}项目目录:${NC} $(pwd)"
        echo ""
        echo -e "  ${BOLD}${YELLOW}── 一键快捷指令 ──${NC}"
        echo -e "  ${BOLD}Q)${NC} ⚡ 一键拉取+构建+重启（更新部署）"
        echo -e "  ${BOLD}W)${NC} 🔄 一键重启全部服务"
        echo -e "  ${BOLD}E)${NC} 🛑 一键停止全部服务"
        echo -e "  ${BOLD}R)${NC} 📦 一键备份数据库"
        echo ""
        echo -e "  ${BOLD}── 详细操作 ──${NC}"
        echo -e "  ${BOLD}1)${NC} 🔀 分支管理"
        echo -e "  ${BOLD}2)${NC} 🚀 服务部署"
        echo -e "  ${BOLD}3)${NC} 📊 服务监控"
        echo -e "  ${BOLD}4)${NC} 💾 数据运维"
        echo -e "  ${BOLD}5)${NC} 🔧 开发工具"
        echo -e "  ${BOLD}0)${NC} 退出"
        echo ""
        echo -en "  请选择: "
        read -r choice
        case $choice in
            Q|q) quick_update_deploy ;;
            W|w) quick_restart_all ;;
            E|e) quick_stop_all ;;
            R|r) quick_backup ;;
            1) menu_branch ;;
            2) menu_deploy ;;
            3) menu_monitor ;;
            4) menu_data ;;
            5) menu_devtools ;;
            0) echo -e "\n${GREEN}再见！${NC}"; exit 0 ;;
            *) print_error "无效选项" ; sleep 1 ;;
        esac
    done
}

# ══════════════════════════════════════════════
# 二级菜单 1：分支管理
# ══════════════════════════════════════════════
menu_branch() {
    while true; do
        print_banner
        echo -e "  ${BOLD}🔀 分支管理${NC}"
        echo -e "  当前分支: ${GREEN}$(get_current_branch)${NC}"
        echo ""
        echo -e "  ${BOLD}1)${NC} 查看所有分支"
        echo -e "  ${BOLD}2)${NC} 切换分支"
        echo -e "  ${BOLD}3)${NC} 创建新分支"
        echo -e "  ${BOLD}4)${NC} 合并分支"
        echo -e "  ${BOLD}5)${NC} 拉取远程更新"
        echo -e "  ${BOLD}6)${NC} 删除分支"
        echo -e "  ${BOLD}7)${NC} 查看分支差异"
        echo -e "  ${BOLD}0)${NC} 返回上级"
        echo ""
        echo -en "  请选择: "
        read -r choice
        case $choice in
            1) branch_list ;;
            2) branch_switch ;;
            3) branch_create ;;
            4) branch_merge ;;
            5) branch_pull ;;
            6) branch_delete ;;
            7) branch_diff ;;
            0) return ;;
            *) print_error "无效选项" ; sleep 1 ;;
        esac
    done
}

branch_list() {
    print_section "所有分支"
    echo -e "${BOLD}本地分支:${NC}"
    git branch -v --format="  %(refname:short) %(objectname:short) %(contents:lines=1)"
    echo ""
    echo -e "${BOLD}远程分支:${NC}"
    git branch -r --format="  %(refname:short) %(objectname:short) %(contents:lines=1)" 2>/dev/null || echo "  无法获取远程分支"
    wait_enter
}

branch_switch() {
    print_section "切换分支"
    echo -e "当前分支: ${GREEN}$(get_current_branch)${NC}\n"
    echo -e "可用分支:"
    git branch --format="  %(refname:short)" | nl
    echo ""
    echo -en "输入分支名: "
    read -r branch_name
    if [ -z "$branch_name" ]; then
        print_error "分支名不能为空"
        sleep 1
        return
    fi
    print_info "正在切换到 ${branch_name}..."
    if git checkout "$branch_name" 2>/dev/null; then
        print_success "已切换到 ${branch_name}"
    else
        print_error "切换失败"
    fi
    wait_enter
}

branch_create() {
    print_section "创建新分支"
    echo -e "基于当前分支: ${GREEN}$(get_current_branch)${NC}\n"
    echo -en "新分支名: "
    read -r branch_name
    if [ -z "$branch_name" ]; then
        print_error "分支名不能为空"
        sleep 1
        return
    fi
    echo -en "是否推送到远程？ [y/N]: "
    read -r push_remote
    if git checkout -b "$branch_name"; then
        print_success "已创建分支 ${branch_name}"
        if [[ "$push_remote" =~ ^[Yy]$ ]]; then
            git push -u "$REMOTE" "$branch_name" && print_success "已推送到远程" || print_error "推送失败"
        fi
    else
        print_error "创建失败"
    fi
    wait_enter
}

branch_merge() {
    print_section "合并分支"
    echo -e "当前分支: ${GREEN}$(get_current_branch)${NC}\n"
    echo -e "可用分支:"
    git branch --format="  %(refname:short)" | nl
    echo ""
    echo -en "要合并到当前分支的分支名: "
    read -r source_branch
    if [ -z "$source_branch" ]; then
        print_error "分支名不能为空"
        sleep 1
        return
    fi
    if ! confirm "确认将 ${source_branch} 合并到 $(get_current_branch)？"; then
        return
    fi
    if git merge "$source_branch" --no-edit; then
        print_success "合并成功"
    else
        print_error "合并冲突，请手动解决"
    fi
    wait_enter
}

branch_pull() {
    print_section "拉取远程更新"
    local branch=$(get_current_branch)
    print_info "正在从 ${REMOTE}/${branch} 拉取..."
    if git pull "$REMOTE" "$branch"; then
        print_success "拉取成功"
    else
        print_error "拉取失败，可能有冲突"
    fi
    wait_enter
}

branch_delete() {
    print_section "删除分支"
    echo -e "可用分支:"
    git branch --format="  %(refname:short)" | grep -v "^\*"
    echo ""
    echo -en "要删除的分支名: "
    read -r branch_name
    if [ -z "$branch_name" ]; then
        return
    fi
    if [ "$branch_name" = "$(get_current_branch)" ]; then
        print_error "不能删除当前分支"
        sleep 1
        return
    fi
    if ! confirm "确认删除分支 ${branch_name}？"; then
        return
    fi
    git branch -d "$branch_name" && print_success "已删除本地分支" || print_error "删除失败"
    echo -en "是否同时删除远程分支？ [y/N]: "
    read -r del_remote
    if [[ "$del_remote" =~ ^[Yy]$ ]]; then
        git push "$REMOTE" --delete "$branch_name" && print_success "已删除远程分支" || print_error "删除远程分支失败"
    fi
    wait_enter
}

branch_diff() {
    print_section "分支差异"
    echo -e "可用分支:"
    git branch --format="  %(refname:short)" | nl
    echo ""
    echo -en "对比基准分支 (默认 ${DEFAULT_BRANCH}): "
    read -r base
    base="${base:-$DEFAULT_BRANCH}"
    echo ""
    git log --oneline --graph --all --decorate -20
    echo ""
    echo -e "${BOLD}与 ${base} 的差异:${NC}"
    git log --oneline "${base}..$(get_current_branch)" 2>/dev/null || print_warn "无法对比"
    wait_enter
}

# ══════════════════════════════════════════════
# 二级菜单 2：服务部署
# ══════════════════════════════════════════════
menu_deploy() {
    while true; do
        print_banner
        echo -e "  ${BOLD}🚀 服务部署${NC}"
        echo ""
        echo -e "  ${BOLD}1)${NC} 构建镜像"
        echo -e "  ${BOLD}2)${NC} 启动服务"
        echo -e "  ${BOLD}3)${NC} 重启服务"
        echo -e "  ${BOLD}4)${NC} 停止服务"
        echo -e "  ${BOLD}5)${NC} 一键部署（构建+重启）"
        echo -e "  ${BOLD}6)${NC} 查看部署日志"
        echo -e "  ${BOLD}7)${NC} 滚动更新（零停机）"
        echo -e "  ${BOLD}0)${NC} 返回上级"
        echo ""
        echo -en "  请选择: "
        read -r choice
        case $choice in
            1) deploy_build ;;
            2) deploy_start ;;
            3) deploy_restart ;;
            4) deploy_stop ;;
            5) deploy_full ;;
            6) deploy_logs ;;
            7) deploy_rolling ;;
            0) return ;;
            *) print_error "无效选项" ; sleep 1 ;;
        esac
    done
}

deploy_build() {
    print_section "构建镜像"
    local compose_cmd=$(get_compose_cmd)
    if [ -z "$compose_cmd" ]; then
        print_error "未找到 docker compose 命令"
        wait_enter
        return
    fi
    print_info "正在构建..."
    $compose_cmd build && print_success "构建完成" || print_error "构建失败"
    wait_enter
}

deploy_start() {
    print_section "启动服务"
    local compose_cmd=$(get_compose_cmd)
    if [ -z "$compose_cmd" ]; then
        print_error "未找到 docker compose 命令"
        wait_enter
        return
    fi
    $compose_cmd up -d && print_success "服务已启动" || print_error "启动失败"
    wait_enter
}

deploy_restart() {
    print_section "重启服务"
    local compose_cmd=$(get_compose_cmd)
    if [ -z "$compose_cmd" ]; then
        print_error "未找到 docker compose 命令"
        wait_enter
        return
    fi
    if ! confirm "确认重启服务？"; then
        return
    fi
    $compose_cmd restart && print_success "服务已重启" || print_error "重启失败"
    wait_enter
}

deploy_stop() {
    print_section "停止服务"
    local compose_cmd=$(get_compose_cmd)
    if [ -z "$compose_cmd" ]; then
        print_error "未找到 docker compose 命令"
        wait_enter
        return
    fi
    if ! confirm "确认停止服务？"; then
        return
    fi
    $compose_cmd down && print_success "服务已停止" || print_error "停止失败"
    wait_enter
}

deploy_full() {
    print_section "一键部署"
    local compose_cmd=$(get_compose_cmd)
    if [ -z "$compose_cmd" ]; then
        print_error "未找到 docker compose 命令"
        wait_enter
        return
    fi
    if ! confirm "确认执行一键部署（构建+重启）？"; then
        return
    fi
    print_info "步骤 1/2: 构建镜像..."
    $compose_cmd build && print_success "构建完成" || { print_error "构建失败"; wait_enter; return; }
    print_info "步骤 2/2: 重启服务..."
    $compose_cmd up -d && print_success "部署完成" || print_error "部署失败"
    wait_enter
}

deploy_logs() {
    print_section "部署日志"
    local compose_cmd=$(get_compose_cmd)
    if [ -z "$compose_cmd" ]; then
        print_error "未找到 docker compose 命令"
        wait_enter
        return
    fi
    echo -e "  ${BOLD}1)${NC} 查看最近 50 行日志"
    echo -e "  ${BOLD}2)${NC} 实时跟踪日志"
    echo -e "  ${BOLD}3)${NC} 查看错误日志"
    echo -en "  选择: "
    read -r log_choice
    case $log_choice in
        1) $compose_cmd logs --tail=50 ;;
        2) $compose_cmd logs -f ;;
        3) $compose_cmd logs --grep="error\|Error\|ERROR" --tail=100 ;;
        *) return ;;
    esac
    wait_enter
}

deploy_rolling() {
    print_section "滚动更新（零停机）"
    local compose_cmd=$(get_compose_cmd)
    if [ -z "$compose_cmd" ]; then
        print_error "未找到 docker compose 命令"
        wait_enter
        return
    fi
    if ! confirm "确认执行滚动更新？"; then
        return
    fi
    print_info "拉取最新代码..."
    git pull "$REMOTE" "$(get_current_branch)"
    print_info "重新构建并滚动更新..."
    $compose_cmd up -d --build --remove-orphans && print_success "滚动更新完成" || print_error "更新失败"
    wait_enter
}

# ══════════════════════════════════════════════
# 二级菜单 3：服务监控
# ══════════════════════════════════════════════
menu_monitor() {
    while true; do
        print_banner
        echo -e "  ${BOLD}📊 服务监控${NC}"
        echo ""
        echo -e "  ${BOLD}1)${NC} 查看服务状态"
        echo -e "  ${BOLD}2)${NC} 查看容器资源占用"
        echo -e "  ${BOLD}3)${NC} 健康检查"
        echo -e "  ${BOLD}4)${NC} 查看端口占用"
        echo -e "  ${BOLD}5)${NC} 查看数据库大小"
        echo -e "  ${BOLD}0)${NC} 返回上级"
        echo ""
        echo -en "  请选择: "
        read -r choice
        case $choice in
            1) monitor_status ;;
            2) monitor_stats ;;
            3) monitor_health ;;
            4) monitor_ports ;;
            5) monitor_db ;;
            0) return ;;
            *) print_error "无效选项" ; sleep 1 ;;
        esac
    done
}

monitor_status() {
    print_section "服务状态"
    docker ps -a --filter "name=${PROJECT_NAME}" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.CreatedAt}}"
    wait_enter
}

monitor_stats() {
    print_section "容器资源占用"
    docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}" $(docker ps -q --filter "name=${PROJECT_NAME}") 2>/dev/null || print_warn "没有运行中的容器"
    wait_enter
}

monitor_health() {
    print_section "健康检查"
    local port=3000
    echo -e "  检查 http://localhost:${port} ..."
    local code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${port}" 2>/dev/null)
    if [ "$code" = "200" ]; then
        print_success "服务正常 (HTTP ${code})"
    else
        print_error "服务异常 (HTTP ${code})"
    fi
    echo ""
    echo -e "  检查 API 接口..."
    local api_code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${port}/api/libraries" 2>/dev/null)
    if [ "$api_code" = "200" ] || [ "$api_code" = "401" ]; then
        print_success "API 正常 (HTTP ${api_code})"
    else
        print_error "API 异常 (HTTP ${api_code})"
    fi
    wait_enter
}

monitor_ports() {
    print_section "端口占用"
    local compose_cmd=$(get_compose_cmd)
    if [ -n "$compose_cmd" ]; then
        local port=$($compose_cmd config 2>/dev/null | grep -A1 "ports:" | tail -1 | tr -d ' "-')
        echo -e "  Docker 映射端口: ${port:-3000}"
    fi
    echo ""
    echo -e "${BOLD}宿主机 3000 端口占用:${NC}"
    lsof -i :3000 2>/dev/null || echo "  未被占用"
    wait_enter
}

monitor_db() {
    print_section "数据库大小"
    local data_dir="${HOST_DATA_DIR:-./data}"
    local db_file="${data_dir}/novels.db"
    if [ -f "$db_file" ]; then
        local size=$(du -h "$db_file" | cut -f1)
        print_info "数据库文件: ${db_file}"
        print_info "文件大小: ${size}"
        echo ""
        echo -e "${BOLD}WAL 模式状态:${NC}"
        local wal="${db_file}-wal"
        if [ -f "$wal" ]; then
            echo -e "  WAL 文件: $(du -h "$wal" | cut -f1)"
        else
            echo -e "  WAL 文件: 无"
        fi
    else
        print_warn "未找到数据库文件: ${db_file}"
    fi
    wait_enter
}

# ══════════════════════════════════════════════
# 二级菜单 4：数据运维
# ══════════════════════════════════════════════
menu_data() {
    while true; do
        print_banner
        echo -e "  ${BOLD}💾 数据运维${NC}"
        echo ""
        echo -e "  ${BOLD}1)${NC} 备份数据库"
        echo -e "  ${BOLD}2)${NC} 恢复数据库"
        echo -e "  ${BOLD}3)${NC} 数据库压缩"
        echo -e "  ${BOLD}4)${NC} 查看数据库信息"
        echo -e "  ${BOLD}5)${NC} 导入小说数据（JSON）"
        echo -e "  ${BOLD}0)${NC} 返回上级"
        echo ""
        echo -en "  请选择: "
        read -r choice
        case $choice in
            1) data_backup ;;
            2) data_restore ;;
            3) data_vacuum ;;
            4) data_info ;;
            5) data_import ;;
            0) return ;;
            *) print_error "无效选项" ; sleep 1 ;;
        esac
    done
}

data_backup() {
    print_section "备份数据库"
    local data_dir="${HOST_DATA_DIR:-./data}"
    local db_file="${data_dir}/novels.db"
    local backup_dir="backups"
    mkdir -p "$backup_dir"

    if [ ! -f "$db_file" ]; then
        print_error "数据库文件不存在: ${db_file}"
        wait_enter
        return
    fi

    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_file="${backup_dir}/novels_${timestamp}.db"

    print_info "正在备份..."
    cp "$db_file" "$backup_file"

    # 同时备份 WAL
    if [ -f "${db_file}-wal" ]; then
        cp "${db_file}-wal" "${backup_file}-wal"
    fi
    if [ -f "${db_file}-shm" ]; then
        cp "${db_file}-shm" "${backup_file}-shm"
    fi

    print_success "备份完成: ${backup_file} ($(du -h "$backup_file" | cut -f1))"
    wait_enter
}

data_restore() {
    print_section "恢复数据库"
    local data_dir="${HOST_DATA_DIR:-./data}"
    local db_file="${data_dir}/novels.db"
    local backup_dir="backups"

    if [ ! -d "$backup_dir" ] || [ -z "$(ls -A $backup_dir/*.db 2>/dev/null)" ]; then
        print_error "没有找到备份文件"
        wait_enter
        return
    fi

    echo -e "${BOLD}可用备份:${NC}"
    ls -lt "$backup_dir"/*.db 2>/dev/null | awk '{print NR". "$NF" ("$5")"}'
    echo ""
    echo -en "输入备份文件序号: "
    read -r num
    local backup_file=$(ls -t "$backup_dir"/*.db 2>/dev/null | sed -n "${num}p")

    if [ -z "$backup_file" ] || [ ! -f "$backup_file" ]; then
        print_error "无效的备份文件"
        wait_enter
        return
    fi

    if ! confirm "确认恢复 ${backup_file}？当前数据将被覆盖！"; then
        return
    fi

    # 先停止服务
    local compose_cmd=$(get_compose_cmd)
    [ -n "$compose_cmd" ] && $compose_cmd stop 2>/dev/null

    cp "$backup_file" "$db_file"
    [ -f "${backup_file}-wal" ] && cp "${backup_file}-wal" "${db_file}-wal"
    [ -f "${backup_file}-shm" ] && cp "${backup_file}-shm" "${db_file}-shm"

    print_success "数据库已恢复"

    if [ -n "$compose_cmd" ]; then
        echo -en "是否重新启动服务？ [Y/n]: "
        read -r restart
        if [[ ! "$restart" =~ ^[Nn]$ ]]; then
            $compose_cmd start && print_success "服务已启动"
        fi
    fi
    wait_enter
}

data_vacuum() {
    print_section "数据库压缩"
    local data_dir="${HOST_DATA_DIR:-./data}"
    local db_file="${data_dir}/novels.db"

    if [ ! -f "$db_file" ]; then
        print_error "数据库文件不存在"
        wait_enter
        return
    fi

    local size_before=$(du -h "$db_file" | cut -f1)
    print_info "压缩前大小: ${size_before}"
    print_info "正在执行 VACUUM..."

    # 通过 sqlite3 命令压缩（如果可用）
    if command -v sqlite3 &>/dev/null; then
        sqlite3 "$db_file" "VACUUM;"
        local size_after=$(du -h "$db_file" | cut -f1)
        print_success "压缩完成: ${size_before} → ${size_after}"
    else
        print_warn "sqlite3 命令不可用，尝试使用 Docker 执行..."
        local compose_cmd=$(get_compose_cmd)
        if [ -n "$compose_cmd" ]; then
            $compose_cmd exec novels sqlite3 /app/data/novels.db "VACUUM;" 2>/dev/null && print_success "压缩完成" || print_error "压缩失败"
        else
            print_error "无法执行压缩，请安装 sqlite3"
        fi
    fi
    wait_enter
}

data_info() {
    print_section "数据库信息"
    local data_dir="${HOST_DATA_DIR:-./data}"
    local db_file="${data_dir}/novels.db"

    if [ ! -f "$db_file" ]; then
        print_error "数据库文件不存在"
        wait_enter
        return
    fi

    echo -e "  数据库路径: ${db_file}"
    echo -e "  文件大小: $(du -h "$db_file" | cut -f1)"
    echo -e "  最后修改: $(stat -f "%Sm" "$db_file" 2>/dev/null || stat -c "%y" "$db_file" 2>/dev/null)"
    echo ""

    if command -v sqlite3 &>/dev/null; then
        echo -e "${BOLD}数据统计:${NC}"
        echo -e "  书库数量: $(sqlite3 "$db_file" "SELECT COUNT(*) FROM libraries;")"
        echo -e "  小说数量: $(sqlite3 "$db_file" "SELECT COUNT(*) FROM novels;")"
        echo -e "  分卷数量: $(sqlite3 "$db_file" "SELECT COUNT(*) FROM volumes;")"
        echo -e "  章节数量: $(sqlite3 "$db_file" "SELECT COUNT(*) FROM chapters;")"
        echo ""
        echo -e "${BOLD}总字数:${NC} $(sqlite3 "$db_file" "SELECT COALESCE(SUM(word_count), 0) FROM chapters;" | xargs -I {} echo "{}" | sed ':a;s/\B[0-9]\{3\}\>/.&/;ta')"
    fi
    wait_enter
}

data_import() {
    print_section "导入小说数据"
    echo -e "  请通过 Web 界面 /settings 页面导入 JSON 备份文件"
    echo -e "  或使用以下命令通过 API 导入："
    echo ""
    echo -e "  ${CYAN}curl -X POST -F 'file=@backup.json' http://localhost:3000/api/backup/import${NC}"
    echo ""
    wait_enter
}

# ══════════════════════════════════════════════
# 二级菜单 5：开发工具
# ══════════════════════════════════════════════
menu_devtools() {
    while true; do
        print_banner
        echo -e "  ${BOLD}🔧 开发工具${NC}"
        echo ""
        echo -e "  ${BOLD}1)${NC} 启动开发服务器"
        echo -e "  ${BOLD}2)${NC} 代码检查 (lint)"
        echo -e "  ${BOLD}3)${NC} 构建项目"
        echo -e "  ${BOLD}4)${NC} 清理构建产物"
        echo -e "  ${BOLD}5)${NC} 查看 Git 提交历史"
        echo -e "  ${BOLD}6)${NC} 快速提交"
        echo -e "  ${BOLD}0)${NC} 返回上级"
        echo ""
        echo -en "  请选择: "
        read -r choice
        case $choice in
            1) dev_server ;;
            2) dev_lint ;;
            3) dev_build ;;
            4) dev_clean ;;
            5) dev_log ;;
            6) dev_commit ;;
            0) return ;;
            *) print_error "无效选项" ; sleep 1 ;;
        esac
    done
}

dev_server() {
    print_section "启动开发服务器"
    print_info "按 Ctrl+C 停止服务器"
    echo ""
    npm run dev
    wait_enter
}

dev_lint() {
    print_section "代码检查"
    npm run lint && print_success "检查通过" || print_error "发现问题"
    wait_enter
}

dev_build() {
    print_section "构建项目"
    npm run build && print_success "构建完成" || print_error "构建失败"
    wait_enter
}

dev_clean() {
    print_section "清理构建产物"
    if ! confirm "确认清理 .next 目录？"; then
        return
    fi
    rm -rf .next
    print_success "已清理"
    wait_enter
}

dev_log() {
    print_section "提交历史"
    git log --oneline -20
    wait_enter
}

dev_commit() {
    print_section "快速提交"
    echo -en "提交信息: "
    read -r msg
    if [ -z "$msg" ]; then
        print_error "提交信息不能为空"
        wait_enter
        return
    fi
    git add -A
    git commit -m "$msg"
    print_success "提交成功"
    echo -en "是否推送到远程？ [y/N]: "
    read -r push_choice
    if [[ "$push_choice" =~ ^[Yy]$ ]]; then
        git push "$REMOTE" "$(get_current_branch)" && print_success "推送成功" || print_error "推送失败"
    fi
    wait_enter
}

# ── 启动 ──
main_menu
