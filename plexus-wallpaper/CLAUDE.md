# Neural Plexus

An animated 3D plexus wallpaper for Wallpaper Engine (nodes drifting in depth, connections and triangles, signals in chain reactions, formations, a mouse singularity, hyperspeed on the drop, audio reactivity), a plain web wallpaper:

- `wallpaper-engine/` — the wallpaper (also runs in a browser; hidden menu on M). `project.json` is generated from `js/settings.js` by `tools/build-project.js`. See `wallpaper-engine/README.md`.
- On CasaOS it runs as is through the **Live Wallpapers** mod, a separate project (`../casaos-live-wallpapers`): this folder is copied into the mod's wallpapers folder. Live Wallpapers provides the Wallpaper Engine web API.
- A sibling of Starry Orbit (`../star-wallpaper`): the settings menu, languages, audio, album colors and clock came from there and work the same way. The two projects are independent; a fix in one of those shared pieces may be worth porting to the other.

## Working here

- The user is Brazilian: reply in Portuguese (pt-BR). Code, comments and READMEs stay in English.
- Engine ids and classes are prefixed `px-`; the global namespace is `window.Plexus`.
- Tests (see `tests/README.md`): the user's PC struggles with the browser suite, so do not run it by default. Always run the quick `node tests/i18n-check.js` (seconds); run `node tests/wallpaper-engine/run.mjs` only when the user asks. Keep the test page in sync with the code even when not running it.
- Languages: English lives in the code (`settings.js` labels, `i18n.js` messages); every other language is `wallpaper-engine/js/lang/<code>.js` (31 languages, the CasaOS list; `pt-pt` only overrides `pt`). A new or changed text needs its translation in every language file — `tests/i18n-check.js` fails otherwise.
- Write files with LF line endings (Python on Windows: `open(..., 'w', newline='\n')`). Don't create `.html` files with the editor tool: the desktop app opens them in the user's browser pane.
- The user's PC is low-end: keep new effects cheap (reuse the instanced WebGL passes, avoid per-frame allocations).
- At the end, tell the user what to copy: `wallpaper-engine/` into Wallpaper Engine, and the same folder into `/DATA/AppData/casamod/mod/wallpapers/neural-plexus/` on the CasaOS server (just reload the page there).
