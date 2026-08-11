#!/usr/bin/env bash
# =============================================================================
# 检测本机局域网 IP，生成 nip.io 泛解析根域名并写入 .env
# 用法: bash scripts/setup-ip.sh
#   nip.io 会把 <anything>.<ip>.nip.io 解析到 <ip>，无需自建 DNS。
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"

# 推测本机 IP（优先 en0 以太网/wifi，回退到路由出口）
detect_ip() {
  local ip
  # macOS / Linux: 取第一个非 loopback 的 IPv4
  ip=$(ip -4 -o addr show 2>/dev/null \
       | awk '$2 !~ /^(lo|docker|br-)/ {print $2, $4}' \
       | awk '{print $2}' | cut -d/ -f1 | head -1 || true)
  if [[ -z "${ip:-}" ]]; then
    ip=$(ifconfig 2>/dev/null \
         | awk '/^[a-z]/{iface=$1} /inet /&&$2!="127.0.0.1"{print $2; exit}' \
         | cut -d: -f2)
  fi
  if [[ -z "${ip:-}" ]]; then
    ip="127.0.0.1"
  fi
  echo "$ip"
}

IP="$(detect_ip)"
# nip.io 接受 192-168-1-10.nip.io 或 192.168.1.10.nip.io
HYPHEN_IP="${IP//./-}"
DOMAIN="allin.${HYPHEN_IP}.nip.io"

echo "✓ 检测到本机 IP: $IP"
echo "✓ 生成根域名:   $DOMAIN"
echo "  （浏览器需能访问该域名。nip.io 公网解析，需本机可访问公网 DNS）"
echo

# 写入或更新 .env 的 ROOT_DOMAIN
if [[ -f "$ENV_FILE" ]]; then
  if grep -q '^ROOT_DOMAIN=' "$ENV_FILE"; then
    sed -i.bak "s|^ROOT_DOMAIN=.*|ROOT_DOMAIN=$DOMAIN|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  else
    echo "" >> "$ENV_FILE"
    echo "ROOT_DOMAIN=$DOMAIN" >> "$ENV_FILE"
  fi
else
  cp "$ROOT/.env.example" "$ENV_FILE"
  sed -i.bak "s|^ROOT_DOMAIN=.*|ROOT_DOMAIN=$DOMAIN|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
fi
echo "✓ 已写入 $ENV_FILE"
echo
echo "下一步："
echo "  docker compose up -d"
echo "  然后浏览器访问 http://$DOMAIN"
