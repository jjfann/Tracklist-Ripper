// Line-level clean-up: unify dashes/quotes, strip emoji, bullets, numbering
// and timestamps so that what remains is (ideally) "Artist - Title".

const DASHES = /[‐-―−⸺⸻﹘﹣－]/g;
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{FE0E}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}]/gu;
// Bullets / arrows / decoration commonly used to prefix tracklist lines.
const LEADING_JUNK = /^[\s•●◦○·∙⋅*▶►▷▸▹›»>→⇒➜➤✓✔♪♫♬♩~+|=_\-:.,;]+/u;
const TRAILING_JUNK = /[\s•●◦·*~+|=_\-:,;]+$/u;

// 0:00, 00:00, 1:02:33, optionally wrapped in brackets. Only timestamps at the
// start or end of a line are stripped, so titles like "4:00 AM" survive.
const TS_CORE = String.raw`(?:\d{1,2}:)?\d{1,2}:\d{2}`;
const TS_ANY = new RegExp(TS_CORE, 'g');
const LEADING_TS = new RegExp(String.raw`^[\[\(]?(${TS_CORE})[\]\)]?(?=$|[\s|:,.\]-])`);
const TRAILING_TS = new RegExp(String.raw`(?:^|(?<=[\s|(\[-]))[\[\(]?(${TS_CORE})[\]\)]?\s*$`);
// A range like "00:00 - 03:12" or "0:00-3:12" counts as one timestamp.
const TS_RANGE_RE = new RegExp(String.raw`[\[\(]?(${TS_CORE})\s*(?:-|to|~)\s*(${TS_CORE})[\]\)]?`, 'g');

// "01 00:00 Artist - Title": a bare number right before a timestamp is numbering.
const NUMBER_BEFORE_TS = new RegExp(String.raw`^\d{1,3}\s+(?=[\[\(]?${TS_CORE})`);

// Links pasted after a track ("[ https://soundcloud.com/x ]", "» https://…").
const URLS = /[\[(]?\s*(?:https?:\/\/|www\.)\S+(?:\s*[\|,]\s*(?:https?:\/\/|www\.)\S+)*\s*[\])]?/gi;
// DJ metadata tails: Camelot key and BPM ("- 4A - 127", "| 8B | 124 BPM").
const KEY_BPM_TAIL = /(?:\s+[-|]\s+\d{1,2}[AB](?:\s+[-|]\s+\d{2,3}(?:\s?bpm)?)?|\s+[-|]\s+\d{2,3}\s?bpm)\s*$/i;

// Numbering that is always safe to strip: "01.", "1)", "#1", "[01]", "Track 1:".
const PUNCT_NUMBER = /^(?:track\s*)?(?:#\s?\d{1,3}\b|\[\d{1,3}\]|\(\d{1,3}\)|\d{1,3}\s*[.)\]:](?!\d))\s*/i;

export function toSeconds(ts) {
  const parts = ts.split(':').map(Number);
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function cleanChars(s) {
  return s
    .normalize('NFKC')
    .replace(DASHES, '-')
    .replace(/[“”„‟″«»「」『』]/g, '"')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/…/g, '...')
    .replace(EMOJI, ' ')
    .replace(/[​‌⁠﻿]/g, '')
    .replace(/\t/g, ' ');
}

/**
 * Normalise one raw line.
 * @returns {{ text: string, timestamp: string|null, seconds: number|null, placeholder: boolean }}
 */
export function normalizeLine(raw) {
  let s = cleanChars(raw).replace(URLS, ' ').trim();
  let leading = null;
  let other = null;

  // "...", "???", "[12:40] ..." are placeholders for an unknown track; flag
  // them before junk stripping erases the evidence.
  const bare = s.replace(TS_ANY, ' ');
  const placeholder = /^[\s.?_|()[\]-]*$/.test(bare) && /[.?]/.test(bare);

  s = s.replace(TS_RANGE_RE, (_m, start) => {
    other ??= start;
    return ' ';
  });

  // Strip leading junk, punctuated numbering and a leading timestamp until
  // nothing changes (handles "1. 00:00 - Artist" and "▶ [01:30] Artist").
  let prev;
  do {
    prev = s;
    s = s
      .replace(LEADING_JUNK, '')
      .replace(PUNCT_NUMBER, '')
      .replace(NUMBER_BEFORE_TS, '')
      .replace(LEADING_TS, (_m, ts) => {
        leading ??= ts;
        return '';
      });
  } while (s !== prev);

  s = s.replace(TRAILING_TS, (_m, ts) => {
    other ??= ts;
    return '';
  });
  s = s.replace(KEY_BPM_TAIL, '').replace(TRAILING_JUNK, '');
  const timestamp = leading ?? other;
  s = s.replace(/\s+/g, ' ').trim();
  return { text: s, timestamp, seconds: timestamp ? toSeconds(timestamp) : null, placeholder };
}

/**
 * Remove bare leading numbers ("01 Artist - Title") but only when they form a
 * running sequence across the block, so "50 Cent - In Da Club" survives.
 * Mutates and returns the given line objects.
 */
export function stripSequentialNumbers(lines) {
  const nums = lines.map((l) => {
    const m = /^(\d{1,3})\s+(?=\S)/.exec(l.text);
    return m ? Number(m[1]) : null;
  });
  let run = 0;
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] !== null && nums[i - 1] !== null && nums[i] === nums[i - 1] + 1) run++;
  }
  const numbered = nums.filter((n) => n !== null).length;
  if (numbered >= 3 && run >= Math.max(2, numbered * 0.6 - 1)) {
    lines.forEach((l, i) => {
      if (nums[i] !== null) l.text = l.text.replace(/^\d{1,3}\s+(?:-\s+)?/, '');
    });
  }
  return lines;
}
