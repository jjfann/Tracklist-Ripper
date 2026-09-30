import { h, markup } from '../components/dom.js';
import { vinyl, thumbUrl } from '../components/vinyl.js';

const C = 2 * Math.PI * 47;

export function pressingView(job) {
  const ring = markup(`
<svg class="ring" viewBox="0 0 100 100" aria-hidden="true">
  <circle class="track-ring" cx="50" cy="50" r="47"/>
  <circle class="fill-ring" cx="50" cy="50" r="47" stroke-dasharray="${C}" stroke-dashoffset="${C}"/>
</svg>`);
  const fillRing = ring.querySelector('.fill-ring');
  const stack = h('div', { class: 'stack', 'aria-hidden': 'true' });
  const phase = h('p', { class: 'muted', 'aria-live': 'polite' }, 'Warming up the press…');
  let records = 0;

  const el = h(
    'section',
    { class: 'view press-view' },
    h('div', { class: 'press-stage' }, vinyl({ spinning: true, image: thumbUrl(job.payload.videoId) }), ring),
    stack,
    h('h2', {}, 'Pressing your playlist'),
    phase,
  );

  function addRecord() {
    records++;
    for (const r of stack.querySelectorAll('.rec.new')) r.classList.remove('new');
    stack.append(h('div', { class: 'rec new', style: { bottom: `${Math.min(records - 1, 7) * 5}px` } }));
    if (stack.children.length > 8) stack.firstElementChild.remove();
  }

  return {
    el,
    update(e) {
      if (e.type === 'creating') phase.textContent = 'Cutting a fresh playlist…';
      if (e.type === 'checking') phase.textContent = 'Checking what’s already in the crate…';
      if (e.type === 'adding') {
        const p = e.total ? e.added / e.total : 1;
        fillRing.style.strokeDashoffset = String(C * (1 - p));
        phase.textContent = e.total ? `Pressed ${e.added} of ${e.total}` : 'Nothing new to add';
        if (e.added > 0) addRecord();
      }
    },
  };
}
