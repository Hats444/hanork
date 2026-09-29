#!/usr/bin/env bash
# Virtuo: índice /services em cache + Discord ds + axios quiet virtuoesim
set -euo pipefail

SRC="${HANORK_SRC:-/mnt/c/Users/boots/Downloads/hanork}"
DST="${HANORK_DST:-/home/vendetta/hanork}"

FILES=(
  src/utils/setupAxios.js
  src/modules/virtuo/providers/virtuoApiClient.js
  src/modules/virtuo/constants/featuredServices.js
  src/modules/virtuo/services/virtuoServiceAvailability.js
  src/modules/virtuo/services/virtuoLiveCatalogService.js
)

fix_text_file() {
  local f="$1"
  sed -i 's/\r$//' "$f"
  sed -i '1s/^\xEF\xBB\xBF//' "$f"
}

for rel in "${FILES[@]}"; do
  install -D -m 0644 "$SRC/$rel" "$DST/$rel"
  fix_text_file "$DST/$rel"
  echo "synced $rel"
done

for rel in "${FILES[@]}"; do
  node --check "$DST/$rel"
done

echo "OK — reinicie o bot para aplicar (hanork-ctl restart-bg)"
