# Neural Plexus

An animated wallpaper for Wallpaper Engine (**Web** type): a living 3D network. Glowing nodes drift in depth, connect to their neighbors with lines and faint triangles, and signals race along the connections in chain reactions, like nerve impulses. Now and then part of the network assembles into a shape and lets it go again. Inspired by the plexus background of the Home Assistant login page, rebuilt from scratch in WebGL2.

It also runs directly in a browser (open `index.html`; press **M** for the settings menu) and on CasaOS: this very folder, copied into `/DATA/AppData/casamod/mod/wallpapers/` for the Live Wallpapers mod (a separate repository, NescauQuente/CasaMODs).

## Highlights

- **3D network:** nodes drift in a volume seen in perspective, with depth of field (near and far nodes turn into soft bokeh discs), a slow camera sway, mouse parallax, background haze, dust and bloom.
- **Signals:** a node that fires sends signals along its connections, and each node they reach fires on, so chain reactions spread through the network and die out. Nodes that just fired rest for a moment, so the waves don't echo forever.
- **Mouse:** the cursor connects to the nodes around it and draws them into a loose halo (or repels them); near it the nodes keep their distance from each other, so they never pile up while it rests. A click sends a shockwave that bends space and **overcharges** the nodes around: they release runners that race on through the network, faster and brighter than signals. A runner at a dead end can't stop: it jumps through empty space to the closest node ahead and keeps going, and with nothing close enough it bursts. **Overcharge strength** sets how far the runners travel and how hard they burst. Hold or drag for a **singularity**: it pulls the network into a crackling whirl and eats into anything in its reach (a formation, the visualizer, the clock lose their nodes to it one by one, the nearest first, and grow back slowly afterwards, a node at a time), and on release it explodes outward in an overcharge.
- **Formations,** every few minutes: a sphere, a torus, a DNA helix, a 4D hypercube turning in 4D, a spiral galaxy, a wave terrain (it dances to the music), an atom, or the current time drawn by the nodes themselves. When a formation (or the visualizer) lets go, its lines fade out while the nodes drift back into the network and their new connections fade in.
- **Audio visualizer:** once sound has been going on for about 3.5 seconds (any sound: not every song has bass; a notification sound is over before that), the network becomes a visualizer as long as there is sound (quiet passages and the gap between songs don't end it; 4 s of silence do), in one of two styles (alternating by default; **Visualizer style** in the Audio group picks one): a 3D spectrogram landscape (the live spectrum in front, the past flowing into the distance, peak markers falling above) and a twisting spectrum tunnel coming at the viewer. It moves right on the music (a hit goes straight up, only the fall is eased) while the past scrolls away smoothly. When a formation's time comes, the visualizer turns into it, and the formation dances to the music (the sphere grows spectrum spikes, the torus's tube swells, the helix opens and closes, the galaxy's arms rise off the disc, the atom's rings and the hypercube throb); then the visualizer comes back. At the turn of the hour it rises and the big clock goes below it.
- **Music:** chain reactions on the bass beats, each from a random spot on screen (a strong hit overcharges a node there, like a click, away from where the last one struck), connections that stretch with the bass, a spectrum spread across the network, sparks on the treble, and on the drop of a song the camera flies through the network (the nodes stream past the viewer and new ones fade in far away).
- **Particle clock** (the default clock font): the network's own nodes draw the time, as seven-segment digits whose connections are the segments; the digits morph as the time changes. Around the turn of each hour (6 s before to 6 s after, with no formation meanwhile) the clock goes big to the middle of the screen, with more nodes and display-style segments, and the turn of the hour overcharges it with a pulse. The date and the song stay text.
- **The song playing** (Wallpaper Engine only, through its media integration): the network takes the colors of the album cover, and the clock can show the title and artist.

- **Motion is smooth:** nodes join a formation or the clock along gentle arcs (setting off at the speed they had, easing in), staggered, drawing the nearest part of the network into the shape; pushes (letting go, explosions, shockwaves) build up and fade instead of jerking.

## Installing in Wallpaper Engine

1. Copy this folder to `...\steamapps\common\wallpaper_engine\projects\myprojects\neural-plexus\`.
2. The wallpaper shows up as **Neural Plexus** under "My Wallpapers" (`preview.jpg` is its thumbnail).

## Languages

31 languages, the same list as CasaOS: Arabic (right-to-left), Belarusian, Bulgarian, Catalan, Chinese (Simplified and Traditional), Croatian, Czech, Dutch, English, French, German, Greek, Hungarian, Indonesian, Italian, Japanese, Korean, Norwegian, Polish, Portuguese (Brazil and Portugal), Romanian, Russian, Slovak, Slovenian, Spanish, Swedish, Turkish, Ukrainian and Vietnamese. English is the default.

- **Wallpaper Engine panel:** localized through the `localization` block in `project.json`. Wallpaper Engine picks the language of its own UI and falls back to English (it has no Catalan or Croatian UI).
- **Hidden menu and clock date:** follow the **Language** setting. Automatic uses the language Wallpaper Engine (or Live Wallpapers) reports, then the browser's, and falls back to English.

English lives in the code (option labels in `js/settings.js`, UI strings in `js/i18n.js`). Each other language is `js/lang/<code>.js`, keyed by where the text appears (`s.<option>`, `o.<option>.<choice>`, `g.<group>`, `menu.title`…); `pt-pt` only holds what differs from `pt`. After adding or changing a text, translate it in every file and run `node dev/plexus-wallpaper/i18n-check.js` from the repository root.

## Structure

| File | Purpose |
|---|---|
| `index.html` | Wallpaper Engine / browser page |
| `css/plexus.css` | Component styles (canvas, clock, menu); every id and class is prefixed `px-` |
| `js/settings.js` | **Single source of truth** for settings and themes |
| `js/i18n.js` | UI strings and language detection |
| `js/main.js` | Core: settings, camera, mouse (click, singularity), shockwaves, hyperspeed flight, album colors, formation schedule, render loop |
| `js/net.js` | The network: nodes in 3D, connections (a uniform grid of cells), triangles, signals and chain reactions, overcharged runners (jumps, pops), forces |
| `js/shapes.js` | Formations: the shapes, gathering the nodes, holding and releasing them; the audio visualizer |
| `js/pclock.js` | The particle clock: seven-segment digits (and the big display at the turn of the hour) drawn by the nodes |
| `js/scene.js` | Turns the network into instance buffers: lines, points (nodes, rings, signals, dust) and triangles |
| `js/gl.js` | WebGL2 renderer: instanced lines and points, bloom, haze, shockwave lens, hyperspeed zoom blur |
| `js/render2d.js` | Canvas 2D renderer, used when WebGL2 is unavailable |
| `js/audio.js` | Wallpaper Engine audio and browser capture (microphone/tab); beats, treble hits and drops |
| `js/media.js` | The song playing and its album colors (Wallpaper Engine media integration) |
| `js/clock.js` | Clock, date and the song playing (with the particle clock, it only holds the place of the time) |
| `js/menu.js` | Hidden menu (M key) |
| `js/util.js` | Math and color helpers |
| `js/lang/<code>.js` | Translations, one file per language (English is in the code) |

## Performance

- Everything is drawn in a few instanced WebGL2 draw calls; bloom runs at a quarter and an eighth of the resolution.
- Connections are found through a uniform grid, so each node only checks its neighboring cells. Buffers are typed arrays that only grow; nothing is allocated per frame.
- **Render resolution** (General) draws at 75% or 50% for weaker GPUs; the node count, bloom and depth of field are the other big knobs.
- When Wallpaper Engine or Live Wallpapers pause the wallpaper (`wallpaperPropertyListener.setPaused`), rendering and the clock stop until it resumes.

## Trying things out

In a browser (or the Wallpaper Engine / CasaOS developer tools), the console has `Plexus.debug`: `Plexus.debug.flight()` flies through the network as on a drop, `Plexus.debug.shape('tesseract')` starts a formation (`sphere`, `torus`, `helix`, `tesseract`, `galaxy`, `terrain`, `atom`, `clock`), `Plexus.debug.visualizer('terrain')` or `('tunnel')` shows the visualizer now, and `Plexus.debug.hourIn(10)` makes the clock's hour turn in 10 seconds (`Plexus.debug.timeShift(0)` puts the real time back).

## Changing settings or themes

Edit `js/settings.js` and regenerate the Wallpaper Engine panel (from the repository root):

```bash
node dev/plexus-wallpaper/build-project.js
```

## How themes work

- **In the browser:** picking a theme copies its values; changing any visual option afterwards switches the theme to "Custom".
- **In Wallpaper Engine:** the theme is the base. Any panel option you change (away from its default) takes priority over it. A code pasted into "Import code" sits in between: it overrides the theme and is overridden by the panel.

## Export and import

In the browser menu, **Export code** produces a `PLEXUS1:…` string with everything that differs from the defaults. It can be imported in another browser (**Import code** button) or pasted into the **Import code** field of the Wallpaper Engine panel.
