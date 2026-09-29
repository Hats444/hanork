#!/usr/bin/env bash
# Deploy v5i assinante always-on — usa Node 20 (.nvmrc)
set -euo pipefail

HANORK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DL="/mnt/c/Users/boots/Downloads/hanork"
PROD="/home/vendetta/hanork"

_hanork_node_path() {
  local ver="v20.20.2"
  if [ -f "$PROD/.nvmrc" ]; then
    ver="$(tr -d '[:space:]' < "$PROD/.nvmrc")"
    case "$ver" in v*) ;; *) ver="v${ver}" ;; esac
  fi
  echo "${HOME}/.nvm/versions/node/${ver}/bin"
}

BIN="$(_hanork_node_path)"
export PATH="${BIN}:${PATH}"

echo "[*] node=$(node -v) deploy v5i"

echo "[1] sync wa-divulgacao + plugins + zero-divu"
rsync -a "$DL/src/modules/wa-divulgacao/" "$PROD/src/modules/wa-divulgacao/"
rsync -a "$DL/src/plugins/zero-divu/" "$PROD/src/plugins/zero-divu/"
rsync -a --exclude node_modules --exclude database/session "$DL/zero-divu/" "$PROD/zero-divu/"
mkdir -p "$PROD/docs"
cp "$DL/docs/HANORK-STATUS.md" "$PROD/docs/HANORK-STATUS.md"

echo "[2] native deps (node 20)"
cd "$PROD"
rm -rf node_modules/better-sqlite3
npm install better-sqlite3 --omit=dev --no-save
node -e "require('better-sqlite3')(':memory:'); console.log('sqlite OK')"

echo "[3] restart"
bash scripts/hanork-ctl.sh stop 2>/dev/null || true
sleep 2
bash scripts/hanork-ctl.sh start-bg

echo "[4] aguardando boot..."
for i in $(seq 1 40); do
  if curl -sf http://127.0.0.1:3000/health/live >/dev/null 2>&1; then
    echo "[OK] health em ${i}×5s"
    break
  fi
  sleep 5
done

bash scripts/hanork-ctl.sh status
node scripts/validate-production.js || true
node scripts/verify-wadv-v5a.js

grep -i 'always-on' "$HOME/.hanork/terminal.log" 2>/dev/null | tail -3 || true
echo "[*] deploy v5i done"
