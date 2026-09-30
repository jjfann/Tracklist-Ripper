// Demo mode: a stand-in for Spotify so the whole flow (YouTube buttons,
// parsing, Nano, review, pressing, done) can be tried without an account.
// It "finds" whatever the parser read, so it tests the parse, not real matching.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// FNV-1a plus a murmur finaliser: FNV alone has weak low bits (parity never
// changes), and "% 10" needs them to pick roughly 1 in 10.
function hash(s) {
  let h = 0x811c9dc5;
  for (const c of String(s)) h = Math.imul(h ^ c.codePointAt(0), 0x01000193);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

const COLOURS = [
  ['#8c3040', '#f2d98c'],
  ['#2e4a62', '#f4ecdd'],
  ['#5e1f2b', '#e3d2ae'],
  ['#314d3a', '#f2d98c'],
  ['#1b1416', '#b8606e'],
  ['#6b4a50', '#fbf4e4'],
];

function art(seed) {
  const [bg, fg] = COLOURS[seed % COLOURS.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="${bg}"/><circle cx="5" cy="5" r="3.2" fill="${fg}"/><circle cx="5" cy="5" r="0.6" fill="${bg}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function fakeTrack(title, artist) {
  const id = `demo${hash(`${norm(artist)}|${norm(title)}`)}`;
  return {
    id,
    uri: `spotify:track:${id}`,
    name: title,
    artists: artist.split(/\s*(?:,|&)\s*/).filter(Boolean).map((a) => ({ id: `demo-a${hash(norm(a))}`, name: a })),
    album: { name: title, release_date: `${1975 + (hash(title) % 48)}-01-01`, image: art(hash(title + artist)) },
    url: null,
  };
}

const field = (q, name) => new RegExp(`${name}:"([^"]*)"`).exec(q)?.[1] ?? null;

/** Roughly 1 song in 10 is "not on Spotify", whichever way round it's searched. */
function missing(...parts) {
  return hash(parts.map(norm).sort().join('|')) % 10 === 0;
}

export async function demoSearch(q) {
  await sleep(90 + (hash(q) % 160));
  const title = field(q, 'track');
  const artist = field(q, 'artist');
  if (title && artist) return missing(title, artist) ? [] : [fakeTrack(title, artist)];
  // Title only: two artists recorded it, so it lands in "to check".
  if (title) return missing(title) ? [] : [fakeTrack(title, 'Demo Artist'), fakeTrack(title, 'Another Artist')];
  return []; // free-text searches add nothing in the demo
}

export async function demoPlaylists() {
  await sleep(400);
  return [
    { id: 'demo-sunday', name: 'Sunday digs (demo)', total: 42 },
    { id: 'demo-car', name: 'Car tunes (demo)', total: 118 },
  ];
}

/** Same shape as pipeline.press(), with no network. */
export async function demoPress({ picks, destination, skipExisting = true, makeCover, onEvent = () => {} }) {
  const uris = [...new Set(picks.map((p) => p.uri))];
  let playlist;
  if (destination.type === 'new') {
    onEvent({ type: 'creating' });
    await sleep(700);
    playlist = { id: 'demo-new', name: destination.name, url: null };
  } else {
    playlist = destination.playlist;
  }

  let toAdd = uris;
  if (destination.type === 'existing' && skipExisting) {
    onEvent({ type: 'checking' });
    await sleep(600);
    toAdd = uris.filter((u) => hash(u) % 7 !== 0); // pretend a few are already there
  }

  onEvent({ type: 'adding', added: 0, total: toAdd.length });
  // Small chunks so the pressing animation has something to show.
  for (let added = 0; added < toAdd.length; ) {
    await sleep(350);
    added = Math.min(toAdd.length, added + 8);
    onEvent({ type: 'adding', added, total: toAdd.length });
  }

  let coverPreview = null;
  if (destination.type === 'new' && makeCover) {
    const jpeg = await makeCover().catch(() => null);
    if (jpeg) coverPreview = `data:image/jpeg;base64,${jpeg}`;
  }
  return { playlist, added: toAdd.length, alreadyThere: uris.length - toAdd.length, coverPreview, demo: true };
}
