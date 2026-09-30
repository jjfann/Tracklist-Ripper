import { h, plural } from '../components/dom.js';
import { summarise } from '../../lib/pipeline.js';

const artistsOf = (c) => c.artists.map((a) => a.name).join(', ');
const yearOf = (c) => c.album?.release_date?.slice(0, 4) || '';
const pct = (s) => `${Math.round(s * 100)}%`;

function segmented(options, value, onChange, label) {
  const wrap = h('div', { class: 'segmented', role: 'group', 'aria-label': label });
  const draw = (v) =>
    wrap.replaceChildren(
      ...options.map(([val, text]) =>
        h('button', { type: 'button', 'aria-pressed': String(val === v), onClick: () => { draw(val); onChange(val); } }, text),
      ),
    );
  draw(value);
  return wrap;
}

export function reviewView({ job, settings, actions }) {
  const results = job.results;
  const summary = summarise(results);
  const ui = {
    filter: 'all',
    dest: 'new',
    name: job.payload.title || 'Ripped tracklist',
    isPublic: settings.defaultPublic,
    playlistId: '',
    skipExisting: settings.skipExisting,
    playlists: null,
  };

  const list = h('ul', { class: 'tracks' });
  const pressBtn = h('button', { class: 'btn big', type: 'button' });

  const needsCheck = (r) => !r.duplicate && (r.tier === 'review' || r.tier === 'missing');
  const visible = (r) => ui.filter === 'all' || (ui.filter === 'check' ? r.tier === 'review' && !r.duplicate : r.tier === 'missing' && !r.duplicate);

  function updatePress() {
    const n = results.filter((r) => r.pick).length;
    pressBtn.textContent = `Press ${plural(n, 'track')}`;
    pressBtn.disabled = n === 0 || (ui.dest === 'existing' && !ui.playlistId);
  }

  function renderRow(r) {
    const tier = r.duplicate ? 'duplicate' : r.tier;
    const shown = r.pick || (tier === 'auto' || tier === 'review' || tier === 'duplicate' ? r.best?.cand : null);
    let title;
    let sub;
    if (tier === 'unknown') {
      title = 'Unidentified track';
      sub = 'Not named in the tracklist (ID)';
    } else if (tier === 'skip') {
      title = r.track.text || r.track.raw;
      sub = 'Not a song, skipped';
    } else if (tier === 'duplicate') {
      title = shown.name;
      sub = 'Already earlier in this tracklist';
    } else if (shown) {
      title = shown.name;
      sub = [artistsOf(shown), yearOf(shown)].filter(Boolean).join(' · ');
    } else {
      title = r.track.text;
      sub = r.alternatives.length ? 'No confident match. Try one of these?' : 'Not found on Spotify';
    }

    const canPick = r.alternatives.length > 0 && tier !== 'duplicate' && tier !== 'unknown' && tier !== 'skip';
    const box = h('input', {
      type: 'checkbox',
      checked: Boolean(r.pick),
      disabled: !canPick,
      'aria-label': `Include ${title}`,
      onChange: (e) => {
        if (e.target.checked) r.pick = r.lastPick || r.best?.cand || r.alternatives[0]?.cand || null;
        else {
          r.lastPick = r.pick;
          r.pick = null;
        }
        rerender();
      },
    });

    const showSelect = canPick && (tier === 'review' || tier === 'missing' || r.showAlts);
    const select = showSelect
      ? h(
          'select',
          {
            'aria-label': 'Choose a match',
            onChange: (e) => {
              r.pick = e.target.value === 'skip' ? null : r.alternatives[Number(e.target.value)].cand;
              rerender();
            },
          },
          r.alternatives.map((a, i) =>
            h('option', { value: String(i), selected: r.pick?.id === a.cand.id }, `${a.cand.name} — ${artistsOf(a.cand)} (${pct(a.score)})`),
          ),
          h('option', { value: 'skip', selected: !r.pick }, 'Skip this one'),
        )
      : null;

    const conf = h(
      'div',
      { class: 'conf' },
      r.best && tier !== 'skip' && tier !== 'unknown' ? pct(r.best.score) : '',
      canPick && tier === 'auto' && !r.showAlts && r.alternatives.length > 1
        ? h('button', { class: 'change', type: 'button', onClick: () => { r.showAlts = true; rerender(); } }, 'change')
        : null,
    );

    const img = shown?.album?.image;
    const li = h(
      'li',
      { class: ['track', `tier-${tier}`, !r.pick && 'off'] },
      h('label', { class: 'pick' }, box),
      h('div', { class: 'thumb' }, img ? h('img', { src: img, alt: '', loading: 'lazy' }) : null, h('span', { class: `dot ${tier}` })),
      h(
        'div',
        { class: 'info' },
        h('div', { class: 'title' }, title),
        h('div', { class: 'sub' }, sub),
        h('div', { class: 'orig', title: r.track.nano ? 'Read with on-device AI' : null }, r.track.timestamp ? h('span', { class: 'ts' }, r.track.timestamp) : null, r.track.text || r.track.raw, r.track.nano ? ' ✦' : ''),
        select,
      ),
      conf,
    );

    function rerender() {
      li.replaceWith(renderRow(r));
      updatePress();
    }
    return li;
  }

  function renderList() {
    const rows = results.filter(visible).map(renderRow);
    list.replaceChildren(...(rows.length ? rows : [h('li', { class: 'empty' }, 'Nothing here, nice.')]));
  }

  // ---- destination ----
  const destBody = h('div', { class: 'dest-body' });
  function renderDest() {
    if (ui.dest === 'new') {
      destBody.replaceChildren(
        h('input', { type: 'text', value: ui.name, 'aria-label': 'Playlist name', onInput: (e) => (ui.name = e.target.value) }),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: ui.isPublic, onChange: (e) => (ui.isPublic = e.target.checked) }), 'Public playlist'),
      );
      return;
    }
    if (!ui.playlists) {
      destBody.replaceChildren(h('p', { class: 'muted' }, 'Loading your playlists…'));
      actions
        .loadPlaylists()
        .then((pls) => {
          ui.playlists = pls;
          if (ui.dest === 'existing') renderDest();
        })
        .catch((e) => destBody.replaceChildren(h('p', { class: 'muted' }, `Couldn't load playlists: ${e.message}`)));
      return;
    }
    const select = h(
      'select',
      {
        'aria-label': 'Playlist',
        onChange: (e) => {
          ui.playlistId = e.target.value;
          updatePress();
        },
      },
      h('option', { value: '', selected: !ui.playlistId }, ui.playlists.length ? 'Choose a playlist…' : 'No playlists you can edit'),
      ui.playlists.map((p) => h('option', { value: p.id, selected: p.id === ui.playlistId }, p.total != null ? `${p.name} (${p.total})` : p.name)),
    );
    destBody.replaceChildren(
      select,
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: ui.skipExisting, onChange: (e) => (ui.skipExisting = e.target.checked) }), 'Skip songs already in it'),
    );
    updatePress();
  }

  pressBtn.addEventListener('click', () => {
    const picks = results.filter((r) => r.pick).map((r) => r.pick);
    const destination =
      ui.dest === 'new'
        ? {
            type: 'new',
            name: ui.name.trim() || 'Ripped tracklist',
            isPublic: ui.isPublic,
            description: job.payload.url ? `Ripped from ${job.payload.url} with Tracklist Ripper` : 'Ripped with Tracklist Ripper',
          }
        : { type: 'existing', playlist: ui.playlists.find((p) => p.id === ui.playlistId) };
    actions.press({ picks, destination, skipExisting: ui.skipExisting });
  });

  const checkCount = results.filter((r) => needsCheck(r) && r.tier === 'review').length;
  const missCount = results.filter((r) => needsCheck(r) && r.tier === 'missing').length;
  const sourceLabel = { description: 'From the video description', comment: `From ${job.payload.author || 'a comment'}`, paste: 'From your paste' }[job.payload.source] || '';

  const head = h(
    'div',
    { class: 'review-head' },
    h('div', { class: 'card-head' }, h('h2', {}, job.payload.title || 'Your tracklist'), h('button', { class: 'btn ghost small', type: 'button', onClick: actions.reset }, 'Start over')),
    h('p', { class: 'muted' }, `${sourceLabel} · ${plural(summary.total, 'line')}`),
    h(
      'div',
      { class: 'chips' },
      h('span', { class: 'chip' }, h('span', { class: 'dot auto' }), `${summary.auto} matched`),
      summary.review ? h('span', { class: 'chip' }, h('span', { class: 'dot review' }), `${summary.review} to check`) : null,
      summary.missing ? h('span', { class: 'chip' }, h('span', { class: 'dot missing' }), `${summary.missing} not found`) : null,
      summary.unknown ? h('span', { class: 'chip' }, h('span', { class: 'dot unknown' }), plural(summary.unknown, 'ID')) : null,
      summary.duplicate ? h('span', { class: 'chip' }, h('span', { class: 'dot duplicate' }), plural(summary.duplicate, 'repeat')) : null,
    ),
    job.nanoLines ? h('p', { class: 'nano-note' }, `✦ On-device AI helped read ${plural(job.nanoLines, 'line')}.`) : null,
    checkCount || missCount
      ? segmented(
          [['all', 'All'], ...(checkCount ? [['check', `To check (${checkCount})`]] : []), ...(missCount ? [['missing', `Not found (${missCount})`]] : [])],
          'all',
          (v) => {
            ui.filter = v;
            renderList();
          },
          'Filter tracks',
        )
      : null,
  );

  const pressBar = h(
    'footer',
    { class: 'press-bar' },
    segmented(
      [['new', 'New playlist'], ['existing', 'Add to existing']],
      ui.dest,
      (v) => {
        ui.dest = v;
        renderDest();
        updatePress();
      },
      'Destination',
    ),
    destBody,
    pressBtn,
  );

  renderList();
  renderDest();
  updatePress();
  return h('section', { class: 'view review-view' }, head, list, pressBar);
}
