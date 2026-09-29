#!/usr/bin/env bash
set -euo pipefail
ENV=/home/vendetta/hanork/.env
for LINE in \
  'CAMINHO_FOTOS=/home/vendetta/hanork/fotos' \
  'CAMINHO_INFOS=/home/vendetta/hanork/infos'
do
  KEY="${LINE%%=*}"
  if grep -q "^${KEY}=" "$ENV" 2>/dev/null; then
    sed -i "s|^${KEY}=.*|${LINE}|" "$ENV"
  else
    echo "$LINE" >> "$ENV"
  fi
done
grep -E '^CAMINHO_FOTOS=|^CAMINHO_INFOS=' "$ENV"
