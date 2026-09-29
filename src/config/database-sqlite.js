/**
 * database-sqlite.js
 * Banco SQLite com better-sqlite3 — ACID, sem corrupção, sem servidor.
 * Interface idêntica ao database-simple-v2.js para troca transparente.
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');
const { withSqliteRetry } = require('../utils/sqliteRetry');
const {
    ensureDbDirectory,
    applyJournalMode,
    removeWalSidecars,
    isDrvfsPath,
    resolveHanorkDbPath,
    maybeMigrateDrvfsDb,
} = require('../utils/sqliteJournal');

const PROJECT_DB_PATH = path.join(__dirname, '../../hanork.db');
const DB_PATH = resolveHanorkDbPath(PROJECT_DB_PATH);
const BACKUP_DIR = path.join(__dirname, '../../backups');
let BackupManager = null;
try { BackupManager = require('./BackupManager'); } catch (_) { }

/** SQLite só aceita number, string, bigint, buffer, null */
function sqlBindValue(v) {
    if (v === undefined || v === null) return null;
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'bigint') return v;
    if (Buffer.isBuffer(v)) return v;
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
}

function sqlBindRow(obj) {
    return Object.values(obj).map(sqlBindValue);
}

let db;

function connect() {
    if (db) return db;
    maybeMigrateDrvfsDb(PROJECT_DB_PATH, DB_PATH, (msg) => logger.info(msg));
    ensureDbDirectory(DB_PATH);
    if (isDrvfsPath(DB_PATH)) removeWalSidecars(DB_PATH);
    db = new Database(DB_PATH, { verbose: null });
    const journal = applyJournalMode(db, DB_PATH, (msg) => logger.warn(msg));
    if (journal !== 'WAL') removeWalSidecars(DB_PATH);
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    db.pragma(`busy_timeout = ${Math.max(8000, parseInt(process.env.SQLITE_BUSY_TIMEOUT_MS || '15000', 10))}`);
    createTables();
    logger.info(`SQLite database connected: ${DB_PATH} (journal=${journal})`);
    if (BackupManager) {
        BackupManager.setOpenDbProvider(() => db);
        try { BackupManager.startupCheck(); } catch (e) { logger.warn('[BACKUP] startupCheck error: ' + e.message); }
    }
    return db;
}

