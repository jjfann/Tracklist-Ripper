import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchTrack } from '../src/lib/matcher/index.js';
import { similarity } from '../src/lib/matcher/similarity.js';
import { cleanCandidateTitle } from '../src/lib/matcher/score.js';
import { splitLine } from '../src/lib/parser/split.js';
import { analyse, summarise } from '../src/lib/pipeline.js';

let nextId = 1;
const T = (name, artists, { year = '2000', id = `t${nextId++}` } = {}) => ({
  id,
  uri: `spotify:track:${id}`,
  name,
  artists: (Array.isArray(artists) ? artists : [artists]).map((a) => ({ id: `a-${a.toLowerCase().replace(/\W/g, '')}`, name: a })),
  album: { name: name, release_date: `${year}-01-01` },
});

/** Fake search: first rule whose predicate matches the query wins. */
function fakeSearch(rules) {
  const log = [];
  const search = async (q) => {
    log.push(q);
    for (const [pred, results] of rules) if (pred(q)) return results;
    return [];
  };
  search.log = log;
  return search;
}
const has = (...words) => (q) => words.every((w) => q.toLowerCase().includes(w.toLowerCase()));
const line = (text, extra = {}) => ({ index: 0, raw: text, text, timestamp: null, ...splitLine(text), ...extra });

test('similarity basics', () => {
  assert.equal(similarity('Hey Ya!', 'Hey Ya'), 1);
  assert.ok(similarity('Kerri Chandler', 'Kerri Chandlr') > 0.9);
  assert.ok(similarity('Rain', 'Purple Rain') < 0.85);
  assert.ok(similarity('lofi', 'lo-fi') > 0.95);
  assert.equal(cleanCandidateTitle('Latch - Special Request Remix').clean, 'Latch');
  assert.equal(cleanCandidateTitle('Dreams - 2004 Remaster').version, null);
});

test('artist-first line picks the real recording over karaoke', async () => {
  const search = fakeSearch([
    [has('artist:"Outkast"'), [T('Hey Ya! (Karaoke Version)', 'Karaoke Kings'), T('Hey Ya!', 'Outkast', { id: 'heyya' })]],
  ]);
  const r = await matchTrack(line('Outkast - Hey Ya!'), { search });
  assert.equal(r.tier, 'auto');
  assert.equal(r.best.cand.id, 'heyya');
  assert.equal(search.log.length, 1, 'stops after a strong hit');
});

test('title-first line is found by flipping', async () => {
  const search = fakeSearch([
    [has('track:"Blinding Lights"', 'artist:"The Weeknd"'), [T('Blinding Lights', 'The Weeknd', { id: 'bl' })]],
  ]);
  const r = await matchTrack(line('Blinding Lights - The Weeknd'), { search });
  assert.equal(r.best.cand.id, 'bl');
  assert.equal(r.best.hyp.orientation, 'title-first');
  assert.equal(r.tier, 'auto');
});

test('requested remix beats the original, and vice versa', async () => {
  const results = [T('Latch', ['Disclosure', 'Sam Smith'], { id: 'orig' }), T('Latch - Special Request Remix', ['Disclosure', 'Sam Smith'], { id: 'remix' })];
  const search = fakeSearch([[has('Latch'), results]]);
  const remix = await matchTrack(line('Disclosure - Latch (Special Request Remix)'), { search });
  assert.equal(remix.best.cand.id, 'remix');
  const orig = await matchTrack(line('Disclosure - Latch'), { search });
  assert.equal(orig.best.cand.id, 'orig');
});

test('typos still match via free-text search', async () => {
  const search = fakeSearch([
    [(q) => !q.includes(':'), [T('Can You Feel It', 'Larry Heard', { id: 'cyfi' })]],
  ]);
  const r = await matchTrack(line('Larry Heard - Can You Feal It'), { search });
  assert.equal(r.best.cand.id, 'cyfi');
  assert.ok(r.tier === 'auto' || r.tier === 'review');
});

test('unknown and skip lines are not searched', async () => {
  const search = fakeSearch([]);
  assert.equal((await matchTrack(line('ID - ID'), { search })).tier, 'unknown');
  assert.equal((await matchTrack(line('Intro'), { search })).tier, 'skip');
  assert.equal(search.log.length, 0);
});

