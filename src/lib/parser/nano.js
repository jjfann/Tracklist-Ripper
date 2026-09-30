// Optional refinement with Chrome's built-in Gemini Nano (Prompt API).
// Heuristics find the tracklist block; Nano only re-reads those lines to say
// which part is the artist and which the title. Anything Nano says that isn't
// literally in the line is discarded (no hallucinated songs).
import { normalizeForMatch } from '../matcher/similarity.js';
import { splitLine } from './split.js';

const CHUNK = 20;
const TIMEOUT_MS = 25_000;
const LANG = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };

const SYSTEM = `You read lines from a music tracklist and split each into artist and song title.
Rules:
- Copy text exactly from the line; never invent, translate or correct names.
- "artist" is the performer(s); "title" is the song name. Leave remix/version text inside the title.
- If a line has no artist, set artist to null.
- Set unknown to true only when the song is not identified (e.g. "ID - ID", "???", "unreleased").`;

const SCHEMA = {
  type: 'object',
  properties: {
    tracks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          line: { type: 'integer' },
          artist: { type: ['string', 'null'] },
          title: { type: 'string' },
          unknown: { type: 'boolean' },
        },
        required: ['line', 'artist', 'title', 'unknown'],
      },
    },
  },
  required: ['tracks'],
};

function api() {
  return typeof LanguageModel !== 'undefined' ? LanguageModel : null;
}

// The Prompt API can stall (e.g. while Chrome sets the model up), so never
// wait on it for long: a stall means "use the heuristics".
function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(message)), ms))),
  ]).finally(() => clearTimeout(timer));
}

/** 'unavailable' | 'downloadable' | 'downloading' | 'available' */
export async function nanoAvailability({ timeoutMs = 3000 } = {}) {
  const LM = api();
  if (!LM) return 'unavailable';
  try {
    return await withTimeout(LM.availability(LANG), timeoutMs, 'availability timed out');
  } catch {
    return 'unavailable';
  }
}

/** Starts (or continues) the model download. Needs a user gesture. */
export async function downloadNano(onProgress) {
  const LM = api();
  if (!LM) throw new Error('This version of Chrome has no on-device model API.');
  const session = await LM.create({
    ...LANG,
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => onProgress?.(e.loaded));
    },
  });
  session.destroy();
}

/** Nano's answer must be made of text that is actually in the line. */
export function isGrounded(value, line) {
  if (!value) return true;
  const v = normalizeForMatch(value);
  return Boolean(v) && normalizeForMatch(line).includes(v);
}

function applyAnswer(track, ans) {
  if (!ans || !ans.title || !isGrounded(ans.title, track.text) || !isGrounded(ans.artist, track.text)) return track;
  if (ans.unknown) {
    // Only trust "unknown" when the line itself hints at it.
    return /\bID\b|\?|unknown|unreleased/i.test(track.text) ? { ...track, status: 'unknown', nano: true } : track;
  }
  // Re-run the splitter on each side so noise/version/featuring handling stays consistent.
  const title = splitLine(ans.title);
  const artist = ans.artist ? splitLine(ans.artist) : null;
  return {
    ...track,
    left: artist ? artist.right : null,
    right: title.right,
    orientation: 'artist-first',
    featuring: [...new Set([...(track.featuring || []), ...(title.featuring || []), ...(artist?.featuring || [])])],
    version: title.version || track.version,
    status: title.right ? 'ok' : track.status,
    nano: true,
  };
}

/**
 * Refine parsed tracks with Nano. Chunks that fail or time out keep their
 * heuristic parse. Throws only if Nano can't start at all.
 */
export async function refineWithNano(tracks, { onProgress } = {}) {
  const LM = api();
  if (!LM) throw new Error('Nano unavailable');
  const session = await withTimeout(
    LM.create({ ...LANG, initialPrompts: [{ role: 'system', content: SYSTEM }] }),
    15_000,
    'Nano took too long to start',
  );
  const out = [...tracks];
  const targets = tracks.filter((t) => t.status === 'ok');
  let done = 0;
  try {
    for (let i = 0; i < targets.length; i += CHUNK) {
      const chunk = targets.slice(i, i + CHUNK);
      const prompt = chunk.map((t) => `${t.index}: ${t.text}`).join('\n');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const reply = await session.prompt(prompt, { responseConstraint: SCHEMA, signal: controller.signal });
        const byLine = new Map(JSON.parse(reply).tracks.map((a) => [a.line, a]));
        for (const t of chunk) out[t.index] = applyAnswer(t, byLine.get(t.index));
      } catch (e) {
        console.warn('Nano chunk failed, keeping heuristic parse', e);
      } finally {
        clearTimeout(timer);
      }
      done += chunk.length;
      onProgress?.(done, targets.length);
    }
  } finally {
    session.destroy();
  }
  return out;
}
