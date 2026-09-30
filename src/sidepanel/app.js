import { h, toast, plural } from './components/dom.js';
import { crateView, sourcesCard } from './views/crate.js';
import { diggingView } from './views/digging.js';
import { reviewView } from './views/review.js';
import { pressingView } from './views/pressing.js';
import { doneView } from './views/done.js';
import { makeCover } from './components/cover.js';
import { analyse, press } from '../lib/pipeline.js';
import { searchTracks, getArtistGenres } from '../lib/spotify/search.js';
import { getMe, listWritablePlaylists } from '../lib/spotify/playlists.js';
import { connect, isConnected, getClientId, NotConnectedError } from '../lib/spotify/auth.js';
import { SpotifyError } from '../lib/spotify/api.js';
import { refineWithNano, nanoAvailability } from '../lib/parser/nano.js';
import { loadSettings } from '../shared/settings.js';
import { demoSearch, demoPlaylists, demoPress } from '../lib/demo.js';

const app = document.getElementById('app');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const state = {
  view: 'crate',
  hasClientId: false,
  connected: false,
  user: null,
  sources: null,
  sourcesLoading: true,
  notice: null,
  pending: null, // tracklist waiting for the user to connect Spotify
  paste: { text: '', name: '', open: false },
  job: null,
  demo: false, // fake Spotify (settings → demo mode)
};
let busy = false;

function show(el) {
  app.replaceChildren(el);
  window.scrollTo(0, 0);
}

function renderCrate() {
  state.view = 'crate';
  show(crateView(state, actions));
}

function renderAccount() {
  const el = document.getElementById('account');
  el.replaceChildren();
  if (state.demo) {
    el.append(h('span', { class: 'tag', title: 'Nothing is sent to Spotify' }, 'Demo mode'));
  } else if (state.connected && state.user) {
    if (state.user.image) el.append(h('img', { src: state.user.image, alt: '' }));
    el.append(h('span', { title: `Connected as ${state.user.name}` }, state.user.name));
  }
}

async function refreshAccount() {
  state.demo = (await loadSettings()).demoMode;
  if (state.demo) {
    state.hasClientId = true;
    state.connected = true;
    renderAccount();
    return;
  }
  state.hasClientId = Boolean(await getClientId());
  state.connected = await isConnected();
  if (state.connected) {
    state.user = (await chrome.storage.local.get('spotifyUser')).spotifyUser || null;
    renderAccount();
    try {
      state.user = await getMe();
    } catch (e) {
      if (e instanceof NotConnectedError) state.connected = false;
    }
  } else {
    state.user = null;
  }
  renderAccount();
}

// ---- what's on the current tab --------------------------------------------
async function getActiveSources() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  try {
    return (await chrome.tabs.sendMessage(tab.id, { type: 'GET_SOURCES' })) || { onVideo: false };
  } catch {
    // No content script. We can only see URLs of YouTube tabs (host permission),
    // so a YouTube URL here means the tab was opened before the extension loaded.
    return tab.url?.startsWith('https://www.youtube.com/') ? null : { onVideo: false };
  }
}

let sourcesSeq = 0;
async function refreshSources() {
  const seq = ++sourcesSeq;
  state.sourcesLoading = true;
  patchSources();
  const sources = await getActiveSources();
  if (seq !== sourcesSeq) return;
  state.sources = sources;
  state.sourcesLoading = false;
  patchSources();
}

function patchSources() {
  if (state.view !== 'crate') return;
  app.querySelector('#sources-card')?.replaceWith(sourcesCard(state, actions));
}

let tabTimer = null;
function onTabChange() {
  clearTimeout(tabTimer);
  tabTimer = setTimeout(() => state.view === 'crate' && refreshSources(), 350);
}
chrome.tabs.onActivated.addListener(onTabChange);
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (tab.active && (info.status === 'complete' || info.url)) onTabChange();
});

// ---- errors ------------------------------------------------------------------
function friendly(e) {
  if (e instanceof NotConnectedError) return e.message;
  if (e instanceof SpotifyError) {
    if (e.status === 403 && /scope/i.test(e.message)) {
      return `Spotify says the login is missing a permission: ${e.message}. Try Disconnect then Connect in the settings.`;
    }
    if (e.status === 403) {
      return `Spotify said no: ${e.message}. Development-mode apps only work if the app owner has Premium and your account is listed under User Management in the Spotify dashboard.`;
    }
    if (e.status === 429) return 'Spotify is rate-limiting us. Give it a minute and try again.';
    return `Spotify error: ${e.message}`;
  }
  return e?.message || String(e);
}

function handleError(e) {
  console.error(e);
  if (e instanceof NotConnectedError) state.connected = false;
  state.notice = friendly(e);
  renderAccount();
  renderCrate();
  refreshSources();
}

