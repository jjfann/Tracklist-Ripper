// Opens the side panel when a "Rip tracklist" button is clicked on YouTube
// and hands the tracklist over via session storage.

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'RIP' || !sender.tab) return;

  // open() must run while the click's user gesture is still live, so call it first.
  const opening = chrome.sidePanel.open({ windowId: sender.tab.windowId });
  chrome.storage.session.set({ pendingRip: { ...msg.payload, tabId: sender.tab.id, at: Date.now() } });

  opening
    .then(() => sendResponse({ ok: true }))
    .catch((e) => {
      // Fallback: nudge the user to click the toolbar icon.
      chrome.action.setBadgeText({ text: '1', tabId: sender.tab.id });
      chrome.action.setBadgeBackgroundColor({ color: '#8C3040', tabId: sender.tab.id });
      sendResponse({ ok: false, error: e.message });
    });
  return true;
});
