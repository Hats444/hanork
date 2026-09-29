#!/usr/bin/env bash
set -euo pipefail
WIN=/mnt/c/Users/boots/Downloads/hanork
HANORK=/home/vendetta/hanork
files=(
  docs/audit/PLANO-CONVERSAO-DIVULGACAO.md
  docs/audit/PLANO-DUAL-WA-PRODUCAO-2026-06-21.md
  .cursor/rules/plano-conversao-live.mdc
  .cursor/rules/plano-dual-wa-live.mdc
)
for f in "${files[@]}"; do
  install -D "$WIN/$f" "$HANORK/$f"
  echo "OK $f"
done
