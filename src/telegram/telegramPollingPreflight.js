'use strict';

const { execSync } = require('child_process');
const logger = require('../config/logger');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isWsl() {
  if (process.platform !== 'linux') return false;
  try {
    return /microsoft/i.test(require('fs').readFileSync('/proc/version', 'utf8'));
  } catch {
    return false;
  }
}

/** Mata node.exe no Windows que roda hanork/src/bot.js (evita 409 com WSL). */
function killWindowsHanorkBots() {
  if (!isWsl() || process.env.KILL_WINDOWS_DUPLICATE_BOTS === '0') return { killed: 0 };
  try {
    const ps =
      "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
      "Where-Object { $_.CommandLine -match 'hanork' -and $_.CommandLine -match 'bot\\.js' } | " +
      'Select-Object -ExpandProperty ProcessId';
    const out = execSync(`powershell.exe -NoProfile -Command "${ps}"`, {
      encoding: 'utf8',
      timeout: 15000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const pids = out
      .split(/\r?\n/)
      .map((x) => parseInt(x.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    let killed = 0;
    for (const pid of pids) {
      try {
        execSync(`powershell.exe -Command "Stop-Process -Id ${pid} -Force"`, { timeout: 8000 });
        killed++;
        logger.warn(`[BOT] Encerrado Hanork duplicado no Windows (PID ${pid})`);
      } catch {
        /* ignore */
      }
    }
    return { killed };
  } catch {
    return { killed: 0 };
  }
}

function listLinuxHanorkBotPids() {
  if (process.platform !== 'linux') return [];
  try {
    const out = execSync("pgrep -af 'src/bot\\.js' 2>/dev/null || true", {
      encoding: 'utf8',
      timeout: 5000,
    });
    const { isHanorkBotPid, readLockPid } = require('../modules/security/botInstanceLock');
    const lockOwner = readLockPid();
    const pids = [];
    for (const line of out.split(/\n/)) {
      const m = line.match(/^\s*(\d+)/);
      if (!m) continue;
      const pid = parseInt(m[1], 10);
      if (pid > 1 && pid !== process.pid && isHanorkBotPid(pid)) pids.push(pid);
    }
    return [...new Set(pids)].filter((pid) => {
      // Nunca matar o dono oficial do .bot.lock a partir de outra cópia.
      if (lockOwner && pid === lockOwner && lockOwner !== process.pid) return false;
      return true;
    });
  } catch {
    return [];
  }
}

function assertLockOwnerOrExit() {
  const { readLockPid } = require('../modules/security/botInstanceLock');
  const lockOwner = readLockPid();
  if (lockOwner && lockOwner !== process.pid && pidAlive(lockOwner)) {
    logger.error(
      `[BOT] Instância oficial ativa (lock PID ${lockOwner}) — esta cópia (PID ${process.pid}) encerra para evitar conflito 409`
    );
    process.exit(2);
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Limpa webhook e espera outro poller soltar o token antes do launch.
 */
async function prepareTelegramPolling(telegram, { dropPending = false } = {}) {
  assertLockOwnerOrExit();

  const win = killWindowsHanorkBots();
  const others = listLinuxHanorkBotPids();
  if (others.length) {
    const skipKill = process.env.KILL_LINUX_DUPLICATE_BOTS === '0';
    logger.warn(
      `[BOT] Outro(s) bot.js Hanork no Linux: PID ${others.join(', ')} — ${skipKill ? '409 provável' : 'encerrando…'}`
    );
    if (!skipKill) {
      for (const pid of others) {
        try {
          process.kill(pid, 'SIGTERM');
          logger.warn(`[BOT] Encerrado Hanork duplicado no Linux (PID ${pid})`);
        } catch {
          /* ignore */
        }
      }
      await sleep(3000);
      for (const pid of others) {
        try {
          process.kill(pid, 0);
          process.kill(pid, 'SIGKILL');
          logger.warn(`[BOT] SIGKILL Hanork duplicado (PID ${pid})`);
        } catch {
          /* morto ou sem permissão */
        }
      }
      await sleep(1500);
    }
  }
  if (win.killed > 0) {
    await sleep(4000);
  }

  for (let i = 0; i < 3; i++) {
    try {
      await telegram.deleteWebhook({ drop_pending_updates: dropPending });
    } catch {
      /* ignore */
    }
    await sleep(800);
  }

  try {
    const wh = await telegram.getWebhookInfo();
    if (wh?.url) {
      logger.warn('[BOT] Webhook ainda registrado — removendo de novo', { url: wh.url });
      await telegram.deleteWebhook({ drop_pending_updates: true });
      await sleep(2000);
    }
  } catch {
    /* ignore */
  }

  await sleep(2000);
  return { windowsKilled: win.killed, otherLinuxPids: others };
}

async function killDuplicateHanorkPollers() {
  assertLockOwnerOrExit();
  const win = killWindowsHanorkBots();
  const others = listLinuxHanorkBotPids();
  if (others.length && process.env.KILL_LINUX_DUPLICATE_BOTS !== '0') {
    for (const pid of others) {
      try {
        process.kill(pid, 'SIGTERM');
        logger.warn(`[BOT] 409 cleanup — encerrado Hanork Linux PID ${pid}`);
      } catch {
        /* ignore */
      }
    }
    await sleep(2500);
  }
  if (win.killed > 0) await sleep(3000);
  return { windowsKilled: win.killed, linuxKilled: others.length };
}

module.exports = {
  prepareTelegramPolling,
  killWindowsHanorkBots,
  killDuplicateHanorkPollers,
  listLinuxHanorkBotPids,
  isWsl,
};
