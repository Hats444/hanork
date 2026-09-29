#!/usr/bin/env bash
# Sync Virtuo live API refactor (HANORK-STATUS section 16.0) from Windows source to WSL prod.
set -euo pipefail

SRC="${HANORK_SRC:-/mnt/c/Users/boots/Downloads/hanork}"
DST="${HANORK_DST:-/home/vendetta/hanork}"

SYNC_DIRS=(
  src/modules/virtuo
)

SYNC_FILES=(
  docs/HANORK-STATUS.md
  src/jobs/registerAllSchedulers.js
  src/bot/registerHanorkBot.js
  src/bot/bootstrap/finalizeBot.js
  src/config/database-sqlite.js
  src/modules/queue/QueueHelpers.js
  src/modules/queue/worker.js
  src/modules/queue/jobs/index.js
  src/telegram/callbacks/payment/registerPaymentActions.js
  src/services/salesReferenceReadiness.js
  src/services/SalesReferenceChannelService.js
  src/jobs/eventHandlers/salesReferenceChannel.js
  src/services/unifiedSupplierBalance.js
  src/services/UnifiedServiceSearch.js
  src/core/UserHandlers.js
  src/telegram/middlewares/textCatchAllHandler.js
  src/modules/context/ContextMiddleware.js
  src/data/virtuoBroadcastVariants.js
  src/data/virtuoPromoThemes.json
  scripts/test-virtuo-live.js
  scripts/sync-virtuo-live-refactor-to-wsl.sh
)

fix_text_file() {
  local f="$1"
  sed -i 's/\r$//' "$f"
  sed -i '1s/^\xEF\xBB\xBF//' "$f"
}

sync_one() {
  local rel="$1"
  if [[ ! -f "$SRC/$rel" ]]; then
    echo "[!] ausente no source: $rel" >&2
    exit 1
  fi
  install -D -m 644 "$SRC/$rel" "$DST/$rel"
  fix_text_file "$DST/$rel"
  echo "[ok] $rel"
}

echo "[*] Virtuo live refactor sync"
echo "    SRC=$SRC"
echo "    DST=$DST"
echo ""

SYNCED=()

for dir in "${SYNC_DIRS[@]}"; do
  if [[ ! -d "$SRC/$dir" ]]; then
    echo "[!] ausente no source: $dir/" >&2
    exit 1
  fi
  while IFS= read -r -d '' f; do
    rel="${f#"$SRC/"}"
    install -D -m 644 "$f" "$DST/$rel"
    fix_text_file "$DST/$rel"
    echo "[ok] $rel"
    SYNCED+=("$rel")
  done < <(find "$SRC/$dir" -type f -print0)
done

for rel in "${SYNC_FILES[@]}"; do
  sync_one "$rel"
  SYNCED+=("$rel")
done

echo ""
echo "[*] node --check (amostra)"
node --check "$DST/src/modules/virtuo/services/virtuoLiveCatalogService.js"
node --check "$DST/src/modules/virtuo/hooks/registerVirtuoSchedulers.js"
node --check "$DST/src/modules/virtuo/virtuoConfig.js"
node --check "$DST/src/telegram/callbacks/payment/registerPaymentActions.js"
node --check "$DST/src/jobs/registerAllSchedulers.js"

echo ""
echo "[ok] sync completo (${#SYNCED[@]} arquivos)."
echo ""
echo "Reinicie no SEU terminal Ubuntu (agente NAO reinicia):"
echo "    cd $DST && bash scripts/hanork-ctl.sh restart"
echo ""
echo "Manual (sem este script) - copiar modulo inteiro:"
echo "    cp -a $SRC/src/modules/virtuo/. $DST/src/modules/virtuo/"


