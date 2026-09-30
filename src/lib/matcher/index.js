import { hypotheses } from '../parser/index.js';
import { scoreCandidate, tierOf, AUTO, REVIEW } from './score.js';
import { similarity } from './similarity.js';
import { fieldValue } from '../spotify/search.js';

/**
 * @typedef {Object} MatchResult
 * @property {object} track         ParsedTrack
 * @property {'auto'|'review'|'missing'|'unknown'|'skip'} tier
 * @property {{cand: object, score: number, hyp: object}|null} best
 * @property {Array<{cand: object, score: number, hyp: object}>} alternatives  best first
 * @property {Array<{cand: object, rank: number}>} pool  all candidates seen (for rescoring)
 * @property {Array<object>} hyps
 */

function freeText(...parts) {
  return parts.filter(Boolean).join(' ').replace(/["():[\]]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Score every candidate under every hypothesis and rank them. */
export function evaluate(track, hyps, pool, ctx = null) {
  const scored = [];
  for (const { cand, rank } of pool.values()) {
    let best = null;
    for (const hyp of hyps) {
      const s = scoreCandidate(hyp, track, cand, rank, ctx);
      if (!best || s.score > best.score) best = { cand, hyp, ...s };
    }
    scored.push(best);
  }

  // Title-only: a title that only one artist has recorded is a safer bet.
  for (const s of scored) {
    if (s.hyp.artist) continue;
    const exact = scored.filter((o) => o.titleSim >= 0.9).map((o) => o.cand.artists[0]?.id);
    if (s.titleSim >= 0.9 && new Set(exact).size === 1) s.score = Math.min(1, s.score + 0.08);
  }

  scored.sort((a, b) => b.score - a.score);
  // Collapse the same song on several releases (album vs single) to one entry.
  const seen = new Set();
  const alternatives = [];
  for (const s of scored) {
    const key = `${s.cand.artists[0]?.name}|${s.cand.name}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    alternatives.push(s);
    if (alternatives.length >= 5) break;
  }
  const best = alternatives[0] || null;
  return { best, alternatives, tier: best ? tierOf(best.score) : 'missing' };
}

/**
 * Search Spotify for one parsed line.
 * @param {object} track ParsedTrack
 * @param {{ search: (q: string, opts?: {pages?: number}) => Promise<object[]>, prior?: string|null }} deps
 * @returns {Promise<MatchResult>}
 */
export async function matchTrack(track, { search, prior = null }) {
  if (track.status !== 'ok' || !track.right) {
    return { track, tier: track.status === 'skip' ? 'skip' : 'unknown', best: null, alternatives: [], pool: new Map(), hyps: [] };
  }

  const hyps = hypotheses(track, prior);
  const pool = new Map();
  const add = (list) =>
    list.forEach((cand, rank) => {
      const e = pool.get(cand.id);
      if (!e || rank < e.rank) pool.set(cand.id, { cand, rank });
    });
  const bestScore = () => evaluate(track, hyps, pool).best?.score ?? 0;

  // 1. Field-filtered searches for each reading, most likely first.
  for (const h of hyps) {
    const q = h.artist
      ? `track:"${fieldValue(h.title)}" artist:"${fieldValue(h.artist)}"`
      : `track:"${fieldValue(h.title)}"`;
    add(await search(q, { pages: h.artist ? 1 : 2 }));
    if (bestScore() >= AUTO) break;
  }

  // 2. Free-text search (tolerates typos and odd punctuation).
  if (bestScore() < AUTO) {
    add(await search(freeText(track.left, track.right, track.version)));
  }

  // 3. Maybe the split was wrong ("Stand by Me", "Title: Subtitle"): try the whole line as a title.
  if (bestScore() < REVIEW && track.left) {
    const whole = freeText(track.text.replace(/\s*[\(\[][^\)\]]*[\)\]]/g, ''));
    hyps.push({ artist: null, title: whole, orientation: 'title-only' });
    add(await search(whole));
  }

  return { track, hyps, pool, ...evaluate(track, hyps, pool) };
}

/** Re-rank an existing result with mix context (no new searches). */
export function rescore(result, ctx) {
  if (!result.pool?.size) return result;
  return { ...result, ...evaluate(result.track, result.hyps, result.pool, ctx) };
}

/** Is this candidate the same recording as another (for de-duping)? */
export function sameSong(a, b) {
  return a.id === b.id || (similarity(a.name, b.name) > 0.95 && a.artists[0]?.id === b.artists[0]?.id);
}
