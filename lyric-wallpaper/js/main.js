/*
 * Lyric Stage — core: settings, idle ↔ show, album colors, the lyrics of each
 * new song and the render loop.
 *
 * While no music plays the wallpaper is one of the idle looks (gfx.js) or
 * the user's own image (#ls-image under the canvas). When a song plays
 * (Wallpaper Engine media integration) or, without it, when there has been
 * sound for a few seconds, it turns into the show: the background in the
 * album colors (gfx.js) and the lyrics over it (stage.js), looked up for every
 * new song (lyrics.js) and followed with the song position (songclock.js).
 * After the music has been paused or stopped for a while, it turns back.
 *
 * Per frame: audio → idle/show → colors → song position → stage →
 * background, which is only drawn when something moves (gfx.needsFrames):
 * an idle wallpaper without motion costs no GPU at all, and while it stays
 * so the frame loop dozes (a few checks a second instead of every frame).
 */
(function (S) {
  'use strict';

  var util = S.util, settings = S.settings, audio = S.audio, i18n = S.i18n, media = S.media;
  var songclock = S.songclock, lyrics = S.lyrics, stage = S.stage, menu = S.menu;
  var SCHEMA = settings.SCHEMA;
  var clamp = util.clamp;
  var isWE = audio.state.source === 'we';
  var STORAGE_KEY = 'lyric-stage-settings';
  var MUSIC_SURE = 3.5;       // s of sound that make it music (a notification is over before)
  var DIP = 0.6;              // s: a shorter silence does not break the music
  var LOST_FOR_GOOD = 3;      // s without the WebGL context: switch to Canvas 2D
  var IDLE_FPS = 30;          // idle motion is slow: this many frames are plenty (the
                              // show too while nothing reacts to the music)
  var DOZE_MS = 100;          // ms between checks while nothing moves (no frames)
  var CALM_AFTER = 1;         // s of silence: the show no longer reacts
  var RETRY_AFTER = 20;       // s: a lookup that could not reach the service is tried once more
  var THEME_EVERY = 0.5;      // s: how often the menu colors follow the show

  // The idle looks' base colors: the page under the canvas (no pale flash
  // before the first frame of a dark look) and the menu panel
  var LOOKS = {
    win11: { bg: '#dde8f5', rgb: [0.87, 0.91, 0.96], hue: 214, sat: 70 },
    win11dark: { bg: '#0a1222', rgb: [0.04, 0.07, 0.13], hue: 216, sat: 70 },
    win10: { bg: '#00102e', rgb: [0, 0.06, 0.18], hue: 218, sat: 80 },
    image: { bg: '#000000', rgb: [0.06, 0.07, 0.09], hue: 215, sat: 35 }
  };

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  var raw = settings.defaults();   // values as received from WE / the menu
  var imported = {};               // imported-code layer (WE only)
  var eff = null;                  // effective values (WE format)
  var cfg = {};                    // typed + derived values
  var fpsLimit = 0;
  var weLang = null;               // UI language reported by Wallpaper Engine, if any

  var canvas = document.getElementById('ls-canvas');
  var imageEl = document.getElementById('ls-image');
  var G = null, rendererName = '';  // Lyric.gfx (WebGL2) or Lyric.gfx2d
  var W = 0, H = 0;
  var time = 0, beat = 0, dirty = true, renders = 0, frames = 0, lastRender = -1, lost = 0;

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  // In WE, the theme and the imported code are layers: whatever the user
  // changed in the panel (different from the default) wins, then the code,
  // then the theme. In the browser, picking a theme copies its values, so the
  // saved values are used as-is.
  function resolve() {
    var out = {}, pv = settings.presetValues(raw.preset);
    SCHEMA.forEach(function (s) {
      var k = s.key;
      if (!isWE || !settings.equal(raw[k], s.def)) out[k] = raw[k];
      else if (k in imported) out[k] = imported[k];
      else if (s.look && k in pv) out[k] = pv[k];
      else out[k] = s.def;
    });
    return out;
  }

  function derive() {
    SCHEMA.forEach(function (s) {
      var v = eff[s.key];
      cfg[s.key] = s.type === 'slider' ? Number(v) : s.type === 'bool' ? (v === true || v === 'true') : v;
    });
    cfg.showRGB = util.parseColor(cfg.showcolor);
    cfg.textRGB = util.parseColor(cfg.textcolor);
    // Outside Wallpaper Engine the FPS limit comes from the menu
    if (!isWE) fpsLimit = Number(cfg.fpslimit) || 0;
  }

  function refresh() {
    var next = resolve(), fx = {}, first = !eff;
    SCHEMA.forEach(function (s) {
      if (s.fx && (first || !settings.equal(eff[s.key], next[s.key]))) {
        s.fx.split(' ').forEach(function (f) { fx[f] = true; });
      }
    });
    eff = next;
    derive();

    // Language: explicit setting, or automatic (WE language, then the system's)
    var lang = i18n.resolve(cfg.language, weLang);
    if (first || lang !== i18n.lang()) {
      i18n.setLang(lang);
      if (!first) menu.relabel();
    }
    // After the language: the stage refreshes its messages (cheap otherwise)
    stage.apply(cfg);

    if (fx.layout) layout();
    applyImage();
    albumColors();
    syncLyrics();
    themeKey = '';
    updateTheme();
    dirty = true;
    wake();
  }

  function save() {
    if (isWE) return; // inside WE, Wallpaper Engine stores the settings itself
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(raw)); } catch (e) {}
  }

  function loadSaved() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved || typeof saved !== 'object') return;
      Object.keys(saved).forEach(function (k) {
        var v = settings.sanitize(k, saved[k]);
        if (v !== undefined) raw[k] = v;
      });
    } catch (e) {}
  }

  // ---------------------------------------------------------------------------
  // Layout and renderer
  // ---------------------------------------------------------------------------
  function layout() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2), q = Number(cfg.quality) || 1;
    W = Math.max(1, Math.round(Math.max(1, window.innerWidth) * dpr * q));
    H = Math.max(1, Math.round(Math.max(1, window.innerHeight) * dpr * q));
    G.resize(W, H);
    screens();
    dirty = true;
    // A new size clears the canvas: paused (frames stopped, maybe still in
    // sight), draw it again at once
    if (paused && !manual) draw();
    wake();
  }

  // A wallpaper spanned across monitors ('screens'): the stage on the screen
  // 'lyricscreen', a "now playing" panel on the others, and the background's
  // center (the transition, the round visualizers) on the lyrics screen
  function screenCount(cw, ch) {
    if (cfg.screens === 'auto') return util.clamp(Math.round(cw / ch / (16 / 9)), 1, 4);
    return util.clamp(parseInt(cfg.screens, 10) || 1, 1, 4);
  }

  function screens() {
    var cw = Math.max(1, window.innerWidth), ch = Math.max(1, window.innerHeight);
    var n = screenCount(cw, ch), rw = cw / n, list = [];
    for (var i = 0; i < n; i++) list.push({ x0: i * rw, w: rw });
    var k = util.clamp(Math.round(cfg.lyricscreen) - 1, 0, n - 1);
    stage.setScreens(list, k);
    gp.vc = ((k + 0.5) * rw / cw * W - W / 2) / H;
    gp.vasp = rw / cw * W / H;
  }

  // Canvas 2D on a fresh canvas (one that held a WebGL context cannot give a
  // 2D one): when WebGL2 is unavailable, or its context is lost for good
  function use2d() {
    var fresh = document.createElement('canvas');
    fresh.id = 'ls-canvas';
    canvas.parentNode.replaceChild(fresh, canvas);
    canvas = fresh;
    G = S.gfx2d;
    G.init(canvas);
    canvas = G.canvas();
    rendererName = '2d';
    lost = 0;
    if (W) G.resize(W, H);
    // Each renderer keeps its own copy of the cover
    G.setCover(cover.ready);
    dirty = true;
  }

  // ---------------------------------------------------------------------------
  // The idle look: one of the artworks, or the user's own image ("My image",
  // a Wallpaper Engine file property). Without a picture that loads (none
  // chosen, a broken path, or a browser, which cannot pick one) it shows the
  // Windows 11 style instead.
  // ---------------------------------------------------------------------------
  var image = { url: '', state: 'none', probe: null };   // state: none | loading | ok | bad
  var curLook = '';

  function applyImage() {
    var url = cfg.idlestyle === 'image' ? util.fileUrl(cfg.idleimage) : '';
    if (url !== image.url) {
      image.url = url;
      image.state = url ? 'loading' : 'none';
      imageEl.style.backgroundImage = url ? 'url("' + url + '")' : '';
      if (image.probe) image.probe.onload = image.probe.onerror = null;
      image.probe = null;
      if (url) {
        // The CSS background gives no error: a probe tells whether it loads
        var probe = new Image();
        probe.onload = probe.onerror = function (e) {
          if (image.probe !== probe) return;
          image.probe = null;
          image.state = e.type === 'load' ? 'ok' : 'bad';
          lookChanged();
        };
        image.probe = probe;
        probe.src = url;
      }
    }
    lookChanged();
  }

  function idleLook() {
    if (cfg.idlestyle !== 'image') return LOOKS[cfg.idlestyle] ? cfg.idlestyle : 'win11';
    // While it loads (a local file: a moment) the canvas already lets it through
    return image.state === 'ok' || image.state === 'loading' ? 'image' : 'win11';
  }

  function lookChanged() {
    var look = idleLook();
    imageEl.hidden = look !== 'image';
    if (look === curLook) return;
    curLook = look;
    document.documentElement.style.background = document.body.style.background = LOOKS[look].bg;
    themeKey = '';
    updateTheme();
    dirty = true;
    wake();
  }

  // ---------------------------------------------------------------------------
  // Colors: the album cover's (or "Color when there is no album cover"),
  // eased. A (main light), B (second light), bg (the hue of the dark base),
  // and the text and accent colors of the lyrics
  // ---------------------------------------------------------------------------
  var live = { A: [0, 0, 0], B: [0, 0, 0], bg: [0, 0, 0], text: [1, 1, 1], accent: [1, 1, 1] };
  var goal = { A: [0, 0, 0], B: [0, 0, 0], bg: [0, 0, 0], text: [1, 1, 1], accent: [1, 1, 1] };
  var colorsSet = false;

  // Hue in degrees, s and l in % → into dst as [r, g, b] 0–1
  function hslInto(dst, h, s, l) {
    var c = util.hslToRgb(h, clamp(s, 0, 100) / 100, clamp(l, 0, 100) / 100);
    dst[0] = c[0] / 255;
    dst[1] = c[1] / 255;
    dst[2] = c[2] / 255;
    return dst;
  }

  function copy(dst, src) {
    dst[0] = src[0];
    dst[1] = src[1];
    dst[2] = src[2];
  }

  // The song the player reports, '' when none. Once the media integration is
  // turned off its last song is stale: no title, cover or lyrics from it
  function songTitle() {
    var m = media.state;
    if (!m.enabled) return '';
    // A show started by sound alone (a music bot, a game…) while the player's
    // song is paused: that song is not what plays
    if (show.source === 'sound' && !m.playing) return '';
    return m.title;
  }

  // The colors to ease to (on a new cover or a settings change)
  function albumColors() {
    var m = media.state, pal = songTitle() ? m.palette : null, hue, sat, light, hue2;
    if (pal) {
      hue = pal.hue;
      sat = pal.sat;
      light = pal.light;
      hue2 = pal.hue2 !== null ? pal.hue2 : hue + 40;
    } else {
      var hsl = util.rgbToHsl(cfg.showRGB);
      hue = hsl[0];
      sat = hsl[1];
      light = hsl[2];
      hue2 = hue + 40;
    }
    // A grey cover stays silvery instead of turning into a color
    var grey = sat < 8;
    hslInto(goal.A, hue, grey ? sat : Math.max(sat, 55), grey ? 72 : clamp(light, 45, 65));
    hslInto(goal.B, hue2, grey ? sat : Math.max(sat, 50), grey ? 55 : 52);
    hslInto(goal.bg, hue, Math.min(55, sat * 0.6), 6);
    if (cfg.textmode === 'white') {
      copy(goal.text, [1, 1, 1]);
      copy(goal.accent, [1, 1, 1]);
    } else if (cfg.textmode === 'custom') {
      copy(goal.text, cfg.textRGB);
      copy(goal.accent, cfg.textRGB);
    } else {
      // From the album: near white with its tint, the sung part in its color
      hslInto(goal.text, hue, Math.min(sat, 45), 94);
      hslInto(goal.accent, hue, grey ? sat : clamp(sat, 60, 95), grey ? 86 : 72);
    }
    if (!colorsSet) {
      colorsSet = true;
      Object.keys(live).forEach(function (k) { copy(live[k], goal[k]); });
    }
  }

  function ease3(cur, to, k) {
    cur[0] += (to[0] - cur[0]) * k;
    cur[1] += (to[1] - cur[1]) * k;
    cur[2] += (to[2] - cur[2]) * k;
  }

  function easeColors(dt) {
    var k = 1 - Math.exp(-dt * 2);
    ease3(live.A, goal.A, k);
    ease3(live.B, goal.B, k);
    ease3(live.bg, goal.bg, k);
    ease3(live.text, goal.text, k);
    ease3(live.accent, goal.accent, k);
  }

  // The album cover: the stage shows the data URL; the background gets it as
  // an image (once it is decoded)
  var cover = { url: '', img: null, ready: null };

  function applyCover() {
    var url = songTitle() ? media.state.cover : '';
    if (url === cover.url) return;
    cover.url = url;
    cover.ready = null;
    if (cover.img) cover.img.onload = cover.img.onerror = null;
    cover.img = null;
    G.setCover(null);
    dirty = true;
    if (!url) return;
    var img = new Image();
    img.onload = function () {
      if (cover.img !== img) return;
      cover.ready = img;
      G.setCover(img);
      dirty = true;
      wake();
    };
    img.onerror = function () { if (cover.img === img) cover.img = null; };
    cover.img = img;
    img.src = url;
  }

  // ---------------------------------------------------------------------------
  // The menu follows the wallpaper: the idle look's colors (a light panel on
  // the light Windows 11 style), the album's while the show is on
  // ---------------------------------------------------------------------------
  var themeArg = { hue: 0, sat: 0, bgRGB: [0, 0, 0] }, themeKey = '', themeAge = 0;

  function updateTheme() {
    themeAge = 0;
    var key;
    if (show.eased > 0.5) {
      var hsl = util.rgbToHsl(live.A);
      key = 'show ' + Math.round(hsl[0] / 4) + ' ' + Math.round(hsl[1] / 4);
      if (key === themeKey) return;
      themeArg.hue = hsl[0];
      themeArg.sat = hsl[1];
      themeArg.bgRGB = hslInto([0, 0, 0], hsl[0], Math.min(55, hsl[1] * 0.6), 6);
    } else {
      var L = LOOKS[curLook] || LOOKS.win11;
      key = curLook;
      if (key === themeKey) return;
      themeArg.hue = L.hue;
      themeArg.sat = L.sat;
      themeArg.bgRGB = L.rgb;
    }
    themeKey = key;
    menu.setTheme(themeArg);
  }

  // ---------------------------------------------------------------------------
  // Idle ↔ show. Turn into the show ('trigger'):
  //   auto   — a song playing, when a player reports one through Wallpaper
  //            Engine's media integration; otherwise sound (below)
  //   media  — only a song a player reports as playing
  //   sound  — sound that goes on for 3.5 s (any sound: not every song has
  //            bass; a notification is over before that), then any sound
  //   always / never
  // It turns back after 'returndelay' seconds without any (a pause, a stop,
  // silence), over 'transition' seconds each way.
  // ---------------------------------------------------------------------------
  var music = { time: 0, silence: 99, sure: false };
  var show = { on: false, amount: 0, eased: 0, off: 0, source: '' };

  function updateMusic(dt) {
    if (cfg.audioenabled && audio.state.raw > 0.001) {
      music.time += dt;
      music.silence = 0;
    } else {
      music.silence += dt;
      // Short dips don't break it
      if (music.silence > DIP) music.time = 0;
    }
    music.sure = music.time >= MUSIC_SURE;
  }

  // What keeps the show on right now: 'media', 'sound', 'always' or ''
  function triggerNow() {
    var t = cfg.trigger, m = media.state;
    if (t === 'never') return '';
    if (t === 'always') return 'always';
    var playing = m.enabled && m.playing && !!m.title;
    if (t === 'media' || (t === 'auto' && playing)) return playing ? 'media' : '';
    // Sound with no song reported (a music bot, a browser tab…): it starts
    // after 'soundtime' seconds of it. Without the audio option there is no
    // sound to go by. Once on, the silence counts from its very start (not
    // from the end of a dip)
    if (!cfg.audioenabled) return '';
    return (show.on && show.source === 'sound' ? music.silence <= 0 : music.time >= cfg.soundtime) ? 'sound' : '';
  }

  // The transition's look ('transfx'): 'random' picks another style each time
  var TRANS_STYLES = ['burn', 'ripple', 'pixels', 'glass', 'sweep', 'vortex', 'glitch'];
  var trans = { style: 'burn', seed: 0 };

  function newTransition() {
    var t = cfg.transfx;
    if (t === 'random') {
      var pick;
      do { pick = TRANS_STYLES[(Math.random() * TRANS_STYLES.length) | 0]; } while (pick === trans.style);
      t = pick;
    }
    trans.style = TRANS_STYLES.indexOf(t) >= 0 ? t : 'burn';
    trans.seed = Math.random();
  }

  function updateShow(dt) {
    var wasOn = show.on;
    var src = triggerNow();
    if (src) {
      show.on = true;
      show.off = 0;
      if (src !== show.source) {
        // The song shown depends on what started the show (see songTitle)
        show.source = src;
        albumColors();
        applyCover();
        syncLyrics();
      }
    } else if (show.on) {
      show.off += dt;
      if (show.off >= cfg.returndelay || cfg.trigger === 'never') {
        show.on = false;
        show.source = '';
      }
    }
    if (show.on !== wasOn) newTransition();
    var step = dt / Math.max(0.1, cfg.transition);
    show.amount = show.on ? Math.min(1, show.amount + step) : Math.max(0, show.amount - step);
    show.eased = util.ease(show.amount);
  }

  function mode() {
    return show.amount <= 0 ? 'idle' : show.amount >= 1 ? 'show' : show.on ? 'in' : 'out';
  }

  // ---------------------------------------------------------------------------
  // The song: its clock (songclock.js) and its lyrics (lyrics.js), looked up
  // on every new song while the lyrics are on
  // ---------------------------------------------------------------------------
  var songTrack = -1;      // the song the clock follows (media.state.track)
  var lyricsTrack = -1;    // the song whose lyrics were asked for, -1 = none
  var durSent = false;     // the lookup got the song's duration
  var retried = false, errorAge = 0;
  var pos = 0, line = -1;

  // The clock in use (ms): performance.now(), or a manual one that only
  // step() moves (tests: Lyric.debug.manual)
  var manual = false, vnow = 0, skew = 0;
  function now() { return manual ? vnow : performance.now() + skew; }

  function lyricsWanted() {
    return !!(cfg.lyrics && cfg.trigger !== 'never' && songTitle());
  }

  function loadLyrics(duration) {
    var m = media.state;
    lyrics.load({ title: m.title, artist: m.artist, album: m.album, duration: duration || 0 }, onLyrics);
  }

  function onLyrics() {
    // lyrics.state holds the result; the stage reads it every frame
    errorAge = 0;
  }

  function syncLyrics() {
    if (!lyricsWanted()) {
      if (lyricsTrack !== -1 || lyrics.state.status !== 'off') lyrics.cancel();
      lyricsTrack = -1;
      return;
    }
    if (lyricsTrack === media.state.track) return;
    lyricsTrack = media.state.track;
    retried = false;
    errorAge = 0;
    var tl = media.state.timeline, d = tl.has ? tl.duration : 0;
    durSent = d > 0;
    loadLyrics(d);
  }

  // Wallpaper Engine tells about a pause a moment late, but the audio goes
  // silent at once: the lyrics stop with it (and go on when the sound is back)
  var HUSH = 0.25;     // s of total silence while 'playing' that holds the song's clock
  var hush = false;
  var shownPos = 0, shownTrack = -1, shownOffset = 0;   // the position the lyrics last showed
  var lastLine = -1;       // the line sung last frame (a new one flashes the background)
  var vizBoost = 1;        // the smart visualizer's size, eased (bigger with no line to sing)
  var VIZ_BOOST = 1.7;
  var heard = false;   // this song has been heard (so the audio is really reaching us)

  function clockPlaying() {
    return media.state.playing && !hush;
  }

  function updateHush() {
    if (audio.state.raw >= 0.001) heard = true;
    var h = isWE && heard && cfg.audioenabled && media.state.playing && audio.state.silentFor > HUSH;
    if (h === hush) return;
    hush = h;
    songclock.setPlaying(clockPlaying(), now(), true);
  }

  media.state.onChange = function () {
    var m = media.state, t = now();
    if (m.track !== songTrack) {
      // A new song: its clock starts now (a timeline report may follow)
      songTrack = m.track;
      songclock.reset(t);
      heard = false;
    }
    songclock.setPlaying(clockPlaying(), t);
    albumColors();
    applyCover();
    syncLyrics();
    wake();
  };

  media.state.onTimeline = function (position, duration) {
    songclock.timeline(position, duration, now());
    // The duration picks the right recording: hand it to a lookup still under way
    if (duration > 0 && !durSent && lyricsTrack === media.state.track && lyrics.state.status === 'searching') {
      durSent = true;
      loadLyrics(duration);
    }
  };

  // Wallpaper Engine may have told the song before this script ran
  function seed() {
    var m = media.state, t = now(), tl = m.timeline;
    songTrack = m.track;
    songclock.reset(t);
    songclock.setPlaying(m.playing, t);
    if (tl.has) songclock.timeline(tl.position + (m.playing ? (performance.now() - tl.at) / 1000 : 0), tl.duration, t);
    albumColors();
    applyCover();
    syncLyrics();
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------
  var ss = {     // stage input (reused)
    show: 0, lyricsOn: true, track: 0, title: '', artist: '', cover: '', status: 'off', lines: null, plain: '',
    pos: 0, duration: 0, synced: false, textColor: live.text, accentColor: live.accent, bass: 0, beat: 0
  };
  var gp = {     // background frame (reused)
    time: 0, idle: 'win11', idleMotion: false, show: 0, style: 'aurora', colA: live.A, colB: live.B, colBg: live.bg,
    bass: 0, volume: 0, beat: 0, reactive: 1, particles: true, hasCover: false,
    trans: 'burn', tseed: 0, vc: 0, vasp: 0, viz: 'off', vizSize: 1, bands: new Float32Array(32), peaks: new Float32Array(32)
  };

  function tick(dt) {
    var A = audio.state, m = media.state, L = lyrics.state, t = now();
    time += dt;
    frames++;
    if (demo) demoTick();
    audio.update(dt, cfg.audioenabled, cfg.audiosensitivity);
    updateHush();
    updateMusic(dt);
    updateShow(dt);
    easeColors(dt);
    beat *= Math.exp(-dt * 5);
    themeAge += dt;
    if (themeAge >= THEME_EVERY) updateTheme();

    // A lookup that could not reach the service: once more, later in the song
    if (L.status === 'error' && lyricsTrack === m.track && !retried) {
      errorAge += dt;
      if (errorAge >= RETRY_AFTER) {
        retried = true;
        loadLyrics(songclock.duration());
      }
    }

    var on = cfg.audioenabled, sens = cfg.audiosensitivity;
    var bass = on ? Math.min(1, A.bass * sens) : 0;

    // The song position the lyrics follow ('lyricoffset' > 0: they come later)
    pos = songclock.position(t) - cfg.lyricoffset;
    // The words on screen never go back a little (a small correction waits
    // instead); a real jump (a seek, a new song, a new offset) goes through
    if (m.track === shownTrack && cfg.lyricoffset === shownOffset && pos < shownPos && shownPos - pos < 2.5) pos = shownPos;
    shownPos = pos;
    shownTrack = m.track;
    shownOffset = cfg.lyricoffset;
    line = L.status === 'synced' ? lyrics.lineAt(L.lines, pos) : -1;
    var ln = line >= 0 ? L.lines[line] : null, sung = !!(ln && ln.text && ln.text.trim());
    // A new line to sing: a flash in the background ('lyricbeat')
    if (line !== lastLine) {
      if (sung && cfg.lyricbeat && show.on) beat = Math.max(beat, 0.4);
      lastLine = line;
    }
    // No line to sing (instrumental, before the first line, no lyrics, a show
    // of sound alone): the visualizer takes the stage ('vizsmart')
    var singing = sung && (pos - ln.t < 8 || ln.end - ln.t < 10) && !!songTitle();
    // (not the styles along the bottom while the big song card is up: they would cover it)
    var bottomViz = /^(bars|wave|mirror|led|silk)$/.test(cfg.visualizer);
    var boostAim = cfg.vizsmart && show.on && !singing && !(bottomViz && stage.heroOn()) ? VIZ_BOOST : 1;
    vizBoost += (boostAim - vizBoost) * Math.min(1, dt * 1.5);

    ss.show = show.eased;
    ss.lyricsOn = cfg.lyrics;
    ss.track = m.track;
    ss.title = songTitle();
    ss.mediaOff = isWE && !m.enabled;
    ss.artist = ss.title ? m.artist : '';
    ss.cover = cover.url;
    ss.status = L.status;
    ss.lines = L.lines;
    ss.plain = L.plain;
    ss.pos = pos;
    ss.duration = songclock.duration() || (L.match ? L.match.duration : 0);
    ss.synced = songclock.synced();
    ss.bass = bass;
    ss.beat = on ? beat : 0;
    ss.playing = show.source !== 'media' || clockPlaying();
    stage.update(dt, ss);

    // The background
    if (G === S.gfx && !G.ok()) {
      lost += dt;
      if (lost >= LOST_FOR_GOOD) use2d();
    } else {
      lost = 0;
    }
    gp.time = time;
    gp.idle = curLook;
    gp.idleMotion = cfg.idlemotion;
    gp.show = show.eased;
    gp.style = cfg.bgstyle;
    gp.bass = bass;
    gp.volume = on ? Math.min(1, A.volume * sens) : 0;
    gp.beat = on ? beat : 0;
    gp.reactive = cfg.reactive && on ? cfg.reactiveamt : 0;
    // The chorus: the background reacts harder ('chorus')
    if (cfg.chorus && sung && ln.chorus) gp.reactive *= 1.35;
    gp.particles = cfg.particles;
    gp.trans = cfg.transfx === 'random' ? trans.style : cfg.transfx;
    gp.tseed = trans.seed;
    // The visualizer: the 64 audio bands, two by two (nothing without audio)
    gp.viz = on ? cfg.visualizer : 'off';
    gp.vizSize = cfg.vizsize * vizBoost;
    // and their peaks, which fall slowly (the LED, bar and edge styles)
    for (var vb = 0, AB = A.bands; vb < 32; vb++) {
      var bv = on ? Math.min(1, (AB[vb * 2] + AB[vb * 2 + 1]) * 0.5 * sens) : 0;
      gp.bands[vb] = bv;
      gp.peaks[vb] = Math.max(bv, gp.peaks[vb] - dt * 0.35);
    }
    gp.hasCover = !!cover.ready;
    draw();
  }

  function draw() {
    if (!dirty && !G.needsFrames(gp)) return;
    // Idle motion is slow: it gets at most IDLE_FPS frames. So does the show
    // while nothing reacts to the music (paused, silent, reaction off): only
    // its slow drift moves then. The transitions keep every frame
    var slow = gp.show <= 0.001 || (show.amount >= 1 && (gp.reactive <= 0 || music.silence >= CALM_AFTER));
    if (!dirty && slow && lastRender >= 0 && time - lastRender < 1 / IDLE_FPS - 0.004) return;
    G.render(gp);
    dirty = false;
    lastRender = time;
    renders++;
  }

  var lastTime = performance.now(), lastDraw = 0;
  var rafId = 0, dozeId = 0, paused = false;

  function frame(ms) {
    rafId = requestAnimationFrame(frame);
    if (fpsLimit > 0) {
      var gap = 1000 / fpsLimit;
      if (ms - lastDraw < gap - 1) return;
      // Step by the frame gap instead of jumping to now: on a 75 or 144 Hz
      // display a 60 FPS limit then averages 60 instead of 37 or 48
      lastDraw += gap;
      if (ms - lastDraw > gap) lastDraw = ms;
    }
    var dt = Math.min((ms - lastTime) / 1000, 0.1);
    lastTime = ms;
    tick(dt > 0 ? dt : 0);
    if (still()) {
      cancelAnimationFrame(rafId);
      rafId = 0;
      dozeId = setTimeout(doze, DOZE_MS);
    }
  }

  // Nothing moves and nothing is about to: the idle wallpaper without motion,
  // already drawn. Then the loop dozes: no frames, only a few checks a second
  // (enough for the sound that starts the show and for a lost WebGL context)
  function still() {
    return !paused && !manual && !demo && !show.on && show.amount <= 0 && !dirty && !G.needsFrames(gp);
  }

  function doze() {
    dozeId = 0;
    var ms = performance.now(), dt = Math.min((ms - lastTime) / 1000, 0.25);
    lastTime = ms;
    tick(dt > 0 ? dt : 0);
    if (still()) dozeId = setTimeout(doze, DOZE_MS);
    else if (!paused && !manual && !rafId) rafId = requestAnimationFrame(frame);
  }

  // Something changed (a song, a setting, a picture): frames again at once
  function wake() {
    if (!dozeId) return;
    clearTimeout(dozeId);
    dozeId = 0;
    if (!paused && !manual && !rafId) rafId = requestAnimationFrame(frame);
  }

  // A beat: the background and the current line flash, fading quickly
  audio.state.onBeat = function (strength) {
    beat = Math.max(beat, Math.min(1, strength));
  };

  // ---------------------------------------------------------------------------
  // Demo: a made-up song played end to end without a player (console:
  // Lyric.debug.demo()). The media events are faked, and so is lrclib.net,
  // which answers with the invented lines below. Never real lyrics here.
  // ---------------------------------------------------------------------------
  var DEMO_LRC = [
    '[00:06.00]First demo line, made up for testing',
    '[00:10.00]The second line comes in right on time',
    '[00:14.00]Every word on this stage is invented',
    '[00:18.50]Colors follow the cover while it plays',
    '[00:23.00]A quiet break is coming up next',
    '[00:27.00]',
    '[00:36.00]Back again after the little break',
    '[00:40.00]Every word on this stage is invented',   // comes back: the chorus
    '[00:44.50]A longer line wraps onto two rows when it has to and shrinks to fit the screen',
    '[00:51.00]The last invented line before the end'
  ].join('\n');

  var demo = null;
  var demoBands = new Float32Array(audio.BANDS * 2);

  // An invented cover: a gradient in the demo colors
  function demoCover(c) {
    try {
      var cv = document.createElement('canvas');
      cv.width = cv.height = 128;
      var x = cv.getContext('2d'), g = x.createLinearGradient(0, 0, 128, 128);
      g.addColorStop(0, c[0]);
      g.addColorStop(1, c[1]);
      x.fillStyle = g;
      x.fillRect(0, 0, 128, 128);
      x.fillStyle = c[2];
      x.beginPath();
      x.arc(84, 46, 26, 0, Math.PI * 2);
      x.fill();
      return cv.toDataURL('image/png');
    } catch (e) {
      return '';
    }
  }

  // The LRC with a stamp before each word (enhanced LRC), spread over each line
  function demoWords(lrc) {
    var rows = lrc.split('\n'), times = rows.map(function (r) {
      var m = /^\[(\d+):(\d+(?:\.\d+)?)\]/.exec(r);
      return m ? +m[1] * 60 + +m[2] : 0;
    });
    function stamp(t) {
      var mm = Math.floor(t / 60), s = t - mm * 60;
      return (mm < 10 ? '0' : '') + mm + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
    }
    return rows.map(function (r, i) {
      var m = /^(\[[^\]]+\])(.*)$/.exec(r);
      if (!m || !m[2].trim()) return r;
      var words = m[2].trim().split(/\s+/), t0 = times[i];
      var span = Math.min(i + 1 < times.length ? times[i + 1] - t0 : 4, 6) * 0.8;
      return m[1] + words.map(function (w, k) { return '<' + stamp(t0 + span * k / words.length) + '>' + w; }).join(' ');
    }).join('\n');
  }

  function demoResponse(code, data) {
    return {
      ok: code >= 200 && code < 300,
      status: code,
      headers: { get: function () { return null; } },
      json: function () { return Promise.resolve(data); }
    };
  }

  function demoPos() {
    var d = demo;
    return d.playing ? d.pos + (now() - d.at) / 1000 : d.pos;
  }

  function demoReport() {
    var d = demo;
    d.reported = now();
    if (d.timeline) media.setTimeline({ position: Math.min(demoPos(), d.duration), duration: d.duration });
  }

  function demoPlay(playing) {
    var d = demo;
    if (!d || d.playing === playing) return;
    d.pos = demoPos();
    d.at = now();
    d.playing = playing;
    media.setPlayback({ state: playing ? 1 : 2 });
    demoReport();
  }

  // opts: title, artist, album, duration (s), lrc (invented!), words (word
  // stamps), at (start position, s), timeline (false: a player that does not
  // report the position), audio (false: no fake beat), colors (3 CSS colors),
  // cover (false: none), found (false: lrclib.net has no lyrics for it)
  function startDemo(opts) {
    var o = opts || {};
    stopDemo();
    var colors = o.colors || ['#ff4f7b', '#7b5cff', '#1b1036'];
    var lrc = o.lrc || DEMO_LRC;
    if (o.words) lrc = demoWords(lrc);
    var d = demo = {
      title: o.title || 'Invented Demo Song', artist: o.artist || 'The Placeholder Band',
      album: o.album || 'Test Pattern', duration: +o.duration || 60,
      timeline: o.timeline !== false, audio: o.audio !== false,
      pos: +o.at || 0, at: now(), playing: true, reported: 0, fetch: lyrics.fetch
    };
    var item = {
      id: 1, trackName: d.title, artistName: d.artist, albumName: d.album, duration: d.duration, instrumental: false,
      plainLyrics: lyrics.parseLRC(lrc).lines.map(function (l) { return l.text; }).join('\n'), syncedLyrics: lrc
    };
    var want = d.title.toLowerCase();
    lyrics.fetch = function (url) {
      var u = new URL(url), name = (u.searchParams.get('track_name') || u.searchParams.get('q') || '').toLowerCase();
      var hit = o.found !== false && name.indexOf(want) >= 0, isGet = /\/get$/.test(u.pathname);
      return Promise.resolve(isGet ? demoResponse(hit ? 200 : 404, hit ? item : { code: 404 }) : demoResponse(200, hit ? [item] : []));
    };
    media.setStatus({ enabled: true });
    // The same song again is a new song (its lyrics are looked up again)
    if (media.state.title === d.title) media.setProperties({ title: '', artist: '' });
    media.setProperties({ title: d.title, artist: d.artist, albumTitle: d.album });
    media.setThumbnail(o.cover === false ? { thumbnail: '' } : {
      thumbnail: demoCover(colors), primaryColor: colors[0], secondaryColor: colors[1], tertiaryColor: colors[2]
    });
    media.setPlayback({ state: 1 });
    demoReport();
    return {
      pause: function () { demoPlay(false); },
      play: function () { demoPlay(true); },
      seek: function (s) {
        if (demo !== d) return;
        d.pos = Math.max(0, +s || 0);
        d.at = now();
        demoReport();
      },
      position: function () { return demo === d ? demoPos() : 0; },
      stop: function () { if (demo === d) stopDemo(); }
    };
  }

  // Per frame: the song moves on (and ends), the player reports where it is
  // every 2 s, and a fake beat plays (120 BPM)
  function demoTick() {
    var d = demo, p = demoPos(), i;
    if (d.playing && p >= d.duration) {
      demoPlay(false);
      p = demoPos();
    }
    if (d.playing && now() - d.reported >= 2000) demoReport();
    if (!d.audio) return;
    var kick = d.playing ? Math.exp(-(p % 0.5) / 0.5 * 8) : 0;
    var hat = (p * 4) % 1 < 0.2 ? 1 : 0.3, n = audio.BANDS;
    for (i = 0; i < n; i++) {
      var v = !d.playing ? 0 : i < 6 ? 0.06 + 0.8 * kick : i < 40 ? 0.22 + 0.08 * Math.sin(p * 1.7 + i * 0.4) : 0.1 * hat;
      demoBands[i] = demoBands[i + n] = v;
    }
    audio.feed(demoBands);
  }

  // The player stops (the show turns back after the pause setting)
  function stopDemo() {
    var d = demo;
    if (!d) return;
    lyrics.fetch = d.fetch;
    demo = null;
    media.setPlayback({ state: 0 });
    for (var i = 0; i < demoBands.length; i++) demoBands[i] = 0;
    audio.feed(demoBands);
  }

  // ---------------------------------------------------------------------------
  // Integration: Wallpaper Engine and the menu
  // ---------------------------------------------------------------------------
  function commit() {
    refresh();
    save();
    menu.sync();
  }

  function applyPreset(id) {
    if (isWE) return; // in WE the theme is a layer (see resolve)
    var pv = settings.presetValues(id);
    SCHEMA.forEach(function (s) {
      if (s.look) raw[s.key] = s.key in pv ? pv[s.key] : s.def;
    });
  }

  window.wallpaperPropertyListener = {
    applyUserProperties: function (props) {
      Object.keys(props).forEach(function (k) {
        if (!(k in raw)) return;
        // 'idleimage' (a file property) is a local path: applyImage turns it into a URL
        raw[k] = props[k].value;
        if (k === 'importcode') imported = settings.decode(props[k].value) || {};
      });
      commit();
    },
    applyGeneralProperties: function (props) {
      if (props.fps !== undefined) fpsLimit = Number(props.fps) || 0;
      // Used by the automatic language when Wallpaper Engine reports it
      if (props.language !== undefined) {
        weLang = props.language;
        commit();
      }
    },
    // Wallpaper Engine pauses the wallpaper when it is covered: stop all work
    // until it resumes (the song clock goes by the real time, so the lyrics
    // are still in place afterwards)
    setPaused: setPaused
  };

  function setPaused(value) {
    value = !!value;
    if (value === paused) return;
    paused = value;
    if (value) {
      cancelAnimationFrame(rafId);
      clearTimeout(dozeId);
      rafId = dozeId = 0;
    } else {
      lastTime = performance.now();   // no jump after the pause
      if (!rafId && !manual) rafId = requestAnimationFrame(frame);
    }
  }

  var app = {
    isWE: isWE,
    audio: audio,
    getValues: function () { return raw; },
    setValue: function (k, v) {
      var s = settings.BY_KEY[k];
      if (!s) return;
      raw[k] = v;
      if (k === 'preset') applyPreset(v);
      else if (!isWE && s.look) raw.preset = 'custom';
      commit();
    },
    reset: function () {
      raw = settings.defaults();
      imported = {};
      commit();
    },
    exportCode: function () {
      var out = {};
      SCHEMA.forEach(function (s) {
        var k = s.key;
        // The image is a path on this PC: not part of a shared code
        if (k !== 'preset' && k !== 'importcode' && k !== 'idleimage' && !settings.equal(eff[k], s.def)) out[k] = eff[k];
      });
      return settings.encode(out);
    },
    importCode: function (str) {
      var vals = settings.decode(str);
      if (!vals) return false;
      if (isWE) {
        imported = vals;
      } else {
        raw = settings.defaults();
        Object.keys(vals).forEach(function (k) { raw[k] = vals[k]; });
        if (Object.keys(vals).some(function (k) { return settings.BY_KEY[k].look; })) raw.preset = 'custom';
      }
      commit();
      return true;
    }
  };

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layout, 150);
  });

  // ---------------------------------------------------------------------------
  // Startup
  // ---------------------------------------------------------------------------
  // WebGL2, or Canvas 2D on a fresh canvas when it fails
  if (S.gfx.init(canvas) && S.gfx.ok()) {
    G = S.gfx;
    rendererName = 'webgl2';
  } else {
    use2d();
  }

  stage.init(document.getElementById('ls-stage'));
  if (!isWE) loadSaved();
  refresh();
  seed();
  menu.init(app);
  if (!isWE) menu.toast(i18n.t('toast.open'), 3500);
  rafId = requestAnimationFrame(frame);

  // Console access for debugging and tests
  S.app = app;
  S.debug = {
    cfg: cfg,
    effective: function () { return eff; },
    renderer: function () { return rendererName; },
    size: function () { return { W: W, H: H }; },
    relayout: function () { layout(); },
    // Stops (true) or restarts (false) the automatic frames: then only
    // step() moves the wallpaper, and the song clock with it (deterministic
    // tests and screenshots)
    manual: function (on) {
      on = !!on;
      if (on === manual) return;
      if (on) {
        vnow = now();
        manual = true;
        cancelAnimationFrame(rafId);
        clearTimeout(dozeId);
        rafId = dozeId = 0;
      } else {
        // The clock never runs backwards
        skew = Math.max(skew, vnow - performance.now());
        manual = false;
        lastTime = performance.now();
        if (!paused && !rafId) rafId = requestAnimationFrame(frame);
      }
    },
    // One frame of dt seconds, drawn now
    step: function (dt) {
      dt = +dt || 0;
      if (manual) vnow += dt * 1000;
      tick(dt);
    },
    // What shows now
    gfxParams: function () { return gp; },
    transition: function () { return trans; },
    state: function () {
      var L = lyrics.state;
      return {
        mode: mode(), show: show.eased, amount: show.amount, on: show.on, source: show.source, off: show.off,
        idle: curLook, image: image.state,
        track: media.state.track, title: media.state.title, playing: media.state.playing,
        lyrics: L.status, lines: L.lines.length, line: line, text: line >= 0 ? L.lines[line].text : '',
        pos: pos, synced: songclock.synced(), duration: ss.duration,
        cover: !!cover.ready, renders: renders, frames: frames, paused: paused, manual: manual,
        loop: !!(rafId || dozeId), dozing: !!dozeId,
        fps: fpsLimit, music: music.sure, demo: !!demo
      };
    },
    now: now,
    live: live,
    music: music,
    // Fakes a song end to end (media events and lrclib.net, invented lines):
    // returns { pause(), play(), seek(s), position(), stop() }
    demo: startDemo
  };
})(window.Lyric);
