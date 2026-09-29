#!/usr/bin/env node
'use strict';

/**
 * Relatório: quem deu /start no PV vs quem só entrou em grupo.
 *
 * Uso:
 *   node scripts/report-start-vs-group.js
 *   node scripts/report-start-vs-group.js --date 2026-06-20
 *   node scripts/report-start-vs-group.js --log ~/.hanork/terminal.log
 *   node scripts/report-start-vs-group.js --group -5226924708
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function parseArgs(argv) {
    const out = { date: null, db: null, log: null, group: null, days: 1 };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--date' && argv[i + 1]) {
            out.date = argv[++i];
        } else if (a === '--db' && argv[i + 1]) {
            out.db = argv[++i];
        } else if (a === '--log' && argv[i + 1]) {
            out.log = argv[++i];
        } else if (a === '--group' && argv[i + 1]) {
            out.group = String(argv[++i]);
        } else if (a === '--days' && argv[i + 1]) {
            out.days = Math.max(1, parseInt(argv[++i], 10) || 1);
        } else if (a === '--help' || a === '-h') {
            out.help = true;
        }
    }
    return out;
}

function todayBrt() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
}

function expandHome(p) {
    if (!p) return p;
    if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
    return p;
}

function loadDb(dbPath) {
    let Database;
    try {
        Database = require('better-sqlite3');
    } catch {
        console.error('Instale better-sqlite3 ou rode no WSL com node do projeto.');
        process.exit(1);
    }
    if (!fs.existsSync(dbPath)) {
        console.error(`Banco não encontrado: ${dbPath}`);
        process.exit(1);
    }
    return new Database(dbPath, { readonly: true });
}

function fmtUser(row) {
    const un = row.username ? `@${row.username}` : '(sem @)';
    const name = row.first_name || row.name || '';
    return `${un} · ${name} · id=${row.telegram_id}`;
}

function queryDb(db, dateFrom, dateTo, groupFilter) {
    const groupSql = groupFilter ? ' AND gm.group_chat_id = ?' : '';
    const groupParams = groupFilter ? [groupFilter] : [];

    const newUsers = db
        .prepare(
            `SELECT telegram_id, username, first_name, created_at
             FROM users
             WHERE date(created_at) >= date(?) AND date(created_at) <= date(?)
             ORDER BY created_at ASC`
        )
        .all(dateFrom, dateTo);

    const groupJoins = db
        .prepare(
            `SELECT gm.telegram_id, gm.username, gm.first_name, gm.group_chat_id,
                    gm.joined_at, gm.last_seen_at, gm.active,
                    tg.title AS group_title
             FROM group_members gm
             LEFT JOIN telegram_groups tg ON tg.chat_id = gm.group_chat_id
             WHERE date(gm.last_seen_at) >= date(?) AND date(gm.last_seen_at) <= date(?)
               AND gm.active = 1${groupSql}
             ORDER BY gm.last_seen_at DESC`
        )
        .all(dateFrom, dateTo, ...groupParams);

    const firstJoins = db
        .prepare(
            `SELECT gm.telegram_id, gm.username, gm.first_name, gm.group_chat_id,
                    gm.joined_at, tg.title AS group_title
             FROM group_members gm
             LEFT JOIN telegram_groups tg ON tg.chat_id = gm.group_chat_id
             WHERE date(gm.joined_at) >= date(?) AND date(gm.joined_at) <= date(?)
               AND gm.active = 1${groupSql}
             ORDER BY gm.joined_at DESC`
        )
        .all(dateFrom, dateTo, ...groupParams);

    return { newUsers, groupJoins, firstJoins };
}

function parseLog(logPath, dateFrom, dateTo) {
    if (!logPath || !fs.existsSync(logPath)) return null;

    const text = fs.readFileSync(logPath, 'utf8');
    const lines = text.split('\n');

    const sessions = [];
    let current = null;

    for (const line of lines) {
        const sess = line.match(/^\[(\d{4}-\d{2}-\d{2})T[^\]]+\]\s+Nova sessão Hanork/);
        if (sess) {
            current = { date: sess[1], lines: [] };
            sessions.push(current);
            continue;
        }
        if (current) current.lines.push(line);
    }

    const relevant = sessions.filter((s) => s.date >= dateFrom && s.date <= dateTo);
    const chunk = relevant.length ? relevant.flatMap((s) => s.lines) : lines;

    const startPv = new Map();
    const startGroup = new Map();
    const groupNewMember = [];

    const reStartRecv = /\/start recebido.*"uid":(\d+).*?"chat":"(\w+)"/;
    const reStartProc = /\/start processando.*"uid":(\d+).*?"chat":"(\w+)"/;
    const reCmdStart = /\[CMD\].*\((\d+)\) \/start/;
    const reNewMember =
        /novo membro registrado.*"chatId":(-?\d+).*?"chatTitle":"([^"]*)".*?"userId":(\d+)(?:.*?"username":"([^"]*)")?/;

    for (const line of chunk) {
        let m = line.match(reStartRecv) || line.match(reStartProc);
        if (m) {
            const uid = m[1];
            const chat = m[2];
            const bucket = chat === 'private' ? startPv : startGroup;
            if (!bucket.has(uid)) bucket.set(uid, { chat, line: line.trim() });
            continue;
        }

        m = line.match(reCmdStart);
        if (m && line.includes('/start')) {
            const uid = m[1];
            if (!startPv.has(uid)) startPv.set(uid, { chat: 'private', line: line.trim() });
            continue;
        }

        m = line.match(reNewMember);
        if (m) {
            groupNewMember.push({
                chatId: m[1],
                chatTitle: m[2],
                userId: m[3],
                username: m[4] || null,
                line: line.trim(),
            });
        }
    }

    return { startPv, startGroup, groupNewMember, sessions: relevant.length };
}

function printSection(title, rows, formatter) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(title);
    console.log('─'.repeat(60));
    if (!rows.length) {
        console.log('  (nenhum)');
        return;
    }
    rows.forEach((r, i) => console.log(`  ${String(i + 1).padStart(2, '0')}. ${formatter(r)}`));
}

function main() {
    const args = parseArgs(process.argv);
    if (args.help) {
        console.log(`Uso: node scripts/report-start-vs-group.js [opções]

  --date YYYY-MM-DD   Dia inicial (padrão: hoje BRT)
  --days N            Quantos dias incluir (padrão: 1)
  --db PATH           hanork.db (padrão: ~/.hanork/hanork.db)
  --log PATH          terminal.log para /start e new_member
  --group CHAT_ID     Filtrar um grupo (ex: -5226924708)
`);
        process.exit(0);
    }

    const dateTo = args.date || todayBrt();
    const dateFrom = dateTo;
    const dbPath = expandHome(args.db || process.env.HANORK_DB || path.join(os.homedir(), '.hanork/hanork.db'));
    const logPath = expandHome(args.log || process.env.HANORK_TERMINAL_LOG || path.join(os.homedir(), '.hanork/terminal.log'));

    const db = loadDb(dbPath);
    const { newUsers, groupJoins, firstJoins } = queryDb(db, dateFrom, dateTo, args.group);
    const logData = parseLog(logPath, dateFrom, dateTo);

    const groupTgIds = new Set(groupJoins.map((g) => String(g.telegram_id)));
    const newUserIds = new Set(newUsers.map((u) => String(u.telegram_id)));

    const startOnly = newUsers.filter((u) => !groupTgIds.has(String(u.telegram_id)));
    const groupOnly = groupJoins.filter(
        (g) => !newUserIds.has(String(g.telegram_id)) && !(logData?.startPv?.has(String(g.telegram_id)))
    );
    const both = newUsers.filter((u) => groupTgIds.has(String(u.telegram_id)));

    console.log('══════════════════════════════════════════════════════════');
    console.log('  RELATÓRIO: /start (PV) vs entrada em grupo');
    console.log('══════════════════════════════════════════════════════════');
    console.log(`  Período:     ${dateFrom}${args.days > 1 ? ` (+${args.days - 1}d)` : ''}`);
    console.log(`  Banco:       ${dbPath}`);
    console.log(`  Log:         ${fs.existsSync(logPath) ? logPath : '(ausente)'}`);
    if (args.group) console.log(`  Grupo filtro: ${args.group}`);

    printSection(
        `A) PRIMEIRO /start no PV (novo em users) — ${newUsers.length}`,
        newUsers,
        (u) => `${fmtUser(u)} · criado ${u.created_at}`
    );

    printSection(
        `B) ATIVIDADE em grupo hoje (last_seen_at) — ${groupJoins.length}`,
        groupJoins,
        (g) =>
            `${fmtUser(g)} · ${g.group_title || g.group_chat_id} · visto ${g.last_seen_at}`
    );

    printSection(
        `C) SÓ /start (PV), sem registro de grupo no período — ${startOnly.length}`,
        startOnly,
        (u) => `${fmtUser(u)} · ${u.created_at}`
    );

    printSection(
        `D) SÓ GRUPO (sem /start novo no período) — ${groupOnly.length}`,
        groupOnly,
        (g) =>
            `${fmtUser(g)} · ${g.group_title || g.group_chat_id} · joined ${g.joined_at || '?'}`
    );

    printSection(
        `E) AMBOS (/start novo + grupo no período) — ${both.length}`,
        both,
        (u) => {
            const g = groupJoins.find((x) => String(x.telegram_id) === String(u.telegram_id));
            return `${fmtUser(u)} · grupo: ${g?.group_title || g?.group_chat_id || '?'}`;
        }
    );

    if (logData) {
        const pvStarts = [...logData.startPv.entries()].map(([uid, v]) => ({ uid, ...v }));
        const grpStarts = [...logData.startGroup.entries()].map(([uid, v]) => ({ uid, ...v }));

        printSection(
            `F) LOG: /start no PV — ${pvStarts.length}`,
            pvStarts,
            (r) => `id=${r.uid}`
        );

        printSection(
            `G) LOG: /start em grupo (raro) — ${grpStarts.length}`,
            grpStarts,
            (r) => `id=${r.uid}`
        );

        printSection(
            `H) LOG: new_member (entrou no grupo) — ${logData.groupNewMember.length}`,
            logData.groupNewMember,
            (r) =>
                `${r.username ? '@' + r.username : '(sem @)'} · id=${r.userId} · ${r.chatTitle} (${r.chatId})`
        );
    } else {
        console.log('\n  (Log não encontrado — seções F/G/H omitidas)');
    }

    console.log('\n══════════════════════════════════════════════════════════');
    console.log('  Resumo');
    console.log('══════════════════════════════════════════════════════════');
    console.log(`  Novos /start (users):     ${newUsers.length}`);
    console.log(`  Presença em grupo:        ${groupJoins.length}`);
    console.log(`  Só PV:                    ${startOnly.length}`);
    console.log(`  Só grupo:                 ${groupOnly.length}`);
    console.log(`  PV + grupo:               ${both.length}`);
    if (logData) {
        console.log(`  Log /start PV:            ${logData.startPv.size}`);
        console.log(`  Log new_member:           ${logData.groupNewMember.length}`);
    }
    console.log('');

    db.close();
}

main();
