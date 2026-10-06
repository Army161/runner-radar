export type Side = 'buy' | 'sell';
export type AgentStatus = 'pass' | 'warn' | 'fail' | 'pending';
export type TokenStatus = 'watching' | 'runner' | 'blocked';

export interface CreateEvent {
  mint: string;
  name: string;
  symbol: string;
  uri: string;
  creator: string;
  bondingCurve?: string;
  initialBuy: number;
  solAmount: number;
  vSol: number;
  vTokens: number;
  mcapSol: number;
  signature: string;
  at: number;
  pool?: string;
  meta?: TokenMeta;
}

export interface TradeEvent {
  mint: string;
  wallet: string;
  side: Side;
  tokens: number;
  sol: number;
  newBalance: number | null;
  vSol: number;
  vTokens: number;
  mcapSol: number;
  signature: string;
  at: number;
  pool?: string;
}

export interface MigrateEvent { mint: string; pool?: string; signature?: string; at: number }

export interface TokenMeta {
  image?: string;
  description?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
}

export interface Trade { t: number; wallet: string; side: Side; sol: number; tokens: number; mcapSol: number }
export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }

export interface AgentResult {
  agent: string;
  status: AgentStatus;
  summary: string;
  score?: number;
  metrics?: Record<string, number | string | boolean | null>;
  at: number;
}

export interface MintInfo {
  program: 'spl' | 'token2022';
  mintAuthority: string | null;
  freezeAuthority: string | null;
  decimals: number;
  supply: number;
  extensions: Array<{ name: string; state: any }>;
}

export interface Audit {
  at: number;
  mint: MintInfo | null;
  sellQuote: { ok: boolean; impactPct?: number } | null;
  funder: string | null;
}

export interface TimelineEvent { t: number; text: string; kind: 'info' | 'good' | 'warn' }

export interface TokenState {
  mint: string;
  name: string;
  symbol: string;
  uri: string;
  meta: TokenMeta;
  metaLoaded: boolean;
  creator: string;
  bondingCurve?: string;
  createdAt: number;
  firstSeen: number;
  source: 'pump' | 'dexscreener' | 'scan' | 'replay';
  pool: string;
  graduated: boolean;
  graduatedAt?: number;

  vSol: number;
  vTokens: number;
  mcapSol: number;
  peakMcapSol: number;
  bondProgress: number;

  balances: Map<string, number>;
  firstBuyAt: Map<string, number>;
  trades: Trade[];
  candles: Candle[];
  buys: number;
  sells: number;
  sellers: Set<string>;
  creatorMax: number;
  creatorSold: number;
  earlyBuys: Array<{ wallet: string; tokens: number; sol: number }>;
  snipers: Set<string>;
  smartIn: Map<string, number>;
  smartOut: Set<string>;

  external?: {
    mcapUsd?: number; liquidityUsd?: number; volume24hUsd?: number; change24h?: number; holders?: number;
    /** DexScreener windows, used when there is no live trade stream for the token. */
    m5?: WindowExt; h1?: WindowExt; statsAt?: number;
  };
  trending?: { boosted: boolean; profile: boolean; at: number };

  audit?: Audit;
  auditQueued: boolean;
  gates: Record<string, AgentResult>;
  signals: Record<string, AgentResult>;
  scoreParts: Record<string, number>;
  score: number;
  status: TokenStatus;
  hardFails: Array<{ tag: string; why: string }>;
  rugged: boolean;
  promotedAt?: number;
  blockedAt?: number;

  timeline: TimelineEvent[];
  lastActivity: number;
  dirty: boolean;
}

export interface WindowExt { buys: number; sells: number; volUsd: number; change: number }

export interface FeedItem {
  id: number;
  t: number;
  agent: string;
  level: 'info' | 'good' | 'warn';
  mint?: string;
  symbol?: string;
  text: string;
}

export interface UserSettings {
  preset: 'degen' | 'balanced' | 'strict';
  gates: { honeypot: boolean; authority: boolean; vamp: boolean; devHistory: boolean; bundles: boolean; socials: boolean };
  limits: {
    maxBundle: number; maxTop10: number; maxDev: number; maxSniper: number;
    minScore: number; minHolders: number; minVolUsd: number; minSmart: number;
  };
  alerts: { enabled: boolean; minScore: number; devSell: boolean; scoreDrop: boolean; smartExit: boolean; graduate: boolean };
}
