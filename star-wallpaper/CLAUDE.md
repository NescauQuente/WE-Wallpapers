# Starry Orbit

An animated starry wallpaper for Wallpaper Engine (nebula, gravitational waves, black hole, planets, lightning, audio reactivity), a plain web wallpaper:

- `wallpaper-engine/` — the wallpaper (also runs in a browser; hidden menu on M). `project.json` is generated from `js/settings.js` by `tools/build-project.js`. See `wallpaper-engine/README.md`.
- On CasaOS it runs as is through the **Live Wallpapers** mod, a separate project (`../CasaMODs/casaos-live-wallpapers`): this folder is copied into the mod's wallpapers folder. CasaOS needs nothing special from the engine — Live Wallpapers provides the Wallpaper Engine web API.
- `deprecated/` — the former CasaOS mod of its own (not built, not tested; reference only).

## Working here

- The user is Brazilian: reply in Portuguese (pt-BR). Code, comments and READMEs stay in English.
- Engine ids and classes are prefixed `so-`; `Starry.host` (see `wallpaper-engine/README.md`) is an optional API for pages that embed the engine scripts directly — nothing uses it today.
- Tests (see `tests/README.md`): the user's PC struggles with the browser suite, so do not run it by default. Always run the quick `node tests/i18n-check.js` (seconds); run `node tests/wallpaper-engine/run.mjs` only when the user asks. Keep the test pages in sync with the code even when not running them.
- Languages: English lives in the code (`settings.js` labels, `i18n.js` messages); every other language is `wallpaper-engine/js/lang/<code>.js` (31 languages, the CasaOS list; `pt-pt` only overrides `pt`). A new or changed text needs its translation in every language file — `tests/i18n-check.js` fails otherwise.
- Write files with LF line endings (Python on Windows: `open(..., 'w', newline='\n')`). Don't create `.html` files with the editor tool: the desktop app opens them in the user's browser pane.
- The user's PC is low-end: keep new effects cheap (reuse the existing WebGL passes, avoid per-frame allocations).
- At the end, tell the user what to copy: `wallpaper-engine/` into Wallpaper Engine, and the same folder into `/DATA/AppData/casamod/mod/wallpapers/starry-orbit/` on the CasaOS server (just reload the page there).
- `../html-stars-test-OLD/` is an older copy from before the CasaOS work. Never copy files from it over this project; diff and merge by hand if asked.
