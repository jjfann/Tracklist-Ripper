import { h, markup } from './dom.js';

/** A record: grooves + rosewood label (optionally with artwork) + static sheen. */
export function vinyl({ spinning = false, slow = false, image = null, className = '' } = {}) {
  // spans, so a record can sit inside a <button>
  const label = h('span', { class: 'label' }, image ? h('img', { src: image, alt: '' }) : null);
  return h(
    'span',
    { class: ['vinyl', spinning && 'spinning', slow && 'slow', className], 'aria-hidden': 'true' },
    h('span', { class: 'disc' }, label),
    h('span', { class: 'sheen' }),
  );
}

// Tonearm in the deck's 100x86 coordinate space; pivot at (88, 12).
export function tonearm() {
  return markup(`
<svg class="tonearm" viewBox="0 0 100 86" preserveAspectRatio="none" aria-hidden="true">
  <circle cx="91" cy="66" r="2.4" fill="#2a1a1e" stroke="rgba(242,217,140,.4)" stroke-width=".6"/>
  <g class="arm">
    <rect x="85" y="1" width="6" height="7" rx="1.5" fill="#2a1a1e" stroke="rgba(242,217,140,.5)" stroke-width=".6"/>
    <path d="M88 12 L88 60 L85 67" fill="none" stroke="#e9dfcb" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="81" y="65" width="6.5" height="6" rx="1.2" fill="#f2d98c" transform="rotate(22 84 68)"/>
    <circle cx="88" cy="12" r="5.5" fill="#2a1a1e" stroke="#f2d98c" stroke-width="1"/>
    <circle cx="88" cy="12" r="1.8" fill="#f2d98c"/>
  </g>
</svg>`);
}

export function thumbUrl(videoId) {
  return videoId ? `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg` : null;
}
