'use strict';

const axios = require('axios');

function installAxiosLogging(logger) {
    axios.interceptors.response.use(null, (err) => {
        const status = err.response?.status;
        const url = err.config?.url || '';
        const method = (err.config?.method || 'GET').toUpperCase();
        const host = String(url).split('?')[0];
        const quiet =
            (status === 404 && host.includes('mercadopago')) ||
            host.includes('virtuoesim.com');
        if (status && !quiet) {
            logger.error(`HTTP ${status} ${method} ${host}`);
        }
        return Promise.reject(err);
    });
}

module.exports = { installAxiosLogging };
