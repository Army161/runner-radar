import { createHmac } from 'node:crypto';
import type { Config } from './config.ts';
import type { DB } from './db.ts';
import { log, safeEqual, str } from './util.ts';

/**
 * Stripe subscriptions with zero dependencies: plain REST calls, form-encoded.
 * Monthly tiers only. The server is the source of truth for entitlements —
 * every limit here is enforced in the API, not just drawn in the UI.
 */

export type Tier = 'free' | 'pro' | 'apex';

export interface TierSpec {
  tier: Tier;
  name: string;
  tagline: string;
  wallets: number;
  watchlist: number;
  scansPerDay: number;
  alertsPerDay: number | null; // null = unlimited
  exitSignals: boolean;
  telegram: boolean;
  playbook: 'intro' | 'trader' | 'all';
  priorityFeed: boolean;
}

export const TIERS: Record<Tier, TierSpec> = {
  free: {
    tier: 'free', name: 'Scout', tagline: 'Watch the radar, learn the game.',
    wallets: 3, watchlist: 20, scansPerDay: 10, alertsPerDay: 5,
    exitSignals: false, telegram: false, playbook: 'intro', priorityFeed: false,
  },
  pro: {
    tier: 'pro', name: 'Runner Pro', tagline: 'Full alerts, exit signals, the trader playbook.',
    wallets: 25, watchlist: 100, scansPerDay: 100, alertsPerDay: null,
    exitSignals: true, telegram: true, playbook: 'trader', priorityFeed: false,
  },
  apex: {
    tier: 'apex', name: 'Apex', tagline: 'Max limits, priority coverage, the creator playbook.',
    wallets: 50, watchlist: 200, scansPerDay: 300, alertsPerDay: null,
    exitSignals: true, telegram: true, playbook: 'all', priorityFeed: true,
  },
};

export const LOOKUP_KEYS: Record<Exclude<Tier, 'free'>, string> = { pro: 'rr_pro_monthly', apex: 'rr_apex_monthly' };
const TIER_BY_LOOKUP: Record<string, Tier> = { rr_pro_monthly: 'pro', rr_apex_monthly: 'apex' };
const GRACE_MS = 3 * 86_400_000; // keep access briefly past period_end while Stripe retries payment

export interface SubRow { user_id: string; customer: string | null; sub_id: string | null; tier: string; status: string; period_end: number | null }

export function tierOf(db: DB, cfg: Config, user: { id: string; email: string | null }): Tier {
  if (user.email && cfg.adminEmails.includes(user.email.toLowerCase())) return 'apex';
  const row = db.prepare('SELECT tier, status, period_end FROM subscriptions WHERE user_id = ?').get(user.id) as SubRow | undefined;
  if (!row) return 'free';
  const live = ['active', 'trialing', 'past_due'].includes(row.status);
  const inPeriod = row.period_end === null || row.period_end + GRACE_MS > Date.now();
  return live && inPeriod && (row.tier === 'pro' || row.tier === 'apex') ? (row.tier as Tier) : 'free';
}

const utcDay = () => new Date().toISOString().slice(0, 10);
export function scansToday(db: DB, userId: string): number {
  return Number((db.prepare('SELECT scans FROM usage_days WHERE user_id = ? AND day = ?').get(userId, utcDay()) as any)?.scans ?? 0);
}
export function bumpScan(db: DB, userId: string) {
  db.prepare(`INSERT INTO usage_days (user_id, day, scans) VALUES (?, ?, 1)
    ON CONFLICT(user_id, day) DO UPDATE SET scans = scans + 1`).run(userId, utcDay());
}
export function alertsToday(db: DB, userId: string): number {
  const midnight = Date.parse(`${utcDay()}T00:00:00Z`);
  return Number((db.prepare('SELECT COUNT(*) AS n FROM alerts WHERE user_id = ? AND at >= ?').get(userId, midnight) as any)?.n ?? 0);
}

const kvGet = (db: DB, k: string) => (db.prepare('SELECT v FROM kv WHERE k = ?').get(k) as any)?.v as string | undefined;
const kvSet = (db: DB, k: string, v: string) => db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, v);

export class Billing {
  private cfg: Config;
  private db: DB;
  private priceIds: Partial<Record<Tier, string>> = {};
  private webhookSecret: string;
  ready = false;

  constructor(cfg: Config, db: DB) {
    this.cfg = cfg;
    this.db = db;
    this.webhookSecret = cfg.stripeWebhookSecret || kvGet(db, 'stripe_webhook_secret') || '';
  }

