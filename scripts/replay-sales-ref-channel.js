#!/usr/bin/env node
'use strict';
/**
 * Republica referências de venda no canal @hanorkinfos (pedidos que falharam no handler).
 * Uso: node scripts/replay-sales-ref-channel.js <orderId> [orderId2...]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Telegraf } = require('telegraf');
const { connect } = require('../src/config/database-sqlite');
const { SalesReferenceChannelService } = require('../src/services/SalesReferenceChannelService');

async function main() {
    const orderIds = process.argv.slice(2).filter(Boolean);
    if (!orderIds.length) {
        console.error('Uso: node scripts/replay-sales-ref-channel.js <orderId> [...]');
        process.exit(1);
    }
    if (!process.env.TOKEN_TELEGRAM) {
        console.error('TOKEN_TELEGRAM ausente');
        process.exit(1);
    }

    const bot = new Telegraf(process.env.TOKEN_TELEGRAM);
    const svc = new SalesReferenceChannelService({ bot, dbRaw: connect });

    for (const orderId of orderIds) {
        try {
            const r = await svc.replayConfirmedSale(orderId);
            console.log(JSON.stringify({ orderId, ...r }));
        } catch (e) {
            console.error(JSON.stringify({ orderId, ok: false, error: e.message }));
        }
    }
    process.exit(0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
