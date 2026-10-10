/*
 * Neural Plexus — the particle clock (the "Particles" clock font): the time
 * drawn by the network's own nodes, as seven-segment digits whose edges are
 * the network's connections.
 *
 * Every second main.js hands it where the digits go; it works out the points
 * and edges and moves nodes there. Digits that didn't change keep their
 * nodes; the rest are taken from the nearest nodes of the clock (so a digit
 * morphs into the next) or from the free network, and the ones left over glide
 * back to where they were taken from and drift on. Around the turn of the hour it can draw a big, denser
 * clock ("HD": each segment a strip of triangles) in the middle of the screen.
 *
 * Its nodes are LOCK 3: they connect only through the clock's own edges, and
 * no formation takes them. The singularity can tear them off: those points
 * (node -1) grow back slowly, a node at a time.
 */
(function (S) {
  'use strict';

  var net = S.net;
  var MAX = 700;                 // points at most
  var DW = 0.5;                  // digit width, in digit heights

  // Seven-segment digits on a box 1 wide, 1 tall (scaled to w × h)
  var SEG = {
    a: [0, 0, 1, 0], b: [1, 0, 1, 0.5], c: [1, 0.5, 1, 1], d: [0, 1, 1, 1],
    e: [0, 0.5, 0, 1], f: [0, 0, 0, 0.5], g: [0, 0.5, 1, 0.5]
  };
  var DIGITS = ['abcdef', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgedc', 'abc', 'abcdefg', 'abcdfg'];

  // Gaps, in digit heights
  var GAP = 0.26, COLON = 0.16, SMALL = 0.42, SMALL_GAP = 0.2;

  // ---------------------------------------------------------------------------
  // Points and edges (canvas px), rebuilt when the time or the layout changes
  // ---------------------------------------------------------------------------
  var px = new Float32Array(MAX), py = new Float32Array(MAX), pn = 0;
  var ea = [], eb = [];          // edges, point indices
  var seen = {};

  function point(x, y, dedupe) {
    if (dedupe) {
      var key = Math.round(x * 2) + ',' + Math.round(y * 2);
      if (seen[key] !== undefined) return seen[key];
      seen[key] = pn;
    }
    if (pn >= MAX) return pn - 1;
    px[pn] = x;
    py[pn] = y;
    return pn++;
  }

  function edge(a, b) {
    if (a === b) return;
    ea.push(a);
    eb.push(b);
  }

  // A digit as single strokes: points every `step` px along the lit segments
  function digitLine(ch, x, y, h, step) {
    var w = h * DW, segs = DIGITS[+ch] || '';
    seen = {};
    for (var s = 0; s < segs.length; s++) {
      var g = SEG[segs[s]];
      var x1 = x + g[0] * w, y1 = y + g[1] * h, x2 = x + g[2] * w, y2 = y + g[3] * h;
      var n = Math.max(1, Math.round(Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1)) / step)), prev = -1;
      for (var k = 0; k <= n; k++) {
        var i = point(x1 + (x2 - x1) * k / n, y1 + (y2 - y1) * k / n, true);
        if (prev >= 0) edge(prev, i);
        prev = i;
      }
    }
  }

  // A digit as display segments: each a strip of triangles with pointed ends
  function digitHD(ch, x, y, h, step) {
    var w = h * DW, segs = DIGITS[+ch] || '', tw = h * 0.09, gap = h * 0.04;
    for (var s = 0; s < segs.length; s++) {
      var g = SEG[segs[s]];
      var x1 = x + g[0] * w, y1 = y + g[1] * h, x2 = x + g[2] * w, y2 = y + g[3] * h;
      var len = Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1)), ux = (x2 - x1) / len, uy = (y2 - y1) / len;
      var vx = -uy * tw / 2, vy = ux * tw / 2;
      var sx = x1 + ux * gap, sy = y1 + uy * gap, inner = len - 2 * gap - tw;
      var n = Math.max(1, Math.round(inner / step));
      var tip0 = point(sx, sy), pa = -1, pb = -1, a, b;
      for (var k = 0; k <= n; k++) {
        var cx = sx + ux * (tw / 2 + inner * k / n), cy = sy + uy * (tw / 2 + inner * k / n);
        a = point(cx + vx, cy + vy);
        b = point(cx - vx, cy - vy);
        edge(a, b);
        if (pa >= 0) {
          edge(pa, a);
          edge(pb, b);
          edge(pa, b);
        } else {
          edge(tip0, a);
          edge(tip0, b);
        }
        pa = a;
        pb = b;
      }
      var tip1 = point(x2 - ux * gap, y2 - uy * gap);
      edge(tip1, pa);
      edge(tip1, pb);
    }
  }

  // The colon: two dots (single nodes), or two small diamonds in HD
  function colon(x, y, h, hd) {
    for (var d = -1; d <= 1; d += 2) {
      var cy = y + h / 2 + d * h * 0.22, r = h * 0.05;
      if (hd) {
        var t = point(x, cy - r), rr = point(x + r, cy), bb = point(x, cy + r), l = point(x - r, cy);
        edge(t, rr);
        edge(rr, bb);
        edge(bb, l);
        edge(l, t);
        edge(t, bb);
      } else {
        point(x, cy);
      }
    }
  }

  // Width of the time, in digit heights
  function measure(text, secs) {
    var w = 0, i;
    for (i = 0; i < text.length; i++) {
      if (i) w += text[i] === ':' || text[i - 1] === ':' ? COLON : GAP;
      w += text[i] === ':' ? 0 : DW;
    }
    if (secs) w += SMALL_GAP + SMALL * (COLON + 2 * DW + GAP);
    return w;
  }

  // The time with its top left corner at (x, y), digits h px tall; `fine`:
  // points per segment (more = smoother, more nodes)
  function layout(text, secs, x, y, h, hd, fine) {
    pn = 0;
    ea.length = eb.length = 0;
    var step = h / fine, i;
    for (i = 0; i < text.length; i++) {
      if (i) x += (text[i] === ':' || text[i - 1] === ':' ? COLON : GAP) * h;
      if (text[i] === ':') {
        colon(x, y, h, hd);
      } else {
        if (hd) digitHD(text[i], x, y, h, step);
        else digitLine(text[i], x, y, h, step);
        x += DW * h;
      }
    }
    if (secs) {
      // Seconds: small, single strokes on the baseline, points at the corners
      // only (more would crowd into a glare at this size)
      var hs = h * SMALL, ys = y + h - hs;
      x += SMALL_GAP * h;
      colon(x, ys, hs, false);
      x += COLON * hs;
      digitLine(secs[0], x, ys, hs, hs * 2);
      x += (DW + GAP) * hs;
      digitLine(secs[1], x, ys, hs, hs * 2);
    }
  }

  // ---------------------------------------------------------------------------
  // Nodes
  // ---------------------------------------------------------------------------
  var nodes = new Int32Array(MAX), K = 0;
  var tx = new Float32Array(MAX), ty = new Float32Array(MAX);
  // Where each node was taken from (it goes back there when let go)
  var hx = new Float32Array(MAX), hy = new Float32Array(MAX), hz = new Float32Array(MAX);
  var nhx = new Float32Array(MAX), nhy = new Float32Array(MAX), nhz = new Float32Array(MAX);
  var edgeA = new Int32Array(MAX * 4), edgeB = new Int32Array(MAX * 4);
  // The edges as point pairs (the nodes behind them change as they're eaten
  // and grow back)
  var edgeP = new Int32Array(MAX * 8), edgeN = 0;
  var regrow = 0, REGROW_GAP = 0.15, REGROW_WAIT = 1;
  var used = new Uint8Array(MAX), next = new Int32Array(MAX), freed = new Int32Array(MAX);
  // Each node's journey to its point: where from, how far along, how long
  var fx = new Float32Array(MAX), fy = new Float32Array(MAX), fz = new Float32Array(MAX);
  var fe = new Float32Array(MAX), fd = new Float32Array(MAX), fa = new Float32Array(MAX);
  var nfx = new Float32Array(MAX), nfy = new Float32Array(MAX), nfz = new Float32Array(MAX);
  var nfe = new Float32Array(MAX), nfd = new Float32Array(MAX), nfa = new Float32Array(MAX);
  // The velocity a journey starts with (the node's own), and each node's
  // velocity last frame
  var jvx = new Float32Array(MAX), jvy = new Float32Array(MAX), jvz = new Float32Array(MAX);
  var njvx = new Float32Array(MAX), njvy = new Float32Array(MAX), njvz = new Float32Array(MAX);
  var lvx = new Float32Array(MAX), lvy = new Float32Array(MAX), lvz = new Float32Array(MAX);
  var key = '', cx = 0, cy = 0;

  // 0 → 1 with no speed at either end (smootherstep)
  function ease(x) {
    x = x < 0 ? 0 : x > 1 ? 1 : x;
    return x * x * x * (x * (x * 6 - 15) + 10);
  }

  // Lets node i go from clock slot k: a push that builds up and fades takes
  // it back home (the velocity from forces fades at 1.6/s, so a push covers
  // 1/1.6 of it)
  function freeNode(A, i, k) {
    A.LOCK[i] = 0;
    net.nudge(i, (hx[k] - A.X[i]) * 1.6, (hy[k] - A.Y[i]) * 1.6, (hz[k] - A.Z[i]) * 1.6);
    net.pickDrift(i);
  }

  // The journey for point i (new slot) of node n: kept if it goes on to the
  // same place, otherwise a new one from where the node is
  function journey(A, i, n, oldSlot, far) {
    var tx2 = px[i] - net.view.W / 2, ty2 = py[i] - net.view.H / 2;
    if (oldSlot >= 0 && Math.abs(tx[oldSlot] - tx2) < 1 && Math.abs(ty[oldSlot] - ty2) < 1) {
      nfx[i] = fx[oldSlot];
      nfy[i] = fy[oldSlot];
      nfz[i] = fz[oldSlot];
      nfe[i] = fe[oldSlot];
      nfd[i] = fd[oldSlot];
      nfa[i] = fa[oldSlot];
      njvx[i] = jvx[oldSlot];
      njvy[i] = jvy[oldSlot];
      njvz[i] = jvz[oldSlot];
      return;
    }
    // It sets off at the speed it already had (in depth too): no jolt
    njvx[i] = oldSlot >= 0 ? lvx[oldSlot] : A.VX[n] + A.IX[n];
    njvy[i] = oldSlot >= 0 ? lvy[oldSlot] : A.VY[n] + A.IY[n];
    njvz[i] = oldSlot >= 0 ? lvz[oldSlot] : A.VZ[n] + A.IZ[n];
    // Heading away from its point: more time to turn around gently
    if (njvx[i] * (tx2 - nfx[i]) + njvy[i] * (ty2 - nfy[i]) < 0) {
      nfd[i] = Math.min(4.5, nfd[i] + Math.sqrt(njvx[i] * njvx[i] + njvy[i] * njvy[i]) / (300 * net.view.unit));
    }
    nfx[i] = A.X[n];
    nfy[i] = A.Y[n];
    nfz[i] = A.Z[n];
    nfe[i] = 0;
    // To the middle and back: slow and staggered; a digit changing: brisk;
    // a node from the network: in between. Longer trips take longer, so
    // nobody has to rush (about 250 px/s on average at most, at 1080p).
    var ddx = A.X[n] - tx2, ddy = A.Y[n] - ty2, trip = Math.sqrt(ddx * ddx + ddy * ddy) / (250 * net.view.unit);
    nfd[i] = Math.max(far ? 1.9 + Math.random() * 0.7 : oldSlot >= 0 ? 0.6 : 1.1 + Math.random() * 0.4, Math.min(3.2, trip));
    nfa[i] = Math.random() * 2 - 1;
  }

  // Free nodes the clock may take (not too many: the network stays alive)
  function freeCount(A, N) {
    var n = 0;
    for (var i = 0; i < N; i++) if (!A.LOCK[i]) n++;
    return n;
  }

  // The clock's edges between the nodes it has now
  function relink() {
    var m = 0;
    for (var e = 0; e < edgeN; e++) {
      var a = nodes[edgeP[e * 2]], b = nodes[edgeP[e * 2 + 1]];
      if (a < 0 || b < 0) continue;
      edgeA[m] = a;
      edgeB[m] = b;
      m++;
    }
    net.setEdges(1, edgeA, edgeB, m);
  }

  // One eaten point grows back: the free node nearest to it (out of the
  // singularity's reach) sets off at its own speed. False if none can now.
  function regrowOne(A) {
    var s0 = (Math.random() * K) | 0, u = net.view.unit;
    for (var j = 0; j < K; j++) {
      var k = (s0 + j) % K;
      if (nodes[k] >= 0 || net.inHole(tx[k], ty[k], 0)) continue;
      var n = net.freeNear(tx[k], ty[k], 0);
      if (n < 0) return false;
      nodes[k] = n;
      A.LOCK[n] = 3;
      hx[k] = fx[k] = A.X[n];
      hy[k] = fy[k] = A.Y[n];
      hz[k] = fz[k] = A.Z[n];
      jvx[k] = lvx[k] = A.VX[n] + A.IX[n];
      jvy[k] = lvy[k] = A.VY[n] + A.IY[n];
      jvz[k] = lvz[k] = A.VZ[n] + A.IZ[n];
      var dx = tx[k] - A.X[n], dy = ty[k] - A.Y[n];
      var d = Math.max(1.2 + Math.random() * 0.5, Math.min(3.2, Math.sqrt(dx * dx + dy * dy) / (250 * u)));
      if (jvx[k] * dx + jvy[k] * dy < 0) d = Math.min(4.5, d + Math.sqrt(jvx[k] * jvx[k] + jvy[k] * jvy[k]) / (300 * u));
      fd[k] = d;
      fe[k] = 0;
      fa[k] = Math.random() * 2 - 1;
      net.hold(n);
      relink();
      return true;
    }
    return false;
  }

  // Moves the clock onto the points just laid out: each point takes the
  // nearest clock node still unused, then the nearest free node; the clock
  // nodes left over go back to the network. A point the singularity ate
  // stays eaten where the clock stays (it grows back slowly), and the clock
  // doesn't refill into the singularity.
  function assign(far) {
    var A = net.a(), W2 = net.view.W / 2, H2 = net.view.H / 2, i, k;
    var reach2 = far ? Infinity : Math.pow(net.view.H * 0.06, 2);
    for (k = 0; k < K; k++) {
      if (nodes[k] >= 0 && A.LOCK[nodes[k]] !== 3) nodes[k] = -1;
      used[k] = nodes[k] < 0 && far ? 1 : 0;
    }
    for (i = 0; i < pn; i++) {
      var wx = px[i] - W2, wy = py[i] - H2, best = -1, bd = reach2;
      // By where each node is headed (not where it is: one still on its way
      // keeps its place, and its journey)
      for (k = 0; k < K; k++) {
        if (used[k]) continue;
        var dx = tx[k] - wx, dy = ty[k] - wy, d2 = dx * dx + dy * dy;
        if (d2 < bd) { bd = d2; best = k; }
      }
      if (best >= 0 && nodes[best] < 0) {
        // Still eaten
        used[best] = 1;
        next[i] = -2;
        continue;
      }
      if (best >= 0) {
        used[best] = 1;
        next[i] = nodes[best];
        nhx[i] = hx[best];
        nhy[i] = hy[best];
        nhz[i] = hz[best];
        journey(A, i, nodes[best], best, far);
        continue;
      }
      // A free node: the nearest on screen (none inside the singularity)
      if (net.inHole(wx, wy, 0)) { next[i] = -2; continue; }
      var fb = net.freeNear(wx, wy, 0);
      if (fb < 0) { next[i] = -1; continue; }
      A.LOCK[fb] = 3;
      next[i] = fb;
      nhx[i] = A.X[fb];
      nhy[i] = A.Y[fb];
      nhz[i] = A.Z[fb];
      journey(A, i, fb, -1, far);
      net.hold(fb);
    }
    // The nodes left over fade out of the clock (their lines linger a moment)
    var nf = 0;
    for (k = 0; k < K; k++) if (!used[k] && nodes[k] >= 0) freed[nf++] = nodes[k];
    if (nf) net.ghost(freed, nf);
    for (k = 0; k < K; k++) if (!used[k] && nodes[k] >= 0) freeNode(A, nodes[k], k);
    // Points that found no node are dropped (with their edges); eaten ones
    // (-2) stay, waiting to grow back
    K = 0;
    var remap = new Int32Array(pn);
    for (i = 0; i < pn; i++) {
      if (next[i] === -1) { remap[i] = -1; continue; }
      remap[i] = K;
      nodes[K] = next[i] < 0 ? -1 : next[i];
      tx[K] = px[i] - W2;
      ty[K] = py[i] - H2;
      hx[K] = nhx[i];
      hy[K] = nhy[i];
      hz[K] = nhz[i];
      fx[K] = nfx[i];
      fy[K] = nfy[i];
      fz[K] = nfz[i];
      fe[K] = nfe[i];
      fd[K] = nfd[i];
      fa[K] = nfa[i];
      jvx[K] = njvx[i];
      jvy[K] = njvy[i];
      jvz[K] = njvz[i];
      lvx[K] = njvx[i];
      lvy[K] = njvy[i];
      lvz[K] = njvz[i];
      K++;
    }
    edgeN = 0;
    for (var e = 0; e < ea.length && edgeN < edgeA.length; e++) {
      var a = remap[ea[e]], b = remap[eb[e]];
      if (a < 0 || b < 0) continue;
      edgeP[edgeN * 2] = a;
      edgeP[edgeN * 2 + 1] = b;
      edgeN++;
    }
    relink();
  }

  /*
   * o: {
   *   text ('08:48'), secs ('15' or ''), hd (bool),
   *   box: { left, top, width, height } (canvas px) where the time goes
   *     when not hd, align: 'left' | 'center' | 'right';
   *   area: { x0, w } the screen for the hd clock; H,
   *   bottom (bool): the hd clock goes low and smaller (the visualizer is up)
   * }
   * Rebuilds the points when anything changed.
   */
  function set(o) {
    var k2 = o.text + '|' + o.secs + '|' + o.hd + (o.bottom ? 'b' : '') + '|' + (o.hd ? o.area.x0 + ',' + o.area.w : Math.round(o.box.left) + ',' + Math.round(o.box.top) + ',' + Math.round(o.box.width) + ',' + Math.round(o.box.height)) + '|' + o.align;
    if (k2 === key) return false;
    var wasHD = key.split('|')[2], first = !K, hdKey = String(o.hd) + (o.bottom ? 'b' : '');
    key = k2;
    var units = measure(o.text, o.secs), h, x, y;
    if (o.hd && o.bottom) {
      // Under the visualizer, at the bottom of the screen
      h = Math.min(o.H * 0.2, o.area.w * 0.7 / units);
      x = o.area.x0 + (o.area.w - units * h) / 2;
      y = o.H * 0.93 - h;
    } else if (o.hd) {
      h = Math.min(o.H * 0.38, o.area.w * 0.8 / units);
      x = o.area.x0 + (o.area.w - units * h) / 2;
      y = (o.H - h) / 2;
    } else {
      h = o.box.height * 0.7;
      x = o.align === 'left' ? o.box.left
        : o.align === 'right' ? o.box.left + o.box.width - units * h
        : o.box.left + (o.box.width - units * h) / 2;
      y = o.box.top + (o.box.height - h) / 2 + o.box.height * 0.04;
    }
    cx = x + units * h / 2;
    cy = y + h / 2;
    // HD needs many nodes: lighter versions when the network is small
    var A = net.a(), N = net.n(), room = K + freeCount(A, N) * 0.8;
    layout(o.text, o.secs, x, y, h, o.hd, o.hd ? (o.bottom ? 5 : 8) : 4.5);
    if (o.hd && pn > room) layout(o.text, o.secs, x, y, h, true, 5);
    if (o.hd && pn > room) layout(o.text, o.secs, x, y, h, true, 4);
    if (o.hd && pn > room) layout(o.text, o.secs, x, y, h, false, 7);
    if (pn > room) pn = Math.floor(room);
    // A new place (or the first time): the nodes travel slowly
    assign(first || hdKey !== wasHD);
    return true;
  }

  // pulse: scale about the center (bass)
  function update(dt, pulse) {
    if (!K) return;
    var A = net.a(), W2 = net.view.W / 2, H2 = net.view.H / 2, ccx = cx - W2, ccy = cy - H2, bitten = false, eaten = 0;
    for (var i = 0; i < K; i++) {
      var n = nodes[i];
      if (n < 0) { eaten++; continue; }
      if (A.LOCK[n] !== 3) {
        // Torn off by the singularity: it grows back later
        nodes[i] = -1;
        eaten++;
        bitten = true;
        continue;
      }
      var gx = ccx + (tx[i] - ccx) * pulse, gy = ccy + (ty[i] - ccy) * pulse;
      fe[i] += dt;
      var t = fe[i] / fd[i], ox = A.X[n], oy = A.Y[n], oz = A.Z[n];
      if (t >= 1) {
        A.X[n] = gx;
        A.Y[n] = gy;
        A.Z[n] = 0;
      } else {
        // A smooth curve (Hermite): it leaves at the speed it had, arrives at
        // rest, bowing gently to one side on the way
        var t2 = t * t, t3 = t2 * t, D = fd[i];
        var h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = 3 * t2 - 2 * t3;
        var sx = fx[i], sy = fy[i], dx = gx - sx, dy = gy - sy, bow = 16 * t2 * (1 - t) * (1 - t) * fa[i] * 0.15;
        A.X[n] = h00 * sx + h10 * D * jvx[i] + h01 * gx - dy * bow;
        A.Y[n] = h00 * sy + h10 * D * jvy[i] + h01 * gy + dx * bow;
        A.Z[n] = fz[i] * h00 + h10 * D * jvz[i];
      }
      if (dt > 0) {
        lvx[i] = (A.X[n] - ox) / dt;
        lvy[i] = (A.Y[n] - oy) / dt;
        lvz[i] = (A.Z[n] - oz) / dt;
      }
      A.JOIN[n] = ease(t);
      A.IX[n] = A.IY[n] = A.IZ[n] = 0;
    }
    if (bitten) {
      relink();
      regrow = Math.max(regrow, REGROW_WAIT);
    }
    // What the singularity ate grows back slowly, a node at a time
    if (eaten) {
      regrow -= dt;
      if (regrow <= 0) regrow = regrowOne(A) ? REGROW_GAP : 0.25;
    }
  }

  // Lets every node go (the clock is turned off or changes font)
  function release() {
    if (!K) return;
    var A = net.a(), nf = 0, i;
    for (i = 0; i < K; i++) if (nodes[i] >= 0 && A.LOCK[nodes[i]] === 3) freed[nf++] = nodes[i];
    net.ghost(freed, nf);
    for (i = 0; i < K; i++) if (nodes[i] >= 0 && A.LOCK[nodes[i]] === 3) freeNode(A, nodes[i], i);
    K = 0;
    key = '';
    regrow = 0;
    net.setEdges(1, null, null, 0);
  }

  // The nodes were rebuilt (new layout): nothing to let go
  function clear() {
    K = 0;
    key = '';
    regrow = 0;
    net.setEdges(1, null, null, 0);
  }

  S.pclock = {
    set: set,
    update: update,
    release: release,
    clear: clear,
    measure: measure,
    active: function () { return K > 0; },
    count: function () { return K; },
    center: function () { return { x: cx, y: cy }; }
  };
})(window.Plexus = window.Plexus || {});
