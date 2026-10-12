# Lyric Stage — development

What is not part of the wallpaper itself (`../../lyric-wallpaper/`): the generator of its `project.json` and the tests. Run everything from the repository root.

| File | Purpose |
|---|---|
| `build-project.js` | Generates `lyric-wallpaper/project.json` from `js/settings.js` (including the "My image" file picker) |
| `i18n-check.js` | Language check (quick, no browser) |
| `run.mjs`, `tests.html` | Browser test suite |

**No real lyrics, anywhere:** not in the tests, fake responses, demos, comments or screenshots. Tests use invented lines only ("First test line", "The second line comes in"…). Real lyrics only ever reach the wallpaper at runtime, from lrclib.net.

## Tests

The browser suite drives a headless Google Chrome (`C:/Program Files/Google/Chrome/Application/chrome.exe`) and needs Node 22+.

Run them after changing the wallpaper. The browser suite is heavier (software rendering); the language check is not.

### Languages (quick, no browser)

```bash
node dev/lyric-wallpaper/i18n-check.js
```

Every `js/lang/<code>.js` must have every English text, only known keys, and keep the parts that are not translated (`LYRIC1:`, the M and Esc keys, Wallpaper Engine, lrclib.net, the `C:\Windows\Web\Wallpaper\Windows\img0.jpg` path), and the "Before the music" note must name **My image** exactly as that language's choice reads. It also checks language detection (Wallpaper Engine `zh-chs`/`nb-no`, browser `zh-Hant-HK`, underscore spellings like `pt_br`…), the pt-pt → pt fallback, right-to-left Arabic, and regenerates `project.json` to check the Wallpaper Engine panel gets every locale and the "My image" file picker.

### Browser suite

```bash
node dev/lyric-wallpaper/run.mjs
```

It runs the Windows Chrome at its default path; elsewhere, point `CHROME` at a Chrome or Chromium binary (e.g. `CHROME=/usr/bin/chromium node dev/lyric-wallpaper/run.mjs`).

Serves the repository on port 8765 and loads `tests.html` in browser mode and in Wallpaper Engine mode (`?we=1`, with fake Wallpaper Engine audio, media and property listeners registered before the scripts load). Chrome runs offline: the page answers the lyrics requests with a fake `Lyric.lyrics.fetch` (a small fake lrclib.net with invented songs and invented lines), so nothing reaches lrclib.net. It uses Chrome's virtual time and the wallpaper's deterministic `Lyric.debug.manual(true)` + `Lyric.debug.step()` (each step moves the song clock too). The page prints `PASS`/`FAIL` lines, `INFO` notes, an `ERRORS: …` line with uncaught errors and `DONE` at the end.

What it covers:

- **Start:** the mode (browser or Wallpaper Engine), the WebGL2 shaders, the Wallpaper Engine listeners, the idle Windows 11 style with its page background and a light menu panel; the frame loop (dozing while nothing moves), Wallpaper Engine's pause and resume (a new size is drawn at once while paused); in Wallpaper Engine mode, a song reported before `main.js` ran (its lookup and its position).
- **Lyrics engine:** LRC parsing (stamps, tags, offset, several stamps per line, empty lines, word stamps), `lineAt`, title cleanup (version tails, video tags, credits, YouTube channels), the song clock (counting without reports, seeks, blending a close report without going backwards, pause), the lookup (search after `/get`, the cache, a refused header retried without it, `429` with `Retry-After`, not found remembered, server errors not remembered).
- **Settings:** themes and "Custom", export/import codes (never with the image path), invalid codes, plain JSON, `sanitize`, localStorage; in Wallpaper Engine mode the theme, code and panel layers.
- **My image:** the file property becomes the `#ls-image` background (a Windows path as a `file:///` URL), the canvas lets it through; a picture that does not load, or none, falls back to the Windows 11 style; the page background and the menu panel follow each look.
- **Rendering on demand:** nothing drawn while idle without motion, idle motion at most 30 frames a second, a show that reacts to the sound every frame, a silent show at most 30 frames a second.
- **Idle ↔ show:** each trigger (automatic with and without media integration, media only, sound only, always, never), the transition time, the pause/stop/silence before turning back (and playing again within it), short sounds that must not start it, "React to audio" off.
- **The lyrics of each song:** looked up on every new song with the reported duration, the song card, the current line (and the ones around it) following the timeline, seeks, the timing adjustment (both ways), pausing; a long line at size 2 in two rows at most; a pause that runs on across an empty LRC line; quick skips (only the last song looked up); the cache; many songs and seeks without the stage growing; right-to-left lines (invented Arabic and Hebrew); lyrics off and "never" (no lookups); not found, plain, instrumental, service errors (asked once more later) and offline; a player without a timeline (counted from the start of the song, with its message) until a report arrives; the media integration turned off (its last song is no longer shown).
- **Album colors:** the show and the lyrics accent take the cover colors, the cover reaches the background, white and custom text colors, grey covers, no cover ("Color when there is no album cover"), the menu panel in the album colors during the show and light again after.
- **Languages:** Portuguese (menu, stage message), Arabic right to left (menu, stage message), automatic from Wallpaper Engine, back to English.
- **Also:** render resolution, the FPS limit, every theme, background and animation, the console demo (`Lyric.debug.demo()`: the show, its first line, seek, pause, stop, word stamps without a timeline), the Canvas 2D fallback when the WebGL context is lost for good, and no JavaScript errors.
