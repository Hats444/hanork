#!/usr/bin/env bash
echo "=== tail terminal.log ==="
pgrep -af 'tail.*terminal' || echo "(nenhum)"
echo "=== hanork boot/ctl ==="
pgrep -af 'hanork-boot|hanork-ctl' || echo "(nenhum)"
echo "=== node bot ==="
pgrep -af 'node src/bot' || echo "(nenhum)"
echo "=== count tail ==="
pgrep -cf 'tail.*terminal' || true
