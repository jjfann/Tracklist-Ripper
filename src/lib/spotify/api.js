import { getAccessToken } from './auth.js';

const BASE = 'https://api.spotify.com/v1';

export class SpotifyError extends Error {
  constructor(status, message, body, endpoint) {
    super(message);
    this.name = 'SpotifyError';
    this.status = status;
    this.body = body;
    this.endpoint = endpoint; // e.g. "GET /search", so errors say which call failed
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch wrapper: auth header, JSON, 429 Retry-After, one 401 refresh, 5xx backoff.
 * @param {string} path  "/me" or a full https://api.spotify.com URL (pagination "next")
 */
export async function spotifyFetch(path, { method = 'GET', query, body, raw } = {}) {
  const url = new URL(path.startsWith('http') ? path : BASE + path);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, v);

  let force = false;
  for (let attempt = 0; ; attempt++) {
    const token = await getAccessToken({ force });
    force = false;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}),
        ...(raw ? { 'Content-Type': raw } : {}),
      },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });

    if (res.status === 429 && attempt < 6) {
      const wait = Number(res.headers.get('Retry-After') || 1);
      await sleep(Math.min(wait, 30) * 1000 + 250);
      continue;
    }
    if (res.status === 401 && attempt === 0) {
      force = true;
      continue;
    }
    if (res.status >= 500 && attempt < 3) {
      await sleep(500 * 2 ** attempt);
      continue;
    }
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      const msg = json?.error?.message || res.statusText || 'Spotify request failed';
      const endpoint = `${method} ${url.pathname.replace(/^\/v1/, '')}`;
      throw new SpotifyError(res.status, `${msg} (${res.status} on ${endpoint})`, json, endpoint);
    }
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
}

/** Simple promise pool: run at most `n` tasks concurrently. */
export function createLimiter(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => {
      active--;
      next();
    });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}
