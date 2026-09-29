'use strict';

const VirtuoConfig = require('./virtuoConfig');

function isVirtuoEnabled() {
    return VirtuoConfig.isEnabled();
}

module.exports = { isVirtuoEnabled };