// ---- dig: parse + match ---------------------------------------------------------
async function dig(payload) {
  if (busy) {
    toast('Already digging, one crate at a time');
    return;
  }
  state.notice = null;
  if (!state.connected) {
    state.pending = payload;
    if (!state.hasClientId) state.notice = 'Set up your Spotify app first, then come back and hit the button again.';
    renderCrate();
    return;
  }

  busy = true;
  const job = { payload, results: [], found: 0, done: 0, total: 0, phase: 'Reading the tracklist…', sub: '', nanoLines: 0 };
  state.job = job;
  state.view = 'digging';
  const view = diggingView(job);
  show(view.el);
  view.update(job);

  try {
    const settings = await loadSettings();
    const nano = settings.useNano ? await nanoAvailability() : 'off';
    const { results } = await analyse({
      text: payload.text,
      meta: { title: payload.title, channel: payload.channel },
      deps: state.demo ? { search: demoSearch, getArtistGenres: async () => [] } : { search: searchTracks, getArtistGenres },
      refine: nano === 'available' ? refineWithNano : null,
      allowTitles: payload.source === 'paste',
      onEvent(e) {
        switch (e.type) {
          case 'parsed':
            job.total = e.tracks.length;
            job.phase = e.tracks.length ? `Spotted ${plural(e.tracks.length, 'line')}` : 'No tracklist found';
            break;
          case 'refining':
            job.phase = 'Reading the tricky lines…';
            job.sub = 'On-device AI (Gemini Nano)';
            break;
          case 'refine-progress':
            job.sub = `On-device AI · ${e.done}/${e.total}`;
            break;
          case 'refined':
            job.nanoLines = e.tracks.filter((t) => t.nano).length;
            job.sub = '';
            break;
          case 'refine-failed':
            job.sub = 'On-device AI unavailable, using the built-in parser';
            break;
          case 'matched':
            job.done = e.done;
            if (e.result.tier === 'auto' || e.result.tier === 'review') job.found++;
            job.phase = 'Digging through Spotify…';
            view.log(e.result);
            break;
          case 'context':
            job.phase = 'Cross-checking with the rest of the mix…';
            break;
        }
        view.update(job);
      },
    });
    if (!results.length) throw new Error("I couldn't spot a tracklist there. Try another source, or paste it in.");
    job.results = results;
    await sleep(600); // let the needle reach the run-out groove
    state.view = 'review';
    show(reviewView({ job, settings, actions }));
  } catch (e) {
    handleError(e);
  } finally {
    busy = false;
  }
}

// ---- press: write to Spotify ---------------------------------------------------
async function doPress({ picks, destination, skipExisting }) {
  if (busy) return;
  busy = true;
  const job = state.job;
  state.view = 'pressing';
  const view = pressingView(job);
  show(view.el);
  try {
    const pressResult = await (state.demo ? demoPress : press)({
      picks,
      destination,
      skipExisting,
      makeCover: () => makeCover({ videoId: job.payload.videoId, title: destination.name || job.payload.title }),
      onEvent: (e) => view.update(e),
    });
    await sleep(700);
    state.view = 'done';
    show(doneView({ job, pressResult, actions }));
  } catch (e) {
    // Keep the user's picks: back to review with the error on top.
    console.error(e);
    const settings = await loadSettings();
    state.view = 'review';
    const el = reviewView({ job, settings, actions });
    el.prepend(h('section', { class: 'card error-card', role: 'alert' }, h('p', {}, friendly(e))));
    show(el);
  } finally {
    busy = false;
  }
}

const actions = {
  openOptions: () => chrome.runtime.openOptionsPage(),
  async connect() {
    try {
      await connect();
      state.notice = null;
      await refreshAccount();
      if (state.pending) {
        const p = state.pending;
        state.pending = null;
        return dig(p);
      }
    } catch (e) {
      state.notice = friendly(e);
    }
    renderCrate();
  },
  refreshSources,
  dig,
  reset() {
    if (busy) return;
    state.job = null;
    state.notice = null;
    renderCrate();
    refreshSources();
  },
  loadPlaylists: async () => (state.demo ? demoPlaylists() : listWritablePlaylists(state.user?.id ? state.user : await getMe())),
  press: doPress,
};

// ---- tracklists sent from the YouTube page buttons -----------------------------------
async function checkPending() {
  const { pendingRip } = await chrome.storage.session.get('pendingRip');
  if (!pendingRip || Date.now() - pendingRip.at > 5 * 60 * 1000) return;
  await chrome.storage.session.remove('pendingRip');
  chrome.action.setBadgeText({ text: '', tabId: pendingRip.tabId }).catch(() => {});
  dig(pendingRip);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.pendingRip?.newValue) checkPending();
  if (area === 'local' && (changes.spotifyTokens || changes.clientId || changes.settings)) {
    refreshAccount().then(() => state.view === 'crate' && !busy && renderCrate());
  }
});

document.getElementById('brand').addEventListener('click', () => actions.reset());
document.getElementById('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());

(async function init() {
  await refreshAccount();
  renderCrate();
  refreshSources();
  checkPending();
})();
