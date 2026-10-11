# Lyric Stage

An animated wallpaper for Wallpaper Engine (**Web** type). While no music plays it looks like a plain desktop wallpaper: original artwork in the mood of the Windows 11 and Windows 10 wallpapers, or your own image. When a song starts, it turns into a stage: a background that moves to the music in the colors of the album cover, and the lyrics of the song line by line, in sync. When the music stops, it turns back into the wallpaper.

It also opens directly in a browser (open `index.html`; press **M** for the settings menu), which is handy for trying the looks; the song and its lyrics come from Wallpaper Engine.

## Highlights

- **Before the music:** three original looks (**Windows 11 style**, light and dark: soft blue light and flowing translucent ribbons; **Windows 10 style**: light shafts on deep blue) or **My image**. They are drawn from scratch, with no Microsoft artwork or logos. **Gentle motion while waiting** makes them drift slowly; without it the wallpaper stands still and costs nothing.
- **The transformation:** by default it happens when a player reports a song through Wallpaper Engine's media integration, or, without it, when there has been sound for a few seconds. It can also be kept always on or never. The wallpaper dissolves into the show along a glowing front (**Transition**), and comes back after the music has been paused for a while (**Back to the wallpaper after a pause of**).
- **The show:** an aurora in the album colors, concert spotlights, the blurred album cover, or a dark and minimal look; it pulses with the bass and the beats (**Reaction strength**), with optional floating particles. The song title and artist (with the cover) open the song big in the middle, then move to a corner.
- **Lyrics, in sync:** the line being sung, large, with the previous and next lines around it. **Karaoke** fills the line as it is sung, **Word by word** brings the words in one at a time, **Whole line** fades each line in. Fonts, size, position, text color (from the album cover, white or custom) and glow are all options. Instrumental breaks show a "♪ ♪ ♪" indicator; right-to-left lyrics (Arabic, Hebrew) read the right way.
- **Themes:** Album Stage (default), Neon Concert, Minimal, Cinema and Poster.

## What it needs

