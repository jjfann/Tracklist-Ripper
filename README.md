# Tracklist Ripper

A Chrome extension that digs the tracklist out of a YouTube mix (from the description or a comment), finds the songs on Spotify, and presses them into a new or existing playlist.

## Setup (one time, about 5 minutes)

### 1. Load the extension

1. Open `chrome://extensions` and switch on **Developer mode** (top right).
2. Click **Load unpacked** and pick this folder.
3. The extension ID will be `hobcedacpkkcjfddbegmdagopbfhdhlc`. It's pinned by the `key` in `manifest.json`, so it never changes, and neither does the Spotify redirect URI.

The settings page opens automatically on first install.

### 2. Create your Spotify app

Spotify requires every tool like this to run through a developer app you own. Since February 2026, **development-mode apps only work if the app owner has Spotify Premium**, and up to 5 users can use them.

1. Go to the [Spotify developer dashboard](https://developer.spotify.com/dashboard) and choose **Create app**.
2. Add this **Redirect URI** exactly:
   ```
   https://hobcedacpkkcjfddbegmdagopbfhdhlc.chromiumapp.org/callback
   ```
3. Tick **Web API** and save.
4. Copy the **Client ID** into the extension's settings, click **Save**, then **Connect Spotify**.

Login uses PKCE, so there's no client secret. Your tokens stay in `chrome.storage.local`.

### 3. (Optional) On-device AI

If your Chrome supports **Gemini Nano** (Chrome 138+, about 22 GB of free disk, and either a GPU with more than 4 GB of VRAM or 16 GB of RAM), the settings page shows a **Download model** button. Once the model is installed, Nano reads the lines the built-in parser finds ambiguous. It runs locally and costs nothing. Anything Nano returns that isn't literally in the line is discarded, so it can't invent songs. You can check the model status at `chrome://on-device-internals`.

### No Spotify app yet? Use demo mode

Tick **Demo mode** in the settings to try everything without a Spotify connection. The YouTube buttons, tracklist reading, Gemini Nano and every screen are real, but a pretend Spotify "finds" whatever the parser read. About 1 in 10 songs comes back "not found", and title-only lines come back as "to check", so every path shows up. Nothing is sent anywhere. The done screen shows the cover art a new playlist would get. It's a good way to check how well a particular tracklist parses. It can't tell you how well real Spotify matching works.

## Using it

- **On a YouTube video**, a **Rip tracklist** button appears above the description when it contains a tracklist, and on any comment that looks like one. You may need to scroll down so the comments load. Clicking it opens the side panel and starts digging.
- **From the toolbar icon**, the side panel lists every tracklist found on the current video. You can also paste one in by hand.

Each run goes through four screens:

1. **Digging:** a turntable whose tonearm tracks progress, with a live counter of songs found.
2. **Review:** confident matches are pre-ticked. Uncertain ones are flagged, and you can pick another match or skip them. Unknown `ID - ID` tracks are listed but not searched.
3. **Pressing:** choose a new playlist (named after the video, private by default) or an existing one (optionally skipping songs already in it).
4. **Done:** a record showing *N of M tracks pressed*, a breakdown of what was left out and why, and a button to copy the missing tracks.

New playlists get a generated cover: the video thumbnail as a record sleeve.

## How the matching works

1. **Parse** (`src/lib/parser/`)
   - **Detect:** picks out the tracklist block, using timestamped lines first, then the densest run of `Artist - Title` lines.
   - **Clean:** strips timestamps, numbering, emoji, links, `[Label]` tags, DJ key/BPM tails and `(Official Video)` noise. Remix/edit info is kept as the *version*, and `feat.` artists are kept as featuring.
   - **Placeholders:** `ID - ID`, `???` and `...` lines are marked unknown.
2. **Match** (`src/lib/matcher/`)
   - **Search both ways round:** each line is searched as artist/title and as title/artist, then as free text, and scored with fuzzy similarity.
   - **Versions:** a requested remix beats the original, and the original beats an unrequested live or remix version.
   - **Junk filter:** karaoke, tribute and covers are penalised.
3. **Context** (`src/lib/matcher/context.js`)
   - **Mix profile:** the confident matches vote on the ambiguous lines. The extension builds a genre profile of the mix from the artists' Spotify genres plus genre words in the video title, finds its typical release year, and notes whether lines are written artist-first or title-first.
   - **Titles with no artist:** a line that is just a title (e.g. "Rain") ends up with the version by an artist that fits the mix.

## Development

```sh
npm test          # parser, matcher and Nano-guard tests (node --test, no dependencies)
npm run icons     # regenerate the vinyl toolbar icons
```

The code is vanilla ES modules with no build step. After editing, click the reload icon on `chrome://extensions`, then reopen the side panel.

```
manifest.json
src/background/service-worker.js   opens the side panel when a page button is clicked
src/content/youtube.{js,css}       finds tracklists, injects the buttons
src/sidepanel/                     UI: views/ (crate, digging, review, pressing, done), components/
src/options/                       settings: Spotify setup, Nano, defaults
src/lib/parser/                    tracklist parsing (+ nano.js)
src/lib/matcher/                   scoring and mix context
src/lib/spotify/                   PKCE auth, API wrapper, search, playlists
src/lib/pipeline.js                parse → match → context → press
src/shared/                        theme (rosewood & cream tokens), settings
test/                              node:test suites
```

To change the palette, edit the tokens at the top of `src/shared/theme.css`.

## Limits worth knowing

- **Search size:** Spotify's development mode caps search at 10 results per request, so each line costs 1 to 4 requests. A 50-track mix takes about 20 to 40 seconds.
- **Comments:** only comments already loaded on the page can be detected.
- **Songs not on Spotify** (unreleased IDs, bootlegs, dubplates) end up in the "didn't make it" list, ready to copy.

Fonts: [Fraunces](https://github.com/undercasetype/Fraunces) and [DM Sans](https://github.com/googlefonts/dm-fonts), both under the SIL Open Font License.
