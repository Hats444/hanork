'use strict';

/** Lazy prisma — evita capturar `prisma` antes de database-sqlite anexar smmService/smmOrder. */
function getPrisma() {
    return require('../../../config/database-sqlite').prisma;
}

module.exports = { getPrisma };
