// Tracklist Ripper: finds tracklists on YouTube watch pages and adds
// "Rip tracklist" buttons to the description and to tracklist-y comments.
(() => {
  if (window.__playlistRipper) return;
  window.__playlistRipper = true;

  const STAMP = /(?:^|[\s[(])(?:\d{1,2}:)?\d{1,2}:\d{2}(?=$|[\s\])])/;
  const DASH = /\S\s[-‐-―−]\s\S/;

  function looksLikeTracklist(text) {
    const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const stamped = lines.filter((l) => STAMP.test(l)).length;
    const dashed = lines.filter((l) => DASH.test(l)).length;
    return stamped >= 3 || dashed >= 4;
  }

  const videoId = () => (location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null);

  /** Extract the balanced {...} starting at `start` (string-aware). */
  function balancedObject(src, start) {
    let depth = 0;
    let inStr = false;
    for (let i = start; i < src.length; i++) {
      const c = src[i];
      if (inStr) {
        if (c === '\\') i++;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    return null;
  }

  function domMeta(id) {
    const q = (s) => document.querySelector(s);
    return {
      videoId: id,
      title: q('ytd-watch-metadata h1')?.textContent.trim() || document.title.replace(/ - YouTube$/, ''),
      channel: q('ytd-watch-metadata #channel-name a, #owner #channel-name a')?.textContent.trim() || '',
      description: q('ytd-watch-metadata #description-inline-expander, ytd-watch-metadata #description')?.innerText || '',
    };
  }

  // Full, untruncated description straight from the page data.
  const metaCache = new Map();
  let currentMeta = null;
  function getVideoMeta(id) {
    if (!metaCache.has(id)) {
      metaCache.set(
        id,
        (async () => {
          try {
            const html = await (await fetch(`/watch?v=${encodeURIComponent(id)}`, { credentials: 'include' })).text();
            const at = html.indexOf('"videoDetails":');
            const json = at >= 0 ? balancedObject(html, html.indexOf('{', at)) : null;
            if (json) {
              const d = JSON.parse(json);
              if (d.videoId === id) {
                return { videoId: id, title: d.title || '', channel: d.author || '', description: d.shortDescription || '' };
              }
            }
          } catch (e) {
            console.debug('[Tracklist Ripper] description fetch failed, using page text', e);
          }
          return domMeta(id);
        })(),
      );
    }
    return metaCache.get(id);
  }

  function payloadBase() {
    const id = videoId();
    const m = currentMeta?.videoId === id ? currentMeta : domMeta(id);
    return { videoId: id, title: m.title, channel: m.channel, url: `https://www.youtube.com/watch?v=${id}` };
  }

  function rip(text, source, author) {
    // Send synchronously inside the click so Chrome lets the side panel open.
    chrome.runtime.sendMessage({ type: 'RIP', payload: { ...payloadBase(), text, source, author } }).catch(() => {});
  }

  function makeButton(label, title, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pr-rip-btn';
    b.title = title;
    const disc = document.createElement('span');
    disc.className = 'pr-disc';
    disc.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = label;
    b.append(disc, text);
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      b.classList.remove('pr-spin');
      void b.offsetWidth;
      b.classList.add('pr-spin');
      onClick();
    });
    return b;
  }

  // ---- description -------------------------------------------------------
  async function refreshDescription() {
    document.getElementById('pr-desc-bar')?.remove();
    const id = videoId();
    if (!id) return;
    const meta = await getVideoMeta(id);
    if (videoId() !== id) return;
    currentMeta = meta;
    if (!looksLikeTracklist(meta.description)) return;

    const bar = document.createElement('div');
    bar.id = 'pr-desc-bar';
    const note = document.createElement('span');
    note.className = 'pr-note';
    note.textContent = 'Tracklist spotted in the description';
    bar.append(makeButton('Rip tracklist', 'Send this tracklist to Tracklist Ripper', () => rip(meta.description, 'description')), note);

    // Wait for the metadata block (it renders late on SPA navigations).
    for (let i = 0; i < 40 && videoId() === id; i++) {
      const fold = document.querySelector('ytd-watch-metadata #above-the-fold');
      const bottom = fold?.querySelector('#bottom-row');
      if (fold && bottom) {
        document.getElementById('pr-desc-bar')?.remove();
        fold.insertBefore(bar, bottom);
        return;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  // ---- comments ----------------------------------------------------------
  const commentButtons = new WeakMap();

  function commentText(el) {
    return el.textContent.replace(/ /g, ' ').trim();
  }

  function scanComments() {
    for (const el of document.querySelectorAll('#comments #content-text')) {
      const text = commentText(el);
      const key = `${text.length}:${text.slice(0, 24)}`;
      if (el.dataset.prKey === key) continue;
      el.dataset.prKey = key;
      commentButtons.get(el)?.remove();
      commentButtons.delete(el);
      if (!looksLikeTracklist(text)) continue;

      const thread = el.closest('ytd-comment-view-model, ytd-comment-renderer');
      const author = thread?.querySelector('#author-text')?.textContent.trim() || '';
      const btn = makeButton('Rip tracklist', 'Send this comment\'s tracklist to Tracklist Ripper', () => rip(commentText(el), 'comment', author));
      btn.classList.add('pr-in-comment');
      const anchor = el.closest('#comment-content') || el.closest('#expander') || el;
      anchor.after(btn);
      commentButtons.set(el, btn);
    }
  }

  function detectedComments() {
    const out = [];
    for (const el of document.querySelectorAll('#comments #content-text')) {
      const text = commentText(el);
      if (!looksLikeTracklist(text)) continue;
      const thread = el.closest('ytd-comment-view-model, ytd-comment-renderer');
      out.push({ text, author: thread?.querySelector('#author-text')?.textContent.trim() || 'Comment' });
    }
    return out;
  }

  let scanTimer = null;
  new MutationObserver(() => {
    if (scanTimer || !videoId()) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scanComments();
    }, 400);
  }).observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('yt-navigate-finish', () => refreshDescription());
  refreshDescription();

  // ---- side panel asks what's on this page ----------------------------------
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'GET_SOURCES') return;
    const id = videoId();
    if (!id) {
      sendResponse({ onVideo: false });
      return;
    }
    getVideoMeta(id).then((meta) => {
      sendResponse({
        onVideo: true,
        ...payloadBase(),
        title: meta.title,
        channel: meta.channel,
        description: meta.description,
        descriptionLooksLikeTracklist: looksLikeTracklist(meta.description),
        comments: detectedComments().slice(0, 8),
      });
    });
    return true;
  });
})();
