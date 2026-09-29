#!/usr/bin/env bash
LOG=/home/vendetta/.hanork/terminal.log
echo "=== is not a function / is not defined (last 3000 lines) ==="
tail -n 3000 "$LOG" | sed 's/\x1b\[[0-9;]*m//g' | grep -iE "is not a function|is not defined|Cannot read propert" | sort -u | tail -30
