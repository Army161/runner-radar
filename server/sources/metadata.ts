import type { TokenMeta } from '../types.ts';
import { fetchJson, str } from '../util.ts';

const safeUrl = (u: unknown): string | undefined => {
  const s = str(u, 300).trim();
  if (!s) return undefined;
  try {
    const url = new URL(s.startsWith('http') ? s : `https://${s}`);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch { return undefined; }
};

export function gatewayUrl(uri: string, gateway: string): string | null {
  if (!uri) return null;
  if (uri.startsWith('ipfs://')) return gateway + uri.slice(7);
  const m = uri.match(/\/ipfs\/([A-Za-z0-9]{40,70}.*)$/);
  if (m) return gateway + m[1];
  return uri.startsWith('https://') ? uri : null;
}

/** Fetch token metadata JSON (name, image, socials). Small, time-boxed, never trusted as HTML. */
export async function fetchMetadata(uri: string, gateway: string): Promise<TokenMeta | null> {
  const url = gatewayUrl(uri, gateway);
  if (!url) return null;
  const j = await fetchJson(url, { timeoutMs: 5000, maxBytes: 64_000 });
  if (!j || typeof j !== 'object') return null;
  const image = str(j.image, 300);
  return {
    image: image ? (gatewayUrl(image, gateway) ?? undefined) : undefined,
    description: str(j.description, 500) || undefined,
    twitter: safeUrl(j.twitter ?? j.extensions?.twitter),
    telegram: safeUrl(j.telegram ?? j.extensions?.telegram),
    website: safeUrl(j.website ?? j.extensions?.website),
  };
}