function createTables() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id TEXT UNIQUE NOT NULL,
            first_name TEXT DEFAULT '',
            last_name TEXT DEFAULT '',
            username TEXT DEFAULT '',
            email TEXT DEFAULT NULL,
            email_verified INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price REAL NOT NULL,
            description TEXT DEFAULT '',
            file_url TEXT DEFAULT '',
            photo TEXT DEFAULT '',
            photo_url TEXT DEFAULT '',
            category TEXT DEFAULT 'geral',
            stock INTEGER DEFAULT 999,
            active INTEGER DEFAULT 1,
            is_subscription INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS orders (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            status TEXT DEFAULT 'CREATED',
            total REAL DEFAULT 0,
            external_reference TEXT,
            payment_id TEXT,
            payment_method TEXT,
            delivered_payment_id TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id TEXT NOT NULL,
            product_id INTEGER,
            quantity INTEGER DEFAULT 1,
            price REAL DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS coupons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            type TEXT DEFAULT 'percent',  -- 'percent' ou 'fixed'
            value REAL NOT NULL,
            max_uses INTEGER DEFAULT 100,
            used INTEGER DEFAULT 0,
            min_total REAL DEFAULT 0,
            active INTEGER DEFAULT 1,
            expires_at TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            order_id TEXT NOT NULL,
            rating INTEGER NOT NULL,
            comment TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS affiliates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER UNIQUE NOT NULL,
            code TEXT UNIQUE NOT NULL,
            referred_count INTEGER DEFAULT 0,
            sales_count INTEGER DEFAULT 0,
            earnings REAL DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS referrals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            affiliate_id INTEGER NOT NULL,
            referred_user_id INTEGER NOT NULL UNIQUE,
            order_id TEXT,
            commission REAL DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS affiliate_withdrawals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            affiliate_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            status TEXT DEFAULT 'pending',
            created_at TEXT DEFAULT (datetime('now')),
            processed_at TEXT,
            admin_note TEXT DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_aff_withdraw_user ON affiliate_withdrawals(user_id);
        CREATE INDEX IF NOT EXISTS idx_aff_withdraw_status ON affiliate_withdrawals(status);

        CREATE INDEX IF NOT EXISTS idx_referrals_affiliate ON referrals(affiliate_id);
        CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_user_id);

        CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
        CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
        CREATE INDEX IF NOT EXISTS idx_orders_ext_ref ON orders(external_reference);
        CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
        CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
        CREATE TABLE IF NOT EXISTS favorites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(user_id, product_id)
        );

        CREATE TABLE IF NOT EXISTS support_tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            telegram_id TEXT NOT NULL,
            message TEXT NOT NULL,
            status TEXT DEFAULT 'open',
            reply TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS ticket_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticket_id INTEGER NOT NULL,
            sender TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );

        -- CARRINHO ABANDONADO
        CREATE TABLE IF NOT EXISTS abandoned_carts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            telegram_id TEXT NOT NULL,
            cart_data TEXT NOT NULL, -- JSON do carrinho
            total REAL DEFAULT 0,
            reminded INTEGER DEFAULT 0, -- 0=não, 1=sim
            coupon_sent TEXT DEFAULT NULL, -- cupom enviado
            created_at TEXT DEFAULT (datetime('now')),
            reminded_at TEXT DEFAULT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_abandoned_user ON abandoned_carts(user_id);
        CREATE INDEX IF NOT EXISTS idx_abandoned_reminded ON abandoned_carts(reminded);

        -- SISTEMA DE PONTOS/FIDELIDADE
        CREATE TABLE IF NOT EXISTS loyalty_points (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER UNIQUE NOT NULL,
            points INTEGER DEFAULT 0,
            total_earned INTEGER DEFAULT 0,
            total_spent INTEGER DEFAULT 0,
            level TEXT DEFAULT 'bronze', -- bronze, silver, gold, platinum, vip
            updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_loyalty_user ON loyalty_points(user_id);

        -- HISTÓRICO DE PONTOS
        CREATE TABLE IF NOT EXISTS points_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL, -- 'earn' ou 'spend'
            points INTEGER NOT NULL,
            description TEXT,
            order_id TEXT DEFAULT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_points_history_user ON points_history(user_id);

        -- NOTIFICAÇÕES ENVIADAS
        CREATE TABLE IF NOT EXISTS notifications_sent (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL, -- 'abandoned_cart', 'flash_sale', 'order_update', etc
            message TEXT,
            sent_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications_sent(user_id);
        CREATE INDEX IF NOT EXISTS idx_ticket_messages ON ticket_messages(ticket_id);

        -- ============================================
        -- 💰 SISTEMA FINANCEIRO COMPLETO
        -- ============================================
        
        -- FLUXO DE CAIXA (Entradas e Saídas)
        CREATE TABLE IF NOT EXISTS cash_flow (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL, -- 'income' (receita) ou 'expense' (despesa)
            category TEXT NOT NULL, -- 'sales', 'affiliate', 'ads', 'tax', 'salary', 'other'
            amount REAL NOT NULL,
            description TEXT,
            order_id TEXT,
            user_id INTEGER,
            payment_method TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_cashflow_type ON cash_flow(type);
        CREATE INDEX IF NOT EXISTS idx_cashflow_category ON cash_flow(category);
        CREATE INDEX IF NOT EXISTS idx_cashflow_date ON cash_flow(created_at);

        -- METAS DE VENDAS
        CREATE TABLE IF NOT EXISTS sales_goals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            period TEXT NOT NULL, -- 'daily', 'weekly', 'monthly', 'yearly'
            goal_amount REAL NOT NULL,
            goal_orders INTEGER DEFAULT 0,
            achieved_amount REAL DEFAULT 0,
            achieved_orders INTEGER DEFAULT 0,
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            completed INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_goals_period ON sales_goals(period);
        CREATE INDEX IF NOT EXISTS idx_goals_dates ON sales_goals(start_date, end_date);

        -- ASSINATURAS/RECORRÊNCIA
        CREATE TABLE IF NOT EXISTS subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            telegram_id TEXT NOT NULL,
            plan_name TEXT NOT NULL,
            plan_value REAL NOT NULL,
            billing_cycle TEXT DEFAULT 'monthly', -- 'weekly', 'monthly', 'yearly'
            status TEXT DEFAULT 'active', -- 'active', 'paused', 'cancelled', 'expired'
            last_payment_date TEXT,
            next_payment_date TEXT,
            total_payments INTEGER DEFAULT 0,
            total_paid REAL DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            cancelled_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions(user_id);
        CREATE INDEX IF NOT EXISTS idx_subs_status ON subscriptions(status);
        CREATE INDEX IF NOT EXISTS idx_subs_next_payment ON subscriptions(next_payment_date);

        -- CASHBACK
        CREATE TABLE IF NOT EXISTS cashback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            order_id TEXT,
            purchase_amount REAL NOT NULL,
            cashback_percent REAL DEFAULT 5,
            cashback_amount REAL NOT NULL,
            status TEXT DEFAULT 'pending', -- 'pending', 'available', 'used', 'expired'
            available_date TEXT,
            used_date TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_cashback_user ON cashback(user_id);
        CREATE INDEX IF NOT EXISTS idx_cashback_status ON cashback(status);

        -- SORTEIOS/CAMPANHAS PROMOCIONAIS
        CREATE TABLE IF NOT EXISTS giveaways (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            prize TEXT NOT NULL,
            prize_value REAL,
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            draw_date TEXT,
            min_purchase REAL DEFAULT 0,
            winner_id INTEGER,
            status TEXT DEFAULT 'active', -- 'active', 'completed', 'cancelled'
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_giveaways_status ON giveaways(status);
        CREATE INDEX IF NOT EXISTS idx_giveaways_dates ON giveaways(start_date, end_date);

        -- PARTICIPANTES DOS SORTEIOS
        CREATE TABLE IF NOT EXISTS giveaway_participants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            giveaway_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            tickets INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_giveaway_part ON giveaway_participants(giveaway_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_giveaway_user ON giveaway_participants(giveaway_id, user_id);

        -- CONFIGURAÇÕES FINANCEIRAS
        CREATE TABLE IF NOT EXISTS financial_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS spam_bans (
            user_id INTEGER PRIMARY KEY,
            ban_count INTEGER DEFAULT 0,
            expiry INTEGER DEFAULT 0,
            permanent INTEGER DEFAULT 0,
            updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_spam_bans_permanent ON spam_bans(permanent);

        -- DEDUPLICAÇÃO DE WEBHOOKS (Idempotência - 3ª linha de defesa)
        CREATE TABLE IF NOT EXISTS processed_webhooks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            payment_id TEXT UNIQUE NOT NULL,
            order_id TEXT,
            processed_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_webhooks_payment ON processed_webhooks(payment_id);
        CREATE INDEX IF NOT EXISTS idx_webhooks_processed ON processed_webhooks(processed_at);

        CREATE TABLE IF NOT EXISTS flash_sales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            sale_price REAL NOT NULL,
            original_price REAL NOT NULL,
            ends_at TEXT NOT NULL,
            active INTEGER DEFAULT 1,
            stock_limit INTEGER DEFAULT 0,
            sold_count INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS restock_notify (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            telegram_id TEXT NOT NULL,
            notified INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(user_id, product_id)
        );

        CREATE TABLE IF NOT EXISTS kv_store (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
        CREATE INDEX IF NOT EXISTS idx_affiliates_code ON affiliates(code);
        CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
        CREATE INDEX IF NOT EXISTS idx_tickets_status ON support_tickets(status);
        CREATE INDEX IF NOT EXISTS idx_flash_sales_product ON flash_sales(product_id);
        CREATE INDEX IF NOT EXISTS idx_restock_product ON restock_notify(product_id);

        -- =====================================================
        -- TABELAS DE ESTADO PERSISTENTE (sem cache em memória)
        -- =====================================================

        -- Carrinhos ativos (substitui Map carrinhos)
        CREATE TABLE IF NOT EXISTS active_carts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            telegram_id TEXT NOT NULL,
            product_id INTEGER NOT NULL,
            product_name TEXT NOT NULL,
            product_price REAL NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 1,
            added_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            UNIQUE(user_id, product_id)
        );
        CREATE INDEX IF NOT EXISTS idx_active_carts_user ON active_carts(user_id);
        CREATE INDEX IF NOT EXISTS idx_active_carts_telegram ON active_carts(telegram_id);

        -- Compras pendentes (substitui Map comprasPendentes)
        CREATE TABLE IF NOT EXISTS pending_purchases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            telegram_id TEXT NOT NULL,
            order_id TEXT UNIQUE NOT NULL,
            total REAL NOT NULL,
            payment_method TEXT NOT NULL,
            payment_id TEXT,
            status TEXT DEFAULT 'PENDING',
            pix_qr_code TEXT,
            pix_expiration TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_pending_purchases_user ON pending_purchases(user_id);
        CREATE INDEX IF NOT EXISTS idx_pending_purchases_order ON pending_purchases(order_id);
        CREATE INDEX IF NOT EXISTS idx_pending_purchases_status ON pending_purchases(status);

        -- Cupons aplicados (substitui Map cuponsAplicados)
        CREATE TABLE IF NOT EXISTS applied_coupons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            telegram_id TEXT NOT NULL,
            coupon_code TEXT NOT NULL,
            discount_type TEXT NOT NULL,
            discount_value REAL NOT NULL,
            original_total REAL NOT NULL,
            final_total REAL NOT NULL,
            applied_at TEXT DEFAULT (datetime('now')),
            expires_at TEXT,
            UNIQUE(user_id, coupon_code)
        );
        CREATE INDEX IF NOT EXISTS idx_applied_coupons_user ON applied_coupons(user_id);
        CREATE INDEX IF NOT EXISTS idx_applied_coupons_code ON applied_coupons(coupon_code);

        -- Sessões de usuário/wizard (substitui Maps de estado)
        CREATE TABLE IF NOT EXISTS user_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            telegram_id TEXT NOT NULL,
            session_type TEXT NOT NULL,
            session_data TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            expires_at TEXT NOT NULL,
            UNIQUE(user_id, session_type)
        );
        CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_user_sessions_type ON user_sessions(session_type);
        CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);

        -- Cooldowns de checkout (substitui Map checkoutCooldowns)
        CREATE TABLE IF NOT EXISTS checkout_cooldowns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            telegram_id TEXT NOT NULL,
            last_checkout_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_checkout_cooldowns_expires ON checkout_cooldowns(expires_at);

        -- Rastreamento de últimas mensagens de menu (substitui lastMenuMsg)
        CREATE TABLE IF NOT EXISTS last_menu_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT NOT NULL UNIQUE,
            message_id INTEGER NOT NULL,
            menu_type TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_last_menu_chat ON last_menu_messages(chat_id);

        -- Notificações enviadas (persistente)
        CREATE TABLE IF NOT EXISTS user_notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            telegram_id TEXT NOT NULL,
            notification_type TEXT NOT NULL,
            related_id TEXT,
            sent_at TEXT DEFAULT (datetime('now')),
            UNIQUE(user_id, notification_type, related_id)
        );
        CREATE INDEX IF NOT EXISTS idx_notifications_user ON user_notifications(user_id);
        CREATE INDEX IF NOT EXISTS idx_notifications_type ON user_notifications(notification_type);

        -- =====================================================
        -- GRUPOS TELEGRAM E MEMBROS
        -- =====================================================
        CREATE TABLE IF NOT EXISTS telegram_groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT UNIQUE NOT NULL,
            title TEXT NOT NULL,
            type TEXT NOT NULL,              -- 'group' ou 'supergroup'
            username TEXT DEFAULT NULL,
            member_count INTEGER DEFAULT 0,
            bot_is_admin INTEGER DEFAULT 0,
            joined_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            active INTEGER DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS idx_telegram_groups_chat ON telegram_groups(chat_id);
        CREATE INDEX IF NOT EXISTS idx_telegram_groups_active ON telegram_groups(active);

        CREATE TABLE IF NOT EXISTS group_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_chat_id TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            telegram_id TEXT NOT NULL,
            username TEXT DEFAULT NULL,
            first_name TEXT DEFAULT NULL,
            role TEXT DEFAULT 'member',      -- 'member', 'admin', 'creator'
            joined_at TEXT DEFAULT (datetime('now')),
            last_seen_at TEXT DEFAULT (datetime('now')),
            active INTEGER DEFAULT 1,
            UNIQUE(group_chat_id, telegram_id)
        );
        CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_chat_id);
        CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(telegram_id);
        CREATE INDEX IF NOT EXISTS idx_group_members_active ON group_members(active);

        -- =====================================================
        -- MULTI-TENANCY: lojistas e planos SaaS
        -- =====================================================
        CREATE TABLE IF NOT EXISTS tenants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slug TEXT UNIQUE NOT NULL,                   -- identificador único ex: "loja-abc"
            name TEXT NOT NULL,                          -- nome da loja
            owner_telegram_id TEXT NOT NULL,             -- telegram_id do dono
            token_telegram TEXT DEFAULT NULL,            -- bot token próprio (futuro)
            token_mp TEXT DEFAULT NULL,                  -- token MercadoPago próprio
            mp_payer_email TEXT DEFAULT NULL,            -- email padrão para PIX
            plan TEXT DEFAULT 'free',                    -- 'free' | 'pro' | 'business'
            plan_expires_at TEXT DEFAULT NULL,
            onboarding_step INTEGER DEFAULT 0,           -- etapa do wizard de cadastro
            onboarding_done INTEGER DEFAULT 0,
            active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
        CREATE INDEX IF NOT EXISTS idx_tenants_owner ON tenants(owner_telegram_id);
        CREATE INDEX IF NOT EXISTS idx_tenants_active ON tenants(active);

        CREATE TABLE IF NOT EXISTS tenant_plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,                   -- 'free' | 'pro' | 'business'
            label TEXT NOT NULL,                         -- exibição
            price REAL DEFAULT 0,                        -- preço mensal em R$
            max_products INTEGER DEFAULT 5,
            max_orders_month INTEGER DEFAULT 50,
            max_broadcasts_month INTEGER DEFAULT 2,
            allow_affiliates INTEGER DEFAULT 0,
            allow_ai INTEGER DEFAULT 0,
            allow_flash_sale INTEGER DEFAULT 0,
            allow_subscriptions INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );

        -- Log de auditoria (para debugging e rastreamento)
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            telegram_id TEXT,
            action TEXT NOT NULL,
            entity_type TEXT,
            entity_id TEXT,
            old_value TEXT,
            new_value TEXT,
            metadata TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
    `);

    // Migrações incrementais — colunas adicionadas em versões posteriores
    const migrations = [
        // Grupos
        `CREATE TABLE IF NOT EXISTS telegram_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT UNIQUE NOT NULL, title TEXT NOT NULL, type TEXT NOT NULL, username TEXT DEFAULT NULL, member_count INTEGER DEFAULT 0, bot_is_admin INTEGER DEFAULT 0, joined_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), active INTEGER DEFAULT 1)`,
        `CREATE TABLE IF NOT EXISTS group_members (id INTEGER PRIMARY KEY AUTOINCREMENT, group_chat_id TEXT NOT NULL, user_id INTEGER NOT NULL, telegram_id TEXT NOT NULL, username TEXT DEFAULT NULL, first_name TEXT DEFAULT NULL, role TEXT DEFAULT 'member', joined_at TEXT DEFAULT (datetime('now')), last_seen_at TEXT DEFAULT (datetime('now')), active INTEGER DEFAULT 1, UNIQUE(group_chat_id, telegram_id))`,
        'ALTER TABLE flash_sales ADD COLUMN stock_limit INTEGER DEFAULT 0',
        'ALTER TABLE flash_sales ADD COLUMN sold_count INTEGER DEFAULT 0',
        'ALTER TABLE orders ADD COLUMN post_sale_due TEXT',
        'ALTER TABLE orders ADD COLUMN post_sale_sent INTEGER DEFAULT 0',
        'ALTER TABLE orders ADD COLUMN delivered_payment_id TEXT',
        'ALTER TABLE spam_bans ADD COLUMN telegram_id TEXT DEFAULT NULL',
        'ALTER TABLE spam_bans ADD COLUMN reason TEXT DEFAULT NULL',
        'ALTER TABLE spam_bans ADD COLUMN expires_at TEXT DEFAULT NULL',
        'ALTER TABLE spam_bans ADD COLUMN banned_at TEXT DEFAULT (datetime(\'now\'))',
        'ALTER TABLE spam_bans ADD COLUMN violation_code TEXT DEFAULT NULL',
        'ALTER TABLE orders ADD COLUMN paid_at TEXT DEFAULT NULL',
        'ALTER TABLE orders ADD COLUMN delivered_at TEXT DEFAULT NULL',
        'ALTER TABLE orders ADD COLUMN error_message TEXT DEFAULT NULL',
        'ALTER TABLE orders ADD COLUMN coupon_code TEXT DEFAULT NULL',
        'ALTER TABLE orders ADD COLUMN discount REAL DEFAULT 0',
        'ALTER TABLE virtuo_orders ADD COLUMN user_notified INTEGER NOT NULL DEFAULT 0',
        'ALTER TABLE virtuo_orders ADD COLUMN phone_assigned_at TEXT DEFAULT NULL',
        // Multi-tenancy
        `CREATE TABLE IF NOT EXISTS tenants (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, owner_telegram_id TEXT NOT NULL, token_telegram TEXT DEFAULT NULL, token_mp TEXT DEFAULT NULL, mp_payer_email TEXT DEFAULT NULL, plan TEXT DEFAULT 'free', plan_expires_at TEXT DEFAULT NULL, onboarding_step INTEGER DEFAULT 0, onboarding_done INTEGER DEFAULT 0, active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`,
        `CREATE TABLE IF NOT EXISTS tenant_plans (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, label TEXT NOT NULL, price REAL DEFAULT 0, max_products INTEGER DEFAULT 5, max_orders_month INTEGER DEFAULT 50, max_broadcasts_month INTEGER DEFAULT 2, allow_affiliates INTEGER DEFAULT 0, allow_ai INTEGER DEFAULT 0, allow_flash_sale INTEGER DEFAULT 0, allow_subscriptions INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`,
        `CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug)`,
        `CREATE INDEX IF NOT EXISTS idx_tenants_owner ON tenants(owner_telegram_id)`,
        // Tenant isolation - adicionar tenant_id em todas as tabelas de dados
        'ALTER TABLE users ADD COLUMN tenant_id INTEGER DEFAULT NULL',
        'ALTER TABLE users ADD COLUMN updated_at TEXT DEFAULT NULL',
        'ALTER TABLE users ADD COLUMN is_premium INTEGER DEFAULT 0',
        'ALTER TABLE users ADD COLUMN email TEXT DEFAULT NULL',
        'ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0',
        'ALTER TABLE users ADD COLUMN language_code TEXT DEFAULT NULL',
        'ALTER TABLE users ADD COLUMN photo_file_id TEXT DEFAULT NULL',
        'ALTER TABLE products ADD COLUMN tenant_id INTEGER DEFAULT NULL',
        'ALTER TABLE orders ADD COLUMN tenant_id INTEGER DEFAULT NULL',
        'ALTER TABLE order_items ADD COLUMN tenant_id INTEGER DEFAULT NULL',
        'ALTER TABLE coupons ADD COLUMN tenant_id INTEGER DEFAULT NULL',
        'ALTER TABLE reviews ADD COLUMN tenant_id INTEGER DEFAULT NULL',
        'ALTER TABLE affiliates ADD COLUMN tenant_id INTEGER DEFAULT NULL',
        'ALTER TABLE referrals ADD COLUMN tenant_id INTEGER DEFAULT NULL',
        'ALTER TABLE favorites ADD COLUMN tenant_id INTEGER DEFAULT NULL',
        'ALTER TABLE support_tickets ADD COLUMN tenant_id INTEGER DEFAULT NULL',
        'ALTER TABLE ticket_messages ADD COLUMN tenant_id INTEGER DEFAULT NULL',
        'ALTER TABLE abandoned_carts ADD COLUMN tenant_id INTEGER DEFAULT NULL',
        'ALTER TABLE loyalty_points ADD COLUMN tenant_id INTEGER DEFAULT NULL',
        'ALTER TABLE points_history ADD COLUMN tenant_id INTEGER DEFAULT NULL',
        'ALTER TABLE notifications_sent ADD COLUMN tenant_id INTEGER DEFAULT NULL',
        'ALTER TABLE cash_flow ADD COLUMN tenant_id INTEGER DEFAULT NULL',
        'ALTER TABLE sales_goals ADD COLUMN tenant_id INTEGER DEFAULT NULL',
        'ALTER TABLE subscriptions ADD COLUMN tenant_id INTEGER DEFAULT NULL',
        'ALTER TABLE cashback ADD COLUMN tenant_id INTEGER DEFAULT NULL',
        'ALTER TABLE giveaways ADD COLUMN tenant_id INTEGER DEFAULT NULL',
        'ALTER TABLE giveaway_participants ADD COLUMN tenant_id INTEGER DEFAULT NULL',
        'ALTER TABLE flash_sales ADD COLUMN tenant_id INTEGER DEFAULT NULL',
        'ALTER TABLE smm_services ADD COLUMN service_family TEXT DEFAULT NULL',
        'ALTER TABLE smm_services ADD COLUMN service_score REAL NOT NULL DEFAULT 0',
        'CREATE INDEX IF NOT EXISTS idx_smm_services_family ON smm_services(service_family, active)',
        "ALTER TABLE smm_services ADD COLUMN service_health TEXT NOT NULL DEFAULT 'HEALTHY'",
        'CREATE INDEX IF NOT EXISTS idx_smm_services_health ON smm_services(service_health, active)',
        'ALTER TABLE restock_notify ADD COLUMN tenant_id INTEGER DEFAULT NULL',
        'ALTER TABLE active_carts ADD COLUMN tenant_id INTEGER DEFAULT NULL',
        'ALTER TABLE pending_purchases ADD COLUMN tenant_id INTEGER DEFAULT NULL',
        'ALTER TABLE applied_coupons ADD COLUMN tenant_id INTEGER DEFAULT NULL',
        'ALTER TABLE user_sessions ADD COLUMN tenant_id INTEGER DEFAULT NULL',
        'ALTER TABLE checkout_cooldowns ADD COLUMN tenant_id INTEGER DEFAULT NULL',
        'ALTER TABLE last_menu_messages ADD COLUMN tenant_id INTEGER DEFAULT NULL',
        'ALTER TABLE last_menu_messages ADD COLUMN message_type TEXT DEFAULT \'text\'',
        'ALTER TABLE last_menu_messages ADD COLUMN text_preview TEXT DEFAULT NULL',
        'ALTER TABLE user_notifications ADD COLUMN tenant_id INTEGER DEFAULT NULL',
        'ALTER TABLE telegram_groups ADD COLUMN tenant_id INTEGER DEFAULT NULL',
        'ALTER TABLE telegram_groups ADD COLUMN broadcast_enabled INTEGER DEFAULT 1',
        'ALTER TABLE telegram_groups ADD COLUMN promo_via_bridge INTEGER DEFAULT 0',
        'ALTER TABLE group_members ADD COLUMN tenant_id INTEGER DEFAULT NULL',
        'ALTER TABLE audit_logs ADD COLUMN tenant_id INTEGER DEFAULT NULL',
        'ALTER TABLE spam_bans ADD COLUMN tenant_id INTEGER DEFAULT NULL',
        'ALTER TABLE processed_webhooks ADD COLUMN tenant_id INTEGER DEFAULT NULL',
        // Índices para tenant_id (performance)
        'CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_products_tenant ON products(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_order_items_tenant ON order_items(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_coupons_tenant ON coupons(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_reviews_tenant ON reviews(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_affiliates_tenant ON affiliates(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_referrals_tenant ON referrals(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_favorites_tenant ON favorites(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant ON support_tickets(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_abandoned_carts_tenant ON abandoned_carts(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_cashback_tenant ON cashback(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_flash_sales_tenant ON flash_sales(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_giveaways_tenant ON giveaways(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant ON subscriptions(tenant_id)',
        // Fase 2 SaaS — índices tenant_id faltantes (sem alterar schema)
        'CREATE INDEX IF NOT EXISTS idx_ticket_messages_tenant ON ticket_messages(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_loyalty_points_tenant ON loyalty_points(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_points_history_tenant ON points_history(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_notifications_sent_tenant ON notifications_sent(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_cash_flow_tenant ON cash_flow(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_sales_goals_tenant ON sales_goals(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_giveaway_participants_tenant ON giveaway_participants(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_restock_notify_tenant ON restock_notify(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_active_carts_tenant ON active_carts(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_pending_purchases_tenant ON pending_purchases(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_applied_coupons_tenant ON applied_coupons(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_user_sessions_tenant ON user_sessions(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_checkout_cooldowns_tenant ON checkout_cooldowns(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_last_menu_messages_tenant ON last_menu_messages(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_user_notifications_tenant ON user_notifications(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_telegram_groups_tenant ON telegram_groups(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_group_members_tenant ON group_members(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_spam_bans_tenant ON spam_bans(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_processed_webhooks_tenant ON processed_webhooks(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_tenant ON affiliate_commissions(tenant_id)',
        "ALTER TABLE smm_orders ADD COLUMN provider_used TEXT DEFAULT NULL",
        "ALTER TABLE smm_orders ADD COLUMN provider_comments TEXT DEFAULT NULL",
        `CREATE TABLE IF NOT EXISTS user_wallet (
            user_id INTEGER PRIMARY KEY,
            balance REAL NOT NULL DEFAULT 0,
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )`,
        `CREATE TABLE IF NOT EXISTS user_wallet_ledger (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            order_id TEXT,
            amount REAL NOT NULL,
            direction TEXT NOT NULL,
            reason TEXT,
            balance_after REAL,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )`,
        'CREATE INDEX IF NOT EXISTS idx_wallet_ledger_user ON user_wallet_ledger(user_id)',
        'CREATE INDEX IF NOT EXISTS idx_wallet_ledger_order ON user_wallet_ledger(order_id)',
    ];
    for (const sql of migrations) {
        try { db.exec(sql); } catch (_) { /* coluna já existe — ignorar */ }
    }
    // Criar tabela kv_store se não existir (para timestamps de reenvio e outros KV)
    try {
        db.exec(`CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT DEFAULT (datetime('now')))`);
    } catch (_) { }
    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS affiliate_commissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                affiliate_id INTEGER NOT NULL,
                referred_user_id INTEGER NOT NULL,
                order_id TEXT NOT NULL UNIQUE,
                commission REAL NOT NULL DEFAULT 0,
                tenant_id INTEGER DEFAULT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_aff_comm_affiliate ON affiliate_commissions(affiliate_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_aff_comm_referred ON affiliate_commissions(referred_user_id)`);
        db.exec(`
            INSERT OR IGNORE INTO affiliate_commissions (affiliate_id, referred_user_id, order_id, commission, tenant_id, created_at)
            SELECT r.affiliate_id, r.referred_user_id, r.order_id, r.commission, r.tenant_id, r.created_at
            FROM referrals r
            WHERE r.order_id IS NOT NULL AND r.commission > 0
        `);
    } catch (_) { }
    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS bridge_join_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                link TEXT UNIQUE NOT NULL,
                status TEXT DEFAULT 'pending',
                source TEXT DEFAULT '',
                chat_id TEXT DEFAULT NULL,
                fail_reason TEXT DEFAULT NULL,
                attempts INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_bridge_join_queue_status ON bridge_join_queue(status)`);
    } catch (_) { }
    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS campaigns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT NOT NULL UNIQUE,
                campaign_type TEXT NOT NULL,
                channel TEXT NOT NULL,
                slot_hour INTEGER,
                interval_hours INTEGER,
                active INTEGER DEFAULT 1,
                content_ref TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )
        `);
        db.exec(`
            CREATE TABLE IF NOT EXISTS campaign_deliveries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                campaign_id INTEGER,
                campaign_type TEXT NOT NULL,
                channel TEXT NOT NULL,
                dest_type TEXT NOT NULL,
                dest_id TEXT NOT NULL,
                day_key TEXT NOT NULL,
                slot_key TEXT,
                status TEXT NOT NULL,
                message_id TEXT,
                delivered_at TEXT DEFAULT (datetime('now')),
                meta_json TEXT
            )
        `);
        db.exec(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_deliveries_dedup
            ON campaign_deliveries(dest_type, dest_id, campaign_type, channel, day_key, COALESCE(slot_key, ''))
        `);
        db.exec(`
            CREATE TABLE IF NOT EXISTS campaign_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                slot_key TEXT NOT NULL,
                campaign_type TEXT NOT NULL,
                channel TEXT NOT NULL,
                started_at TEXT,
                finished_at TEXT,
                stats_json TEXT,
                source TEXT
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_campaign_history_slot ON campaign_history(slot_key)`);
        db.exec(`
            CREATE TABLE IF NOT EXISTS campaign_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                idempotency_key TEXT NOT NULL UNIQUE,
                campaign_type TEXT NOT NULL,
                channel TEXT NOT NULL,
                run_at_ms INTEGER NOT NULL,
                payload_json TEXT,
                status TEXT DEFAULT 'pending',
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_campaign_queue_run ON campaign_queue(status, run_at_ms)`);
    } catch (_) { }
    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS wa_admin_audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id TEXT NOT NULL,
                command TEXT NOT NULL,
                command_id TEXT,
                args_json TEXT,
                ok INTEGER DEFAULT 0,
                result_json TEXT,
                error TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_wa_admin_audit_tid ON wa_admin_audit(telegram_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_wa_admin_audit_cmd ON wa_admin_audit(command)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_wa_admin_audit_at ON wa_admin_audit(created_at)`);
    } catch (_) { }
    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS telegram_event_audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                route TEXT NOT NULL,
                route_executed TEXT,
                chat_id TEXT,
                chat_type TEXT,
                chat_title TEXT,
                user_id TEXT,
                username TEXT,
                first_name TEXT,
                message_id INTEGER,
                message_text TEXT,
                callback_data TEXT,
                skip_user_pipeline INTEGER DEFAULT 0,
                is_real_user_message INTEGER DEFAULT 0,
                is_private INTEGER DEFAULT 0,
                is_group INTEGER DEFAULT 0,
                is_supergroup INTEGER DEFAULT 0,
                is_channel INTEGER DEFAULT 0,
                is_debug INTEGER DEFAULT 0,
                event_ts INTEGER,
                created_at TEXT DEFAULT (datetime('now'))
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_tg_event_audit_type ON telegram_event_audit(event_type)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_tg_event_audit_chat ON telegram_event_audit(chat_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_tg_event_audit_user ON telegram_event_audit(user_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_tg_event_audit_ts ON telegram_event_audit(created_at)`);
    } catch (_) { }
    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS smm_services (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                provider TEXT NOT NULL DEFAULT 'fornecedorbrasil',
                provider_service_id INTEGER NOT NULL,
                platform TEXT NOT NULL DEFAULT 'Outros',
                subcategory TEXT NOT NULL DEFAULT 'Outros',
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                service_type TEXT DEFAULT 'Default',
                category_raw TEXT DEFAULT '',
                cost_price REAL NOT NULL DEFAULT 0,
                sale_price REAL NOT NULL DEFAULT 0,
                min_quantity INTEGER NOT NULL DEFAULT 1,
                max_quantity INTEGER NOT NULL DEFAULT 1000000,
                refill INTEGER NOT NULL DEFAULT 0,
                cancel INTEGER NOT NULL DEFAULT 0,
                dripfeed INTEGER NOT NULL DEFAULT 0,
                active INTEGER NOT NULL DEFAULT 1,
                service_family TEXT DEFAULT NULL,
                service_score REAL NOT NULL DEFAULT 0,
                service_health TEXT NOT NULL DEFAULT 'HEALTHY',
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now')),
                UNIQUE(provider, provider_service_id)
            )
        `);
        db.exec(`
            CREATE TABLE IF NOT EXISTS smm_orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id TEXT NOT NULL,
                hanork_order_id TEXT DEFAULT NULL,
                provider TEXT NOT NULL DEFAULT 'fornecedorbrasil',
                provider_order_id TEXT DEFAULT NULL,
                service_id INTEGER NOT NULL,
                link TEXT NOT NULL DEFAULT '',
                quantity INTEGER NOT NULL DEFAULT 0,
                cost REAL NOT NULL DEFAULT 0,
                sale_price REAL NOT NULL DEFAULT 0,
                profit REAL NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'pending',
                refill_id TEXT DEFAULT NULL,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )
        `);
        db.exec(`
            CREATE TABLE IF NOT EXISTS smm_price_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                service_id INTEGER NOT NULL,
                old_price REAL NOT NULL,
                new_price REAL NOT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            )
        `);
        db.exec(`
            CREATE TABLE IF NOT EXISTS smm_sync_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sync_type TEXT NOT NULL DEFAULT 'full',
                total_processed INTEGER NOT NULL DEFAULT 0,
                created_count INTEGER NOT NULL DEFAULT 0,
                updated_count INTEGER NOT NULL DEFAULT 0,
                removed_count INTEGER NOT NULL DEFAULT 0,
                balance_snapshot TEXT DEFAULT NULL,
                error_message TEXT DEFAULT NULL,
                finished_at TEXT DEFAULT (datetime('now'))
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_smm_services_platform ON smm_services(platform, subcategory, active)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_smm_services_active ON smm_services(active)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_smm_services_family ON smm_services(service_family, active)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_smm_orders_telegram ON smm_orders(telegram_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_smm_orders_hanork ON smm_orders(hanork_order_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_smm_orders_status ON smm_orders(status)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_smm_orders_provider ON smm_orders(provider_order_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_smm_price_history_service ON smm_price_history(service_id)`);
        db.exec(`
            CREATE TABLE IF NOT EXISTS smm_order_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                smm_order_id INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                detail TEXT DEFAULT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_smm_order_events_order ON smm_order_events(smm_order_id)`);
        db.exec(`
            CREATE TABLE IF NOT EXISTS virtuo_services (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                service_code TEXT NOT NULL,
                service_name TEXT NOT NULL,
                country_id INTEGER NOT NULL,
                country_name TEXT NOT NULL,
                cost_price REAL NOT NULL DEFAULT 0,
                sale_price REAL NOT NULL DEFAULT 0,
                available INTEGER NOT NULL DEFAULT 0,
                server INTEGER NOT NULL DEFAULT 1,
                active INTEGER NOT NULL DEFAULT 1,
                synced_at TEXT DEFAULT (datetime('now')),
                UNIQUE(service_code, country_id, server)
            )
        `);
        db.exec(`
            CREATE TABLE IF NOT EXISTS virtuo_orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id TEXT NOT NULL,
                hanork_order_id TEXT DEFAULT NULL,
                virtuo_service_id INTEGER NOT NULL,
                service_code TEXT NOT NULL,
                country_id INTEGER NOT NULL,
                service_name TEXT NOT NULL DEFAULT '',
                country_name TEXT NOT NULL DEFAULT '',
                virtuo_order_id TEXT DEFAULT NULL,
                phone TEXT DEFAULT NULL,
                sms_code TEXT DEFAULT NULL,
                cost REAL NOT NULL DEFAULT 0,
                sale_price REAL NOT NULL DEFAULT 0,
                profit REAL NOT NULL DEFAULT 0,
                server INTEGER NOT NULL DEFAULT 1,
                status TEXT NOT NULL DEFAULT 'awaiting_payment',
                provider_status TEXT DEFAULT NULL,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_virtuo_services_code ON virtuo_services(service_code, active)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_virtuo_orders_telegram ON virtuo_orders(telegram_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_virtuo_orders_hanork ON virtuo_orders(hanork_order_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_virtuo_orders_status ON virtuo_orders(status)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_virtuo_orders_provider ON virtuo_orders(virtuo_order_id)`);
    } catch (_) { }
    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS conversion_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                event_name TEXT NOT NULL,
                event_data TEXT DEFAULT '{}',
                tenant_id INTEGER DEFAULT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_conversion_events_user ON conversion_events(user_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_conversion_events_name ON conversion_events(event_name)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_conversion_events_created ON conversion_events(created_at)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_conversion_events_user_event ON conversion_events(user_id, event_name)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_conversion_events_tenant ON conversion_events(tenant_id)`);
    } catch (_) { }
    try {
        db.exec(
            `CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_delivered_payment ON orders(delivered_payment_id) WHERE delivered_payment_id IS NOT NULL`
        );
    } catch (_) { /* índice já existe ou tabela antiga — ignorar */ }

    // Índices de performance adicionais
    const perfIndexes = [
        // kv_store: busca por prefixo (cashback, sessions, etc)
        `CREATE INDEX IF NOT EXISTS idx_kv_store_key ON kv_store(key)`,
        `CREATE INDEX IF NOT EXISTS idx_kv_store_updated ON kv_store(updated_at)`,
        // orders: busca por data e status (dashboard, analytics)
        `CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at)`,
        `CREATE INDEX IF NOT EXISTS idx_orders_paid_at ON orders(paid_at)`,
        `CREATE INDEX IF NOT EXISTS idx_orders_user_status ON orders(user_id, status)`,
        // products: busca ativa + categoria
        `CREATE INDEX IF NOT EXISTS idx_products_active_cat ON products(active, category)`,
        // pending_purchases: limpeza de expirados
        `CREATE INDEX IF NOT EXISTS idx_pending_status_created ON pending_purchases(status, created_at)`,
        // audit_logs: tenant_id para multi-tenancy
        `CREATE INDEX IF NOT EXISTS idx_audit_telegram ON audit_logs(telegram_id)`,
        // cashback: lookup por user + status
        `CREATE INDEX IF NOT EXISTS idx_cashback_user_status ON cashback(user_id, status)`,
        // group_members: ativo por grupo
        `CREATE INDEX IF NOT EXISTS idx_group_members_group_active ON group_members(group_chat_id, active)`,
        // last_menu_messages: lookup rápido por chat
        `CREATE INDEX IF NOT EXISTS idx_last_menu_chat ON last_menu_messages(chat_id)`,
        // spam_bans: lookup por user_id + permanent
        `CREATE INDEX IF NOT EXISTS idx_spam_bans_user ON spam_bans(user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_spam_bans_permanent ON spam_bans(permanent)`,
        // telegram_groups: grupos ativos por membro
        `CREATE INDEX IF NOT EXISTS idx_tg_groups_active ON telegram_groups(active)`,
        // users: lookup por telegram_id (query mais comum do sistema)
        `CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id)`,
        // orders: lookup por external_reference (webhook de pagamento)
        `CREATE INDEX IF NOT EXISTS idx_orders_ext_ref ON orders(external_reference)`,
        // reviews: uma avaliação por pedido
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_order_id ON reviews(order_id)`,
        // conversion_events: funil e analytics
        `CREATE INDEX IF NOT EXISTS idx_conversion_events_name_created ON conversion_events(event_name, created_at)`,
    ];
    for (const sql of perfIndexes) {
        try { db.exec(sql); } catch (_) { /* já existe */ }
    }

    // Migration: garantir UNIQUE(referred_user_id) na tabela referrals
    try {
        const hasUnique = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='referrals'").get();
        if (hasUnique && !hasUnique.sql.includes('UNIQUE')) {
            db.exec(`
                BEGIN;
                -- Remove duplicatas mantendo apenas o mais antigo por referred_user_id
                DELETE FROM referrals WHERE id NOT IN (
                    SELECT MIN(id) FROM referrals GROUP BY referred_user_id
                );
                -- Recria tabela com UNIQUE
                CREATE TABLE referrals_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    affiliate_id INTEGER NOT NULL,
                    referred_user_id INTEGER NOT NULL UNIQUE,
                    order_id TEXT,
                    commission REAL DEFAULT 0,
                    created_at TEXT DEFAULT (datetime('now'))
                );
                INSERT INTO referrals_new SELECT * FROM referrals;
                DROP TABLE referrals;
                ALTER TABLE referrals_new RENAME TO referrals;
                CREATE INDEX IF NOT EXISTS idx_referrals_affiliate ON referrals(affiliate_id);
                CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_user_id);
                COMMIT;
            `);
        }
    } catch (_) { }

    // Migration: adicionar is_subscription em bancos existentes
    try {
        const cols = db.prepare("PRAGMA table_info(products)").all();
        if (!cols.find(c => c.name === 'is_subscription')) {
            db.exec(`ALTER TABLE products ADD COLUMN is_subscription INTEGER DEFAULT 0`);
            logger.info('[DB] Migration: coluna is_subscription adicionada em products');
        }
    } catch (_) { }

    // Seed: planos padrão SaaS (idempotente via INSERT OR IGNORE)
    try {
        const seedPlans = db.prepare(`INSERT OR IGNORE INTO tenant_plans (name, label, price, max_products, max_orders_month, max_broadcasts_month, allow_affiliates, allow_ai, allow_flash_sale, allow_subscriptions) VALUES (?,?,?,?,?,?,?,?,?,?)`);
        const seedMany = db.transaction((plans) => { for (const p of plans) seedPlans.run(...p); });
        seedMany([
            ['free', 'Grátis', 0, 5, 50, 2, 0, 0, 0, 0],
            ['pro', 'Pro', 49.90, 50, 500, 10, 1, 1, 1, 0],
            ['business', 'Business', 99.90, 999, 9999, 99, 1, 1, 1, 1],
        ]);
    } catch (_) { }
}

