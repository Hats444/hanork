#!/usr/bin/env bash
set -euo pipefail
export PATH="/home/vendetta/.nvm/versions/node/v20.20.2/bin:${PATH}"

WIN="/mnt/c/Users/boots/Downloads/hanork"
WSL="/home/vendetta/hanork"

echo "[1] sync zero-divu plugins (promo fan-out)"
rsync -a "$WIN/src/plugins/zero-divu/" "$WSL/src/plugins/zero-divu/"

echo "[2] sync zero-divu worker (overlap monitor)"
rsync -a \
  --exclude node_modules \
  --exclude database/session \
  "$WIN/zero-divu/" "$WSL/zero-divu/"

echo "[3] sync spawn (dual peer env)"
cp "$WIN/src/plugins/zero-divu/spawnZeroWorker.js" "$WSL/src/plugins/zero-divu/spawnZeroWorker.js"

echo "[4] sync promo photo service"
cp "$WIN/src/services/promoPhotoUploadService.js" "$WSL/src/services/promoPhotoUploadService.js"

echo "[5] docs"
mkdir -p "$WSL/docs/audit"
cp "$WIN/docs/HANORK-STATUS.md" "$WSL/docs/HANORK-STATUS.md"
cp "$WIN/docs/audit/PLANO-DUAL-WA-PRODUCAO-2026-06-21.md" "$WSL/docs/audit/PLANO-DUAL-WA-PRODUCAO-2026-06-21.md"

cp "$WIN/scripts/test-wa-promo-fanout.js" "$WSL/scripts/"

echo "[6] restart bot"
bash "$WSL/scripts/hanork-ctl.sh" stop 2>/dev/null || true
sleep 2
bash "$WSL/scripts/hanork-ctl.sh" start-bg
sleep 10

echo "[7] restore wa_a + wa_b"
cd "$WSL"
node scripts/restore-wa-admin.js || true

echo "[8] verify"
node scripts/test-wa-promo-fanout.js
grep '^WA_DUAL' "$WSL/.env" | head -5 || true
echo "--- worker env (dual join) ---"
for p in $(pgrep -f '/home/vendetta/hanork/zero-divu/connect.js' 2>/dev/null | head -3); do
  tr '\0' '\n' < "/proc/$p/environ" 2>/dev/null | grep -E 'WA_SESSION_ID=|WA_DUAL_JOIN|WA_DUAL_IPC_DIR_PEER=' || true
  echo "--- pid $p ---"
done
bash "$WSL/scripts/hanork-ctl.sh" status | head -8

echo "[✓] dual WA fan-out + overlap deploy OK"
