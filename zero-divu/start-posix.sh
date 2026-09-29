#!/bin/sh
# POSIX — Termux / Ubuntu / WSL (sem bashisms)
ROOT=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
cd "$ROOT" || exit 1

if [ -n "${TERMUX_VERSION:-}" ] && command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock 2>/dev/null || true
fi

if [ ! -d node_modules ]; then
  echo "Instalando dependências..."
  npm install || exit 1
fi

exec node connect.js "$@"
