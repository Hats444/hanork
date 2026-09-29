#!/usr/bin/env bash
LOG=/home/vendetta/.hanork/terminal.log
echo "=== ERRORS afternoon Jul 3 ==="
grep -a "18:3\|18:2\|18:1\|18:0\|17:\|16:\|15:\|14:\|13:\|12:" "$LOG" 2>/dev/null \
  | grep -aiE "error|fatal|undefined|not defined|ReferenceError|TypeError|Cannot find|BOOT-FATAL|is not a function|is not defined" \
  | tail -100

echo ""
echo "=== UNIQUE error lines (last 2000 lines) ==="
tail -n 2000 "$LOG" 2>/dev/null \
  | grep -aiE "error|fatal|undefined|ReferenceError|TypeError|not defined|Cannot find|is not a function" \
  | sed 's/\x1b\[[0-9;]*m//g' \
  | sort -u \
  | tail -40
