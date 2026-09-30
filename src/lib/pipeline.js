// parse → (Nano refine) → match → context rescore → review → press
import { parseTracklist } from './parser/index.js';
import { matchTrack, rescore } from './matcher/index.js';
import { buildContext } from './matcher/context.js';
import { createLimiter } from './spotify/api.js';
import { createPlaylist, getPlaylistUris, addItems, uploadCover } from './spotify/playlists.js';

/**
 * @param {object} args
 * @param {string} args.text
 * @param {{title?: string, channel?: string, url?: string}} [args.meta]
 * @param {{search: Function, getArtistGenres?: Function}} args.deps
 * @param {(tracks: object[], opts: object) => Promise<object[]>} [args.refine]  Nano refiner
 * @param {boolean} [args.allowTitles]  accept a bare list of titles (pasted text)
 * @param {(e: object) => void} [args.onEvent]
 */
export async function analyse({ text, meta = {}, deps, refine, allowTitles = false, onEvent = () => {} }) {
  let { tracks, mode } = parseTracklist(text, { allowTitles });
  onEvent({ type: 'parsed', tracks, mode });
  if (!tracks.length) return { results: [], mode };

  if (refine) {
    try {
      onEvent({ type: 'refining' });
      tracks = await refine(tracks, { onProgress: (done, total) => onEvent({ type: 'refine-progress', done, total }) });
      onEvent({ type: 'refined', tracks });
    } catch (e) {
      onEvent({ type: 'refine-failed', error: e });
    }
  }

  const total = tracks.length;
  let done = 0;
  const lim = createLimiter(4);
  const first = await Promise.all(
    tracks.map((t) =>
      lim(async () => {
        const r = await matchTrack(t, { search: deps.search });
        onEvent({ type: 'matched', result: r, done: ++done, total });
        return r;
      }),
    ),
  );

  // Second pass: let the confident matches vote on the ambiguous ones.
  onEvent({ type: 'context' });
  const ctx = await buildContext(first, { getArtistGenres: deps.getArtistGenres, meta });
  const unsure = first.filter((r) => (r.tier === 'review' || r.tier === 'missing') && r.pool.size);
  await ctx.ensureGenres(unsure.flatMap((r) => r.alternatives.slice(0, 4).map((a) => a.cand.artists[0]?.id)));
  const results = first.map((r) => (r.tier === 'review' || r.tier === 'missing' ? rescore(r, ctx) : r));

  // Default picks; the same song twice in a tracklist is only added once.
  const seen = new Set();
  for (const r of results) {
    r.pick = r.tier === 'auto' || r.tier === 'review' ? r.best.cand : null;
    if (r.pick && seen.has(r.pick.uri)) {
      r.duplicate = true;
      r.pick = null;
    } else if (r.pick) {
      seen.add(r.pick.uri);
    }
  }
  onEvent({ type: 'analysed', results });
  return { results, mode, ctx };
}

export function summarise(results) {
  const s = { total: results.length, auto: 0, review: 0, missing: 0, unknown: 0, skip: 0, duplicate: 0, picked: 0 };
  for (const r of results) {
    if (r.duplicate) s.duplicate++;
    else s[r.tier]++;
    if (r.pick) s.picked++;
  }
  // "tracks" = distinct songs in the tracklist (IDs included, intros and repeats not)
  s.tracks = s.total - s.skip - s.duplicate;
  return s;
}

/**
 * @param {object} args
 * @param {object[]} args.picks  slim Spotify tracks, in order
 * @param {{type: 'new', name: string, isPublic: boolean, description?: string} | {type: 'existing', playlist: {id: string, name: string, url: string}}} args.destination
 * @param {boolean} [args.skipExisting]
 * @param {() => Promise<string|null>} [args.makeCover]  base64 JPEG for new playlists
 */
export async function press({ picks, destination, skipExisting = true, makeCover, onEvent = () => {} }) {
  const uris = [...new Set(picks.map((p) => p.uri))];
  let playlist;
  if (destination.type === 'new') {
    onEvent({ type: 'creating' });
    playlist = await createPlaylist({
      name: destination.name,
      description: destination.description || '',
      isPublic: destination.isPublic,
    });
  } else {
    playlist = destination.playlist;
  }

  let toAdd = uris;
  let alreadyThere = 0;
  if (destination.type === 'existing' && skipExisting) {
    onEvent({ type: 'checking' });
    const existing = await getPlaylistUris(playlist.id);
    toAdd = uris.filter((u) => !existing.has(u));
    alreadyThere = uris.length - toAdd.length;
  }

  onEvent({ type: 'adding', added: 0, total: toAdd.length });
  await addItems(playlist.id, toAdd, (added) => onEvent({ type: 'adding', added, total: toAdd.length }));

  if (destination.type === 'new' && makeCover) {
    try {
      const jpeg = await makeCover();
      if (jpeg) await uploadCover(playlist.id, jpeg);
    } catch (e) {
      console.warn('Cover upload failed', e);
    }
  }
  return { playlist, added: toAdd.length, alreadyThere };
}
