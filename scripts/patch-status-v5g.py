from pathlib import Path
import re

path = Path(r"C:\Users\boots\Downloads\hanork\docs\HANORK-STATUS.md")
text = path.read_text(encoding="utf-8")

ts = "29/06/2026 **22:29 BRT**"
bot_pid = "45080"
wa_pids = ("45441", "45447")
ipc_a = "/home/vendetta/.hanork/wa-users/8115302402/ipc"
ipc_b = "/home/vendetta/.hanork/wa-users/8374207443/ipc"

text = re.sub(
    r"> \*\*Última atualização:\*\* .*?\n",
    f"> **Última atualização:** {ts} · **✅ deploy v5g aprovado operador** · bot PID **{bot_pid}** · validate **18/18** · verify-wadv-v5a **ALL OK** · §6.5 IPC isolado (2× connect.js)\n",
    text,
    count=1,
)

text = text.replace(
    "> **Fonte:** `~/.hanork/hanork.db` · `scripts/prod-metrics-snapshot.js` · **30/06/2026 21:52 BRT**",
    f"> **Fonte:** `~/.hanork/hanork.db` · `scripts/prod-metrics-snapshot.js` · **{ts}**",
)
text = text.replace("| SQLite prod | 30/06 21:52 |", "| SQLite prod | 29/06 22:29 |")
text = text.replace("| script Node 20 | 30/06 21:52 |", "| script Node 20 | 29/06 22:29 |")
text = text.replace("| pgrep | 30/06 21:52 |", "| pgrep | 29/06 22:29 |")

text = re.sub(
    r"### 4\.1 Processos \(ao vivo .*?\)\n\| Processo \| PID / modo \| Detalhe \|\n\|----------\|------------\|--------\|\n\| \*\*hanork-bot\*\* \| \*\*\d+\*\* \|.*?\n\| \*\*zero-divu connect\.js\*\* \| \*\*.*?\*\* \|.*?\n",
    f"### 4.1 Processos (ao vivo 29/06 22:29)\n| Processo | PID / modo | Detalhe |\n|----------|------------|--------|\n| **hanork-bot** | **{bot_pid}** | `node src/bot.js` · deploy v5g |\n| **zero-divu connect.js** | **{wa_pids[0]}** · **{wa_pids[1]}** | wa_a/wa_b · IPC distintos · §6.5 |\n",
    text,
    count=1,
)

deploy_block = f"""**Último deploy verificado (29/06 22:29 BRT)**
- [x] **Hanork Div v5g** — rsync `src/` + `zero-divu` (connect · IPC · singleInstance · pathResolver) · operador aprovou
- [x] Bot reiniciado — PID **{bot_pid}** (`hanork-ctl.sh stop` + `start-bg`) · sleep 45s watchdog
- [x] `validate-production` **18/18** (1ª pass 17/18 `/health/live` timeout · retry OK)
- [x] `verify-wadv-v5a.js` → **ALL OK**
- [x] §6.5 isolamento — PID **45441** → `{ipc_a}` · PID **45447** → `{ipc_b}`
- [x] WA1/WA2 boot pós-deploy — grupos 25/25 alinhados (`restore-wa-admin` smoke)

**Histórico checklist (arquivo)**

"""

text = re.sub(
    r"\*\*Último deploy verificado \(30/06 21:52 BRT\)\*\*\n(?:- \[x\].*\n)+",
    deploy_block,
    text,
    count=1,
)

row = (
    "| 29/06 22:29 | **Deploy Hanork Div v5g (operador aprovado)** — rsync prod · bot PID **45080** · connect **45441/45447** · validate **18/18** · verify-wadv-v5a **ALL OK** · §6.5 IPC OK | `hanork-ctl.sh` · `validate-production.js` · `verify-wadv-v5a.js` · `prod-metrics-snapshot.js` |\n"
)
marker = "| Data | Fix | Arquivo / ação |\n|------|-----|----------------|\n"
if row.strip() not in text:
    text = text.replace(marker, marker + row, 1)

path.write_text(text, encoding="utf-8")
print("patched OK")
