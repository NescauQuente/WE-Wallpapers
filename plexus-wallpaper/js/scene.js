/*
 * Neural Plexus — scene: turns the network into what the renderers draw.
 *
 *   lines  (11 floats each): x0 y0 x1 y1 | alpha0 alpha1 | width mix0 mix1 heat | soft
 *   points (8 floats each):  x y size alpha | mix heat shape soft
 *            shape 0 = glowing node (soft 0–1: depth-of-field blur, a bokeh
 *            disc), shape 1 = ring (soft = ring width in px)
 *   tris   (4 floats per corner): x y alpha mix
 *
 * Positions and sizes are in canvas pixels. mix picks the color: 0 = main,
 * 1 = second color (or the hue around the wheel in rainbow mode); heat moves
 * it toward the signal color.
 *
 * Overcharged runners (net.js) get a long hot tail and light up the
 * connection behind them; their jumps through empty space are jagged arcs
 * that flicker; pops are a flash, a ring and sparks flying out.
 */
(function (S) {
  'use strict';

  var net = S.net;
  var LINE = 11, POINT = 8, TRI = 12;

  var out = {
    lines: new Float32Array(LINE * 2048), lineN: 0,
    points: new Float32Array(POINT * 1024), pointN: 0,
    tris: new Float32Array(TRI * 1024), triN: 0
  };

  // Per node, this frame: brightness, color, audio boost, blur
  var NB = new Float32Array(0), MIX = NB, BOOST = NB, SOFT = NB;

  // Background dust: tiny far specks that never connect
  var dust = { n: 0, x: null, y: null, z: null, seed: null };

  function ensure(lines, points, tris) {
    if (out.lines.length < lines * LINE) out.lines = new Float32Array(grow(out.lines.length, lines * LINE));
    if (out.points.length < points * POINT) out.points = new Float32Array(grow(out.points.length, points * POINT));
    if (out.tris.length < tris * TRI) out.tris = new Float32Array(grow(out.tris.length, tris * TRI));
  }

  function grow(cur, need) {
    while (cur < need) cur *= 2;
    return cur;
  }

  function line(x0, y0, x1, y1, a0, a1, w, m0, m1, heat, soft) {
    var L = out.lines, o = out.lineN++ * LINE;
    L[o] = x0; L[o + 1] = y0; L[o + 2] = x1; L[o + 3] = y1;
    L[o + 4] = a0; L[o + 5] = a1;
    L[o + 6] = w; L[o + 7] = m0; L[o + 8] = m1; L[o + 9] = heat;
    L[o + 10] = soft;
  }

  function point(x, y, size, alpha, mix, heat, shape, soft) {
    var P = out.points, o = out.pointN++ * POINT;
    P[o] = x; P[o + 1] = y; P[o + 2] = size; P[o + 3] = alpha;
    P[o + 4] = mix; P[o + 5] = heat; P[o + 6] = shape; P[o + 7] = soft;
  }

  // Nodes of formations are drawn a bit bigger (shrinking back as they fade)
  function lockSize(lock, k) {
    var f = lock === 2 ? 1.5 : lock === 3 ? 1.25 : lock ? 1.1 : 1;
    return 1 + (f - 1) * k;
  }

  function tri(a, b, c, alpha, SX, SY) {
    var T = out.tris, o = out.triN++ * TRI;
    T[o] = SX[a]; T[o + 1] = SY[a]; T[o + 2] = alpha * NB[a]; T[o + 3] = MIX[a];
    T[o + 4] = SX[b]; T[o + 5] = SY[b]; T[o + 6] = alpha * NB[b]; T[o + 7] = MIX[b];
    T[o + 8] = SX[c]; T[o + 9] = SY[c]; T[o + 10] = alpha * NB[c]; T[o + 11] = MIX[c];
  }

  // count: specks for the whole screen
  function layoutDust(count) {
    dust.n = count;
    dust.x = new Float32Array(count);
    dust.y = new Float32Array(count);
    dust.z = new Float32Array(count);
    dust.seed = new Float32Array(count);
    for (var i = 0; i < count; i++) {
      dust.x[i] = Math.random();
      dust.y[i] = Math.random();
      dust.z[i] = 0.25 + Math.random() * 0.4;   // how far: the parallax it follows
      dust.seed[i] = Math.random();
    }
  }

  /*
   * o: {
   *   dt, time, W, H, unit,
   *   mode: 'single' | 'depth' | 'gradient' | 'rainbow', flat (no depth),
   *   nodesize, sizeMul (bass), twinkle,
   *   linkwidth, linkopacity, triangles, triopacity, dof,
   *   spectrum: null | 'radius' | 'x' | 'depth', spectrumAmt, bands,
   *   signals (draw them), mouse: { on, x, y, R, links },
   *   rings: [x, y, r, alpha, width…] (shockwaves), ringN,
   *   warp (0–1), dust (bool), camX, camY,
   *   focus (0–1: a formation holds, the rest of the network dims),
   *   clockAlpha (brightness of the particle clock)
   * }
   */
  function build(o) {
    var N = net.n(), A = net.a(), links = net.links(), tris = net.tris(), sig = net.signals(), pops = net.pops();
    var SX = A.SX, SY = A.SY, SS = A.SS, VIS = A.VIS, D01 = A.D01, SEED = A.SEED;
    var FLASH = A.FLASH, HEAT = A.HEAT, RING = A.RING, Z = A.Z, LOCK = A.LOCK, DEG = A.DEG, FADE = A.FADE, WAS = A.WAS, JOIN = A.JOIN;
    var ghosts = net.ghosts();
    var W = o.W, H = o.H, unit = o.unit, i;
    out.lineN = out.pointN = out.triN = 0;

    if (NB.length < N) {
      NB = new Float32Array(N);
      MIX = new Float32Array(N);
      BOOST = new Float32Array(N);
      SOFT = new Float32Array(N);
    }
    var warpOn = o.warp > 0.02;
    ensure(links.n + ghosts.n + sig.n + sig.runners * 4 + pops.n * 9 + (o.mouse.on && o.mouse.links ? N : 0) + (warpOn ? N : 0) + 8,
      N * 2 + sig.n + dust.n + o.ringN + pops.n * 2 + 8,
      o.triangles ? tris.n : 0);

    // Per node: brightness, color, audio boost and blur
    var view = net.view, zHalf = Math.max(1, view.zr * 0.5);
    var bands = o.bands, nb = bands ? bands.length : 0, cx = W / 2, cy = H / 2, maxR = Math.sqrt(cx * cx + cy * cy);
    for (i = 0; i < N; i++) {
      var vis = VIS[i];
      if (vis < 0.003) { NB[i] = 0; continue; }
      // (nodes a formation just let go dim gently, like the rest)
      NB[i] = LOCK[i] === 3 ? o.clockAlpha : vis * (o.flat ? 1 : 1 - 0.5 * D01[i]) * (LOCK[i] ? 1 : 1 - 0.45 * o.focus * (1 - FADE[i]));
      var m = 0;
      if (o.mode === 'depth') m = D01[i];
      else if (o.mode === 'gradient') m = SX[i] / W;
      else if (o.mode === 'rainbow') m = SX[i] / W * 0.55 + SY[i] / H * 0.2 + D01[i] * 0.25;
      MIX[i] = m;
      var boost = 0;
      if (o.spectrum && nb) {
        var f = o.spectrum === 'x' ? SX[i] / W
          : o.spectrum === 'depth' ? D01[i]
          : Math.sqrt((SX[i] - cx) * (SX[i] - cx) + (SY[i] - cy) * (SY[i] - cy)) / maxR;
        var lv = bands[f <= 0 ? 0 : f >= 1 ? nb - 1 : (f * (nb - 1)) | 0];
        boost = lv * lv * o.spectrumAmt * 0.6;
      }
      BOOST[i] = boost;
      var soft = 0;
      if (o.dof && !o.flat) {
        // Out of focus away from the focal plane, more on the near side
        var dz = Z[i] / zHalf;
        soft = dz < 0 ? -dz * 1.25 - 0.2 : dz * 0.8 - 0.3;
        soft = soft < 0 ? 0 : soft > 1 ? 1 : soft;
      }
      SOFT[i] = soft;
    }

    // Triangles (faint fills)
    if (o.triangles) {
      var ta = 0.16 * o.triopacity;
      for (var t = 0; t < tris.n; t++) {
        var p = tris.a[t], q = tris.b[t], r = tris.c[t];
        if (NB[p] + NB[q] + NB[r] < 0.02) continue;
        // Where many overlap (dense formations, the singularity) each is fainter
        var dg = (DEG[p] + DEG[q] + DEG[r]) / 3, dn3 = dg > 4 ? 4 / dg : 1;
        // Of nodes a formation just let go: its own fills dim down and come
        // back as the network's; fills with other nodes fade in
        var tf = Math.max(FADE[p], FADE[q], FADE[r]), tk = 1 - tf;
        if (FADE[p] > 0 && FADE[q] > 0 && FADE[r] > 0) tk = Math.abs(1 - 2 * tf);
        tri(p, q, r, ta * tris.s[t] * dn3 * tk * (1 + (BOOST[p] + BOOST[q] + BOOST[r]) * 0.15), SX, SY);
      }
    }

    // Connections
    var lw = o.linkwidth * unit, lo = o.linkopacity;
    for (var l = 0; l < links.n; l++) {
      var a = links.a[l], b = links.b[l], na = NB[a], nbb = NB[b];
      if (na + nbb < 0.01) continue;
      var s = links.s[l], edge = LOCK[a] && LOCK[b];
      // The edges of a formation show whatever their length (the time's own
      // edges, few and far apart, the most)
      if (edge) s = LOCK[a] >= 2 ? 0.95 : 0.5 + 0.4 * s;
      // Where many lines meet (dense formations, the singularity), each is
      // fainter, so the crowd doesn't blind
      var dd = (DEG[a] + DEG[b]) * 0.5, dn = dd > 4.5 ? 4.5 / dd : 1;
      // New connections of nodes a formation just let go fade in
      var fdl = FADE[a] > FADE[b] ? FADE[a] : FADE[b];
      // A formation's lines grow in as its nodes arrive; the network's lines
      // to a node on its way in fade out as it arrives
      var jn = edge ? Math.sqrt(JOIN[a] < JOIN[b] ? JOIN[a] : JOIN[b]) : LOCK[a] ? 1 - JOIN[a] : LOCK[b] ? 1 - JOIN[b] : 1;
      var base = Math.pow(s, 0.8) * lo * 1.4 * dn * (1 - fdl) * jn * (1 + (BOOST[a] + BOOST[b]) * 0.3);
      var sf = (SOFT[a] + SOFT[b]) * 0.5;
      var fa = FLASH[a], fb = FLASH[b];
      var heat = (fa + fb) * 0.3 + (HEAT[a] + HEAT[b]) * 0.5 + (edge ? 0.05 : 0);
      line(SX[a], SY[a], SX[b], SY[b],
        base * na + fa * 0.35 * s * dn, base * nbb + fb * 0.35 * s * dn,
        lw * (SS[a] + SS[b]) * (edge ? 0.62 : 0.5), MIX[a], MIX[b], heat > 1 ? 1 : heat, sf);
    }

    // Ghosts: the lines of a formation that let go, fading out
    var GL = net.GHOST_LIFE;
    for (var gh = 0; gh < ghosts.n; gh++) {
      var ga = ghosts.a[gh], gb = ghosts.b[gh], gk = 1 - ghosts.t[gh] / GL;
      if (NB[ga] + NB[gb] < 0.01) continue;
      // Fading out linearly while the new connections fade in: together
      // about as bright as before
      var gs = ghosts.s[gh] * lo * 1.4 * gk;
      line(SX[ga], SY[ga], SX[gb], SY[gb], gs * NB[ga], gs * NB[gb], lw * (SS[ga] + SS[gb]) * 0.62, MIX[ga], MIX[gb], 0, 0);
    }

    // The cursor's connections
    var mo = o.mouse;
    if (mo.on && mo.links) {
      var R2 = mo.R * mo.R;
      for (i = 0; i < N; i++) {
        if (NB[i] < 0.05) continue;
        var dx = SX[i] - mo.x, dy = SY[i] - mo.y, d2 = dx * dx + dy * dy;
        if (d2 > R2) continue;
        var k = 1 - Math.sqrt(d2) / mo.R;
        line(mo.x, mo.y, SX[i], SY[i], k * 0.45 * lo, k * 0.9 * lo * NB[i], lw * 1.1, MIX[i], MIX[i], 0.15 + 0.2 * k, 0);
      }
    }

    // Hyperspeed streaks: from where each node was, stretched behind it
    if (warpOn) {
      var st = 2 + 4 * o.warp, lim = W / 3;
      for (i = 0; i < N; i++) {
        if (NB[i] < 0.02) continue;
        var sx = SX[i] - A.PSX[i], sy = SY[i] - A.PSY[i];
        if (sx > lim || sx < -lim || sy > lim || sy < -lim) continue;
        line(SX[i] - sx * st, SY[i] - sy * st, SX[i], SY[i], 0, NB[i] * o.warp, lw * SS[i] * 1.4, MIX[i], MIX[i], 0.35, 0);
      }
    }

    // Dust
    if (o.dust && dust.n) {
      var ds = unit * 0.9, flow = o.dt * 0.004, zoom = 1 + o.warp * o.dt * 2.5;
      for (i = 0; i < dust.n; i++) {
        var x = dust.x[i], y = dust.y[i];
        // A slow drift, and a rush outward in hyperspeed
        x += flow * (dust.seed[i] - 0.5);
        if (warpOn) {
          x = 0.5 + (x - 0.5) * zoom;
          y = 0.5 + (y - 0.5) * zoom;
        }
        if (x < 0 || x > 1 || y < 0 || y > 1) {
          // Out of the screen: back somewhere else (near the middle in hyperspeed)
          x = warpOn ? 0.5 + (Math.random() - 0.5) * 0.3 : Math.random();
          y = warpOn ? 0.5 + (Math.random() - 0.5) * 0.3 : Math.random();
        }
        dust.x[i] = x;
        dust.y[i] = y;
        var z = dust.z[i], sd = dust.seed[i];
        var tw = 0.55 + 0.45 * Math.sin(o.time * (0.6 + sd * 1.7) + sd * 60);
        point(x * W + o.camX * (1 - z), y * H + o.camY * (1 - z), ds * (0.8 + 1.4 * sd), (0.12 + 0.16 * tw) * (0.6 + sd * 0.4),
          o.mode === 'rainbow' ? sd : 0.75, 0, 0, 0.35);
      }
    }

    // Nodes and their rings
    var ns = o.nodesize * unit * o.sizeMul, time = o.time;
    for (i = 0; i < N; i++) {
      var v = NB[i];
      if (v < 0.003) continue;
      var sd2 = SEED[i], fl = FLASH[i], bo = BOOST[i];
      var tw2 = o.twinkle ? 0.72 + 0.28 * Math.sin(time * (1.1 + sd2 * 2.2) + sd2 * 50) : 1;
      var size = (2 + 3 * sd2) * ns * SS[i] * (1 + bo * 0.4 + fl * 0.8) * lockSize(LOCK[i] || (FADE[i] > 0 ? WAS[i] : 0), LOCK[i] ? JOIN[i] : FADE[i]);
      var ht = fl * 0.7 + HEAT[i];
      point(SX[i], SY[i], size, v * tw2 * 1.25 * (1 + bo * 0.45) + fl * 0.6, MIX[i], ht > 1 ? 1 : ht, 0, SOFT[i]);
      var rg = RING[i];
      if (rg > 0) {
        var pr = 1 - rg;
        point(SX[i], SY[i], (10 + 70 * pr) * unit * SS[i], rg * rg * 0.8 * v, MIX[i], 0.5, 1, 1.4 * unit);
      }
    }

    // Signals: a bright head with a fading tail along the connection (the
    // overcharged ones are drawn even with the spontaneous signals off)
    var nsz = o.nodesize * unit;
    for (var g = 0; g < sig.n; g++) {
      var kind = sig.kind[g];
      if (!kind && !o.signals) continue;
      var fr = sig.from[g], to = sig.to[g], tt = sig.t[g];
      if (tt > 1) tt = 1;
      var vis2 = Math.min(NB[fr], NB[to]);
      if (vis2 < 0.02) continue;
      var hx = SX[fr] + (SX[to] - SX[fr]) * tt, hy = SY[fr] + (SY[to] - SY[fr]) * tt;
      var sc = SS[fr] + (SS[to] - SS[fr]) * tt, mx = MIX[fr] + (MIX[to] - MIX[fr]) * tt;
      if (!kind) {
        var t0 = tt - 0.4 < 0 ? 0 : tt - 0.4;
        // (fainter inside a formation that is dissolving: it is crowded)
        var e = sig.e[g], br = Math.min(1, 0.5 + e * 0.6) * Math.sqrt(vis2) * (1 - 0.7 * Math.max(FADE[fr], FADE[to]));
        line(SX[fr] + (SX[to] - SX[fr]) * t0, SY[fr] + (SY[to] - SY[fr]) * t0, hx, hy, 0, br, lw * sc * 1.7, mx, mx, 1, 0);
        point(hx, hy, (2.4 + 1.8 * Math.min(1, e)) * nsz * sc, br * 1.2, mx, 1, 0, 0);
        continue;
      }
      var bc = Math.max(0.45, Math.sqrt(vis2));
      if (kind === 1) {
        // Overcharged: the connection behind it glows, with a long hot tail
        var t1 = tt - 0.7 < 0 ? 0 : tt - 0.7;
        line(SX[fr], SY[fr], hx, hy, 0.2 * bc, 0.45 * bc, lw * sc * 1.3, mx, mx, 0.9, 0);
        line(SX[fr] + (SX[to] - SX[fr]) * t1, SY[fr] + (SY[to] - SY[fr]) * t1, hx, hy, 0, bc, lw * sc * 3, mx, mx, 1, 0);
      } else {
        // A jump through empty space: a jagged arc that flickers every frame
        var ax = SX[fr], ay = SY[fr], ddx = hx - ax, ddy = hy - ay, len = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
        var ux = -ddy / len, uy = ddx / len, px = ax, py = ay;
        for (var k2 = 1; k2 <= 4; k2++) {
          var j2 = k2 < 4 ? (Math.random() - 0.5) * len * 0.24 : 0;
          var qx = ax + ddx * k2 / 4 + ux * j2, qy = ay + ddy * k2 / 4 + uy * j2;
          line(px, py, qx, qy, 0.85 * bc, 0.95 * bc, lw * sc * 1.8, mx, mx, 1, 0);
          px = qx;
          py = qy;
        }
      }
      point(hx, hy, (5 + 2 * Math.random()) * nsz * sc, bc * 1.4, mx, 1, 0, 0);
    }

    // Pops: a ring, a flash and sparks flying out
    var PL = net.POP_LIFE;
    for (var pp = 0; pp < pops.n; pp++) {
      var age = pops.t[pp] / PL, inv = 1 - age, grow = 1 - inv * inv;
      var s2 = pops.s[pp] * unit, cxp = pops.x[pp], cyp = pops.y[pp], seed = pops.seed[pp];
      point(cxp, cyp, (10 + 80 * grow) * s2, inv * inv * 0.9, 0.5, 1, 1, 2 * unit);
      point(cxp, cyp, 26 * inv * s2, inv * 1.3, 0.5, 1, 0, 0);
      for (var k3 = 0; k3 < 9; k3++) {
        var ang = seed * 6.2832 + k3 * 0.698 + 0.5 * Math.sin(seed * 40 + k3 * 3);
        var r0 = (6 + 55 * grow) * s2, r1 = r0 + (6 + 18 * inv) * s2 * (0.7 + 0.6 * ((k3 * 0.37 + seed * 10) % 1));
        var ca = Math.cos(ang), sa = Math.sin(ang);
        line(cxp + ca * r0, cyp + sa * r0, cxp + ca * r1, cyp + sa * r1, 0, inv * 0.95, lw * 1.6, 0.5, 0.5, 1, 0);
      }
    }

    // Shockwave rings
    var rings = o.rings;
    for (i = 0; i < o.ringN; i++) {
      var ro = i * 5;
      point(rings[ro], rings[ro + 1], rings[ro + 2] * 2, rings[ro + 3], 0.5, 0.6, 1, rings[ro + 4]);
    }

    return out;
  }

  S.scene = { build: build, layoutDust: layoutDust, LINE: LINE, POINT: POINT, TRI: TRI };
})(window.Plexus = window.Plexus || {});