  get live() { return !!this.cfg.stripeKey; }
  priceUsd(tier: Exclude<Tier, 'free'>) { return tier === 'pro' ? this.cfg.priceProUsd : this.cfg.priceApexUsd; }

  private async stripe(method: 'GET' | 'POST', path: string, params?: Record<string, string>): Promise<any> {
    const body = params ? new URLSearchParams(params).toString() : undefined;
    const url = `https://api.stripe.com${path}${method === 'GET' && body ? `?${body}` : ''}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.cfg.stripeKey}`,
        ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        'Stripe-Version': '2024-06-20',
      },
      body: method === 'POST' ? body : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Stripe ${path}: ${json?.error?.message ?? res.status}`);
    return json;
  }

  /** Find or create the two monthly prices by lookup key; repoint the key if the configured amount changed. */
  async ensureCatalog() {
    for (const tier of ['pro', 'apex'] as const) {
      const lookup = LOOKUP_KEYS[tier];
      const amount = this.priceUsd(tier) * 100;
      const found = await this.stripe('GET', '/v1/prices', { 'lookup_keys[]': lookup, limit: '1', active: 'true' });
      const existing = found.data?.[0];
      if (existing && existing.unit_amount === amount) { this.priceIds[tier] = existing.id; continue; }
      let product = existing?.product;
      if (!product) {
        const p = await this.stripe('POST', '/v1/products', { name: `Runner Radar — ${TIERS[tier].name}`, 'metadata[tier]': tier });
        product = p.id;
      }
      const price = await this.stripe('POST', '/v1/prices', {
        product: String(product), currency: 'usd', unit_amount: String(amount),
        'recurring[interval]': 'month', lookup_key: lookup, transfer_lookup_key: 'true', 'metadata[tier]': tier,
      });
      this.priceIds[tier] = price.id;
      log.info(`Stripe price ready: ${TIERS[tier].name} $${this.priceUsd(tier)}/mo (${price.id})`);
    }
  }

  /** Register our webhook endpoint with Stripe once and remember the signing secret in the database. */
  async ensureWebhook() {
    if (this.webhookSecret) return;
    const url = `${this.cfg.appUrl}/api/billing/webhook`;
    if (!url.startsWith('https://')) { log.warn('Stripe webhook not registered: APP_URL is not https. Checkout works; renewals/cancellations need the webhook in production.'); return; }
    const list = await this.stripe('GET', '/v1/webhook_endpoints', { limit: '100' });
    const existing = (list.data ?? []).find((w: any) => w.url === url && w.status === 'enabled');
    if (existing) { log.warn('A Stripe webhook for this URL already exists but its secret is not stored here. Set STRIPE_WEBHOOK_SECRET from the Stripe dashboard.'); return; }
    const created = await this.stripe('POST', '/v1/webhook_endpoints', {
      url,
      'enabled_events[0]': 'checkout.session.completed',
      'enabled_events[1]': 'customer.subscription.created',
      'enabled_events[2]': 'customer.subscription.updated',
      'enabled_events[3]': 'customer.subscription.deleted',
      description: 'Runner Radar subscriptions',
    });
    this.webhookSecret = created.secret;
    kvSet(this.db, 'stripe_webhook_secret', created.secret);
    log.info('Stripe webhook registered and signing secret stored.');
  }

  async start() {
    if (!this.live) return;
    try {
      await this.ensureCatalog();
      await this.ensureWebhook();
      this.ready = true;
      log.info('Billing live — monthly tiers: ' + (['pro', 'apex'] as const).map((t) => `${TIERS[t].name} $${this.priceUsd(t)}`).join(', '));
    } catch (e: any) {
      log.error('Stripe setup failed:', e?.message);
    }
  }

  private upsert(userId: string, patch: Partial<SubRow>) {
    const cur = this.subOf(userId);
    const next = {
      customer: patch.customer ?? cur?.customer ?? null,
      sub_id: patch.sub_id ?? cur?.sub_id ?? null,
      tier: patch.tier ?? cur?.tier ?? 'free',
      status: patch.status ?? cur?.status ?? 'none',
      period_end: patch.period_end !== undefined ? patch.period_end : cur?.period_end ?? null,
    };
    this.db.prepare(`INSERT OR REPLACE INTO subscriptions (user_id, customer, sub_id, tier, status, period_end, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(userId, next.customer, next.sub_id, next.tier, next.status, next.period_end, Date.now());
  }

  customerOf(userId: string): string | null {
    return (this.db.prepare('SELECT customer FROM subscriptions WHERE user_id = ?').get(userId) as any)?.customer ?? null;
  }
  subOf(userId: string): SubRow | null {
    return (this.db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(userId) as unknown as SubRow) ?? null;
  }