- **Media integration:** turn on **Media integration** in the Wallpaper Engine settings. That is how the wallpaper learns which song is playing (title, artist, album, cover) in Spotify, browsers and any player that shows up in the Windows media overlay. Without it the show still starts on sound, but there is no song title, no album colors and no lyrics.
- **Song position:** players that report their position (Wallpaper Engine's media timeline) get lyrics synced to the second, seeks included. With players that don't, the timing is counted from the start of the song; **Timing adjustment** (Lyrics) moves the lyrics earlier or later.
- **Internet access** for the lyrics.

## Lyrics (LRCLIB)

The lyrics are looked up while the song plays on [LRCLIB](https://lrclib.net), a free, open database of synced lyrics (no account or key). Only the song title, artist and duration are sent. Synced lyrics are preferred; when a song only has plain lyrics, they scroll along with the song approximately; when there are none, the wallpaper says so and keeps the show going.

The wallpaper itself contains **no lyrics**: they are fetched at runtime, kept in memory while the wallpaper runs (a small cache of recent songs, so skipping back does not ask again) and never written to disk or browser storage.

## My image

Pick **My image** under **Wallpaper** (Before the music) and choose a picture in the **Image** field of the Wallpaper Engine panel. To keep the real Windows wallpaper until the music starts, choose `C:\Windows\Web\Wallpaper\Windows\img0.jpg` (on Windows 11, `img19.jpg` in the same folder is the dark version). The picture covers the screen, centered. The image field only exists in the Wallpaper Engine panel: in a browser, My image shows the Windows 11 style instead.

## Installing in Wallpaper Engine

1. Copy this folder to `...\steamapps\common\wallpaper_engine\projects\myprojects\lyric-stage\`.
2. The wallpaper shows up as **Lyric Stage** under "My Wallpapers" (`preview.jpg` is its thumbnail).
3. Turn on **Media integration** in the Wallpaper Engine settings, if it is not on yet.

## Languages

31 languages: Arabic (right-to-left), Belarusian, Bulgarian, Catalan, Chinese (Simplified and Traditional), Croatian, Czech, Dutch, English, French, German, Greek, Hungarian, Indonesian, Italian, Japanese, Korean, Norwegian, Polish, Portuguese (Brazil and Portugal), Romanian, Russian, Slovak, Slovenian, Spanish, Swedish, Turkish, Ukrainian and Vietnamese. English is the default. The lyrics always show as the song has them.

- **Wallpaper Engine panel:** localized through the `localization` block in `project.json`. Wallpaper Engine picks the language of its own UI and falls back to English (it has no Catalan or Croatian UI).
- **Hidden menu and messages:** follow the **Language** setting. Automatic uses the language Wallpaper Engine reports, then the browser's, and falls back to English.

English lives in the code (option labels in `js/settings.js`, UI strings in `js/i18n.js`). Each other language is `js/lang/<code>.js`, keyed by where the text appears (`s.<option>`, `o.<option>.<choice>`, `g.<group>`, `n.<group>`, `menu.title`, `lyrics.searching`…); `pt-pt` only holds what differs from `pt`. After adding or changing a text, translate it in every file and run `node dev/lyric-wallpaper/i18n-check.js` from the repository root.

## Structure

| File | Purpose |
|---|---|
| `index.html` | Wallpaper Engine / browser page: the image layer, the background canvas and the stage |
| `css/lyric.css` | Page layers, settings menu and toasts; every id and class is prefixed `ls-` |
| `css/stage.css` | The lyrics and the song card |
| `js/settings.js` | **Single source of truth** for settings and themes |
| `js/i18n.js` | UI strings and language detection |
| `js/main.js` | Core: settings, idle ↔ show, album colors, lyrics on each new song, render loop |
| `js/media.js` | The song playing (Wallpaper Engine media integration): title, artist, cover, album colors, timeline |
| `js/songclock.js` | Where we are in the song, smooth between the player's position reports |
| `js/lyrics.js` | Lyrics lookup on LRCLIB (cache, retries, title cleanup) and LRC parsing |
| `js/gfx.js` | WebGL2 background (the idle looks, the show, the transition), with a Canvas 2D fallback |
| `js/stage.js` | The lyrics layer and the song card (DOM) |
| `js/audio.js` | Wallpaper Engine audio and browser capture (microphone/tab); beats |
| `js/menu.js` | Hidden menu (M key) |
| `js/util.js` | Math, color and file path helpers |
| `js/lang/<code>.js` | Translations, one file per language (English is in the code) |

## Performance

- The background is a single full-screen shader pass. While waiting for music without motion, nothing is drawn at all until something changes.
- **Render resolution** (General) draws the background at 75% (default) or 50% for weaker GPUs.
- The lyrics are plain text on top: the page only changes when a line changes (the karaoke fill is one CSS variable).
- Lyrics are fetched once per song (and cached), never per frame.
- When Wallpaper Engine pauses the wallpaper (`wallpaperPropertyListener.setPaused`), rendering stops until it resumes.

## Trying things out

In a browser (or the Wallpaper Engine developer tools), the console has `Lyric.debug` (see `js/main.js`): it can run the show with an invented song and invented lines, without a player.

## Changing settings or themes

Edit `js/settings.js` and regenerate the Wallpaper Engine panel (from the repository root):

```bash
node dev/lyric-wallpaper/build-project.js
```

## How themes work

- **In the browser:** picking a theme copies its values; changing any visual option afterwards switches the theme to "Custom".
- **In Wallpaper Engine:** the theme is the base. Any panel option you change (away from its default) takes priority over it. A code pasted into "Import code" sits in between: it overrides the theme and is overridden by the panel.

## Export and import

In the browser menu, **Export code** produces a `LYRIC1:…` string with everything that differs from the defaults (your own image is not included). It can be imported in another browser (**Import code** button) or pasted into the **Import code** field of the Wallpaper Engine panel.
