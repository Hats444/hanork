'use strict';

const fs = require('fs-extra');
const path = require('path');

const QR_PNG = path.join(__dirname, '../../database/qr-login.png');

async function printQrToTerminal(qr) {
  process.stdout.write('\n');

  // Método 1: pacote qrcode (ASCII no terminal — mais confiável em SSH/VPS)
  try {
    const QRCode = require('qrcode');
    const ascii = await QRCode.toString(qr, { type: 'terminal', small: true });
    process.stdout.write(ascii);
    process.stdout.write('\n');
    return true;
  } catch {
    /* tenta próximo */
  }

  // Método 2: qrcode-terminal
  try {
    const qrcodeTerminal = require('qrcode-terminal');
    await new Promise((resolve, reject) => {
      qrcodeTerminal.generate(qr, { small: true }, (output) => {
        if (output) process.stdout.write(`${output}\n`);
        resolve();
      });
    });
    return true;
  } catch {
    /* tenta próximo */
  }

  return false;
}

async function saveQrPng(qr) {
  try {
    const QRCode = require('qrcode');
    fs.ensureDirSync(path.dirname(QR_PNG));
    await QRCode.toFile(QR_PNG, qr, { width: 512, margin: 2 });
    return QR_PNG;
  } catch {
    return null;
  }
}

async function qrToBuffer(qr) {
  try {
    const QRCode = require('qrcode');
    return await QRCode.toBuffer(qr, { width: 512, margin: 2 });
  } catch {
    return null;
  }
}

exports.qrToBuffer = qrToBuffer;

exports.showLoginQr = async (qr, log) => {
  log('════════════════════════════════════════');
  log('  ESCANEIE O QR CODE NO WHATSAPP');
  log('  Menu → Aparelhos conectados → Conectar');
  log('════════════════════════════════════════');

  const terminalOk = await printQrToTerminal(qr);
  const pngPath = await saveQrPng(qr);

  if (pngPath) {
    log(`QR salvo em: ${pngPath}`);
    log('Se não aparecer acima, baixe/abra esse PNG (scp, SFTP, etc.)');
  }

  if (!terminalOk && !pngPath) {
    log('Instale dependências: npm install qrcode qrcode-terminal');
    log('Ou use pareamento: ./start.sh → opção 2');
  }

  process.stdout.write('\n');
};

exports.QR_PNG = QR_PNG;
