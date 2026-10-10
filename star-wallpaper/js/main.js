/*
 * Starry Orbit — core: settings, layout, stars and the render loop.
 *
 * Layers per frame:
 *   1. starCanvas (offscreen, black background): stars and shooting stars, with trails
 *   2. 2D canvas: background → nebula → core → supernova remnants →
 *      starCanvas (additive) → planets → comets, flares and flashes
 *   3. lens (WebGL, only while waves, the black hole or hyperspace exist):
 *      distorts step 2
 */
(function (S) {
  'use strict';

  var util = S.util, settings = S.settings, audio = S.audio, i18n = S.i18n;
  var nebula = S.nebula, nebulaGL = S.nebulaGL, clock = S.clock, menu = S.menu, lens = S.lens, planets = S.planets;
  var media = S.media, events = S.events;
  var SCHEMA = settings.SCHEMA;
  var clamp = util.clamp, random = util.random;
  var BANDS = audio.BANDS;
  var FRONT_N = lens.FRONT_N;
  var SPIRAL_SIGMA = lens.SPIRAL_SIGMA, SPIRAL_K = lens.SPIRAL_K, SPIRAL_BUNCH = lens.SPIRAL_BUNCH;
  var TAU = Math.PI * 2;
  var isWE = audio.state.source === 'we';

  // Host integration (optional, set before the engine loads; see README):
  //   storageKey, language(), pointerTarget(event), active(), startupHint,
  //   menuHotkey, audioUI. Only pages that embed the engine use it; WE, the
  //   browser and Live Wallpapers (CasaOS) don't.
  var host = S.host || {};
  var STORAGE_KEY = host.storageKey || 'starry-orbit-settings';

  // "Real stars" palette: [hue, saturation, lightness, weight]
  var SPECTRAL = [
    [215, 70, 80, 0.12],   // blue-white
    [205, 30, 90, 0.22],   // white
    [48, 50, 86, 0.24],    // yellow-white
    [44, 78, 70, 0.20],    // yellow
    [30, 88, 62, 0.14],    // orange
    [10, 80, 60, 0.08]     // red
  ];

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  var raw = settings.defaults();   // values as received from WE / the menu
  var imported = {};               // imported-code layer (WE only)
  var eff = null;                  // effective values (WE format)
  var cfg = {};                    // typed + derived values
  var fpsLimit = 0;
  var weLang = null;               // UI language reported by Wallpaper Engine, if any

  var canvas = document.getElementById('so-stars');
  var ctx = canvas.getContext('2d', { alpha: false });
  var starCanvas = document.createElement('canvas');
  var sctx = starCanvas.getContext('2d', { alpha: false });

  var dpr = 1, w = 0, h = 0;
  var regions = [], waves = [], shooters = [];
  var mouse = { x: 0, y: 0, inside: false };
  var neb = { tex: null, seed: null, key: '', fade: 0, core: 0, flow: 0, colKey: '', colA: [0, 0, 0], colB: [0, 0, 0] };
  var spriteCache = new Map();
  var time = 0;

  var bolts = [], boltSeq = 0;

  // Click-and-drag black hole
  var HOLD_MS = 320;
  var press = null;   // { x, y, t, hold }
  var hole = {
    active: false, x: 0, y: 0, tx: 0, ty: 0, power: 0, spin: 0, charge: 0, region: 0,
    mass: 0,          // planets swallowed this session (rocky = 1, gas giant = 3)
    grow: 1,          // displayed size factor, follows the mass slowly
    supermassive: false, superT: 0
  };
  var SUPERMASSIVE_MASS = 14;

  function hsla(hh, s, l, a) {
    return 'hsla(' + hh + ', ' + s + '%, ' + l + '%, ' + a + ')';
  }

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
    var hsl = util.rgbToHsl(util.parseColor(cfg.starcolor));
    cfg.hue = hsl[0];
    cfg.sat = hsl[1];
    cfg.light = clamp(hsl[2], 10, 80);
    cfg.bgCSS = cfg.custombg
      ? util.rgbCss(cfg.bgcolor)
      : 'hsl(' + cfg.hue + ', ' + Math.min(100, cfg.sat + 3) + '%, 6%)';
    cfg.bgRGB = cfg.custombg
      ? util.parseColor(cfg.bgcolor)
      : util.hslToRgb(cfg.hue, Math.min(100, cfg.sat + 3) / 100, 0.06).map(function (v) { return v / 255; });
    // The colors as set; the album cover may tint the live ones (updateMedia)
    cfg.baseHue = cfg.hue;
    cfg.baseSat = cfg.sat;
    cfg.baseLight = cfg.light;
    cfg.baseNebHue = cfg.nebulahue;
    cfg.baseBgCSS = cfg.bgCSS;
    mediaApplied = false;
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
    menu.setTheme(cfg);

    // Language: explicit setting, or automatic (WE language, then the system's)
    var lang = i18n.resolve(cfg.language, weLang || (host.language ? host.language() : null));
    if (first || lang !== i18n.lang()) {
      i18n.setLang(lang);
      fx.clock = true;
      if (!first) menu.relabel();
    }

    if (fx.color) clearSprites();
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
  // Star sprites (radial glow), cached per color
  //
  // Thousands are drawn per frame, so they are ImageBitmaps when the browser
  // can make them (the cheapest drawImage source), painted on one reused
  // OffscreenCanvas; otherwise small canvases.
  // ---------------------------------------------------------------------------
  var spritePad = null;   // { canvas, ctx } when ImageBitmap sprites are available

  function spriteSurface() {
    if (spritePad === null) {
      spritePad = false;
      try {
        var oc = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(100, 100) : null;
        var octx = oc && oc.getContext('2d');
        if (octx && oc.transferToImageBitmap) spritePad = { canvas: oc, ctx: octx };
      } catch (e) {}
    }
    return spritePad;
  }

  function clearSprites() {
    // Nothing keeps a sprite between frames: free the bitmaps right away
    spriteCache.forEach(function (sp) { if (sp.close) sp.close(); });
    spriteCache.clear();
  }

  function getSprite(hh, s, l) {
    hh = ((Math.round(hh / 2) * 2) % 360 + 360) % 360;
    s = Math.round(s);
    l = Math.round(l);
    var key = hh * 10201 + s * 101 + l;
    var sp = spriteCache.get(key);
    if (sp) return sp;
    // Mid-frame: a sprite fetched earlier this frame may still be drawn, so
    // the old ones are left to the garbage collector instead of closed
    if (spriteCache.size > 720) spriteCache.clear();

    var pad = spriteSurface(), c;
    if (pad) {
      c = pad.ctx;
    } else {
      sp = document.createElement('canvas');
      sp.width = sp.height = 100;
      c = sp.getContext('2d');
    }
    var g = c.createRadialGradient(50, 50, 0, 50, 50, 50);
    g.addColorStop(0.025, '#fff');
    g.addColorStop(0.1, 'hsl(' + hh + ', ' + s + '%, ' + l + '%)');
    g.addColorStop(0.25, 'hsl(' + hh + ', ' + Math.min(100, s + 3) + '%, 6%)');
    g.addColorStop(1, 'transparent');
    c.fillStyle = g;
    c.beginPath();
    c.arc(50, 50, 50, 0, Math.PI * 2);
    c.fill();
    if (pad) sp = pad.canvas.transferToImageBitmap();   // also leaves the pad blank
    spriteCache.set(key, sp);
    return sp;
  }

  // ---------------------------------------------------------------------------
  // Layout: one "region" per screen, each with its own galaxy
  // ---------------------------------------------------------------------------
  function screenCount() {
    if (cfg.screens === 'auto') return clamp(Math.round(w / h / (16 / 9)), 1, 4);
    return clamp(parseInt(cfg.screens, 10) || 1, 1, 4);
  }

  function pickSpectral() {
    var r = Math.random(), acc = 0;
    for (var i = 0; i < SPECTRAL.length; i++) {
      acc += SPECTRAL[i][3];
      if (r <= acc) return i;
    }
    return 0;
  }

  function makeStar(r) {
    var orbit = random(r.maxR);
    var radius = random(60, orbit) / 12;
    var frac = Math.min(1, orbit / r.cornerR);
    return {
      orbit: orbit,
      radius: radius,
      t: random(0, cfg.starcount),
      speed: random(orbit) / 900000,
      alpha: random(2, 10) / 10,
      band: Math.min(BANDS - 1, Math.floor(frac * BANDS)),  // center = bass, edge = treble
      frac: frac,
      depth: 0.2 + 0.8 * Math.min(1, radius * 12 / r.maxR),  // bigger = closer (parallax)
      mass: (radius / 30) * (radius / 30),                    // weight that holds the wave back
      hueRand: Math.random() * 2 - 1,
      spec: pickSpectral(),
      flash: 0,          // lightning hit
      sx: 0, sy: 0,      // last rendered position (lightning follows it)
      bolt: 0,           // id of the last bolt that visited this star
      z: Math.random(),  // place in the hyperspace stream
      gone: false        // exploded as a supernova (events.js)
    };
  }

  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.width = starCanvas.width = Math.round(window.innerWidth * dpr);
    h = canvas.height = starCanvas.height = Math.round(window.innerHeight * dpr);

    var n = screenCount(), rw = w / n;
    regions = [];
    for (var i = 0; i < n; i++) {
      var x0 = i * rw;
      var cx = x0 + rw * cfg.centerx / 100, cy = h * cfg.centery / 100;
      var ex = Math.max(cx - x0, x0 + rw - cx), ey = Math.max(cy, h - cy);
      var reach = Math.max(ex, ey) * 2;   // same as the original mod when centered
      var r = {
        index: i, x0: x0, w: rw, cx: cx, cy: cy,
        cornerR: Math.sqrt(ex * ex + ey * ey),
        maxR: Math.round(Math.sqrt(reach * reach * 2)) / 2,
        px: 0, py: 0, parMax: 0,
        // Each screen sees the nebula from a different angle (golden angle + mirror)
        nebAngle: Math.random() * Math.PI * 2 + i * 2.39996,
        nebFlip: i % 2 ? -1 : 1,
        stars: []
      };
      for (var k = 0; k < cfg.starcount; k++) r.stars.push(makeStar(r));
      regions.push(r);
    }

    waves = [];
    shooters = [];
    bolts = [];
    events.clear();
    hole.region = Math.min(hole.region, regions.length - 1);
    sctx.globalCompositeOperation = 'source-over';
    sctx.globalAlpha = 1;
    sctx.fillStyle = '#000';
    sctx.fillRect(0, 0, w, h);
  }

  function regionAt(x) {
    return regions[clamp(Math.floor(x / regions[0].w), 0, regions.length - 1)];
  }

  function clip(c, r) {
    c.beginPath();
    c.rect(r.x0, 0, r.w, h);
    c.clip();
  }

  function applyClock() {
    if (!regions.length) return;
    var r = regions[clamp(Math.round(cfg.clockscreen), 1, regions.length) - 1];
    clock.apply(cfg, { left: r.x0 / dpr, width: r.w / dpr });
  }

  // ---------------------------------------------------------------------------
  // Gravitational wave
  //
  // The front is a membrane with FRONT_N radii (one per angle). Stars near the
  // front deposit "drag" proportional to their weight; sectors heavier than
  // average advance more slowly and empty sectors advance faster. Tension
  // between neighbors keeps the curve smooth and organic.
  //
  // What the wave does to space (here for the stars, in lens.js for the whole
  // scene) is transverse, not a ripple: "+" waves stretch space along one axis
  // and squeeze it across, swapping every half wave while the axes turn;
  // spiral waves (the supermassive black hole) shear it along two arms.
  // ---------------------------------------------------------------------------
  var POL_SPIN = 1.1;   // how fast the "+" axes turn (rad/s)

  function spawnWave(x, y, ri, strength, spiral) {
    var r = regions[ri];
    var far = Math.max(
      Math.hypot(x - r.x0, y), Math.hypot(x - r.x0 - r.w, y),
      Math.hypot(x - r.x0, y - h), Math.hypot(x - r.x0 - r.w, y - h)
    );
    var width = r.cornerR * 0.07;
    waves.push({
      x: x, y: y, region: ri, fade: 0, strength: strength,
      spiral: !!spiral,
      // Envelope behind the front, in lens widths (1.25 x width): spiral
      // waves trail a long train of arms
      sigma: spiral ? SPIRAL_SIGMA : 1,
      pol: Math.random() * Math.PI,   // initial axis ("+") or arm angle (spiral)
      phase: 0, age: 0,
      amp: 0,                         // displacement (px), capped, set every frame
      speed: r.cornerR * 0.85 * cfg.wavespeed,
      width: width,
      // A spiral lives until its train has left the screen too
      maxRadius: far + r.cornerR * 0.1 + (spiral ? 3.2 * SPIRAL_SIGMA * width * 1.25 : 0),
      front: new Float32Array(FRONT_N),
      drag: new Float32Array(FRONT_N),
      tmp: new Float32Array(FRONT_N),
      radius: 0, minR: 0, maxR: 0,
      lo2: 0, hi2: 0      // squared distances where it can touch a star
    });
    if (waves.length > lens.MAX_WAVES) waves.shift();
    waveTotal++;
  }
  var waveTotal = 0;

  function updateWaves(dt) {
    var tension = Math.min(0.45, 0.22 * dt * 60);
    var dragDecay = Math.exp(-dt * 6);
    var weight = cfg.wavedrag * 0.45;

    for (var k = waves.length - 1; k >= 0; k--) {
      var wv = waves[k], f = wv.front, g = wv.drag, t = wv.tmp, i;
      var step = wv.speed * dt, mean = 0;

      for (i = 0; i < FRONT_N; i++) mean += g[i];
      mean /= FRONT_N;

      // Each point advances according to its sector's weight relative to the average
      for (i = 0; i < FRONT_N; i++) {
        var slow = weight ? clamp(weight * (g[i] / (mean + 0.02) - 1), -0.35, 0.85) : 0;
        f[i] += step * (1 - slow);
        g[i] *= dragDecay;
      }

      // Membrane tension
      for (i = 0; i < FRONT_N; i++) {
        var prev = f[(i + FRONT_N - 1) % FRONT_N], next = f[(i + 1) % FRONT_N];
        t[i] = f[i] + tension * (prev + next - 2 * f[i]) * 0.5;
      }
      var sum = 0, lo = Infinity, hi = 0;
      for (i = 0; i < FRONT_N; i++) {
        f[i] = t[i];
        sum += f[i];
        if (f[i] < lo) lo = f[i];
        if (f[i] > hi) hi = f[i];
      }
      wv.radius = sum / FRONT_N;
      wv.minR = lo;
      wv.maxR = hi;
      var lw = wv.width * 1.25;
      var near = Math.max(0, lo - 3.2 * wv.sigma * lw), far = hi + 3.2 * lw;
      wv.lo2 = near * near;
      wv.hi2 = far * far;
      wv.age += dt;
      wv.phase = wv.spiral ? wv.pol : 2 * (wv.pol + POL_SPIN * wv.age);
      // Capped so space never "folds" (the "+" changes faster across the
      // front than the long spiral arms do)
      wv.amp = Math.min(lw * (wv.spiral ? 0.42 : 0.32), lw * 0.3 * cfg.wavestrength * wv.strength);
      // How much a star crossing it is stretched (and squeezed across)
      wv.tide = Math.min(0.55, 0.4 * cfg.wavestrength * wv.strength);

      if (wv.radius >= wv.maxRadius) { waves.splice(k, 1); continue; }
      var intro = Math.min(1, wv.radius / (wv.width * 2));
      wv.fade = intro * (1 - Math.pow(wv.radius / wv.maxRadius, 1.5));
    }
  }

  // Front radius in direction (dx, dy); also stores the nearest sample index
  // and the angle
  var frontIdx = 0, frontAng = 0;
  function frontRadius(wv, dx, dy) {
    frontAng = Math.atan2(dy, dx);
    var u = (frontAng / TAU + 0.5) * FRONT_N;
    var i0 = Math.floor(u), ft = u - i0;
    i0 %= FRONT_N;
    frontIdx = ft < 0.5 ? i0 : (i0 + 1) % FRONT_N;
    var a = wv.front[i0], b = wv.front[(i0 + 1) % FRONT_N];
    return a + (b - a) * ft;
  }

  // Runs the scene through the lens while waves exist (the per-wave records
  // are reused: no allocation per frame)
  var lensList = [], lensPool = [];
  for (var lp = 0; lp < lens.MAX_WAVES; lp++) {
    lensPool.push({ front: null, x: 0, y: 0, width: 0, amp: 0, phase: 0, spiral: false, x0: 0, x1: 0 });
  }

  function applyLens() {
    var on = lens.ok() && cfg.wavelens;
    var hl = on ? holeLens() : null, wl = on ? warpLens() : null;
    if (!on || (!waves.length && !hl && !wl)) { lens.hide(); return; }
    var multi = regions.length > 1;
    lensList.length = 0;
    for (var i = 0; i < waves.length; i++) {
      var wv = waves[i], r = regions[wv.region];
      if (!r || wv.fade <= 0.002) continue;
      var amp = wv.amp * wv.fade;
      if (amp < 0.3) continue;
      var o = lensPool[lensList.length];
      o.front = wv.front;
      o.x = wv.x + r.px * 0.6;
      o.y = wv.y + r.py * 0.6;
      o.width = wv.width * 1.25;
      o.amp = amp;
      o.phase = wv.phase;
      o.spiral = wv.spiral;
      o.x0 = multi ? r.x0 : -1e9;
      o.x1 = multi ? r.x0 + r.w : 1e9;
      lensList.push(o);
    }
    if ((!lensList.length && !hl && !wl) || !lens.render(canvas, lensList, hl, wl)) lens.hide();
  }

  // ---------------------------------------------------------------------------
  // Mouse parallax
  // ---------------------------------------------------------------------------
  function updateParallax(dt) {
    var k = 1 - Math.exp(-dt * 2.5);
    for (var i = 0; i < regions.length; i++) {
      var r = regions[i], tx = 0, ty = 0;
      r.parMax = cfg.parallax ? Math.min(r.w, h) * 0.035 * cfg.parallaxamt : 0;
      if (r.parMax && mouse.inside && mouse.x >= r.x0 && mouse.x < r.x0 + r.w) {
        tx = clamp((mouse.x - r.cx) / (r.w / 2), -1.5, 1.5);
        ty = clamp((mouse.y - r.cy) / (h / 2), -1.5, 1.5);
      }
      r.px += (-tx * r.parMax - r.px) * k;
      r.py += (-ty * r.parMax - r.py) * k;
    }
  }

  // ---------------------------------------------------------------------------
  // Nebula and core
  // ---------------------------------------------------------------------------
  function updateNebula(dt, pulse) {
    neb.core += ((cfg.nebula && cfg.nebulacore ? 1 : 0) - neb.core) * Math.min(1, dt * 2);

    if (nebulaGL.ok()) {
      // Fluid nebula: the gas is generated every frame, only fade and color are
      // needed here. The bass speeds up the turbulence a little.
      neb.fade = cfg.nebula ? Math.min(1, neb.fade + dt / 1.5) : Math.max(0, neb.fade - dt * 1.5);
      neb.flow += dt * cfg.nebulaflow * (1 + pulse * 0.5);
      var sat = Math.max(30, cfg.sat) / 100, colKey = cfg.hue + '|' + cfg.nebulahue + '|' + sat;
      if (colKey !== neb.colKey) {
        neb.colKey = colKey;
        neb.colA = util.hslToRgb(cfg.hue, sat, 0.5).map(function (v) { return v / 255; });
        neb.colB = util.hslToRgb(cfg.hue + cfg.nebulahue, sat, 0.45).map(function (v) { return v / 255; });
      }
      return;
    }

    // Without WebGL2: CPU-generated texture, rotating
    var field = cfg.nebula ? nebula.request(Math.round(cfg.nebulaseed) + skyShift * 23) : null;
    // When the shape changes, the old texture fades out before the new one appears
    var ready = field && (field.seed === neb.seed || neb.fade === 0);
    if (!ready) {
      neb.fade = Math.max(0, neb.fade - dt * 1.5);
      return;
    }
    var satPct = Math.max(30, cfg.sat);
    var key = field.seed + '|' + cfg.hue + '|' + cfg.nebulahue + '|' + satPct;
    if (key !== neb.key) {
      neb.tex = nebula.colorize(field, cfg.hue, cfg.hue + cfg.nebulahue, satPct);
      neb.key = key;
      neb.seed = field.seed;
    }
    neb.fade = Math.min(1, neb.fade + dt / 1.5);
  }

  function drawTex(tex, size, a) {
    // globalAlpha caps at 1: higher intensities draw again
    while (a > 0.004) {
      ctx.globalAlpha = Math.min(1, a);
      ctx.drawImage(tex, -size / 2, -size / 2, size, size);
      a -= 1;
    }
  }

  // Nebula parameters, reused every frame
  var nebOpt = { seed: [0, 0], hole: null }, nebHole = [0, 0, 0, 0];
  // The angle feeds cos/sin in float32 on the GPU, so it is kept small. The
  // CPU nebula also turns a second layer by 2.4 × angle: 5 turns keep both
  // continuous.
  var NEB_WRAP = TAU * 5;

  function drawBackdrop(r, dt, spin, pulse) {
    var multi = regions.length > 1;
    if (multi) { ctx.save(); clip(ctx, r); }

    r.nebAngle += dt * 0.012 * spin * cfg.nebulaspeed;
    if (r.nebAngle > NEB_WRAP) r.nebAngle -= NEB_WRAP;
    else if (r.nebAngle < -NEB_WRAP) r.nebAngle += NEB_WRAP;
    if (nebulaGL.ok()) {
      if (neb.fade > 0.003) {
        var seed = Math.round(cfg.nebulaseed) + skyShift * 23 + r.index * 17, o = nebOpt;
        o.quality = cfg.nebulaquality;
        o.regionW = r.w;
        o.regionH = h;
        o.cx = r.cx - r.x0 + r.px * 0.25;
        o.cy = r.cy + r.py * 0.25;
        o.angle = r.nebAngle;
        o.flip = r.nebFlip;
        o.unit = (r.cornerR + r.parMax * 0.5 + 20 * dpr) * cfg.nebulascale * (1 + pulse * 0.03);
        o.time = neb.flow + r.index * 41.3;
        o.seed[0] = 1.2 + (seed * 3.7) % 60;
        o.seed[1] = 1.2 + (seed * 5.3) % 60;
        o.colA = neb.colA;
        o.colB = neb.colB;
        o.intensity = cfg.nebulaintensity * neb.fade * (1 + pulse * 0.8) * (1 - 0.8 * warp.level);
        o.warp = 1 + pulse * 0.35;
        o.hole = null;
        if (hole.power > 0.002 && r.index === hole.region) {
          nebHole[0] = hole.x - r.x0;
          nebHole[1] = hole.y;
          nebHole[2] = holeRadius(r) * 1.3;
          nebHole[3] = hole.power * 2.4;
          o.hole = nebHole;
        }
        var nebCanvas = nebulaGL.render(o);
        if (nebCanvas) {
          ctx.globalAlpha = 1;
          ctx.drawImage(nebCanvas, r.x0, 0, r.w, h);
        }
      }
    } else if (neb.tex && neb.fade > 0) {
      var size = (r.cornerR * 2 + r.parMax + 40 * dpr) * cfg.nebulascale;
      var a = cfg.nebulaintensity * neb.fade * (1 + pulse * 0.8) * (1 - 0.8 * warp.level);
      var sc = 1 + pulse * 0.03;
      ctx.save();
      ctx.translate(r.cx + r.px * 0.25, r.cy + r.py * 0.25);
      ctx.rotate(r.nebAngle);
      ctx.scale(sc * r.nebFlip, sc);
      drawTex(neb.tex, size, a);
      // Second mirrored layer, rotating the other way: depth
      ctx.rotate(1.7 - 2.4 * r.nebAngle);
      ctx.scale(-1.6, 1.6);
      drawTex(neb.tex, size, a * 0.35);
      ctx.restore();
    }

    if (neb.core > 0.001) {
      var k = neb.core * Math.min(1.6, cfg.nebulaintensity * (0.9 + pulse)) * (1 - 0.7 * warp.level);
      var x = r.cx + r.px * 0.15, y = r.cy + r.py * 0.15, R = Math.min(r.w, h) * 0.6;
      var g = ctx.createRadialGradient(x, y, 0, x, y, R);
      g.addColorStop(0, hsla(cfg.hue, cfg.sat, 88, Math.min(1, 0.45 * k)));
      g.addColorStop(0.05, hsla(cfg.hue, cfg.sat, 70, Math.min(1, 0.28 * k)));
      g.addColorStop(0.22, hsla(cfg.hue, cfg.sat, 55, 0.1 * k));
      g.addColorStop(0.55, hsla(cfg.hue + cfg.nebulahue * 0.5, cfg.sat, 45, 0.035 * k));
      g.addColorStop(1, hsla(cfg.hue, cfg.sat, 40, 0));
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      // Transparent past R: only fill the square around it (within the screen)
      var bx0 = Math.max(r.x0, x - R), bx1 = Math.min(r.x0 + r.w, x + R);
      var by0 = Math.max(0, y - R), by1 = Math.min(h, y + R);
      if (bx1 > bx0 && by1 > by0) ctx.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
    }

    if (multi) ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Stars
  // ---------------------------------------------------------------------------
  var rw = [];   // waves on the region being drawn (reused)

  function drawStars(r, p) {
    var multi = regions.length > 1;
    if (multi) { sctx.save(); clip(sctx, r); }

    var k;
    rw.length = 0;
    for (k = 0; k < waves.length; k++) {
      if (waves[k].region === r.index && waves[k].fade > 0.002) rw.push(waves[k]);
    }
    var deposit = p.dt * 6;
    // Visible area: every star still moves, but only these are drawn (with
    // the default layout about 40% of them are off-screen at any moment)
    var vx0 = r.x0, vx1 = r.x0 + r.w;

    var mode = cfg.colormode, baseH = cfg.hue + p.hueShift, sat = cfg.sat, light = cfg.light;
    var single = mode === 'single' ? getSprite(baseH, sat, light) : null;
    var rainbowOff = time * cfg.rainbowspeed, variance = cfg.colorvariance;
    var bands = audio.state.bands;
    var stars = r.stars, cx = r.cx, cy = r.cy, px = r.px, py = r.py;
    var flashDecay = Math.exp(-p.dt * 7);

    // Black hole on this screen?
    var hp = hole.power > 0.002 && r.index === hole.region ? hole.power : 0;
    // The pull on stars grows slower than the hole itself, so a supermassive
    // hole does not smear the whole sky; the horizon still matches the lens
    var hR = hp ? holeRadius(r) / Math.sqrt(hole.grow) : 0, hReach2 = 16 * hR * hR;
    var hShadow = hp ? holeRadius(r) * 0.18 * hp : 0;

    // Hyperspace: how far into the jump, where the stream is, how fast
    var warpLv = warp.level, warpClock = warp.clock, warpRate = warp.rate;

    for (var i = 0; i < stars.length; i++) {
      var st = stars[i];
      var x = Math.sin(st.t) * st.orbit + cx;
      var y = Math.cos(st.t) * st.orbit + cy;
      var glow = 0, sxx = 0, sxy = 0;   // strain on the star (traceless: syy = -sxx)

      for (k = 0; k < rw.length; k++) {
        var wv = rw[k], dx = x - wv.x, dy = y - wv.y, d2 = dx * dx + dy * dy;
        if (d2 < wv.lo2 || d2 > wv.hi2) continue;
        var d = Math.sqrt(d2) || 1;
        var sw = (d - frontRadius(wv, dx, dy)) / wv.width;
        // Same field as the lens (its units: 1.25 widths), so stars and space agree
        var s = sw / 1.25, sig = s < 0 ? wv.sigma : 1;
        if (s < -3.2 * sig || s > 3.2) continue;
        var env = Math.exp(-0.5 * s * s / (sig * sig)) * wv.fade, ex, ey, hs;
        if (wv.spiral) {
          // Sheared along the arms and bunched up in them; the star is
          // stretched along the arm and squeezed across it
          var ph = SPIRAL_K * s + 2 * frontAng + wv.phase, sn = Math.sin(ph), cs = SPIRAL_BUNCH * Math.cos(ph);
          var ux = dx / d, uy = dy / d;
          env *= util.smoothstep(0, 4 * wv.width * 1.25, d);
          ex = cs * ux - sn * uy;
          ey = cs * uy + sn * ux;
          hs = env * wv.tide * sn;
          sxx -= hs * (ux * ux - uy * uy);
          sxy -= hs * 2 * ux * uy;
        } else {
          // Moved like space, stretched along the "+" axis, squeezed across
          var c2 = wv.phase, pa = c2 - frontAng, sk = Math.sin(2.4 * s);
          ex = Math.cos(pa) * sk;
          ey = Math.sin(pa) * sk;
          hs = env * wv.tide * sk;
          sxx += hs * Math.cos(c2);
          sxy += hs * Math.sin(c2);
        }
        var e = env * wv.amp * p.pushMul;
        x += ex * e;
        y += ey * e;
        // A faint glint as the front crosses the star (no ring of light)
        if (sw > -3 && sw < 3) glow += Math.exp(-sw * sw) * wv.fade * wv.strength;
        // The star holds back the piece of the front passing over it
        if (sw > -1.2 && sw < 1.2) wv.drag[frontIdx] += st.mass * deposit;
      }

      x += px * st.depth;
      y += py * st.depth;

      // Black hole: stars orbit it (faster closer in), get pulled toward it and
      // vanish past the horizon. Blending by power lets them spring straight
      // back when it is released instead of unwinding.
      var swallow = 1, disk = 0;
      if (hp) {
        var hx = x - hole.x, hy = y - hole.y, hd2 = hx * hx + hy * hy;
        if (hd2 < hReach2) {
          var hd = Math.sqrt(hd2) || 1, g = Math.exp(-hd / hR);
          var ang = hole.spin * g + g * 1.4, ca = Math.cos(ang), sa = Math.sin(ang), pull = 1 - 0.6 * g;
          var tx = hole.x + (hx * ca - hy * sa) * pull, ty = hole.y + (hx * sa + hy * ca) * pull;
          x += (tx - x) * hp;
          y += (ty - y) * hp;
          swallow = 1 - hp * (1 - util.smoothstep(hShadow * 0.6, hShadow * 1.4, hd * pull));
          disk = g * hp;
        }
      }

      // Hyperspace: every star streams out of the center along its own line,
      // faster and bigger as it comes closer (out toward the edges)
      var streak = 0, wu = 0, wux = 0, wuy = 0;
      if (warpLv > 0.003) {
        var wdx = x - cx, wdy = y - cy, wdd = Math.sqrt(wdx * wdx + wdy * wdy) || 1;
        wux = wdx / wdd;
        wuy = wdy / wdd;
        wu = (st.z + warpClock) % 1;
        var wu2 = wu * wu, wdist = r.cornerR * (0.03 + 1.35 * wu2 * wu);
        x += (cx + wux * wdist - x) * warpLv;
        y += (cy + wuy * wdist - y) * warpLv;
        // Motion blur: the distance covered in about three frames
        streak = warpLv * r.cornerR * 4.05 * wu2 * warpRate * p.dt * 3;
      }

      if (p.twinkleP) {
        var tw = Math.random();
        if (tw < p.twinkleP) st.alpha = Math.max(0, st.alpha - 0.05);
        else if (tw < p.twinkleP * 2) st.alpha = Math.min(1, st.alpha + 0.05);
      }

      var size = st.radius * p.sizeMul, a = st.alpha * p.alphaMul;
      if (p.freqAmt) {
        var b = Math.pow(bands[st.band], 1.5) * p.freqAmt;
        size *= 1 + b;
        a += b * 0.5;
      }
      if (glow) a += glow * 0.12;
      if (st.flash > 0.01) {
        a += st.flash * 0.9;
        size *= 1 + st.flash * 0.7;
        st.flash *= flashDecay;
      }
      size -= st.radius * p.shrink;   // music: same growth as at full size, smaller at rest
      if (disk) a *= 1 + disk * 0.8;   // brighter accretion disk
      a *= swallow;
      if (warpLv > 0.003) {
        size *= 1 + warpLv * wu * 1.2;
        a += (Math.min(1, 0.35 + wu) - a) * warpLv;
      }

      st.sx = x;
      st.sy = y;
      st.t += st.speed * p.step;
      if (st.gone) continue;

      var half = size / 2, strain = sxx || sxy ? Math.sqrt(sxx * sxx + sxy * sxy) : 0;
      if (strain > 0.6) { sxx *= 0.6 / strain; sxy *= 0.6 / strain; strain = 0.6; }
      var reach = half * (1 + strain) + streak;
      if (a <= 0.001 || x + reach < vx0 || x - reach > vx1 || y + reach < 0 || y - reach > h) continue;

      var sprite = single;
      if (!sprite) {
        if (mode === 'varied') {
          sprite = getSprite(baseH + st.hueRand * variance, sat, light);
        } else if (mode === 'spectrum') {
          var sp = SPECTRAL[st.spec];
          sprite = getSprite(sp[0] + p.hueShift, sp[1], sp[2]);
        } else {
          sprite = getSprite(baseH + st.frac * 360 + rainbowOff, Math.max(sat, 55), Math.max(light, 45));
        }
      }
      sctx.globalAlpha = a > 1 ? 1 : a;
      if (streak > 1) {
        // Stretched along its line, the tail toward the center
        var kk = streak / size;
        sctx.setTransform(1 + kk * wux * wux, kk * wux * wuy, kk * wux * wuy, 1 + kk * wuy * wuy,
          x - wux * streak / 2, y - wuy * streak / 2);
        sctx.drawImage(sprite, -half, -half, size, size);
        sctx.setTransform(1, 0, 0, 1, 0, 0);
      } else if (strain > 0.02) {
        // Tidal shape: the textbook picture of a passing gravitational wave
        sctx.setTransform(1 + sxx, sxy, sxy, 1 - sxx, x, y);
        sctx.drawImage(sprite, -half, -half, size, size);
        sctx.setTransform(1, 0, 0, 1, 0, 0);
      } else {
        sctx.drawImage(sprite, x - half, y - half, size, size);
      }
    }

    if (multi) sctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Shooting stars
  // ---------------------------------------------------------------------------
  // o (optional): { x, y, dx, dy, long } for a given place and heading (meteor
  // showers: long = longer streaks)
  function spawnShooter(o) {
    var angle = random(15, 45) * Math.PI / 180, dir = Math.random() < 0.5 ? 1 : -1;
    o = o || {};
    shooters.push({
      x: o.x !== undefined ? o.x : Math.random() * w,
      y: o.y !== undefined ? o.y : Math.random() * h * 0.6,
      dx: o.dx !== undefined ? o.dx : Math.cos(angle) * dir,
      dy: o.dy !== undefined ? o.dy : Math.sin(angle),
      spd: random(700, 1300) * dpr,
      len: (o.long ? random(160, 340) : random(80, 220)) * dpr,
      life: 0,
      maxLife: 0.5 + Math.random() * 0.7
    });
  }

  function drawShooters(dt, hue) {
    if (cfg.shootingstars && Math.random() < cfg.shootingfreq / 60 * dt) spawnShooter();

    for (var i = shooters.length - 1; i >= 0; i--) {
      var s = shooters[i];
      s.life += dt;
      if (s.life >= s.maxLife) { shooters.splice(i, 1); continue; }

      s.x += s.dx * s.spd * dt;
      s.y += s.dy * s.spd * dt;
      var fade = Math.sin(s.life / s.maxLife * Math.PI);
      var tx = s.x - s.dx * s.len, ty = s.y - s.dy * s.len;

      var g = sctx.createLinearGradient(s.x, s.y, tx, ty);
      g.addColorStop(0, 'rgba(255, 255, 255, ' + fade + ')');
      g.addColorStop(0.3, hsla(hue, cfg.sat, 70, fade * 0.5));
      g.addColorStop(1, 'transparent');

      sctx.globalAlpha = 1;
      sctx.strokeStyle = g;
      sctx.lineWidth = 1.6 * dpr;
      sctx.lineCap = 'round';
      sctx.beginPath();
      sctx.moveTo(s.x, s.y);
      sctx.lineTo(tx, ty);
      sctx.stroke();

      sctx.globalAlpha = fade;
      sctx.drawImage(getSprite(hue, cfg.sat, cfg.light), s.x - 6 * dpr, s.y - 6 * dpr, 12 * dpr, 12 * dpr);
    }
  }

  // ---------------------------------------------------------------------------
  // Click-and-drag black hole
  //
  // Click: gravitational wave. Hold (or drag) the mouse: a black hole follows
  // the cursor; nearby stars spiral in and vanish past the horizon, the lens
  // bends the scene around it and the nebula is pulled into a whirlpool.
  // Release: the stars spring back and a shockwave fires, stronger the longer
  // the hole was held.
  //
  // While held, it devours planets pulled in from off-screen (planets.js) and
  // grows slowly with every one of them. Easter egg: after enough mass it
  // becomes supermassive, with a glowing orange accretion disk.
  // ---------------------------------------------------------------------------
  function holeRadius(r) {
    return Math.min(r.w, h) * 0.2 * Math.sqrt(cfg.holestrength) * hole.grow;
  }

  function startHole(x, y) {
    if (hole.power < 0.05) hole.spin = 0;
    hole.active = true;
    hole.charge = 0;
    hole.region = regionAt(x).index;
    hole.x = hole.tx = x;
    hole.y = hole.ty = y;
  }

  function releaseHole() {
    if (!hole.active) return;
    hole.active = false;
    var r = regions[hole.region];
    var strength = hole.supermassive ? 2.6 : 0.6 + Math.min(1.2, hole.charge * 0.45);
    // The supermassive hole sends out a spiral, like a merging binary
    if (r) spawnWave(hole.x - r.px * 0.6, hole.y - r.py * 0.6, r.index, strength, hole.supermassive);
  }

  function updateHole(dt) {
    if (hole.active) {
      hole.power += (1 - hole.power) * (1 - Math.exp(-dt * 2.5));
      hole.charge += dt;
    } else {
      hole.power *= Math.exp(-dt * 5);
      if (hole.power < 0.004) {
        // Session over: the next hole starts small again
        hole.power = 0;
        hole.mass = 0;
        hole.grow = 1;
        hole.supermassive = false;
        hole.superT = 0;
      }
    }
    var k = 1 - Math.exp(-dt * 10);
    hole.x += (hole.tx - hole.x) * k;
    hole.y += (hole.ty - hole.y) * k;
    hole.spin += dt * 2.2;

    // Easter egg: enough mass turns it supermassive
    if (hole.active && !hole.supermassive && hole.mass >= SUPERMASSIVE_MASS) {
      hole.supermassive = true;
      var r = regions[hole.region];
      if (r) spawnWave(hole.x - r.px * 0.6, hole.y - r.py * 0.6, r.index, 2, true);
    }
    if (hole.supermassive) hole.superT = Math.min(1, hole.superT + dt / 2.5);
    var target = (1 + 0.055 * Math.min(hole.mass, SUPERMASSIVE_MASS)) * (1 + 0.55 * hole.superT);
    hole.grow += (target - hole.grow) * (1 - Math.exp(-dt * 0.8));
  }

  // What planets.js needs to know about the hole this frame (one object,
  // refilled every frame)
  var planetEnv = { getSprite: getSprite };

  function holeEnv() {
    var r = regions[hole.region];
    var hr = r ? holeRadius(r) : 0, rE = hr * 0.3 * hole.power, unit = Math.max(1, h / 1080);
    var horizon = Math.max(rE * 0.6, 3 * unit), S = Math.min(w, h);
    var str = Math.sqrt(cfg.holestrength);
    planetEnv.active = hole.power > 0.002;       // the hole exists (also while fading out)
    planetEnv.holding = hole.active;             // the mouse is still holding it
    planetEnv.x = hole.x;
    planetEnv.y = hole.y;
    planetEnv.power = hole.power;
    planetEnv.mass = hole.mass;
    // Gravity: strong enough to capture planets passing within ~1/3 screen
    planetEnv.gm = 0.006 * S * S * S * hole.power * str * Math.pow(hole.grow, 1.5);
    planetEnv.soft2 = horizon * horizon;
    planetEnv.infl = 0.45 * S * str * Math.sqrt(hole.grow);
    planetEnv.horizon = horizon;
    // Capped so a planet is never torn apart before it is on screen
    planetEnv.tidal = Math.min(0.3 * S, Math.max(horizon * 6, hr * 1.05));
    planetEnv.w = w;
    planetEnv.h = h;
    planetEnv.unit = unit;
    planetEnv.flat = hole.superT;
    planetEnv.pass = cfg.planets;
    planetEnv.passRate = cfg.planetfreq;
    planetEnv.attract = cfg.holedrag && cfg.holeplanets;
    planetEnv.jets = cfg.holejets;
    return planetEnv;
  }

  // Lens parameters for the hole (null when it is gone), reused every frame
  var ORANGE = [1, 0.55, 0.18];
  var holeL = { color: [0, 0, 0], disk: null }, holeDisk = { flat: 0.2 }, ringKey = '', ringRGB = null;

  function holeLens() {
    var r = regions[hole.region];
    if (!r || hole.power <= 0.002) return null;
    var hr = holeRadius(r), rE = hr * 0.3 * hole.power, shadow = rE * 0.6, st = hole.superT;
    var key = cfg.hue + '|' + cfg.sat;
    if (key !== ringKey) {
      ringKey = key;
      ringRGB = util.hslToRgb(cfg.hue, Math.max(40, cfg.sat) / 100, 0.7);
    }
    holeL.x = hole.x;
    holeL.y = hole.y;
    holeL.rE = rE;
    holeL.shadow = shadow;
    holeL.swirl = hole.power * 1.3;
    holeL.swirlR = hr * 0.8;
    holeL.glow = (0.34 + 0.3 * st) * hole.power;
    holeL.spin = hole.spin;
    // The photon ring turns orange as the hole becomes supermassive
    for (var i = 0; i < 3; i++) holeL.color[i] = ringRGB[i] / 255 * (1 - st) + ORANGE[i] * st;
    holeL.disk = null;
    if (st > 0.01) {
      holeDisk.intensity = st * hole.power;
      holeDisk.inner = shadow * 1.6;
      holeDisk.outer = shadow * 5.5;
      holeL.disk = holeDisk;
    }
    return holeL;
  }

  function clickWave(x, y) {
    var r = regionAt(x);
    spawnWave(x - r.px * 0.6, y - r.py * 0.6, r.index, 1);
  }

  // A press becomes a hold once it moves or after HOLD_MS
  function beginHold() {
    press.hold = true;
    startHole(press.x, press.y);
    if (mouse.inside) { hole.tx = mouse.x; hole.ty = mouse.y; }
  }

  function updatePointer(now) {
    if (press && !press.hold && cfg.holedrag && now - press.t > HOLD_MS) beginHold();
  }

  function endPress() {
    if (!press) return;
    if (press.hold) releaseHole();
    else if (cfg.waveclick && regions.length) clickWave(press.x, press.y);
    press = null;
  }

  // ---------------------------------------------------------------------------
  // Chain lightning (audio)
  //
  // Bass beats fire a bolt from near the core that hops outward from star to
  // star, with branches; treble hits fire short sparks between stars near the
  // edge (the edge is the treble side, like the spectrum-by-radius effect).
  // Bolts follow the stars as they move, and every star hit flashes.
  // ---------------------------------------------------------------------------
  function randomDir() {
    var a = Math.random() * TAU;
    return [Math.cos(a), Math.sin(a)];
  }

  function onScreen(r, st) {
    return st.sx >= r.x0 && st.sx <= r.x0 + r.w && st.sy >= 0 && st.sy <= h;
  }

  function pickStart(r, lo, hi) {
    var stars = r.stars;
    for (var tries = 0; tries < 80; tries++) {
      var st = stars[(Math.random() * stars.length) | 0];
      if (st && st.frac >= lo && st.frac <= hi && onScreen(r, st)) return st;
    }
    return null;
  }

  // Next hop: about 60% of the reach away (long, visible jumps), ahead of the
  // current heading, preferably a bigger star
  function nextStar(r, cur, dir, minD, maxD, id) {
    var stars = r.stars, best = null, bestScore = Infinity;
    var min2 = minD * minD, max2 = maxD * maxD, target = maxD * 0.6;
    for (var i = 0; i < stars.length; i++) {
      var st = stars[i];
      if (st.bolt === id) continue;
      var dx = st.sx - cur.sx, dy = st.sy - cur.sy, d2 = dx * dx + dy * dy;
      if (d2 < min2 || d2 > max2) continue;
      var d = Math.sqrt(d2), dot = dir ? (dx * dir[0] + dy * dir[1]) / d : 1;
      if (dot < 0.2 || !onScreen(r, st)) continue;
      var score = (Math.abs(d - target) + maxD * 0.15) * (1.7 - dot) / (0.6 + Math.min(1.5, st.radius / 12)) * (0.7 + Math.random() * 0.6);
      if (score < bestScore) { bestScore = score; best = st; }
    }
    return best;
  }

  function chainFrom(r, start, dir, hops, minD, maxD, id) {
    var path = [start], cur = start;
    start.bolt = id;
    for (var i = 0; i < hops; i++) {
      var nx = nextStar(r, cur, dir, minD, maxD, id);
      if (!nx) break;
      nx.bolt = id;
      var dx = nx.sx - cur.sx, dy = nx.sy - cur.sy, d = Math.sqrt(dx * dx + dy * dy) || 1;
      // Keep the general heading, with some wander
      var hx = (dir ? dir[0] : 0) + dx / d, hy = (dir ? dir[1] : 0) + dy / d, hl = Math.sqrt(hx * hx + hy * hy) || 1;
      dir = [hx / hl, hy / hl];
      path.push(nx);
      cur = nx;
    }
    return path;
  }

  function spawnBolt(r, kind, strength) {
    var bass = kind === 'bass', amt = cfg.lightningamt;
    var maxD = r.cornerR * (bass ? 0.2 : 0.1), minD = maxD * 0.25;
    var hops = bass ? Math.round(4 + 8 * strength * amt) : Math.round(1 + 2 * amt * strength);
    var main = null, id = 0, dir = null;

    // A few attempts: the outer ring is sparse, a start may have no neighbor
    for (var attempt = 0; attempt < 4 && !main; attempt++) {
      var start = bass ? pickStart(r, 0, 0.2) : pickStart(r, 0.45, 1);
      if (!start) continue;
      id = ++boltSeq;
      if (bass) {
        // Bass bolts head outward from the core
        var ox = start.sx - r.cx, oy = start.sy - r.cy, od = Math.sqrt(ox * ox + oy * oy);
        dir = od > 1 ? [ox / od, oy / od] : randomDir();
      } else {
        dir = null;   // sparks may jump any way
      }
      var path = chainFrom(r, start, dir, hops, minD, maxD, id);
      if (path.length >= 2) main = path;
    }
    if (!main) return;
    if (!dir) {
      var fx = main[1].sx - main[0].sx, fy = main[1].sy - main[0].sy, fl = Math.sqrt(fx * fx + fy * fy) || 1;
      dir = [fx / fl, fy / fl];
    }

    var chains = [{ path: main, at: 0, width: bass ? 1 : 0.55, hit: -1 }];
    if (bass) {
      // Branches fork off the main bolt
      var forks = Math.random() < Math.min(0.9, 0.4 * amt) ? 2 : 1;
      for (var f = 0; f < forks && main.length > 3; f++) {
        var at = 1 + ((Math.random() * (main.length - 2)) | 0);
        var a = main[at - 1], b = main[at];
        var bx = b.sx - a.sx, by = b.sy - a.sy, bl = Math.sqrt(bx * bx + by * by) || 1;
        var turn = (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.5);
        var bd = [(bx * Math.cos(turn) - by * Math.sin(turn)) / bl, (bx * Math.sin(turn) + by * Math.cos(turn)) / bl];
        var br = chainFrom(r, b, bd, 2 + ((Math.random() * 3 * amt) | 0), minD, maxD * 0.8, id);
        if (br.length > 1) chains.push({ path: br, at: at, width: 0.55, hit: -1 });
      }
    }

    var hop = bass ? 0.022 : 0.014, tail = bass ? 0.35 : 0.16;
    if (bolts.length >= 10) bolts.shift();
    bolts.push({
      chains: chains, age: 0, hop: hop, tail: tail,
      life: (main.length - 1) * hop + tail,
      power: Math.min(1.2, (bass ? 1 : 0.75) * (0.55 + 0.45 * strength) * Math.min(1.3, 0.6 + 0.4 * amt))
    });
  }

  // Jagged segment from a to b (up to frac of the way), appended to pts
  function jag(pts, a, b, frac) {
    var ax = a.sx, ay = a.sy, dx = b.sx - ax, dy = b.sy - ay;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var n = clamp(Math.round(len / (14 * dpr)), 2, 12), nx = -dy / len, ny = dx / len;
    var last = Math.max(1, Math.round(n * frac));
    for (var k = 1; k <= last; k++) {
      var t = k / n, off = k < n ? (Math.random() * 2 - 1) * len * 0.11 * Math.sin(Math.PI * t) : 0;
      pts.push(ax + dx * t + nx * off, ay + dy * t + ny * off);
    }
  }

  function strokeBolt(pts, width, alpha, hue) {
    if (pts.length < 4) return;
    var unit = Math.max(1, h / 1080);
    sctx.beginPath();
    sctx.moveTo(pts[0], pts[1]);
    for (var i = 2; i < pts.length; i += 2) sctx.lineTo(pts[i], pts[i + 1]);
    sctx.globalAlpha = 1;
    sctx.lineWidth = 16 * unit * width;
    sctx.strokeStyle = hsla(hue, cfg.sat, 60, 0.16 * alpha);
    sctx.stroke();
    sctx.lineWidth = 5 * unit * width;
    sctx.strokeStyle = hsla(hue, cfg.sat, 72, 0.5 * alpha);
    sctx.stroke();
    sctx.lineWidth = 2 * unit * width;
    sctx.strokeStyle = hsla(hue, 30, 96, Math.min(1, alpha));
    sctx.stroke();
  }

  var boltPts = [];
  function drawBolts(dt, hue) {
    if (!bolts.length) return;
    sctx.lineJoin = 'round';
    sctx.lineCap = 'round';
    for (var i = bolts.length - 1; i >= 0; i--) {
      var b = bolts[i];
      b.age += dt;
      if (b.age >= b.life) { bolts.splice(i, 1); continue; }
      var fade = 1 - util.smoothstep(b.life - b.tail, b.life, b.age);
      var alpha = fade * b.power * (0.65 + 0.35 * Math.random());   // electric flicker

      for (var c = 0; c < b.chains.length; c++) {
        var ch = b.chains[c], path = ch.path;
        var t = b.age / b.hop - ch.at;
        if (t <= 0) continue;
        var full = Math.min(path.length - 1, Math.floor(t));
        boltPts.length = 0;
        boltPts.push(path[0].sx, path[0].sy);
        for (var j = 0; j < full; j++) jag(boltPts, path[j], path[j + 1], 1);
        if (full < path.length - 1) jag(boltPts, path[full], path[full + 1], t - full);  // traveling head
        // Every star reached flashes once
        for (j = ch.hit + 1; j <= full; j++) path[j].flash = 1;
        ch.hit = Math.max(ch.hit, full);
        strokeBolt(boltPts, ch.width, alpha, hue);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Hyperspace jump (on the drop)
  //
  // The stars stream out of the center as streaks (and the lens blurs the
  // whole scene outward), a flash at the way out hides the switch to a new
  // sky (star positions and nebula shape), then everything settles and an
  // arrival wave rolls out.
  // ---------------------------------------------------------------------------
  var WARP_IN = 0.6, WARP_HOLD = 1.0, WARP_OUT = 1.2;
  var warp = { t: -1, level: 0, clock: 0, rate: 0, flash: 0, jumped: false, arrived: false, amount: 0 };
  var skyShift = 0;   // how many jumps: picks the nebula shape

  function startWarp() {
    if (warp.t >= 0 || !regions.length) return false;
    warp.t = 0;
    warp.clock = 0;
    warp.jumped = warp.arrived = false;
    return true;
  }

  function newSky() {
    skyShift++;
    events.clear();
    regions.forEach(function (r) {
      r.nebAngle = Math.random() * TAU;
      r.stars.forEach(function (st) {
        st.t = Math.random() * TAU * 50;
        st.alpha = random(2, 10) / 10;
      });
    });
  }

  function updateWarp(dt) {
    warp.flash *= Math.exp(-dt * 2.2);
    if (warp.t < 0) { warp.level = 0; return; }
    var t = warp.t += dt, out = WARP_IN + WARP_HOLD, end = out + WARP_OUT;
    warp.level = t < WARP_IN ? util.smoothstep(0, WARP_IN, t) : t < out ? 1 : 1 - util.smoothstep(out, end, t);
    warp.rate = 0.25 + 1.1 * warp.level;
    warp.clock += dt * warp.rate;
    if (!warp.jumped && t >= out) {
      warp.jumped = true;
      warp.flash = 1;
      newSky();
    }
    if (!warp.arrived && t >= out + WARP_OUT * 0.5) {
      warp.arrived = true;
      for (var i = 0; i < regions.length; i++) spawnWave(regions[i].cx, regions[i].cy, i, 1.3);
    }
    if (t >= end) {
      warp.t = -1;
      warp.level = 0;
    }
  }

  // Radial blur for the lens while jumping (null otherwise)
  var warpL = { amount: 0, w: 0, n: 1, centers: new Float32Array(8) };
  function warpLens() {
    if (warp.level < 0.003 || !regions.length) return null;
    warpL.amount = 0.16 * warp.level * warp.level;
    warpL.w = regions[0].w;
    warpL.n = Math.min(4, regions.length);
    for (var i = 0; i < warpL.n; i++) {
      warpL.centers[i * 2] = regions[i].cx;
      warpL.centers[i * 2 + 1] = regions[i].cy;
    }
    return warpL;
  }

  // The flash at the way out, plus the light at the end of the tunnel
  function drawWarpLight() {
    var f = warp.flash, glow = warp.level * 0.35;
    if (f < 0.005 && glow < 0.005) return;
    for (var i = 0; i < regions.length; i++) {
      var r = regions[i], R = r.cornerR * (0.35 + 0.95 * f);
      var g = ctx.createRadialGradient(r.cx, r.cy, 0, r.cx, r.cy, R);
      g.addColorStop(0, 'rgba(235, 242, 255, ' + Math.min(1, f * 0.95 + glow).toFixed(3) + ')');
      g.addColorStop(0.3, 'rgba(190, 210, 255, ' + Math.min(1, f * 0.55 + glow * 0.4).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(160, 190, 255, 0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.fillRect(r.x0, 0, r.w, h);
    }
  }

  // ---------------------------------------------------------------------------
  // Album colors (Wallpaper Engine media integration, media.js)
  //
  // While a song plays, the sky drifts to the colors of its cover; a new song
  // drifts to the new cover; a few seconds after it stops, back to the theme.
  // ---------------------------------------------------------------------------
  var mediaMix = 0, mediaStopped = 99, mediaCol = null, mediaApplied = false, mediaBgKey = '';

  function lerpHue(a, b, k) {
    var d = ((b - a) % 360 + 540) % 360 - 180;
    return a + d * k;
  }

  function updateMedia(dt) {
    var m = media.state, pal = m.palette;
    mediaStopped = m.playing ? 0 : mediaStopped + dt;
    var target = cfg.mediacolors && m.enabled && pal && mediaStopped < 4 ? 1 : 0;
    mediaMix += (target - mediaMix) * (1 - Math.exp(-dt * (target ? 1.2 : 0.7)));
    if (pal) {
      var hue2 = pal.hue2 !== null ? pal.hue2 : pal.hue + cfg.baseNebHue;
      if (!mediaCol) {
        mediaCol = { hue: pal.hue, sat: pal.sat, light: pal.light, hue2: hue2 };
      } else {
        var k = 1 - Math.exp(-dt * 1.5);
        mediaCol.hue = lerpHue(mediaCol.hue, pal.hue, k);
        mediaCol.hue2 = lerpHue(mediaCol.hue2, hue2, k);
        mediaCol.sat += (pal.sat - mediaCol.sat) * k;
        mediaCol.light += (pal.light - mediaCol.light) * k;
      }
    }
    if (mediaMix < 0.005 || !mediaCol) {
      if (mediaApplied) {
        // Exactly the theme again
        cfg.hue = cfg.baseHue;
        cfg.sat = cfg.baseSat;
        cfg.light = cfg.baseLight;
        cfg.nebulahue = cfg.baseNebHue;
        cfg.bgCSS = cfg.baseBgCSS;
        mediaApplied = false;
      }
      return;
    }
    mediaApplied = true;
    var mk = mediaMix;
    cfg.hue = (lerpHue(cfg.baseHue, mediaCol.hue, mk) % 360 + 360) % 360;
    cfg.sat = cfg.baseSat + (mediaCol.sat - cfg.baseSat) * mk;
    cfg.light = cfg.baseLight + (mediaCol.light - cfg.baseLight) * mk;
    var off = ((mediaCol.hue2 - mediaCol.hue) % 360 + 540) % 360 - 180;
    cfg.nebulahue = cfg.baseNebHue + (off - cfg.baseNebHue) * mk;
    if (!cfg.custombg) {
      var bgKey = Math.round(cfg.hue) + '|' + Math.round(cfg.sat);
      if (bgKey !== mediaBgKey) {
        mediaBgKey = bgKey;
        cfg.bgCSS = 'hsl(' + Math.round(cfg.hue) + ', ' + Math.min(100, Math.round(cfg.sat) + 3) + '%, 6%)';
      }
    }
  }

  media.state.onChange = function () { clock.setSong(media.state); };

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------
  var p = {};   // per-frame star parameters (reused)
  var musicQuiet = 99, musicMix = 0;   // seconds without sound; 0–1 "music is playing"

  function render(dt) {
    var A = audio.state, on = cfg.audioenabled, sens = cfg.audiosensitivity;
    var bassFx = on && cfg.audiobass ? A.bass * A.bass * cfg.audiobassamt * sens : 0;
    var speedMul = cfg.speed * (1 + (on && cfg.audiospeed ? A.volume * cfg.audiospeedamt * sens : 0));
    var dir = cfg.clockwise ? -1 : 1;
    var nebPulse = on && cfg.audionebula ? A.bass * cfg.audionebulaamt * sens : 0;
    updateMedia(dt);
    updateWarp(dt);
    p.dt = dt;
    // With the lens on it already displaces the stars, so the direct push is smaller
    p.pushMul = lens.ok() && cfg.wavelens ? 0.5 : 1;
    p.step = dt * 60 * speedMul * dir;
    // While music plays the stars rest smaller (audioshrinksize) and every
    // reaction still grows from the normal size, so the beats stand out. They
    // return to normal after 1.5 s of silence.
    musicQuiet = A.raw > 0.001 ? 0 : musicQuiet + dt;
    var playing = on && cfg.audioshrink && musicQuiet < 1.5;
    musicMix += ((playing ? 1 : 0) - musicMix) * (1 - Math.exp(-dt * (playing ? 2.5 : 1.2)));
    var rest = 1 - (1 - cfg.audioshrinksize) * musicMix;
    p.sizeMul = cfg.starsize * (1 + bassFx * 0.8);
    p.shrink = cfg.starsize * (1 - rest);
    // A smaller star flashes brighter on the beat
    p.alphaMul = 1 + bassFx / rest;
    p.freqAmt = on && cfg.audiofreq ? cfg.audiofreqamt * sens : 0;
    p.hueShift = on && cfg.audiohue ? A.volume * cfg.audiohueamt * sens : 0;
    p.twinkleP = cfg.twinkle ? (1 / 11) * dt * 60 * cfg.twinklestrength : 0;
    var hue = cfg.hue + p.hueShift, i;

    updateParallax(dt);
    updateHole(dt);
    var env = holeEnv();
    var swallowed = planets.update(dt, env);
    if (hole.power > 0) hole.mass += swallowed;
    events.update(dt, cfg, env, warp.t >= 0);
    updateWaves(dt);
    updateNebula(dt, nebPulse);

    // 1. Stars: black background with trails, additive glow
    sctx.globalCompositeOperation = 'source-over';
    // Hyperspace: long trails turn the stars into lines
    sctx.globalAlpha = cfg.trail * (1 - 0.75 * warp.level);
    sctx.fillStyle = '#000';
    sctx.fillRect(0, 0, w, h);
    sctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < regions.length; i++) drawStars(regions[i], p);
    drawShooters(dt, hue);
    drawBolts(dt, hue);
    planets.drawDebris(sctx, env);

    // 2. Scene
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = cfg.bgCSS;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < regions.length; i++) drawBackdrop(regions[i], dt, speedMul * dir, nebPulse);
    events.drawBack(ctx);
    ctx.globalAlpha = 1;
    ctx.drawImage(starCanvas, 0, 0);
    planets.drawPlanets(ctx, env);
    planets.drawJets(ctx, env, dt);
    ctx.globalCompositeOperation = 'lighter';
    events.drawFront(ctx);
    drawWarpLight();
    ctx.globalCompositeOperation = 'source-over';

    // 3. Gravitational lens
    applyLens();

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
    // The host may hide the wallpaper (e.g. a CasaOS page without background)
    if (host.active && !host.active()) return;
    updatePointer(now);

    audio.update(dt, cfg.audioenabled, cfg.audiosensitivity);
    if (cfg.pauseonsilence && cfg.audioenabled && audio.state.source && audio.state.silentFor > 1.5) return;

    time += dt;
    render(dt);
  }

  audio.state.onBeat = function (strength) {
    if (cfg.wavebeat) {
      for (var i = 0; i < regions.length; i++) spawnWave(regions[i].cx, regions[i].cy, i, strength);
    }
    if (cfg.shootingstars && cfg.shootingbeat && shooters.length < 6 && Math.random() < 0.45) spawnShooter();
    if (cfg.lightning) {
      for (var k = 0; k < regions.length; k++) spawnBolt(regions[k], 'bass', strength);
    }
  };

  audio.state.onDrop = function () {
    if (cfg.hyperspace) startWarp();
  };

  audio.state.onTreble = function (strength) {
    if (cfg.lightning && cfg.lightningsparks && regions.length) {
      spawnBolt(regions[(Math.random() * regions.length) | 0], 'spark', strength);
    }
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

  // Click → wave on release. Hold or drag → black hole, shockwave on release.
  // Presses count when they land on the wallpaper; a host drawn behind another
  // UI (CasaOS) decides which presses are on its "empty background".
  function pointerOk(e) {
    return host.pointerTarget ? host.pointerTarget(e) : e.target === canvas;
  }

  document.addEventListener('mousedown', function (e) {
    if (e.button !== 0 || !regions.length || !pointerOk(e)) return;
    if (host.pointerTarget) e.preventDefault();   // no text selection while dragging
    press = { x: e.clientX * dpr, y: e.clientY * dpr, t: performance.now(), hold: false };
  });

  window.addEventListener('mousemove', function (e) {
    mouse.x = e.clientX * dpr;
    mouse.y = e.clientY * dpr;
    mouse.inside = true;
    if (!press) return;
    if (!press.hold && cfg.holedrag && Math.hypot(mouse.x - press.x, mouse.y - press.y) > 10 * dpr) beginHold();
    if (press.hold) {
      hole.tx = mouse.x;
      hole.ty = mouse.y;
    }
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
  if (!isWE) loadSaved();
  lens.init();
  events.init({
    regions: function () { return regions; },
    size: function () { return { w: w, h: h, unit: Math.max(1, h / 1080) }; },
    getSprite: getSprite,
    // Given where it is seen (with the parallax), like a click
    spawnWave: function (x, y, ri, strength) {
      var r = regions[ri];
      if (r) spawnWave(x - r.px * 0.6, y - r.py * 0.6, ri, strength);
    },
    spawnShooter: spawnShooter,
    spawnPlanet: function (gas, x, y, vx, vy) { return planets.spawnAt(holeEnv(), gas, x, y, vx, vy); }
  });
  nebulaGL.init();
  clock.init();
  refresh();
  clock.setSong(media.state);   // in case Wallpaper Engine told the song before the clock existed
  menu.init(app);
  if (!isWE && host.startupHint !== false) menu.toast(i18n.t('toast.open'), 3500);
  rafId = requestAnimationFrame(frame);

  // Console access for debugging
  S.app = app;
  S.debug = {
    cfg: cfg,
    effective: function () { return eff; },
    spawnWave: function (strength) { spawnWave(regions[0].cx, regions[0].cy, 0, strength || 1); },
    regions: function () { return regions; },
    waveCount: function () { return waves.length; },
    waveTotal: function () { return waveTotal; },
    waves: function () { return waves; },
    bolts: function () { return bolts; },
    hole: hole,
    spawnBolt: function (kind, strength) { spawnBolt(regions[0], kind || 'bass', strength || 1); },
    spawnPlanet: function (gas, mode) { return planets.spawn(holeEnv(), gas, mode); },
    holeEnv: function () { return holeEnv(); },
    lensOK: function () { return lens.ok(); },
    nebulaGL: function () { return nebulaGL.ok(); },
    music: function () { return musicMix; },
    hyperspace: function () { return startWarp(); },
    warp: warp,
    skyShift: function () { return skyShift; },
    event: function (kind) { return events.trigger(kind); },
    albumMix: function () { return mediaMix; },
    // Renders one frame on demand (deterministic tests)
    step: function (dt) {
      audio.update(dt, cfg.audioenabled, cfg.audiosensitivity);
      time += dt;
      render(dt);
    },
    nebula: neb
  };
})(window.Starry);
