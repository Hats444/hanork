#!/usr/bin/env node
require('../src/config/env');
console.log('NODE_ENV', process.env.NODE_ENV);
console.log('SECURITY_STRICT', process.env.SECURITY_STRICT);
console.log('ENCRYPTION_KEY len', (process.env.ENCRYPTION_KEY || '').length);
const { validateSecurityEnv, isStrict } = require('../src/config/securityEnv');
console.log('isStrict', isStrict());
validateSecurityEnv();
console.log('validate ok');
