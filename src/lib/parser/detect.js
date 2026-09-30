// Finds which lines of a description/comment are the tracklist.
import { normalizeLine, stripSequentialNumbers } from './normalize.js';

const URL_RE = /(?:https?:\/\/|www\.|\b[\w-]+\.(?:com|co\.uk|io|net|org|ly|be|gg|fm|me|to)\b)/i;
const SOCIAL_RE = /^(?:@\w|#\w|follow\b|subscribe|instagram|twitter|facebook|soundcloud|spotify\b|apple music|bandcamp|tiktok|beatport|support\b|stream\b|download\b|buy\b|merch|contact|booking|business|e-?mail|patreon|discord|listen\b|artwork|art by|photo|(?:mixed|mastered|curated|compiled|selected|recorded) by|picture|image|cover art|copyright|©|all rights|disclaimer|no copyright|thanks|thank you|enjoy|like and|please|if you|this (?:mix|video|playlist)|check out|join\b|watch\b|turn on|leave a)/i;
const HEADER_RE = /^(?:(?:full\s+)?track\s?list(?:ing)?|set\s?list|songs?(?: list)?|playlist|side\s+[a-d]\d?|disc\s+\d+|cd\s*\d+|part\s+\d+|vol(?:ume)?\.?\s*\d+|chapters?|timestamps?|tracks?)\b[^-]*$/i;
// Something that separates artist from title.
export const SEP_RE = /\s-\s|\S\s+-\S|\S-\s+\S|\s+by\s+|"[^"]+"|\s[|~]\s|\s\/{1,2}\s/i;

function classify(row) {
  const words = row.text ? row.text.split(/\s+/).length : 0;
  row.hasSep = SEP_RE.test(row.text);
  row.junk =
    (!row.text && !row.placeholder) ||
    (URL_RE.test(row.raw) && !row.hasSep) || // a link after "Artist - Title" is fine
    SOCIAL_RE.test(row.text) ||
    (HEADER_RE.test(row.text) && !row.hasSep) ||
    row.text.length > 140 ||
    words > 18 ||
    (!row.hasSep && /[a-z]{3,}[.!?]\s+[A-Z].*[.!?]$/.test(row.text)); // multi-sentence prose
  return row;
}

/**
 * @param {string} text full description or comment
 * @param {{ allowTitles?: boolean }} [opts] allowTitles: accept a plain list of
 *   song titles (only for text the user pasted; descriptions have lyrics etc.)
 * @returns {{ rows: Array<object>, mode: 'single'|'timestamps'|'separators'|'titles'|'empty' }}
 */
export function detectBlock(text, { allowTitles = false } = {}) {
  const lines = String(text || '').split(/\r?\n/);

  // YouTube Music "Topic" uploads: "Provided to YouTube by X\n\nTitle · Artist · Artist".
  if (/Provided to YouTube by/i.test(text)) {
    const line = lines.find((l) => l.includes(' · '));
    if (line) {
      const [title, ...artists] = line.split(' · ').map((p) => p.trim());
      const row = { i: 0, raw: line, ...normalizeLine(`${artists.join(', ')} - ${title}`) };
      return { rows: [row], mode: 'single' };
    }
  }

  const rows = lines.map((raw, i) => classify({ i, raw, ...normalizeLine(raw) }));

  // Timestamped lines are the strongest signal (chapters / tracklists).
  const stamped = rows.filter((r) => r.timestamp && !r.junk);
  if (stamped.length >= 3) {
    return { rows: stripSequentialNumbers(stamped), mode: 'timestamps' };
  }

  // Otherwise: the densest run of separator lines, tolerating blank lines and
  // one stray line between tracks.
  const isCand = (r) => !r.junk && (r.hasSep || r.placeholder);
  let best = [];
  let cur = [];
  let gap = 0;
  for (const r of rows) {
    if (isCand(r)) {
      cur.push(r);
      gap = 0;
    } else if (!r.text && !r.placeholder) {
      continue; // blank lines don't break a run
    } else if (++gap > 1 && cur.length) {
      if (cur.length > best.length) best = cur;
      cur = [];
      gap = 0;
    }
  }
  if (cur.length > best.length) best = cur;

  const meaningful = rows.filter((r) => !r.junk);
  if (best.length >= 2 || (best.length === 1 && meaningful.length <= 2)) {
    return { rows: stripSequentialNumbers(best), mode: 'separators' };
  }

  // Last resort: a plain list of song titles (e.g. pasted by hand). Only when
  // the text is mostly list-like; a description full of links/socials is not.
  const nonEmpty = rows.filter((r) => r.raw.trim());
  const junkShare = nonEmpty.filter((r) => r.junk).length / Math.max(1, nonEmpty.length);
  const titles = meaningful.filter((r) => r.text.length <= 80);
  if (allowTitles && titles.length && junkShare <= 0.25) return { rows: stripSequentialNumbers(titles), mode: 'titles' };
  return { rows: [], mode: 'empty' };
}
