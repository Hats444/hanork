/**
 * ============================================================================
 * 📧 SISTEMA DE EMAIL - HANORK BOT
 * Envio de emails via Gmail/SMTP integrado ao Telegram
 * ============================================================================
 */

const nodemailer = require('nodemailer');
const logger = require('./logger');

// Configurações SMTP (usar variáveis de ambiente)
const SMTP_CONFIG = {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 465,
    secure: true, // SSL
    auth: {
        user: process.env.SMTP_EMAIL,
        pass: process.env.SMTP_PASSWORD // App Password do Gmail
    }
};

// Verificar se configuração está completa
function isEmailConfigured() {
    const hasUser = !!SMTP_CONFIG.auth.user;
    const hasPass = !!SMTP_CONFIG.auth.pass;
    logger.info(`SMTP Config: user=${hasUser ? 'OK' : 'MISSING'}, pass=${hasPass ? 'OK' : 'MISSING'}`);
    return hasUser && hasPass;
}

// Criar transporter SMTP
function createTransport() {
    if (!isEmailConfigured()) {
        throw new Error('SMTP não configurado. Defina SMTP_EMAIL e SMTP_PASSWORD no .env');
    }
    return nodemailer.createTransport(SMTP_CONFIG);
}

/**
 * Enviar email simples
 */
async function sendEmail(to, subject, html, text = null, options = {}) {
    try {
        const transporter = createTransport();
        const mail = {
            from: `"Hanork Bot" <${SMTP_CONFIG.auth.user}>`,
            to,
            subject,
            text: text || html.replace(/<[^>]*>/g, ''),
            html,
        };
        if (options.attachments?.length) {
            mail.attachments = options.attachments;
        }

        const info = await transporter.sendMail(mail);
        
        logger.info(`Email enviado: ${to} - ${subject}`);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        let errorMsg = error.message;
        
        // Erros específicos do Gmail
        if (error.message.includes('535') || error.message.includes('Username and Password not accepted')) {
            errorMsg = '❌ Senha do Gmail invalida.\n\n' +
                'Use APP PASSWORD (nao a senha normal).\n' +
                'Gere em: myaccount.google.com/apppasswords\n\n' +
                'Depois coloque no .env em SMTP_PASSWORD';
        } else if (error.message.includes('SMTP não configurado')) {
            errorMsg = '❌ Email nao configurado. Adicione ao .env:\n' +
                'SMTP_EMAIL=seuemail@gmail.com\n' +
                'SMTP_PASSWORD=sua_app_password';
        }
        
        logger.error(`Erro ao enviar email: ${error.message}`);
        return { success: false, error: errorMsg };
    }
}

/**
 * Template HTML padrão para emails
 */
function createEmailTemplate(content, options = {}) {
    const { title = 'Hanork Bot', banner = '🤖 HANORK BOT' } = options;
    
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; color: white; }
        .header h1 { margin: 0; font-size: 24px; }
        .content { padding: 30px; color: #333; line-height: 1.6; }
        .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #666; font-size: 12px; }
        .btn { display: inline-block; padding: 12px 30px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .code { background: #f0f0f0; padding: 15px; border-radius: 5px; font-family: monospace; font-size: 24px; text-align: center; letter-spacing: 5px; margin: 20px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${banner}</h1>
        </div>
        <div class="content">
            ${content}
        </div>
        <div class="footer">
            <p>Este email foi enviado automaticamente pelo Hanork Bot</p>
            <p>© 2025 Hanork - Todos os direitos reservados</p>
        </div>
    </div>
</body>
</html>`;
}

/**
 * Gerar código de verificação
 */
function generateVerificationCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

module.exports = {
    isEmailConfigured,
    sendEmail,
    createEmailTemplate,
    generateVerificationCode
};
