'use strict';

/** PM2 — VPS Ubuntu: pm2 start ecosystem.config.js */
module.exports = {
  apps: [
    {
      name: 'zero-divu',
      script: 'connect.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      kill_timeout: 15000,
      listen_timeout: 10000,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
