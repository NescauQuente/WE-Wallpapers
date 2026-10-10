/*
 * Starry Orbit — rare cosmic events.
 *
 * Every few minutes (on average) something happens in the sky:
 *  - supernova: a star flares up and explodes (sending out a gravitational
 *    wave), leaving an expanding remnant of glowing filaments with a pulsar
 *    blinking inside;
 *  - comet: crosses the screen bending around the galactic core, with a
 *    straight blue ion tail pointing away from it and a curved dust tail;
 *  - meteor shower: a burst of shooting stars, all from one radiant point;
 *  - planet parade: planets crossing the screen in single file.
 *
 * main.js lends the stars, sprites, waves, shooting stars and planets (init)
 * and draws the two layers: behind the stars (remnants) and in front of them.
 */
(function (S) {
  'use strict';

  var util = S.util;
  var TAU = Math.PI * 2;
  var KINDS = [['supernova', 0.32], ['comet', 0.3], ['meteors', 0.23], ['parade', 0.15]];
  var NOVA_RISE = 2.8;     // seconds of flaring before the explosion
  var NOVA_LIFE = 58;      // seconds the remnant lasts

  // api: { regions(), size() → { w, h, unit }, getSprite(h, s, l),
  //        spawnWave(x, y, region, strength), spawnShooter({ x, y, dx, dy }),
  //        spawnPlanet(gas, x, y, vx, vy) }
  var api = null;
  var active = [];
  var timer = 60 + Math.random() * 90;   // the first one comes early, to be discovered
  var lastKind = '';

  function init(a) { api = a; }

  function pickKind() {
    var kind = KINDS[0][0];
    for (var tries = 0; tries < 6; tries++) {
      var r = Math.random(), acc = 0;
      for (var i = 0; i < KINDS.length; i++) {
        acc += KINDS[i][1];
        kind = KINDS[i][0];
        if (r <= acc) break;
      }
      if (kind !== lastKind) break;
    }
    return kind;
  }

  function randomRegion() {
    var regs = api.regions();
    return regs[(Math.random() * regs.length) | 0];
  }

  // ---------------------------------------------------------------------------
  // Supernova
  // ---------------------------------------------------------------------------

  // A star well inside the screen, preferably a big (close) one
  function pickStar(r) {
    var stars = r.stars, h = api.size().h, best = null;
    for (var tries = 0; tries < 160 && !(best && tries > 40); tries++) {
      var st = stars[(Math.random() * stars.length) | 0];
      if (!st || st.gone || st.frac < 0.08 || st.frac > 0.55) continue;
      if (st.sx < r.x0 + r.w * 0.1 || st.sx > r.x0 + r.w * 0.9 || st.sy < h * 0.12 || st.sy > h * 0.88) continue;
      if (!best || st.radius > best.radius) best = st;
    }
    return best;
  }

  // Filaments of the remnant, drawn once: a blue-green glow inside (like the
  // Crab nebula) and a shell of red and teal threads
  function remnantSprite() {
    var N = 256, c = N / 2, cv = document.createElement('canvas');
    cv.width = cv.height = N;
    var g = cv.getContext('2d');
    g.globalCompositeOperation = 'lighter';
    var inner = g.createRadialGradient(c, c, 0, c, c, c * 0.75);
    inner.addColorStop(0, 'hsla(190, 80%, 60%, 0.35)');
    inner.addColorStop(0.6, 'hsla(200, 70%, 45%, 0.12)');
    inner.addColorStop(1, 'hsla(210, 70%, 40%, 0)');
    g.fillStyle = inner;
    g.fillRect(0, 0, N, N);
    var shell = g.createRadialGradient(c, c, c * 0.5, c, c, c);
    shell.addColorStop(0, 'hsla(350, 80%, 55%, 0)');
    shell.addColorStop(0.6, 'hsla(355, 85%, 55%, 0.2)');
    shell.addColorStop(0.85, 'hsla(15, 90%, 60%, 0.1)');
    shell.addColorStop(1, 'hsla(20, 90%, 60%, 0)');
    g.fillStyle = shell;
    g.fillRect(0, 0, N, N);
    g.lineCap = 'round';
    for (var i = 0; i < 160; i++) {
      var a = Math.random() * TAU, rr = c * (0.42 + Math.random() * 0.52);
      var a1 = a + (Math.random() < 0.5 ? -1 : 1) * (0.08 + Math.random() * 0.3);
      var r1 = rr + (Math.random() - 0.5) * c * 0.14, bend = (Math.random() - 0.5) * c * 0.16;
      var x0 = c + Math.cos(a) * rr, y0 = c + Math.sin(a) * rr;
      var x1 = c + Math.cos(a1) * r1, y1 = c + Math.sin(a1) * r1;
      var mx = (x0 + x1) / 2 + Math.cos(a) * bend, my = (y0 + y1) / 2 + Math.sin(a) * bend;
      g.strokeStyle = Math.random() < 0.3
        ? 'hsla(' + (178 + Math.random() * 22) + ', 85%, 70%, ' + (0.25 + Math.random() * 0.35) + ')'
        : 'hsla(' + ((350 + Math.random() * 35) % 360) + ', 90%, ' + (55 + Math.random() * 15) + '%, ' + (0.3 + Math.random() * 0.45) + ')';
      g.lineWidth = 0.8 + Math.random() * 2;
      g.beginPath();
      g.moveTo(x0, y0);
      g.quadraticCurveTo(mx, my, x1, y1);
      g.stroke();
    }
    return cv;
  }

  function startSupernova() {
    var r = randomRegion(), st = pickStar(r);
    if (!st) return false;
    active.push({
      kind: 'supernova', t: 0, r: r, st: st, blown: false,
      rot: Math.random() * TAU, spin: (Math.random() - 0.5) * 0.02,
      Sm: Math.min(r.w, api.size().h),
      size: Math.min(r.w, api.size().h) * (0.15 + Math.random() * 0.08),
      sprite: remnantSprite()
    });
    return true;
  }

  function updateSupernova(e, dt) {
    e.t += dt;
    e.rot += e.spin * dt;
    if (!e.blown && e.t >= NOVA_RISE) {
      e.blown = true;
      e.st.gone = true;   // the star is no more (main.js stops drawing it)
      // Supernovae radiate gravitational waves too
      api.spawnWave(e.st.sx, e.st.sy, e.r.index, 0.9);
    }
    if (e.t >= NOVA_RISE + NOVA_LIFE) {
      e.st.gone = false;
      return false;
    }
    return true;
  }

  // Behind the stars: the expanding remnant
  function drawRemnant(c, e) {
    if (!e.blown) return;
    var age = e.t - NOVA_RISE;
    var a = util.smoothstep(0, 1.2, age) * (1 - util.smoothstep(NOVA_LIFE * 0.45, NOVA_LIFE, age));
    if (a < 0.003) return;
    var R = e.size * (0.08 + 0.92 * (1 - Math.exp(-age / 10)));
    c.save();
    c.globalAlpha = a;
    c.translate(e.st.sx, e.st.sy);
    c.rotate(e.rot);
    c.drawImage(e.sprite, -R, -R, R * 2, R * 2);
    c.restore();
  }

  function spike(c, x, y, dx, dy, a, width) {
    var g = c.createLinearGradient(x - dx, y - dy, x + dx, y + dy);
    g.addColorStop(0, 'rgba(200, 220, 255, 0)');
    g.addColorStop(0.5, 'rgba(235, 242, 255, ' + 0.8 * a + ')');
    g.addColorStop(1, 'rgba(200, 220, 255, 0)');
    c.globalAlpha = 1;
    c.strokeStyle = g;
    c.lineWidth = width;
    c.beginPath();
    c.moveTo(x - dx, y - dy);
    c.lineTo(x + dx, y + dy);
    c.stroke();
  }

  // In front: the flare, the explosion (with diffraction spikes) and the pulsar
  function drawNova(c, e) {
    var x = e.st.sx, y = e.st.sy, Sm = e.Sm, sz;
    if (!e.blown) {
      // Flaring up, flickering more and more, with a growing halo
      var k = e.t / NOVA_RISE, flick = 1 - 0.35 * k * Math.random();
      sz = Sm * (0.015 + 0.11 * k * k);
      c.globalAlpha = 0.35 * k * flick;
      c.drawImage(api.getSprite(215, 70, 70), x - sz, y - sz, sz * 2, sz * 2);
      c.globalAlpha = Math.min(1, (0.35 + 0.65 * k) * flick);
      c.drawImage(api.getSprite(205, 60, 88), x - sz / 2, y - sz / 2, sz, sz);
      return;
    }
    var age = e.t - NOVA_RISE;
    if (age < 4.5) {
      // The blast: a white core, a blue glow lighting up the sky around it,
      // and diffraction spikes
      var f = Math.exp(-age * 1.2), grow = 1 - Math.exp(-age * 6);
      sz = Sm * (0.12 + 0.5 * grow);
      c.globalAlpha = 0.6 * f;
      c.drawImage(api.getSprite(215, 70, 70), x - sz, y - sz, sz * 2, sz * 2);
      c.globalAlpha = f;
      c.drawImage(api.getSprite(200, 35, 92), x - sz / 2, y - sz / 2, sz, sz);
      spike(c, x, y, sz * 0.9, 0, f, Sm * 0.003);
      spike(c, x, y, 0, sz * 0.9, f, Sm * 0.003);
    }
    var pa = util.smoothstep(1.5, 4, age) * (1 - util.smoothstep(NOVA_LIFE * 0.6, NOVA_LIFE, age));
    if (pa > 0.01) {
      sz = Sm * 0.014;
      c.globalAlpha = pa * (0.35 + 0.65 * Math.max(0, Math.sin(e.t * 31)));
      c.drawImage(api.getSprite(200, 80, 85), x - sz / 2, y - sz / 2, sz, sz);
    }
  }

  // ---------------------------------------------------------------------------
  // Comet
  // ---------------------------------------------------------------------------
  function startComet() {
    var r = randomRegion(), h = api.size().h, Sm = Math.min(r.w, h);
    var side = (Math.random() * 4) | 0, t = Math.random(), m = Sm * 0.15, x, y;
    if (side === 0) { x = r.x0 + t * r.w; y = -m; }
    else if (side === 1) { x = r.x0 + r.w + m; y = t * h; }
    else if (side === 2) { x = r.x0 + t * r.w; y = h + m; }
    else { x = r.x0 - m; y = t * h; }
    // Aimed near the core, so it swings around it
    var tx = r.cx + (Math.random() - 0.5) * Sm * 0.7, ty = r.cy + (Math.random() - 0.5) * Sm * 0.7;
    var dx = tx - x, dy = ty - y, dl = Math.sqrt(dx * dx + dy * dy) || 1, sp = Sm / (8 + Math.random() * 4);
    active.push({
      kind: 'comet', t: 0, r: r, Sm: Sm, x: x, y: y, vx: dx / dl * sp, vy: dy / dl * sp,
      gm: 0.0008 * Sm * Sm * Sm, soft2: Sm * Sm * 0.0064,
      hist: [], histT: 0, entered: false, hue: 185 + Math.random() * 25
    });
    return true;
  }

  function updateComet(e, dt, env) {
    e.t += dt;
    var n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
    for (var i = 0; i < n; i++) {
      var dx = e.r.cx - e.x, dy = e.r.cy - e.y, d2 = dx * dx + dy * dy, d = Math.sqrt(d2) || 1;
      var a = e.gm / (d2 + e.soft2);
      e.vx += dx / d * a * h;
      e.vy += dy / d * a * h;
      // The click-and-drag black hole pulls it too, and can swallow it
      if (env && env.active) {
        var hx = env.x - e.x, hy = env.y - e.y, hd2 = hx * hx + hy * hy, hd = Math.sqrt(hd2) || 1;
        if (hd <= env.horizon) return false;
        var ha = env.gm / (hd2 + env.soft2);
        e.vx += hx / hd * ha * h;
        e.vy += hy / hd * ha * h;
      }
      e.x += e.vx * h;
      e.y += e.vy * h;
    }
    e.histT -= dt;
    if (e.histT <= 0) {
      e.histT = 0.05;
      e.hist.unshift(e.x, e.y);
      if (e.hist.length > 60) e.hist.length = 60;
    }
    var sz = api.size(), pad = e.Sm * 0.45;
    if (e.x > e.r.x0 && e.x < e.r.x0 + e.r.w && e.y > 0 && e.y < sz.h) e.entered = true;
    var gone = e.x < -pad || e.x > sz.w + pad || e.y < -pad || e.y > sz.h + pad;
    return !((e.entered && gone) || e.t > 45);
  }

  // A soft cone: several additive layers, wide and faint to narrow and bright
  var CONE_LAYERS = [[0.006, 0.05, 0.22], [0.0035, 0.025, 0.4], [0.0015, 0.009, 0.7]];
  function softCone(c, x, y, ax, ay, L, Sm, hue, fade) {
    var nx = -ay, ny = ax, tx = x + ax * L, ty = y + ay * L;
    for (var i = 0; i < CONE_LAYERS.length; i++) {
      var w0 = CONE_LAYERS[i][0] * Sm, w1 = CONE_LAYERS[i][1] * Sm, a = CONE_LAYERS[i][2] * fade;
      var g = c.createLinearGradient(x, y, tx, ty);
      g.addColorStop(0, 'hsla(' + hue + ', 90%, 72%, ' + a.toFixed(3) + ')');
      g.addColorStop(0.45, 'hsla(' + hue + ', 90%, 65%, ' + (a * 0.4).toFixed(3) + ')');
      g.addColorStop(1, 'hsla(' + hue + ', 90%, 60%, 0)');
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(x + nx * w0, y + ny * w0);
      c.lineTo(tx + nx * w1, ty + ny * w1);
      c.lineTo(tx - nx * w1, ty - ny * w1);
      c.lineTo(x - nx * w0, y - ny * w0);
      c.closePath();
      c.fill();
    }
  }

  function drawComet(c, e) {
    var x = e.x, y = e.y, Sm = e.Sm, fade = Math.min(1, e.t / 1.5);
    // Tails point away from the galactic core (its "sun")
    var ax = x - e.r.cx, ay = y - e.r.cy, al = Math.sqrt(ax * ax + ay * ay) || 1;
    ax /= al;
    ay /= al;

    // Dust tail: along the path behind, pushed outward the older it is,
    // widening and fading (a wide faint pass and a narrow brighter one)
    c.lineCap = 'round';
    c.globalAlpha = 1;
    var hist = e.hist, count = hist.length / 2;
    for (var pass = 0; pass < 2; pass++) {
      var px = x, py = y, wide = pass === 0;
      for (var i = 0; i < count; i++) {
        var age = (i + 1) * 0.05, k = 1 - i / count, push = age * age * Sm * 0.05;
        var hx = hist[i * 2] + ax * push, hy = hist[i * 2 + 1] + ay * push;
        c.strokeStyle = 'hsla(42, 70%, 78%, ' + ((wide ? 0.14 : 0.3) * k * fade).toFixed(3) + ')';
        c.lineWidth = Sm * (wide ? 0.008 + 0.05 * (1 - k) : 0.003 + 0.016 * (1 - k));
        c.beginPath();
        c.moveTo(px, py);
        c.lineTo(hx, hy);
        c.stroke();
        px = hx;
        py = hy;
      }
    }

    // Ion tail: straight and blue
    softCone(c, x, y, ax, ay, Sm * 0.45, Sm, e.hue, fade);

    // Coma and nucleus
    var cs = Sm * 0.16, ns = Sm * 0.03;
    c.globalAlpha = 0.9 * fade;
    c.drawImage(api.getSprite(e.hue, 70, 78), x - cs / 2, y - cs / 2, cs, cs);
    c.globalAlpha = fade;
    c.drawImage(api.getSprite(200, 20, 95), x - ns / 2, y - ns / 2, ns, ns);
  }

  // ---------------------------------------------------------------------------
  // Meteor shower
  // ---------------------------------------------------------------------------
  function startMeteors() {
    var r = randomRegion(), h = api.size().h;
    active.push({
      kind: 'meteors', t: 0, next: 0, dur: 7 + Math.random() * 3, r: r,
      // The radiant: a point above the screen every meteor seems to come from
      rx: r.x0 + r.w * (0.2 + Math.random() * 0.6), ry: -h * (0.2 + Math.random() * 0.4)
    });
    return true;
  }

  function updateMeteors(e, dt) {
    e.t += dt;
    var h = api.size().h;
    while (e.t >= e.next && e.next < e.dur) {
      var px = e.r.x0 + Math.random() * e.r.w, py = Math.random() * h * 0.85;
      var dx = px - e.rx, dy = py - e.ry, dl = Math.sqrt(dx * dx + dy * dy) || 1;
      api.spawnShooter({ x: px, y: py, dx: dx / dl, dy: dy / dl, long: true });
      // Busier in the middle of the shower
      var mid = 1 - Math.abs(e.next / e.dur - 0.5) * 2;
      e.next += 0.03 + (1 - mid) * 0.25 * Math.random() + 0.06 * Math.random();
    }
    return e.t < e.dur + 1.5;
  }

  // ---------------------------------------------------------------------------
  // Planet parade: single file along a line through the screen
  // ---------------------------------------------------------------------------
  function startParade() {
    var r = randomRegion(), h = api.size().h, Sm = Math.min(r.w, h);
    var dir = Math.random() < 0.5 ? 1 : -1, ang = (Math.random() - 0.5) * 0.35;
    var dx = Math.cos(ang) * dir, dy = Math.sin(ang);
    var cy = h * (0.3 + Math.random() * 0.4), sp = Sm / 15, gap = Sm * 0.2;
    var startX = dir > 0 ? r.x0 - Sm * 0.12 : r.x0 + r.w + Sm * 0.12;
    var s0 = (startX - r.cx) / dx, n = 4 + (Math.random() < 0.5 ? 1 : 0);
    for (var i = 0; i < n; i++) {
      var s = s0 - i * gap;
      api.spawnPlanet(i % 2 === 1 || Math.random() < 0.2, r.cx + dx * s, cy + dy * s, dx * sp, dy * sp);
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Scheduling and drawing
  // ---------------------------------------------------------------------------
  function trigger(kind) {
    if (!api || !api.regions().length) return false;
    lastKind = kind;
    if (kind === 'supernova') return startSupernova();
    if (kind === 'comet') return startComet();
    if (kind === 'meteors') return startMeteors();
    if (kind === 'parade') return startParade();
    return false;
  }

  // cfg: settings (events, eventsfreq); env: the black hole (planets.js
  // format); busy: something big is going on (hyperspace), wait for it
  function update(dt, cfg, env, busy) {
    if (!api || !api.regions().length) return;
    if (cfg.events) {
      timer -= dt;
      if (timer <= 0) {
        if (busy) {
          timer = 5;
        } else {
          trigger(pickKind());
          timer = Math.max(20, cfg.eventsfreq * 60 * (0.5 + Math.random()));
        }
      }
    }
    for (var i = active.length - 1; i >= 0; i--) {
      var e = active[i], keep = false;
      if (e.kind === 'supernova') keep = updateSupernova(e, dt);
      else if (e.kind === 'comet') keep = updateComet(e, dt, env);
      else if (e.kind === 'meteors') keep = updateMeteors(e, dt);
      if (!keep) active.splice(i, 1);
    }
  }

  // Additive, behind the stars
  function drawBack(c) {
    for (var i = 0; i < active.length; i++) {
      if (active[i].kind === 'supernova') drawRemnant(c, active[i]);
    }
    c.globalAlpha = 1;
  }

  // Additive, in front of everything
  function drawFront(c) {
    for (var i = 0; i < active.length; i++) {
      var e = active[i];
      if (e.kind === 'supernova') drawNova(c, e);
      else if (e.kind === 'comet') drawComet(c, e);
    }
    c.globalAlpha = 1;
  }

  // The stars were rebuilt (layout) or the sky changed (hyperspace)
  function clear() {
    active.forEach(function (e) { if (e.st) e.st.gone = false; });
    active.length = 0;
  }

  S.events = {
    init: init,
    update: update,
    drawBack: drawBack,
    drawFront: drawFront,
    trigger: trigger,
    clear: clear,
    active: function () { return active; },
    timer: function () { return timer; }
  };
})(window.Starry = window.Starry || {});
