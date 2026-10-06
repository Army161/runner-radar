import type { EventEmitter } from 'node:events';
import type { Config } from './config.ts';
import type { DB } from './db.ts';
import type { TokenState, UserSettings } from './types.ts';
import type { Orchestrator } from './agents/orchestrator.ts';
import { evaluateFor, PRESETS } from './agents/filters.ts';
import { fetchJson, log, randomToken, sleep } from './util.ts';

export function loadSettings(db: DB, userId: string): UserSettings {
  const row = db.prepare('SELECT json FROM settings WHERE user_id = ?').get(userId) as { json: string } | undefined;
  if (!row) return structuredClone(PRESETS.balanced);
  try { return { ...structuredClone(PRESETS.balanced), ...JSON.parse(row.json) }; } catch { return structuredClone(PRESETS.balanced); }
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));

/** Telegram bot: account linking via /start CODE and outbound alerts. Long-polls, so no public URL is needed. */
export class Telegram {
  private cfg: Config;
  private db: DB;
  private offset = 0;
  private stopped = false;
  constructor(cfg: Config, db: DB) { this.cfg = cfg; this.db = db; }

  get enabled() { return !!this.cfg.telegramToken; }

  newLinkCode(userId: string) {
    const code = randomToken(9).replace(/[-_]/g, 'x').slice(0, 10);
    this.db.prepare('DELETE FROM telegram_codes WHERE user_id = ? OR expires_at < ?').run(userId, Date.now());
    this.db.prepare('INSERT INTO telegram_codes (code, user_id, expires_at) VALUES (?, ?, ?)').run(code, userId, Date.now() + 15 * 60_000);
    return { code, link: this.cfg.telegramBot ? `https://t.me/${this.cfg.telegramBot}?start=${code}` : null };
  }

