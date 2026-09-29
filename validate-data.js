/**
 * validate-data.js — Validação completa de integridade do banco Hanork
 * Uso: node validate-data.js
 */
const Database = require('./node_modules/better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'hanork.db');
let errors = 0, warnings = 0;

function ok(msg) { console.log(`  ✅ ${msg}`); }
function warn(msg) { console.log(`  ⚠️  ${msg}`); warnings++; }
function fail(msg) { console.log(`  ❌ ${msg}`); errors++; }
function sep(t) { console.log(`\n${'─'.repeat(55)}\n  ${t}\n${'─'.repeat(55)}`); }

if (!fs.existsSync(DB_PATH)) { console.error('❌ Banco não encontrado: ' + DB_PATH); process.exit(1); }

const db = new Database(DB_PATH, { readonly: true });

// ── 1. Integridade SQLite ─────────────────────────────────────────────────────
sep('1. INTEGRIDADE SQLITE');
const integrity = db.pragma('integrity_check', { simple: true });
integrity === 'ok' ? ok('integrity_check: ok') : fail('integrity_check: ' + integrity);
const foreign = db.pragma('foreign_key_check');
foreign.length === 0 ? ok('foreign_key_check: ok') : fail(`foreign_key_check: ${foreign.length} violações`);

// ── 2. Contagens ──────────────────────────────────────────────────────────────
sep('2. CONTAGEM DE REGISTROS');
const tables = ['users', 'orders', 'products', 'order_items', 'affiliates', 'cashback', 'audit_logs', 'coupons', 'reviews'];
const counts = {};
for (const t of tables) {
    try {
        counts[t] = db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get().c;
        counts[t] > 0 ? ok(`${t.padEnd(20)}: ${counts[t]}`) : warn(`${t.padEnd(20)}: 0 registros`);
    } catch (_) { warn(`${t}: tabela não existe`); counts[t] = 0; }
}

// ── 3. Usuários sem telegram_id ───────────────────────────────────────────────
sep('3. QUALIDADE DOS USUÁRIOS');
try {
    const noTg = db.prepare("SELECT COUNT(*) as c FROM users WHERE telegram_id IS NULL OR telegram_id = ''").get().c;
    noTg === 0 ? ok('Todos usuários têm telegram_id') : fail(`${noTg} usuários sem telegram_id`);

    const dupes = db.prepare("SELECT telegram_id, COUNT(*) as c FROM users GROUP BY telegram_id HAVING c > 1").all();
    dupes.length === 0 ? ok('Sem telegram_id duplicados') : fail(`${dupes.length} telegram_id duplicados`);
} catch (e) { warn('Erro ao verificar usuários: ' + e.message); }

// ── 4. Pedidos órfãos (sem usuário) ──────────────────────────────────────────
sep('4. INTEGRIDADE RELACIONAL');
try {
    const orphanOrders = db.prepare(`
        SELECT COUNT(*) as c FROM orders o 
        WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = o.user_id)
    `).get().c;
    orphanOrders === 0 ? ok('Nenhum pedido órfão') : fail(`${orphanOrders} pedidos sem usuário`);
} catch (e) { warn('Erro pedidos órfãos: ' + e.message); }

try {
    const orphanItems = db.prepare(`
        SELECT COUNT(*) as c FROM order_items oi
        WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = oi.order_id)
    `).get().c;
    orphanItems === 0 ? ok('Nenhum order_item órfão') : fail(`${orphanItems} order_items sem pedido`);
} catch (e) { warn('Erro order_items: ' + e.message); }

try {
    const orphanAff = db.prepare(`
        SELECT COUNT(*) as c FROM affiliates a
        WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = a.user_id)
    `).get().c;
    orphanAff === 0 ? ok('Nenhum afiliado órfão') : warn(`${orphanAff} afiliados sem usuário (dados legados)`);
} catch (e) { warn('Erro afiliados: ' + e.message); }

// ── 5. Pedidos com status inválido ───────────────────────────────────────────
sep('5. CONSISTÊNCIA DE STATUS');
try {
    const validStatus = ['PENDING', 'PAID', 'DELIVERING', 'DELIVERED', 'EXPIRED', 'REFUNDED', 'CANCELLED', 'CREATED', 'FAILED'];
    const invalid = db.prepare(`
        SELECT status, COUNT(*) as c FROM orders 
        GROUP BY status
    `).all().filter(r => !validStatus.includes(r.status));
    invalid.length === 0 ? ok('Todos status de pedido válidos') :
        invalid.forEach(r => warn(`Status inválido: '${r.status}' (${r.c} pedidos)`));
} catch (e) { warn('Erro status pedidos: ' + e.message); }

// ── 6. Saldos negativos ──────────────────────────────────────────────────────
sep('6. CONSISTÊNCIA FINANCEIRA');
try {
    const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
    if (cols.includes('balance')) {
        const negBalance = db.prepare("SELECT COUNT(*) as c FROM users WHERE balance < 0").get().c;
        negBalance === 0 ? ok('Sem saldos negativos') : fail(`${negBalance} usuários com saldo negativo`);
    } else { warn('Coluna balance não existe em users'); }
} catch (e) { warn('Erro saldo: ' + e.message); }

try {
    const negPrice = db.prepare("SELECT COUNT(*) as c FROM products WHERE price < 0").get().c;
    negPrice === 0 ? ok('Sem preços negativos') : fail(`${negPrice} produtos com preço negativo`);
} catch (e) { warn('Erro preços: ' + e.message); }

// ── 7. Produtos sem estoque com pedidos PAID ─────────────────────────────────
sep('7. ESTOQUE E ENTREGAS');
try {
    const paidOrders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'PAID'").get().c;
    paidOrders === 0 ? ok('Nenhum pedido PAID pendente de entrega') : warn(`${paidOrders} pedidos PAID aguardando entrega`);
} catch (e) { warn('Erro pedidos PAID: ' + e.message); }

// ── 8. Verificar WAL ─────────────────────────────────────────────────────────
sep('8. WAL / ARQUIVO');
const walPath = DB_PATH + '-wal';
if (fs.existsSync(walPath)) {
    const walSize = fs.statSync(walPath).size;
    walSize === 0 ? ok('WAL vazio (dados commitados)') : warn(`WAL tem ${(walSize / 1024).toFixed(0)}KB não commitados — reiniciar o bot para commitar`);
} else { ok('Sem WAL (modo normal)'); }

const dbSize = fs.statSync(DB_PATH).size;
ok(`Tamanho do banco: ${(dbSize / 1024).toFixed(0)}KB`);

// ── 9. Verificar backups ──────────────────────────────────────────────────────
sep('9. BACKUPS');
const backupDir = path.join(__dirname, 'backups');
if (fs.existsSync(backupDir)) {
    const bkFiles = fs.readdirSync(backupDir).filter(f => f.endsWith('.db')).sort().reverse();
    bkFiles.length > 0 ? ok(`${bkFiles.length} backups disponíveis (mais recente: ${bkFiles[0]})`) : warn('Nenhum backup encontrado');

    // Verificar idade do backup mais recente
    if (bkFiles[0]) {
        const bkStat = fs.statSync(path.join(backupDir, bkFiles[0]));
        const ageHours = (Date.now() - bkStat.mtimeMs) / 3600000;
        ageHours < 24 ? ok(`Backup recente: ${ageHours.toFixed(1)}h atrás`) : warn(`Último backup foi há ${ageHours.toFixed(0)}h — muito antigo!`);
    }
} else { fail('Pasta de backups não existe!'); }

// ── Sumário ───────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(55)}`);
console.log(`  SUMÁRIO: ${errors} erros, ${warnings} avisos`);
if (errors === 0 && warnings === 0) console.log('  🎉 Banco em perfeito estado!');
else if (errors === 0) console.log('  ✅ Sem erros críticos. Revisar avisos.');
else console.log('  🚨 ERROS CRÍTICOS ENCONTRADOS — verificar urgente!');
console.log(`${'═'.repeat(55)}\n`);

db.close();
process.exit(errors > 0 ? 1 : 0);
