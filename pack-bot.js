// pack-bot.js — Gera hanork-bot-v3.zip sanitizado para distribuicao
// Uso: node pack-bot.js

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');
const archiver = require('archiver');

const ROOT     = __dirname;
const OUT_DIR  = path.join(ROOT, 'produtos');
const ZIP_NAME = 'hanork-bot-v3.zip';
const ZIP_PATH = path.join(OUT_DIR, ZIP_NAME);

// Pastas/arquivos a excluir do zip
const EXCLUDES = new Set([
    '.env', 'hanork.db', 'hanork.db-shm', 'hanork.db-wal',
    'node_modules', 'backups', 'logs', '.bot.lock',
    'produtos', '_pack_temp', 'pack-bot.js', 'pack-bot.ps1',
    'add-produto-bot.js', 'package-lock.json',
]);

// Verificar dependencia archiver
try { require.resolve('archiver'); } catch {
    console.error('Instalando archiver...');
    require('child_process').execSync('npm install archiver --save-dev', { stdio: 'inherit', cwd: ROOT });
}

// Regex de dados sensiveis para sanitizar em bot.js
const SENSITIVE_PATTERNS = [
    /\d{8,12}:[A-Za-z0-9_-]{35,}/g,                          // Telegram token
    /APP_USR-[0-9a-fA-F]{16,}-\d+-[0-9a-fA-F]{16,}-\d+/g,  // MP token
    /AIza[0-9A-Za-z_-]{35,}/g,                                // Gemini key
];

function sanitize(content) {
    let changed = false;
    for (const pat of SENSITIVE_PATTERNS) {
        if (pat.test(content)) {
            content = content.replace(pat, 'CONFIGURE_NO_ENV');
            changed = true;
        }
        pat.lastIndex = 0;
    }
    return { content, changed };
}

async function main() {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    if (fs.existsSync(ZIP_PATH)) fs.unlinkSync(ZIP_PATH);

    console.log('Empacotando Hanork Bot v3...\n');

    const output  = fs.createWriteStream(ZIP_PATH);
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('warning', e => { if (e.code !== 'ENOENT') throw e; });
    archive.on('error',   e => { throw e; });

    const done = new Promise((res, rej) => {
        output.on('close', res);
        output.on('error', rej);
    });

    archive.pipe(output);

    // Percorrer root recursivamente
    function addDir(srcDir, zipDir) {
        const entries = fs.readdirSync(srcDir, { withFileTypes: true });
        for (const entry of entries) {
            if (EXCLUDES.has(entry.name)) {
                console.log(`  skip: ${entry.name}`);
                continue;
            }
            const srcPath = path.join(srcDir, entry.name);
            const zipPath = zipDir ? `${zipDir}/${entry.name}` : entry.name;

            if (entry.isDirectory()) {
                addDir(srcPath, zipPath);
            } else {
                // Sanitizar bot.js
                if (entry.name === 'bot.js') {
                    let content = fs.readFileSync(srcPath, 'utf8');
                    const { content: clean, changed } = sanitize(content);
                    if (changed) console.log('  sanitizado: src/bot.js (dados sensiveis removidos)');
                    archive.append(clean, { name: zipPath });
                } else {
                    archive.file(srcPath, { name: zipPath });
                }
            }
        }
    }

    addDir(ROOT, 'hanork-bot');

    // Substituir README.md pelo de distribuicao
    const readmeProd = path.join(ROOT, 'README-PRODUTO.md');
    if (fs.existsSync(readmeProd)) {
        archive.file(readmeProd, { name: 'hanork-bot/README.md' });
        console.log('  README de distribuicao incluido');
    }

    // Garantir .env.example
    const envEx = path.join(ROOT, '.env.example');
    if (fs.existsSync(envEx)) {
        archive.file(envEx, { name: 'hanork-bot/.env.example' });
    }

    // Pastas obrigatorias vazias
    for (const d of ['produtos', 'fotos', 'infos', 'logs']) {
        archive.append('', { name: `hanork-bot/${d}/.gitkeep` });
    }

    await archive.finalize();
    await done;

    const sizeKB = (fs.statSync(ZIP_PATH).size / 1024).toFixed(1);
    console.log(`\nZIP gerado com sucesso!`);
    console.log(`  Arquivo: ${ZIP_PATH}`);
    console.log(`  Tamanho: ${sizeKB} KB`);
    console.log(`\nProximo passo: node add-produto-bot.js`);
}

main().catch(e => { console.error('Erro:', e.message); process.exit(1); });
