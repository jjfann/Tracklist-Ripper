// Scores a Spotify candidate against one reading (hypothesis) of a line.
import { similarity, tokens } from './similarity.js';
import { splitArtists, VERSION_RE } from '../parser/split.js';

export const AUTO = 0.85;
export const REVIEW = 0.6;

const JUNK_RE = /\b(?:karaoke|tribute|made famous|originally performed|in the style of|8[- ]?bit|lullaby|lullabies|music box|as made famous|backing track|ringtone|workout mix|cover version|piano cover|instrumental cover|sing-?along)\b/i;
const NEUTRAL_RE = /\b(?:remaster(?:ed)?|original|radio edit|single version|album version|mono|stereo|from\b)/i;
const ALT_VERSION_RE = /\b(?:remix|rmx|live|acoustic|instrumental|sped up|slowed|reverb|edit|version|mix|demo|rework|bootleg|vip|dub)\b/i;

/**
 * Split "Latch - Special Request Remix" / "Feels (feat. X)" into clean title + version.
 */
export function cleanCandidateTitle(name) {
  let clean = String(name || '');
  const versions = [];
  clean = clean.replace(/\s*[\(\[]([^\)\]]*)[\)\]]/g, (whole, inner) => {
    if (/^(?:feat\.?|ft\.?|featuring|with)\s/i.test(inner)) return '';
    if (VERSION_RE.test(inner) || NEUTRAL_RE.test(inner)) {
      versions.push(inner.trim());
      return '';
    }
    return whole;
  });
  const dash = clean.indexOf(' - ');
  if (dash > 0) {
    const tail = clean.slice(dash + 3);
    if (VERSION_RE.test(tail) || NEUTRAL_RE.test(tail) || /^(?:feat|ft|with)\b/i.test(tail)) {
      versions.push(tail.trim());
      clean = clean.slice(0, dash);
    }
  }
  const version = versions.filter((v) => !NEUTRAL_RE.test(v) || ALT_VERSION_RE.test(v.replace(NEUTRAL_RE, ''))).join(' ') || null;
  return { clean: clean.trim(), version };
}

function normalizeHas(haystack, needle) {
  const t = tokens(needle);
  const h = new Set(tokens(haystack));
  return t.length > 0 && t.every((x) => h.has(x));
}

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function artistSimilarity(wanted, candArtists) {
  if (!candArtists.length) return 0;
  const joined = candArtists.join(' ');
  const parts = splitArtists(wanted);
  const perWanted = parts.map((w) => Math.max(...candArtists.map((c) => similarity(w, c))));
  return Math.max(
    similarity(wanted, joined),
    similarity(wanted, candArtists[0]),
    mean(perWanted),
    // "Kerri Chandler" vs ["Kerri Chandler", "Jerome Sydenham"]: first wanted artist found
    perWanted[0] * (parts.length === 1 ? 1 : 0.9),
  );
}

export function genreScore(genres, profile) {
  if (!profile || !profile.size || !genres?.length) return 0;
  let best = 0;
  for (const g of genres) {
    const toks = tokens(g);
    if (!toks.length) continue;
    const s = mean(toks.map((t) => profile.get(t) || 0));
    best = Math.max(best, s);
  }
  return Math.min(1, best);
}

export function yearOf(cand) {
  const y = parseInt(cand.album?.release_date?.slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

/**
 * @param {{artist: string|null, title: string, orientation: string}} hyp
 * @param {object} track   ParsedTrack
 * @param {object} cand    slim Spotify track
 * @param {number} rank    position in the search results (0 = top)
 * @param {object|null} ctx context from buildContext()
 * @returns {{score: number, titleSim: number, artistSim: number|null}}
 */
export function scoreCandidate(hyp, track, cand, rank, ctx = null) {
  const { clean, version: candVersion } = cleanCandidateTitle(cand.name);
  // "Hot Stuff (Kygo)": a trailing bracket that isn't a known version word is
  // usually a remixer. Match the title without it, then use it as a hint.
  const paren = /^(.*\S)\s*\(([^()]+)\)$/.exec(hyp.title || '');
  const bareTitle = paren ? paren[1] : hyp.title;
  const titleSim = Math.max(similarity(hyp.title, clean), similarity(hyp.title, cand.name), paren ? similarity(bareTitle, clean) : 0);
  const candArtists = cand.artists.map((a) => a.name);
  const artistSim = hyp.artist ? artistSimilarity(hyp.artist, candArtists) : null;

  let score = hyp.artist ? 0.55 * titleSim + 0.45 * artistSim : 0.7 * titleSim;
  if (titleSim < 0.5) score *= 0.6; // right artist, wrong song
  if (hyp.artist && artistSim < 0.45) score *= 0.75; // right title, wrong artist

  // Versions: prefer the requested remix, otherwise prefer the original. An
  // unlabelled bracket ("Hot Stuff (Kygo)") counts as a requested version
  // unless it is part of this candidate's own title ("Lady (Hear Me Tonight)").
  const bracketVersion = paren && hyp.artist && !normalizeHas(clean, paren[2]) ? paren[2] : null;
  const wantVersion = track.version || bracketVersion;
  if (wantVersion) {
    if (candVersion) score += 0.08 * similarity(wantVersion, candVersion) - 0.02;
    else score -= 0.06;
  } else if (candVersion && ALT_VERSION_RE.test(candVersion)) {
    score -= 0.07;
  }

  const blob = `${cand.name} ${cand.album?.name || ''} ${candArtists.join(' ')}`;
  if (JUNK_RE.test(blob) && !JUNK_RE.test(track.text || '')) score -= 0.35;

  if (track.featuring?.length) {
    const hit = track.featuring.some((f) => candArtists.some((c) => similarity(f, c) > 0.85) || similarity(f, cand.name) > 0.6);
    if (hit) score += 0.03;
  }

  score += 0.03 * Math.max(0, 1 - rank / 10);

  if (ctx) {
    const inContext = cand.artists.some((a) => ctx.artistIds.has(a.id));
    const genres = ctx.genresOf(cand.artists[0]?.id);
    const g = genreScore(genres, ctx.profile);
    const y = yearOf(cand);
    const yearScore = ctx.medianYear && y ? Math.exp(-Math.abs(y - ctx.medianYear) / 8) : 0;
    if (!hyp.artist) {
      score += (inContext ? 0.22 : 0) + 0.12 * g + 0.04 * yearScore;
    } else {
      score += (inContext ? 0.04 : 0) + 0.03 * g;
      if (ctx.orientation && hyp.orientation === ctx.orientation) score += 0.02;
    }
  }

  return { score: Math.max(0, Math.min(1, score)), titleSim, artistSim };
}

export function tierOf(score) {
  if (score >= AUTO) return 'auto';
  if (score >= REVIEW) return 'review';
  return 'missing';
}
