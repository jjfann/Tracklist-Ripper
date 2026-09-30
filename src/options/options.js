import { connect, disconnect, isConnected, redirectUri, getClientId } from '../lib/spotify/auth.js';
import { getMe } from '../lib/spotify/playlists.js';
import { nanoAvailability, downloadNano } from '../lib/parser/nano.js';
import { loadSettings, saveSettings } from '../shared/settings.js';

const $ = (id) => document.getElementById(id);

function message(text, isError = false) {
  const el = $('spotify-msg');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

async function renderSpotify() {
  const clientId = await getClientId();
  $('client-id').value = clientId;
  const connected = await isConnected();
  const { spotifyUser } = await chrome.storage.local.get('spotifyUser');
  const status = $('conn-status');
  status.textContent = connected ? `Connected${spotifyUser ? ` as ${spotifyUser.name}` : ''}` : clientId ? 'Not connected' : 'Needs setup';
  status.classList.toggle('good', connected);
  $('connect').hidden = connected;
  $('connect').disabled = !clientId;
  $('disconnect').hidden = !connected;
}

$('redirect-uri').textContent = redirectUri();
$('copy-redirect').addEventListener('click', async () => {
  await navigator.clipboard.writeText(redirectUri());
  $('copy-redirect').textContent = 'Copied';
  setTimeout(() => ($('copy-redirect').textContent = 'Copy'), 1500);
});

$('save-client').addEventListener('click', async () => {
  const id = $('client-id').value.trim();
  if (id && !/^[0-9a-f]{32}$/i.test(id)) {
    message("That doesn't look like a Client ID (32 letters and numbers).", true);
    return;
  }
  const previous = await getClientId();
  await chrome.storage.local.set({ clientId: id });
  if (previous && previous !== id) await disconnect();
  message(id ? 'Saved. Now connect your account.' : 'Cleared.');
  renderSpotify();
});

$('connect').addEventListener('click', async () => {
  message('Waiting for Spotify…');
  try {
    await connect();
    const me = await getMe();
    message(`Connected as ${me.name}. You're ready: open a YouTube mix and hit "Rip tracklist".`);
  } catch (e) {
    const hint = /redirect/i.test(e.message) ? ' Check the Redirect URI matches exactly.' : '';
    message(`${e.message}${hint}`, true);
  }
  renderSpotify();
});

$('disconnect').addEventListener('click', async () => {
  await disconnect();
  message('Disconnected.');
  renderSpotify();
});

// ---- Gemini Nano -------------------------------------------------------------
const NANO_TEXT = {
  available: ['Ready', 'Gemini Nano is installed and will read the tricky lines.'],
  downloadable: ['Download needed', 'Your Chrome supports it. The model is a one-time download of a few GB, and Chrome needs about 22 GB free disk space.'],
  downloading: ['Downloading', 'Chrome is downloading the model in the background.'],
  unavailable: ['Not available', "This device or Chrome version can't run it (it needs Chrome 138+, 22 GB free disk, and either a GPU with more than 4 GB of VRAM or 16 GB of RAM). The built-in parser will be used."],
};

async function renderNano() {
  $('nano-status').textContent = 'Checking…';
  const a = await nanoAvailability({ timeoutMs: 10_000 });
  const [label, detail] = NANO_TEXT[a] || NANO_TEXT.unavailable;
  $('nano-status').textContent = label;
  $('nano-status').classList.toggle('good', a === 'available');
  $('nano-detail').textContent = detail;
  $('nano-download').hidden = !(a === 'downloadable' || a === 'downloading');
  $('nano-download').textContent = a === 'downloading' ? 'Show progress' : 'Download model';
  return a;
}

$('nano-download').addEventListener('click', async () => {
  $('nano-download').disabled = true;
  $('nano-meter').hidden = false;
  try {
    await downloadNano((loaded) => ($('nano-meter').firstElementChild.style.width = `${Math.round(loaded * 100)}%`));
  } catch (e) {
    $('nano-detail').textContent = `Download failed: ${e.message}`;
  }
  $('nano-download').disabled = false;
  $('nano-meter').hidden = true;
  renderNano();
});

// ---- settings -----------------------------------------------------------------
async function renderSettings() {
  const s = await loadSettings();
  $('use-nano').checked = s.useNano;
  $('default-public').checked = s.defaultPublic;
  $('skip-existing').checked = s.skipExisting;
  $('demo-mode').checked = s.demoMode;
}
$('use-nano').addEventListener('change', (e) => saveSettings({ useNano: e.target.checked }));
$('default-public').addEventListener('change', (e) => saveSettings({ defaultPublic: e.target.checked }));
$('skip-existing').addEventListener('change', (e) => saveSettings({ skipExisting: e.target.checked }));
$('demo-mode').addEventListener('change', (e) => saveSettings({ demoMode: e.target.checked }));

renderSpotify();
renderNano();
renderSettings();
