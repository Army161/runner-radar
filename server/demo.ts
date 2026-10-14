// `npm run demo` on any OS (Windows included): simulated market + one-click local sign-in.
process.env.DEMO ??= '1';
process.env.ALLOW_DEV_LOGIN ??= '1';
await import('./index.ts');