// ─── MIGRATION: importar dados do JSON antigo ──────────────────────────────
function migrateFromJSON() {
    const jsonPath = path.join(__dirname, '../../database.json');
    if (!fs.existsSync(jsonPath)) return;
    try {
        const db_ = connect(); // garante que db está pronto
        const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        const userCount = db_.prepare('SELECT COUNT(*) as c FROM users').get().c;
        if (userCount > 0) return; // já migrado

        logger.info('Migrando dados do JSON para SQLite...');
        const insertUser = db_.prepare('INSERT OR IGNORE INTO users (id, telegram_id, first_name, last_name, username, created_at) VALUES (?, ?, ?, ?, ?, ?)');
        const insertProduct = db_.prepare('INSERT OR IGNORE INTO products (id, name, price, description, file_url, photo, photo_url, category, stock, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        const insertOrder = db_.prepare('INSERT OR IGNORE INTO orders (id, user_id, status, total, external_reference, payment_id, payment_method, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        const insertItem = db_.prepare('INSERT OR IGNORE INTO order_items (id, order_id, product_id, quantity, price) VALUES (?, ?, ?, ?, ?)');

        const migrate = db_.transaction(() => {
            for (const u of (data.users || [])) insertUser.run(u.id, u.telegram_id, u.first_name || '', u.last_name || '', u.username || '', u.created_at || new Date().toISOString());
            for (const p of (data.products || [])) insertProduct.run(p.id, p.name, p.price, p.description || '', p.file_url || '', p.photo || '', p.photo_url || '', p.category || 'geral', p.stock ?? 999, p.active !== false ? 1 : 0, p.created_at || new Date().toISOString());
            for (const o of (data.orders || [])) insertOrder.run(o.id, o.user_id, o.status, o.total, o.external_reference, o.payment_id || null, o.payment_method || null, o.created_at || new Date().toISOString());
            for (const oi of (data.orderItems || [])) insertItem.run(oi.id, oi.order_id, oi.product_id, oi.quantity, oi.price);
        });
        migrate();
        // Resetar auto-increment
        const maxUser = db_.prepare('SELECT MAX(id) as m FROM users').get().m || 0;
        const maxProd = db_.prepare('SELECT MAX(id) as m FROM products').get().m || 0;
        db_.exec(`INSERT OR REPLACE INTO sqlite_sequence(name,seq) VALUES('users',${maxUser}),('products',${maxProd})`);
        logger.info('Migração JSON → SQLite concluída.');
        fs.renameSync(jsonPath, jsonPath + '.migrated');
    } catch (e) {
        logger.error('Erro na migração:', e.message);
    }
}

// ─── BACKUP (delegado ao BackupManager) ────────────────────────────────────
function backup() {
    if (BackupManager) {
        BackupManager.createBackupLegacy('legacy', false);
        return;
    }
    try {
        if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const dest = path.join(BACKUP_DIR, `hanork-${ts}.db`);
        if (db?.open) {
            db.pragma('wal_checkpoint(TRUNCATE)');
        }
        fileCopyBackup(dest);
    } catch (e) {
        logger.error('Backup error:', e.message);
    }
}

// Fallback: cópia direta do arquivo (funciona mesmo com DB fechado)
function fileCopyBackup(dest) {
    try {
        if (fs.existsSync(DB_PATH)) {
            fs.copyFileSync(DB_PATH, dest);
            logger.info(`Backup SQLite (file copy): ${dest}`);
            pruneBackups();
        } else {
            logger.error('Backup file copy: arquivo fonte não existe');
        }
    } catch (e) {
        logger.error('Backup file copy error:', e.message);
    }
}

function pruneBackups(keep = 48) {
    try {
        const files = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.endsWith('.db'))
            .map(f => ({ f, t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
            .sort((a, b) => b.t - a.t);
        files.slice(keep).forEach(({ f }) => fs.unlinkSync(path.join(BACKUP_DIR, f)));
    } catch { }
}

// ─── INTERFACE PRISMA-LIKE ─────────────────────────────────────────────────
function _tenantScope() {
    return require('../modules/tenant/tenantScope');
}
const _tenantSql = (...args) => _tenantScope().tenantSql(...args);
const _getScopeFromContext = (...args) => _tenantScope().getScopeFromContext(...args);
const _rowInScope = (...args) => _tenantScope().rowInScope(...args);
const _filterRowsInScope = (...args) => _tenantScope().filterRowsInScope(...args);
const _tenantIdForInsert = (...args) => _tenantScope().tenantIdForInsert(...args);
const _scopePrismaSql = (...args) => _tenantScope().scopePrismaSql(...args);
const _scopePrismaMutation = (...args) => _tenantScope().scopePrismaMutation(...args);

function _pg(table, sql, params, opts = {}) {
    const { sql: s, params: p } = _scopePrismaSql(sql, params, table, opts);
    const row = connect().prepare(s).get(...p);
    return opts.skipRowCheck ? row : _rowInScope(row, opts.column);
}
function _pa(table, sql, params, opts = {}) {
    const { sql: s, params: p } = _scopePrismaSql(sql, params, table, opts);
    const rows = connect().prepare(s).all(...p);
    return opts.skipRowCheck ? rows : _filterRowsInScope(rows, opts.column);
}
function _pr(table, sql, params, opts = {}) {
    const { sql: s, params: p } = _scopePrismaMutation(sql, params, table, opts);
    return connect().prepare(s).run(...p);
}
function _ti(explicit) {
    return _tenantIdForInsert(explicit);
}

const prisma = {
    user: {
        upsert({ where, update, create }) {
            const db_ = connect();
            const createData = create || {};
            const updateData = update || {};
            let user = _pg('users', 'SELECT * FROM users WHERE telegram_id = ?', [where.telegram_id], { skipRowCheck: true });
            if (!user) {
                const tenantId = _ti(createData.tenant_id);
                const info = db_.prepare(
                    'INSERT INTO users (telegram_id, first_name, last_name, username, tenant_id) VALUES (?, ?, ?, ?, ?)'
                ).run(
                    where.telegram_id,
                    createData.first_name || '',
                    createData.last_name || '',
                    createData.username || '',
                    tenantId
                );
                user = db_.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
            } else {
                const data = Object.keys(updateData).length ? updateData : createData;
                if (data.first_name !== undefined || data.username !== undefined) {
                    _pr('users', 'UPDATE users SET first_name=COALESCE(NULLIF(?,\'\'),first_name), username=COALESCE(NULLIF(?,\'\'),username), last_name=COALESCE(NULLIF(?,\'\'),last_name) WHERE telegram_id=?',
                        [data.first_name || '', data.username || '', data.last_name || '', where.telegram_id]);
                    user = _pg('users', 'SELECT * FROM users WHERE telegram_id = ?', [where.telegram_id], { skipRowCheck: true });
                }
            }
            return _rowInScope(user);
        },
        findUnique({ where }) {
            if (where.telegram_id) return _pg('users', 'SELECT * FROM users WHERE telegram_id = ?', [String(where.telegram_id)], { skipRowCheck: true });
            if (where.id !== undefined) return _pg('users', 'SELECT * FROM users WHERE id = ?', [where.id]);
            return null;
        },
        count() {
            const row = _pg('users', 'SELECT COUNT(*) as c FROM users', []);
            return row?.c || 0;
        },
        findMany({ orderBy } = {}) {
            return _pa('users', 'SELECT * FROM users ORDER BY id DESC', []);
        },
        update({ where, data }) {
            const db_ = connect();
            const allowed = ['first_name', 'last_name', 'username', 'email', 'email_verified', 'tenant_id', 'is_premium', 'language_code', 'photo_file_id'];
            const sets = [];
            const vals = [];
            for (const key of allowed) {
                if (data[key] !== undefined) {
                    sets.push(`${key}=?`);
                    vals.push(sqlBindValue(data[key]));
                }
            }
            if (!sets.length) {
                if (where.id !== undefined) return _pg('users', 'SELECT * FROM users WHERE id = ?', [where.id]);
                if (where.telegram_id) return _pg('users', 'SELECT * FROM users WHERE telegram_id = ?', [String(where.telegram_id)], { skipRowCheck: true });
                return null;
            }
            sets.push("updated_at=datetime('now')");
            if (where.id !== undefined) {
                vals.push(where.id);
                _pr('users', `UPDATE users SET ${sets.join(', ')} WHERE id=?`, vals);
                return _pg('users', 'SELECT * FROM users WHERE id = ?', [where.id]);
            }
            if (where.telegram_id) {
                vals.push(String(where.telegram_id));
                _pr('users', `UPDATE users SET ${sets.join(', ')} WHERE telegram_id=?`, vals);
                return _pg('users', 'SELECT * FROM users WHERE telegram_id = ?', [String(where.telegram_id)], { skipRowCheck: true });
            }
            return null;
        },
    },

    product: {
        findMany({ where } = {}) {
            const db_ = connect();
            const { tenantSql } = require('../modules/tenant/tenantScope');
            let sql = 'SELECT * FROM products';
            const params = [];
            const conds = [];
            if (where?.is_subscription !== undefined) {
                conds.push('is_subscription = ?');
                params.push(where.is_subscription ? 1 : 0);
            }
            if (where?.active !== undefined) {
                conds.push('active = ?');
                params.push(where.active ? 1 : 0);
            }
            if (where?.tenant_id !== undefined) {
                if (where.tenant_id === null) conds.push('tenant_id IS NULL');
                else {
                    conds.push('tenant_id = ?');
                    params.push(where.tenant_id);
                }
            } else if (!where?.skipTenantScope) {
                const t = tenantSql('tenant_id');
                conds.push(t.clause);
                params.push(...t.params);
            }
            if (conds.length) sql += ` WHERE ${conds.join(' AND ')}`;
            sql += ' ORDER BY id DESC';
            return db_.prepare(sql).all(...params);
        },
        findUnique({ where }) {
            const row = _pg('products', 'SELECT * FROM products WHERE id = ?', [where.id], { skipRowCheck: !!where.skipTenantScope });
            if (!row || where.skipTenantScope) return row;
            return _rowInScope(row);
        },
        create({ data }) {
            const db_ = connect();
            const tenantId = _ti(data.tenant_id);
            const info = db_.prepare(
                'INSERT INTO products (name, price, description, file_url, photo, photo_url, category, stock, active, is_subscription, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            ).run(
                data.name, data.price, data.description || '', data.file_url || '', data.photo || '', data.photo_url || '', data.category || 'geral', data.stock ?? 999, data.active !== false ? 1 : 0, data.is_subscription ? 1 : 0, tenantId
            );
            return db_.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid);
        },
        update({ where, data }) {
            const ALLOWED_PRODUCT_FIELDS = new Set(['name', 'price', 'description', 'file_url', 'photo', 'photo_url', 'category', 'stock', 'active', 'is_subscription']);
            const safeData = Object.fromEntries(Object.entries(data).filter(([k]) => ALLOWED_PRODUCT_FIELDS.has(k)));
            if (!Object.keys(safeData).length) return null;
            const fields = Object.keys(safeData).map(k => `${k} = ?`).join(', ');
            const values = [...sqlBindRow(safeData), where.id];
            _pr('products', `UPDATE products SET ${fields} WHERE id = ?`, values);
            return _pg('products', 'SELECT * FROM products WHERE id = ?', [where.id]);
        },
        count({ where } = {}) {
            if (where?.active !== undefined) {
                const row = _pg('products', 'SELECT COUNT(*) as c FROM products WHERE active = ?', [where.active ? 1 : 0]);
                return row?.c || 0;
            }
            const row = _pg('products', 'SELECT COUNT(*) as c FROM products', []);
            return row?.c || 0;
        },
    },

    order: {
        findUnique({ where }) {
            if (where.id) return _pg('orders', 'SELECT * FROM orders WHERE id = ?', [where.id], { where, skipRowCheck: true });
            if (where.external_reference) return _pg('orders', 'SELECT * FROM orders WHERE external_reference = ?', [where.external_reference], { where, skipRowCheck: true });
            return null;
        },
        create({ data }) {
            const db_ = connect();
            const id = data.id || require('crypto').randomUUID();
            const tenantId = _ti(data.tenant_id);
            db_.prepare(
                'INSERT INTO orders (id, user_id, status, total, external_reference, tenant_id) VALUES (?, ?, ?, ?, ?, ?)'
            ).run(id, data.user_id, data.status || 'CREATED', data.total || 0, data.external_reference || null, tenantId);
            if (data.order_items?.length) {
                const ins = db_.prepare('INSERT INTO order_items (order_id, product_id, quantity, price, tenant_id) VALUES (?, ?, ?, ?, ?)');
                for (const oi of data.order_items) ins.run(id, oi.product_id, oi.quantity, oi.price, tenantId);
            }
            return _pg('orders', 'SELECT * FROM orders WHERE id = ?', [id], { where: { id }, skipRowCheck: true });
        },
        update({ where, data }) {
            const ALLOWED = new Set(['status', 'payment_id', 'payment_method', 'external_reference', 'total', 'delivered_payment_id', 'coupon_code', 'discount', 'paid_at', 'delivered_at', 'error_message', 'post_sale_due', 'post_sale_sent']);
            const safeData = Object.fromEntries(Object.entries(data).filter(([k]) => ALLOWED.has(k)));
            if (!Object.keys(safeData).length) return null;
            const fields = Object.keys(safeData).map(k => `${k} = ?`).join(', ');
            _pr('orders', `UPDATE orders SET ${fields}, updated_at = datetime('now') WHERE id = ?`, [...sqlBindRow(safeData), where.id]);
            return _pg('orders', 'SELECT * FROM orders WHERE id = ?', [where.id], { where: { id: where.id }, skipRowCheck: true });
        },
        updateIfNotDelivered(id, data) {
            const SAFE = new Set(['status', 'payment_id', 'payment_method', 'external_reference', 'total', 'delivered_payment_id']);
            const safeData = Object.fromEntries(Object.entries(data).filter(([k]) => SAFE.has(k)));
            if (!Object.keys(safeData).length) return false;
            const fields = Object.keys(safeData).map(k => `${k} = ?`).join(', ');
            const result = _pr('orders',
                `UPDATE orders SET ${fields}, updated_at = datetime('now') WHERE id = ? AND status != 'DELIVERED'`,
                [...sqlBindRow(safeData), id]);
            return result.changes > 0;
        },
        lockDelivery(orderId, paymentId) {
            try {
                const result = _pr('orders',
                    `UPDATE orders SET delivered_payment_id = ?, updated_at = datetime('now') WHERE id = ? AND delivered_payment_id IS NULL`,
                    [String(paymentId), orderId]);
                return result.changes > 0;
            } catch (e) {
                if (e.message?.includes('UNIQUE')) return false;
                throw e;
            }
        },
        releasePaymentLock(orderId, paymentId) {
            const result = _pr('orders',
                `UPDATE orders SET delivered_payment_id = NULL, updated_at = datetime('now')
                 WHERE id = ? AND delivered_payment_id = ? AND status NOT IN ('DELIVERED')`,
                [orderId, String(paymentId)]);
            return result.changes > 0;
        },
        findMany({ where, orderBy } = {}) {
            if (where?.user_id) return _pa('orders', 'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC', [where.user_id]);
            if (where?.status) return _pa('orders', 'SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC', [where.status], { where });
            return _pa('orders', 'SELECT * FROM orders ORDER BY created_at DESC', []);
        },
        findFirst({ where }) {
            if (!where) return null;
            if (where.id) return _pg('orders', 'SELECT * FROM orders WHERE id = ?', [where.id], { where, skipRowCheck: true });
            if (where.external_reference) return _pg('orders', 'SELECT * FROM orders WHERE external_reference = ?', [where.external_reference], { where, skipRowCheck: true });
            if (where.payment_id != null) {
                return _pg('orders', 'SELECT * FROM orders WHERE payment_id = ? ORDER BY created_at DESC LIMIT 1', [String(where.payment_id)], { where, skipRowCheck: true });
            }
            if (where.user_id !== undefined) {
                if (where.status?.in) {
                    const statuses = where.status.in;
                    const placeholders = statuses.map(() => '?').join(',');
                    return _pg('orders',
                        `SELECT * FROM orders WHERE user_id = ? AND status IN (${placeholders}) ORDER BY created_at DESC LIMIT 1`,
                        [where.user_id, ...statuses]);
                }
                if (typeof where.status === 'string') {
                    return _pg('orders',
                        'SELECT * FROM orders WHERE user_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1',
                        [where.user_id, where.status]);
                }
                return _pg('orders', 'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', [where.user_id]);
            }
            if (where.status) return _pg('orders', 'SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC LIMIT 1', [where.status], { where });
            return null;
        },
        count({ where } = {}) {
            if (where?.status?.in?.length) {
                const placeholders = where.status.in.map(() => '?').join(',');
                const row = _pg('orders', `SELECT COUNT(*) as c FROM orders WHERE status IN (${placeholders})`, where.status.in, { where });
                return row?.c || 0;
            }
            if (where?.status) {
                const row = _pg('orders', 'SELECT COUNT(*) as c FROM orders WHERE status = ?', [where.status], { where });
                return row?.c || 0;
            }
            if (where?.user_id !== undefined) {
                const row = _pg('orders', 'SELECT COUNT(*) as c FROM orders WHERE user_id = ?', [where.user_id]);
                return row?.c || 0;
            }
            const row = _pg('orders', 'SELECT COUNT(*) as c FROM orders', []);
            return row?.c || 0;
        },
        aggregate({ where, _sum }) {
            let row;
            if (where?.status) row = _pg('orders', 'SELECT SUM(total) as total FROM orders WHERE status = ?', [where.status]);
            else row = _pg('orders', 'SELECT SUM(total) as total FROM orders', []);
            return { _sum: { total: row?.total || 0 } };
        },
    },

    orderItem: {
        findMany({ where }) {
            if (where?.order_id) return _pa('order_items', 'SELECT * FROM order_items WHERE order_id = ?', [where.order_id], { where: { order_id: where.order_id } });
            return [];
        },
    },

    coupon: {
        findByCode(code) {
            const row = _pg('coupons', 'SELECT * FROM coupons WHERE code = ? AND active = 1', [code.toUpperCase()], { skipRowCheck: true });
            return _rowInScope(row);
        },
        create({ data }) {
            const db_ = connect();
            const tenantId = _ti(data.tenant_id);
            const info = db_.prepare('INSERT INTO coupons (code, type, value, max_uses, min_total, expires_at, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
                data.code.toUpperCase(), data.type || 'percent', data.value, data.max_uses ?? 100, data.min_total ?? 0, data.expires_at || null, tenantId
            );
            return db_.prepare('SELECT * FROM coupons WHERE id = ?').get(info.lastInsertRowid);
        },
        use(code) {
            _pr('coupons', 'UPDATE coupons SET used = used + 1 WHERE code = ?', [code.toUpperCase()]);
        },
        findMany() { return _pa('coupons', 'SELECT * FROM coupons ORDER BY created_at DESC', []); },
        findAvailable(limit = 10) {
            return _pa('coupons', `
                SELECT * FROM coupons
                WHERE active = 1
                  AND (expires_at IS NULL OR expires_at > datetime('now'))
                  AND (max_uses = 999 OR used < max_uses)
                ORDER BY created_at DESC
                LIMIT ?
            `, [limit]);
        },
        delete(code) { _pr('coupons', 'UPDATE coupons SET active = 0 WHERE code = ?', [code.toUpperCase()]); },
    },

    review: {
        create({ data }) {
            const db_ = connect();
            const tenantId = _ti(data.tenant_id);
            const info = db_.prepare('INSERT INTO reviews (user_id, order_id, rating, comment, tenant_id) VALUES (?, ?, ?, ?, ?)').run(
                data.user_id, data.order_id, data.rating, data.comment || '', tenantId
            );
            return db_.prepare('SELECT * FROM reviews WHERE id = ?').get(info.lastInsertRowid);
        },
        findByOrder(order_id) { return _pg('reviews', 'SELECT * FROM reviews WHERE order_id = ?', [order_id]); },
        findByUser(user_id) { return _pa('reviews', 'SELECT * FROM reviews WHERE user_id = ? ORDER BY created_at DESC', [user_id]); },
        stats() {
            const row = _pg('reviews', 'SELECT COUNT(*) as total, AVG(rating) as avg FROM reviews', []);
            return { total: row?.total || 0, avg: row?.avg ? parseFloat(Number(row.avg).toFixed(1)) : 0 };
        },
        findMany({ limit } = {}) {
            const l = limit || 50;
            return _pa('reviews', 'SELECT * FROM reviews ORDER BY created_at DESC LIMIT ?', [l]);
        },
    },

    affiliate: {
        findByUser(user_id) { return _pg('affiliates', 'SELECT * FROM affiliates WHERE user_id = ?', [user_id], { skipRowCheck: true }); },
        findByCode(code) { return _pg('affiliates', 'SELECT * FROM affiliates WHERE code = ?', [code.toUpperCase()], { skipRowCheck: true }); },
        create(user_id, code) {
            const db_ = connect();
            const tenantId = _ti();
            db_.prepare('INSERT OR IGNORE INTO affiliates (user_id, code, tenant_id) VALUES (?, ?, ?)').run(user_id, code.toUpperCase(), tenantId);
            return _pg('affiliates', 'SELECT * FROM affiliates WHERE user_id = ?', [user_id], { skipRowCheck: true });
        },
        addReferral(affiliate_id, referred_user_id, tenant_id = null) {
            const db_ = connect();
            const tid = tenant_id ?? _ti();
            const result = db_.prepare(
                'INSERT OR IGNORE INTO referrals (affiliate_id, referred_user_id, tenant_id) VALUES (?, ?, ?)'
            ).run(affiliate_id, referred_user_id, tid);
            if (result.changes > 0) {
                _pr('affiliates', 'UPDATE affiliates SET referred_count = referred_count + 1 WHERE id = ?', [affiliate_id]);
            }
            return result.changes > 0;
        },
        /** @deprecated Use AffiliateCommissionService.payCommission — lógica incorreta para múltiplos indicados */
        addSale(affiliate_id, order_id, commission) {
            const ref = _pg('referrals',
                'SELECT id FROM referrals WHERE affiliate_id = ? AND order_id IS NULL ORDER BY created_at ASC LIMIT 1',
                [affiliate_id]);
            if (!ref) return false;
            const upd = _pr('referrals',
                'UPDATE referrals SET order_id = ?, commission = ? WHERE id = ? AND order_id IS NULL',
                [order_id, commission, ref.id]);
            if (upd.changes < 1) return false;
            _pr('affiliates', 'UPDATE affiliates SET sales_count = sales_count + 1, earnings = earnings + ? WHERE id = ?',
                [commission, affiliate_id]);
            return true;
        },
        findMany() { return _pa('affiliates', 'SELECT * FROM affiliates ORDER BY earnings DESC', []); },
        deductEarnings(user_id, amount) {
            const aff = _pg('affiliates', 'SELECT * FROM affiliates WHERE user_id = ?', [user_id], { skipRowCheck: true });
            if (!aff || aff.earnings < amount) return false;
            _pr('affiliates', 'UPDATE affiliates SET earnings = earnings - ? WHERE user_id = ?', [amount, user_id]);
            return true;
        },
    },

    referral: {
        countByAffiliate(affiliate_id) {
            const row = _pg('referrals', 'SELECT COUNT(*) as c FROM referrals WHERE affiliate_id = ?', [affiliate_id]);
            return row?.c || 0;
        },
        findByAffiliate(affiliate_id, limit = 10) {
            const { appendTenantWhere } = require('../modules/tenant/tenantScope');
            const base = `
                SELECT r.*, u.first_name, u.username
                FROM referrals r
                JOIN users u ON u.id = r.referred_user_id
                WHERE r.affiliate_id = ?
                ORDER BY r.created_at DESC
                LIMIT ?`;
            const { sql, params } = appendTenantWhere(base, [affiliate_id, limit], 'r.tenant_id');
            return connect().prepare(sql).all(...params);
        },
    },

    favorite: {
        toggle(user_id, product_id) {
            const db_ = connect();
            const existing = _pg('favorites', 'SELECT id FROM favorites WHERE user_id=? AND product_id=?', [user_id, product_id]);
            if (existing) {
                _pr('favorites', 'DELETE FROM favorites WHERE user_id=? AND product_id=?', [user_id, product_id]);
                return false;
            }
            const tenantId = _ti();
            db_.prepare('INSERT OR IGNORE INTO favorites (user_id, product_id, tenant_id) VALUES (?,?,?)').run(user_id, product_id, tenantId);
            return true;
        },
        isFavorite(user_id, product_id) {
            return !!_pg('favorites', 'SELECT id FROM favorites WHERE user_id=? AND product_id=?', [user_id, product_id]);
        },
        findByUser(user_id) {
            return _pa('favorites', 'SELECT product_id FROM favorites WHERE user_id=? ORDER BY created_at DESC', [user_id]).map(r => r.product_id);
        },
    },

    ticket: {
        create(user_id, telegram_id, message) {
            const db_ = connect();
            const tenantId = _ti();
            const info = db_.prepare('INSERT INTO support_tickets (user_id, telegram_id, message, tenant_id) VALUES (?,?,?,?)').run(user_id, telegram_id, message, tenantId);
            const ticket = db_.prepare('SELECT * FROM support_tickets WHERE id=?').get(info.lastInsertRowid);
            db_.prepare('INSERT INTO ticket_messages (ticket_id, sender, content, tenant_id) VALUES (?,?,?,?)').run(ticket.id, 'user', message, tenantId);
            return ticket;
        },
        findOpen() { return _pa('support_tickets', "SELECT * FROM support_tickets WHERE status='open' ORDER BY created_at ASC", []); },
        findById(id) { return _pg('support_tickets', 'SELECT * FROM support_tickets WHERE id=?', [id]); },
        close(id) { _pr('support_tickets', "UPDATE support_tickets SET status='closed', updated_at=datetime('now') WHERE id=?", [id]); },
        reply(id, reply) { _pr('support_tickets', "UPDATE support_tickets SET status='closed', reply=?, updated_at=datetime('now') WHERE id=?", [reply, id]); },
        addMessage(ticket_id, sender, content) {
            const tenantId = _ti();
            connect().prepare('INSERT INTO ticket_messages (ticket_id, sender, content, tenant_id) VALUES (?,?,?,?)').run(ticket_id, sender, content, tenantId);
            _pr('support_tickets', "UPDATE support_tickets SET updated_at=datetime('now') WHERE id=?", [ticket_id]);
        },
        getMessages(ticket_id) { return _pa('ticket_messages', 'SELECT * FROM ticket_messages WHERE ticket_id=? ORDER BY created_at ASC', [ticket_id]); },
        findByUser(user_id) { return _pa('support_tickets', 'SELECT * FROM support_tickets WHERE user_id=? ORDER BY created_at DESC LIMIT 5', [user_id]); },
    },

    flashSale: {
        create(product_id, sale_price, original_price, ends_at, stock_limit = 0) {
            const db_ = connect();
            const tenantId = _ti();
            _pr('flash_sales', 'UPDATE flash_sales SET active=0 WHERE product_id=?', [product_id]);
            const info = db_.prepare('INSERT INTO flash_sales (product_id, sale_price, original_price, ends_at, stock_limit, sold_count, tenant_id) VALUES (?,?,?,?,?,0,?)').run(product_id, sale_price, original_price, ends_at, stock_limit, tenantId);
            return db_.prepare('SELECT * FROM flash_sales WHERE id=?').get(info.lastInsertRowid);
        },
        findActive(product_id) {
            const { appendTenantWhere } = require('../modules/tenant/tenantScope');
            const base = `SELECT fs.*, p.name AS product_name, p.photo_url AS product_photo, p.description AS product_desc, p.photo AS product_photo_file
                 FROM flash_sales fs
                 JOIN products p ON p.id = fs.product_id
                 WHERE fs.product_id=? AND fs.active=1 AND fs.ends_at > datetime('now')
                 LIMIT 1`;
            const { sql, params } = appendTenantWhere(base, [product_id], 'fs.tenant_id');
            const s = connect().prepare(sql).get(...params) || null;
            if (s && s.stock_limit > 0 && s.sold_count >= s.stock_limit) return null;
            return s;
        },
        findAllActive() {
            const { appendTenantWhere } = require('../modules/tenant/tenantScope');
            const base = "SELECT fs.*, p.name as product_name, p.photo_url as product_photo, p.description as product_desc FROM flash_sales fs JOIN products p ON p.id=fs.product_id WHERE fs.active=1 AND fs.ends_at > datetime('now')";
            const { sql, params } = appendTenantWhere(base, [], 'fs.tenant_id');
            return connect().prepare(sql).all(...params)
                .filter(s => s.stock_limit === 0 || s.sold_count < s.stock_limit);
        },
        incrementSold(id) {
            _pr('flash_sales', 'UPDATE flash_sales SET sold_count=sold_count+1 WHERE id=?', [id]);
        },
        expire() {
            withSqliteRetry(() => {
                _pr('flash_sales', "UPDATE flash_sales SET active=0 WHERE ends_at <= datetime('now')", []);
            });
        },
        delete(id) {
            withSqliteRetry(() => {
                _pr('flash_sales', 'UPDATE flash_sales SET active=0 WHERE id=?', [id]);
            });
        },
    },

    restockNotify: {
        add(user_id, product_id, telegram_id) {
            try {
                const tenantId = _ti();
                connect().prepare('INSERT OR IGNORE INTO restock_notify (user_id, product_id, telegram_id, tenant_id) VALUES (?,?,?,?)').run(user_id, product_id, String(telegram_id), tenantId);
                return true;
            } catch { return false; }
        },
        remove(user_id, product_id) { _pr('restock_notify', 'DELETE FROM restock_notify WHERE user_id=? AND product_id=?', [user_id, product_id]); },
        isRegistered(user_id, product_id) { return !!_pg('restock_notify', 'SELECT id FROM restock_notify WHERE user_id=? AND product_id=? AND notified=0', [user_id, product_id]); },
        findPending(product_id) { return _pa('restock_notify', 'SELECT * FROM restock_notify WHERE product_id=? AND notified=0', [product_id]); },
        markNotified(product_id) { _pr('restock_notify', 'UPDATE restock_notify SET notified=1 WHERE product_id=?', [product_id]); },
    },

    $connect() { connect(); return Promise.resolve(); },
    $disconnect() { if (db) { db.close(); db = null; } return Promise.resolve(); },

    // Compatibilidade com TransactionManager (SQLite é ACID por padrão)
    async $transaction(fn, _options) {
        const db_ = connect();
        try {
            db_.prepare('BEGIN IMMEDIATE').run();
            const result = await fn(prisma);
            db_.prepare('COMMIT').run();
            return result;
        } catch (e) {
            try { db_.prepare('ROLLBACK').run(); } catch (_) { /* ignore */ }
            throw e;
        }
    },

    // Compatibilidade com código legado que usa $queryRaw
    async $queryRaw(strings, ...values) {
        const db_ = connect();
        try {
            let sql;
            if (typeof strings === 'string') {
                sql = strings;
            } else if (Array.isArray(strings)) {
                // Template literal tagged
                sql = strings.reduce((acc, str, i) => acc + str + (values[i] !== undefined ? '?' : ''), '');
            } else {
                return [];
            }
            return db_.prepare(sql).all(...values.filter((_, i) => i < strings.length - 1));
        } catch (e) {
            logger.warn('[prisma.$queryRaw] Erro: ' + e.message);
            return [];
        }
    },

    // SISTEMA DE PONTOS/FIDELIDADE
    loyalty: {
        getOrCreate(user_id) {
            const db_ = connect();
            let record = _pg('loyalty_points', 'SELECT * FROM loyalty_points WHERE user_id=?', [user_id]);
            if (!record) {
                const tenantId = _ti();
                db_.prepare('INSERT INTO loyalty_points (user_id, points, level, tenant_id) VALUES (?, 0, ?, ?)').run(user_id, 'bronze', tenantId);
                record = _pg('loyalty_points', 'SELECT * FROM loyalty_points WHERE user_id=?', [user_id]);
            }
            return record;
        },
        addPoints(user_id, points, description, order_id = null) {
            const db_ = connect();
            const tenantId = _ti();
            const current = _pg('loyalty_points', 'SELECT * FROM loyalty_points WHERE user_id=?', [user_id]);
            if (!current) {
                db_.prepare('INSERT INTO loyalty_points (user_id, points, total_earned, level, tenant_id) VALUES (?, ?, ?, ?, ?)')
                    .run(user_id, points, points, 'bronze', tenantId);
            } else {
                const newPoints = current.points + points;
                const newTotal = current.total_earned + points;
                let level = 'bronze';
                if (newTotal >= 5000) level = 'vip';
                else if (newTotal >= 2000) level = 'platinum';
                else if (newTotal >= 1000) level = 'gold';
                else if (newTotal >= 500) level = 'silver';
                _pr('loyalty_points', "UPDATE loyalty_points SET points=?, total_earned=?, level=?, updated_at=datetime('now') WHERE user_id=?",
                    [newPoints, newTotal, level, user_id]);
            }
            db_.prepare('INSERT INTO points_history (user_id, type, points, description, order_id, tenant_id) VALUES (?,?,?,?,?,?)')
                .run(user_id, 'earn', points, description, order_id, tenantId);
            return true;
        },
        spendPoints(user_id, points, description, order_id = null) {
            const current = _pg('loyalty_points', 'SELECT * FROM loyalty_points WHERE user_id=?', [user_id]);
            if (!current || current.points < points) return false;
            _pr('loyalty_points', "UPDATE loyalty_points SET points=points-?, total_spent=total_spent+?, updated_at=datetime('now') WHERE user_id=?",
                [points, points, user_id]);
            connect().prepare('INSERT INTO points_history (user_id, type, points, description, order_id, tenant_id) VALUES (?,?,?,?,?,?)')
                .run(user_id, 'spend', -points, description, order_id, _ti());
            return true;
        },
        deductPoints(user_id, points, description, order_id = null) {
            return this.spendPoints(user_id, points, description, order_id);
        },
        getHistory(user_id, limit = 10) {
            return _pa('points_history', 'SELECT * FROM points_history WHERE user_id=? ORDER BY created_at DESC LIMIT ?', [user_id, limit]);
        },
    },

    // CARRINHO ABANDONADO
    abandonedCart: {
        save(user_id, telegram_id, cart_data, total) {
            const db_ = connect();
            const tenantId = _ti();
            _pr('abandoned_carts', 'DELETE FROM abandoned_carts WHERE user_id=? AND reminded=0', [user_id]);
            const info = db_.prepare('INSERT INTO abandoned_carts (user_id, telegram_id, cart_data, total, tenant_id) VALUES (?,?,?,?,?)')
                .run(user_id, String(telegram_id), JSON.stringify(cart_data), total, tenantId);
            return info.lastInsertRowid;
        },
        findPending(minutes = 60) {
            const safeMin = Number.isInteger(minutes) && minutes > 0 && minutes <= 10080 ? minutes : 60;
            return _pa('abandoned_carts', `
                SELECT * FROM abandoned_carts 
                WHERE reminded=0 
                AND datetime(created_at) < datetime('now', '-${safeMin} minutes')
                ORDER BY created_at ASC
            `, []);
        },
        markReminded(id, coupon = null) {
            _pr('abandoned_carts', `
                UPDATE abandoned_carts 
                SET reminded=1, reminded_at=datetime('now'), coupon_sent=? 
                WHERE id=?
            `, [coupon, id]);
        },
        delete(user_id) {
            _pr('abandoned_carts', 'DELETE FROM abandoned_carts WHERE user_id=?', [user_id]);
        },
        stats() {
            const total = _pg('abandoned_carts', 'SELECT COUNT(*) as count FROM abandoned_carts', [])?.count || 0;
            const pending = _pg('abandoned_carts', 'SELECT COUNT(*) as count FROM abandoned_carts WHERE reminded=0', [])?.count || 0;
            const recovered = _pg('abandoned_carts', 'SELECT COUNT(*) as count FROM abandoned_carts WHERE reminded=1', [])?.count || 0;
            return { total, pending, recovered };
        },
    },

    // NOTIFICAÇÕES (unificado — evita sobrescrita pelo bloco abaixo)
    notification: {
        log(user_id, type, message) {
            try {
                const tenantId = _ti();
                connect().prepare('INSERT INTO notifications_sent (user_id, type, message, tenant_id) VALUES (?,?,?,?)').run(user_id, type, message, tenantId);
            } catch { /* ignore */ }
        },
        getRecent(user_id, hours = 24) {
            try {
                const safeHours = Number.isInteger(hours) && hours > 0 && hours <= 168 ? hours : 24;
                return _pa('notifications_sent', `SELECT * FROM notifications_sent WHERE user_id=? AND datetime(sent_at) > datetime('now', '-${safeHours} hours') ORDER BY sent_at DESC`, [user_id]);
            } catch { return []; }
        },
        markSent(user_id, telegram_id, notification_type, related_id = null) {
            try {
                const tenantId = _ti();
                connect().prepare('INSERT INTO user_notifications (user_id, telegram_id, notification_type, related_id, tenant_id) VALUES (?, ?, ?, ?, ?)')
                    .run(user_id, String(telegram_id), notification_type, related_id, tenantId);
                return { success: true };
            } catch (e) {
                if (e.message.includes('UNIQUE constraint failed')) return { success: true, already_sent: true };
                return { success: false };
            }
        },
        wasSent(user_id, notification_type, related_id = null) {
            try {
                return !!_pg('user_notifications', 'SELECT id FROM user_notifications WHERE user_id = ? AND notification_type = ? AND related_id = ?',
                    [user_id, notification_type, related_id]);
            } catch { return false; }
        },
        getByUser(user_id) {
            try { return _pa('user_notifications', 'SELECT * FROM user_notifications WHERE user_id = ? ORDER BY sent_at DESC LIMIT 100', [user_id]); } catch { return []; }
        },
    },

    // 💰 SISTEMA FINANCEIRO COMPLETO
    finance: {
        addCashFlow(type, category, amount, description = '', order_id = null, user_id = null, payment_method = null) {
            const db_ = connect();
            const tenantId = _ti();
            const info = db_.prepare('INSERT INTO cash_flow (type, category, amount, description, order_id, user_id, payment_method, tenant_id) VALUES (?,?,?,?,?,?,?,?)')
                .run(type, category, amount, description, order_id, user_id, payment_method, tenantId);
            return info.lastInsertRowid;
        },
        getCashFlowSummary(period = 'today') {
            const validPeriods = ['today', 'week', 'month', 'year'];
            const safePeriod = validPeriods.includes(period) ? period : 'today';
            let whereClause = '';
            if (safePeriod === 'today') whereClause = "date(created_at) = date('now')";
            else if (safePeriod === 'week') whereClause = "date(created_at) >= date('now', '-7 days')";
            else if (safePeriod === 'month') whereClause = "date(created_at) >= date('now', '-30 days')";
            else if (safePeriod === 'year') whereClause = "date(created_at) >= date('now', '-365 days')";

            const income = _pg('cash_flow', `SELECT COALESCE(SUM(amount), 0) as total FROM cash_flow WHERE type='income' AND ${whereClause}`, [])?.total || 0;
            const expense = _pg('cash_flow', `SELECT COALESCE(SUM(amount), 0) as total FROM cash_flow WHERE type='expense' AND ${whereClause}`, [])?.total || 0;

            return { income, expense, balance: income - expense };
        },
        getSalesByCategory(period = 'month') {
            let whereClause = "date(created_at) >= date('now', '-30 days')";
            if (period === 'today') whereClause = "date(created_at) = date('now')";
            else if (period === 'week') whereClause = "date(created_at) >= date('now', '-7 days')";

            return _pa('cash_flow', `
                SELECT category, COALESCE(SUM(amount), 0) as total, COUNT(*) as count 
                FROM cash_flow 
                WHERE type='income' AND ${whereClause}
                GROUP BY category
                ORDER BY total DESC
            `, []);
        },
    },

    // Metas de Vendas
    goals: {
        create(period, goal_amount, goal_orders, start_date, end_date) {
            const db_ = connect();
            const tenantId = _ti();
            const info = db_.prepare('INSERT INTO sales_goals (period, goal_amount, goal_orders, start_date, end_date, tenant_id) VALUES (?,?,?,?,?,?)')
                .run(period, goal_amount, goal_orders, start_date, end_date, tenantId);
            return info.lastInsertRowid;
        },
        getCurrent(period = 'monthly') {
            return _pg('sales_goals', `
                SELECT * FROM sales_goals 
                WHERE period=? AND date('now') BETWEEN date(start_date) AND date(end_date)
                ORDER BY created_at DESC LIMIT 1
            `, [period]);
        },
        updateProgress(goal_id, achieved_amount, achieved_orders) {
            _pr('sales_goals', 'UPDATE sales_goals SET achieved_amount=?, achieved_orders=? WHERE id=?',
                [achieved_amount, achieved_orders, goal_id]);
        },
        checkAchievement(order_total) {
            const goals = _pa('sales_goals', "SELECT * FROM sales_goals WHERE completed=0 AND date('now') BETWEEN date(start_date) AND date(end_date)", []);
            for (const goal of goals) {
                const newAmount = goal.achieved_amount + order_total;
                const newOrders = goal.achieved_orders + 1;
                const completed = newAmount >= goal.goal_amount ? 1 : 0;
                _pr('sales_goals', 'UPDATE sales_goals SET achieved_amount=?, achieved_orders=?, completed=? WHERE id=?',
                    [newAmount, newOrders, completed, goal.id]);
            }
        },
    },

    // Assinaturas/Recorrência
    subscription: {
        create(user_id, telegram_id, plan_name, plan_value, billing_cycle = 'monthly') {
            const db_ = connect();
            const tenantId = _ti();
            const next_payment = billing_cycle === 'monthly' ? "datetime('now', '+1 month')" :
                billing_cycle === 'weekly' ? "datetime('now', '+7 days')" : "datetime('now', '+1 year')";
            const info = db_.prepare(`INSERT INTO subscriptions (user_id, telegram_id, plan_name, plan_value, billing_cycle, next_payment_date, tenant_id) VALUES (?,?,?,?,?,${next_payment},?)`)
                .run(user_id, String(telegram_id), plan_name, plan_value, billing_cycle, tenantId);
            return info.lastInsertRowid;
        },
        findActive(user_id) {
            return _pg('subscriptions', "SELECT * FROM subscriptions WHERE user_id=? AND status='active'", [user_id]);
        },
        findAllActive() {
            return _pa('subscriptions', "SELECT * FROM subscriptions WHERE status='active' AND next_payment_date <= datetime('now', '+3 days')", []);
        },
        processPayment(id) {
            const sub = _pg('subscriptions', 'SELECT * FROM subscriptions WHERE id=?', [id]);
            if (!sub) return false;
            const next_payment = sub.billing_cycle === 'monthly' ? "datetime('now', '+1 month')" :
                sub.billing_cycle === 'weekly' ? "datetime('now', '+7 days')" : "datetime('now', '+1 year')";
            _pr('subscriptions', `UPDATE subscriptions SET last_payment_date=datetime('now'), next_payment_date=${next_payment}, total_payments=total_payments+1, total_paid=total_paid+? WHERE id=?`,
                [sub.plan_value, id]);
            return true;
        },
        cancel(id) {
            _pr('subscriptions', "UPDATE subscriptions SET status='cancelled', cancelled_at=datetime('now') WHERE id=?", [id]);
        },
        isActive(user_id) {
            return !!_pg('subscriptions', "SELECT id FROM subscriptions WHERE user_id=? AND status='active'", [user_id]);
        },
        renew(user_id, plan_value) {
            const sub = _pg('subscriptions', `
                SELECT * FROM subscriptions WHERE user_id = ?
                AND status IN ('active', 'cancelled')
                AND datetime(replace(substr(next_payment_date, 1, 19), 'T', ' ')) > datetime('now')
                ORDER BY id DESC LIMIT 1
            `, [user_id]);
            if (!sub) return false;
            const next_payment = sub.billing_cycle === 'monthly' ? "datetime('now', '+1 month')" :
                sub.billing_cycle === 'weekly' ? "datetime('now', '+7 days')" : "datetime('now', '+1 year')";
            _pr('subscriptions', `
                UPDATE subscriptions SET
                    status = 'active',
                    cancelled_at = NULL,
                    last_payment_date = datetime('now'),
                    next_payment_date = ${next_payment},
                    total_payments = total_payments + 1,
                    total_paid = total_paid + ?
                WHERE id = ?
            `, [plan_value, sub.id]);
            return true;
        },
    },

    // =====================================================
    // ESTADO PERSISTENTE (substitui Maps em memória)
    // =====================================================

    // Carrinhos ativos - substitui Map carrinhos
    cart: {
        add(user_id, telegram_id, product_id, product_name, product_price) {
            const db_ = connect();
            const tenantId = _ti();
            const existing = _pg('active_carts', 'SELECT id, quantity FROM active_carts WHERE user_id = ? AND product_id = ?', [user_id, product_id]);
            if (existing) {
                _pr('active_carts', "UPDATE active_carts SET quantity = quantity + 1, updated_at = datetime('now') WHERE id = ?", [existing.id]);
                return { updated: true, quantity: existing.quantity + 1 };
            }
            const info = db_.prepare('INSERT INTO active_carts (user_id, telegram_id, product_id, product_name, product_price, quantity, tenant_id) VALUES (?, ?, ?, ?, ?, 1, ?)')
                .run(user_id, String(telegram_id), product_id, product_name, product_price, tenantId);
            return { inserted: true, id: info.lastInsertRowid };
        },
        get(user_id) {
            return _pa('active_carts', 'SELECT * FROM active_carts WHERE user_id = ? ORDER BY added_at DESC', [user_id]);
        },
        getByTelegram(telegram_id) {
            return _pa('active_carts', 'SELECT * FROM active_carts WHERE telegram_id = ? ORDER BY added_at DESC', [String(telegram_id)]);
        },
        total(user_id) {
            const row = _pg('active_carts', 'SELECT SUM(product_price * quantity) as total FROM active_carts WHERE user_id = ?', [user_id]);
            return row?.total || 0;
        },
        count(user_id) {
            const row = _pg('active_carts', 'SELECT SUM(quantity) as count FROM active_carts WHERE user_id = ?', [user_id]);
            return row?.count || 0;
        },
        remove(user_id, product_id) {
            _pr('active_carts', 'DELETE FROM active_carts WHERE user_id = ? AND product_id = ?', [user_id, product_id]);
        },
        decrement(user_id, product_id) {
            const item = _pg('active_carts', 'SELECT id, quantity FROM active_carts WHERE user_id = ? AND product_id = ?', [user_id, product_id]);
            if (!item) return false;
            if (item.quantity <= 1) {
                _pr('active_carts', 'DELETE FROM active_carts WHERE id = ?', [item.id]);
                return { deleted: true };
            }
            _pr('active_carts', "UPDATE active_carts SET quantity = quantity - 1, updated_at = datetime('now') WHERE id = ?", [item.id]);
            return { updated: true, quantity: item.quantity - 1 };
        },
        clear(user_id) {
            _pr('active_carts', 'DELETE FROM active_carts WHERE user_id = ?', [user_id]);
        },
        updatePrice(user_id, product_id, new_price) {
            _pr('active_carts', "UPDATE active_carts SET product_price = ?, updated_at = datetime('now') WHERE user_id = ? AND product_id = ?",
                [new_price, user_id, product_id]);
        },
        cleanupOld(olderThanMinutes = 30) {
            const safeMin = Number.isInteger(olderThanMinutes) && olderThanMinutes > 0 ? olderThanMinutes : 30;
            const oldItems = _pa('active_carts', `SELECT * FROM active_carts WHERE updated_at < datetime('now', '-${safeMin} minutes')`, []);
            const result = _pr('active_carts', `DELETE FROM active_carts WHERE updated_at < datetime('now', '-${safeMin} minutes')`, []);
            return { deleted: result.changes, items: oldItems };
        }
    },

    conversionEvent: {
        track(user_id, event_name, event_data = {}, tenant_id = null) {
            try {
                const db_ = connect();
                const tid = tenant_id != null ? tenant_id : _ti();
                db_.prepare(
                    `INSERT INTO conversion_events (user_id, event_name, event_data, tenant_id, created_at)
                     VALUES (?, ?, ?, ?, datetime('now'))`
                ).run(user_id, event_name, JSON.stringify(event_data || {}), tid);
                return true;
            } catch (_) {
                return false;
            }
        },
        countDistinct(event_name, sinceIso) {
            const row = _pg(
                'conversion_events',
                `SELECT COUNT(DISTINCT user_id) AS c FROM conversion_events
                 WHERE event_name = ? AND datetime(created_at) >= datetime(?)`,
                [event_name, sinceIso]
            );
            return row?.c || 0;
        },
    },

    // Compras pendentes - substitui Map comprasPendentes
    pendingPurchase: {
        create(user_id, telegram_id, order_id, total, payment_method, payment_id = null, pix_qr_code = null, pix_expiration = null) {
            const db_ = connect();
            const tenantId = _ti();
            try {
                const info = db_.prepare('INSERT INTO pending_purchases (user_id, telegram_id, order_id, total, payment_method, payment_id, pix_qr_code, pix_expiration, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
                    .run(user_id, String(telegram_id), order_id, total, payment_method, payment_id, pix_qr_code, pix_expiration, tenantId);
                return { success: true, id: info.lastInsertRowid };
            } catch (e) {
                if (e.message.includes('UNIQUE constraint failed')) {
                    return { success: false, error: 'DUPLICATE_ORDER' };
                }
                throw e;
            }
        },
        getByOrder(order_id) {
            return _pg('pending_purchases', 'SELECT * FROM pending_purchases WHERE order_id = ?', [order_id], { where: { order_id }, skipRowCheck: true });
        },
        getByUser(user_id) {
            return _pa('pending_purchases', "SELECT * FROM pending_purchases WHERE user_id = ? AND status = 'PENDING' ORDER BY created_at DESC", [user_id]);
        },
        getByTelegram(telegram_id) {
            return _pa('pending_purchases', "SELECT * FROM pending_purchases WHERE telegram_id = ? AND status = 'PENDING' ORDER BY created_at DESC", [String(telegram_id)]);
        },
        updateStatus(order_id, status, updates = {}) {
            const allowed = ['payment_id', 'pix_qr_code', 'pix_expiration'];
            const setClause = ["status = ?", "updated_at = datetime('now')"];
            const values = [status];
            for (const [key, val] of Object.entries(updates)) {
                if (allowed.includes(key)) {
                    setClause.push(`${key} = ?`);
                    values.push(sqlBindValue(val));
                }
            }
            values.push(order_id);
            _pr('pending_purchases', `UPDATE pending_purchases SET ${setClause.join(', ')} WHERE order_id = ?`, values);
        },
        complete(order_id) {
            _pr('pending_purchases', "UPDATE pending_purchases SET status = 'COMPLETED', updated_at = datetime('now') WHERE order_id = ?", [order_id]);
        },
        cancel(order_id) {
            _pr('pending_purchases', "UPDATE pending_purchases SET status = 'CANCELLED', updated_at = datetime('now') WHERE order_id = ?", [order_id]);
        },
        delete(order_id) {
            _pr('pending_purchases', 'DELETE FROM pending_purchases WHERE order_id = ?', [order_id]);
        },
        getExpiredPix() {
            return _pa('pending_purchases', "SELECT * FROM pending_purchases WHERE payment_method = 'pix' AND status = 'PENDING' AND created_at < datetime('now', '-30 minutes')", []);
        },
        getPendingPixForReminder(afterMin = 15, windowMin = 13) {
            const min = Math.max(10, Math.min(60, parseInt(afterMin, 10) || 15));
            const win = Math.max(5, Math.min(30, parseInt(windowMin, 10) || 13));
            return _pa(
                'pending_purchases',
                `SELECT * FROM pending_purchases WHERE payment_method = 'pix' AND status = 'PENDING'
                 AND created_at <= datetime('now', '-${min} minutes')
                 AND created_at > datetime('now', '-${min + win} minutes')`,
                []
            );
        },
        cleanupOld(days = 7) {
            const safeDays = Number.isInteger(days) && days > 0 && days <= 365 ? days : 7;
            const result = _pr('pending_purchases', `DELETE FROM pending_purchases WHERE status != 'PENDING' AND updated_at < datetime('now', '-${safeDays} days')`, []);
            return result.changes;
        },
        deleteExpired(_limitMs) {
            return this.cleanupOld(7);
        }
    },

    // Cupons aplicados - substitui Map cuponsAplicados
    appliedCoupon: {
        apply(user_id, telegram_id, coupon_code, discount_type, discount_value, original_total, final_total, expires_at = null) {
            const db_ = connect();
            const tenantId = _ti();
            try {
                const info = db_.prepare('INSERT INTO applied_coupons (user_id, telegram_id, coupon_code, discount_type, discount_value, original_total, final_total, expires_at, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
                    .run(user_id, String(telegram_id), coupon_code, discount_type, discount_value, original_total, final_total, expires_at, tenantId);
                return { success: true, id: info.lastInsertRowid };
            } catch (e) {
                if (e.message.includes('UNIQUE constraint failed')) {
                    _pr('applied_coupons', "UPDATE applied_coupons SET discount_value = ?, original_total = ?, final_total = ?, applied_at = datetime('now') WHERE user_id = ? AND coupon_code = ?",
                        [discount_value, original_total, final_total, user_id, coupon_code]);
                    return { success: true, updated: true };
                }
                throw e;
            }
        },
        get(user_id, coupon_code) {
            return _pg('applied_coupons', 'SELECT * FROM applied_coupons WHERE user_id = ? AND coupon_code = ?', [user_id, coupon_code]);
        },
        getByUser(user_id) {
            return _pa('applied_coupons', 'SELECT * FROM applied_coupons WHERE user_id = ? ORDER BY applied_at DESC', [user_id]);
        },
        remove(user_id, coupon_code) {
            _pr('applied_coupons', 'DELETE FROM applied_coupons WHERE user_id = ? AND coupon_code = ?', [user_id, coupon_code]);
        },
        clear(user_id) {
            _pr('applied_coupons', 'DELETE FROM applied_coupons WHERE user_id = ?', [user_id]);
        },
        cleanupExpired() {
            const result = _pr('applied_coupons', "DELETE FROM applied_coupons WHERE expires_at IS NOT NULL AND expires_at < datetime('now')", []);
            return result.changes;
        }
    },

    // Sessões de usuário/wizard - substitui Maps de estado
    session: {
        set(user_id, telegram_id, session_type, session_data, ttl_minutes = 30) {
            const db_ = connect();
            const tenantId = _ti();
            const dataJson = JSON.stringify(session_data);
            const expires = new Date(Date.now() + ttl_minutes * 60000).toISOString();
            try {
                const info = db_.prepare('INSERT INTO user_sessions (user_id, telegram_id, session_type, session_data, expires_at, tenant_id) VALUES (?, ?, ?, ?, ?, ?)')
                    .run(user_id, String(telegram_id), session_type, dataJson, expires, tenantId);
                return { success: true, id: info.lastInsertRowid };
            } catch (e) {
                if (e.message.includes('UNIQUE constraint failed')) {
                    _pr('user_sessions', "UPDATE user_sessions SET session_data = ?, expires_at = ?, updated_at = datetime('now') WHERE user_id = ? AND session_type = ?",
                        [dataJson, expires, user_id, session_type]);
                    return { success: true, updated: true };
                }
                throw e;
            }
        },
        get(user_id, session_type) {
            const row = _pg('user_sessions', "SELECT * FROM user_sessions WHERE user_id = ? AND session_type = ? AND expires_at > datetime('now')", [user_id, session_type]);
            if (!row) return null;
            try {
                return { ...row, session_data: JSON.parse(row.session_data) };
            } catch {
                return row;
            }
        },
        getActive(user_id) {
            return _pa('user_sessions', "SELECT * FROM user_sessions WHERE user_id = ? AND expires_at > datetime('now') ORDER BY updated_at DESC", [user_id]);
        },
        delete(user_id, session_type) {
            _pr('user_sessions', 'DELETE FROM user_sessions WHERE user_id = ? AND session_type = ?', [user_id, session_type]);
        },
        deleteAll(user_id) {
            _pr('user_sessions', 'DELETE FROM user_sessions WHERE user_id = ?', [user_id]);
        },
        touch(user_id, session_type, ttl_minutes = 30) {
            const expires = new Date(Date.now() + ttl_minutes * 60000).toISOString();
            _pr('user_sessions', "UPDATE user_sessions SET expires_at = ?, updated_at = datetime('now') WHERE user_id = ? AND session_type = ?",
                [expires, user_id, session_type]);
        },
        cleanupExpired() {
            const result = _pr('user_sessions', "DELETE FROM user_sessions WHERE expires_at < datetime('now')", []);
            return result.changes;
        }
    },

    // Cooldowns de checkout (expires_at sempre em datetime SQLite — evita ISO vs datetime('now'))
    checkoutCooldown: {
        set(user_id, telegram_id, duration_seconds = 30) {
            const db_ = connect();
            const tenantId = _ti();
            const sec = Math.max(1, Math.min(Number(duration_seconds) || 30, 300));
            try {
                db_.prepare(
                    `INSERT INTO checkout_cooldowns (user_id, telegram_id, last_checkout_at, expires_at, tenant_id)
                     VALUES (?, ?, datetime('now'), datetime('now', '+' || ? || ' seconds'), ?)`
                ).run(user_id, String(telegram_id), sec, tenantId);
            } catch (e) {
                if (e.message.includes('UNIQUE constraint failed')) {
                    _pr('checkout_cooldowns',
                        `UPDATE checkout_cooldowns
                         SET last_checkout_at = datetime('now'),
                             expires_at = datetime('now', '+' || ? || ' seconds')
                         WHERE user_id = ?`,
                        [sec, user_id]);
                } else {
                    throw e;
                }
            }
        },
        check(user_id) {
            _pr('checkout_cooldowns', "DELETE FROM checkout_cooldowns WHERE expires_at LIKE '%T%'", []);
            _pr('checkout_cooldowns', "DELETE FROM checkout_cooldowns WHERE expires_at <= datetime('now')", []);
            const row = _pg('checkout_cooldowns',
                `SELECT *,
                    CAST((julianday(expires_at) - julianday('now')) * 86400 AS INTEGER) AS remaining_sec
                 FROM checkout_cooldowns
                 WHERE user_id = ? AND expires_at > datetime('now')`,
                [user_id]);
            if (!row) return { allowed: true };
            const remaining_sec = Math.max(0, Number(row.remaining_sec) || 0);
            if (remaining_sec <= 0) {
                _pr('checkout_cooldowns', 'DELETE FROM checkout_cooldowns WHERE user_id = ?', [user_id]);
                return { allowed: true };
            }
            return {
                allowed: false,
                remaining_ms: remaining_sec * 1000,
                remaining_sec,
            };
        },
        isOnCooldown(user_id) {
            return !this.check(user_id).allowed;
        },
        getRemainingSeconds(user_id) {
            const result = this.check(user_id);
            return result.remaining_sec || 0;
        },
        clear(user_id) {
            _pr('checkout_cooldowns', 'DELETE FROM checkout_cooldowns WHERE user_id = ?', [user_id]);
        },
        cleanupExpired() {
            const legacy = _pr('checkout_cooldowns', "DELETE FROM checkout_cooldowns WHERE expires_at LIKE '%T%'", []);
            const expired = _pr('checkout_cooldowns', "DELETE FROM checkout_cooldowns WHERE expires_at <= datetime('now')", []);
            return (legacy.changes || 0) + (expired.changes || 0);
        },
    },

    menuMessage: {
        set(chat_id, message_id, menu_type = null, meta = {}) {
            withSqliteRetry(() => {
                const db_ = connect();
                const tenantId = _ti();
                const cid = String(chat_id);
                const message_type = meta.message_type || 'text';
                const text_preview = meta.text_preview != null ? String(meta.text_preview).slice(0, 400) : null;
                const existing = _pg('last_menu_messages', 'SELECT chat_id FROM last_menu_messages WHERE chat_id = ?', [cid], { skipRowCheck: true });
                if (existing) {
                    _pr('last_menu_messages',
                        `UPDATE last_menu_messages SET message_id = ?, menu_type = ?, message_type = ?,
                     text_preview = COALESCE(?, text_preview), updated_at = datetime('now') WHERE chat_id = ?`,
                        [message_id, menu_type, message_type, text_preview, cid]);
                } else {
                    db_.prepare(
                        `INSERT INTO last_menu_messages (chat_id, message_id, menu_type, message_type, text_preview, tenant_id)
                     VALUES (?, ?, ?, ?, ?, ?)`
                    ).run(cid, message_id, menu_type, message_type, text_preview, tenantId);
                }
            });
        },
        get(chat_id) {
            return _pg('last_menu_messages', 'SELECT * FROM last_menu_messages WHERE chat_id = ?', [String(chat_id)], { skipRowCheck: true });
        },
        delete(chat_id) {
            withSqliteRetry(() => {
                _pr('last_menu_messages', 'DELETE FROM last_menu_messages WHERE chat_id = ?', [String(chat_id)]);
            });
        },
        count() {
            return _pg('last_menu_messages', 'SELECT COUNT(*) AS c FROM last_menu_messages', [])?.c || 0;
        },
    },

    // notification já definido acima — bloco removido para evitar sobrescrita

    // Log de auditoria
    audit: {
        log(user_id, telegram_id, action, entity_type = null, entity_id = null, old_value = null, new_value = null, metadata = null) {
            const tenantId = _ti();
            connect().prepare('INSERT INTO audit_logs (user_id, telegram_id, action, entity_type, entity_id, old_value, new_value, metadata, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
                .run(user_id, String(telegram_id), action, entity_type, entity_id, old_value ? JSON.stringify(old_value) : null, new_value ? JSON.stringify(new_value) : null, metadata ? JSON.stringify(metadata) : null, tenantId);
        },
        getRecent(limit = 100) {
            return _pa('audit_logs', 'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?', [limit]);
        },
        getByUser(user_id, limit = 50) {
            return _pa('audit_logs', 'SELECT * FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', [user_id, limit]);
        },
        getByAction(action, limit = 50) {
            return _pa('audit_logs', 'SELECT * FROM audit_logs WHERE action = ? ORDER BY created_at DESC LIMIT ?', [action, limit]);
        },
        cleanupOld(days = 30) {
            const safeDays = Number.isInteger(days) && days > 0 && days <= 365 ? days : 30;
            const result = _pr('audit_logs', `DELETE FROM audit_logs WHERE created_at < datetime('now', '-${safeDays} days')`, []);
            return result.changes;
        }
    },

    waAdminAudit: {
        insert(row) {
            connect()
                .prepare(
                    `INSERT INTO wa_admin_audit (telegram_id, command, command_id, args_json, ok, result_json, error)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`
                )
                .run(
                    String(row.telegramId || ''),
                    String(row.command || ''),
                    row.commandId ? String(row.commandId) : null,
                    row.args != null ? JSON.stringify(row.args) : null,
                    row.ok ? 1 : 0,
                    row.result != null ? JSON.stringify(row.result) : null,
                    row.error ? String(row.error) : null
                );
        },
        recent(limit = 50) {
            return connect()
                .prepare('SELECT * FROM wa_admin_audit ORDER BY id DESC LIMIT ?')
                .all(Math.min(limit, 200));
        },
        cleanupOld(days = 60) {
            const safeDays = Number.isInteger(days) && days > 0 && days <= 365 ? days : 60;
            return connect()
                .prepare(`DELETE FROM wa_admin_audit WHERE created_at < datetime('now', '-${safeDays} days')`)
                .run().changes;
        },
    },

    telegramEventAudit: {
        insert(row) {
            connect()
                .prepare(
                    `INSERT INTO telegram_event_audit (
                        event_type, route, route_executed,
                        chat_id, chat_type, chat_title,
                        user_id, username, first_name,
                        message_id, message_text, callback_data,
                        skip_user_pipeline, is_real_user_message,
                        is_private, is_group, is_supergroup, is_channel,
                        is_debug, event_ts
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                )
                .run(
                    String(row.event_type || 'other'),
                    String(row.route || 'system'),
                    row.route_executed ? String(row.route_executed) : null,
                    row.chat_id != null ? String(row.chat_id) : null,
                    row.chat_type || null,
                    row.chat_title || null,
                    row.user_id != null ? String(row.user_id) : null,
                    row.username || null,
                    row.first_name || null,
                    row.message_id != null ? Number(row.message_id) : null,
                    row.message_text ? String(row.message_text).slice(0, 200) : null,
                    row.callback_data ? String(row.callback_data).slice(0, 80) : null,
                    row.skip_user_pipeline ? 1 : 0,
                    row.is_real_user_message ? 1 : 0,
                    row.is_private ? 1 : 0,
                    row.is_group ? 1 : 0,
                    row.is_supergroup ? 1 : 0,
                    row.is_channel ? 1 : 0,
                    row.is_debug ? 1 : 0,
                    row.event_ts != null ? Number(row.event_ts) : Math.floor(Date.now() / 1000)
                );
        },
        recent(limit = 50) {
            return connect()
                .prepare('SELECT * FROM telegram_event_audit ORDER BY id DESC LIMIT ?')
                .all(Math.min(limit, 500));
        },
        byEventType(eventType, limit = 50) {
            return connect()
                .prepare(
                    'SELECT * FROM telegram_event_audit WHERE event_type = ? ORDER BY id DESC LIMIT ?'
                )
                .all(String(eventType), Math.min(limit, 500));
        },
        byChatId(chatId, limit = 50) {
            return connect()
                .prepare(
                    'SELECT * FROM telegram_event_audit WHERE chat_id = ? ORDER BY id DESC LIMIT ?'
                )
                .all(String(chatId), Math.min(limit, 500));
        },
        cleanupOld(days = 30) {
            const safeDays = Number.isInteger(days) && days > 0 && days <= 365 ? days : 30;
            return connect()
                .prepare(
                    `DELETE FROM telegram_event_audit WHERE created_at < datetime('now', '-${safeDays} days')`
                )
                .run().changes;
        },
    },

    // Webhooks processados - deduplicação persistente (3ª linha de defesa)
    processedWebhook: {
        isProcessed(payment_id) {
            try {
                return !!_pg('processed_webhooks', 'SELECT 1 as ok FROM processed_webhooks WHERE payment_id = ?', [String(payment_id)], { where: { payment_id: String(payment_id) }, skipRowCheck: true });
            } catch { return false; }
        },
        markProcessed(payment_id, order_id, processed_at = new Date().toISOString()) {
            try {
                const tenantId = _ti();
                connect().prepare('INSERT OR IGNORE INTO processed_webhooks (payment_id, order_id, processed_at, tenant_id) VALUES (?,?,?,?)')
                    .run(String(payment_id), order_id, processed_at, tenantId);
                return true;
            } catch { return false; }
        },
        cleanupOld(days = 7) {
            try {
                const safeDays = Number.isInteger(days) && days > 0 && days <= 365 ? days : 7;
                const result = _pr('processed_webhooks', `DELETE FROM processed_webhooks WHERE processed_at < datetime('now', '-${safeDays} days')`, []);
                return result.changes;
            } catch { return 0; }
        }
    },

    // Limpeza geral de todos os estados expirados
    cleanup: {
        all() {
            const results = {
                sessions: prisma.session.cleanupExpired(),
                cooldowns: prisma.checkoutCooldown.cleanupExpired(),
                carts: prisma.cart.cleanupOld(30),
                coupons: prisma.appliedCoupon.cleanupExpired(),
                pending: prisma.pendingPurchase.cleanupOld(7),
                audits: prisma.audit.cleanupOld(30),
                telegramEvents: prisma.telegramEventAudit.cleanupOld(30),
                webhooks: prisma.processedWebhook.cleanupOld(7)
            };
            logger.info('[CLEANUP] Resultados:', results);
            return results;
        }
    },

    // Cashback
    cashback: {
        create(user_id, order_id, purchase_amount, percent = 5) {
            const db_ = connect();
            const tenantId = _ti();
            const amount = (purchase_amount * percent / 100);
            const info = db_.prepare("INSERT INTO cashback (user_id, order_id, purchase_amount, cashback_percent, cashback_amount, available_date, tenant_id) VALUES (?,?,?,?,?,datetime('now', '+7 days'),?)")
                .run(user_id, order_id, purchase_amount, percent, amount, tenantId);
            return { id: info.lastInsertRowid, amount };
        },
        getAvailable(user_id) {
            const row = _pg('cashback',
                "SELECT COALESCE(SUM(cashback_amount), 0) as total FROM cashback WHERE user_id=? AND status='available'",
                [user_id]);
            return Number(row?.total ?? 0);
        },
        getPending(user_id) {
            const row = _pg('cashback',
                "SELECT COALESCE(SUM(cashback_amount), 0) as total FROM cashback WHERE user_id=? AND status='pending'",
                [user_id]);
            return Number(row?.total ?? 0);
        },
        getTotal(user_id) {
            const row = _pg('cashback', 'SELECT COALESCE(SUM(cashback_amount), 0) as total FROM cashback WHERE user_id=?', [user_id]);
            return Number(row?.total ?? 0);
        },
        markAvailable(id) {
            _pr('cashback', "UPDATE cashback SET status='available' WHERE id=?", [id]);
        },
        use(user_id, amount) {
            const available = _pg('cashback', "SELECT COALESCE(SUM(cashback_amount), 0) as total FROM cashback WHERE user_id=? AND status='available'", [user_id])?.total || 0;
            if (available < amount) return false;
            _pr('cashback', "UPDATE cashback SET status='used', used_date=datetime('now') WHERE user_id=? AND status='available' LIMIT 1", [user_id]);
            return true;
        },
        processPending() {
            _pr('cashback', "UPDATE cashback SET status='available' WHERE status='pending' AND date(available_date) <= date('now')", []);
        },
    },

    // Sorteios/Giveaways
    giveaway: {
        create(name, description, prize, prize_value, start_date, end_date, draw_date, min_purchase = 0) {
            const db_ = connect();
            const tenantId = _ti();
            const info = db_.prepare('INSERT INTO giveaways (name, description, prize, prize_value, start_date, end_date, draw_date, min_purchase, tenant_id) VALUES (?,?,?,?,?,?,?,?,?)')
                .run(name, description, prize, prize_value, start_date, end_date, draw_date, min_purchase, tenantId);
            return info.lastInsertRowid;
        },
        findActive() {
            return _pa('giveaways', "SELECT * FROM giveaways WHERE status='active' AND date('now') BETWEEN date(start_date) AND date(end_date)", []);
        },
        findById(id) {
            return _pg('giveaways', 'SELECT * FROM giveaways WHERE id=?', [id]);
        },
        participate(giveaway_id, user_id, tickets = 1) {
            try {
                const tenantId = _ti();
                connect().prepare('INSERT INTO giveaway_participants (giveaway_id, user_id, tickets, tenant_id) VALUES (?,?,?,?)').run(giveaway_id, user_id, tickets, tenantId);
                return true;
            } catch { return false; }
        },
        isParticipant(giveaway_id, user_id) {
            return !!_pg('giveaway_participants', 'SELECT id FROM giveaway_participants WHERE giveaway_id=? AND user_id=?', [giveaway_id, user_id]);
        },
        getParticipants(giveaway_id) {
            return _pa('giveaway_participants', 'SELECT * FROM giveaway_participants WHERE giveaway_id=?', [giveaway_id]);
        },
        drawWinner(giveaway_id) {
            const participants = _pa('giveaway_participants', 'SELECT * FROM giveaway_participants WHERE giveaway_id=?', [giveaway_id]);
            if (participants.length === 0) return null;

            const totalTickets = participants.reduce((sum, p) => sum + p.tickets, 0);
            let random = Math.floor(Math.random() * totalTickets);

            for (const p of participants) {
                random -= p.tickets;
                if (random < 0) {
                    _pr('giveaways', "UPDATE giveaways SET winner_id=?, status='completed' WHERE id=?", [p.user_id, giveaway_id]);
                    return p.user_id;
                }
            }
            return null;
        },
    },
};

// ─── BANNED USERS (persistente no banco, não em arquivo JSON) ─────────────────
prisma.banned = {
    add(user_id, telegram_id, reason = 'spam', duration_minutes = 60) {
        const db_ = connect();
        const tenantId = _ti();
        const expires = duration_minutes > 0
            ? new Date(Date.now() + duration_minutes * 60000).toISOString()
            : null;
        try {
            db_.prepare('INSERT INTO spam_bans (user_id, telegram_id, reason, expires_at, tenant_id) VALUES (?, ?, ?, ?, ?)')
                .run(user_id || 0, String(telegram_id), reason, expires, tenantId);
            return { success: true };
        } catch (e) {
            if (e.message.includes('UNIQUE constraint failed')) {
                _pr('spam_bans', "UPDATE spam_bans SET expires_at = ?, banned_at = datetime('now'), reason = ? WHERE telegram_id = ?",
                    [expires, reason, String(telegram_id)]);
                return { success: true, updated: true };
            }
            throw e;
        }
    },
    isBanned(telegram_id) {
        return !!_pg('spam_bans', "SELECT id FROM spam_bans WHERE telegram_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))", [String(telegram_id)], { skipRowCheck: true });
    },
    remove(telegram_id) {
        _pr('spam_bans', 'DELETE FROM spam_bans WHERE telegram_id = ?', [String(telegram_id)]);
    },
    getActive() {
        return _pa('spam_bans', "SELECT * FROM spam_bans WHERE expires_at IS NULL OR expires_at > datetime('now') ORDER BY banned_at DESC", []);
    },
    cleanupExpired() {
        const result = _pr('spam_bans', "DELETE FROM spam_bans WHERE expires_at IS NOT NULL AND expires_at < datetime('now')", []);
        return result.changes;
    }
};

// ─── SISTEMA DE ASSINATURAS PREMIUM ─────────────────────────────────────────
prisma.subscription = {
    // Criar nova assinatura
    create({ user_id, telegram_id, plan_name = 'Premium', plan_value = 29.90, billing_cycle = 'monthly' }) {
        const db_ = connect();
        const now = new Date();
        const nextPayment = new Date(now);
        nextPayment.setMonth(nextPayment.getMonth() + 1);
        const result = db_.prepare(`
            INSERT INTO subscriptions (user_id, telegram_id, plan_name, plan_value, billing_cycle, status, last_payment_date, next_payment_date, total_payments, total_paid)
            VALUES (?, ?, ?, ?, ?, 'active', ?, ?, 1, ?)
        `).run(user_id, telegram_id, plan_name, plan_value, billing_cycle, now.toISOString(), nextPayment.toISOString(), plan_value);
        db_.prepare('UPDATE users SET is_premium = 1 WHERE id = ?').run(user_id);
        return result.lastInsertRowid;
    },
    // Buscar assinatura ativa do usuário (inclui cancelada até vencer)
    findActive(user_id) {
        const db_ = connect();
        return db_.prepare(`
            SELECT * FROM subscriptions
            WHERE user_id = ? AND status IN ('active', 'cancelled')
            AND datetime(replace(substr(next_payment_date, 1, 19), 'T', ' ')) > datetime('now')
            ORDER BY id DESC LIMIT 1
        `).get(user_id) || null;
    },
    findByUser(user_id) {
        const db_ = connect();
        return db_.prepare('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(user_id) || null;
    },
    // Verificar se usuário é assinante ativo
    isActive(user_id) {
        return !!this.findActive(user_id);
    },
    // Renovar assinatura (após pagamento recorrente)
    renew(user_id, payment_amount) {
        const db_ = connect();
        const now = new Date();
        const nextPayment = new Date(now);
        nextPayment.setMonth(nextPayment.getMonth() + 1);
        const result = db_.prepare(`
            UPDATE subscriptions SET last_payment_date = ?, next_payment_date = ?, total_payments = total_payments + 1, total_paid = total_paid + ?
            WHERE user_id = ? AND status = 'active'
        `).run(now.toISOString(), nextPayment.toISOString(), payment_amount, user_id);
        db_.prepare('UPDATE users SET is_premium = 1 WHERE id = ?').run(user_id);
        return result.changes > 0;
    },
    // Cancelar assinatura
    cancel(user_id) {
        const db_ = connect();
        return db_.prepare(`
            UPDATE subscriptions SET status = 'cancelled', cancelled_at = datetime('now') WHERE user_id = ? AND status = 'active'
        `).run(user_id).changes > 0;
    },
    listActive() {
        return this.findAllActive();
    },
    // Expirar assinaturas vencidas (chamar periodicamente)
    expireOld() {
        const db_ = connect();
        const r = db_.prepare(`
            UPDATE subscriptions SET status = 'expired'
            WHERE status IN ('active', 'cancelled')
            AND datetime(replace(substr(next_payment_date, 1, 19), 'T', ' ')) <= datetime('now')
        `).run();
        db_.prepare(`
            UPDATE users SET is_premium = 0
            WHERE id IN (
                SELECT user_id FROM subscriptions
                WHERE status = 'expired'
                OR (status IN ('active','cancelled') AND datetime(replace(substr(next_payment_date, 1, 19), 'T', ' ')) <= datetime('now'))
            )
        `).run();
        return r.changes;
    },
    // Buscar todas as assinaturas ativas
    findAllActive() {
        const db_ = connect();
        return db_.prepare(`
            SELECT s.*, u.first_name, u.username FROM subscriptions s LEFT JOIN users u ON u.id = s.user_id WHERE s.status = 'active' ORDER BY s.next_payment_date
        `).all();
    },
    // Estatísticas de assinaturas
    stats() {
        const db_ = connect();
        const active = db_.prepare("SELECT COUNT(*) as c FROM subscriptions WHERE status = 'active'").get().c;
        const total = db_.prepare("SELECT COUNT(*) as c FROM subscriptions").get().c;
        const revenue = db_.prepare("SELECT COALESCE(SUM(total_paid), 0) as total FROM subscriptions").get().total;
        return { active, total, revenue };
    }
};

// ─── SMM (FornecedorBrasil) ─────────────────────────────────────────────────
const { CATALOG_SERVICE_TYPE_SQL: SMM_CATALOG_TYPE_SQL } = require('../modules/smm/constants/serviceTypes');

prisma.smmService = {
    upsert(row) {
        const db_ = connect();
        const existing = db_.prepare(
            'SELECT id, cost_price, active, description FROM smm_services WHERE provider = ? AND provider_service_id = ?'
        ).get(row.provider, row.provider_service_id);
        if (existing) {
            const keepDesc =
                String(row.description || '').trim().length > 0
                    ? row.description
                    : (existing.description || '');
            // Preserva curadoria: sync não reativa serviços desligados manualmente.
            const keepActive = Number(existing.active) === 0 ? 0 : row.active !== false ? 1 : 0;
            db_.prepare(`
                UPDATE smm_services SET
                    platform = ?, subcategory = ?, name = ?, description = ?, service_type = ?,
                    category_raw = ?, cost_price = ?, sale_price = ?, min_quantity = ?, max_quantity = ?,
                    refill = ?, cancel = ?, dripfeed = ?, active = ?,
                    service_family = ?, service_score = ?,
                    updated_at = datetime('now')
                WHERE id = ?
            `).run(
                row.platform, row.subcategory, row.name, keepDesc || '', row.service_type || 'Default',
                row.category_raw || '', row.cost_price, row.sale_price, row.min_quantity, row.max_quantity,
                row.refill ? 1 : 0, row.cancel ? 1 : 0, row.dripfeed ? 1 : 0, keepActive,
                row.service_family || null, Number(row.service_score) || 0,
                existing.id
            );
            return { id: existing.id, created: false, oldCost: existing.cost_price };
        }
        const info = db_.prepare(`
            INSERT INTO smm_services (
                provider, provider_service_id, platform, subcategory, name, description, service_type,
                category_raw, cost_price, sale_price, min_quantity, max_quantity, refill, cancel, dripfeed,
                active, service_family, service_score
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            row.provider, row.provider_service_id, row.platform, row.subcategory, row.name,
            row.description || '', row.service_type || 'Default', row.category_raw || '',
            row.cost_price, row.sale_price, row.min_quantity, row.max_quantity,
            row.refill ? 1 : 0, row.cancel ? 1 : 0, row.dripfeed ? 1 : 0, row.active !== false ? 1 : 0,
            row.service_family || null, Number(row.service_score) || 0
        );
        return { id: info.lastInsertRowid, created: true, oldCost: null };
    },
    findById(id) {
        return connect().prepare('SELECT * FROM smm_services WHERE id = ?').get(id) || null;
    },
    findByProviderId(provider, providerServiceId) {
        return connect().prepare(
            'SELECT * FROM smm_services WHERE provider = ? AND provider_service_id = ?'
        ).get(provider, providerServiceId) || null;
    },
    countActive() {
        return connect().prepare('SELECT COUNT(*) as c FROM smm_services WHERE active = 1').get().c;
    },
    countAll() {
        return connect().prepare('SELECT COUNT(*) as c FROM smm_services').get().c;
    },
    listPlatforms() {
        return connect().prepare(`
            SELECT platform, COUNT(DISTINCT service_family) as total FROM smm_services
            WHERE active = 1 AND ${SMM_CATALOG_TYPE_SQL}
              AND service_family IS NOT NULL AND service_family != ''
              AND COALESCE(service_health, 'HEALTHY') NOT IN ('DEGRADED', 'DISABLED')
            GROUP BY platform ORDER BY total DESC
        `).all();
    },
    listSubcategories(platform) {
        return connect().prepare(`
            SELECT subcategory, COUNT(DISTINCT service_family) as total FROM smm_services
            WHERE active = 1 AND platform = ? AND ${SMM_CATALOG_TYPE_SQL}
              AND service_family IS NOT NULL AND service_family != ''
              AND COALESCE(service_health, 'HEALTHY') NOT IN ('DEGRADED', 'DISABLED')
            GROUP BY subcategory ORDER BY total DESC
        `).all(platform);
    },
    listByPlatformSub(platform, subcategory, limit = 10, offset = 0) {
        return connect().prepare(`
            SELECT * FROM smm_services
            WHERE active = 1 AND platform = ? AND subcategory = ?
              AND ${SMM_CATALOG_TYPE_SQL}
              AND COALESCE(service_health, 'HEALTHY') NOT IN ('DEGRADED', 'DISABLED')
            ORDER BY service_score DESC, sale_price ASC LIMIT ? OFFSET ?
        `).all(platform, subcategory, limit, offset);
    },
    listAllByPlatformSub(platform, subcategory) {
        return connect().prepare(`
            SELECT * FROM smm_services
            WHERE active = 1 AND platform = ? AND subcategory = ?
              AND ${SMM_CATALOG_TYPE_SQL}
              AND COALESCE(service_health, 'HEALTHY') NOT IN ('DEGRADED', 'DISABLED')
            ORDER BY service_score DESC, sale_price ASC
        `).all(platform, subcategory);
    },
    search(query, limit = 20) {
        const tokens = String(query || '')
            .trim()
            .toLowerCase()
            .split(/\s+/)
            .filter((t) => t.length >= 2);
        if (!tokens.length) return [];

        const all = connect().prepare(
            `SELECT * FROM smm_services
             WHERE active = 1 AND ${SMM_CATALOG_TYPE_SQL}
               AND COALESCE(service_health, 'HEALTHY') NOT IN ('DEGRADED', 'DISABLED')
             ORDER BY sale_price ASC LIMIT 500`
        ).all();

        const scored = [];
        for (const row of all) {
            const hay = `${row.name} ${row.platform} ${row.subcategory} ${row.category_raw}`.toLowerCase();
            const hits = tokens.filter((t) => hay.includes(t)).length;
            if (hits === tokens.length) {
                scored.push({ row, hits });
            } else if (tokens.length === 1 && hay.includes(tokens[0])) {
                scored.push({ row, hits: 1 });
            }
        }
        scored.sort((a, b) => b.hits - a.hits);
        return scored.slice(0, limit).map((s) => s.row);
    },
    deactivateMissing(provider, activeIds) {
        const db_ = connect();
        if (!activeIds.length) return 0;
        const placeholders = activeIds.map(() => '?').join(',');
        const r = db_.prepare(`
            UPDATE smm_services SET active = 0, updated_at = datetime('now')
            WHERE provider = ? AND provider_service_id NOT IN (${placeholders}) AND active = 1
        `).run(provider, ...activeIds);
        return r.changes;
    },
    listByFamily(serviceFamily, activeOnly = true) {
        const db_ = connect();
        const activeSql = activeOnly ? 'AND active = 1' : '';
        return db_.prepare(`
            SELECT * FROM smm_services
            WHERE service_family = ? ${activeSql}
              AND ${SMM_CATALOG_TYPE_SQL}
            ORDER BY service_score DESC, cost_price ASC
        `).all(serviceFamily);
    },
    findBestInFamily(serviceFamily) {
        const rows = connect().prepare(`
            SELECT * FROM smm_services
            WHERE service_family = ? AND active = 1
              AND ${SMM_CATALOG_TYPE_SQL}
              AND COALESCE(service_health, 'HEALTHY') NOT IN ('DEGRADED', 'DISABLED')
            ORDER BY service_score DESC, cost_price ASC
        `).all(serviceFamily);
        return rows[0] || null;
    },
    countFamilies(activeOnly = true) {
        const db_ = connect();
        const conds = ['service_family IS NOT NULL', "service_family != ''"];
        if (activeOnly) {
            conds.push('active = 1');
            conds.push(SMM_CATALOG_TYPE_SQL);
        }
        return db_.prepare(`
            SELECT COUNT(DISTINCT service_family) as c FROM smm_services
            WHERE ${conds.join(' AND ')}
        `).get().c;
    },
    refreshFamilyScores() {
        const { scoreRowsInFamily } = require('../modules/smm/services/familyService');
        const db_ = connect();
        const families = db_.prepare(`
            SELECT DISTINCT service_family FROM smm_services
            WHERE service_family IS NOT NULL AND service_family != ''
        `).all();

        const update = db_.prepare(
            'UPDATE smm_services SET service_score = ?, updated_at = datetime(\'now\') WHERE id = ?'
        );
        let updated = 0;
        const tx = db_.transaction((familyRows) => {
            for (const { service_family: fam } of familyRows) {
                const members = db_.prepare('SELECT * FROM smm_services WHERE service_family = ?').all(fam);
                const scored = scoreRowsInFamily(members);
                for (const row of scored) {
                    update.run(row.service_score, row.id);
                    updated++;
                }
            }
        });
        tx(families);

        const activeFamilies = db_.prepare(`
            SELECT COUNT(DISTINCT service_family) as c FROM smm_services
            WHERE active = 1 AND service_family IS NOT NULL AND service_family != ''
              AND ${SMM_CATALOG_TYPE_SQL}
        `).get().c;

        return { updated, families: activeFamilies };
    },
    getOrderHealthCounts(serviceId, windowDays = 30) {
        const db_ = connect();
        const rows = db_.prepare(`
            SELECT status, COUNT(*) as c FROM smm_orders
            WHERE service_id = ?
              AND created_at >= datetime('now', '-' || ? || ' days')
              AND status IN ('completed', 'failed', 'canceled')
            GROUP BY status
        `).all(serviceId, windowDays);
        const out = { completed: 0, failed: 0, canceled: 0 };
        for (const r of rows) {
            if (r.status in out) out[r.status] = r.c;
        }
        return out;
    },
    listIdsForHealthRecalc(windowDays = 30) {
        return connect().prepare(`
            SELECT DISTINCT service_id as id FROM smm_orders
            WHERE created_at >= datetime('now', '-' || ? || ' days')
            UNION
            SELECT id FROM smm_services WHERE active = 1
        `).all(windowDays).map((r) => r.id);
    },
    updateHealth(serviceId, health, deactivate = false) {
        const db_ = connect();
        if (deactivate) {
            return db_.prepare(`
                UPDATE smm_services
                SET service_health = ?, active = 0, updated_at = datetime('now')
                WHERE id = ?
            `).run(health, serviceId).changes;
        }
        return db_.prepare(`
            UPDATE smm_services SET service_health = ?, updated_at = datetime('now') WHERE id = ?
        `).run(health, serviceId).changes;
    },
    countByHealth(activeOnly = true) {
        const cond = activeOnly ? 'WHERE active = 1' : '';
        const rows = connect().prepare(`
            SELECT COALESCE(service_health, 'HEALTHY') as health, COUNT(*) as c
            FROM smm_services ${cond}
            GROUP BY COALESCE(service_health, 'HEALTHY')
        `).all();
        const out = { HEALTHY: 0, WARNING: 0, DEGRADED: 0, DISABLED: 0 };
        for (const r of rows) {
            const k = String(r.health || 'HEALTHY').toUpperCase();
            out[k] = (out[k] || 0) + r.c;
        }
        return out;
    },
};

prisma.smmOrder = {
    create(row) {
        const info = connect().prepare(`
            INSERT INTO smm_orders (
                telegram_id, hanork_order_id, provider, provider_used, provider_order_id, service_id,
                link, quantity, cost, sale_price, profit, status, refill_id, provider_comments
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            String(row.telegram_id), row.hanork_order_id || null, row.provider || 'fornecedorbrasil',
            row.provider_used || null, row.provider_order_id || null, row.service_id, row.link || '',
            row.quantity || 0, row.cost || 0, row.sale_price || 0, row.profit || 0,
            row.status || 'pending', row.refill_id || null, row.provider_comments || null
        );
        return { id: info.lastInsertRowid };
    },
    updateStatus(id, status, extra = {}) {
        const sets = ['status = ?', "updated_at = datetime('now')"];
        const vals = [status];
        if (extra.provider_order_id != null) { sets.push('provider_order_id = ?'); vals.push(extra.provider_order_id); }
        if (extra.provider_used != null) { sets.push('provider_used = ?'); vals.push(extra.provider_used); }
        if (extra.refill_id != null) { sets.push('refill_id = ?'); vals.push(extra.refill_id); }
        if (extra.hanork_order_id != null) { sets.push('hanork_order_id = ?'); vals.push(extra.hanork_order_id); }
        if (extra.service_id != null) { sets.push('service_id = ?'); vals.push(extra.service_id); }
        if (extra.cost != null) { sets.push('cost = ?'); vals.push(extra.cost); }
        if (extra.profit != null) { sets.push('profit = ?'); vals.push(extra.profit); }
        vals.push(id);
        connect().prepare(`UPDATE smm_orders SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    },
    findById(id) {
        return connect().prepare('SELECT * FROM smm_orders WHERE id = ?').get(id) || null;
    },
    findByHanorkOrderId(hanorkOrderId) {
        return connect().prepare('SELECT * FROM smm_orders WHERE hanork_order_id = ?').get(hanorkOrderId) || null;
    },
    listByStatus(statuses, limit = 100) {
        const list = Array.isArray(statuses) ? statuses : [statuses];
        const placeholders = list.map(() => '?').join(',');
        return connect().prepare(`
            SELECT * FROM smm_orders WHERE status IN (${placeholders})
            ORDER BY updated_at ASC LIMIT ?
        `).all(...list, limit);
    },
    stats() {
        const db_ = connect();
        const total = db_.prepare('SELECT COUNT(*) as c FROM smm_orders').get().c;
        const profit = db_.prepare('SELECT COALESCE(SUM(profit), 0) as p FROM smm_orders WHERE status = ?').get('completed').p;
        return { total, profit: Number(profit) };
    },
    listByTelegram(telegramId, limit = 10) {
        return connect().prepare(`
            SELECT * FROM smm_orders WHERE telegram_id = ?
            ORDER BY id DESC LIMIT ?
        `).all(String(telegramId), limit);
    },
    findRecentDuplicate(telegramId, serviceId, link, quantity, withinMinutes = 15) {
        return connect().prepare(`
            SELECT id FROM smm_orders
            WHERE telegram_id = ? AND service_id = ? AND link = ? AND quantity = ?
              AND status IN ('awaiting_payment', 'paid', 'submitted', 'processing', 'partial')
              AND created_at > datetime('now', ? || ' minutes')
            LIMIT 1
        `).get(String(telegramId), serviceId, link, quantity, `-${withinMinutes}`) || null;
    },
    listRefillPending(limit = 30) {
        return connect().prepare(`
            SELECT * FROM smm_orders
            WHERE status = 'refill_pending' AND refill_id IS NOT NULL
            ORDER BY updated_at ASC LIMIT ?
        `).all(limit);
    },
};

prisma.smmOrderEvent = {
    record(smmOrderId, eventType, detail) {
        const info = connect().prepare(
            'INSERT INTO smm_order_events (smm_order_id, event_type, detail) VALUES (?, ?, ?)'
        ).run(smmOrderId, eventType, detail ? String(detail).slice(0, 500) : null);
        return info.lastInsertRowid;
    },
    listByOrder(smmOrderId, limit = 20) {
        return connect().prepare(
            'SELECT * FROM smm_order_events WHERE smm_order_id = ? ORDER BY id DESC LIMIT ?'
        ).all(smmOrderId, limit);
    },
};

prisma.virtuoService = {
    upsert(row) {
        connect().prepare(`
            INSERT INTO virtuo_services (
                service_code, service_name, country_id, country_name,
                cost_price, sale_price, available, server, active, synced_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(service_code, country_id, server) DO UPDATE SET
                service_name = excluded.service_name,
                country_name = excluded.country_name,
                cost_price = excluded.cost_price,
                sale_price = excluded.sale_price,
                available = excluded.available,
                active = excluded.active,
                synced_at = datetime('now')
        `).run(
            row.service_code,
            row.service_name,
            row.country_id,
            row.country_name,
            row.cost_price,
            row.sale_price,
            row.available,
            row.server || 1,
            row.active != null ? row.active : 1
        );
    },
    listActiveByServiceCode(serviceCode) {
        return connect().prepare(`
            SELECT * FROM virtuo_services
            WHERE service_code = ? AND active = 1 AND available > 0
            ORDER BY sale_price ASC, country_name ASC
        `).all(String(serviceCode));
    },
    countActiveByServiceCode(serviceCode) {
        return connect()
            .prepare(
                `SELECT COUNT(*) as c FROM virtuo_services
                 WHERE service_code = ? AND active = 1 AND available > 0`
            )
            .get(String(serviceCode)).c;
    },
    listActiveByServiceCodePage(serviceCode, page = 0, pageSize = 8) {
        const limit = Math.max(1, Number(pageSize) || 8);
        const offset = Math.max(0, Number(page) || 0) * limit;
        return connect()
            .prepare(
                `SELECT * FROM virtuo_services
                 WHERE service_code = ? AND active = 1 AND available > 0
                 ORDER BY sale_price ASC, country_name ASC
                 LIMIT ? OFFSET ?`
            )
            .all(String(serviceCode), limit, offset);
    },
    searchActiveByServiceCodeName(serviceCode, query, limit = 12) {
        const q = `%${String(query || '').trim().toLowerCase()}%`;
        if (!q || q === '%%') return [];
        return connect()
            .prepare(
                `SELECT * FROM virtuo_services
                 WHERE service_code = ? AND active = 1 AND available > 0
                 AND lower(country_name) LIKE ?
                 ORDER BY sale_price ASC, country_name ASC
                 LIMIT ?`
            )
            .all(String(serviceCode), q, Math.max(1, Number(limit) || 12));
    },
    searchActiveGlobal(query, limit = 15) {
        const q = `%${String(query || '').trim().toLowerCase()}%`;
        if (!q || q === '%%') return [];
        return connect()
            .prepare(
                `SELECT * FROM virtuo_services
                 WHERE active = 1 AND available > 0
                 AND (lower(country_name) LIKE ? OR lower(service_name) LIKE ?)
                 ORDER BY service_code ASC, sale_price ASC, country_name ASC
                 LIMIT ?`
            )
            .all(q, q, Math.max(1, Number(limit) || 15));
    },
    findActiveByCountryNames(serviceCode, names = []) {
        const list = Array.isArray(names) ? names : [names];
        for (const raw of list) {
            const n = String(raw || '').trim().toLowerCase();
            if (!n) continue;
            const row = connect()
                .prepare(
                    `SELECT * FROM virtuo_services
                     WHERE service_code = ? AND active = 1 AND available > 0
                     AND lower(country_name) LIKE ?
                     ORDER BY sale_price ASC
                     LIMIT 1`
                )
                .get(String(serviceCode), `%${n}%`);
            if (row) return row;
        }
        return null;
    },
    listDistinctServiceCodes() {
        return connect().prepare(`
            SELECT DISTINCT service_code FROM virtuo_services WHERE active = 1 AND available > 0
        `).all();
    },
    findById(id) {
        return connect().prepare('SELECT * FROM virtuo_services WHERE id = ?').get(id) || null;
    },
    findByComposite(serviceCode, countryId, server = 1) {
        return connect().prepare(
            'SELECT * FROM virtuo_services WHERE service_code = ? AND country_id = ? AND server = ?'
        ).get(String(serviceCode), Number(countryId), Number(server) || 1) || null;
    },
    setAvailability(id, available, active) {
        const sets = ["synced_at = datetime('now')"];
        const vals = [];
        if (available !== undefined) {
            sets.push('available = ?');
            vals.push(Math.max(0, Number(available) || 0));
        }
        if (active !== undefined) {
            sets.push('active = ?');
            vals.push(active ? 1 : 0);
        }
        if (!vals.length) return 0;
        vals.push(id);
        return connect().prepare(`UPDATE virtuo_services SET ${sets.join(', ')} WHERE id = ?`).run(...vals).changes;
    },
    countActive() {
        return connect().prepare('SELECT COUNT(*) as c FROM virtuo_services WHERE active = 1').get().c;
    },
    deactivateMissing(activeKeys) {
        if (!activeKeys?.length) return 0;
        const all = connect().prepare('SELECT id, service_code, country_id, server FROM virtuo_services WHERE active = 1').all();
        const keep = new Set(activeKeys);
        let n = 0;
        for (const row of all) {
            const key = `${row.service_code}:${row.country_id}:${row.server}`;
            if (!keep.has(key)) {
                connect().prepare('UPDATE virtuo_services SET active = 0, synced_at = datetime(\'now\') WHERE id = ?').run(row.id);
                n++;
            }
        }
        return n;
    },
    decrementAvailable(id, by = 1) {
        const n = Math.max(1, Number(by) || 1);
        const r = connect()
            .prepare(
                `UPDATE virtuo_services SET available = CASE WHEN available > ? THEN available - ? ELSE 0 END, synced_at = datetime('now') WHERE id = ?`
            )
            .run(n, n, id);
        return r.changes;
    },
    listAfterId(afterId, limit = 25) {
        return connect()
            .prepare('SELECT * FROM virtuo_services WHERE id > ? ORDER BY id ASC LIMIT ?')
            .all(Number(afterId) || 0, Math.max(1, Number(limit) || 25));
    },
    countAll() {
        return connect().prepare('SELECT COUNT(*) as c FROM virtuo_services').get().c;
    },
    countSellable() {
        return connect().prepare('SELECT COUNT(*) as c FROM virtuo_services WHERE active = 1 AND available > 0').get().c;
    },
    patchCountryId(id, countryId, countryName) {
        return connect()
            .prepare(
                `UPDATE virtuo_services SET country_id = ?, country_name = ?, synced_at = datetime('now') WHERE id = ?`
            )
            .run(Number(countryId), String(countryName || ''), Number(id)).changes;
    },
};

prisma.virtuoOrder = {
    create(row) {
        const info = connect().prepare(`
            INSERT INTO virtuo_orders (
                telegram_id, hanork_order_id, virtuo_service_id, service_code, country_id,
                service_name, country_name, cost, sale_price, profit, server, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            String(row.telegram_id),
            row.hanork_order_id || null,
            row.virtuo_service_id,
            row.service_code,
            row.country_id,
            row.service_name || '',
            row.country_name || '',
            row.cost || 0,
            row.sale_price || 0,
            row.profit || 0,
            row.server || 1,
            row.status || 'awaiting_payment'
        );
        return { id: info.lastInsertRowid };
    },
    updateStatus(id, status, extra = {}) {
        const sets = ['status = ?', "updated_at = datetime('now')"];
        const vals = [status];
        const fields = [
            'virtuo_order_id', 'phone', 'sms_code', 'provider_status', 'hanork_order_id', 'cost', 'profit',
            'user_notified', 'phone_assigned_at',
        ];
        for (const f of fields) {
            if (extra[f] != null) {
                sets.push(`${f} = ?`);
                vals.push(extra[f]);
            }
        }
        vals.push(id);
        connect().prepare(`UPDATE virtuo_orders SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    },
    findById(id) {
        return connect().prepare('SELECT * FROM virtuo_orders WHERE id = ?').get(id) || null;
    },
    findByHanorkOrderId(hanorkOrderId) {
        return connect().prepare('SELECT * FROM virtuo_orders WHERE hanork_order_id = ?').get(hanorkOrderId) || null;
    },
    listByStatus(statuses, limit = 100) {
        const list = Array.isArray(statuses) ? statuses : [statuses];
        const placeholders = list.map(() => '?').join(',');
        return connect().prepare(`
            SELECT * FROM virtuo_orders WHERE status IN (${placeholders})
            ORDER BY updated_at ASC LIMIT ?
        `).all(...list, limit);
    },
    listByTelegram(telegramId, limit = 10) {
        return connect().prepare(`
            SELECT * FROM virtuo_orders WHERE telegram_id = ?
            ORDER BY id DESC LIMIT ?
        `).all(String(telegramId), limit);
    },
    findPendingByTelegram(telegramId) {
        return connect().prepare(`
            SELECT * FROM virtuo_orders
            WHERE telegram_id = ? AND status IN ('paid', 'waiting_sms')
            ORDER BY id DESC LIMIT 1
        `).get(String(telegramId)) || null;
    },
    /** Pedidos pagos no Hanork sem número Virtuo atribuído (fulfill não concluiu). */
    listNeedingFulfillment(limit = 25) {
        return connect().prepare(`
            SELECT vo.* FROM virtuo_orders vo
            INNER JOIN orders o ON o.id = vo.hanork_order_id
            WHERE o.status IN ('PAID', 'DELIVERING')
              AND (vo.virtuo_order_id IS NULL OR vo.virtuo_order_id = '')
              AND (vo.phone IS NULL OR vo.phone = '')
              AND vo.status IN ('awaiting_payment', 'paid', 'failed')
            ORDER BY vo.updated_at ASC
            LIMIT ?
        `).all(limit);
    },
    stats() {
        const row = connect().prepare(`
            SELECT
                COUNT(*) AS total,
                COALESCE(SUM(profit), 0) AS profit,
                SUM(CASE WHEN status IN ('paid', 'waiting_sms') THEN 1 ELSE 0 END) AS waiting
            FROM virtuo_orders
        `).get();
        return {
            total: Number(row?.total || 0),
            profit: Number(row?.profit || 0),
            waiting: Number(row?.waiting || 0),
        };
    },
};

prisma.smmPriceHistory = {
    record(serviceId, oldPrice, newPrice) {
        if (oldPrice === newPrice) return null;
        const info = connect().prepare(
            'INSERT INTO smm_price_history (service_id, old_price, new_price) VALUES (?, ?, ?)'
        ).run(serviceId, oldPrice, newPrice);
        return info.lastInsertRowid;
    },
};

prisma.smmSyncHistory = {
    start(syncType) {
        const info = connect().prepare(
            'INSERT INTO smm_sync_history (sync_type, finished_at) VALUES (?, NULL)'
        ).run(syncType || 'full');
        return info.lastInsertRowid;
    },
    finish(id, stats) {
        connect().prepare(`
            UPDATE smm_sync_history SET
                total_processed = ?, created_count = ?, updated_count = ?, removed_count = ?,
                balance_snapshot = ?, error_message = ?, finished_at = datetime('now')
            WHERE id = ?
        `).run(
            stats.total_processed || 0, stats.created_count || 0, stats.updated_count || 0,
            stats.removed_count || 0, stats.balance_snapshot || null, stats.error_message || null, id
        );
    },
    last() {
        return connect().prepare(
            'SELECT * FROM smm_sync_history WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1'
        ).get() || null;
    },
};

// Estado em memória entre restarts (carrinhos legados em Map, compras pendentes, bans)
const STATE_PATH = path.join(__dirname, '../../.bot-state.json');

const state = {
    load() {
        try {
            if (!fs.existsSync(STATE_PATH)) return null;
            return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
        } catch (e) {
            logger.warn('state.load:', e.message);
            return null;
        }
    },
    async _snapshotRedisNamespace(namespace) {
        try {
            const { stateManager } = require('../infrastructure');
            const suffixes = await stateManager.keysInNamespace(namespace);
            const entries = [];
            for (const suffix of suffixes) {
                const v = await stateManager.get(`${namespace}:${suffix}`);
                if (v != null) entries.push([suffix, v]);
            }
            return entries;
        } catch (e) {
            logger.debug(`state.save: skip ${namespace}`, e.message);
            return [];
        }
    },

    /**
     * Snapshot legado em JSON (bans + fallback Redis).
     * Carrinhos/compras vivem no Redis — não usa .entries() dos wrappers async.
     */
    async save(_carrinhos, _comprasPendentes, bannedUsers) {
        try {
            const [comprasEntries, cartEntries] = await Promise.all([
                this._snapshotRedisNamespace('pending_purchase'),
                this._snapshotRedisNamespace('cart'),
            ]);

            const data = {
                carrinhos: cartEntries,
                comprasPendentes: comprasEntries,
                bannedUsers:
                    bannedUsers instanceof Set
                        ? [...bannedUsers]
                        : Array.isArray(bannedUsers)
                            ? bannedUsers
                            : [],
            };
            fs.writeFileSync(STATE_PATH, JSON.stringify(data));
        } catch (e) {
            logger.warn('state.save:', { detail: e.message });
        }
    },
    clear() {
        try {
            if (fs.existsSync(STATE_PATH)) fs.unlinkSync(STATE_PATH);
        } catch (e) {
            logger.warn('state.clear:', e.message);
        }
    },
};

module.exports = { prisma, connect, backup, migrateFromJSON, state, DB_PATH };
