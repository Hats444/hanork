#!/usr/bin/env bash
# Relatório /start vs grupo — rode no WSL onde está o bot.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export HANORK_DB="${HANORK_DB:-$HOME/.hanork/hanork.db}"
export HANORK_TERMINAL_LOG="${HANORK_TERMINAL_LOG:-$HOME/.hanork/terminal.log}"
node scripts/report-start-vs-group.js "$@"
