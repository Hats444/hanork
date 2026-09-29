import re
path = r"C:\Users\boots\Downloads\hanork\docs\HANORK-STATUS.md"
with open(path, "r", encoding="utf-8") as f:
    text = f.read()

new_header = "> **Última atualização:** 29/06/2026 **22:25 BRT** — **✅ APROVADO operador** — bot PID **45080** — ✅ deploy **v5g+v5h** WSL — validate **18/18** — wa_a/wa_b conectados"
text = re.sub(r"> \*\*Última atualização:\*\*[^\n]+", new_header, text, count=1)

replacements = [
    ("> **Fonte:** `~/.hanork/hanork.db` · `scripts/prod-metrics-snapshot.js` · **30/06/2026 21:52 BRT**",
     "> **Fonte:** `~/.hanork/hanork.db` · `scripts/prod-metrics-snapshot.js` · **29/06/2026 22:25 BRT**"),
    ("| SQLite prod | 30/06 21:52 |", "| SQLite prod | 29/06 22:25 |"),
    ("| script Node 20 | 30/06 21:52 |", "| script Node 20 | 29/06 22:25 |"),
    ("| pgrep | 30/06 21:52 |", "| pgrep | 29/06 22:25 |"),
    ("### 4.1 Processos (ao vivo 30/06 21:52)", "### 4.1 Processos (ao vivo 29/06 22:25)"),
    ("| **hanork-bot** | **33140** |", "| **hanork-bot** | **45080** |"),
    ("| **zero-divu connect.js** | **33557** · **33618** (+ Div on-demand) | wa_a/wa_b admin · boot 21:52 |",
     "| **zero-divu connect.js** | **48712** (wa_a) · **48713** (wa_b) · **45441**/**45447** (Div assinantes) | v5h deploy · boot 22:22 |"),
    ("**Último deploy verificado (30/06 21:52 BRT)**", "**Último deploy verificado (29/06/2026 22:25 BRT — v5g+v5h WSL)**"),
    ("- [x] Bot reiniciado — PID **33140** · validate **18/18**", "- [x] Bot reiniciado — PID **45080** · validate **18/18** · `verify-wadv-v5a` ALL OK"),
]
for a, b in replacements:
    if a in text:
        text = text.replace(a, b)
    else:
        print("MISSING:", a[:60])

entry = """| 29/06 22:25 | **Deploy v5g+v5h WSL — aprovado operador** — rsync `src/` + zero-divu IPC (`connect.js`, `singleInstance.js`, `pathResolver.js`, `server.js`, `operations.js`) · bot PID **45080** · validate **18/18** · wa_a **48712** conectado `5521995930864` · wa_b **48713** conectado `5491178918887` | `hanork-ctl.sh` · §11 |
"""
marker = "## 11. Correções recentes (log / produção)\n\n| Data | Fix | Arquivo / ação |\n|------|-----|----------------|\n"
if entry.strip() not in text:
    if marker in text:
        text = text.replace(marker, marker + entry)
    else:
        print("MARKER NOT FOUND")

with open(path, "w", encoding="utf-8", newline="\n") as f:
    f.write(text)
print("OK")
