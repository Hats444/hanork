#!/usr/bin/env bash
for d in /home/vendetta/hanork-bot /home/vendetta/hanork-novo /home/vendetta/hanork; do
  f="$d/src/plugins/zero-divu/spawnZeroWorker.js"
  if [ -f "$f" ]; then
    echo "=== $f ($(wc -l < "$f") lines)"
    grep -E 'function (startConnectionWatchdog|readSessionHealth|ensureBothAdminWorkers|ensureSessionWorker)' "$f" || echo "(missing)"
  fi
done
for d in /home/vendetta/hanork-bot /home/vendetta/hanork; do
  f="$d/src/plugins/zero-divu/waIpcHelper.js"
  if [ -f "$f" ]; then
    echo "=== waIpc $f"
    grep -E 'function (enrichStateWithHealth|refreshWorkerStateQuick|ensureAdminWaOnMenuOpen)' "$f" || echo "(missing)"
  fi
done
