#!/bin/sh
set -e

# Ensure data directory is writable by nextjs user
if [ -d "/app/data" ]; then
  chown -R nextjs:nodejs /app/data 2>/dev/null || true
fi

# Download fonts if not already cached (skip existing ones)
if [ -f "/app/scripts/download-fonts.mjs" ]; then
  echo "[entrypoint] Checking fonts..."
  su-exec nextjs:nodejs node /app/scripts/download-fonts.mjs || echo "[entrypoint] Font download had errors, continuing anyway..."
fi

# Run as nextjs user
exec su-exec nextjs:nodejs node server.js
