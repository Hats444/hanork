#!/bin/bash
cd "$HOME/hanork"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
node -e "
require('./src/config/env');
console.log('SECURITY_STRICT=', process.env.SECURITY_STRICT);
console.log('ENCRYPTION_KEY len=', (process.env.ENCRYPTION_KEY||'').length);
const { validateSecurityEnv, isStrict } = require('./src/config/securityEnv');
console.log('isStrict=', isStrict());
validateSecurityEnv();
console.log('OK');
"
