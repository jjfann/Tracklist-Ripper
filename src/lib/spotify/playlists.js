import { spotifyFetch } from './api.js';

export async function getMe() {
  const me = await spotifyFetch('/me');
  const user = { id: me.id, name: me.display_name || me.id, image: me.images?.[0]?.url || null };
  await chrome.storage.local.set({ spotifyUser: user });
  return user;
}

async function paginate(path, query) {
  const out = [];
  let json = await spotifyFetch(path, { query });
  while (json) {
    out.push(...(json.items || []).filter(Boolean));
    json = json.next ? await spotifyFetch(json.next) : null;
  }
  return out;
}

/** Playlists the user can add to: ones they own or collaborate on. */
export async function listWritablePlaylists(me) {
  const all = await paginate('/me/playlists', { limit: 50 });
  return all
    .filter((p) => p.owner?.id === me.id || p.collaborative)
    .map((p) => ({
      id: p.id,
      name: p.name,
      total: p.items?.total ?? p.tracks?.total ?? null,
      image: p.images?.at(-1)?.url || null,
      url: p.external_urls?.spotify,
    }));
}

export async function createPlaylist({ name, description, isPublic }) {
  const p = await spotifyFetch('/me/playlists', {
    method: 'POST',
    body: { name, description, public: Boolean(isPublic) },
  });
  return { id: p.id, name: p.name, url: p.external_urls?.spotify };
}

/** URIs already in a playlist (to skip duplicates). */
export async function getPlaylistUris(id) {
  const items = await paginate(`/playlists/${id}/items`, { limit: 100 });
  // Feb 2026 renamed item.track -> item.item; accept both.
  return new Set(items.map((i) => (i.item || i.track)?.uri).filter(Boolean));
}

/** Adds URIs in chunks of 100, calling onChunk(addedSoFar) after each. */
export async function addItems(id, uris, onChunk) {
  let added = 0;
  for (let i = 0; i < uris.length; i += 100) {
    const chunk = uris.slice(i, i + 100);
    await spotifyFetch(`/playlists/${id}/items`, { method: 'POST', body: { uris: chunk } });
    added += chunk.length;
    onChunk?.(added, chunk);
  }
  return added;
}

/** Upload a JPEG cover (base64, no data: prefix, <= 256 KB). */
export async function uploadCover(id, base64Jpeg) {
  await spotifyFetch(`/playlists/${id}/images`, { method: 'PUT', body: base64Jpeg, raw: 'image/jpeg' });
}
