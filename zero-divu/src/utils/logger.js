'use strict';

const colors = require('colors');
const terminalAdapter = require('./terminalAdapter');

const APP = String(process.env.WA_DISPLAY_NAME || 'ZERO DIVU').trim() || 'ZERO DIVU';

if (!terminalAdapter.useColors()) {
  colors.disable();
}

function timestamp() {
  return new Date().toLocaleTimeString('pt-BR', { hour12: false });
}

function prefix(level, color) {
  return [
    colors.gray(`[${timestamp()}]`),
    colors.bold.white(APP),
    colors[color](level.padEnd(8)),
  ].join(' ');
}

function write(level, color, msg) {
  if (msg === undefined || msg === null) return;
  const text = typeof msg === 'string' ? msg : String(msg);
  console.log(prefix(level, color), text);
}

exports.infoLog = (msg) => write('INFO', 'cyan', msg);
exports.successLog = (msg) => write('OK', 'green', msg);
exports.errorLog = (msg) => write('ERRO', 'red', msg);
exports.warningLog = (msg) => write('AVISO', 'yellow', msg);
exports.debugLog = (msg) => write('DEBUG', 'gray', msg);

exports.opLog = (level, msg, ctx = {}) => {
  const opCtx = require('./operationContext').get();
  const opId = ctx.opId || opCtx?.id;
  const parts = [];
  if (opId) parts.push(`op:${String(opId).slice(-10)}`);
  if (ctx.source) parts.push(`src:${ctx.source}`);
  if (ctx.queue) parts.push(`fila:${ctx.queue}`);
  if (ctx.score != null) parts.push(`score:${ctx.score}`);
  if (ctx.ms != null) parts.push(`${ctx.ms}ms`);
  const suffix = parts.length ? ` ${colors.gray(`[${parts.join(' · ')}]`)}` : '';
  const color =
    level === 'OK' ? 'green' : level === 'ERRO' ? 'red' : level === 'AVISO' ? 'yellow' : 'cyan';
  write(level, color, `${msg}${suffix}`);
};

exports.skipLog = (groupId, reason, extra = {}) => {
  const line = require('./operationContext').formatSkip(groupId, reason, extra);
  exports.opLog('AVISO', `skip: ${line}`, {
    source: extra.source || 'postGuard',
    queue: extra.queue,
    score: extra.score ?? extra.group?.score,
  });
  try {
    require('../services/metrics').inc('skips');
  } catch {
    /* ignore */
  }
};

exports.section = (title) => {
  const line = '─'.repeat(Math.max(20, String(title).length + 4));
  console.log('');
  console.log(colors.bold.white(`  ${title}`));
  console.log(colors.gray(`  ${line}`));
};

exports.banner = () => {
  if (
    process.env.ZERO_DIVU_QUIET_UI === '1' ||
    process.env.HANORK_ZERO_WORKER === '1' ||
    process.env.ZERO_DIVU_IPC_DIR
  ) {
    return;
  }
  let ver = '1.6.4';
  try {
    ver = require('../../package.json').version || ver;
  } catch {
    /* ignore */
  }
  const label = `          ZERO DIVU v${ver}             `.slice(0, 37).padEnd(37);
  console.log('');
  console.log(colors.bold.cyan('  ╔════════════════════════════════════════╗'));
  console.log(colors.bold.cyan('  ║') + colors.bold.white(label) + colors.bold.cyan('║'));
  console.log(colors.bold.cyan('  ║') + colors.gray('   Divulgação inteligente em grupos    ') + colors.bold.cyan(' ║'));
  console.log(colors.bold.cyan('  ╚════════════════════════════════════════╝'));
  console.log('');
};

exports.summary = (rows) => {
  if (!rows?.length) return;
  console.log('');
  for (const [k, v] of rows) {
    console.log(colors.gray('  •'), colors.white(k + ':'), colors.cyan(v));
  }
  console.log('');
};
