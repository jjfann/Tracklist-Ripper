import { h, markup } from '../components/dom.js';
import { vinyl } from '../components/vinyl.js';

const REFRESH_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>`;

const lineCount = (text) => String(text || '').split('\n').filter((l) => l.trim()).length;

function sourceRow({ title, detail, tag, onClick }) {
  return h(
    'button',
    { class: 'source', type: 'button', onClick },
    vinyl(),
    h('span', {}, h('strong', {}, title, tag ? [' ', h('span', { class: 'tag' }, tag)] : null), h('small', {}, detail)),
    h('span', { class: 'go' }, 'Dig →'),
  );
}

export function sourcesCard(state, actions) {
  const s = state.sources;
  const body = [];
  if (state.sourcesLoading) {
    body.push(h('p', { class: 'muted' }, 'Looking for tracklists on this page…'));
  } else if (!s) {
    body.push(h('p', { class: 'muted' }, "Couldn't read this tab. If it's a YouTube video, reload the page and try again."));
  } else if (!s.onVideo) {
    body.push(h('p', { class: 'muted' }, 'Open a YouTube mix and any tracklist in its description or comments will show up here.'));
  } else {
    const base = { title: s.title, channel: s.channel, url: s.url, videoId: s.videoId };
    if (s.description?.trim()) {
      body.push(
        sourceRow({
          title: 'Video description',
          tag: s.descriptionLooksLikeTracklist ? 'tracklist' : null,
          detail: `${lineCount(s.description)} lines · ${s.title}`,
          onClick: () => actions.dig({ ...base, text: s.description, source: 'description' }),
        }),
      );
    }
    for (const c of s.comments || []) {
      body.push(
        sourceRow({
          title: `Comment by ${c.author}`,
          tag: 'tracklist',
          detail: `${lineCount(c.text)} lines · ${c.text.split('\n').find((l) => l.trim()) || ''}`,
          onClick: () => actions.dig({ ...base, text: c.text, source: 'comment', author: c.author }),
        }),
      );
    }
    if (!s.comments?.length) {
      body.push(h('p', { class: 'muted', style: { fontSize: '12px' } }, 'Tracklist in the comments? Scroll down on YouTube so they load, then refresh.'));
    }
  }

  const refresh = h('button', { class: 'icon-btn', type: 'button', title: 'Refresh', 'aria-label': 'Refresh', onClick: actions.refreshSources });
  refresh.append(markup(REFRESH_ICON));
  return h('section', { class: 'card', id: 'sources-card' }, h('div', { class: 'card-head' }, h('h3', {}, 'On this page'), refresh), h('div', { class: 'sources' }, body));
}

function pasteCard(state, actions) {
  const paste = state.paste;
  const text = h('textarea', {
    placeholder: '00:00 Kerri Chandler - Rain\n05:12 Larry Heard - Can You Feel It\n…',
    'aria-label': 'Tracklist',
    value: paste.text,
  });
  const name = h('input', { type: 'text', placeholder: 'Playlist name (optional)', 'aria-label': 'Playlist name', value: paste.name });
  const go = h('button', { class: 'btn', type: 'button', disabled: !paste.text.trim() }, 'Dig through it');
  text.addEventListener('input', () => {
    paste.text = text.value;
    go.disabled = !text.value.trim();
  });
  name.addEventListener('input', () => (paste.name = name.value));
  go.addEventListener('click', () => actions.dig({ text: text.value, title: name.value.trim() || 'Ripped tracklist', source: 'paste' }));
  const details = h('details', { class: 'card paste', open: paste.open }, h('summary', {}, 'Paste a tracklist'), h('div', { class: 'body' }, text, name, go));
  details.addEventListener('toggle', () => (paste.open = details.open));
  return details;
}

export function crateView(state, actions) {
  const hero = h(
    'div',
    { class: 'crate-hero' },
    h('div', { class: 'crate', 'aria-hidden': 'true' }, h('div', { class: 'sleeves' }, [1, 2, 3, 4, 5].map(() => h('div', { class: 'sleeve' }))), h('div', { class: 'crate-front' })),
    h('h2', {}, 'Dig a tracklist'),
    h('p', { class: 'muted' }, "Pick a tracklist and I'll find the songs on Spotify and press them into a playlist."),
  );

  let account = null;
  if (!state.hasClientId) {
    account = h(
      'section',
      { class: 'card notice' },
      h('h3', {}, 'Set up Spotify'),
      h('p', { class: 'muted' }, 'Tracklist Ripper talks to Spotify through your own (free) developer app. It takes about two minutes.'),
      h('button', { class: 'btn', type: 'button', onClick: actions.openOptions }, 'Open setup'),
    );
  } else if (!state.connected) {
    account = h(
      'section',
      { class: 'card notice' },
      h('h3', {}, 'Connect Spotify'),
      h('p', { class: 'muted' }, state.pending ? 'Connect your account and I’ll start digging straight away.' : 'Log in once so I can search and build playlists for you.'),
      h('button', { class: 'btn', type: 'button', onClick: actions.connect }, 'Connect Spotify'),
    );
  }

  const notice = state.notice
    ? h('section', { class: 'card error-card', role: 'alert' }, h('p', {}, state.notice))
    : null;

  return h('section', { class: 'view crate-view' }, hero, notice, account, sourcesCard(state, actions), pasteCard(state, actions));
}
