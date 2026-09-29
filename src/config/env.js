'use strict';

const path = require('path');
const fs = require('fs');

let loaded = false;

/** Carrega .env do diretório do projeto (funciona em WSL e Windows). */
function loadEnv() {
    if (loaded) return;
    const root = path.join(__dirname, '../..');
    const envPath = path.join(root, '.env');
    if (fs.existsSync(envPath)) {
        require('dotenv').config({ path: envPath, quiet: true, override: true });
    } else {
        require('dotenv').config({ quiet: true });
    }
    loaded = true;
}

loadEnv();

require('../utils/gramJsEnv');
require('../telegram/menus/twoColKeyboard');

module.exports = { loadEnv };
