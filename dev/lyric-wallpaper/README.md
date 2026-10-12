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

Serves the repository on port 8765 and loads `tests.html` in browser mode and in Wallpaper Engine mode (`?we=1`, with fake Wallpaper Engine audio, media and property events). Chrome runs offline: the page answers the lyrics requests with a fake `Lyric.lyrics.fetch` and invented lines, so nothing reaches lrclib.net. It uses Chrome's virtual time and the wallpaper's deterministic `Lyric.debug.step()`. The page prints `PASS`/`FAIL` lines, an `ERRORS: …` line with uncaught errors and `DONE` at the end.

What it covers: settings, themes and import/export, the song position (timeline reports, pauses, seeks, players without a timeline), LRC parsing and title cleanup, the lyrics lookup (fallback searches, cache, retries, skipping songs quickly), the lyrics layer and the song card, idle ↔ show (triggers, transition, the pause before turning back), album colors, the "My image" property, render resolution and pause.
