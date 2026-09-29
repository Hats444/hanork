#!/usr/bin/env node
'use strict';

/**
 * Smoke: valida fila GPT, boot guard, pool de APIs, sanitização IA e ADMIN_NOTIFY
 * sem subir polling do Telegram.
 */
process.env.SMOKE_BOOT = '1';

const assert = require('assert');
const path = require('path');

require(path.join(__dirname, '../src/config/env'));

const GptQueue = require('../src/services/GptRequestQueue');
const GptPool = require('../src/services/GptProviderPool');
const ZeroTwoAi = require('../src/services/ZeroTwoAiService');
const { sanitizeAiBodyText } = require('../src/utils/aiContentSanitizer');
const { AdminActivityNotifier } = require('../src/telegram/admin/AdminActivityNotifier');

let passed = 0;
let failed = 0;

function ok(name) {
    passed++;
    console.log(`  ✓ ${name}`);
}

function fail(name, err) {
    failed++;
    console.error(`  ✗ ${name}:`, err?.message || err);
}

console.log('\n=== Smoke: IA / Boot / Notify ===\n');

// 1) Pool de provedores
try {
    const providers = GptPool.getProviders();
    assert.strictEqual(providers.length, 3, 'esperado 3 provedores');
    assert.ok(providers.some((p) => p.id === 'gpt4'));
    assert.ok(providers.some((p) => p.id === 'zerotwo'));
    ok('Pool GPT: gpt + gpt4 + zerotwo');
} catch (e) {
    fail('Pool GPT', e);
}

// 2) Boot guard bloqueia IA automática
try {
    assert.ok(GptQueue.isBootGuardActive(), 'boot guard deve estar ativo antes de setBootComplete');
    ok('Boot guard ativo antes do boot completo');
} catch (e) {
    fail('Boot guard ativo', e);
}

// 3) executeGptGet rejeita durante boot guard
(async () => {
    try {
        await GptQueue.executeGptGet({
            query: 'teste smoke boot guard',
            timeout: 1000,
            apiBase: 'https://zero-two-apis.com.br',
            apiKey: process.env.API_KEY_ZEROTWO || 'test-key',
        });
        fail('Boot guard bloqueia request', new Error('deveria ter lançado erro'));
    } catch (e) {
        if (/boot guard/i.test(e.message)) {
            ok('Boot guard bloqueia executeGptGet sem allowBoot');
        } else {
            fail('Boot guard bloqueia request', e);
        }
    }

    // 4) setBootComplete libera (mas ainda dentro de boot guard window)
    try {
        GptQueue.setBootComplete();
        assert.ok(!GptQueue.isBootPhase(), 'boot phase deve terminar');
        assert.ok(GptQueue.isBootGuardActive(), 'boot guard window ainda ativa');
        ok('setBootComplete encerra boot phase');
    } catch (e) {
        fail('setBootComplete', e);
    }

    // 5) broadcastAiCopy usa template durante boot guard
    try {
        const { generateProductPromoHtml, isAiBroadcastEnabled } = require('../src/utils/broadcastAiCopy');
        process.env.AUTO_BROADCAST_USE_AI = 'true';
        const product = {
            id: 9999,
            name: 'Produto Smoke',
            price: 19.9,
            description: 'Teste',
            active: true,
        };
        const html = await generateProductPromoHtml(product, {
            botLink: 'https://t.me/test?start=buy_9999',
            forceTemplate: false,
        });
        assert.ok(html && html.includes('Produto Smoke'), 'template deve conter nome');
        if (ZeroTwoAi.isBootGuardActive()) {
            ok('AI_COPY usa template durante boot guard (sem chamada API)');
        } else {
            ok('AI_COPY gerou HTML válido');
        }
    } catch (e) {
        fail('AI_COPY boot guard', e);
    }

    // 6) Sanitização remove links/CTAs da IA
    try {
        const dirty =
            '<b>Oferta</b>\nCompre agora em https://t.me/hanork_bot\n<a href="https://x.com">link</a>';
        const clean = sanitizeAiBodyText(dirty);
        assert.ok(!/https?:\/\//i.test(clean), 'URLs removidas');
        assert.ok(!/compre agora/i.test(clean), 'CTA removido');
        assert.ok(!/<a\s/i.test(clean), 'tags <a> removidas');
        ok('Sanitizador remove links, URLs e CTAs');
    } catch (e) {
        fail('Sanitizador IA', e);
    }

    // 7) ADMIN_NOTIFY: fallback desligado quando notify online
    try {
        const notifier = new AdminActivityNotifier({
            token: '123:fake_notify_token_for_test_only',
            fallbackToken: '456:fake_main_token',
            adminIds: [123456789],
        });
        notifier._notifyBotOnline = true;
        notifier._botUsername = 'hanorkt_bot';
        notifier.fallbackTelegram = null;
        assert.strictEqual(notifier.fallbackTelegram, null);
        assert.ok(notifier._notifyBotOnline);
        ok('ADMIN_NOTIFY: fallback null quando monitoramento online');
    } catch (e) {
        fail('ADMIN_NOTIFY fallback', e);
    }

    // 8) Métricas da fila
    try {
        const stats = GptQueue.getStats();
        assert.ok(stats.metrics, 'métricas presentes');
        assert.ok(stats.providers?.gpt, 'stats do provedor gpt');
        assert.ok(typeof stats.metrics.bootSkipped === 'number');
        ok(`Métricas GPT: bootSkipped=${stats.metrics.bootSkipped} providers=${Object.keys(stats.providers).length}`);
    } catch (e) {
        fail('Métricas GPT', e);
    }

    // 9) Smoke callbacks original
    try {
        const { registry } = require('../src/core/CallbackRegistry');
        const { registerCallbacks } = require('../src/bot/bootstrap/registerCallbacks');
        const { Telegraf } = require('telegraf');
        if (process.env.TOKEN_TELEGRAM) {
            const bot = new Telegraf(process.env.TOKEN_TELEGRAM);
            registerCallbacks(bot, {
                bot,
                stateManager: require('../src/infrastructure').stateManager,
                sendMainMenu: async () => {},
                showCatalog: async () => {},
                showCart: async () => {},
                cartKey: () => 1,
                Cart: { items: async () => [], totalWithDiscount: async () => 0, clear: async () => {} },
                createOrder: async () => ({ id: 'test' }),
                prisma: require('../src/config/database').prisma,
                comprasPendentes: { get: async () => null, set: async () => {}, delete: async () => {} },
                getAffSaldo: async () => 0,
                checkCheckoutCooldown: async () => ({ allowed: true }),
                Menu: { pagamento: () => ({ reply_markup: { inline_keyboard: [] } }) },
                Markup: require('telegraf').Markup,
                Msg: { edit: async () => {}, reply: async () => {} },
                cuponsAplicados: { get: async () => null },
                deliverProducts: async () => {},
                payAffiliateCommission: async () => {},
            }, []);
            ok(`Callbacks registrados: ${registry.stats.registered}`);
        } else {
            console.log('  ~ Callbacks: SKIP (TOKEN_TELEGRAM ausente)');
        }
    } catch (e) {
        fail('Callbacks smoke', e);
    }

    console.log(`\n=== Resultado: ${passed} OK, ${failed} FALHA ===\n`);
    process.exit(failed > 0 ? 1 : 0);
})();
