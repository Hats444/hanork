'use strict';

function isBrokenPipeError(err) {
    const code = err?.code;
    return code === 'EPIPE' || code === 'EIO';
}

/** Escrita em stdout/stderr sem derrubar o processo quando o leitor do pipe fechou (Ctrl+C no tail, restart, etc.). */
function safeStreamWrite(stream, chunk, encoding) {
    if (!stream?.writable) return false;
    try {
        stream.write(chunk, encoding);
        return true;
    } catch (err) {
        if (isBrokenPipeError(err)) return false;
        throw err;
    }
}

let _installed = false;

function installConsolePipeGuard() {
    if (_installed) return;
    _installed = true;
    for (const stream of [process.stdout, process.stderr]) {
        if (!stream || typeof stream.on !== 'function') continue;
        stream.on('error', (err) => {
            if (isBrokenPipeError(err)) return;
        });
    }
}

module.exports = {
    isBrokenPipeError,
    safeStreamWrite,
    installConsolePipeGuard,
};
