import { h, toast, plural } from '../components/dom.js';
import { vinyl } from '../components/vinyl.js';
import { summarise } from '../../lib/pipeline.js';

export function doneView({ job, pressResult, actions }) {
  const results = job.results;
  const s = summarise(results);
  const notFound = results.filter((r) => !r.pick && !r.duplicate && r.tier === 'missing');
  const userSkipped = results.filter((r) => !r.pick && !r.duplicate && (r.tier === 'auto' || r.tier === 'review'));
  const unknown = results.filter((r) => r.tier === 'unknown');
  const leftOut = [...notFound, ...userSkipped, ...unknown];

  const rows = [
    ['auto', 'Added to the playlist', pressResult.added],
    ['duplicate', 'Already in the playlist', pressResult.alreadyThere],
    ['missing', 'Not found on Spotify', notFound.length],
    ['review', 'Skipped by you', userSkipped.length],
    ['unknown', 'Unidentified (IDs)', unknown.length],
    ['duplicate', 'Repeats in the tracklist', s.duplicate],
    ['skip', 'Not songs (intros etc.)', s.skip],
  ].filter(([, , n], i) => i === 0 || n > 0);

  const copyMissing = async () => {
    const text = leftOut.map((r) => r.track.raw).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast(`Copied ${plural(leftOut.length, 'line')}`);
    } catch {
      toast("Couldn't copy, sorry");
    }
  };

  return h(
    'section',
    { class: 'view done-view' },
    h(
      'div',
      { class: 'hero-record' },
      vinyl({ slow: true }),
      h('div', { class: 'readout' }, h('strong', {}, String(pressResult.added)), h('span', {}, `of ${plural(s.tracks, 'track')} pressed`)),
    ),
    h('h2', {}, pressResult.playlist.name),
    h('dl', { class: 'breakdown' }, rows.map(([dot, label, n]) => h('div', {}, h('span', { class: `dot ${dot}` }), h('dt', {}, label), h('dd', {}, String(n))))),
    h(
      'div',
      { class: 'actions' },
      pressResult.playlist.url ? h('button', { class: 'btn big', type: 'button', onClick: () => chrome.tabs.create({ url: pressResult.playlist.url }) }, 'Open in Spotify') : null,
      leftOut.length ? h('button', { class: 'btn ghost', type: 'button', onClick: copyMissing }, 'Copy missing tracks') : null,
      h('button', { class: 'btn ghost', type: 'button', onClick: actions.reset }, 'Dig another'),
    ),
    pressResult.demo
      ? h(
          'div',
          { class: 'cover-preview' },
          h('p', { class: 'muted' }, 'Demo mode: nothing was sent to Spotify.'),
          pressResult.coverPreview ? [h('img', { src: pressResult.coverPreview, alt: 'Generated playlist cover' }), h('small', { class: 'muted' }, 'The cover your new playlist would get')] : null,
        )
      : null,
    leftOut.length
      ? h('details', { class: 'missing-list card' }, h('summary', {}, `What didn't make it (${leftOut.length})`), h('ul', {}, leftOut.map((r) => h('li', {}, r.track.raw))))
      : null,
  );
}
