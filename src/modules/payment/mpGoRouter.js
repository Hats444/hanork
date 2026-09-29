'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../../config/logger');
const PaymentService = require('./PaymentService');
const { mpGoRateLimit } = require('../security/httpSecurity');

function escHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function readCachedInitPoint(prefId) {
    try {
        const { connect } = require('../../config/database-sqlite');
        const row = connect()
            .prepare('SELECT value FROM kv_store WHERE key = ?')
            .get(`mp_pref_url:${prefId}`);
        const url = String(row?.value || '').trim();
        return url.startsWith('https://') ? url : null;
    } catch {
        return null;
    }
}

function renderGoPage(initPoint) {
    const safeUrl = escHtml(initPoint);
    const jsonUrl = JSON.stringify(initPoint);
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pagamento Mercado Pago</title>
<style>
  body{font-family:system-ui,sans-serif;text-align:center;padding:2rem 1.25rem;background:#f4f6fb;color:#1a1a2e;margin:0}
  h2{margin:0 0 .5rem}
  p{color:#555;line-height:1.5}
  .btn{display:inline-block;margin:1.25rem 0;padding:14px 28px;background:#009ee3;color:#fff;text-decoration:none;border-radius:10px;font-weight:600;font-size:1.05rem}
  .hint{color:#666;font-size:.9rem;margin-top:1.5rem;max-width:22rem;margin-left:auto;margin-right:auto}
</style>
</head>
<body>
  <h2>💳 Mercado Pago</h2>
  <p>Toque no botão abaixo para continuar o pagamento.</p>
  <a class="btn" id="pay-btn" href="${safeUrl}" target="_blank" rel="noopener noreferrer">Pagar agora</a>
  <p class="hint">Se a página ficar carregando, toque em <b>⋮</b> no canto e escolha<br><b>Abrir no Chrome</b> ou <b>Abrir no Safari</b>.</p>
  <script>
  (function(){
    var url = ${jsonUrl};
    var btn = document.getElementById('pay-btn');
    if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.openLink) {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        window.Telegram.WebApp.openLink(url);
      });
    }
  })();
  </script>
</body>
</html>`;
}

router.get('/mp/go/:prefId', mpGoRateLimit, async (req, res) => {
    const prefId = String(req.params.prefId || '').trim();
    if (!prefId || prefId.length > 128) {
        return res.status(400).send('Preferência inválida');
    }

    let initPoint = readCachedInitPoint(prefId);
    if (!initPoint) {
        try {
            const pref = await PaymentService.getPreference(prefId);
            initPoint = pref?.init_point || null;
        } catch (e) {
            logger.warn('[mp/go] getPreference failed', { prefId, message: e.message });
        }
    }

    if (!initPoint) {
        return res.status(404).send(
            '<html><body style="font-family:sans-serif;text-align:center;padding:2rem">' +
            '<h2>Link expirado</h2><p>Volte ao Telegram e toque em <b>Cartão</b> de novo.</p></body></html>'
        );
    }

    res.status(200).type('html').send(renderGoPage(initPoint));
});

module.exports = router;
