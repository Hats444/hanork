#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
find src -name '*.js' | while read -r f; do
  result=$(node --check "$f" 2>&1)
  if [ -n "$result" ]; then
    echo "=== $f ==="
    echo "$result"
  fi
done
