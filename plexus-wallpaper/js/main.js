/*
 * Neural Plexus — core: settings, camera, interaction, audio, formations and
 * the render loop.
 *
 * Per frame: colors (album cover, audio) → camera (slow sway, mouse
 * parallax, hyperspeed) → the nodes move (drift, cursor, singularity,
 * shockwaves, formations) → projection → connections and triangles →
 * signals → scene buffers → renderer (WebGL2, or Canvas 2D without it).
 */
(function (S) {
  'use strict';

  var util = S.util, settings = S.settings, audio = S.audio, i18n = S.i18n;
  var net = S.net, shapes = S.shapes, pclock = S.pclock, scene = S.scene, clock = S.clock, menu = S.menu, media = S.media;
  var SCHEMA = settings.SCHEMA;
  var clamp = util.clamp;
  var isWE = audio.state.source === 'we';
  var STORAGE_KEY = 'neural-plexus-settings';
  var MAX_DEG = 12;           // most connections per node
  var CLOCK_NODES = 110;      // extra nodes while the network draws the clock
  var HOLD_MS = 320;          // a press this long (or a drag) is a singularity

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  var raw = settings.defaults();   // values as received from WE / the menu
  var imported = {};               // imported-code layer (WE only)
  var eff = null;                  // effective values (WE format)
  var cfg = {};                    // typed + derived values
  var fpsLimit = 0;
  var weLang = null;               // UI language reported by Wallpaper Engine, if any

  var canvas = document.getElementById('px-canvas');
  var renderer = null, rendererName = '';

  var W = 0, H = 0, unit = 1, pxPerCss = 1, area = 1;
  var regions = [];                // screens, in canvas px: { x0, w }
  var time = 0, flash = 0, kick = 0, spont = 0, focus = 0;
  var mouse = { x: 0, y: 0, inside: false };
  var cam = { x: 0, y: 0 };

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
    cfg.rgbA = util.parseColor(cfg.nodecolor);
    cfg.rgbB = util.parseColor(cfg.color2);
    cfg.rgbP = util.parseColor(cfg.pulsecolor);
    var hsl = util.rgbToHsl(cfg.rgbA);
    cfg.hue = hsl[0];
    cfg.sat = hsl[1];
    // The background: a very dark shade of the main color, or the custom one
    cfg.bgRGB = cfg.custombg
      ? util.parseColor(cfg.bgcolor)
      : util.hslToRgb(cfg.hue, Math.min(0.55, cfg.sat / 100 * 0.6), 0.045).map(function (v) { return v / 255; });
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
    // A new frequency counts from now (not after the old, longer wait)
    var freqChanged = !first && Number(eff.shapefreq) !== Number(next.shapefreq);
    eff = next;
    derive();
    menu.setTheme(cfg);
    if (freqChanged) nextShapeTime();

    // Language: explicit setting, or automatic (WE language, then the system's)
    var lang = i18n.resolve(cfg.language, weLang);
    if (first || lang !== i18n.lang()) {
      i18n.setLang(lang);
      fx.clock = true;
      if (!first) menu.relabel();
    }

    if (fx.layout) layout();
    if (fx.layout || fx.clock || fx.color) applyClock();
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
  // Layout
  // ---------------------------------------------------------------------------
  function screenCount() {
    if (cfg.screens === 'auto') return clamp(Math.round(W / H / (16 / 9)), 1, 4);
    return clamp(parseInt(cfg.screens, 10) || 1, 1, 4);
  }

  function layout() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2), q = Number(cfg.quality) || 1;
    var cw = Math.max(1, window.innerWidth), ch = Math.max(1, window.innerHeight);
    W = Math.max(1, Math.round(cw * dpr * q));
    H = Math.max(1, Math.round(ch * dpr * q));
    pxPerCss = W / cw;
    canvas.width = W;
    canvas.height = H;
    unit = H / 1080;
    // Sizes follow the screen height, so the count is per 16:9 screen (a
    // wider span of monitors gets more)
    area = clamp(cw / ch / (16 / 9), 0.3, 4);
    // The particle clock brings its own nodes, so the network stays as dense
    var reserve = particleClock() ? CLOCK_NODES : 0;
    net.layout(clamp(Math.round(cfg.nodecount * area), 12, 2400) + reserve, W, H, cfg.depth, unit, cfg.linkdist * unit);
    scene.layoutDust(Math.round(220 * area));
    shapes.clear();
    pclock.clear();
    clockSec = -1;
    shocks.length = 0;
    sing.on = false;

    var n = screenCount(), rw = W / n;
    regions = [];
    for (var i = 0; i < n; i++) regions.push({ x0: i * rw, w: rw });
  }

  function applyClock() {
    if (!regions.length) return;
    var r = regions[clamp(Math.round(cfg.clockscreen), 1, regions.length) - 1];
    clock.apply(cfg, { left: r.x0 / pxPerCss, width: r.w / pxPerCss });
  }

  // ---------------------------------------------------------------------------
  // Colors: the theme's, drifting to the album cover's while a song plays
  // (Wallpaper Engine media integration), shifted by the audio
  // ---------------------------------------------------------------------------
  var live = { A: [0, 0, 0], B: [0, 0, 0], P: [0, 0, 0], bg: [0, 0, 0] };
  var album = null;        // target colors of the cover: { A, B, P, bg }
  var albumCur = null;     // the same, eased
  var mediaMix = 0, mediaStopped = 99;

  function hslRGB(h, s, l) {
    return util.hslToRgb(h, clamp(s, 0, 100) / 100, clamp(l, 0, 100) / 100).map(function (v) { return v / 255; });
  }

  function albumColors() {
    var pal = media.state.palette;
    if (!pal) { album = null; return; }
    var hue2 = pal.hue2 !== null ? pal.hue2 : pal.hue + 45;
    album = {
      A: hslRGB(pal.hue, Math.max(pal.sat, 55), clamp(pal.light, 45, 62)),
      B: hslRGB(hue2, Math.max(pal.sat, 50), 50),
      P: hslRGB(pal.hue, 70, 86),
      bg: hslRGB(pal.hue, Math.min(55, pal.sat * 0.6), 4.5)
    };
    if (!albumCur) albumCur = { A: album.A.slice(), B: album.B.slice(), P: album.P.slice(), bg: album.bg.slice() };
  }

  function ease(cur, to, k) {
    cur[0] += (to[0] - cur[0]) * k;
    cur[1] += (to[1] - cur[1]) * k;
    cur[2] += (to[2] - cur[2]) * k;
  }

  function mixInto(dst, a, b, k) {
    dst[0] = a[0] + (b[0] - a[0]) * k;
    dst[1] = a[1] + (b[1] - a[1]) * k;
    dst[2] = a[2] + (b[2] - a[2]) * k;
  }

  // Hue rotation about the grey axis (the CSS hue-rotate matrix), in place
  function hueRotate(c, deg) {
    var a = deg * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a), r = c[0], g = c[1], b = c[2];
    c[0] = clamp(r * (0.213 + 0.787 * cs - 0.213 * sn) + g * (0.715 - 0.715 * cs - 0.715 * sn) + b * (0.072 - 0.072 * cs + 0.928 * sn), 0, 1);
    c[1] = clamp(r * (0.213 - 0.213 * cs + 0.143 * sn) + g * (0.715 + 0.285 * cs + 0.140 * sn) + b * (0.072 - 0.072 * cs - 0.283 * sn), 0, 1);
    c[2] = clamp(r * (0.213 - 0.213 * cs - 0.787 * sn) + g * (0.715 - 0.715 * cs + 0.715 * sn) + b * (0.072 + 0.928 * cs + 0.072 * sn), 0, 1);
  }

  function updateColors(dt, hueShift) {
    var m = media.state;
    mediaStopped = m.playing ? 0 : mediaStopped + dt;
    var target = cfg.mediacolors && m.enabled && album && mediaStopped < 4 ? 1 : 0;
    mediaMix += (target - mediaMix) * (1 - Math.exp(-dt * (target ? 1.2 : 0.7)));
    if (album && albumCur) {
      var k = 1 - Math.exp(-dt * 1.5);
      ease(albumCur.A, album.A, k);
      ease(albumCur.B, album.B, k);
      ease(albumCur.P, album.P, k);
      ease(albumCur.bg, album.bg, k);
    }
    var mk = albumCur && mediaMix > 0.002 ? mediaMix : 0;
    mixInto(live.A, cfg.rgbA, mk ? albumCur.A : cfg.rgbA, mk);
    mixInto(live.B, cfg.rgbB, mk ? albumCur.B : cfg.rgbB, mk);
    mixInto(live.P, cfg.rgbP, mk ? albumCur.P : cfg.rgbP, mk);
    mixInto(live.bg, cfg.bgRGB, mk && !cfg.custombg ? albumCur.bg : cfg.bgRGB, mk);
    if (Math.abs(hueShift) > 0.5) {
      hueRotate(live.A, hueShift);
      hueRotate(live.B, hueShift);
      hueRotate(live.P, hueShift * 0.5);
    }
  }

  media.state.onChange = function () {
    albumColors();
    clock.setSong(media.state);
  };

  // ---------------------------------------------------------------------------
  // Shockwaves: rings that push the nodes, light them up and bend space
  // ---------------------------------------------------------------------------
  var shocks = [];
  var SHOCK_MAX = 4;

  // surge (optional): the nodes the ring passes within `reach` of the center
  // release overcharged runners with that charge (hops)
  function addShock(x, y, power, surge, reach, charge) {
    if (shocks.length >= SHOCK_MAX) shocks.shift();
    shocks.push({ x: x, y: y, t: 0, power: power, life: 1.7 + 0.4 * power, surge: surge || 0, reach: reach || 0, charge: charge || 0 });
  }

  // Hops of an overcharged runner
  function surgeCharge() { return Math.max(3, Math.round((5 + 3 * cfg.signalreach) * cfg.surgeamt)); }

  function updateShocks(dt) {
    for (var i = shocks.length - 1; i >= 0; i--) {
      var s = shocks[i];
      s.t += dt;
      if (s.t >= s.life) { shocks.splice(i, 1); continue; }
      var fade = 1 - s.t / s.life;
      s.r = H * (0.85 + 0.25 * s.power) * (1 - Math.pow(1 - s.t / s.life, 1.8));
      s.fade = fade;
      net.shock(s.x, s.y, s.r, H * 0.035, 1100 * unit * s.power * fade, dt, s.surge, s.reach, s.charge);
    }
  }

  // ---------------------------------------------------------------------------
  // Singularity: hold (or drag) to pull the network into a whirl; release and
  // it explodes outward with a chain reaction through everything it touches
  // ---------------------------------------------------------------------------
  var press = null;   // { x, y, t, hold }
  var sing = { on: false, x: 0, y: 0, t: 0, charge: 0, R: 0, crackle: 0 };

  function beginHold() {
    press.hold = true;
    sing.on = true;
    sing.x = press.x;
    sing.y = press.y;
    sing.t = 0;
    sing.charge = 0;
  }

  function updateSingularity(dt) {
    if (!sing.on) return;
    sing.t += dt;
    sing.charge = Math.min(1, sing.t / 3);
    var k = 1 - Math.exp(-dt * 8);
    sing.x += (mouse.x - sing.x) * k;
    sing.y += (mouse.y - sing.y) * k;
    sing.R = H * (0.16 + 0.3 * sing.charge);
    var amt = cfg.singularityamt;
    net.vortex(sing.x, sing.y, sing.R, 1500 * unit * amt * (0.4 + 0.6 * sing.charge), 950 * unit * amt, dt);
    // The knot crackles with signals
    sing.crackle += dt * 9 * sing.charge;
    while (sing.crackle >= 1) {
      sing.crackle -= 1;
      var i = net.nearest(sing.x + (Math.random() - 0.5) * sing.R * 0.4, sing.y + (Math.random() - 0.5) * sing.R * 0.4, sing.R * 0.3);
      if (i >= 0) {
        net.a().HEAT[i] = 1;
        net.fire(i, 0.3, -1);
      }
    }
  }

  function releaseSingularity() {
    if (!sing.on) return;
    sing.on = false;
    var c = sing.charge, amt = cfg.singularityamt;
    net.burst(sing.x, sing.y, sing.R * 1.3, (280 + 420 * c) * unit * amt);
    // All that energy bursts out through the network
    addShock(sing.x, sing.y, 0.9 + 1.4 * c, net.newSurge(), sing.R * (0.35 + 0.35 * c), surgeCharge() + 2);
    flash = Math.max(flash, 0.05 + 0.08 * c);
  }

  // A click: a shockwave that overcharges the nodes around, which release
  // runners through the network
  function clickFire(x, y) {
    if (!cfg.clickfire) return;
    addShock(x, y, 0.7, net.newSurge(), H * 0.18, surgeCharge());
  }

  function endPress() {
    if (!press) return;
    if (press.hold) releaseSingularity();
    else clickFire(press.x, press.y);
    press = null;
  }

  function updatePointer(now) {
    if (press && !press.hold && cfg.singularity && now - press.t > HOLD_MS) beginHold();
  }

  // ---------------------------------------------------------------------------
  // The particle clock (the "Particles" clock font, pclock.js): the network
  // draws the time where the clock is. Around the turn of the hour (6 s
  // before to 6 s after) it goes big to the middle of its screen, with more
  // nodes, while no formation may start; at the turn, a pulse overcharges it.
  // ---------------------------------------------------------------------------
  var HOUR_LEAD = 6, HOUR_STAY = 6;
  var timeShift = 0, tzOff = 0, tzAt = -1e15;   // timeShift: tests only
  var clockSec = -1, clockHour = -1, clockHD = false;
  var pcOpt = { text: '', secs: '', hd: false, bottom: false, box: { left: 0, top: 0, width: 0, height: 0 }, align: 'center', area: null, H: 0 };

  function particleClock() { return !!(cfg.clock && cfg.clockfont === 'particles'); }

  // Local time in ms (the time zone offset is read once a minute)
  function localNow() {
    var n = Date.now() + timeShift;
    if (Math.abs(n - tzAt) > 60000) {
      tzAt = n;
      tzOff = new Date(n).getTimezoneOffset() * 60000;
    }
    return n - tzOff;
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  // Whether the clock is (about to be) at the turn of the hour; pulses on it
  function hourState() {
    if (!particleClock() || !cfg.clockhour) {
      clockHD = false;
      return;
    }
    var s = Math.floor(localNow() / 1000), inHour = s % 3600, hour = Math.floor(s / 3600);
    var hd = inHour >= 3600 - HOUR_LEAD || inHour < HOUR_STAY;
    if (hd && clockHour >= 0 && hour !== clockHour && pclock.active()) {
      var c = pclock.center();
      addShock(c.x, c.y, 1.1, net.newSurge(), H * 0.3, surgeCharge() + 3);
      flash = Math.max(flash, 0.06);
    }
    clockHour = hour;
    clockHD = hd;
  }

  function updateParticleClock(dt, bass) {
    if (!particleClock()) {
      if (pclock.active()) pclock.release();
      clock.setAside(false);
      return;
    }
    clock.setAside(clockHD);
    var s = Math.floor(localNow() / 1000);
    if (s !== clockSec || !pclock.active()) {
      // Once a second: the time, and where it goes
      clockSec = s;
      var hh = Math.floor(s / 3600) % 24, mm = Math.floor(s / 60) % 60, twelve = cfg.clockformat === '12';
      if (twelve) hh = hh % 12 || 12;
      pcOpt.text = (twelve ? String(hh) : pad2(hh)) + ':' + pad2(mm);
      pcOpt.secs = cfg.clockseconds ? pad2(s % 60) : '';
      pcOpt.hd = clockHD;
      pcOpt.bottom = clockHD && shapes.kind() === 'visualizer';
      pcOpt.H = H;
      pcOpt.area = regions[clamp(Math.round(cfg.clockscreen), 1, regions.length) - 1];
      var box = clock.timeBox();
      if (box) {
        pcOpt.box.left = box.left * pxPerCss;
        pcOpt.box.top = box.top * pxPerCss;
        pcOpt.box.width = box.width * pxPerCss;
        pcOpt.box.height = box.height * pxPerCss;
      }
      pcOpt.align = /left$/.test(cfg.clockpos) ? 'left' : /right$/.test(cfg.clockpos) ? 'right' : 'center';
      if (box || clockHD) pclock.set(pcOpt);
    }
    pclock.update(dt, cfg.clockpulse && cfg.audioenabled ? 1 + bass * 0.06 : 1);
  }

  // ---------------------------------------------------------------------------
  // Hyperspeed: on the drop of a song the camera flies through the network
  // ---------------------------------------------------------------------------
  var FLY_IN = 0.5, FLY_HOLD = 1.8, FLY_OUT = 1.6;
  var fly = { t: -1, level: 0, fired: false, x: 0, y: 0 };

  function smooth(x) {
    x = x < 0 ? 0 : x > 1 ? 1 : x;
    return x * x * (3 - 2 * x);
  }

  function startFlight() {
    if (fly.t >= 0) return false;
    fly.t = 0;
    fly.fired = false;
    return true;
  }

  function updateFlight(dt) {
    if (fly.t < 0) { fly.level = 0; return; }
    fly.t += dt;
    var t = fly.t;
    if (t < FLY_IN) {
      fly.level = smooth(t / FLY_IN);
    } else if (t < FLY_IN + FLY_HOLD) {
      fly.level = 1;
      if (!fly.fired) {
        // Full speed: the whole network lights up from the middle
        fly.fired = true;
        flash = Math.max(flash, 0.1);
        var i = net.nearest(W / 2, H / 2);
        if (i >= 0) net.fire(i, 1.2, -1);
      }
    } else if (t < FLY_IN + FLY_HOLD + FLY_OUT) {
      fly.level = 1 - smooth((t - FLY_IN - FLY_HOLD) / FLY_OUT);
    } else {
      fly.t = -1;
      fly.level = 0;
      // Landing: the shockwave hits a random spot, like the strong bass hits
      var k = beatSpot(true), A = net.a();
      fly.x = k >= 0 ? A.SX[k] : W / 2;
      fly.y = k >= 0 ? A.SY[k] : H / 2;
      if (k >= 0) {
        surgeX = fly.x;
        surgeY = fly.y;
      }
      addShock(fly.x, fly.y, 1.2);
    }
  }

  // ---------------------------------------------------------------------------
  // Formations
  // ---------------------------------------------------------------------------
  var shapeTimer = 25 + Math.random() * 25, lastShape = null, shapeCount = 0;

  function nextShapeTime() {
    shapeTimer = Math.max(20, cfg.shapefreq * 60 * (0.6 + Math.random() * 0.8));
  }

  function startShape(kind) {
    if (!kind) {
      var list = shapes.KINDS.filter(function (k) { return k !== lastShape; });
      kind = cfg.shapeclock && !particleClock() && lastShape !== 'clock' && Math.random() < 0.25
        ? 'clock' : list[(Math.random() * list.length) | 0];
    }
    var r = kind === 'clock'
      ? regions[clamp(Math.round(cfg.clockscreen), 1, regions.length) - 1]
      : regions[(Math.random() * regions.length) | 0];
    var ok = shapes.start({
      kind: kind, W: r.w, H: H, L: cfg.linkdist * unit, size: cfg.shapesize, hold: cfg.shapehold,
      cx: r.x0 + r.w / 2, twelve: cfg.clockformat === '12'
    });
    if (ok) {
      lastShape = kind;
      shapeCount++;
    } else {
      shapeTimer = 30;
    }
    return ok;
  }

  // ---------------------------------------------------------------------------
  // Sound that goes on for 3.5 s (any sound: not every song has bass; a
  // notification sound is over before that) turns the network into an audio
  // visualizer (shapes.js). It stays one as long as there is sound: quiet
  // passages and the gap between two songs don't end it, only 4 s of silence
  // do. When a formation's time comes, the visualizer turns into it (dancing
  // to the music) and comes back after it. At the turn of the hour it rises
  // and the big clock goes below it.
  // ---------------------------------------------------------------------------
  var MUSIC_SURE = 3.5, VIZ_SILENCE = 4;
  var music = { time: 0, silence: 99, sure: false };
  var vizCool = 0, vizCount = 0, vizForced = false;   // forced: shown from the console

  function updateMusic(dt) {
    var A = audio.state;
    if (cfg.audioenabled && A.raw > 0.001) {
      music.time += dt;
      music.silence = 0;
    } else {
      music.silence += dt;
      // Short dips don't break it
      if (music.silence > 0.6) music.time = 0;
    }
    music.sure = music.time >= MUSIC_SURE;
  }

  function vizWanted() {
    return cfg.audioenabled && cfg.visualizer && music.sure && vizCool <= 0 && !clockHD && !sing.on && fly.t < 0;
  }

  function startViz() {
    var r = regions[clamp(Math.round(cfg.clockscreen), 1, regions.length) - 1];
    if (shapes.start({
      kind: 'visualizer', W: r.w, H: H, L: cfg.linkdist * unit, size: cfg.shapesize, hold: Infinity,
      cx: r.x0 + r.w / 2, style: cfg.vizstyle === 'alternate' ? (vizCount % 2 ? 'tunnel' : 'terrain') : cfg.vizstyle
    })) {
      vizCount++;
      shapeCount++;
    } else {
      vizCool = 30;
    }
  }

  var shapeOpt = { time: 0, bands: null, unit: 1, signals: true };
  function updateShapes(dt) {
    updateMusic(dt);
    if (vizCool > 0) vizCool -= dt;
    var viz = shapes.kind() === 'visualizer';
    if (!viz) vizForced = false;
    // A style picked in the menu shows at once
    if (viz && cfg.vizstyle !== 'alternate' && shapes.vizStyle() !== cfg.vizstyle) {
      shapes.release(unit);
      viz = false;
    }
    if (viz && (!cfg.visualizer || (!vizForced && (!cfg.audioenabled || music.silence > VIZ_SILENCE)))) {
      // The music stopped: back to the network (it comes again with the next
      // few seconds of sound)
      shapes.release(unit);
      viz = false;
      nextShapeTime();
    } else if (clockHD) {
      // The turn of the hour: no formation; the visualizer stays, raised
      if (shapes.active() && !viz) shapes.release(unit);
    } else if (!cfg.shapes && !viz) {
      if (shapes.active()) shapes.release(unit);
    } else if (cfg.shapes && (!shapes.active() || viz) && !sing.on && fly.t < 0) {
      // A formation's time comes with or without the visualizer (which turns
      // into it)
      shapeTimer -= dt;
      if (shapeTimer <= 0) {
        nextShapeTime();
        if (viz) shapes.release(unit);
        startShape();
        viz = false;
      }
    }
    // The visualizer whenever nothing else is on
    if (!shapes.active() && vizWanted()) startViz();
    viz = shapes.kind() === 'visualizer';
    shapes.setReactive(cfg.audioenabled && music.sure);
    shapes.setLift(viz && clockHD ? 1 : 0);

    shapeOpt.time = time;
    shapeOpt.bands = cfg.audioenabled ? audio.state.bands : null;
    shapeOpt.unit = unit;
    shapeOpt.signals = cfg.signals;
    var ev = shapes.update(dt, shapeOpt);
    if (ev === 'hold') addShock(shapes.centerX(), H / 2, 0.35);
    else if (ev === 'release') nextShapeTime();   // it dissolves quietly (net.ghost)
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------
  var so = {     // scene options (reused)
    mouse: { on: false, x: 0, y: 0, R: 0, links: true },
    rings: new Float32Array(5 * 8), ringN: 0
  };
  var fp = {     // renderer frame (reused)
    colA: live.A, colB: live.B, colP: live.P, bg: live.bg,
    haze: new Float32Array(12), hazeC: new Float32Array(9),
    shocks: new Float32Array(16), shockN: 0, shockW: 1, warp: new Float32Array(3)
  };
  var tmpC = [0, 0, 0];

  function ring(n, x, y, r, alpha, width) {
    var R = so.rings, o = n * 5;
    R[o] = x;
    R[o + 1] = y;
    R[o + 2] = r;
    R[o + 3] = alpha;
    R[o + 4] = width;
  }

  function updateCamera(dt) {
    var tx = 0, ty = 0;
    if (cfg.sway) {
      tx += Math.sin(time * 0.047) * 0.07 * H + Math.sin(time * 0.13 + 1) * 0.02 * H;
      ty += Math.cos(time * 0.039) * 0.045 * H;
    }
    if (cfg.parallax && mouse.inside) {
      tx += (mouse.x / W - 0.5) * 0.22 * H * cfg.parallaxamt;
      ty += (mouse.y / H - 0.5) * 0.16 * H * cfg.parallaxamt;
    }
    var k = 1 - Math.exp(-dt * 1.8);
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;
    net.view.camX = cam.x;
    net.view.camY = cam.y;
  }

  function signalSettings() {
    var sg = net.sig;
    sg.speed = 240 * unit * cfg.signalspeed;
    sg.decay = clamp(1 - 0.24 / cfg.signalreach, 0.3, 0.97);
    sg.refr = Math.max(0.9, 2 / cfg.signalspeed);
    sg.rings = cfg.rings;
    sg.minE = cfg.signals ? 0.1 : 99;
    // An overcharged runner at a dead end jumps up to one and a half
    // connections away; with nowhere to go it bursts this hard
    sg.jump = cfg.linkdist * unit * 1.5;
    sg.popPower = cfg.surgeamt;
  }

  function render(dt) {
    var A = audio.state, on = cfg.audioenabled, sens = cfg.audiosensitivity;
    var bass = on ? Math.min(1.5, A.bass * sens) : 0;
    time += dt;
    flash *= Math.exp(-dt * 3.5);
    kick *= Math.exp(-dt * 4);

    updateFlight(dt);
    var hueShift = (on && cfg.audiohue ? A.volume * cfg.audiohueamt * sens : 0) + fly.level * 40;
    updateColors(dt, hueShift);
    updateCamera(dt);

    // Motion
    var speedMul = cfg.speed * (1 + (on && cfg.audiospeed ? A.volume * cfg.audiospeedamt * sens * 0.5 : 0));
    var flyV = net.view.zr > 1 ? fly.level * net.view.zr * 1.6 : 0;
    net.view.fly = net.view.zr > 1 ? fly.level : 0;
    net.move(dt, speedMul, flyV);
    if (mouse.inside && !sing.on && cfg.mouseforce !== 'none') {
      net.cursor(mouse.x, mouse.y, cfg.mouseradius * unit, (cfg.mouseforce === 'attract' ? 140 : -280) * unit, dt);
    }
    updateSingularity(dt);
    net.setHole(sing.x, sing.y, sing.on ? sing.R : 0);
    updateShocks(dt);
    hourState();
    updateShapes(dt);
    updateParticleClock(dt, bass);
    net.project();

    // Connections stretch with the bass
    var breath = on && cfg.audiobreath ? cfg.audiobreathamt * (A.bass * A.bass * 0.22 * sens + kick * 0.07) : 0;
    var L = cfg.linkdist * unit * (1 + breath);
    net.connect(L, MAX_DEG, cfg.triangles);

    // Signals
    signalSettings();
    if (cfg.signals && cfg.signalrate > 0) {
      spont = Math.min(3, spont + dt * cfg.signalrate * area);
      while (spont >= 1) {
        spont -= 1;
        var n = net.randomVisible();
        if (n >= 0) net.fire(n, 0.28 + Math.random() * 0.2, -1);
      }
    }
    net.stepSignals(dt, L);
    net.fade(dt);

    // Scene
    so.dt = dt;
    so.time = time;
    so.W = W;
    so.H = H;
    so.unit = unit;
    so.mode = cfg.colormode;
    so.flat = net.view.zr < 1;
    so.nodesize = cfg.nodesize;
    so.sizeMul = 1 + (on && cfg.audiosize ? bass * bass * cfg.audiosizeamt * 0.3 : 0);
    so.twinkle = cfg.twinkle;
    so.linkwidth = cfg.linkwidth;
    so.linkopacity = cfg.linkopacity;
    so.triangles = cfg.triangles;
    so.triopacity = cfg.triopacity;
    so.dof = cfg.dof;
    so.spectrum = on && cfg.audiospectrum !== 'off' ? cfg.audiospectrum : null;
    so.spectrumAmt = cfg.audiospectrumamt * sens;
    so.bands = A.bands;
    so.signals = cfg.signals;
    so.mouse.on = mouse.inside && !sing.on;
    so.mouse.x = mouse.x;
    so.mouse.y = mouse.y;
    so.mouse.R = cfg.mouseradius * unit;
    so.mouse.links = cfg.mouselinks;
    so.warp = fly.level;
    so.dust = cfg.dust;
    so.camX = cam.x;
    so.camY = cam.y;
    focus += (shapes.level() - focus) * (1 - Math.exp(-dt * 1.5));
    so.focus = focus;
    so.clockAlpha = Math.min(1.3, cfg.clockopacity / 0.85);

    // Rings (shockwaves, the singularity) and the lens that goes with them
    var rn = 0, sn = 0, distort = cfg.distortion ? 1 : 0;
    for (var i = 0; i < shocks.length; i++) {
      var s = shocks[i];
      ring(rn++, s.x, s.y, s.r, 0.07 * s.fade * Math.min(1, s.power), H * 0.014);
      fp.shocks[sn * 4] = s.x;
      fp.shocks[sn * 4 + 1] = s.y;
      fp.shocks[sn * 4 + 2] = s.r;
      fp.shocks[sn * 4 + 3] = 26 * unit * s.power * s.fade * distort;
      sn++;
    }
    if (sing.on) {
      var c = sing.charge, spin = time * 2.5;
      for (var g = 0; g < 2; g++) {
        var rr = sing.R * (0.1 + 0.07 * g) * (1 + 0.08 * Math.sin(spin + g * 2));
        ring(rn++, sing.x, sing.y, rr, 0.3 + 0.4 * c, (2 + 3 * c) * unit);
      }
      if (sn < 4) {
        fp.shocks[sn * 4] = sing.x;
        fp.shocks[sn * 4 + 1] = sing.y;
        fp.shocks[sn * 4 + 2] = sing.R * 0.16;
        fp.shocks[sn * 4 + 3] = -30 * unit * (0.3 + c) * distort;
        sn++;
      }
    }
    so.ringN = rn;
    fp.shockN = sn;
    fp.shockW = H * 0.04;

    var sc = scene.build(so);

    // Background haze: three slow clouds in the network's colors
    var hz = cfg.haze ? cfg.hazeamt * 0.09 * (1 + bass * 0.35 + fly.level) : 0;
    for (var h = 0; h < 3; h++) {
      fp.haze[h * 4] = W * (0.5 + 0.38 * Math.sin(time * 0.021 * (h + 1) + h * 2.1));
      fp.haze[h * 4 + 1] = H * (0.5 + 0.32 * Math.cos(time * 0.017 * (h + 1.4) + h * 1.3));
      fp.haze[h * 4 + 2] = H * (0.5 + 0.12 * h);
      fp.haze[h * 4 + 3] = hz * (h === 2 ? 0.6 : 1);
      var col = h === 0 ? live.A : h === 1 ? (cfg.colormode === 'single' || cfg.colormode === 'rainbow' ? tmpC : live.B) : live.P;
      if (h === 1 && col === tmpC) {
        tmpC[0] = live.A[0];
        tmpC[1] = live.A[1];
        tmpC[2] = live.A[2];
        hueRotate(tmpC, cfg.colormode === 'rainbow' ? 150 : 25);
      }
      fp.hazeC[h * 3] = col[0];
      fp.hazeC[h * 3 + 1] = col[1];
      fp.hazeC[h * 3 + 2] = col[2];
    }

    fp.W = W;
    fp.H = H;
    fp.scene = sc;
    fp.rainbow = cfg.colormode === 'rainbow';
    fp.rbOff = (time * cfg.rainbowspeed / 360) % 1;
    fp.glow = cfg.nodeglow;
    fp.bloom = cfg.bloom ? cfg.bloomamt * (0.85 + 0.12 * bass + 0.5 * fly.level) : 0;
    fp.warp[0] = fly.level * 0.1;
    fp.warp[1] = W / 2;
    fp.warp[2] = H / 2;
    fp.flash = flash;
    fp.vignette = 0.5;
    renderer.frame(fp);

    if (cfg.clock) clock.setPulse(on && cfg.clockpulse ? 1 + A.bass * 0.06 * sens : 1);
  }

  var lastTime = performance.now(), lastDraw = 0;
  var rafId = 0, paused = false;

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    if (fpsLimit > 0) {
      var gap = 1000 / fpsLimit;
      if (now - lastDraw < gap - 1) return;
      // Step by the frame gap instead of jumping to now: on a 75 or 144 Hz
      // display a 60 FPS limit then averages 60 instead of 37 or 48
      lastDraw += gap;
      if (now - lastDraw > gap) lastDraw = now;
    }

    var dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    updatePointer(now);

    audio.update(dt, cfg.audioenabled, cfg.audiosensitivity);
    if (cfg.pauseonsilence && cfg.audioenabled && audio.state.source && audio.state.silentFor > 1.5) return;
    render(dt);
  }

  // A beat: a chain reaction somewhere. A strong bass hit overcharges a node
  // instead (like a click, without the shockwave), at most every 1.2 s.
  var lastSurge = -9, surgeX = -1e4, surgeY = -1e4;

  // A random spot on screen (off the clock and the edges), away from the last
  // strong hit
  function beatSpot(spread) {
    var A = net.a(), m = H * 0.08, fallback = -1;
    for (var t = 0; t < 8; t++) {
      var i = net.randomVisible();
      if (i < 0 || A.LOCK[i] === 3) continue;
      var x = A.SX[i], y = A.SY[i];
      if (x < m || x > W - m || y < m || y > H - m) continue;
      if (!spread) return i;
      if (fallback < 0) fallback = i;
      if ((x - surgeX) * (x - surgeX) + (y - surgeY) * (y - surgeY) > H * H * 0.09) return i;
    }
    return fallback;
  }

  audio.state.onBeat = function (strength) {
    if (!cfg.audiobeat) return;
    kick = Math.max(kick, strength);
    var strong = strength >= 0.85 && time - lastSurge > 1.2, i = beatSpot(strong);
    if (i < 0) return;
    if (strong) {
      var A = net.a();
      lastSurge = time;
      surgeX = A.SX[i];
      surgeY = A.SY[i];
      net.launch(i, net.newSurge(), surgeCharge() - 2, surgeX, surgeY);
    } else {
      net.fire(i, 0.35 + 0.25 * strength, -1);
    }
  };

  audio.state.onTreble = function (strength) {
    if (!cfg.audiosparks) return;
    var A = net.a(), count = 1 + Math.round(strength * 1.5);
    for (var i = 0; i < count; i++) {
      var n = net.randomVisible();
      if (n < 0) continue;
      A.HEAT[n] = Math.max(A.HEAT[n], 0.7);
      net.fire(n, 0.12, -1);
    }
  };

  audio.state.onDrop = function () {
    if (cfg.audiodrop) startFlight();
  };

  // ---------------------------------------------------------------------------
  // Integration: Wallpaper Engine, menu and input
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
    // Wallpaper Engine (and Live Wallpapers on CasaOS) pause the wallpaper when
    // it is covered or the dashboard is hidden: stop all work until it resumes
    setPaused: setPaused
  };

  function setPaused(value) {
    value = !!value;
    if (value === paused) return;
    paused = value;
    clock.setPaused(value);
    if (value) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    } else {
      lastTime = performance.now();   // no jump after the pause
      if (!rafId) rafId = requestAnimationFrame(frame);
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
        if (s.key !== 'preset' && s.key !== 'importcode' && !settings.equal(eff[s.key], s.def)) out[s.key] = eff[s.key];
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

  // Click → chain reaction on release. Hold or drag → singularity, explodes
  // on release. Presses count when they land on the wallpaper itself.
  document.addEventListener('mousedown', function (e) {
    if (e.button !== 0 || e.target !== canvas) return;
    press = { x: e.clientX * pxPerCss, y: e.clientY * pxPerCss, t: performance.now(), hold: false };
  });

  // The cursor, exactly where the last event put it (the connections are
  // drawn to it in the next frame)
  window.addEventListener('mousemove', function (e) {
    mouse.x = e.clientX * pxPerCss;
    mouse.y = e.clientY * pxPerCss;
    mouse.inside = true;
    if (press && !press.hold && cfg.singularity && Math.hypot(mouse.x - press.x, mouse.y - press.y) > 10 * pxPerCss) beginHold();
  });

  window.addEventListener('mouseup', function (e) { if (e.button === 0) endPress(); });
  window.addEventListener('blur', endPress);
  document.addEventListener('mouseleave', function () { mouse.inside = false; });

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      layout();
      applyClock();
    }, 150);
  });

  // ---------------------------------------------------------------------------
  // Startup
  // ---------------------------------------------------------------------------
  // WebGL2, or Canvas 2D on a fresh canvas when it fails
  if (S.gl.init(canvas) && S.gl.ok()) {
    renderer = S.gl;
    rendererName = 'webgl2';
  } else {
    var fresh = document.createElement('canvas');
    fresh.id = 'px-canvas';
    canvas.parentNode.replaceChild(fresh, canvas);
    canvas = fresh;
    S.render2d.init(canvas);
    renderer = S.render2d;
    rendererName = '2d';
  }

  if (!isWE) loadSaved();
  clock.init();
  refresh();
  albumColors();
  clock.setSong(media.state);   // in case Wallpaper Engine told the song before the clock existed
  menu.init(app);
  if (!isWE) menu.toast(i18n.t('toast.open'), 3500);
  rafId = requestAnimationFrame(frame);

  // Console access for debugging and tests
  S.app = app;
  S.debug = {
    cfg: cfg,
    effective: function () { return eff; },
    renderer: function () { return rendererName; },
    size: function () { return { W: W, H: H, unit: unit }; },
    relayout: function () { layout(); },
    // Renders one frame on demand (deterministic tests)
    step: function (dt) {
      audio.update(dt, cfg.audioenabled, cfg.audiosensitivity);
      render(dt);
    },
    click: function (x, y) { clickFire(x, y); },
    hold: function (x, y) {
      press = { x: x, y: y, t: performance.now(), hold: false };
      mouse.x = x;
      mouse.y = y;
      beginHold();
    },
    release: function () { endPress(); },
    mouse: function (x, y) {
      mouse.x = x;
      mouse.y = y;
      mouse.inside = x !== undefined;
    },
    shape: function (kind) { return startShape(kind); },
    shapeCount: function () { return shapeCount; },
    music: music,
    // Shows the visualizer now ('terrain' or 'tunnel'), music or not
    visualizer: function (style) {
      var r = regions[clamp(Math.round(cfg.clockscreen), 1, regions.length) - 1];
      if (shapes.active()) shapes.release(unit);
      var ok = shapes.start({
        kind: 'visualizer', W: r.w, H: H, L: cfg.linkdist * unit, size: cfg.shapesize, hold: Infinity,
        cx: r.x0 + r.w / 2, style: style || 'terrain'
      });
      if (ok) vizForced = true;
      return ok;
    },
    // Moves the clock's time by ms (tests: the turn of the hour)
    timeShift: function (ms) {
      timeShift = ms;
      clockSec = -1;
    },
    // The clock's hour turns in `sec` seconds (default 10); timeShift(0) undoes it
    hourIn: function (sec) {
      var inHour = (localNow() / 1000) % 3600;
      timeShift += ((3600 - (sec === undefined ? 10 : sec) - inHour + 7200) % 3600) * 1000;
      clockSec = -1;
    },
    pclock: function () { return { n: pclock.count(), hd: clockHD, center: pclock.center() }; },
    flight: function () { return startFlight(); },
    fly: fly,
    sing: sing,
    shocks: function () { return shocks; },
    albumMix: function () { return mediaMix; },
    live: live
  };
})(window.Plexus);
