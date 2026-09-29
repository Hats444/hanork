#!/usr/bin/env bash
LOG=/home/vendetta/.hanork/terminal.log
echo "=== After 18:40 ==="
tail -n 1500 "$LOG" | sed 's/\x1b\[[0-9;]*m//g' | grep -E "\[18:4|\[18:5|\[19:" | grep -iE "error|WRN|fatal|not a function|undefined" | tail -25
