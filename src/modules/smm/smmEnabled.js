'use strict';

const SmmConfig = require('./smmConfig');

function isSmmEnabled() {
    return SmmConfig.isEnabled();
}

module.exports = { isSmmEnabled };
