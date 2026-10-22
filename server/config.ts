const env = process.env;

const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()));
const int = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
const list = (v: string | undefined) => (v ? v.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean) : []);

const isProd = env.NODE_ENV === 'production';
const port = int(env.PORT, 8787);
const appUrl = (env.APP_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${port}`).replace(/\/+$/, '');

if (isProd && !appUrl.startsWith('https://')) {
  throw new Error('APP_URL must be an https:// URL in production (cookies are Secure-only).');
}

const provider = (prefix: string) => {
  const id = env[`${prefix}_CLIENT_ID`];
  const secret = env[`${prefix}_CLIENT_SECRET`];
  return id && secret ? { id, secret } : null;
};

export const config = {
  isProd,
  port,
  host: env.HOST || (isProd ? '0.0.0.0' : '127.0.0.1'),
  appUrl,
  /** Number of reverse-proxy hops in front of the app (0 = none). Used to read the real client IP. */
  trustProxy: int(env.TRUST_PROXY, env.RENDER ? 1 : 0),
  demo: bool(env.DEMO, false),
  dbPath: env.DB_PATH || 'data/radar.db',

  pumpPortalUrl: env.PUMPPORTAL_WS || 'wss://pumpportal.fun/api/data',
  pumpPortalKey: env.PUMPPORTAL_API_KEY || '',
  rpcUrl: env.SOLANA_RPC_URL || '',
  rpcMaxRps: int(env.RPC_MAX_RPS, 8),
  funderTrace: bool(env.ENABLE_FUNDER_TRACE, false),
  dexscreener: bool(env.ENABLE_DEXSCREENER, true),
  jupiter: bool(env.ENABLE_JUPITER, true),
  ipfsGateway: env.IPFS_GATEWAY || 'https://ipfs.io/ipfs/',
  smartWallets: list(env.SMART_WALLETS),

  /** PumpPortal bills trade + wallet streams per event; these keep spending predictable. */
  feedBudget: int(env.FEED_DAILY_EVENTS, 50_000),
  feedMaxSubs: int(env.FEED_MAX_SUBS, 150),
  feedMaxWallets: int(env.FEED_MAX_WALLETS, 100),
  feedTrialMs: int(env.FEED_TRIAL_MS, 30_000),
  feedTractionBuyers: int(env.FEED_TRACTION_BUYERS, 6),
  feedCoolMs: int(env.FEED_COOL_MS, 180_000),

  /** Stripe (optional). With just STRIPE_SECRET_KEY set, products, prices and the webhook are created automatically. */
  stripeKey: env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
  priceProUsd: int(env.PRICE_PRO_USD, 29),
  priceApexUsd: int(env.PRICE_APEX_USD, 79),

  /**
   * Jev scam judge (TypeSafe AI System One, via the official @typesafe-ai/sdk). Off without a key.
   * Only judges tokens that passed the hard gates with traction, once per recheck window, within a daily budget.
   */
  jev: {
    apiKey: env.TYPESAFE_API_KEY || '',
    baseUrl: env.TYPESAFE_BASE_URL || '',
    /** Pinned so verdicts stay consistent; jev-latest moves when TypeSafe ships a new version. */
    model: env.JEV_MODEL || 'jev-1.13.0',
    minScore: int(env.JEV_MIN_SCORE, 55),
    warnAt: Number(env.JEV_WARN_AT || 0.6),
    blockAt: Number(env.JEV_BLOCK_AT || 0.9),
    recheckMs: int(env.JEV_RECHECK_MS, 10 * 60_000),
    dailyCalls: int(env.JEV_DAILY_CALLS, 5000),
    timeoutMs: int(env.JEV_TIMEOUT_MS, 5000),
  },

  /** Verified emails that can open the admin dashboard and receive owner alerts on Telegram. */
  adminEmails: list(env.ADMIN_EMAILS).map((e) => e.toLowerCase()),

  telegramToken: env.TELEGRAM_BOT_TOKEN || '',
  telegramBot: env.TELEGRAM_BOT_USERNAME || '',

  oauth: {
    google: provider('GOOGLE'),
    discord: provider('DISCORD'),
    x: provider('X'),
  },
  allowDevLogin: !isProd && bool(env.ALLOW_DEV_LOGIN, false),

  /** How many tokens the pipeline keeps in memory and subscribed. */
  maxWatched: int(env.MAX_WATCHED, 1500),
  idleDropMs: int(env.IDLE_DROP_MS, 10 * 60_000),
  /** Buys a token needs before RPC checks are spent on it. */
  auditAfterBuys: int(env.AUDIT_AFTER_BUYS, 5),

  pump: { supply: 1_000_000_000, virtualOffset: 279_900_000, sellable: 793_100_000 },
  bundleWindowMs: int(env.BUNDLE_WINDOW_MS, 2000),
  sniperWindowMs: int(env.SNIPER_WINDOW_MS, 5000),
  /** Concentration limits only apply once a token has this many holders. */
  minHoldersForConcentration: int(env.MIN_HOLDERS_FOR_CONCENTRATION, 30),
  weights: { momentum: 0.3, holders: 0.25, smart: 0.2, narrative: 0.15, dev: 0.1 },
  runnerScore: int(env.RUNNER_SCORE, 80),
};

export type Config = typeof config;
