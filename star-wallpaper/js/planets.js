/*
 * Starry Orbit — wandering planets and the black hole that devours them.
 *
 * Every now and then a planet drifts across the screen and leaves. Planets
 * have real momentum: the click-and-drag black hole only pulls on them with
 * gravity, plus a capture drag close in that makes orbits decay into a spiral.
 * Pass close enough and a planet is captured; move the hole away or let go and
 * it keeps its own momentum and drifts off the screen.
 *
 * Inside the tidal radius (and only on screen) a captured planet is
 * spaghettified: stretched toward the hole and shredded into hot debris that
 * spirals in. Every planet swallowed adds mass, so the hole grows slowly. Gas
 * giants feed it gas, which launches relativistic jets from both poles. While
 * held, the hole also draws extra planets in from afar.
 *
 * main.js owns the hole itself (position, power, growth and the supermassive
 * easter egg).
 */
(function (S) {
  'use strict';

  var util = S.util;
  var TAU = Math.PI * 2;
  var MAX_PLANETS = 3;
  var MAX_DEBRIS = 500;

  // [hue, saturation %, lightness %]
  var ROCKY = [
    { base: [14, 55, 42], spots: [[8, 50, 30], [22, 45, 55]], atmo: null },               // rusty, Mars-like
    { base: [210, 65, 40], spots: [[110, 35, 36], [35, 40, 45]], atmo: [205, 90, 70] },   // ocean world
    { base: [30, 10, 55], spots: [[30, 8, 38], [30, 10, 70]], atmo: null },               // cratered moon
    { base: [38, 50, 52], spots: [[28, 55, 38], [45, 40, 66]], atmo: [40, 60, 72] },      // desert
    { base: [192, 35, 74], spots: [[200, 30, 60], [190, 20, 88]], atmo: [190, 70, 82] }   // ice
  ];
  var GAS = [
    { bands: [[30, 55, 62], [22, 60, 45], [40, 45, 72], [18, 52, 52]], ring: false, atmo: [35, 60, 70] },   // Jupiter-like
    { bands: [[45, 50, 72], [38, 45, 62], [50, 40, 80]], ring: [42, 35, 70], atmo: [45, 50, 80] },          // Saturn-like
    { bands: [[215, 65, 55], [222, 60, 44], [205, 55, 66]], ring: false, atmo: [210, 80, 75] },             // Neptune-like
    { bands: [[185, 45, 68], [180, 40, 60], [190, 35, 76]], ring: [185, 25, 75], atmo: [185, 60, 82] }      // Uranus-like
  ];

  var planets = [], debris = [], knots = [];
  var passTimer = 5, attractTimer = 1.2, jetPower = 0, knotTimer = 0;

  function hsl(c, a) {
    return 'hsla(' + c[0] + ', ' + c[1] + '%, ' + c[2] + '%, ' + (a === undefined ? 1 : a) + ')';
  }

  function pick(list) { return list[(Math.random() * list.length) | 0]; }

  // ---------------------------------------------------------------------------
  // Procedural planet sprites (drawn once per planet)
  // ---------------------------------------------------------------------------
  function drawRing(c, cx, R, p, front) {
    c.save();
    c.translate(cx, cx);
    c.rotate(p.ringTilt);
    c.scale(1, 0.28);
    c.beginPath();
    if (front) c.arc(0, 0, R * 1.85, 0, Math.PI);
    else c.arc(0, 0, R * 1.85, Math.PI, TAU);
    c.lineWidth = R * 0.42;
    c.strokeStyle = hsl(p.ring, 0.5);
    c.stroke();
    c.lineWidth = R * 0.1;
    c.strokeStyle = hsl([p.ring[0], p.ring[1], Math.min(95, p.ring[2] + 15)], 0.75);
    c.stroke();
    c.restore();
  }

  function makeSprite(p) {
    var R = p.radius, pad = p.ring ? R * 1.25 : R * 0.35;
    var size = Math.ceil((R + pad) * 2), cx = size / 2;
    var cv = document.createElement('canvas');
    cv.width = cv.height = size;
    var c = cv.getContext('2d');

    if (p.ring) drawRing(c, cx, R, p, false);

    c.save();
    c.beginPath();
    c.arc(cx, cx, R, 0, TAU);
    c.clip();
    if (p.gas) {
      // Wavy cloud bands, slightly tilted
      c.translate(cx, cx);
      c.rotate(p.tilt);
      var bands = p.bands, freq = 5 + Math.random() * 6, ph = Math.random() * TAU, ph2 = Math.random() * TAU;
      for (var y = -R; y < R; y += 1) {
        var t = y / R;
        var k = 0.5 + 0.5 * Math.sin(t * freq + ph + Math.sin(t * 9 + ph2) * 0.7);
        var f = k * (bands.length - 1), i = Math.min(bands.length - 2, Math.floor(f)), m = f - i;
        var a = bands[i], b = bands[i + 1];
        c.fillStyle = hsl([a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m, a[2] + (b[2] - a[2]) * m]);
        c.fillRect(-R * 1.2, y, R * 2.4, 1.6);
      }
      // A storm spot now and then
      if (Math.random() < 0.6) {
        var sx = (Math.random() - 0.5) * R, sy = (Math.random() - 0.5) * R * 0.8;
        c.fillStyle = hsl(bands[1], 0.85);
        c.beginPath();
        c.ellipse(sx, sy, R * 0.22, R * 0.12, 0, 0, TAU);
        c.fill();
      }
    } else {
      c.fillStyle = hsl(p.base);
      c.fillRect(0, 0, size, size);
      // Soft continents / craters
      var n = 8 + ((Math.random() * 8) | 0);
      for (var s = 0; s < n; s++) {
        var ang = Math.random() * TAU, dist = Math.random() * R * 0.85;
        var px = cx + Math.cos(ang) * dist, py = cx + Math.sin(ang) * dist, pr = R * (0.12 + Math.random() * 0.35);
        var spot = pick(p.spots), g = c.createRadialGradient(px, py, 0, px, py, pr);
        g.addColorStop(0, hsl(spot, 0.75));
        g.addColorStop(1, hsl(spot, 0));
        c.fillStyle = g;
        c.fillRect(px - pr, py - pr, pr * 2, pr * 2);
      }
    }
    c.restore();

    // Lit from the upper left, with a dark terminator
    c.save();
    c.beginPath();
    c.arc(cx, cx, R, 0, TAU);
    c.clip();
    var sh = c.createRadialGradient(cx - R * 0.4, cx - R * 0.45, R * 0.1, cx, cx, R * 1.05);
    sh.addColorStop(0, 'rgba(255, 255, 255, 0.2)');
    sh.addColorStop(0.45, 'rgba(0, 0, 0, 0)');
    sh.addColorStop(1, 'rgba(0, 0, 0, 0.8)');
    c.fillStyle = sh;
    c.fillRect(0, 0, size, size);
    c.restore();

    if (p.atmo) {
      var at = c.createRadialGradient(cx, cx, R * 0.92, cx, cx, R * 1.25);
      at.addColorStop(0, hsl(p.atmo, 0.45));
      at.addColorStop(1, hsl(p.atmo, 0));
      c.fillStyle = at;
      c.beginPath();
      c.arc(cx, cx, R * 1.25, 0, TAU);
      c.fill();
    }

    if (p.ring) drawRing(c, cx, R, p, true);
    return cv;
  }

  // ---------------------------------------------------------------------------
  // Simulation (screen space, real momentum)
  // ---------------------------------------------------------------------------
  function isOnScreen(env, x, y, pad) {
    return x > -pad && x < env.w + pad && y > -pad && y < env.h + pad;
  }

  // A point just beyond a random screen edge, away from the hole when needed
  function edgePoint(env, margin, avoid) {
    var x = 0, y = 0;
    for (var tries = 0; tries < 16; tries++) {
      var side = (Math.random() * 4) | 0, t = Math.random();
      if (side === 0) { x = t * env.w; y = -margin; }
      else if (side === 1) { x = env.w + margin; y = t * env.h; }
      else if (side === 2) { x = t * env.w; y = env.h + margin; }
      else { x = -margin; y = t * env.h; }
      if (!avoid || Math.hypot(x - env.x, y - env.y) > avoid) break;
    }
    return [x, y];
  }

  // mode: 'pass' (drifts across the screen) or 'attract' (drawn toward the hole)
  function spawn(env, gas, mode) {
    if (gas === undefined || gas === null) gas = Math.random() < 0.28;
    mode = mode || (env.active ? 'attract' : 'pass');
    var def = gas ? pick(GAS) : pick(ROCKY);
    var radius = (gas ? 21 + Math.random() * 12 : 10 + Math.random() * 7) * env.unit;
    var p = {
      gas: gas,
      mode: mode,
      radius: radius,
      mass: gas ? 3 : 1,
      tilt: (Math.random() - 0.5) * 0.5,
      ringTilt: (Math.random() - 0.5) * 0.6,
      bands: def.bands, base: def.base, spots: def.spots, atmo: def.atmo, ring: def.ring || null,
      palette: gas ? def.bands : [def.base].concat(def.spots),
      x: 0, y: 0, vx: 0, vy: 0,
      alpha: 1,
      remaining: 1,
      stretch: 0,
      age: 0,
      entered: false
    };

    var S = Math.min(env.w, env.h);
    var from = edgePoint(env, radius * (p.ring ? 2.6 : 1.6), env.active ? env.tidal * 1.6 : 0);
    var tx, ty, speed;
    if (mode === 'attract' && env.active) {
      tx = env.x + (Math.random() - 0.5) * S * 0.3;
      ty = env.y + (Math.random() - 0.5) * S * 0.3;
      speed = S / (4.5 + Math.random() * 2);
    } else {
      tx = env.w * (0.2 + Math.random() * 0.6);
      ty = env.h * (0.2 + Math.random() * 0.6);
      speed = S / (14 + Math.random() * 10);
    }
    var dx = tx - from[0], dy = ty - from[1], dl = Math.sqrt(dx * dx + dy * dy) || 1;
    p.x = from[0];
    p.y = from[1];
    p.vx = dx / dl * speed;
    p.vy = dy / dl * speed;
    p.sprite = makeSprite(p);
    planets.push(p);
    return p;
  }

  // A planet at a given place and velocity (rare events: the planet parade)
  function spawnAt(env, gas, x, y, vx, vy, mode) {
    var p = spawn(env, gas, mode || 'parade');
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    return p;
  }

  // One integration step under the hole's gravity; returns the distance to it
  function step(b, env, h, drag) {
    var d = Infinity;
    if (env.active) {
      var dx = env.x - b.x, dy = env.y - b.y, d2 = dx * dx + dy * dy;
      d = Math.sqrt(d2) || 1;
      var a = env.gm / (d2 + env.soft2);
      b.vx += dx / d * a * h;
      b.vy += dy / d * a * h;
      // Capture drag: close to the hole, orbits decay into a spiral
      var k = drag * env.power * util.smoothstep(env.infl, env.infl * 0.2, d);
      if (k > 0) {
        var f = Math.exp(-k * h);
        b.vx *= f;
        b.vy *= f;
      }
    }
    b.x += b.vx * h;
    b.y += b.vy * h;
    return d;
  }

  // Tidal tails: debris leaves with the planet's velocity, some ahead, some behind
  function shed(p, env, count) {
    var sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    for (var i = 0; i < count && debris.length < MAX_DEBRIS; i++) {
      var c = pick(p.palette), hot = Math.random() < 0.35, k = 0.8 + Math.random() * 0.4;
      // Tidal heating: saturated planet colors, some embers glowing orange
      var color = hot ? [22 + Math.random() * 18, 95, 58] : [c[0], Math.min(100, c[1] + 25), Math.min(64, c[2] + 8)];
      debris.push({
        x: p.x + (Math.random() - 0.5) * p.radius,
        y: p.y + (Math.random() - 0.5) * p.radius,
        vx: p.vx * k + (Math.random() - 0.5) * sp * 0.15,
        vy: p.vy * k + (Math.random() - 0.5) * sp * 0.15,
        color: color,
        css: hsl(color),   // the streak color, built once (alpha comes from globalAlpha)
        size: (1.4 + Math.random() * 2.4) * env.unit,
        gas: p.gas,
        alpha: 1,
        life: 0,
        px: null, py: null
      });
    }
  }

  function countMode(mode) {
    var n = 0;
    for (var i = 0; i < planets.length; i++) if (planets[i].mode === mode) n++;
    return n;
  }

  // Returns the mass swallowed this frame
  function update(dt, env) {
    var gained = 0, i, s;
    var n = Math.min(20, Math.max(1, Math.ceil(dt / 0.006))), h = dt / n;

    // Planets passing by, with or without a black hole
    if (env.pass) {
      passTimer -= dt;
      if (passTimer <= 0) {
        if (countMode('pass') < 2 && planets.length < MAX_PLANETS) spawn(env, null, 'pass');
        passTimer = 60 / Math.max(0.1, env.passRate) * (0.6 + Math.random() * 0.8);
      }
    }

    // While held, the hole draws extra planets in from afar
    if (env.holding && env.attract && env.power > 0.6) {
      attractTimer -= dt;
      if (attractTimer <= 0 && planets.length < MAX_PLANETS) {
        spawn(env, null, 'attract');
        attractTimer = Math.max(1.4, 3.4 - env.mass * 0.12) * (0.75 + Math.random() * 0.5);
      }
    } else {
      attractTimer = 1.2;
    }

    for (i = planets.length - 1; i >= 0; i--) {
      var p = planets[i], d = Infinity;
      p.age += dt;
      var drag = 0.9 + 2.2 * p.stretch;
      for (s = 0; s < n; s++) {
        d = step(p, env, h, drag);
        if (d <= env.horizon * 1.1) break;
      }
      var visible = isOnScreen(env, p.x, p.y, 0);
      if (visible) p.entered = true;

      // Spaghettification: inside the tidal radius, and only where it can be seen
      if (env.active && visible) {
        p.stretch = util.clamp((env.tidal - d) / Math.max(1, env.tidal - env.horizon), 0, 1);
      } else {
        p.stretch = Math.max(0, p.stretch - dt * 2);
      }
      if (p.stretch > 0 && env.active) {
        var rate = (p.gas ? 650 : 420) * p.stretch;
        var count = Math.floor(rate * dt + Math.random());
        shed(p, env, count);
        p.remaining = Math.max(0, p.remaining - count * (p.gas ? 0.0011 : 0.0019));
      }

      if (env.active && (d <= env.horizon * 1.1 || p.remaining <= 0.05)) {
        shed(p, env, 25);
        gained += p.mass;
        if (p.gas) jetPower = Math.max(jetPower, 1.2);
        planets.splice(i, 1);
        continue;
      }

      // Gone: crossed the screen and left, or wandered for too long
      if ((p.entered && !isOnScreen(env, p.x, p.y, p.radius * 4)) || p.age > 90) planets.splice(i, 1);
    }

    for (i = debris.length - 1; i >= 0; i--) {
      var db = debris[i], dd = Infinity;
      db.life += dt;
      for (s = 0; s < n; s++) {
        dd = step(db, env, h, 1.6);
        // Supermassive: the debris settles into the plane of the disk
        if (env.active && env.flat > 0) {
          db.vy -= (db.y - env.y) * 3 * env.flat * h;
          db.vy *= Math.exp(-1.5 * env.flat * h);
        }
        if (dd <= env.horizon) break;
      }
      if (env.active && dd <= env.horizon) {
        // Gas accreting onto the hole powers the jets
        if (db.gas) jetPower = Math.min(1.8, jetPower + 0.03);
        debris.splice(i, 1);
        continue;
      }
      if (!env.active || db.life > 5) db.alpha -= dt * 1.2;
      if (db.alpha <= 0 || !isOnScreen(env, db.x, db.y, 200)) debris.splice(i, 1);
    }

    jetPower *= Math.exp(-dt / 1.2);
    if (!env.jets) jetPower = 0;
    return gained;
  }

  // ---------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------

  // Hot debris stream (additive, on the star layer so it leaves trails)
  function drawDebris(c, env) {
    if (!debris.length) return;
    c.lineCap = 'round';
    for (var i = 0; i < debris.length; i++) {
      var d = debris[i];
      if (d.px !== null) {
        c.globalAlpha = 0.45 * d.alpha;
        c.strokeStyle = d.css;
        c.lineWidth = d.size * 0.6;
        c.beginPath();
        c.moveTo(d.px, d.py);
        c.lineTo(d.x, d.y);
        c.stroke();
      }
      c.globalAlpha = Math.max(0, Math.min(1, d.alpha));
      var sz = d.size * 5;
      c.drawImage(env.getSprite(d.color[0], d.color[1], d.color[2]), d.x - sz / 2, d.y - sz / 2, sz, sz);
      d.px = d.x;
      d.py = d.y;
    }
  }

  // Solid planet bodies, stretched toward the hole while being torn apart
  function drawPlanets(c, env) {
    if (!planets.length) return;
    c.globalCompositeOperation = 'source-over';
    for (var i = 0; i < planets.length; i++) {
      var p = planets[i];
      var st = p.stretch * p.stretch;
      var shrink = Math.pow(Math.max(0.05, p.remaining), 0.33);
      var radial = env.active ? Math.atan2(p.y - env.y, p.x - env.x) : 0;
      var size = p.sprite.width;
      c.save();
      c.globalAlpha = Math.max(0, Math.min(1, p.alpha));
      c.translate(p.x, p.y);
      c.rotate(radial);
      c.scale((1 + 2.8 * st) * shrink, (1 - 0.5 * p.stretch) * shrink);
      c.rotate(-radial);
      c.drawImage(p.sprite, -size / 2, -size / 2, size, size);
      c.restore();
    }
  }

  function cone(c, bx, by, tx, ty, nx, ny, w0, w1, stops) {
    var g = c.createLinearGradient(bx, by, tx, ty);
    for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(bx + nx * w0, by + ny * w0);
    c.lineTo(tx + nx * w1, ty + ny * w1);
    c.lineTo(tx - nx * w1, ty - ny * w1);
    c.lineTo(bx - nx * w0, by - ny * w0);
    c.closePath();
    c.fill();
  }

  // Relativistic jets from both poles, with plasma knots racing outward
  function drawJets(c, env, dt) {
    if (jetPower < 0.03 || env.power <= 0.01) { knots.length = 0; return; }
    var a = Math.min(1, jetPower) * env.power * (0.82 + 0.18 * Math.random());
    var u = env.unit;
    var L = Math.min(env.w, env.h) * (0.42 + 0.4 * env.flat) * (0.55 + 0.45 * Math.min(1, jetPower));
    var ang = -Math.PI / 2 + 0.14, base = env.horizon * 0.85;
    var w = 1 + env.flat;

    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = 1;
    for (var s = -1; s <= 1; s += 2) {
      var dx = Math.cos(ang) * s, dy = Math.sin(ang) * s, nx = -dy, ny = dx;
      var bx = env.x + dx * base, by = env.y + dy * base;
      var tx = env.x + dx * (base + L), ty = env.y + dy * (base + L);
      cone(c, bx, by, tx, ty, nx, ny, 10 * u * w, 60 * u * w, [
        [0, 'hsla(220, 90%, 65%, ' + 0.16 * a + ')'], [0.5, 'hsla(250, 80%, 60%, ' + 0.07 * a + ')'], [1, 'hsla(260, 80%, 60%, 0)']]);
      cone(c, bx, by, tx, ty, nx, ny, 4 * u * w, 22 * u * w, [
        [0, 'hsla(205, 95%, 75%, ' + 0.45 * a + ')'], [0.6, 'hsla(220, 90%, 68%, ' + 0.14 * a + ')'], [1, 'hsla(230, 90%, 65%, 0)']]);
      cone(c, bx, by, tx, ty, nx, ny, 1.4 * u * w, 5 * u * w, [
        [0, 'hsla(190, 100%, 95%, ' + 0.95 * a + ')'], [0.7, 'hsla(200, 100%, 85%, ' + 0.3 * a + ')'], [1, 'hsla(210, 100%, 80%, 0)']]);
    }

    // Plasma knots
    knotTimer -= dt;
    if (jetPower > 0.25 && knotTimer <= 0) {
      knotTimer = 0.07;
      knots.push({ s: 1, d: 0 }, { s: -1, d: 0 });
    }
    var sprite = env.getSprite(205, 90, 82);
    for (var k = knots.length - 1; k >= 0; k--) {
      var kn = knots[k];
      kn.d += L * 1.3 * dt;
      if (kn.d >= L) { knots.splice(k, 1); continue; }
      var f = kn.d / L, ks = (26 - 14 * f) * u * w;
      var kx = env.x + Math.cos(ang) * kn.s * (base + kn.d), ky = env.y + Math.sin(ang) * kn.s * (base + kn.d);
      c.globalAlpha = a * (1 - f);
      c.drawImage(sprite, kx - ks / 2, ky - ks / 2, ks, ks);
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }

  function reset() {
    planets.length = 0;
    debris.length = 0;
    knots.length = 0;
    passTimer = 5;
    attractTimer = 1.2;
    jetPower = 0;
  }

  S.planets = {
    update: update,
    drawDebris: drawDebris,
    drawPlanets: drawPlanets,
    drawJets: drawJets,
    reset: reset,
    spawn: spawn,
    spawnAt: spawnAt,
    jetPower: function () { return jetPower; },
    count: function () { return { planets: planets.length, debris: debris.length }; },
    debris: function () { return debris; },
    list: function () { return planets; }
  };
})(window.Starry = window.Starry || {});
