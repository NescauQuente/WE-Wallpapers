# WE-Wallpapers

Animated Wallpaper Engine web wallpapers (plain HTML/JS, they also open in a browser for development).

This repository only targets Wallpaper Engine. CasaOS (the Live Wallpapers mod, repository UsuarioDeJava/CasaMODs) is handled in its own chat and repository: don't plan around it or check what works there.

The user is Brazilian: reply in Portuguese (pt-BR). Code, comments and READMEs stay in English.

## Layout (every wallpaper, including new ones)

```
<name>-wallpaper/   the wallpaper itself, nothing else: index.html, project.json,
                    preview.*, css/, js/ (js/lang/<code>.js), README.md
dev/<name>-wallpaper/
                    everything that is not shipped: build-project.js (generates
                    project.json from js/settings.js), i18n-check.js, run.mjs and
                    the test pages, README.md
```

The wallpaper folder is copied as is into Wallpaper Engine, so keep it clean: no tests, tools, notes, demo media or old versions in it (git history keeps those). Run every dev script from the repository root (e.g. `node dev/star-wallpaper/i18n-check.js`).

| Folder | Wallpaper | ids/classes | Namespace |
|---|---|---|---|
| `star-wallpaper/` | Starry Orbit | `so-` | `window.Starry` |
| `plexus-wallpaper/` | Neural Plexus | `px-` | `window.Plexus` |
| `lyric-wallpaper/` | Lyric Stage | `ls-` | `window.Lyric` |

Neural Plexus came from Starry Orbit, and Lyric Stage from Neural Plexus (menu, languages, audio, album colors work the same way); they are independent, but a fix in one of those shared pieces may be worth porting to the others. Lyric Stage fetches lyrics at runtime from lrclib.net: never put real song lyrics in the repository (tests and demos use invented lines), and its idle looks are original artwork (no Microsoft images or logos).

## Working rules

- `project.json` is generated: after changing `js/settings.js`, run `node dev/<name>/build-project.js`.
- Languages: English lives in the code (`settings.js` labels, `i18n.js` messages); every other language is `js/lang/<code>.js` (31 languages, the CasaOS list; `pt-pt` only overrides `pt`). A new or changed text needs its translation in every language file.
- Tests (see `dev/<name>/README.md`): always run the quick `node dev/<name>/i18n-check.js`. The user's PC struggles with the browser suite (`node dev/<name>/run.mjs`), so run it only when the user asks. Keep the test pages in sync with the code even when not running them. Elsewhere than Windows, set `CHROME` to the browser binary (in the cloud, as root, wrap Chromium with `--no-sandbox`).
- Write files with LF line endings (Python on Windows: `open(..., 'w', newline='\n')`). Don't create `.html` files with the editor tool: the desktop app opens them in the user's browser pane.
- The user's PC is low-end: keep new effects cheap (reuse the existing WebGL passes, avoid per-frame allocations).
- At the end, tell the user what to copy: the wallpaper folder into Wallpaper Engine.
