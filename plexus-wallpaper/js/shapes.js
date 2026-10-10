/*
 * Neural Plexus — formations: now and then part of the network comes together
 * into a shape (a sphere, a torus, a DNA helix, a 4D hypercube, a spiral
 * galaxy, a wave terrain, an atom or the time), holds it for a while, turning
 * in 3D while signals race along its edges, then lets go.
 *
 * Shapes are built from points spaced a little under the connection distance
 * apart, so the network's own connections draw their edges. Coordinates are
 * in units of that spacing; x right, y down, z away from the viewer.
 *
 * While music plays (setReactive) the shapes dance to it: the sphere grows
 * spectrum spikes, the torus's tube swells, the helix opens and closes, the
 * galaxy's arms rise off its disc, the atom's rings and the hypercube throb.
 */
(function (S) {
  'use strict';

  var net = S.net;
  var TAU = Math.PI * 2;
  var GOLDEN = Math.PI * (3 - Math.sqrt(5));
  var GATHER = 4.8;           // seconds to come together
  var STAGGER = 1;            // nodes set off up to this long after the first
  // Point spacing, in connection distances: neighbors connect brightly, the
  // ones two steps away (about one distance) barely or not at all
  var SPACING = 0.5;

  // Radius of each shape, in screen heights
  var SIZE = { sphere: 0.33, torus: 0.36, helix: 0.34, tesseract: 0.36, galaxy: 0.44, terrain: 0.36, atom: 0.36 };

  var KINDS = ['sphere', 'torus', 'helix', 'tesseract', 'galaxy', 'terrain', 'atom'];

  // ---------------------------------------------------------------------------
  // Generators: R is the radius in spacing units; each returns [x, y, z, w]
  // points (w only matters for the hypercube)
  // ---------------------------------------------------------------------------
  function sphere(R, out) {
    var n = Math.max(12, Math.round(13.3 * R * R));
    for (var i = 0; i < n; i++) {
      var y = 1 - 2 * (i + 0.5) / n, r = Math.sqrt(1 - y * y), a = i * GOLDEN;
      out.push([Math.cos(a) * r * R, y * R, Math.sin(a) * r * R, 0]);
    }
  }

  function torus(R, out) {
    var big = 0.68 * R, small = 0.32 * R;
    var nu = Math.max(8, Math.round(TAU * big)), nv = Math.max(5, Math.round(TAU * small));
    for (var u = 0; u < nu; u++) {
      var p = u / nu * TAU;
      for (var v = 0; v < nv; v++) {
        // Every other ring is turned half a step: a woven look
        var q = (v + (u % 2) * 0.5) / nv * TAU, rr = big + small * Math.cos(q);
        out.push([Math.cos(p) * rr, small * Math.sin(q), Math.sin(p) * rr, 0]);
      }
    }
  }

  // Lying across the screen (its axis is turned to x every frame)
  function helix(R, out) {
    var height = 3.2 * R, rr = Math.max(1.2, 0.36 * R), pitch = 1.3 * R;
    var dy = 1 / Math.sqrt(1 + Math.pow(rr * TAU / pitch, 2));
    var steps = Math.floor(height / dy);
    for (var k = 0; k <= steps; k++) {
      var y = -height / 2 + k * dy, a = y / pitch * TAU;
      var ax = Math.cos(a) * rr, az = Math.sin(a) * rr;
      out.push([ax, y, az, 0], [-ax, y, -az, 0]);
      // A rung between the strands every few steps
      if (k % 2 === 1) {
        var m = Math.max(0, Math.round(2 * rr) - 1);
        for (var j = 1; j <= m; j++) {
          var f = j / (m + 1) * 2 - 1;
          out.push([ax * -f, y, az * -f, 0]);
        }
      }
    }
  }

  // A 4D hypercube: the 16 corners and points along its 32 edges, in ±1
  // (scaled and turned in 4D every frame)
  function tesseract(R, out) {
    var half = 0.6 * R, m = Math.max(1, Math.min(7, Math.round(2 * half / 0.9) - 1));
    var corners = [];
    for (var c = 0; c < 16; c++) {
      corners.push([c & 1 ? 1 : -1, c & 2 ? 1 : -1, c & 4 ? 1 : -1, c & 8 ? 1 : -1]);
      out.push(corners[c].slice());
    }
    for (var a = 0; a < 16; a++) {
      for (var bit = 1; bit < 16; bit <<= 1) {
        var b = a | bit;
        if (b === a) continue;
        for (var j = 1; j <= m; j++) {
          var f = j / (m + 1);
          out.push([0, 1, 2, 3].map(function (d) { return corners[a][d] + (corners[b][d] - corners[a][d]) * f; }));
        }
      }
    }
    return half;   // how big ±1 is, in spacing units
  }

  function galaxy(R, out) {
    var r0 = Math.max(1.2, 0.18 * R), turns = 1.3 * Math.PI, b = Math.log(R / r0) / turns;
    for (var arm = 0; arm < 2; arm++) {
      for (var strand = 0; strand < 2; strand++) {
        var off = arm * Math.PI + strand * 0.42, th = strand ? 0.5 : 0;
        while (th < turns) {
          var r = r0 * Math.exp(b * th);
          if (!strand || r > 2.4) out.push([Math.cos(th + off) * r, 0, Math.sin(th + off) * r, 0]);
          th += 1 / (r * Math.sqrt(1 + b * b));
        }
      }
    }
    // The core
    for (var i = 0; i < 9; i++) {
      var y = 1 - 2 * (i + 0.5) / 9, q = Math.sqrt(1 - y * y), a = i * GOLDEN, cr = r0 * 0.75;
      out.push([Math.cos(a) * q * cr, y * cr * 0.6, Math.sin(a) * q * cr, 0]);
    }
  }

  // A flat grid; its height is a wave (and the music) every frame
  function terrain(R, out) {
    var hx = Math.round(1.5 * R), hz = Math.round(0.85 * R);
    for (var z = -hz; z <= hz; z++) {
      for (var x = -hx; x <= hx; x++) out.push([x, 0, z, (x + hx) / (2 * hx)]);
    }
  }

  function atom(R, out) {
    var n = Math.max(8, Math.round(TAU * R));
    for (var ring = 0; ring < 3; ring++) {
      var ry = ring * TAU / 3, tilt = 1.15;
      for (var i = 0; i < n; i++) {
        var t = i / n * TAU, x = Math.cos(t) * R, y = Math.sin(t) * R * Math.cos(tilt), z = Math.sin(t) * R * Math.sin(tilt);
        out.push([x * Math.cos(ry) - z * Math.sin(ry), y, x * Math.sin(ry) + z * Math.cos(ry), ring + 1]);
      }
    }
    // The nucleus
    for (var k = 0; k < 8; k++) {
      var yy = 1 - 2 * (k + 0.5) / 8, q = Math.sqrt(1 - yy * yy), a = k * GOLDEN;
      out.push([Math.cos(a) * q * 0.75, yy * 0.75, Math.sin(a) * q * 0.75, 0]);
    }
  }

  // Seven-segment digits: segments a b c d e f g, on a box 1 wide, 2 tall
  var SEG = {
    a: [0, 0, 1, 0], b: [1, 0, 1, 1], c: [1, 1, 1, 2], d: [0, 2, 1, 2],
    e: [0, 1, 0, 2], f: [0, 0, 0, 1], g: [0, 1, 1, 1]
  };
  var DIGITS = ['abcdef', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgedc', 'abc', 'abcdefg', 'abcdfg'];

  // The time as points; seg = segment length in spacing units. Proximity
  // can't tell an "8" from a "0" (the middle points are close either way), so
  // the time draws its own edges: along the lit segments only (`edges`, pairs
  // of point indices).
  function clockText(text, seg, out, edges) {
    var gap = 1.5 * seg, width = gap * (text.length - 1), i;
    for (i = 0; i < text.length; i++) width += text[i] === ':' ? 0 : seg;
    var x = -width / 2, seen = {};
    function add(px, py) {
      var key = Math.round(px * 10) + ',' + Math.round(py * 10);
      if (seen[key] === undefined) {
        seen[key] = out.length;
        out.push([px, py, 0, 0]);
      }
      return seen[key];
    }
    for (i = 0; i < text.length; i++) {
      var ch = text[i];
      if (ch === ':') {
        // Two short dashes, too far apart to connect to each other
        for (var dot = -1; dot <= 1; dot += 2) {
          var top = add(x, dot * seg * 0.75 - seg * 0.14), bottom = add(x, dot * seg * 0.75 + seg * 0.14);
          edges.push([top, bottom]);
        }
      } else {
        var segs = DIGITS[+ch] || '';
        for (var s = 0; s < segs.length; s++) {
          var g = SEG[segs[s]], prev = -1;
          for (var k = 0; k <= seg; k++) {
            var f = k / seg;
            var idx = add(x + (g[0] + (g[2] - g[0]) * f) * seg, (g[1] + (g[3] - g[1]) * f - 1) * seg);
            if (prev >= 0) edges.push([prev, idx]);
            prev = idx;
          }
        }
      }
      x += (ch === ':' ? 0 : seg) + gap;
    }
  }

  // ---------------------------------------------------------------------------
  // The audio visualizer (main.js starts it once music has been playing for a
  // while). A grid of nodes: columns are frequencies (the bass in the middle,
  // mirrored out to the treble), rows are time: row 0 is the spectrum live,
  // each row behind it what row 0 was a moment earlier. Two styles:
  //   terrain: a spectrogram landscape on the floor, the live ridge in front,
  //     the past flowing away into the distance, peak markers falling above
  //   tunnel: rings, the live spectrum far ahead around a core that throbs
  //     with the bass, the past rushing toward the viewer, twisting
  // ---------------------------------------------------------------------------
  var VIZ_SHIFT = 0.11;   // seconds per row of history
  var viz = {
    style: 'terrain', cols: 0, rows: 0, core: 0,
    live: new Float32Array(64), hist: new Float32Array(64 * 16), acc: new Float32Array(64),
    peak: new Float32Array(64), peakV: new Float32Array(64), band: new Int16Array(64),
    shiftT: 0, bass: 0
  };

  // Grid point indices: rows × cols, then the extras (peaks or the core)
  function vizGrid(style, cols, rows, out, edges) {
    var C = cols, R = rows, c, r;
    var id = function (cc, rr) { return rr * C + cc; };
    for (r = 0; r < R; r++) for (c = 0; c < C; c++) out.push([c, 0, r, 0]);
    var ring = style === 'tunnel';
    for (r = 0; r < R; r++) {
      for (c = 0; c < C; c++) {
        var c2 = c + 1;
        if (c2 >= C) {
          if (!ring) continue;
          c2 = 0;
        }
        edges.push([id(c, r), id(c2, r)]);
        if (r + 1 < R) {
          // Diagonals mirrored about the middle (a symmetric mesh)
          if (ring || c < (C - 1) / 2) edges.push([id(c, r), id(c2, r + 1)]);
          else edges.push([id(c2, r), id(c, r + 1)]);
        }
      }
      if (r + 1 < R) for (c = 0; c < C; c++) edges.push([id(c, r), id(c, r + 1)]);
    }
    var base = R * C;
    if (ring) {
      // The core: a small ring joined to the live ring by spokes
      var n = viz.core = 10;
      for (c = 0; c < n; c++) {
        out.push([c, 0, -1, 2]);
        edges.push([base + c, base + (c + 1) % n]);
        if (c % 2 === 0) edges.push([base + c, id(Math.round(c / n * C) % C, 0)]);
      }
    } else {
      // Peak markers over the live ridge, joined into an envelope
      for (c = 0; c < C; c++) {
        out.push([c, 0, -1, 1]);
        if (c) edges.push([base + c - 1, base + c]);
      }
    }
    // Which audio bands each column shows: bass in the middle (terrain) or at
    // the bottom (tunnel), up to the treble at the ends
    for (c = 0; c < C; c++) {
      var u = ring ? 1 - Math.abs(c / (C / 2) - 1) : Math.abs(c - (C - 1) / 2) / ((C - 1) / 2);
      viz.band[c] = Math.round(Math.pow(u, 1.1) * 44);
    }
  }

  // Live levels, the history and the peaks. The bands come smoothed already:
  // a hit goes straight up (no lag behind the music), only the fall is eased
  function vizStep(dt, bands) {
    var C = viz.cols, R = viz.rows, c;
    var down = 1 - Math.exp(-dt * 12);
    for (c = 0; c < C; c++) {
      var v = 0;
      if (bands) {
        var b = viz.band[c];
        v = (bands[b] + bands[Math.min(63, b + 1)] + bands[Math.min(63, b + 2)]) / 3;
      }
      var cur = viz.live[c];
      cur = v > cur ? v : cur + (v - cur) * down;
      viz.live[c] = cur;
      // Each row of history keeps the loudest moment of its slice of time
      if (cur > viz.acc[c]) viz.acc[c] = cur;
      if (cur >= viz.peak[c]) {
        viz.peak[c] = cur;
        viz.peakV[c] = 0;
      } else {
        viz.peakV[c] += dt * 1.8;
        viz.peak[c] = Math.max(cur, viz.peak[c] - viz.peakV[c] * dt);
      }
    }
    viz.bass = viz.live[viz.style === 'tunnel' ? 0 : (C - 1) >> 1];
    viz.shiftT += dt;
    if (viz.shiftT >= VIZ_SHIFT) {
      viz.shiftT %= VIZ_SHIFT;
      for (var r = R - 1; r > 0; r--) {
        for (c = 0; c < C; c++) viz.hist[r * C + c] = viz.hist[(r - 1) * C + c];
      }
      for (c = 0; c < C; c++) {
        viz.hist[c] = viz.acc[c];
        viz.acc[c] = viz.live[c];
      }
    }
  }

  // Level shown by grid point (c, r): live in front, the history behind. The
  // history scrolls back smoothly: row r shows the music of r rows' time ago,
  // between the two slices around it (no steps)
  function vizLevel(c, r) {
    if (r === 0) return viz.live[c];
    var C = viz.cols, a = viz.hist[(r - 1) * C + c], b = viz.hist[r * C + c];
    return a + (b - a) * (1 - viz.shiftT / VIZ_SHIFT);
  }

  function vizTarget(k, time) {
    var b = f.base, c = b[k * 4], r = b[k * 4 + 2], w = b[k * 4 + 3];
    var H = f.H, C = viz.cols, R = viz.rows, sz = f.size;
    // A gentle swell so it never lies dead flat between songs
    var idle = Math.sin(c * 0.7 + time * 1.6 + r * 0.5) * 0.012 * H;
    var lift = f.lift;
    if (viz.style === 'terrain') {
      // A floor seen from above: the near edge low on the screen, the far
      // one up toward the middle (lifted, it makes room for the big clock)
      var zN = -0.22 * H, zF = 0.95 * H, sN = net.view.F / (net.view.F + zN);
      var width = 0.9 * f.rw / sN, amp = 0.3 * H * sz, along = w === 1 ? 0 : r / (R - 1);
      var floor = 0.34 * H - 0.4 * H * along - lift * 0.24 * H;
      tgt[0] = f.cx + (c / (C - 1) - 0.5) * width;
      tgt[2] = zN + (zF - zN) * along;
      if (w === 1) {
        tgt[1] = floor - viz.peak[c] * amp * 1.3 - 0.025 * H;
      } else {
        var lv = vizLevel(c, r);
        tgt[1] = floor - (lv * lv * 1.15 + lv * 0.15) * amp + idle * (1 - lv);
      }
      return tgt;
    }
    // Tunnel: rings around the line of sight. The live one is far ahead; the
    // older ones come toward the viewer, growing, each a little more twisted.
    var zFar = 1.05 * H, zNear = -0.28 * H, R0 = 0.27 * H * sz, rad, th, z;
    var spin = time * 0.1;
    if (w === 2) {
      th = c / viz.core * TAU - spin;
      rad = 0.07 * H * sz * (1 + viz.bass * viz.bass);
      z = zFar + 0.08 * H;
    } else {
      var l2 = vizLevel(c, r);
      th = c / C * TAU + spin + r * 0.09;
      rad = R0 * (1 + 0.04 * r) + (l2 * l2 * 0.8 + l2 * 0.2) * 0.17 * H * sz + idle * 0.4;
      z = zFar - (zFar - zNear) * r / (R - 1);
    }
    var ay = Math.sin(time * 0.21) * 0.12;
    rad *= 1 - 0.18 * lift;
    var lx = Math.sin(th) * rad, ly = Math.cos(th) * rad;
    tgt[0] = f.cx + lx * Math.cos(ay) + z * Math.sin(ay);
    tgt[1] = ly - lift * 0.16 * H;
    tgt[2] = -lx * Math.sin(ay) + z * Math.cos(ay);
    return tgt;
  }

  // ---------------------------------------------------------------------------
  // The formation in progress
  // ---------------------------------------------------------------------------
  var f = {
    kind: null, phase: 0,       // 0 idle, 1 coming together, 2 holding
    t: 0, hold: 0, K: 0,
    nodes: null, base: null,    // node per point; [x, y, z, w] per point
    cx: 0, scale: 1, size4: 1,  // world center x; px per unit; hypercube scale
    spin: 0, nextFire: 0,
    R: 1,                       // radius it was built with (spacing units)
    reactive: false,            // dances to the music
    lift: 0, liftTo: 0,         // visualizer: raised for the big clock
    lock: 1,                    // LOCK of its nodes (2: its own edges only)
    ep: null, ea: null, eb: null, // its edges: point pairs; node pairs now
    // Points the singularity ate (node -1) grow back a node at a time: each
    // new node's journey (time, duration; position and velocity it set off with)
    lost: 0, regrow: 0, rt: null, rd: null, rf: null
  };

  var REGROW_GAP = 0.15;        // s between two points growing back
  var REGROW_WAIT = 1;          // s after the last bite before they start

  // Level of the music at u (0 = bass, 1 = treble), from the 64 bands
  function bandLevel(bands, u) {
    var b = Math.round(Math.pow(u < 0 ? 0 : u > 1 ? 1 : u, 1.1) * 44);
    return (bands[b] + bands[b + 1]) * 0.5;
  }

  // The time as the clock shows it (hours without a leading zero in 12-hour)
  function timeText(twelve) {
    var d = new Date(), hh = d.getHours(), mm = d.getMinutes();
    if (twelve) hh = hh % 12 || 12;
    return (twelve ? String(hh) : (hh < 10 ? '0' : '') + hh) + ':' + (mm < 10 ? '0' : '') + mm;
  }

  // o: { kind, W, H, L (connection distance, px), size, hold (s), cx (screen
  // x of the center, px), twelve (12-hour clock), style (visualizer:
  // 'terrain' or 'tunnel') }. Returns false if the network is too small for it.
  function start(o) {
    if (f.phase) release(net.view.unit);
    else clear();
    var N = net.n(), A = net.a();
    // Only free nodes (not the particle clock's)
    var free = [];
    for (var fi = 0; fi < N; fi++) if (!A.LOCK[fi]) free.push(fi);
    var budget = Math.min(Math.floor(free.length * 0.68), 420);
    var spacing = SPACING * o.L, pts = [], size4 = 1, edges = null;
    if (o.kind === 'clock') {
      // Wider spacing: the two points around a corner of a digit must not
      // connect (a diagonal), or the digits blur into a mesh
      spacing = 0.72 * o.L;
      // Digits about a third of the screen tall (and never too wide)
      var room = Math.min(0.18 * o.H * o.size, 0.085 * o.W);
      var seg = Math.max(1, Math.min(4, Math.floor(room / spacing + 0.35)));
      for (; seg >= 1; seg--) {
        pts = [];
        edges = [];
        clockText(timeText(o.twelve), seg, pts, edges);
        if (pts.length <= budget) break;
      }
    } else if (o.kind === 'visualizer') {
      // As fine as the network allows
      var style = o.style === 'tunnel' ? 'tunnel' : 'terrain';
      var sizes = style === 'tunnel' ? [[32, 6], [28, 5], [24, 5], [20, 4], [16, 4]] : [[19, 9], [17, 8], [15, 7], [13, 6], [11, 5]];
      for (var si = 0; si < sizes.length; si++) {
        pts = [];
        edges = [];
        viz.style = style;
        vizGrid(style, sizes[si][0], sizes[si][1], pts, edges);
        viz.cols = sizes[si][0];
        viz.rows = sizes[si][1];
        if (pts.length <= budget) break;
      }
      viz.live.fill(0);
      viz.hist.fill(0);
      viz.acc.fill(0);
      viz.peak.fill(0);
      viz.peakV.fill(0);
      viz.shiftT = 0;
    } else {
      var gen = { sphere: sphere, torus: torus, helix: helix, tesseract: tesseract, galaxy: galaxy, terrain: terrain, atom: atom }[o.kind];
      var R = SIZE[o.kind] * o.H * o.size / spacing;
      for (var tries = 0; tries < 24; tries++) {
        pts = [];
        size4 = gen(R, pts) || 1;
        if (pts.length <= budget || R < 0.9) break;
        R *= 0.92;
      }
      f.R = R;
    }
    if (pts.length < 6 || pts.length > budget) return false;

    // Recruit the visible nodes nearest to where the shape forms (a little
    // shuffled): the network draws together into it, no one crosses the screen
    var K = pts.length, order = Int32Array.from(free), i, score = new Float32Array(N);
    for (i = 0; i < order.length; i++) {
      var nd0 = order[i], ddx = A.SX[nd0] - o.cx, ddy = A.SY[nd0] - o.H / 2;
      score[nd0] = Math.sqrt(ddx * ddx + ddy * ddy) * (0.75 + 0.5 * Math.random()) + (A.VIS[nd0] > 0.4 ? 0 : 1e6);
    }
    order.sort(function (a, b) { return score[a] - score[b]; });
    f.nodes = new Int32Array(K);
    f.base = new Float32Array(K * 4);
    // Each node's journey: from where it is (drifting on while it waits its
    // turn), along a gentle arc
    f.from = new Float32Array(K * 6);
    f.delay = new Float32Array(K);
    f.arc = new Float32Array(K);
    for (i = 0; i < K; i++) {
      var nd = order[i];
      f.nodes[i] = nd;
      // 2: connects only through its own edges
      A.LOCK[nd] = f.lock = edges ? 2 : 1;
      for (var c = 0; c < 4; c++) f.base[i * 4 + c] = pts[i][c];
      f.from[i * 6] = A.X[nd];
      f.from[i * 6 + 1] = A.Y[nd];
      f.from[i * 6 + 2] = A.Z[nd];
      f.from[i * 6 + 3] = A.VX[nd] + A.IX[nd];
      f.from[i * 6 + 4] = A.VY[nd] + A.IY[nd];
      f.from[i * 6 + 5] = A.VZ[nd] + A.IZ[nd];
      f.delay[i] = Math.random() * STAGGER;
      f.arc[i] = Math.random() * 2 - 1;
      net.hold(nd);
    }
    f.lost = 0;
    f.regrow = 0;
    f.rt = new Float32Array(K).fill(-1);
    f.rd = new Float32Array(K);
    f.rf = new Float32Array(K * 6);
    f.ep = null;
    if (edges) {
      f.ep = new Int32Array(edges.length * 2);
      f.ea = new Int32Array(edges.length);
      f.eb = new Int32Array(edges.length);
      for (i = 0; i < edges.length; i++) {
        f.ep[i * 2] = edges[i][0];
        f.ep[i * 2 + 1] = edges[i][1];
      }
      relink();
    }
    f.kind = o.kind;
    f.K = K;
    f.phase = 1;
    f.lift = f.liftTo = 0;
    f.t = 0;
    f.hold = o.hold;
    f.cx = o.cx - net.view.W / 2;
    f.scale = spacing;
    f.size4 = size4;
    f.spin = Math.random() * TAU;
    f.nextFire = 0;
    f.H = o.H;
    f.rw = o.W;
    f.size = o.size;
    return true;
  }

  // The shape's own edges, between the nodes it has now (a point the
  // singularity ate has none until it grows back)
  function relink() {
    if (!f.ep) return;
    var m = 0;
    for (var e = 0; e < f.ea.length; e++) {
      var a = f.nodes[f.ep[e * 2]], b = f.nodes[f.ep[e * 2 + 1]];
      if (a < 0 || b < 0) continue;
      f.ea[m] = a;
      f.eb[m] = b;
      m++;
    }
    net.setEdges(0, f.ea, f.eb, m);
  }

  // One eaten point grows back: the free node nearest to it (out of the
  // singularity's reach) sets off at its own speed and eases in. False if
  // none can now.
  function regrowOne(A, o) {
    var K = f.K, s0 = (Math.random() * K) | 0, u = o.unit || 1;
    for (var j = 0; j < K; j++) {
      var i = (s0 + j) % K;
      if (f.nodes[i] >= 0) continue;
      var p = target(i, o.time, o.bands);
      if (net.inHole(p[0], p[1], p[2])) continue;
      var n = net.freeNear(p[0], p[1], p[2]);
      if (n < 0) return false;
      var r = i * 6, vx = A.VX[n] + A.IX[n], vy = A.VY[n] + A.IY[n];
      f.rf[r] = A.X[n];
      f.rf[r + 1] = A.Y[n];
      f.rf[r + 2] = A.Z[n];
      f.rf[r + 3] = vx;
      f.rf[r + 4] = vy;
      f.rf[r + 5] = A.VZ[n] + A.IZ[n];
      // About 250 px/s at most (1080p); heading away: time to turn around
      var dx = p[0] - A.X[n], dy = p[1] - A.Y[n], dz = p[2] - A.Z[n];
      var d = Math.max(1.2 + Math.random() * 0.5, Math.min(3.2, Math.sqrt(dx * dx + dy * dy + dz * dz) / (250 * u)));
      if (vx * dx + vy * dy < 0) d = Math.min(4.5, d + Math.sqrt(vx * vx + vy * vy) / (300 * u));
      f.rd[i] = d;
      f.rt[i] = 0;
      f.nodes[i] = n;
      A.LOCK[n] = f.lock;
      net.hold(n);
      f.lost--;
      relink();
      return true;
    }
    return false;
  }

  // Where point k goes now (world coordinates) → out[0..2]
  var tgt = new Float32Array(3);
  function target(k, time, bands) {
    if (f.kind === 'visualizer') return vizTarget(k, time);
    var b = f.base, x = b[k * 4], y = b[k * 4 + 1], z = b[k * 4 + 2], w = b[k * 4 + 3];
    var ay = f.spin + time * 0.22, ax = 0;
    if (f.reactive && bands) {
      var lv, kk;
      switch (f.kind) {
        case 'sphere':
          // Spikes: each point follows its own frequency (scattered over the
          // surface), the whole ball breathes with the bass
          lv = bandLevel(bands, (k * 0.618034) % 1);
          kk = 1 + lv * lv * 0.5 + Math.pow(bandLevel(bands, 0), 2) * 0.12;
          x *= kk;
          y *= kk;
          z *= kk;
          break;
        case 'torus':
          // The tube swells, the spectrum around the ring
          var rr = Math.sqrt(x * x + z * z) || 1, big = 0.68 * f.R;
          lv = bandLevel(bands, Math.abs(Math.atan2(z, x)) / Math.PI);
          kk = 1 + lv * lv * 0.45;
          var nr = big + (rr - big) * kk;
          x = x / rr * nr;
          z = z / rr * nr;
          y *= kk;
          break;
        case 'helix':
          // Opens and closes along its length (bass in the middle)
          lv = bandLevel(bands, Math.abs(y) / (1.25 * f.R));
          kk = 1 + lv * lv * 0.55;
          x *= kk;
          z *= kk;
          break;
        case 'galaxy':
          // The arms rise off the disc (bass at the core)
          lv = bandLevel(bands, Math.sqrt(x * x + z * z) / f.R);
          y -= lv * lv * 1.4;
          break;
        case 'atom':
          // Each ring its own range; the nucleus throbs with the bass
          lv = bandLevel(bands, w ? (w - 1) * 0.4 : 0);
          kk = 1 + lv * lv * (w ? 0.35 : 0.9);
          x *= kk;
          y *= kk;
          z *= kk;
          break;
        case 'clock':
          lv = bandLevel(bands, 0);
          kk = 1 + lv * lv * 0.12;
          x *= kk;
          y *= kk;
          break;
      }
    }
    switch (f.kind) {
      case 'torus':
        ax = 0.95;
        break;
      case 'helix':
        // Spins about its own axis, which lies across the screen
        var h = time * 0.6 + f.spin, ch = Math.cos(h), shh = Math.sin(h), hx = x * ch - z * shh;
        z = x * shh + z * ch;
        x = y;
        y = hx;
        ay = 0.35 * Math.sin(time * 0.2);
        ax = 0.25;
        break;
      case 'tesseract':
        // Turn in two 4D planes (XW, ZW), then see it in perspective
        var a1 = time * 0.31, a2 = time * 0.19;
        var c1 = Math.cos(a1), s1 = Math.sin(a1), c2 = Math.cos(a2), s2 = Math.sin(a2);
        var x1 = x * c1 - w * s1, w1 = x * s1 + w * c1;
        var z1 = z * c2 - w1 * s2, w2 = z * s2 + w1 * c2;
        var p = 3 / (3.6 - w2) * f.size4;
        if (f.reactive && bands) p *= 1 + Math.pow(bandLevel(bands, 0), 2) * 0.3;
        x = x1 * p;
        y *= p;
        z = z1 * p;
        ax = 0.35;
        break;
      case 'galaxy':
        // Spins in its plane, which leans toward the viewer
        var g = time * 0.18, cg = Math.cos(g), sg = Math.sin(g), gx = x * cg - z * sg;
        z = x * sg + z * cg;
        x = gx;
        ax = 1.08;
        ay = f.spin * 0.3;
        break;
      case 'terrain':
        var level = bands ? bands[Math.min(bands.length - 1, (w * (bands.length - 1)) | 0)] : 0;
        y = -(Math.sin(x * 0.55 + time * 1.4) * Math.cos(z * 0.7 - time * 0.9) * 0.9 + level * level * 2.4);
        ax = 0.5;
        ay = f.spin + time * 0.1;
        break;
      case 'atom':
        ax = 0.3;
        ay = f.spin + time * 0.35;
        break;
      case 'clock':
        ay = Math.sin(time * 0.5) * 0.28;
        break;
    }
    // Turn about y, then lean about x
    var cy = Math.cos(ay), sy = Math.sin(ay), rx = x * cy + z * sy, rz = -x * sy + z * cy;
    var cx = Math.cos(ax), sx = Math.sin(ax), ry = y * cx - rz * sx;
    rz = y * sx + rz * cx;
    tgt[0] = f.cx + rx * f.scale;
    tgt[1] = ry * f.scale;
    tgt[2] = rz * f.scale;
    return tgt;
  }

  // o: { time, bands, unit, signals (bool) }. Returns 'hold' when the shape
  // completes, 'release' when it lets go, otherwise null.
  function update(dt, o) {
    if (!f.phase) return null;
    var A = net.a(), event = null, isViz = f.kind === 'visualizer';
    f.t += dt;
    if (isViz) vizStep(dt, o.bands);
    // Once formed it follows its (moving) shape; the visualizer and shapes
    // dancing to the music follow tightly, right on the beat
    var follow = isViz ? 45 : f.reactive ? 28 : 7, a = 1 - Math.exp(-dt * follow);
    f.lift += (f.liftTo - f.lift) * (1 - Math.exp(-dt * 2));
    var bitten = false;
    for (var i = 0; i < f.K; i++) {
      var n = f.nodes[i];
      if (n < 0) continue;              // eaten: it grows back later
      if (A.LOCK[n] !== f.lock) {
        // Torn off by the singularity
        f.nodes[i] = -1;
        f.rt[i] = -1;
        f.lost++;
        bitten = true;
        continue;
      }
      var p = target(i, o.time, o.bands);
      if (f.rt[i] >= 0) {
        f.rt[i] += dt;
        var rt = f.rt[i] / f.rd[i];
        if (rt < 1) {
          // Growing back (Hermite): it leaves at its own speed and eases onto
          // its (moving) point
          var r2 = rt * rt, r3 = r2 * rt, D = f.rd[i], r = i * 6;
          var g00 = 2 * r3 - 3 * r2 + 1, g10 = (r3 - 2 * r2 + rt) * D, g01 = 3 * r2 - 2 * r3;
          A.X[n] = g00 * f.rf[r] + g10 * f.rf[r + 3] + g01 * p[0];
          A.Y[n] = g00 * f.rf[r + 1] + g10 * f.rf[r + 4] + g01 * p[1];
          A.Z[n] = g00 * f.rf[r + 2] + g10 * f.rf[r + 5] + g01 * p[2];
          A.JOIN[n] = ease(rt);
          A.IX[n] = A.IY[n] = A.IZ[n] = 0;
          continue;
        }
        f.rt[i] = -1;
      }
      if (f.phase === 1) {
        // Coming together: it eases off, travels along its arc and eases in
        // (no sudden speed at either end)
        var d0 = f.delay[i], wait = f.t < d0 ? f.t : d0, fr = f.from;
        var sx = fr[i * 6] + fr[i * 6 + 3] * wait, sy = fr[i * 6 + 1] + fr[i * 6 + 4] * wait, sz = fr[i * 6 + 2] + fr[i * 6 + 5] * wait;
        var e = ease((f.t - d0) / (GATHER - 0.15 - d0)), u = 1 - e;
        var dx = p[0] - sx, dy = p[1] - sy, bend = f.arc[i] * 0.2;
        var mx = (sx + p[0]) / 2 - dy * bend, my = (sy + p[1]) / 2 + dx * bend, mz = (sz + p[2]) / 2;
        A.X[n] = u * u * sx + 2 * u * e * mx + e * e * p[0];
        A.Y[n] = u * u * sy + 2 * u * e * my + e * e * p[1];
        A.Z[n] = u * u * sz + 2 * u * e * mz + e * e * p[2];
        A.JOIN[n] = e;
      } else {
        A.X[n] += (p[0] - A.X[n]) * a;
        A.Y[n] += (p[1] - A.Y[n]) * a;
        A.Z[n] += (p[2] - A.Z[n]) * a;
        A.JOIN[n] = 1;
      }
      A.IX[n] = A.IY[n] = A.IZ[n] = 0;
    }
    if (isViz && f.phase === 2) {
      // The live ridge glows white where it peaks
      var C = viz.cols;
      for (var c = 0; c < C; c++) {
        var ln = f.nodes[c], h2 = viz.live[c] * viz.live[c] * 0.55;
        if (ln >= 0 && A.LOCK[ln] === f.lock && A.HEAT[ln] < h2) A.HEAT[ln] = h2;
      }
    }
    if (bitten) {
      relink();
      f.regrow = Math.max(f.regrow, REGROW_WAIT);
    }
    // What the singularity ate grows back slowly, a node at a time
    if (f.phase === 2 && f.lost > 0) {
      f.regrow -= dt;
      if (f.regrow <= 0) f.regrow = regrowOne(A, o) ? REGROW_GAP : 0.25;
    }
    if (f.phase === 1 && f.t >= GATHER) {
      f.phase = 2;
      f.t = 0;
      event = 'hold';
      if (o.signals && !isViz) for (var s = 0; s < 2; s++) fireRandom(0.6);
      f.nextFire = 2.2;
    } else if (f.phase === 2) {
      // Signals keep racing along the edges (the visualizer gets the beats)
      f.nextFire -= dt;
      if (o.signals && !isViz && f.nextFire <= 0) {
        fireRandom(0.5);
        f.nextFire = 2 + Math.random() * 2;
      }
      if (f.t >= f.hold) {
        release(o.unit);
        event = 'release';
      }
    }
    return event;
  }

  function fireRandom(e) {
    var A = net.a();
    for (var t = 0; t < 6; t++) {
      var n = f.nodes[(Math.random() * f.K) | 0];
      if (n >= 0 && A.LOCK[n] === f.lock) { net.fire(n, e, -1); return; }
    }
  }

  function smooth(x) {
    x = x < 0 ? 0 : x > 1 ? 1 : x;
    return x * x * (3 - 2 * x);
  }

  // 0 → 1 with no speed at either end, nor a jolt (smootherstep)
  function ease(x) {
    x = x < 0 ? 0 : x > 1 ? 1 : x;
    return x * x * x * (x * (x * 6 - 15) + 10);
  }

  // Let go: the shape's lines fade out (net.ghost) while the nodes drift
  // steadily apart from its center, back into the network
  function release(unit) {
    if (!f.phase) return;
    var A = net.a(), m = 0, i;
    // Only the nodes it still holds (not the ones the singularity ate)
    for (i = 0; i < f.K; i++) {
      var k = f.nodes[i];
      if (k >= 0 && A.LOCK[k] === f.lock) f.nodes[m++] = k;
    }
    f.K = m;
    net.ghost(f.nodes, m);
    for (i = 0; i < m; i++) {
      var n = f.nodes[i];
      A.LOCK[n] = 0;
      var dx = A.X[n] - f.cx, dy = A.Y[n], dz = A.Z[n], d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1;
      // A soft push, and their own drift turning outward (from rest: it
      // picks up speed gradually)
      var v = (12 + 18 * Math.random()) * (unit || 1);
      net.nudge(n, dx / d * v, dy / d * v, dz / d * v * 0.5);
      var dv = (16 + 18 * Math.random()) * (unit || 1);
      A.VX[n] = A.VY[n] = A.VZ[n] = 0;
      A.TX[n] = dx / d * dv;
      A.TY[n] = dy / d * dv;
      A.TZ[n] = dz / d * dv * 0.3;
    }
    f.phase = 0;
    f.kind = null;
    net.setEdges(0, null, null, 0);
  }

  // Drops the formation at once (new layout): the nodes are rebuilt anyway
  function clear() {
    f.phase = 0;
    f.kind = null;
    f.K = 0;
    net.setEdges(0, null, null, 0);
  }

  S.shapes = {
    KINDS: KINDS,
    start: start,
    update: update,
    release: release,
    clear: clear,
    active: function () { return f.phase !== 0; },
    kind: function () { return f.kind; },
    phase: function () { return f.phase; },
    // 0–1: how complete the formation is (0 when there is none)
    level: function () { return f.phase === 2 ? 1 : f.phase === 1 ? smooth(f.t / GATHER) : 0; },
    // Screen center of the formation (for the release shockwave)
    centerX: function () { return f.cx + net.view.W / 2; },
    vizStyle: function () { return viz.style; },
    // Dance to the music (every frame from main.js)
    setReactive: function (v) { f.reactive = !!v; },
    // Visualizer: 1 = raised to make room for the big clock below
    setLift: function (v) { f.liftTo = v; },
    lift: function () { return f.lift; }
  };
})(window.Plexus = window.Plexus || {});
