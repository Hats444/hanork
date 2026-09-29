'use strict';

let _deps = null;

function setBotContext(deps) {
    _deps = Object.freeze({ ...deps });
}

function requireBotContext(keys = []) {
    if (!_deps) throw new Error('[BotContext] Não inicializado');
    for (const k of keys) {
        if (_deps[k] === undefined) throw new Error(`[BotContext] Falta: ${k}`);
    }
    return _deps;
}

module.exports = { setBotContext, requireBotContext, getBotContext: () => _deps };
