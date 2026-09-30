// Spotify Authorization Code + PKCE via chrome.identity (no client secret).

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
export const SCOPES = [
  'playlist-modify-private',
  'playlist-modify-public',
  'playlist-read-private',
  'playlist-read-collaborative',
  'ugc-image-upload',
];

export class NotConnectedError extends Error {
  constructor(message = 'Spotify is not connected') {
    super(message);
    this.name = 'NotConnectedError';
  }
}

export function redirectUri() {
  // https://<extension-id>.chromiumapp.org/callback. Spotify's dashboard
  // rejects redirect URIs without a real path, so don't use the bare "/".
  return chrome.identity.getRedirectURL('callback');
}

export async function getClientId() {
  const { clientId } = await chrome.storage.local.get('clientId');
  return (clientId || '').trim();
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function randomString(len = 64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

async function saveTokens(json, previousRefresh) {
  const tokens = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || previousRefresh,
    expiresAt: Date.now() + json.expires_in * 1000,
    scope: json.scope,
  };
  await chrome.storage.local.set({ spotifyTokens: tokens });
  return tokens;
}

async function tokenRequest(params) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error_description || json.error || `Token request failed (${res.status})`);
    err.code = json.error;
    throw err;
  }
  return json;
}

/** Opens the Spotify consent window. Must be called from an extension page. */
export async function connect() {
  const clientId = await getClientId();
  if (!clientId) throw new Error('Add your Spotify Client ID in the options first.');

  const verifier = randomString(64);
  const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = randomString(16);
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
    scope: SCOPES.join(' '),
  });

  const redirected = await chrome.identity.launchWebAuthFlow({ url: url.href, interactive: true });
  const params = new URL(redirected).searchParams;
  if (params.get('error')) throw new Error(`Spotify said: ${params.get('error')}`);
  if (params.get('state') !== state) throw new Error('Login state mismatch, please try again.');

  const json = await tokenRequest({
    grant_type: 'authorization_code',
    code: params.get('code'),
    redirect_uri: redirectUri(),
    client_id: clientId,
    code_verifier: verifier,
  });
  return saveTokens(json);
}

export async function disconnect() {
  await chrome.storage.local.remove(['spotifyTokens', 'spotifyUser']);
}

let refreshing = null;

async function refresh(tokens) {
  refreshing ??= (async () => {
    try {
      const json = await tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
        client_id: await getClientId(),
      });
      return await saveTokens(json, tokens.refreshToken);
    } catch (e) {
      if (e.code === 'invalid_grant') {
        await disconnect();
        throw new NotConnectedError('Spotify session expired, please reconnect.');
      }
      throw e;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** A valid access token, refreshed if it is about to expire. */
export async function getAccessToken({ force = false } = {}) {
  const { spotifyTokens: tokens } = await chrome.storage.local.get('spotifyTokens');
  if (!tokens?.refreshToken) throw new NotConnectedError();
  if (!force && tokens.expiresAt - 60_000 > Date.now()) return tokens.accessToken;
  return (await refresh(tokens)).accessToken;
}

export async function isConnected() {
  const { spotifyTokens } = await chrome.storage.local.get('spotifyTokens');
  return Boolean(spotifyTokens?.refreshToken);
}
