#!/usr/bin/env bash
# Aplica CAMINHO_FOTOS/INFOS nativos WSL + estrutura promo + restart.
set -euo pipefail

HANORK="${HANORK_DIR:-/home/vendetta/hanork}"
if [[ ! -f "$HANORK/.env" ]]; then
  local_repo="$(cd "$(dirname "$0")/.." && pwd)"
  if [[ -f "$local_repo/.env" ]]; then
    HANORK="$local_repo"
  fi
fi
ENV="${HANORK}/.env"

upsert_env() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$ENV" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV"
  else
    echo "${key}=${val}" >> "$ENV"
  fi
}

upsert_env CAMINHO_FOTOS "/home/vendetta/hanork/fotos"
upsert_env CAMINHO_INFOS "/home/vendetta/hanork/infos"

export CAMINHO_FOTOS="/home/vendetta/hanork/fotos"
bash "$HANORK/scripts/setup-promo-media-dirs.sh" "/home/vendetta/hanork" 2>/dev/null \
  || bash "$(dirname "$0")/setup-promo-media-dirs.sh" "/home/vendetta/hanork"

FOTOS="/home/vendetta/hanork/fotos"
SRC="$FOTOS/hanork_1.jpg"
if [[ -f "$SRC" ]]; then
  for i in $(seq 1 20); do
    pad=$(printf '%02d' "$i")
    cp -f "$SRC" "$FOTOS/hanork/hanork_${pad}.jpg"
    cp -f "$SRC" "$FOTOS/midias/hanork/hanork_${pad}.jpg"
  done
  echo "OK promo: hanork_01.jpg … hanork_20.jpg (cópia de hanork_1.jpg)"
else
  echo "WARN: $SRC ausente — broadcast usa fallback do menu"
fi

echo "--- .env ---"
grep -E '^CAMINHO_FOTOS=|^CAMINHO_INFOS=' "$ENV"
