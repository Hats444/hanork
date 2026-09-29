import subprocess, os
pids = subprocess.check_output(["pgrep", "-f", "/home/vendetta/hanork/zero-divu/connect.js"]).decode().strip().split()
print("connect PIDs:", pids)
for p in pids:
    if not p.isdigit(): continue
    env = open(f"/proc/{p}/environ", "rb").read().split(b"\0")
    hits = [e.decode(errors="replace") for e in env if b"ZERO_DIVU" in e or b"ZERO_WORKER" in e or b"INSTANCE" in e]
    print("PID", p)
    for h in hits:
        print(" ", h)