test('missing artist: mix context picks the right "Rain"', async () => {
  const rainBeatles = T('Rain - Remastered 2009', 'The Beatles', { id: 'rain-beatles', year: '1966' });
  const rainMadonna = T('Rain', 'Madonna', { id: 'rain-madonna', year: '1992' });
  const rainKerri = T('Rain', 'Kerri Chandler', { id: 'rain-kerri', year: '1998' });
  const search = fakeSearch([
    [has('artist:"Larry Heard"'), [T('Can You Feel It', 'Larry Heard', { year: '1986' })]],
    [has('artist:"Moodymann"'), [T('Shades Of Jae', 'Moodymann', { year: '1999' })]],
    [has('artist:"Theo Parrish"'), [T('Summertime Is Here', 'Theo Parrish', { year: '1998' })]],
    [has('Rain'), [rainBeatles, rainMadonna, T('Rain', 'Various Artists'), rainKerri]],
  ]);
  const genres = {
    'a-larryheard': ['chicago house', 'deep house'],
    'a-moodymann': ['deep house', 'detroit house'],
    'a-theoparrish': ['detroit house', 'deep house'],
    'a-thebeatles': ['british invasion', 'rock'],
    'a-madonna': ['dance pop', 'pop'],
    'a-kerrichandler': ['deep house', 'new jersey house'],
  };
  const text = `0:00 Larry Heard - Can You Feel It\n5:00 Moodymann - Shades Of Jae\n10:00 Theo Parrish - Summertime Is Here\n15:00 Rain`;
  const { results } = await analyse({
    text,
    meta: { title: 'Deep House Selections' },
    deps: { search, getArtistGenres: async (id) => genres[id] || [] },
  });
  const rain = results[3];
  assert.equal(rain.best.cand.id, 'rain-kerri');
  assert.equal(rain.pick.id, 'rain-kerri');
  const s = summarise(results);
  assert.equal(s.picked, 4);
});

test('the same song twice is only picked once', async () => {
  const search = fakeSearch([[has('artist:"Daft Punk"'), [T('One More Time', 'Daft Punk', { id: 'omt' })]]]);
  const { results } = await analyse({
    text: `Daft Punk - One More Time\nDaft Punk - One More Time (Reprise)`,
    deps: { search },
  });
  assert.equal(results.filter((r) => r.pick).length, 1);
  assert.equal(summarise(results).duplicate, 1);
});

test('"Title (Artist)" lines are matched with the bracket as artist', async () => {
  const search = fakeSearch([
    [has('Taboo'), [T('Taboo', 'Glee Cast', { id: 'glee' }), T('Taboo', 'Shola Ama', { id: 'shola' }), T('Taboo', 'Don Omar', { id: 'don' })]],
  ]);
  const r = await matchTrack(line('Taboo (Shola Ama)'), { search });
  assert.equal(r.best.cand.id, 'shola');
  assert.equal(r.tier, 'auto');
});

test('a remixer in brackets steers toward that remix', async () => {
  const search = fakeSearch([
    [has('Hot Stuff'), [T('Hot Stuff', 'Donna Summer', { id: 'orig' }), T('Hot Stuff - Kygo Remix', ['Donna Summer', 'Kygo'], { id: 'kygo' })]],
  ]);
  const r = await matchTrack(line('Donna Summer - Hot Stuff (Kygo)'), { search });
  assert.equal(r.best.cand.id, 'kygo');
});

test('demo mode exercises every review state without Spotify', async () => {
  const { demoSearch, demoPress } = await import('../src/lib/demo.js');
  const text = Array.from({ length: 30 }, (_, i) => `${i}:00 Artist ${i} - Song ${i}`).join('\n') + '\n31:00 ID - ID\n32:00 Lonely Title';
  const { results } = await analyse({ text, deps: { search: demoSearch } });
  const s = summarise(results);
  assert.ok(s.auto > 20, `auto ${s.auto}`);
  assert.ok(s.missing >= 1, 'some "not found"');
  assert.equal(s.unknown, 1);
  const events = [];
  const out = await demoPress({ picks: results.filter((r) => r.pick).map((r) => r.pick), destination: { type: 'new', name: 'x' }, onEvent: (e) => events.push(e.type) });
  assert.equal(out.added, s.picked);
  assert.ok(events.includes('creating') && events.includes('adding'));
});
