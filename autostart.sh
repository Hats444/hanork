#!/bin/bash
# Hanork Bot - Inicio simples e direto

# Verificar se ja existe uma instancia rodando
if pgrep -f 'node.*bot.js' > /dev/null; then
    echo '[AUTOSTART] Bot ja esta rodando, ignorando...'
    exit 0
fi

# Iniciar o bot
cd /mnt/c/Users/boots/Downloads/hanork/ && node src/bot.js &
echo '[AUTOSTART] Bot iniciado com sucesso'
