#!/usr/bin/env bash
# Atalho — use ./start.sh (instala se precisar e abre o menu)
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/start.sh" "$@"
