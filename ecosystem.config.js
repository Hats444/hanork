/**
 * PM2 — Hanork Bot
 *
 * Uso:
 *   npm run pm2:start              # development (NODE_ENV default)
 *   pm2 start ecosystem.config.js --env production
 *   npm run pm2:logs
 *   npm run pm2:restart
 */
'use strict';

const path = require('path');

module.exports = {
    apps: [
        {
            name: 'hanork-bot',
            script: path.join(__dirname, 'src', 'bot.js'),
            interpreter:
                process.env.HANORK_NODE ||
                process.env.NVM_BIN ||
                'node',
            cwd: __dirname,
            instances: 1,
            exec_mode: 'fork',
            autorestart: true,
            watch: false,
            max_memory_restart: '600M',
            kill_timeout: 25000,
            listen_timeout: 30000,
            exp_backoff_restart_delay: 2000,
            max_restarts: 15,
            min_uptime: 10000,
            time: true,
            merge_logs: true,
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            error_file: path.join(__dirname, 'logs', 'pm2-error.log'),
            out_file: path.join(__dirname, 'logs', 'pm2-out.log'),
            env: {
                NODE_ENV: 'development',
            },
            env_production: {
                NODE_ENV: 'production',
            },
        },
    ],
};
