// Vercel build: publishes the web app as static files and proxies /api, /auth and /healthz
// to the always-on Runner Radar engine (BACKEND_URL). Uses the Build Output API, so no
// framework or dependencies are involved. Run by Vercel via vercel.json → buildCommand.
//
// Why a split: the scanner keeps a live WebSocket to pump.fun, timers, and a database on disk.
// Vercel Functions scale to zero and have no persistent disk, so the engine runs on an
// always-on host (Render, see render.yaml) and Vercel serves the site on your domain in front of it.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '.vercel', 'output');
const backend = (process.env.BACKEND_URL || '').trim().replace(/\/+$/, '');

if (backend && !/^https:\/\/[^\s/]+$/.test(backend)) {
  console.error(`BACKEND_URL must look like https://your-engine.onrender.com (got "${backend}")`);
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'static'), { recursive: true });
cpSync(join(root, 'web'), join(out, 'static'), { recursive: true });
writeFileSync(join(out, 'static', '_backend-missing.json'), JSON.stringify({
  error: 'The Runner Radar engine is not connected. Set BACKEND_URL in the Vercel project settings and redeploy.',
}));

// Same security headers the engine sends, applied to everything Vercel serves itself.
const security = {
  'Content-Security-Policy': [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com", "img-src 'self' https: data:", "connect-src 'self'",
    "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", "object-src 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

const engine = backend
  ? [
      { src: '^/(api|auth)/(.*)$', dest: `${backend}/$1/$2` },
      { src: '^/healthz$', dest: `${backend}/healthz` },
    ]
  : [
      { src: '^/(api|auth)/.*$', status: 503, dest: '/_backend-missing.json', headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
    ];

const config = {
  version: 3,
  routes: [
    { src: '^/(?!api/|auth/|healthz$).*', headers: security, continue: true },
    { src: '^/index\\.html$', headers: { 'Cache-Control': 'no-cache' }, continue: true },
    ...engine,
    { handle: 'filesystem' },
    // Single-page app: every other path renders the app shell.
    { src: '^/.*$', dest: '/index.html', headers: { 'Cache-Control': 'no-cache' } },
  ],
};

writeFileSync(join(out, 'config.json'), JSON.stringify(config, null, 2));
console.log(backend
  ? `Runner Radar web built → engine at ${backend}`
  : 'Runner Radar web built WITHOUT an engine (BACKEND_URL not set): pages load, sign-in and data return 503 until you set it.');
