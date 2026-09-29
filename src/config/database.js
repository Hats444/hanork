const sqlite = require('./database-sqlite');
const logger = require('./logger');

// Objeto de compatibilidade com código que usa database.data / database.ensureReady / database.scheduleSave
const database = {
    get data() {
        const db = sqlite.connect();
        return {
            users: db.prepare('SELECT * FROM users').all(),
            products: db.prepare('SELECT * FROM products').all(),
            orders: db.prepare('SELECT * FROM orders').all(),
            orderItems: db.prepare('SELECT * FROM order_items').all(),
        };
    },
    ensureReady() { sqlite.connect(); return Promise.resolve(); },
    scheduleSave() {}, // no-op: SQLite é ACID, salva automaticamente
    flushSave() { return Promise.resolve(); },
    saveData() { return Promise.resolve(); },
};

module.exports = {
    prisma: sqlite.prisma,
    database,
    backup: sqlite.backup,
    migrateFromJSON: sqlite.migrateFromJSON,
    state: sqlite.state,
    testConnection: async () => { sqlite.connect(); logger.info('SQLite OK'); },
};
