#!/usr/bin/env bash
LOG=/home/vendetta/.hanork/terminal.log
echo "=== undefined / not defined (today afternoon) ==="
grep -a "18:\|17:\|16:\|15:" "$LOG" 2>/dev/null \
  | grep -aiE "undefined|is not defined|is not a function|ReferenceError|TypeError" \
  | grep -v "tenant=undefined" \
  | tail -60

echo ""
echo "=== HanorkRouter / handler errors ==="
grep -a "18:\|17:\|16:" "$LOG" 2>/dev/null \
  | grep -aiE "HanorkRouter|textCatchAll|waDivulgacao|CONTEXT|handler" \
  | grep -aiE "error|ERR|fail|undefined" \
  | tail -30

echo ""
echo "=== BOOT-FATAL today ==="
grep -a "2026-07-03\|BOOT-FATAL" "$LOG" 2>/dev/null | tail -15
