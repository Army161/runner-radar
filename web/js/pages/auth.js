import { api, html, paint, icon, logo, toast } from '../lib.js';
import { navigate, clearMe } from '../main.js';

const ERRORS = {
  denied: 'Sign-in was cancelled.',
  state: 'That sign-in link expired or was opened in another browser. Please try again.',
  oauth: 'We could not complete sign-in with that provider. Please try again.',
  unavailable: 'That sign-in method is not available.',
};

export async function mount(root, { mode }) {
  const signup = mode === 'signup';
  const providers = await api('/auth/providers').catch(() => ({}));
  const err = new URLSearchParams(location.search).get('error');
  const btn = (key, label, ic) => providers[key]
    ? html`<a class="btn oauth" href="/auth/${key}/start">${icon(ic, 20)}<span>${signup ? 'Sign up' : 'Continue'} with ${label}</span></a>`
    : '';
  const any = providers.google || providers.discord || providers.x;

  paint(root, html`
  <div class="auth-page">
    <div class="auth-card">
      ${logo()}
      <h1>${signup ? 'Create your account' : 'Welcome back'}</h1>
      <p class="muted">${signup ? 'Free to start. Set your filters in about a minute.' : 'Sign in to your scanner.'}</p>
      ${err ? html`<p class="alert" role="alert">${ERRORS[err] ?? ERRORS.oauth}</p>` : ''}
      <div class="stack">
        ${btn('google', 'Google', 'google')}
        ${btn('discord', 'Discord', 'discord')}
        ${btn('x', 'X', 'xlogo')}
        ${providers.dev ? html`<button class="btn ghost" data-dev>Local dev sign-in</button>` : ''}
        ${!any && !providers.dev ? html`<p class="alert">No sign-in methods are configured on this server yet. Add an OAuth app in <code>.env</code>.</p>` : ''}
      </div>
      <ul class="trust">
        <li>${icon('shield', 16)} Secure OAuth sign-in — we never see your password</li>
        <li>${icon('shield', 16)} We never ask for your seed phrase or private keys</li>
        <li>${icon('shield', 16)} Runner Radar can't move funds or trade for you</li>
      </ul>
      <p class="fine">${signup ? html`Already have an account? <a href="/login" data-link>Sign in</a>` : html`New here? <a href="/signup" data-link>Create an account</a>`}</p>
      <p class="fine">By continuing you agree to the <a href="/terms" data-link>Terms</a> and <a href="/privacy" data-link>Privacy Policy</a>.</p>
    </div>
  </div>`);

  root.querySelector('[data-dev]')?.addEventListener('click', async () => {
    try {
      const r = await api('/auth/dev', { method: 'POST' });
      clearMe();
      navigate(r.onboarded ? '/app' : '/onboarding');
    } catch (e) { toast(e.message, 'error'); }
  });
}
