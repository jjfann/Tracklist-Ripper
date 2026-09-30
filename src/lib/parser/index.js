import { detectBlock } from './detect.js';
import { splitLine, VERSION_RE } from './split.js';

/**
 * @typedef {Object} ParsedTrack
 * @property {number} index
 * @property {string} raw          original line
 * @property {string} text         normalised line
 * @property {string|null} timestamp
 * @property {string|null} left    first side (artist or title, see orientation)
 * @property {string|null} right   second side, or the title when there is no artist
 * @property {'artist-first'|'title-first'|null} orientation
 * @property {string[]} featuring
 * @property {string|null} version  e.g. "Disclosure Remix"
 * @property {'ok'|'unknown'|'skip'} status
 * @property {boolean} [nano]      refined by Gemini Nano
 */

/**
 * @param {string} text
 * @param {{ allowTitles?: boolean }} [opts]
 * @returns {{ tracks: ParsedTrack[], mode: string }}
 */
export function parseTracklist(text, opts) {
  const { rows, mode } = detectBlock(text, opts);
  const tracks = rows.map((r, index) => {
    const base = { index, raw: r.raw.trim(), text: r.text, timestamp: r.timestamp };
    if (r.placeholder) {
      return { ...base, left: null, right: null, orientation: null, featuring: [], version: null, status: 'unknown' };
    }
    return { ...base, ...splitLine(r.text) };
  });
  return { tracks, mode };
}

/** The two readings of a track worth searching, most likely first. */
export function hypotheses(track, prior = null) {
  const { left, right } = track;
  if (!left) {
    // "Taboo (Shola Ama)": some lists put the artist in brackets after the title.
    const m = /^(.*\S)\s*\(([^()]+)\)$/.exec(right || '');
    const inBrackets = m && !VERSION_RE.test(m[2]) ? [{ artist: m[2], title: m[1], orientation: 'title-first' }] : [];
    return [...inBrackets, { artist: null, title: right, orientation: 'title-only' }];
  }
  const af = { artist: left, title: right, orientation: 'artist-first' };
  const tf = { artist: right, title: left, orientation: 'title-first' };
  const lead = track.orientation || prior || 'artist-first';
  return lead === 'title-first' ? [tf, af] : [af, tf];
}
