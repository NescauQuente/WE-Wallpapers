# Starry Orbit — development

What is not part of the wallpaper itself (`../../star-wallpaper/`): the generator of its `project.json` and the tests. Run everything from the repository root.

| File | Purpose |
|---|---|
| `build-project.js` | Generates `star-wallpaper/project.json` from `js/settings.js` |
| `i18n-check.js` | Language check (quick, no browser) |
| `run.mjs`, `*.html` | Browser test suite |

## Tests

The Wallpaper Engine suite drives a headless Google Chrome (`C:/Program Files/Google/Chrome/Application/chrome.exe`) and needs Node 22+.

Run them after changing the wallpaper. The browser suite is heavy (minutes of software rendering); the language check is not.

### Languages (quick, no browser)

```bash
node dev/star-wallpaper/i18n-check.js
```

Every `js/lang/<code>.js` must have every English text, only known keys, and keep the parts that are not translated (`STARRY1:`, Esc, Wallpaper Engine). It also checks language detection (CasaOS `pt_br`/`zh_tw`/`no_no`, Wallpaper Engine `zh-chs`/`nb-no`, browser `zh-Hant-HK`…), the pt-pt → pt fallback, right-to-left Arabic, and regenerates `project.json` to check the Wallpaper Engine panel gets every locale.

### Wallpaper Engine

```bash
node dev/star-wallpaper/run.mjs
```

It runs the Windows Chrome at its default path; elsewhere, point `CHROME` at a Chrome or Chromium binary (e.g. `CHROME=/usr/bin/chromium node dev/star-wallpaper/run.mjs`).

Serves the repository on port 8765 and loads `tests.html` (settings, themes, import/export, audio, waves, black hole, lightning, drops and hyperspace, rare events, album colors and the song in the clock, clock, languages…) and `ptests.html` (planets and the black hole), each in browser mode and in Wallpaper Engine mode (`?we=1`, with fake WE audio and property events). It uses Chrome's virtual time and the engine's deterministic `Starry.debug.step()`, so the suite is slow (several minutes in SwiftShader) but stable.
