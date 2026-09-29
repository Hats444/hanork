'use strict';

const { isSmmEnabled } = require('../smmEnabled');

function smmEnabledMiddleware(ctx, next) {
    if (!isSmmEnabled()) return;
    return next();
}

module.exports = { smmEnabledMiddleware };