  private api(method: string, body: unknown, timeoutMs = 10_000) {
    return fetchJson(`https://api.telegram.org/bot${this.cfg.telegramToken}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), timeoutMs,
    });
  }

  async send(chatId: string, html: string) {
    if (!this.enabled) return;
    await this.api('sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: true } })
      .catch((e) => log.warn('telegram send failed', e.message));
  }

  async start() {
    if (!this.enabled) return;
    log.info('Telegram bot polling');
    while (!this.stopped) {
      try {
        const r = await this.api('getUpdates', { offset: this.offset, timeout: 50, allowed_updates: ['message'] }, 60_000);
        for (const u of r.result ?? []) {
          this.offset = u.update_id + 1;
          const text: string = u.message?.text ?? '';
          const chatId = String(u.message?.chat?.id ?? '');
          if (!chatId) continue;
          const m = text.match(/^\/start\s+([A-Za-z0-9]{6,20})$/);
          if (m) {
            const row = this.db.prepare('SELECT user_id FROM telegram_codes WHERE code = ? AND expires_at > ?').get(m[1], Date.now()) as { user_id: string } | undefined;
            if (row) {
              this.db.prepare('INSERT INTO telegram_links (user_id, chat_id, linked_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET chat_id = excluded.chat_id, linked_at = excluded.linked_at').run(row.user_id, chatId, Date.now());
              this.db.prepare('DELETE FROM telegram_codes WHERE code = ?').run(m[1]);
              await this.send(chatId, 'Linked to Runner Radar. You will get runner and exit alerts here. Send /stop to unlink.');
            } else {
              await this.send(chatId, 'That link code is invalid or expired. Generate a new one in Runner Radar.');
            }
          } else if (text === '/stop') {
            this.db.prepare('DELETE FROM telegram_links WHERE chat_id = ?').run(chatId);
            await this.send(chatId, 'Unlinked. No more alerts.');
          }
        }
      } catch (e: any) {
        log.warn('telegram poll error', e?.message);
        await sleep(5000);
      }
    }
  }
  stop() { this.stopped = true; }
}

interface AlertUser { id: string; chat_id: string | null; settings: UserSettings }

/** Decides who gets told about what, once. Delivers in-app (SSE) and on Telegram. */
export class AlertEngine {
  private cfg: Config; private db: DB; private bus: EventEmitter; private tg: Telegram; private orch: Orchestrator;
  private users: AlertUser[] = [];
  private loadedAt = 0;

  constructor(cfg: Config, db: DB, bus: EventEmitter, tg: Telegram, orch: Orchestrator) {
    this.cfg = cfg; this.db = db; this.bus = bus; this.tg = tg; this.orch = orch;
  }

  invalidate() { this.loadedAt = 0; }

  private getUsers(): AlertUser[] {
    if (Date.now() - this.loadedAt < 30_000) return this.users;
    const rows = this.db.prepare(`SELECT u.id, t.chat_id FROM users u LEFT JOIN telegram_links t ON t.user_id = u.id WHERE u.onboarded = 1`).all() as Array<{ id: string; chat_id: string | null }>;
    this.users = rows.map((r) => ({ id: r.id, chat_id: r.chat_id, settings: loadSettings(this.db, r.id) })).filter((u) => u.settings.alerts.enabled);
    this.loadedAt = Date.now();
    return this.users;
  }

  start() {
    this.bus.on('evaluated', (t: TokenState, prevScore: number) => this.onEvaluated(t, prevScore));
    this.bus.on('devSell', (t: TokenState, pct: number) => this.toWatchers(t, 'devsell', (s) => s.alerts.devSell, `Dev sold ${pct.toFixed(0)}% of their bag on $${t.symbol}.`));
    this.bus.on('smartExit', (t: TokenState) => { if (t.smartOut.size >= 2) this.toWatchers(t, 'smartexit', (s) => s.alerts.smartExit, `${t.smartOut.size} tracked wallets have exited $${t.symbol}.`); });
    this.bus.on('graduated', (t: TokenState) => this.toWatchers(t, 'graduate', (s) => s.alerts.graduate, `$${t.symbol} graduated from the bonding curve.`));
    this.bus.on('demoted', (t: TokenState) => { if (t.status === 'blocked') this.toWatchers(t, 'blocked', () => true, `$${t.symbol} is now blocked: ${t.hardFails[0]?.why ?? 'safety gate failed'}.`); });
  }

  private onEvaluated(t: TokenState, prevScore: number) {
    if (t.status === 'blocked' || t.score === prevScore) return;
    const users = this.getUsers();
    if (!users.length) return;
    if (t.score > prevScore) {
      for (const u of users) {
        const min = u.settings.alerts.minScore;
        if (t.score < min || prevScore >= min) continue;
        const smart = Number(t.signals.smart?.metrics?.holding ?? 0);
        const v = evaluateFor(t, u.settings, this.cfg, this.orch.solUsd, smart);
        if (v.blockedBy.length) continue;
        if (!this.claim(u.id, t.mint, 'runner')) continue;
        this.db.prepare('INSERT OR IGNORE INTO watchlist (user_id, mint, added_at, symbol) VALUES (?, ?, ?, ?)').run(u.id, t.mint, Date.now(), t.symbol);
        this.deliver(u, t, `RUNNER $${t.symbol} — score ${t.score}`, this.summary(t));
      }
    } else if (prevScore >= 70 && t.score < 70) {
      this.toWatchers(t, 'scoredrop', (s) => s.alerts.scoreDrop, `$${t.symbol} score dropped to ${t.score}.`);
    }
  }

  private summary(t: TokenState) {
    const usd = this.orch.solUsd;
    const mcap = usd ? `$${Math.round(t.mcapSol * usd).toLocaleString('en-US')}` : `${t.mcapSol.toFixed(1)} SOL`;
    const passed = ['contract', 'honeypot', 'vamp', 'dev'].filter((k) => t.gates[k]?.status === 'pass').length;
    return `mcap ${mcap} · ${t.balances.size || t.external?.holders || 0} holders · ${passed}/4 safety gates verified`;
  }

  private claim(userId: string, mint: string, kind: string): boolean {
    const r = this.db.prepare('INSERT OR IGNORE INTO alerts_sent (user_id, mint, kind, at) VALUES (?, ?, ?, ?)').run(userId, mint, kind, Date.now());
    return Number(r.changes) > 0;
  }

  private toWatchers(t: TokenState, kind: string, wants: (s: UserSettings) => boolean, text: string) {
    const watchers = this.db.prepare('SELECT user_id FROM watchlist WHERE mint = ?').all(t.mint) as Array<{ user_id: string }>;
    if (!watchers.length) return;
    const ids = new Set(watchers.map((w) => w.user_id));
    for (const u of this.getUsers()) {
      if (!ids.has(u.id) || !wants(u.settings) || !this.claim(u.id, t.mint, kind)) continue;
      this.deliver(u, t, 'EXIT SIGNAL', text);
    }
  }

  private deliver(u: AlertUser, t: TokenState, title: string, body: string) {
    this.db.prepare('INSERT INTO alerts (user_id, mint, symbol, title, body, at) VALUES (?, ?, ?, ?, ?, ?)').run(u.id, t.mint, t.symbol, title, body, Date.now());
    this.bus.emit('userAlert', { userId: u.id, title, body, mint: t.mint, symbol: t.symbol, t: Date.now() });
    if (u.chat_id) this.tg.send(u.chat_id, `<b>${esc(title)}</b>\n${esc(body)}\n${this.cfg.appUrl}/app/token/${t.mint}`);
  }
}

/**
 * Messages for the people running the app (users listed in ADMIN_EMAILS who linked Telegram):
 * crashes and errors, the pump.fun feed going down, and the daily trade-feed budget running out.
 * Throttled so a bad hour sends a handful of messages, not hundreds.
 */
export class OwnerAlerts {
  private db: DB; private tg: Telegram; private admins: string[];
  private last = new Map<string, number>();
  constructor(db: DB, tg: Telegram, adminEmails: string[]) { this.db = db; this.tg = tg; this.admins = adminEmails; }

  private chats(): string[] {
    if (!this.admins.length || !this.tg.enabled) return [];
    const marks = this.admins.map(() => '?').join(',');
    const rows = this.db.prepare(`SELECT t.chat_id FROM users u JOIN telegram_links t ON t.user_id = u.id WHERE lower(u.email) IN (${marks})`).all(...this.admins) as Array<{ chat_id: string }>;
    return rows.map((r) => r.chat_id);
  }

  send(key: string, text: string, everyMs = 10 * 60_000) {
    const now = Date.now();
    if (now - (this.last.get(key) ?? 0) < everyMs) return;
    this.last.set(key, now);
    for (const chat of this.chats()) this.tg.send(chat, `<b>Runner Radar</b> · ${esc(text).slice(0, 3500)}`);
  }
}
