# Starry Orbit

An animated wallpaper for Wallpaper Engine (**Web** type): a galaxy of stars orbiting the center of the screen, with a fluid procedural nebula, gravitational waves that stretch and squeeze space (and bend around the stars; the supermassive black hole sends out a two-armed spiral), shooting stars, ready-made themes, a clock and full audio reactivity.

It also runs directly in a browser (open `index.html`; press **M** for the settings menu) and on CasaOS: this very folder, copied into `/DATA/AppData/casamod/mod/wallpapers/` for the Live Wallpapers mod (a separate repository, UsuarioDeJava/CasaMODs).

## Highlights

- **Music:** stars pulse and rest smaller while music plays, chain lightning jumps between stars on the bass, and on the drop of a song the sky jumps to hyperspace and arrives at a new one.
- **The song playing** (Wallpaper Engine only, through its media integration): the sky takes the colors of the album cover, and the clock can show the title and artist.
- **Gravity:** click for a gravitational wave (space stretches and squeezes in a turning "+"), hold or drag for a black hole that devours passing planets; feed it enough and it turns supermassive, with an accretion disk and a spiral wave when released.
- **Rare events,** every few minutes: a supernova (with its remnant and pulsar), a comet, a meteor shower or a planet parade.

## Installing in Wallpaper Engine

1. Copy this folder to `...\steamapps\common\wallpaper_engine\projects\myprojects\starry-orbit\`.
2. The wallpaper shows up as **Starry Orbit** under "My Wallpapers" (`preview.gif`, an animated demo, is its thumbnail).

## Languages

31 languages, the same list as CasaOS: Arabic (right-to-left), Belarusian, Bulgarian, Catalan, Chinese (Simplified and Traditional), Croatian, Czech, Dutch, English, French, German, Greek, Hungarian, Indonesian, Italian, Japanese, Korean, Norwegian, Polish, Portuguese (Brazil and Portugal), Romanian, Russian, Slovak, Slovenian, Spanish, Swedish, Turkish, Ukrainian and Vietnamese. English is the default.

- **Wallpaper Engine panel:** localized through the `localization` block in `project.json`. Wallpaper Engine picks the language of its own UI and falls back to English (it has no Catalan or Croatian UI).
- **Hidden menu and clock date:** follow the **Language** setting. Automatic uses the language Wallpaper Engine (or CasaOS) reports, then the browser's, and falls back to English.

English lives in the code (option labels in `js/settings.js`, UI strings in `js/i18n.js`). Each other language is `js/lang/<code>.js`, keyed by where the text appears (`s.<option>`, `o.<option>.<choice>`, `g.<group>`, `menu.title`…); `pt-pt` only holds what differs from `pt`. After adding or changing a text, translate it in every file and run `node dev/star-wallpaper/i18n-check.js` from the repository root.

## Menu colors

The hidden menu follows the wallpaper: the panel takes the background color (a bright custom background gives a light panel) and the star color is the accent.

## Structure

| File | Purpose |
|---|---|
| `index.html` | Wallpaper Engine / browser page |
| `css/starry.css` | Component styles (canvas layers, clock, menu); every id and class is prefixed `so-` |
| `js/settings.js` | **Single source of truth** for settings, themes and their translations |
| `js/i18n.js` | UI strings and language detection |
| `js/main.js` | Core: layout, stars, waves, black hole, hyperspace, album colors, rendering |
| `js/nebula-gl.js` | Fluid nebula in WebGL2 (gas animated every frame) |
| `js/nebula.js` | CPU nebula, used when WebGL2 is unavailable |
| `js/lens.js` | Gravitational lens in WebGL2 (waves, black hole, accretion disk) |
| `js/planets.js` | Planets devoured by the black hole, debris streams and relativistic jets |
| `js/events.js` | Rare events: supernova, comet, meteor shower, planet parade |
| `js/media.js` | The song playing and its album colors (Wallpaper Engine media integration) |
| `js/noise.js` | Seeded simplex noise |
| `js/audio.js` | Wallpaper Engine audio and browser capture (microphone/tab); beats, treble hits and drops |
| `js/clock.js` | Clock, date and the song playing |
| `js/menu.js` | Hidden menu (M key) |
| `js/lang/<code>.js` | Translations, one file per language (English is in the code) |

## Hosts

The engine runs as is in Wallpaper Engine, in a browser and in Live Wallpapers (which provides the Wallpaper Engine API). When Wallpaper Engine or Live Wallpapers pause it (`wallpaperPropertyListener.setPaused`), rendering and the clock stop until it resumes.

## Changing settings or themes

Edit `js/settings.js` and regenerate the Wallpaper Engine panel (from the repository root):

```bash
node dev/star-wallpaper/build-project.js
```

## How themes work

- **In the browser:** picking a theme copies its values; changing any visual option afterwards switches the theme to "Custom".
- **In Wallpaper Engine:** the theme is the base. Any panel option you change (away from its default) takes priority over it. A code pasted into "Import code" sits in between: it overrides the theme and is overridden by the panel.

## Export and import

In the browser menu, **Export code** produces a `STARRY1:…` string with everything that differs from the defaults. It can be imported in another browser (**Import code** button) or pasted into the **Import code** field of the Wallpaper Engine panel.
