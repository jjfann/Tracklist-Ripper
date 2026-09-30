import { h } from '../components/dom.js';
import { vinyl, tonearm, thumbUrl } from '../components/vinyl.js';

function describe(result) {
  const t = result.track;
  if (result.tier === 'unknown') return t.raw || 'ID';
  if (result.tier === 'skip') return t.text;
  if (result.best && result.tier !== 'missing') return `${result.best.cand.name} — ${result.best.cand.artists.map((a) => a.name).join(', ')}`;
  return t.text;
}

/** Turntable + counter; call update() as events arrive. */
export function diggingView(job) {
  const deck = h(
    'div',
    { class: 'deck', 'aria-hidden': 'true' },
    h('div', { class: 'platter' }, vinyl({ spinning: true, image: thumbUrl(job.payload.videoId) })),
    tonearm(),
    h('span', { class: 'power' }),
    h('span', { class: 'speed' }, '33⅓'),
  );
  // Let the arm swing in from its rest.
  requestAnimationFrame(() => requestAnimationFrame(() => deck.classList.add('playing')));

  const phase = h('span', { class: 'phase' });
  const sub = h('small');
  const found = h('span', { class: 'found' }, '0');
  const of = h('span', { class: 'of' });
  const fill = h('div', { class: 'fill' });
  const bar = h('div', { class: 'groove-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': 'Digging progress' }, fill);
  const log = h('ol', { class: 'dig-log', 'aria-live': 'polite' });

  const el = h(
    'section',
    { class: 'view dig-view' },
    deck,
    h('div', { class: 'dig-status' }, phase, sub),
    h('div', { class: 'counter' }, found, of),
    bar,
    log,
  );

  return {
    el,
    update(state) {
      const p = state.total ? state.done / state.total : 0;
      deck.style.setProperty('--p', p.toFixed(3));
      phase.textContent = state.phase;
      sub.textContent = state.sub || '';
      found.textContent = String(state.found);
      of.textContent = state.total ? `found of ${state.total} lines` : 'found';
      fill.style.width = `${Math.round(p * 100)}%`;
      bar.setAttribute('aria-valuenow', String(Math.round(p * 100)));
    },
    log(result) {
      const li = h('li', {}, h('span', { class: `dot ${result.tier}` }), h('span', {}, describe(result)));
      log.prepend(li);
      while (log.children.length > 6) log.lastElementChild.remove();
    },
  };
}
