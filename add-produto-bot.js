// =============================================================================
// add-produto-bot.js
// Registra o "Hanork Bot v3" como produto digital no banco de dados.
// Execute APÓS gerar o ZIP: node add-produto-bot.js
// Usa sql.js (puro JS) para evitar dependencia de binarios nativos.
// =============================================================================

const path = require('path');
const fs   = require('fs');

const DB_PATH  = path.join(__dirname, 'hanork.db');
const ZIP_NAME = 'hanork-bot-v3.zip';
const ZIP_PATH = path.join(__dirname, 'produtos', ZIP_NAME);

if (!fs.existsSync(ZIP_PATH)) {
    console.error('Arquivo nao encontrado: ' + ZIP_PATH);
    console.error('Execute primeiro: node pack-bot.js');
    process.exit(1);
}

if (!fs.existsSync(DB_PATH)) {
    console.error('Banco nao encontrado: ' + DB_PATH);
    console.error('Inicie o bot pelo menos uma vez antes de rodar este script.');
    process.exit(1);
}

// sql.js: SQLite em puro JS/WASM, sem binarios nativos
let initSqlJs;
try { initSqlJs = require('sql.js'); } catch {
    console.log('Instalando sql.js...');
    require('child_process').execSync('npm install sql.js', { stdio: 'inherit', cwd: __dirname });
    initSqlJs = require('sql.js');
}

const NOME        = 'Hanork Bot v3 - Bot de Vendas para Telegram';
const DESCRICAO   = 'Bot completo de vendas no Telegram: PIX, Cartao, Boleto via Mercado Pago, entrega automatica de arquivos, flash sales com timer, afiliados com comissao, broadcast com IA, suporte bidirecional, painel admin. Codigo-fonte completo + README de instalacao.';
const PRECO       = 247.00;
const STOCK       = 999;
const CATEGORIA   = 'bots';

async function main() {
    const SQL   = await initSqlJs();
    const buf   = fs.readFileSync(DB_PATH);
    const db    = new SQL.Database(buf);

    // Verificar se produto ja existe
    const rows = db.exec(`SELECT id FROM products WHERE name = '${NOME.replace(/'/g, "''")}'`);
    const existing = rows.length > 0 && rows[0].values.length > 0 ? rows[0].values[0][0] : null;

    if (existing) {
        db.run(
            'UPDATE products SET description=?, price=?, stock=?, category=?, file_url=?, active=1 WHERE id=?',
            [DESCRICAO, PRECO, STOCK, CATEGORIA, ZIP_NAME, existing]
        );
        console.log('Produto atualizado! ID: ' + existing);
    } else {
        db.run(
            'INSERT INTO products (name, description, price, stock, category, file_url, active) VALUES (?,?,?,?,?,?,1)',
            [NOME, DESCRICAO, PRECO, STOCK, CATEGORIA, ZIP_NAME]
        );
        const idRows = db.exec('SELECT last_insert_rowid()');
        const newId  = idRows[0].values[0][0];
        console.log('Produto criado! ID: ' + newId);
    }

    // Salvar banco de volta no disco
    const out = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(out));
    db.close();

    const size = (fs.statSync(ZIP_PATH).size / 1024).toFixed(1);
    console.log('');
    console.log('Produto registrado no bot:');
    console.log('  Nome:    ' + NOME);
    console.log('  Preco:   R$ ' + PRECO.toFixed(2));
    console.log('  Arquivo: produtos/' + ZIP_NAME + ' (' + size + ' KB)');
    console.log('  Stock:   ' + STOCK + ' (ilimitado)');
    console.log('');
    console.log('O produto aparece no catalogo do bot. Use /admin -> Produtos para gerenciar.');
}

main().catch(e => { console.error('Erro:', e.message); process.exit(1); });
