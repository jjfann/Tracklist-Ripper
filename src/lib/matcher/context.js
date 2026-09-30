// What the rest of the mix tells us: which artists are in it, its genres,
// its era and whether lines are written artist-first or title-first.
import { tokens } from './similarity.js';
import { yearOf } from './score.js';

// Genre words worth pulling out of a video title like "Deep House Mix 2024".
const GENRE_ALIASES = {
  lofi: 'lo fi', 'lo-fi': 'lo fi', dnb: 'drum and bass', 'd&b': 'drum and bass', rnb: 'r and b', 'r&b': 'r and b',
  hiphop: 'hip hop', 'hip-hop': 'hip hop', kpop: 'k pop', 'k-pop': 'k pop', jpop: 'j pop', 'j-pop': 'j pop',
  citypop: 'city pop', synthwave: 'synthwave', ukg: 'uk garage', 'uk garage': 'uk garage', edm: 'edm',
};
const GENRE_WORDS = new Set(
  (
    'house techno jazz lo fi hip hop rap disco funk soul city pop ambient trance drum bass garage dubstep reggae dub rock ' +
    'metal punk indie pop k j r b classical piano chill chillhop synthwave vaporwave edm afrobeats afro amapiano country folk ' +
    'blues gospel latin reggaeton bossa nova samba phonk trap drill grime breakbeat breaks electro idm shoegaze emo grunge ' +
    'minimal progressive melodic deep tech acid balearic downtempo trip hop neo soul motown boogie italo nu jungle footwork ' +
    'hardstyle hardcore psytrance goa dancehall soca kompa highlife bollywood anime game ost soundtrack orchestral baroque ' +
    'opera swing bebop fusion instrumental beats study sleep study vocal liquid neurofunk bass uk'
  ).split(' '),
);

export function keywordTokens(text) {
  let s = String(text || '').toLowerCase();
  for (const [k, v] of Object.entries(GENRE_ALIASES)) s = s.split(k).join(` ${v} `);
  return tokens(s).filter((t) => GENRE_WORDS.has(t));
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * @param {Array} results   match results (from matchTrack)
 * @param {{ getArtistGenres?: (id: string) => Promise<string[]>, meta?: {title?: string, channel?: string}, maxArtists?: number }} opts
 */
export async function buildContext(results, { getArtistGenres, meta = {}, maxArtists = 15 } = {}) {
  const confident = results.filter((r) => r.tier === 'auto' && r.best);
  const artistIds = new Set();
  const artistCount = new Map();
  for (const r of confident) {
    for (const a of r.best.cand.artists) {
      artistIds.add(a.id);
      artistCount.set(a.id, (artistCount.get(a.id) || 0) + 1);
    }
  }

  // Orientation: how did confident two-sided lines read?
  let af = 0;
  let tf = 0;
  for (const r of confident) {
    if (r.best.hyp.orientation === 'artist-first') af++;
    else if (r.best.hyp.orientation === 'title-first') tf++;
  }
  const orientation = af + tf >= 2 ? (af >= (af + tf) * 0.6 ? 'artist-first' : tf >= (af + tf) * 0.6 ? 'title-first' : null) : null;

  const medianYear = median(confident.map((r) => yearOf(r.best.cand)).filter(Boolean));

  const genreMap = new Map();
  const profile = new Map();
  const ctx = {
    artistIds,
    orientation,
    medianYear,
    profile,
    genresOf: (id) => genreMap.get(id) || [],
    /** Fetch genres for artists we'll need to score against. */
    async ensureGenres(ids) {
      if (!getArtistGenres) return;
      await Promise.all(
        [...new Set(ids)].filter((id) => id && !genreMap.has(id)).map(async (id) => {
          try {
            genreMap.set(id, await getArtistGenres(id));
          } catch {
            genreMap.set(id, []);
          }
        }),
      );
    },
  };

  // Genre profile: token weight = share of mix artists carrying it.
  const top = [...artistCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxArtists).map(([id]) => id);
  await ctx.ensureGenres(top);
  const withGenres = top.filter((id) => ctx.genresOf(id).length);
  const counts = new Map();
  for (const id of withGenres) {
    const toks = new Set(ctx.genresOf(id).flatMap(tokens));
    for (const t of toks) counts.set(t, (counts.get(t) || 0) + 1);
  }
  for (const [t, c] of counts) profile.set(t, c / withGenres.length);
  for (const t of keywordTokens(`${meta.title || ''} ${meta.channel || ''}`)) {
    profile.set(t, Math.max(profile.get(t) || 0, 0.6));
  }

  return ctx;
}
