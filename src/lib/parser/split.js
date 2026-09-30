// Splits a normalised line into two sides (artist/title, orientation often
// unknown) and pulls out featuring artists, version info and noise.

const VERSION_WORDS = String.raw`remix|rmx|mix|edit|vip|rework|bootleg|flip|dub|version|remaster(?:ed)?|live|acoustic|instrumental|extended|radio|club|re-?edit|mash-?up|demo|reprise|sped up|slowed|reverb|refix|remake|cover`;
export const VERSION_RE = new RegExp(String.raw`\b(?:${VERSION_WORDS})\b`, 'i');
// Versions that describe the "normal" release and should not steer matching.
const NEUTRAL_VERSION_RE = /^(?:original(?: mix| version)?|remaster(?:ed)?(?: \d{4})?|\d{4} remaster(?:ed)?|album version|single version|radio edit)$/i;
const NOISE_RE = /^(?:official\b.*|(?:music|lyrics?|audio|hd|hq|4k|official)(?: video| audio| visuali[sz]er)?|video|audio|visuali[sz]er|hd|hq|4k|explicit|clean|free (?:download|dl)|out now|premiere|full album|new|m\/v|mv|clip officiel|lyrics?)$/i;
const FEAT_IN_BRACKETS = /^(?:feat\.?|ft\.?|featuring|with)\s+(.+)$/i;
const FEAT_INLINE = /\s+(?:feat\.?|ft\.?|featuring)\s+(.+?)(?=\s+[\(\[]|\s+-\s|\s+\/\s|$)/i;

const UNKNOWN_SIDE = /^(?:id|ids|\?+|\.{2,}|unknown(?: (?:artist|track|title|song|id))?|tba|tbc|tbd|unreleased(?: id)?|n\/a|untitled(?: id)?|no id|id remix|id edit)$/i;
const SKIP_WHOLE = /^(?:intro|outro|start|end|ending|begin|beginning|credits|break|interlude|silence|tracklist|track list|tracklisting|setlist|songs?|playlist|live set|b2b)$/i;

export function isUnknownSide(s) {
  return !s || UNKNOWN_SIDE.test(s.trim());
}

function stripQuotes(s) {
  return s.replace(/^["']+|["']+$/g, '').trim();
}

/** Find the first occurrence of `sep` that is not inside brackets or quotes. */
function indexAtDepth0(text, sep) {
  let depth = 0;
  let inQuote = false;
  for (let i = 0; i <= text.length - sep.length; i++) {
    const ch = text[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === '(' || ch === '[') depth++;
    else if ((ch === ')' || ch === ']') && depth > 0) depth--;
    if (depth === 0 && !inQuote && text.startsWith(sep, i)) return i;
  }
  return -1;
}

function splitAll(text, sep) {
  const parts = [];
  let rest = text;
  let idx;
  while ((idx = indexAtDepth0(rest, sep)) !== -1) {
    parts.push(rest.slice(0, idx));
    rest = rest.slice(idx + sep.length);
  }
  parts.push(rest);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Pull bracketed groups out, classifying them as featuring / version / noise / label. */
function extractBrackets(text) {
  const featuring = [];
  const versions = [];
  const out = text.replace(/\s*[\(\[]([^\(\)\[\]]*)[\)\]]/g, (whole, inner, offset) => {
    const body = inner.trim();
    const isSquare = whole.trim().startsWith('[');
    if (!body) return '';
    const feat = FEAT_IN_BRACKETS.exec(body);
    if (feat) {
      featuring.push(...splitArtists(feat[1]));
      return '';
    }
    if (NOISE_RE.test(body)) return '';
    if (VERSION_RE.test(body) || NEUTRAL_VERSION_RE.test(body)) {
      versions.push(body);
      return '';
    }
    // [Label] / [Genre] / [Free DL] style tags; a leading "(I Can't Get No)" is title
    if (isSquare && offset > 0) return '';
    return whole;
  });
  return { text: out.replace(/\s+/g, ' ').trim(), featuring, versions };
}

export function splitArtists(s) {
  return s
    .split(/\s*(?:,|&|\bx\b|\band\b|\bvs\.?\b|\+)\s*/i)
    .map((a) => a.trim())
    .filter(Boolean);
}

function trimNoiseTail(text) {
  // "Artist - Title Official Video" / "| Official Audio"
  // (bracketed versions are handled by extractBrackets)
  return text.replace(/\s*(?:[|/-]\s*)?(?<![\(\[])\b(?:official\s+(?:music\s+)?(?:video|audio|visuali[sz]er)|lyric video|music video)\b.*$/i, '').trim();
}

function finish(result) {
  const version = result.versions.filter((v) => !NEUTRAL_VERSION_RE.test(v)).join(' ') || null;
  const left = result.left ? stripQuotes(result.left) : null;
  const right = result.right ? stripQuotes(result.right) : null;
  let status = 'ok';
  if (left && right) {
    if (isUnknownSide(left) && isUnknownSide(right)) status = 'unknown';
    else if (isUnknownSide(right)) status = 'unknown'; // "Artist - ID": unreleased
  } else if (isUnknownSide(right || left)) {
    status = 'unknown';
  }
  // "ID - Title": artist unknown, still searchable by title
  const leftUnknown = left && right && status === 'ok' && isUnknownSide(left);
  return {
    left: leftUnknown ? null : left,
    right,
    orientation: leftUnknown ? 'artist-first' : result.orientation,
    featuring: result.featuring,
    version,
    status,
  };
}

/**
 * @param {string} text normalised line
 * @returns {{left: string|null, right: string|null, orientation: 'artist-first'|'title-first'|null,
 *            featuring: string[], version: string|null, status: 'ok'|'unknown'|'skip'}}
 */
export function splitLine(text) {
  let t = trimNoiseTail(text);
  const featuring = [];

  const inline = FEAT_INLINE.exec(t);
  if (inline) {
    featuring.push(...splitArtists(inline[1]));
    t = (t.slice(0, inline.index) + t.slice(inline.index + inline[0].length)).trim();
  }

  const br = extractBrackets(t);
  t = br.text;
  featuring.push(...br.featuring);
  const versions = [...br.versions];
  const base = { featuring, versions, orientation: null };

  if (!t) return finish({ ...base, left: null, right: br.versions.join(' ') || null });
  if (SKIP_WHOLE.test(t)) return { ...finish({ ...base, left: null, right: t }), status: 'skip' };

  // 1. " - " is by far the most common separator.
  let parts = splitAll(t, ' - ');
  if (parts.length === 1) {
    // Sloppy one-sided dashes: "Artist -Title", "Artist- Title" (not "Jay-Z").
    const m = /^(.+?\S)(?:\s+-(?=\S)|-\s+)(.+)$/.exec(t);
    if (m) parts = [m[1], m[2]];
  }
  if (parts.length >= 2) {
    const [a, b, ...rest] = parts;
    for (const extra of rest) if (VERSION_RE.test(extra)) versions.push(extra);
    // "Title | Label 2012" / "Title | Free DL": keep the title.
    const [title, ...tail] = splitAll(b, ' | ');
    for (const extra of tail) if (VERSION_RE.test(extra)) versions.push(extra);
    return finish({ ...base, left: a, right: title });
  }

  // 2. Title "by" Artist.
  const byIdx = t.search(/\s+by\s+/i);
  if (byIdx > 0) {
    const m = /^(.+?)\s+by\s+(.+)$/i.exec(t);
    return finish({ ...base, left: m[2], right: m[1], orientation: 'artist-first' });
  }

  // 3. Artist "Title".
  const quoted = /^([^"]+?)\s*[:,]?\s*"([^"]+)"\s*(.*)$/.exec(t);
  if (quoted) return finish({ ...base, left: quoted[1], right: quoted[2], orientation: 'artist-first' });
  const quotedFirst = /^"([^"]+)"\s*[,:]?\s*(.+)$/.exec(t);
  if (quotedFirst) return finish({ ...base, left: quotedFirst[2], right: quotedFirst[1], orientation: 'artist-first' });

  // 4. Less common separators.
  for (const sep of [' | ', ' // ', ' / ', ' ~ ', ': ', ' : ']) {
    parts = splitAll(t, sep);
    if (parts.length >= 2) return finish({ ...base, left: parts[0], right: parts[1] });
  }

  // 5. Single comma, as a last resort ("Title, Artist").
  parts = splitAll(t, ', ');
  if (parts.length === 2) return finish({ ...base, left: parts[0], right: parts[1] });

  // Title only.
  return finish({ ...base, left: null, right: t });
}
