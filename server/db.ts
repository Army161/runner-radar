import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = DatabaseSync;

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 3000;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      avatar TEXT,
      onboarded INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oauth_accounts (
      provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (provider, provider_user_id)
    );
    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      verifier TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tracked_wallets (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      address TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (user_id, address)
    );
    CREATE TABLE IF NOT EXISTS telegram_links (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      chat_id TEXT NOT NULL,
      linked_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS telegram_codes (
      code TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS watchlist (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mint TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, mint)
    );
    CREATE TABLE IF NOT EXISTS alerts_sent (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mint TEXT NOT NULL,
      kind TEXT NOT NULL,
      at INTEGER NOT NULL,
      PRIMARY KEY (user_id, mint, kind)
    );
    -- In-app alert history (bell inbox).
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mint TEXT NOT NULL,
      symbol TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      at INTEGER NOT NULL,
      read INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS alerts_user ON alerts(user_id, at DESC);
    -- Wallet reputation: deployers and the wallets that funded them.
    CREATE TABLE IF NOT EXISTS wallets_rep (
      address TEXT PRIMARY KEY,
      launches INTEGER NOT NULL DEFAULT 0,
      rugs INTEGER NOT NULL DEFAULT 0,
      funder TEXT,
      last_seen INTEGER NOT NULL
    );
    -- Learning loop: how promoted tokens actually performed.
    CREATE TABLE IF NOT EXISTS outcomes (
      mint TEXT PRIMARY KEY,
      symbol TEXT,
      creator TEXT,
      promoted_at INTEGER NOT NULL,
      score REAL NOT NULL,
      parts TEXT NOT NULL,
      mcap_at_promote REAL NOT NULL,
      peak_mcap REAL NOT NULL,
      last_mcap REAL NOT NULL,
      rugged INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
  `);
  addColumn(db, 'watchlist', 'symbol TEXT');
  addColumn(db, 'users', 'last_seen INTEGER');
  return db;
}

/** Idempotent ALTER TABLE ADD COLUMN for databases created by an older version. */
function addColumn(db: DB, table: string, def: string) {
  const name = def.split(' ')[0];
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${def}`);
}

export interface WalletRep { address: string; launches: number; rugs: number; funder: string | null }

export function getRep(db: DB, address: string): WalletRep | null {
  return (db.prepare('SELECT address, launches, rugs, funder FROM wallets_rep WHERE address = ?').get(address) as unknown as WalletRep) ?? null;
}

export function bumpLaunch(db: DB, address: string, at: number) {
  db.prepare(`INSERT INTO wallets_rep (address, launches, last_seen) VALUES (?, 1, ?)
    ON CONFLICT(address) DO UPDATE SET launches = launches + 1, last_seen = excluded.last_seen`).run(address, at);
}

export function markRug(db: DB, address: string, at: number) {
  db.prepare(`INSERT INTO wallets_rep (address, rugs, last_seen) VALUES (?, 1, ?)
    ON CONFLICT(address) DO UPDATE SET rugs = rugs + 1, last_seen = excluded.last_seen`).run(address, at);
}

export function setFunder(db: DB, address: string, funder: string, at: number) {
  db.prepare(`INSERT INTO wallets_rep (address, funder, last_seen) VALUES (?, ?, ?)
    ON CONFLICT(address) DO UPDATE SET funder = excluded.funder`).run(address, funder, at);
}