  /** Demo / local checkout: flips the tier directly so every flow can be tried without a Stripe account. */
  demoCheckout(userId: string, tier: Exclude<Tier, 'free'>) {
    this.upsert(userId, { tier, status: 'active', period_end: Date.now() + 30 * 86_400_000, customer: 'demo' });
  }
  demoCancel(userId: string) { this.upsert(userId, { status: 'canceled', period_end: Date.now() }); }

  async checkoutUrl(user: { id: string; email: string | null }, tier: Exclude<Tier, 'free'>): Promise<string> {
    const price = this.priceIds[tier];
    if (!price) throw new Error('Billing is still starting up — try again in a few seconds');
    const params: Record<string, string> = {
      mode: 'subscription', 'line_items[0][price]': price, 'line_items[0][quantity]': '1',
      success_url: `${this.cfg.appUrl}/app/settings?billing=success`,
      cancel_url: `${this.cfg.appUrl}/app/settings?billing=cancelled`,
      client_reference_id: user.id, 'metadata[user_id]': user.id, 'metadata[tier]': tier,
      'subscription_data[metadata][user_id]': user.id, allow_promotion_codes: 'true',
    };
    const customer = this.customerOf(user.id);
    if (customer && customer !== 'demo') params.customer = customer;
    else if (user.email) params.customer_email = user.email;
    const session = await this.stripe('POST', '/v1/checkout/sessions', params);
    return session.url;
  }

  async portalUrl(userId: string): Promise<string> {
    const customer = this.customerOf(userId);
    if (!customer || customer === 'demo') throw new Error('No Stripe subscription on this account');
    const s = await this.stripe('POST', '/v1/billing_portal/sessions', { customer, return_url: `${this.cfg.appUrl}/app/settings` });
    return s.url;
  }

  /** Verify a Stripe-Signature header (t=...,v1=...) against the raw request body. */
  verifySignature(raw: string, header: string | undefined, now = Date.now()): boolean {
    if (!this.webhookSecret || !header) return false;
    const parts = Object.fromEntries(header.split(',').map((p) => p.split('=', 2) as [string, string]));
    const t = Number(parts.t);
    if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > 300) return false;
    const expected = createHmac('sha256', this.webhookSecret).update(`${parts.t}.${raw}`).digest('hex');
    return typeof parts.v1 === 'string' && safeEqual(expected, parts.v1);
  }

  /** Apply a verified Stripe event to the subscriptions table. */
  applyEvent(event: any) {
    const type = str(event?.type, 80);
    const obj = event?.data?.object ?? {};
    if (type === 'checkout.session.completed') {
      const userId = str(obj.client_reference_id || obj.metadata?.user_id, 60);
      const tier = obj.metadata?.tier === 'apex' ? 'apex' : obj.metadata?.tier === 'pro' ? 'pro' : null;
      if (!userId) return;
      this.upsert(userId, { customer: str(obj.customer, 80) || null, sub_id: str(obj.subscription, 80) || null, tier: tier ?? undefined, status: 'active' });
      log.info(`Subscription started: user ${userId} → ${tier ?? 'unknown tier'}`);
    } else if (type === 'customer.subscription.created' || type === 'customer.subscription.updated' || type === 'customer.subscription.deleted') {
      const customer = str(obj.customer, 80);
      const subId = str(obj.id, 80);
      let row = (this.db.prepare('SELECT user_id FROM subscriptions WHERE sub_id = ? OR customer = ?').get(subId, customer) as any)?.user_id as string | undefined;
      if (!row) row = str(obj.metadata?.user_id, 60) || undefined;
      if (!row) { log.warn(`Stripe event ${type} for unknown customer ${customer}`); return; }
      const lookup = obj.items?.data?.[0]?.price?.lookup_key as string | undefined;
      const metaTier = obj.items?.data?.[0]?.price?.metadata?.tier as string | undefined;
      const tier = TIER_BY_LOOKUP[lookup ?? ''] ?? (metaTier === 'apex' || metaTier === 'pro' ? (metaTier as Tier) : undefined);
      const status = type === 'customer.subscription.deleted' ? 'canceled' : str(obj.status, 30) || 'active';
      const periodEnd = Number(obj.current_period_end) > 0 ? Number(obj.current_period_end) * 1000 : null;
      this.upsert(row, { customer: customer || null, sub_id: subId || null, tier, status, period_end: periodEnd });
      log.info(`Subscription ${type.split('.').pop()}: user ${row} → ${tier ?? 'same tier'} (${status})`);
    }
  }
}
