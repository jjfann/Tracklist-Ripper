export const DEFAULTS = {
  useNano: true, // use Gemini Nano when this Chrome has it
  defaultPublic: false,
  skipExisting: true,
  demoMode: false, // fake Spotify, for trying the extension without an account
};

export async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...settings };
}

export async function saveSettings(patch) {
  const next = { ...(await loadSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}
