import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTracklist } from '../src/lib/parser/index.js';
import { normalizeLine } from '../src/lib/parser/normalize.js';
import { splitLine } from '../src/lib/parser/split.js';

const pick = (t) => ({ left: t.left, right: t.right, status: t.status });

test('timestamped description with intro text and links', () => {
  const desc = `Late night deep house to unwind 🌙
Follow me on instagram: https://instagram.com/somebody

Tracklist:
0:00 Intro
0:45 Kerri Chandler - Rain
6:12 Larry Heard – Can You Feel It
12:30 Moodymann - Shades Of Jae
1:02:33 Theo Parrish — Summertime Is Here (Kenny Dixon Jr Remix)
1:08:00 ID - ID

#deephouse #mix`;
  const { tracks, mode } = parseTracklist(desc);
  assert.equal(mode, 'timestamps');
  assert.deepEqual(tracks.map(pick), [
    { left: null, right: 'Intro', status: 'skip' },
    { left: 'Kerri Chandler', right: 'Rain', status: 'ok' },
    { left: 'Larry Heard', right: 'Can You Feel It', status: 'ok' },
    { left: 'Moodymann', right: 'Shades Of Jae', status: 'ok' },
    { left: 'Theo Parrish', right: 'Summertime Is Here', status: 'ok' },
    { left: 'ID', right: 'ID', status: 'unknown' },
  ]);
  assert.equal(tracks[1].timestamp, '0:45');
  assert.equal(tracks[4].timestamp, '1:02:33');
  assert.equal(tracks[4].version, 'Kenny Dixon Jr Remix');
});

test('numbered list without timestamps keeps "50 Cent"', () => {
  const text = `My favourite 2000s tunes

1. 50 Cent - In Da Club
2. Nelly - Hot In Herre
3. Outkast - Hey Ya!
4. Usher ft. Ludacris & Lil Jon - Yeah!`;
  const { tracks, mode } = parseTracklist(text);
  assert.equal(mode, 'separators');
  assert.equal(tracks.length, 4);
  assert.equal(tracks[0].left, '50 Cent');
  assert.equal(tracks[2].right, 'Hey Ya!');
  assert.equal(tracks[3].left, 'Usher');
  assert.deepEqual(tracks[3].featuring, ['Ludacris', 'Lil Jon']);
});

test('bare sequential numbers are stripped', () => {
  const { tracks } = parseTracklist(`01 Bonobo - Kerala\n02 Tycho - Awake\n03 Emancipator - Soon It Will Be Cold Enough`);
  assert.deepEqual(tracks.map((t) => t.left), ['Bonobo', 'Tycho', 'Emancipator']);
});

test('comment-style tracklist with timestamps at the end and emoji', () => {
  const comment = `Tracklist 🔥🔥
Tatsuro Yamashita - Sparkle 0:00
Mariya Takeuchi - Plastic Love 4:12
Anri - Last Summer Whisper 12:05
??? 16:40
Taeko Ohnuki – 4:00 AM 20:31`;
  const { tracks } = parseTracklist(comment);
  assert.deepEqual(tracks.map(pick), [
    { left: 'Tatsuro Yamashita', right: 'Sparkle', status: 'ok' },
    { left: 'Mariya Takeuchi', right: 'Plastic Love', status: 'ok' },
    { left: 'Anri', right: 'Last Summer Whisper', status: 'ok' },
    { left: null, right: null, status: 'unknown' },
    { left: 'Taeko Ohnuki', right: '4:00 AM', status: 'ok' },
  ]);
});

test('"Title by Artist" and quoted titles', () => {
  assert.deepEqual(pick({ ...splitLine('Dreams by Fleetwood Mac') }), { left: 'Fleetwood Mac', right: 'Dreams', status: 'ok' });
  assert.equal(splitLine('Dreams by Fleetwood Mac').orientation, 'artist-first');
  const q = splitLine('Radiohead "Weird Fishes/Arpeggi"');
  assert.equal(q.left, 'Radiohead');
  assert.equal(q.right, 'Weird Fishes/Arpeggi');
});

test('noise tags, labels and featuring in brackets are removed', () => {
  const s = splitLine('Fred again.. - Delilah (pull me out of this) (Official Video) [Atlantic]');
  assert.equal(s.left, 'Fred again..');
  assert.equal(s.right, 'Delilah (pull me out of this)');
  const f = splitLine('Calvin Harris - Feels (feat. Pharrell Williams & Katy Perry) [Official Audio]');
  assert.equal(f.right, 'Feels');
  assert.deepEqual(f.featuring, ['Pharrell Williams', 'Katy Perry']);
});

test('unknowns: "Artist - ID", placeholders and "ID - Title"', () => {
  assert.equal(splitLine('Fisher - ID').status, 'unknown');
  assert.equal(splitLine('Unknown Artist - Unknown Track').status, 'unknown');
  const t = splitLine('ID - Lose Control');
  assert.equal(t.status, 'ok');
  assert.equal(t.left, null);
  assert.equal(t.right, 'Lose Control');
  assert.equal(normalizeLine('12:40 ...').placeholder, true);
});

test('title-first lists are left for the matcher to orient', () => {
  const { tracks } = parseTracklist(`Blinding Lights - The Weeknd\nLevitating - Dua Lipa\nAs It Was - Harry Styles`);
  assert.equal(tracks[0].left, 'Blinding Lights');
  assert.equal(tracks[0].orientation, null);
});

