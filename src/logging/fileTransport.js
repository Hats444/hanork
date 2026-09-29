const { safeStreamWrite } = require('./safeStreamWrite');
const path = require('path');

/**
 * Transporte de arquivo opcional (LOG_FILE=./logs/hanork.log).
 * Formato JSONL para ingestão futura (Loki, ELK, etc.).
 */
class FileTransport {
    constructor(filePath) {
        this.filePath = filePath;
        this.stream = null;
        if (filePath) this._open();
    }

    _open() {
        try {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            this.stream = fs.createWriteStream(this.filePath, { flags: 'a' });
        } catch (e) {
            safeStreamWrite(process.stderr, `[LOGGER] File transport disabled: ${e.message}\n`);
            this.stream = null;
        }
    }

    write(entry) {
        if (!this.stream) return;
        const line = JSON.stringify({
            ts: new Date().toISOString(),
            ...entry,
        });
        this.stream.write(line + '\n');
    }

    close() {
        if (this.stream) this.stream.end();
    }
}

module.exports = FileTransport;
