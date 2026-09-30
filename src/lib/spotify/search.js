import { spotifyFetch, createLimiter } from './api.js';

// Dev-mode apps: search limit max is 10 (Feb 2026), so pages are 10 wide.
const PAGE = 10;
const limit = createLimiter(3);
const searchCache = new Map();

/** Keep only the fields the matcher needs (keeps caches small). */
export function slimTrack(t) {
  return {
    id: t.id,
    uri: t.uri,
    name: t.name,
    artists: (t.artists || []).map((a) => ({ id: a.id, name: a.name })),
    album: {
      name: t.album?.name,
      release_date: t.album?.release_date,
      image: t.album?.images?.at(-1)?.url || t.album?.images?.[0]?.url || null,
      imageLarge: t.album?.images?.[0]?.url || null,
    },
    duration_ms: t.duration_ms,
    explicit: t.explicit,
    url: t.external_urls?.spotify,
  };
}

/** Escape a value for use inside a field filter like track:"..." */
export function fieldValue(s) {
  return String(s || '').replace(/["]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Search tracks. `pages` > 1 fetches further 10-item pages.
 * @returns {Promise<ReturnType<typeof slimTrack>[]>}
 */
export async function searchTracks(q, { pages = 1 } = {}) {
  const key = `${pages}|${q}`;
  if (!searchCache.has(key)) {
    const p = (async () => {
      const out = [];
      for (let page = 0; page < pages; page++) {
        const json = await limit(() =>
          // No market param: with a user token Spotify already uses the account's
          // country, and market=from_token needs the user-read-private scope (403 without it).
          spotifyFetch('/search', { query: { q, type: 'track', limit: PAGE, offset: page * PAGE } }),
        );
        const items = json?.tracks?.items || [];
        out.push(...items.filter(Boolean).map(slimTrack));
        if (items.length < PAGE) break;
      }
      return out;
    })();
    searchCache.set(key, p);
    p.catch(() => searchCache.delete(key));
  }
  return searchCache.get(key);
}

const GENRE_TTL = 30 * 24 * 3600 * 1000;
let genreCache = null;
let persistTimer = null;
const genreInflight = new Map();

function loadGenreCache() {
  genreCache ??= chrome.storage.local.get('artistGenres').then((r) => r.artistGenres || {});
  return genreCache;
}

function persistGenres(cache) {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => chrome.storage.local.set({ artistGenres: cache }), 500);
}

/** Artist genres, cached across sessions ("Get Several Artists" is gone). */
export async function getArtistGenres(id) {
  const cache = await loadGenreCache();
  const hit = cache[id];
  if (hit && Date.now() - hit.at < GENRE_TTL) return hit.genres;
  if (!genreInflight.has(id)) {
    const p = limit(() => spotifyFetch(`/artists/${encodeURIComponent(id)}`))
      .then((json) => {
        const genres = json?.genres || [];
        cache[id] = { genres, at: Date.now() };
        persistGenres(cache);
        return genres;
      })
      .finally(() => genreInflight.delete(id));
    genreInflight.set(id, p);
  }
  return genreInflight.get(id);
}