test('plain list of titles falls back to title-only (pasted text only)', () => {
  const text = `Clair de Lune\nGymnopédie No. 1\nNocturne Op. 9 No. 2`;
  assert.equal(parseTracklist(text).tracks.length, 0, 'not from descriptions');
  const { tracks, mode } = parseTracklist(text, { allowTitles: true });
  assert.equal(mode, 'titles');
  assert.deepEqual(tracks.map((t) => [t.left, t.right]), [
    [null, 'Clair de Lune'],
    [null, 'Gymnopédie No. 1'],
    [null, 'Nocturne Op. 9 No. 2'],
  ]);
});

test('timestamp ranges, brackets and sloppy dashes', () => {
  const { tracks } = parseTracklist(`[00:00 - 03:12] Daft Punk -One More Time
[03:12 - 08:40] Stardust- Music Sounds Better With You
[08:40 - 12:00] Modjo - Lady (Hear Me Tonight)`);
  assert.deepEqual(tracks.map((t) => [t.left, t.right, t.timestamp]), [
    ['Daft Punk', 'One More Time', '00:00'],
    ['Stardust', 'Music Sounds Better With You', '03:12'],
    ['Modjo', 'Lady (Hear Me Tonight)', '08:40'],
  ]);
});

test('hyphenated names are not split', () => {
  const s = splitLine('Jay-Z - Empire State Of Mind');
  assert.equal(s.left, 'Jay-Z');
  assert.equal(s.right, 'Empire State Of Mind');
});

test('three-part lines keep a trailing remix as the version', () => {
  const s = splitLine('Disclosure - Latch - Special Request Remix');
  assert.equal(s.left, 'Disclosure');
  assert.equal(s.right, 'Latch');
  assert.equal(s.version, 'Special Request Remix');
});

test('a description with no tracklist yields nothing useful', () => {
  const { tracks } = parseTracklist(`Thanks for watching! Please like and subscribe.\nhttps://example.com/merch`);
  assert.equal(tracks.length, 0);
});

test('auto-generated "Provided to YouTube" descriptions become one track', () => {
  const desc = `Provided to YouTube by Kontor New Media GmbH

Seaside Escape · Ibiza Chill Out Music Zone · Deep House Sensei

℗ GM RECORDS

Released on: 2025-05-27

Artist: Ibiza Chill Out Music Zone
Composer: Ricardo Lefvevre

Auto-generated by YouTube.`;
  const { tracks, mode } = parseTracklist(desc);
  assert.equal(mode, 'single');
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].left, 'Ibiza Chill Out Music Zone, Deep House Sensei');
  assert.equal(tracks[0].right, 'Seaside Escape');
});

test('a links-and-socials description is not mistaken for a list of titles', () => {
  const desc = `Thank you for listening, I hope you will have a good time here

🎼 | Listen on Spotify, Apple music and more
→ https://example.lnk.to/playlist

🌎 | Lofi Girl on all social media
→ https://example.lnk.to/social

👕 | Lofi Girl merch
→ https://example.com/shop

🎨 | Illustration by somebody
→ https://example.com/artist`;
  const { tracks, mode } = parseTracklist(desc, { allowTitles: true });
  assert.equal(mode, 'empty');
  assert.equal(tracks.length, 0);
});

test('links after tracks are stripped, not treated as junk', () => {
  const { tracks } = parseTracklist(`▬ Tracklist ▬
0:00 Nymano - Solitude  [ https://soundcloud.com/nymano ]
* 06:02 Gorila - Inlove  [ https://soundcloud.com/gorilamc ]
49:50 Mono:Massive & Philanthrope - Wake Up  [ https://soundcloud.com/a \ https://soundcloud.com/b ]
54:27 Nujabes - Brothel Love  [ http://hydeout.net ]
Chill Study Beats on Spotify » https://goo.gl/xyz`);
  assert.deepEqual(tracks.map((t) => [t.left, t.right]), [
    ['Nymano', 'Solitude'],
    ['Gorila', 'Inlove'],
    ['Mono:Massive & Philanthrope', 'Wake Up'],
    ['Nujabes', 'Brothel Love'],
  ]);
});

test('DJ key/BPM tails and label tails are dropped, real numbers kept', () => {
  const { tracks } = parseTracklist(`00:13:32  8 DEM 2 - DESTINY - 4A - 127
00:15:35  9 Dem 2 - Destiny (Dem 2 Radio Mix) - 4A - 127
00:17:39 10 Boston 168 - Acid Morning | Enemy Records 2015`);
  assert.deepEqual(tracks.map((t) => [t.left, t.right]), [
    ['DEM 2', 'DESTINY'],
    ['Dem 2', 'Destiny'],
    ['Boston 168', 'Acid Morning'],
  ]);
  assert.equal(splitLine('Taylor Swift - 22').right, '22');
  assert.equal(normalizeLine('Blink-182 - All The Small Things').text, 'Blink-182 - All The Small Things');
});

test('bare numbering before a timestamp', () => {
  const { tracks, mode } = parseTracklist(`01 00:00 Tom Misch - Climbing
02 01:56 Pabzzz - The Keys To Survival
03 04:50 Seneca B - Mom`);
  assert.equal(mode, 'timestamps');
  assert.deepEqual(tracks.map((t) => [t.timestamp, t.left]), [['00:00', 'Tom Misch'], ['01:56', 'Pabzzz'], ['04:50', 'Seneca B']]);
});
