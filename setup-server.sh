#!/bin/bash
# =============================================================================
# Setup completo: PM2 + Nginx + SSL para hanorkbot.com
# Execute no servidor: bash setup-server.sh
# =============================================================================

set -e

PM2="/home/vendetta/.nvm/versions/node/v20.20.2/bin/pm2"
BOT_DIR="/home/vendetta/hanork"
DOMAIN="hanorkbot.com"
PORT=3000

echo "=== Hanork Bot Setup ==="
echo ""

# ── 1. Verificar bot ──────────────────────────────────────────────────────────
echo "[1/5] Verificando bot..."
if ps aux | grep "bot.js" | grep -v grep > /dev/null; then
    echo "  ✓ Bot já está rodando"
else
    echo "  ⚠ Bot não está rodando — iniciando..."
    cd "$BOT_DIR"
    $PM2 start ecosystem.config.js --env production
    $PM2 save --silent
fi

echo ""
echo "  Status PM2:"
$PM2 list

# ── 2. Testar bot localmente ──────────────────────────────────────────────────
echo ""
echo "[2/5] Testando webhook localmente..."
sleep 2
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    http://localhost:${PORT}/webhooks/mercadopago \
    -H "Content-Type: application/json" \
    -d '{"type":"payment","data":{"id":"123"}}')

if [ "$HTTP_CODE" = "200" ]; then
    echo "  ✓ Bot respondendo: HTTP $HTTP_CODE"
else
    echo "  ✗ Bot retornou HTTP $HTTP_CODE — verifique os logs:"
    echo "    $PM2 logs hanork-bot --lines 20"
    exit 1
fi

# ── 3. Instalar Nginx ─────────────────────────────────────────────────────────
echo ""
echo "[3/5] Verificando Nginx..."
if which nginx > /dev/null 2>&1; then
    echo "  ✓ Nginx já instalado: $(nginx -v 2>&1)"
else
    echo "  Instalando Nginx..."
    sudo apt-get update -qq
    sudo apt-get install -y nginx
    echo "  ✓ Nginx instalado"
fi

# ── 4. Configurar Nginx ───────────────────────────────────────────────────────
echo ""
echo "[4/5] Configurando Nginx para $DOMAIN..."

sudo tee /etc/nginx/sites-available/${DOMAIN} > /dev/null <<EOF
server {
    listen 80;
    server_name ${DOMAIN} www.${DOMAIN};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${DOMAIN} www.${DOMAIN};

    ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    add_header X-Frame-Options        DENY always;
    add_header X-Content-Type-Options nosniff always;
    client_max_body_size 1m;

    location / {
        proxy_pass         http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }

    location ~ /\. { deny all; }
    location ~* \.(env|db|db-shm|db-wal|lock)$ { deny all; }
}
EOF

# Ativar site
if [ ! -f /etc/nginx/sites-enabled/${DOMAIN} ]; then
    sudo ln -s /etc/nginx/sites-available/${DOMAIN} /etc/nginx/sites-enabled/
fi

# Remover default se existi
if [ -f /etc/nginx/sites-enabled/default ]; then
    sudo rm /etc/nginx/sites-enabled/default
    echo "  ✓ Site default removido"
fi

sudo nginx -t && echo "  ✓ Configuração Nginx válida"

# ── 5. SSL com Certbot ────────────────────────────────────────────────────────
echo ""
echo "[5/5] Configurando SSL..."
if which certbot > /dev/null 2>&1; then
    echo "  ✓ Certbot já instalado"
else
    echo "  Instalando Certbot..."
    sudo apt-get install -y certbot python3-certbot-nginx
fi

if [ -f /etc/letsencrypt/live/${DOMAIN}/fullchain.pem ]; then
    echo "  ✓ Certificado SSL já existe"
    sudo systemctl reload nginx
else
    echo "  Gerando certificado SSL gratuito para ${DOMAIN}..."
    sudo certbot --nginx -d ${DOMAIN} -d www.${DOMAIN} \
        --non-interactive --agree-tos --email admin@${DOMAIN} \
        --redirect
fi

sudo systemctl reload nginx
echo ""
echo "=== Setup concluído! ==="
echo ""
echo "Testando HTTPS final..."
sleep 2
HTTPS_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST https://${DOMAIN}/webhooks/mercadopago \
    -H "Content-Type: application/json" \
    -d '{"type":"payment","data":{"id":"123"}}' 2>/dev/null || echo "000")

if [ "$HTTPS_CODE" = "200" ]; then
    echo "  ✓ Webhook acessível via HTTPS: HTTP $HTTPS_CODE"
    echo ""
    echo "  Configure no painel MP:"
    echo "  https://${DOMAIN}/webhooks/mercadopago"
else
    echo "  ⚠ HTTPS retornou $HTTPS_CODE — verifique se DNS aponta para este servidor:"
    echo "    nslookup ${DOMAIN}"
fi

echo ""
echo "  Comandos úteis:"
echo "    $PM2 logs hanork-bot --lines 50   # ver logs"
echo "    $PM2 restart hanork-bot           # reiniciar"
echo "    sudo systemctl status nginx       # status nginx"
echo "    sudo nginx -t                     # testar config nginx"
