import { randomUUID } from 'node:crypto';
import type { Config } from '../config.ts';
import type { DB } from '../db.ts';
import type { Ctx, Router, User } from './core.ts';
import { HttpError, json, redirect, setCookie } from './core.ts';
import { fetchJson, log, randomToken, safeEqual, sha256B64url, sha256Hex, str } from '../util.ts';

const SESSION_DAYS = 30;
const DAY = 86_400_000;
const STATE_TTL = 10 * 60_000;

interface Provider {
  authorize: string;
  token: string;
  scope: string;
  extraAuth?: Record<string, string>;
  profile: (accessToken: string) => Promise<{ id: string; name: string; email: string | null; avatar: string | null }>;
}

const PROVIDERS: Record<string, Provider> = {
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    extraAuth: { prompt: 'select_account' },
    async profile(at) {
      const p = await fetchJson('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${at}` } });
      return { id: String(p.sub), name: str(p.name || p.email || 'Trader', 80), email: p.email_verified ? str(p.email, 200) : null, avatar: str(p.picture, 300) || null };
    },
  },
  discord: {
    authorize: 'https://discord.com/oauth2/authorize',
    token: 'https://discord.com/api/oauth2/token',
    scope: 'identify email',
    async profile(at) {
      const p = await fetchJson('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${at}` } });
      return {
        id: String(p.id), name: str(p.global_name || p.username || 'Trader', 80), email: p.verified ? str(p.email, 200) || null : null,
        avatar: p.avatar ? `https://cdn.discordapp.com/avatars/${p.id}/${p.avatar}.png?size=128` : null,
      };
    },
  },
  x: {
    authorize: 'https://x.com/i/oauth2/authorize',
    token: 'https://api.x.com/2/oauth2/token',
    scope: 'users.read tweet.read',
    async profile(at) {
      const p = await fetchJson('https://api.x.com/2/users/me?user.fields=profile_image_url', { headers: { Authorization: `Bearer ${at}` } });
      const d = p.data ?? {};
      return { id: String(d.id), name: str(d.name || d.username || 'Trader', 80), email: null, avatar: str(d.profile_image_url, 300) || null };
    },
  },
};

export class Auth {
  readonly cookieName: string;
  private cfg: Config;
  private db: DB;
  constructor(cfg: Config, db: DB) {
    this.cfg = cfg;
    this.db = db;
    this.cookieName = cfg.isProd ? '__Host-rr_session' : 'rr_session';
    setInterval(() => {
      db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
      db.prepare('DELETE FROM oauth_states WHERE created_at < ?').run(Date.now() - STATE_TTL);
    }, 15 * 60_000).unref();
  }

  enabledProviders() {
    return {
      google: !!this.cfg.oauth.google, discord: !!this.cfg.oauth.discord, x: !!this.cfg.oauth.x, dev: this.cfg.allowDevLogin,
    };
  }

  // ----- sessions: random 256-bit token in an HttpOnly cookie, only its SHA-256 stored -----
  createSession(c: Ctx, userId: string) {
    const token = randomToken(32);
    this.db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(sha256Hex(token), userId, Date.now() + SESSION_DAYS * DAY);
    setCookie(c.res, this.cookieName, token, { maxAge: SESSION_DAYS * 86400, secure: this.cfg.isProd });
  }

  userFromCookie(c: Ctx): User | null {
    const token = c.cookies[this.cookieName];
    if (!token || token.length > 100) return null;
    const id = sha256Hex(token);
    const row = this.db.prepare(`SELECT s.expires_at, u.id, u.name, u.email, u.avatar, u.onboarded FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`).get(id) as any;
    if (!row) return null;
    const now = Date.now();
    if (row.expires_at < now) { this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id); return null; }
    if (row.expires_at - now < (SESSION_DAYS / 2) * DAY) {
      this.db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(now + SESSION_DAYS * DAY, id);
      setCookie(c.res, this.cookieName, token, { maxAge: SESSION_DAYS * 86400, secure: this.cfg.isProd });
    }
    return { id: row.id, name: row.name, email: row.email, avatar: row.avatar, onboarded: row.onboarded };
  }

  destroySession(c: Ctx) {
    const token = c.cookies[this.cookieName];
    if (token) this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sha256Hex(token));
    setCookie(c.res, this.cookieName, '', { maxAge: 0, secure: this.cfg.isProd });
  }

  private findOrCreateUser(provider: string, p: { id: string; name: string; email: string | null; avatar: string | null }): User {
    const link = this.db.prepare('SELECT user_id FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?').get(provider, p.id) as { user_id: string } | undefined;
    if (link) {
      this.db.prepare('UPDATE users SET avatar = COALESCE(?, avatar) WHERE id = ?').run(p.avatar, link.user_id);
      return this.db.prepare('SELECT id, name, email, avatar, onboarded FROM users WHERE id = ?').get(link.user_id) as unknown as User;
    }
    // New identity → new account. We deliberately never auto-link accounts by email across
    // providers: that would let anyone who controls a matching address take over the account.
    const id = randomUUID();
    this.db.prepare('INSERT INTO users (id, name, email, avatar, created_at) VALUES (?, ?, ?, ?, ?)').run(id, p.name, p.email, p.avatar, Date.now());
    this.db.prepare('INSERT INTO oauth_accounts (provider, provider_user_id, user_id) VALUES (?, ?, ?)').run(provider, p.id, id);
    return { id, name: p.name, email: p.email, avatar: p.avatar, onboarded: 0 };
  }

  routes(r: Router) {
    const cfg = this.cfg;
    const db = this.db;
    const lookup = (name: string) => {
      const ok = Object.hasOwn(PROVIDERS, name) && Object.hasOwn(cfg.oauth, name);
      return { p: ok ? PROVIDERS[name] : undefined, creds: ok ? cfg.oauth[name as keyof Config['oauth']] : null };
    };

    r.add('GET', '/auth/providers', (c) => json(c.res, 200, this.enabledProviders()));

    // Step 1: send the browser to the provider with a single-use state + PKCE challenge.
    r.add('GET', '/auth/:provider/start', (c) => {
      const name = c.params.provider;
      const { p, creds } = lookup(name);
      if (!p || !creds) throw new HttpError(404, 'Sign-in method not available');
      const state = randomToken(32);
      const verifier = randomToken(48);
      db.prepare('INSERT INTO oauth_states (state, provider, verifier, created_at) VALUES (?, ?, ?, ?)').run(state, name, verifier, Date.now());
      setCookie(c.res, 'rr_oauth', state, { maxAge: STATE_TTL / 1000, path: '/auth/', secure: cfg.isProd });
      const q = new URLSearchParams({
        response_type: 'code', client_id: creds.id, redirect_uri: `${cfg.appUrl}/auth/${name}/callback`,
        scope: p.scope, state, code_challenge: sha256B64url(verifier), code_challenge_method: 'S256', ...p.extraAuth,
      });
      redirect(c.res, `${p.authorize}?${q}`);
    }, { limit: 'auth' });

    // Step 2: verify state against the cookie (login-CSRF), exchange the code with the verifier, open a session.
    r.add('GET', '/auth/:provider/callback', async (c) => {
      const name = c.params.provider;
      const { p, creds } = lookup(name);
      const fail = (why: string) => { setCookie(c.res, 'rr_oauth', '', { maxAge: 0, path: '/auth/', secure: cfg.isProd }); redirect(c.res, `/login?error=${why}`); };
      if (!p || !creds) return fail('unavailable');
      if (c.url.searchParams.get('error')) return fail('denied');
      const state = c.url.searchParams.get('state') ?? '';
      const code = c.url.searchParams.get('code') ?? '';
      const cookieState = c.cookies['rr_oauth'] ?? '';
      if (!state || !code || !cookieState || !safeEqual(state, cookieState)) return fail('state');
      const row = db.prepare('SELECT provider, verifier, created_at FROM oauth_states WHERE state = ?').get(state) as { provider: string; verifier: string; created_at: number } | undefined;
      db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);
      if (!row || row.provider !== name || Date.now() - row.created_at > STATE_TTL) return fail('state');
      try {
        const tok = await fetchJson(p.token, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json',
            Authorization: 'Basic ' + Buffer.from(`${encodeURIComponent(creds.id)}:${encodeURIComponent(creds.secret)}`).toString('base64'),
          },
          body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: `${cfg.appUrl}/auth/${name}/callback`, code_verifier: row.verifier, client_id: creds.id }).toString(),
        });
        if (!tok.access_token) throw new Error('no access token');
        const profile = await p.profile(String(tok.access_token));
        if (!profile.id || profile.id === 'undefined') throw new Error('no profile id');
        const user = this.findOrCreateUser(name, profile);
        setCookie(c.res, 'rr_oauth', '', { maxAge: 0, path: '/auth/', secure: cfg.isProd });
        this.createSession(c, user.id);
        redirect(c.res, user.onboarded ? '/app' : '/onboarding');
      } catch (e: any) {
        log.warn(`OAuth ${name} failed:`, e?.message);
        fail('oauth');
      }
    }, { limit: 'auth' });

    r.add('POST', '/auth/logout', (c) => { this.destroySession(c); json(c.res, 200, { ok: true }); });

    r.add('POST', '/auth/logout-all', (c) => {
      const u = this.userFromCookie(c);
      if (u) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
      this.destroySession(c);
      json(c.res, 200, { ok: true });
    });

    // Local development only: one-click account so the app can be tried without OAuth apps.
    r.add('POST', '/auth/dev', (c) => {
      if (!cfg.allowDevLogin) throw new HttpError(404, 'Not found');
      const user = this.findOrCreateUser('dev', { id: 'local-dev', name: 'Local dev', email: null, avatar: null });
      this.createSession(c, user.id);
      json(c.res, 200, { ok: true, onboarded: !!user.onboarded });
    }, { limit: 'auth' });
  }
}
