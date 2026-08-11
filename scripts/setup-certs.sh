#!/usr/bin/env bash
# =============================================================================
# 用 mkcert 生成本地信任的通配证书，供 HTTPS 内网部署
# 前置：先安装 mkcert 并执行 mkcert -install（将根 CA 加入系统信任）
#   macOS:  brew install mkcert && mkcert -install
#   Linux:  见 https://github.com/FiloSottile/mkcert#installation
# 用法:   bash scripts/setup-certs.sh
# 产出:   certs/cert.pem  certs/key.pem
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERT_DIR="$ROOT/certs"
ENV_FILE="$ROOT/.env"

command -v mkcert >/dev/null 2>&1 || {
  echo "✗ 未找到 mkcert，请先安装："
  echo "  macOS:  brew install mkcert && mkcert -install"
  echo "  Linux:  见 https://github.com/FiloSottile/mkcert#installation"
  exit 1
}

# 读取 ROOT_DOMAIN
ROOT_DOMAIN="$(grep -E '^ROOT_DOMAIN=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)"
ROOT_DOMAIN="${ROOT_DOMAIN:-allin.local}"
echo "✓ ROOT_DOMAIN = $ROOT_DOMAIN"

mkdir -p "$CERT_DIR"

# 生成通配证书：覆盖根域 + 所有子域 + localhost
mkcert -cert-file "$CERT_DIR/cert.pem" \
       -key-file "$CERT_DIR/key.pem" \
       "$ROOT_DOMAIN" "*.$ROOT_DOMAIN" "localhost" "127.0.0.1" "::1"

echo "✓ 证书已生成："
echo "  $CERT_DIR/cert.pem"
echo "  $CERT_DIR/key.pem"

# 提示：mkcert 已把根 CA 装入系统信任。手机/其他设备需手动导入 mkcert 的 rootCA。
ROOTCA="$(mkcert -CAROOT)"
echo
echo "✓ 其他设备信任根 CA（可选）：导入 $ROOTCA/rootCA.pem"

# 写入 USE_TLS=true
if grep -q '^USE_TLS=' "$ENV_FILE"; then
  sed -i.bak 's|^USE_TLS=.*|USE_TLS=true|' "$ENV_FILE" && rm -f "$ENV_FILE.bak"
else
  echo "USE_TLS=true" >> "$ENV_FILE"
fi
echo "✓ 已在 .env 设置 USE_TLS=true"
echo
echo "下一步：docker compose up -d  （网关将监听 443）"
