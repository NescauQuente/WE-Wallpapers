/*
 * Neural Plexus — the network: nodes drifting in 3D, the connections between
 * the close ones, the triangles they close and the signals that travel along
 * them (each node that a signal reaches fires it on to its neighbors, so a
 * chain reaction spreads through the network like a nerve impulse).
 *
 * Space: x right, y down, z away from the viewer, in screen pixels at the
 * focal plane (z = 0), with x = y = 0 at the center of the screen. A node at
 * depth z is seen scaled by F / (F + z).
 *
 * Everything lives in typed arrays allocated on layout: nothing is allocated
 * per frame (the connection, triangle and signal buffers only ever grow).
 */
(function (S) {
  'use strict';

  var TAU = Math.PI * 2;

  // ---------------------------------------------------------------------------
  // Nodes (structure of arrays)
  // ---------------------------------------------------------------------------
  var N = 0;
  var X, Y, Z;          // position
  var VX, VY, VZ;       // drift (px/s at speed 1)
  var TX, TY, TZ;       // the drift the node is slowly turning toward
  var IX, IY, IZ;       // velocity from forces (cursor, shockwaves…), fades
  var PX, PY, PZ;       // velocity still to come (nudge): it flows into IX, IY,
                        // IZ over a fraction of a second, so a push never jerks
  var SX, SY, SS;       // on screen: position and scale
  var PSX, PSY;         // on screen the frame before (hyperspeed streaks)
  var D01;              // 0 = nearest, 1 = farthest
  var VIS;              // 0–1: fades in and out at the ends of the depth range
  var FLASH;            // 0–1: lit by a signal
  var HEAT;             // 0–1: white-hot (sparks)
  var RING;             // 0–1: the ring of a firing, from start to end
  var REFR;             // seconds before the node can fire again
  var SEED;             // 0–1: per-node random (size, speed, twinkle)
  var LOCK;             // held: 1 = a formation, 2 = a formation with its own
                        // edges (the time), 3 = the particle clock (pclock.js)
  var DEG;              // connections this frame
  var SURGE;            // the last surge whose runners went through the node
  var FADE;             // 1 → 0 after a formation lets the node go (its new
                        // connections fade in meanwhile)
  var WAS;              // the LOCK it had before that
  var MARK;             // scratch (ghost)
  var JOIN;             // 0 → 1 as a held node arrives where its formation (or
                        // the clock) wants it: it shows and connects gradually

  var view = {
    W: 1, H: 1, F: 1, zNear: 0, zFar: 0, zr: 0, margin: 0, unit: 1,
    camX: 0, camY: 0,
    fly: 0    // 0–1: hyperspeed (the nodes come much closer before they wrap)
  };

  // Where the nodes wrap at the near end: in hyperspeed they fly on past the
  // near end until they are big, out-of-focus discs right by the viewer
  function nearEnd() {
    return view.zNear + (-0.72 * view.F - view.zNear) * view.fly;
  }

  function alloc(n) {
    X = new Float32Array(n); Y = new Float32Array(n); Z = new Float32Array(n);
    VX = new Float32Array(n); VY = new Float32Array(n); VZ = new Float32Array(n);
    TX = new Float32Array(n); TY = new Float32Array(n); TZ = new Float32Array(n);
    IX = new Float32Array(n); IY = new Float32Array(n); IZ = new Float32Array(n);
    SX = new Float32Array(n); SY = new Float32Array(n); SS = new Float32Array(n);
    PSX = new Float32Array(n); PSY = new Float32Array(n);
    D01 = new Float32Array(n); VIS = new Float32Array(n);
    FLASH = new Float32Array(n); HEAT = new Float32Array(n); RING = new Float32Array(n);
    REFR = new Float32Array(n); SEED = new Float32Array(n);
    LOCK = new Uint8Array(n); DEG = new Uint8Array(n);
    SURGE = new Int32Array(n);
    FADE = new Float32Array(n);
    WAS = new Uint8Array(n);
    MARK = new Int32Array(n);
    PX = new Float32Array(n); PY = new Float32Array(n); PZ = new Float32Array(n);
    JOIN = new Float32Array(n);
    nodeCell = new Int32Array(n);
    cellItems = new Int32Array(n);
    adjStart = new Int32Array(n + 1);
    adjFill = new Int32Array(n);
  }

  function scaleAt(z) { return view.F / (view.F + z); }

  // A random drift for node i: mostly sideways, a little in depth
  function pickDrift(i) {
    var sp = (10 + 16 * SEED[i]) * view.unit;
    var a = Math.random() * TAU, e = (Math.random() * 2 - 1) * 0.5;
    TX[i] = Math.cos(a) * sp;
    TY[i] = Math.sin(a) * sp;
    TZ[i] = view.zr > 1 ? e * sp : 0;
  }

  // Random depth with the density of a uniform volume (the far end is wider)
  function randomDepth() {
    if (view.zr < 1) return 0;
    var F = view.F, a = Math.pow(F + view.zNear, 3), b = Math.pow(F + view.zFar, 3);
    return Math.cbrt(a + Math.random() * (b - a)) - F;
  }

  function place(i, z) {
    var s = scaleAt(z);
    Z[i] = z;
    X[i] = (Math.random() * 2 - 1) * (view.W / 2 + view.margin) / s;
    Y[i] = (Math.random() * 2 - 1) * (view.H / 2 + view.margin) / s;
  }

  // W, H: screen (device px). depth: the "Depth (3D)" setting. unit: H / 1080.
  // L: connection distance (px), which sets how far off screen nodes live.
  function layout(count, W, H, depth, unit, L) {
    view.W = W;
    view.H = H;
    view.unit = unit;
    view.F = 1.25 * H;
    var dz = 0.75 * H * depth;
    view.zNear = -0.4 * dz;
    view.zFar = 0.6 * dz;
    view.zr = view.zFar - view.zNear;
    view.margin = 0.6 * L + 0.03 * H;
    N = count;
    alloc(N);
    for (var i = 0; i < N; i++) {
      SEED[i] = Math.random();
      place(i, randomDepth());
      pickDrift(i);
      VX[i] = TX[i];
      VY[i] = TY[i];
      VZ[i] = TZ[i];
      REFR[i] = Math.random() * 0.5;
    }
    sigN = 0;
    runners = 0;
    popN = 0;
    ghostN = 0;
    linkN = 0;
    triN = 0;
    project();
    for (i = 0; i < N; i++) {
      PSX[i] = SX[i];
      PSY[i] = SY[i];
    }
  }

  // ---------------------------------------------------------------------------
  // Motion
  // ---------------------------------------------------------------------------

  // speed: drift multiplier; fly: px/s the whole network moves toward the
  // viewer (hyperspeed); dt in seconds
  function move(dt, speed, fly) {
    var turn = 1 - Math.exp(-dt * 0.6), damp = Math.exp(-dt * 1.6), wander = dt * 0.12, flow = 1 - Math.exp(-dt * 3);
    var W2 = view.W / 2 + view.margin, H2 = view.H / 2 + view.margin;
    var zN = nearEnd(), zF = view.zFar, zr = view.zFar - zN, flat = view.zr < 1;
    for (var i = 0; i < N; i++) {
      if (LOCK[i]) continue;
      if (Math.random() < wander) pickDrift(i);
      VX[i] += (TX[i] - VX[i]) * turn;
      VY[i] += (TY[i] - VY[i]) * turn;
      VZ[i] += (TZ[i] - VZ[i]) * turn;
      // A push builds up, then fades: velocity rises and falls like a bell
      if (PX[i] !== 0 || PY[i] !== 0 || PZ[i] !== 0) {
        var qx = PX[i] * flow, qy = PY[i] * flow, qz = PZ[i] * flow;
        IX[i] += qx;
        IY[i] += qy;
        IZ[i] += qz;
        PX[i] -= qx;
        PY[i] -= qy;
        PZ[i] -= qz;
        if (PX[i] * PX[i] + PY[i] * PY[i] + PZ[i] * PZ[i] < 0.25) PX[i] = PY[i] = PZ[i] = 0;
      }
      X[i] += (VX[i] * speed + IX[i]) * dt;
      Y[i] += (VY[i] * speed + IY[i]) * dt;
      Z[i] += (VZ[i] * speed + IZ[i] - fly) * dt;
      IX[i] *= damp;
      IY[i] *= damp;
      IZ[i] *= damp;

      // Leaving the depth range (it fades out there): past the viewer, back
      // in far away anywhere (hyperspeed streams through); past the far end,
      // back in near at the same place on screen
      if (flat) {
        Z[i] *= Math.exp(-dt);
      } else if (FADE[i] > 0 && (Z[i] < zN || Z[i] > zF)) {
        // Just let go by a formation beyond the depth range: it glides back
        // in (no jump to the other end in front of everyone)
        var zc = Z[i] < zN ? zN + 0.05 * zr : zF - 0.05 * zr;
        Z[i] += (zc - Z[i]) * (1 - Math.exp(-dt * 1.5));
      } else if (Z[i] < zN) {
        Z[i] = zF - (zN - Z[i]);
        var sf = scaleAt(Z[i]);
        X[i] = (Math.random() * 2 - 1) * W2 / sf;
        Y[i] = (Math.random() * 2 - 1) * H2 / sf;
      } else if (Z[i] > zF) {
        var s0 = scaleAt(Z[i]);
        Z[i] = view.zNear + (Z[i] - zF);
        var k = s0 / scaleAt(Z[i]);
        X[i] *= k;
        Y[i] *= k;
      }
      // Leaving the screen sideways: in again on the other side
      var s = scaleAt(Z[i]), hx = W2 / s, hy = H2 / s;
      if (X[i] > hx) X[i] -= 2 * hx;
      else if (X[i] < -hx) X[i] += 2 * hx;
      if (Y[i] > hy) Y[i] -= 2 * hy;
      else if (Y[i] < -hy) Y[i] += 2 * hy;
    }
  }

  // Screen position, scale and visibility of every node
  function project() {
    var cx = view.W / 2, cy = view.H / 2, camX = view.camX, camY = view.camY;
    var zN = view.zNear, zr = view.zr, flat = zr < 1, im = 1 / view.margin;
    // Fades at both ends; in hyperspeed the near one moves closer and the far
    // one is longer (nodes appear gradually far away)
    var zLo = nearEnd(), nearW = 0.12 * zr + 0.5 * (zN - zLo) + 1, farW = 0.2 + 0.3 * view.fly;
    for (var i = 0; i < N; i++) {
      var z = Z[i], s = scaleAt(z);
      PSX[i] = SX[i];
      PSY[i] = SY[i];
      SX[i] = cx + (X[i] - camX) * s + camX;
      SY[i] = cy + (Y[i] - camY) * s + camY;
      SS[i] = s;
      var d = flat ? 0.5 + z / view.H : (z - zN) / zr;
      D01[i] = d < 0 ? 0 : d > 1 ? 1 : d;
      if (flat) {
        VIS[i] = 1;
      } else if (LOCK[i] && JOIN[i] >= 1) {
        // Formations are seen whole
        VIS[i] = 1;
      } else {
        // Fade in at the near end, out at the far end
        var a = (z - zLo) / nearW, b = (1 - d) / farW;
        a = a < 0 ? 0 : a > 1 ? 1 : a;
        b = b < 0 ? 0 : b > 1 ? 1 : b;
        VIS[i] = a * a * (3 - 2 * a) * b * b * (3 - 2 * b);
        // Off the screen, fading out toward where it wraps around (so its
        // connections never pop)
        var ex = (Math.abs(SX[i] - cx) - cx) * im, ey = (Math.abs(SY[i] - cy) - cy) * im, e = ex > ey ? ex : ey;
        if (e > 0.3) {
          e = (e - 0.3) / 0.6;
          VIS[i] *= e >= 1 ? 0 : 1 - e * e * (3 - 2 * e);
        }
        // Just let go by a formation: still seen whole, less and less; on its
        // way into one: more and more
        if (FADE[i] > 0) VIS[i] += (1 - VIS[i]) * FADE[i];
        if (LOCK[i]) VIS[i] += (1 - VIS[i]) * JOIN[i];
      }
    }
  }

  // Signals, flashes and rings fade (and the afterglow of formations)
  function fade(dt) {
    var fl = Math.exp(-dt * 2.6), ht = Math.exp(-dt * 3.2), rg = dt * 1.4, fd = dt / GHOST_LIFE;
    for (var i = 0; i < N; i++) {
      FLASH[i] *= fl;
      HEAT[i] *= ht;
      if (RING[i] > 0) RING[i] = Math.max(0, RING[i] - rg);
      if (REFR[i] > 0) REFR[i] -= dt;
      if (FADE[i] > 0) FADE[i] = Math.max(0, FADE[i] - fd);
    }
    for (var g = 0; g < ghostN; g++) {
      ghostT[g] += dt;
      if (ghostT[g] < GHOST_LIFE) continue;
      ghostN--;
      ghostA[g] = ghostA[ghostN];
      ghostB[g] = ghostB[ghostN];
      ghostS[g] = ghostS[ghostN];
      ghostT[g] = ghostT[ghostN];
      g--;
    }
  }

  // ---------------------------------------------------------------------------
  // Ghosts: when a formation (or the clock) lets nodes go, the lines it drew
  // stay a moment and fade out as the nodes drift apart, while their new
  // connections fade in (FADE), so it dissolves instead of snapping.
  // ---------------------------------------------------------------------------
  var GHOST_LIFE = 1.4, ghostN = 0, markStamp = 0;
  var ghostA = new Int32Array(512), ghostB = new Int32Array(512);
  var ghostS = new Float32Array(512), ghostT = new Float32Array(512);

  function growGhosts() {
    var n = ghostA.length * 2;
    var a = new Int32Array(n), b = new Int32Array(n), s = new Float32Array(n), t = new Float32Array(n);
    a.set(ghostA);
    b.set(ghostB);
    s.set(ghostS);
    t.set(ghostT);
    ghostA = a;
    ghostB = b;
    ghostS = s;
    ghostT = t;
  }

  // Link l lingers as a ghost
  function addGhost(l) {
    var a = linkA[l], b = linkB[l];
    if (ghostN >= ghostA.length) growGhosts();
    ghostA[ghostN] = a;
    ghostB[ghostN] = b;
    // As bright as it was drawn (scene.js: formation edges are brighter,
    // crowded ones fainter)
    var sd = LOCK[a] >= 2 && LOCK[b] >= 2 ? 0.95 : LOCK[a] && LOCK[b] ? 0.5 + 0.4 * linkS[l] : linkS[l];
    var dd = (DEG[a] + DEG[b]) * 0.5;
    ghostS[ghostN] = Math.pow(sd, 0.8) * (dd > 4.5 ? 4.5 / dd : 1);
    ghostT[ghostN] = 0;
    ghostN++;
  }

  // list[0 .. count-1]: nodes about to be let go (still locked)
  function ghost(list, count) {
    var stamp = ++markStamp, i;
    for (i = 0; i < count; i++) MARK[list[i]] = stamp;
    for (var l = 0; l < linkN; l++) {
      if (MARK[linkA[l]] === stamp && MARK[linkB[l]] === stamp) addGhost(l);
    }
    for (i = 0; i < count; i++) {
      var n = list[i];
      WAS[n] = LOCK[n];
      FADE[n] = 1;
    }
  }

  // ---------------------------------------------------------------------------
  // Forces, in screen space (x, y, radius in device px)
  // ---------------------------------------------------------------------------

  // The cursor: k > 0 draws the nodes around into a loose halo (closer in
  // than the halo they are pushed back out), k < 0 repels (px/s²). Near it
  // the nodes also keep their distance from each other, so they never pile up
  // while the cursor rests.
  var nearCursor = new Int32Array(160);
  function cursor(x, y, R, k, dt) {
    var R2 = R * R, ring = R * 0.28, nn = 0, i;
    for (i = 0; i < N; i++) {
      if (LOCK[i]) continue;
      var dx = x - SX[i], dy = y - SY[i], d2 = dx * dx + dy * dy;
      if (d2 > R2) continue;
      if (nn < nearCursor.length) nearCursor[nn++] = i;
      if (d2 < 1) continue;
      var d = Math.sqrt(d2), t = 1 - d / R, f;
      if (k > 0) {
        var g = (d - ring) / ring;
        f = k * t * (g > 1 ? 1 : g < -1.5 ? -1.5 : g);
      } else {
        f = k * t * t * 2;
      }
      f *= dt / (SS[i] * d);
      IX[i] += dx * f;
      IY[i] += dy * f;
    }
    var sep = R * 0.18, sep2 = sep * sep, push = Math.abs(k) * 2.2 * dt;
    for (var a = 0; a < nn; a++) {
      var p = nearCursor[a];
      for (var b = a + 1; b < nn; b++) {
        var q = nearCursor[b], ex = SX[q] - SX[p], ey = SY[q] - SY[p], e2 = ex * ex + ey * ey;
        if (e2 >= sep2) continue;
        if (e2 < 0.25) {
          // On top of each other: any direction
          ex = Math.random() - 0.5;
          ey = Math.random() - 0.5;
          e2 = ex * ex + ey * ey;
        }
        var e = Math.sqrt(e2), sp = push * (1 - e / sep) / e;
        IX[p] -= ex * sp / SS[p];
        IY[p] -= ey * sp / SS[p];
        IX[q] += ex * sp / SS[q];
        IY[q] += ey * sp / SS[q];
      }
    }
  }

  // Singularity: pull into a whirl around (x, y), toward the focal plane
  function vortex(x, y, R, pull, swirl, dt) {
    var R2 = R * R, core = 26 * view.unit;
    for (var i = 0; i < N; i++) {
      var dx = x - SX[i], dy = y - SY[i], d2 = dx * dx + dy * dy;
      if (d2 > R2) continue;
      var d = Math.sqrt(d2) + 0.001, t = 1 - d / R;
      var fr = pull * Math.sqrt(t);
      // A small core holds the nodes apart instead of a single point
      if (d < core) fr *= d / core - 0.7;
      if (LOCK[i]) {
        // Formations, the visualizer and the clock hold on, but the pull
        // tears their nodes off one by one, the nearest first (they grow back
        // afterwards: shapes.js, pclock.js)
        if (Math.random() > dt * 5 * t * t) continue;
        tear(i);
      }
      var ft = swirl * t, inv = dt / (SS[i] * d);
      // Drag inside the whirl: the nodes spiral in instead of orbiting forever
      var drag = 1 - Math.min(0.5, dt * 4.5 * t);
      IX[i] = (IX[i] + (dx * fr - dy * ft) * inv) * drag;
      IY[i] = (IY[i] + (dy * fr + dx * ft) * inv) * drag;
      IZ[i] -= Z[i] * 2.2 * t * dt;
    }
  }

  // Node i is torn out of its formation (or the clock): its lines linger and
  // fade, as when a formation lets go, and it joins the whirl from rest
  function tear(i) {
    for (var l = 0; l < linkN; l++) {
      if (linkA[l] === i || linkB[l] === i) addGhost(l);
    }
    WAS[i] = LOCK[i];
    FADE[i] = 1;
    LOCK[i] = 0;
    VX[i] = VY[i] = VZ[i] = 0;
    pickDrift(i);
  }

  // The singularity, while it eats (main.js sets it every frame; r = 0 when
  // there is none): what it ate doesn't grow back into it meanwhile
  var hole = { x: 0, y: 0, r: 0 };

  function setHole(x, y, r) {
    hole.x = x;
    hole.y = y;
    hole.r = r;
  }

  function screenX(x, z) { return view.W / 2 + (x - view.camX) * scaleAt(z) + view.camX; }
  function screenY(y, z) { return view.H / 2 + (y - view.camY) * scaleAt(z) + view.camY; }

  function holeHas(sx, sy) {
    var dx = sx - hole.x, dy = sy - hole.y;
    return hole.r > 0 && dx * dx + dy * dy < hole.r * hole.r * 1.2;
  }

  // Is world point (x, y, z) in the singularity's reach on screen?
  function inHole(x, y, z) { return holeHas(screenX(x, z), screenY(y, z)); }

  // The free node nearest on screen to world point (x, y, z), out of the
  // singularity's reach; -1 if none
  function freeNear(x, y, z) {
    var sx = screenX(x, z), sy = screenY(y, z), best = -1, bd = Infinity;
    for (var j = 0; j < N; j++) {
      if (LOCK[j] || VIS[j] < 0.15 || holeHas(SX[j], SY[j])) continue;
      var dx = SX[j] - sx, dy = SY[j] - sy, d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = j; }
    }
    return best;
  }

  // Burst outward from (x, y): power in px/s at the center
  function burst(x, y, R, power) {
    var R2 = R * R, count = 0;
    for (var i = 0; i < N; i++) {
      var dx = SX[i] - x, dy = SY[i] - y, d2 = dx * dx + dy * dy;
      if (d2 > R2) continue;
      var d = Math.sqrt(d2) + 1, t = 1 - d / R;
      var v = power * Math.sqrt(Math.max(0, t)) / SS[i];
      // Nodes at the very center get a random heading
      var ux = d > 3 ? dx / d : Math.cos(i), uy = d > 3 ? dy / d : Math.sin(i);
      PX[i] += ux * v;
      PY[i] += uy * v;
      PZ[i] += (Math.random() * 2 - 1) * v * 0.6;
      HEAT[i] = Math.max(HEAT[i], t);
      count++;
    }
    return count;
  }

  // A shockwave ring of radius r and width wd: pushes outward what it crosses
  // and lights the nodes it passes. With a surge, the nodes it passes within
  // `reach` of the center release overcharged runners.
  function shock(x, y, r, wd, amp, dt, surge, reach, charge) {
    var lo = r - wd * 2, hi = r + wd * 2, lo2 = lo > 0 ? lo * lo : 0, hi2 = hi * hi;
    for (var i = 0; i < N; i++) {
      var dx = SX[i] - x, dy = SY[i] - y, d2 = dx * dx + dy * dy;
      if (d2 < lo2 || d2 > hi2) continue;
      var d = Math.sqrt(d2) + 0.001, k = (d - r) / wd, g = Math.exp(-k * k);
      // The push goes through the bell too: the ring moves them, gently
      var f = amp * g * dt / (SS[i] * d);
      PX[i] += dx * f;
      PY[i] += dy * f;
      if (g > 0.6 && FLASH[i] < 0.5) FLASH[i] = 0.5 + 0.4 * g;
      if (surge && g > 0.5 && d < reach && VIS[i] > 0.3 && SURGE[i] !== surge) launch(i, surge, charge, x, y);
    }
  }

  // ---------------------------------------------------------------------------
  // Connections: a uniform grid of cells as wide as the connection distance,
  // so each node only checks the 27 cells around it
  // ---------------------------------------------------------------------------
  var nodeCell = null, cellItems = null, cellStart = new Int32Array(1), cellCap = 0;
  var linkA = new Int32Array(1024), linkB = new Int32Array(1024), linkS = new Float32Array(1024);
  var linkN = 0;
  var adjStart = null, adjFill = null, adjList = new Int32Array(2048);
  var triA = new Int32Array(1024), triB = new Int32Array(1024), triC = new Int32Array(1024);
  var triS = new Float32Array(1024), triN = 0;
  var TRI_MAX = 2400;
  // Node pairs drawn as given: slot 0 = a formation (the time), 1 = the
  // particle clock
  var edgeSets = [{ a: null, b: null, n: 0 }, { a: null, b: null, n: 0 }];

  function setEdges(slot, a, b, n) {
    var s = edgeSets[slot];
    if (a) {
      s.a = a;
      s.b = b;
      s.n = n;
    } else {
      s.n = 0;
    }
  }

  function growLinks() {
    var n = linkA.length * 2;
    var a = new Int32Array(n), b = new Int32Array(n), s = new Float32Array(n);
    a.set(linkA);
    b.set(linkB);
    s.set(linkS);
    linkA = a;
    linkB = b;
    linkS = s;
  }

  function growTris() {
    var n = triA.length * 2;
    var a = new Int32Array(n), b = new Int32Array(n), c = new Int32Array(n), s = new Float32Array(n);
    a.set(triA);
    b.set(triB);
    c.set(triC);
    s.set(triS);
    triA = a;
    triB = b;
    triC = c;
    triS = s;
  }

  // L: connection distance (px, 3D). maxDeg: most connections per node.
  // tris: also find the triangles.
  function connect(L, maxDeg, tris) {
    linkN = 0;
    triN = 0;
    lastL = L;
    if (!N) return;
    var i, j;
    // Grid bounds: the box the nodes live in (formations may stray out of it;
    // they land in the edge cells, which only costs a few extra checks)
    var sF = scaleAt(view.zFar);
    var x0 = -(view.W / 2 + view.margin) / sF, y0 = -(view.H / 2 + view.margin) / sF;
    var z0 = Math.min(view.zNear, -L);
    var gx = Math.max(1, Math.ceil(-2 * x0 / L)), gy = Math.max(1, Math.ceil(-2 * y0 / L));
    var gz = Math.max(1, Math.ceil((Math.max(view.zFar, L) - z0) / L));
    var cells = gx * gy * gz;
    if (cells > 250000) {
      // Very short distances on huge screens: coarser cells, same result
      var f = Math.cbrt(cells / 250000);
      gx = Math.max(1, Math.floor(gx / f));
      gy = Math.max(1, Math.floor(gy / f));
      gz = Math.max(1, Math.floor(gz / f));
      cells = gx * gy * gz;
    }
    var cwx = -2 * x0 / gx, cwy = -2 * y0 / gy, cwz = (Math.max(view.zFar, L) - z0) / gz;
    if (cells + 1 > cellCap) {
      cellCap = cells + 1;
      cellStart = new Int32Array(cellCap);
    } else {
      cellStart.fill(0, 0, cells + 1);
    }

    // Counting sort of the nodes by cell
    for (i = 0; i < N; i++) {
      var ci = Math.floor((X[i] - x0) / cwx), cj = Math.floor((Y[i] - y0) / cwy), ck = Math.floor((Z[i] - z0) / cwz);
      ci = ci < 0 ? 0 : ci >= gx ? gx - 1 : ci;
      cj = cj < 0 ? 0 : cj >= gy ? gy - 1 : cj;
      ck = ck < 0 ? 0 : ck >= gz ? gz - 1 : ck;
      var c = (ck * gy + cj) * gx + ci;
      nodeCell[i] = c;
      cellStart[c + 1]++;
      DEG[i] = 0;
    }
    for (i = 0; i < cells; i++) cellStart[i + 1] += cellStart[i];
    // The starts double as fill cursors, then shift back into place
    for (i = 0; i < N; i++) cellItems[cellStart[nodeCell[i]]++] = i;
    for (i = cells; i > 0; i--) cellStart[i] = cellStart[i - 1];
    cellStart[0] = 0;

    var L2 = L * L, gxy = gx * gy;
    for (i = 0; i < N; i++) {
      if (DEG[i] >= maxDeg || VIS[i] <= 0.001 || LOCK[i] >= 2) continue;
      var c0 = nodeCell[i], ck0 = (c0 / gxy) | 0, rem = c0 - ck0 * gxy, cj0 = (rem / gx) | 0, ci0 = rem - cj0 * gx;
      var xi = X[i], yi = Y[i], zi = Z[i];
      for (var dk = -1; dk <= 1; dk++) {
        var kk = ck0 + dk;
        if (kk < 0 || kk >= gz) continue;
        for (var dj = -1; dj <= 1; dj++) {
          var jj = cj0 + dj;
          if (jj < 0 || jj >= gy) continue;
          for (var di = -1; di <= 1; di++) {
            var ii = ci0 + di;
            if (ii < 0 || ii >= gx) continue;
            var cell = (kk * gy + jj) * gx + ii;
            for (var p = cellStart[cell], e = cellStart[cell + 1]; p < e; p++) {
              j = cellItems[p];
              // Formations only connect among themselves (their shape stays
              // clean), except on their way in: they keep touching the network
              // they pass through until they arrive
              if (j <= i || DEG[j] >= maxDeg || VIS[j] <= 0.001) continue;
              if (LOCK[j] !== LOCK[i] && !(LOCK[i] + LOCK[j] === 1 && (LOCK[i] ? JOIN[i] : JOIN[j]) < 0.97)) continue;
              var dx = X[j] - xi, dy = Y[j] - yi, dz = Z[j] - zi, d2 = dx * dx + dy * dy + dz * dz;
              if (d2 >= L2) continue;
              if (linkN >= linkA.length) growLinks();
              linkA[linkN] = i;
              linkB[linkN] = j;
              linkS[linkN] = 1 - Math.sqrt(d2) / L;
              linkN++;
              DEG[j]++;
              if (++DEG[i] >= maxDeg) { p = e; di = dj = dk = 2; }
            }
          }
        }
      }
    }

    // Edges given as they are (LOCK 2 and 3 nodes connect only through these)
    for (var es = 0; es < edgeSets.length; es++) {
      var set = edgeSets[es];
      for (var ed = 0; ed < set.n; ed++) {
        addEdge(set.a[ed], set.b[ed], L);
      }
    }

    // Neighbor lists (compressed: adjList[adjStart[i] .. adjStart[i + 1]])
    adjStart[0] = 0;
    for (i = 0; i < N; i++) adjStart[i + 1] = adjStart[i] + DEG[i];
    if (adjList.length < linkN * 2) adjList = new Int32Array(linkN * 4);
    for (i = 0; i < N; i++) adjFill[i] = adjStart[i];
    for (var l = 0; l < linkN; l++) {
      adjList[adjFill[linkA[l]]++] = linkB[l];
      adjList[adjFill[linkB[l]]++] = linkA[l];
    }

    if (tris) findTriangles();
  }

  function addEdge(ea, eb, L) {
    if (LOCK[ea] < 2 || LOCK[eb] < 2 || ea === eb) return;
    if (ea > eb) { var tmp = ea; ea = eb; eb = tmp; }
    var ex = X[eb] - X[ea], ey = Y[eb] - Y[ea], ez = Z[eb] - Z[ea];
    if (linkN >= linkA.length) growLinks();
    linkA[linkN] = ea;
    linkB[linkN] = eb;
    linkS[linkN] = Math.max(0.05, 1 - Math.sqrt(ex * ex + ey * ey + ez * ez) / L);
    linkN++;
    if (DEG[ea] < 255) DEG[ea]++;
    if (DEG[eb] < 255) DEG[eb]++;
  }

  // Triangles a < b < c, each found once from its edge (a, b)
  function findTriangles() {
    for (var l = 0; l < linkN && triN < TRI_MAX; l++) {
      var a = linkA[l], b = linkB[l];   // a < b
      for (var p = adjStart[a], e = adjStart[a + 1]; p < e; p++) {
        var c = adjList[p];
        if (c <= b) continue;
        for (var q = adjStart[b], f = adjStart[b + 1]; q < f; q++) {
          if (adjList[q] !== c) continue;
          if (triN >= triA.length) growTris();
          triA[triN] = a;
          triB[triN] = b;
          triC[triN] = c;
          triS[triN] = Math.min(linkS[l], linkStrength(a, c), linkStrength(b, c));
          triN++;
          break;
        }
      }
    }
  }

  // Recomputed from the positions (cheaper than looking the link up)
  var lastL = 1;
  function linkStrength(a, b) {
    var dx = X[a] - X[b], dy = Y[a] - Y[b], dz = Z[a] - Z[b];
    return Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy + dz * dz) / lastL);
  }

  // ---------------------------------------------------------------------------
  // Signals
  //
  // Normal signals (kind 0) carry an energy that fades hop by hop: each node
  // they reach fires them on to all its neighbors (a chain reaction).
  //
  // Overcharged signals (a surge: a click, a strong bass hit) are runners
  // (kind 1): faster and brighter, each keeps going node after node, ahead
  // along its heading, for `charge` hops. They never visit a node twice in the
  // same surge. At a dead end a runner can't stop: it jumps through empty
  // space to the closest node ahead (kind 2, an arc with no connection) and
  // runs on from there; with nothing close enough it bursts (a pop).
  // ---------------------------------------------------------------------------
  var SIG_MAX = 1600, RUNNERS_MAX = 160;
  var sigFrom = new Int32Array(SIG_MAX), sigTo = new Int32Array(SIG_MAX);
  var sigT = new Float32Array(SIG_MAX), sigRate = new Float32Array(SIG_MAX), sigE = new Float32Array(SIG_MAX);
  var sigKind = new Uint8Array(SIG_MAX), sigCharge = new Uint8Array(SIG_MAX), sigSurge = new Int32Array(SIG_MAX);
  var sigN = 0, runners = 0, surgeId = 0;
  var sig = {
    speed: 230, decay: 0.75, refr: 1.8, rings: true, minE: 0.1,
    jump: 300,      // how far (px, 3D) a runner at a dead end can jump
    branch: 0.3,    // chance a runner forks at a node
    popPower: 1     // overcharge strength: how hard a lost runner bursts
  };

  // Pops: runners that found nowhere to go
  var POP_MAX = 24, POP_LIFE = 0.75;
  var popX = new Float32Array(POP_MAX), popY = new Float32Array(POP_MAX), popT = new Float32Array(POP_MAX);
  var popS = new Float32Array(POP_MAX), popSeed = new Float32Array(POP_MAX), popN = 0;

  function send(from, to, e, kind, charge, surge) {
    if (sigN >= SIG_MAX || (kind && runners >= RUNNERS_MAX)) return;
    var dx = X[to] - X[from], dy = Y[to] - Y[from], dz = Z[to] - Z[from];
    var d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1;
    sigFrom[sigN] = from;
    sigTo[sigN] = to;
    sigT[sigN] = 0;
    sigRate[sigN] = sig.speed * (kind ? 1.5 : 1) * (0.85 + Math.random() * 0.3) / d;
    sigE[sigN] = e;
    sigKind[sigN] = kind || 0;
    sigCharge[sigN] = charge || 0;
    sigSurge[sigN] = surge || 0;
    if (kind) runners++;
    sigN++;
  }

  // A new surge id (marks the nodes its runners already went through)
  function newSurge() { return ++surgeId; }

  // Node i releases a surge: runners leave along every connection that points
  // away from (ox, oy) (all of them when the node is right there)
  function launch(i, id, charge, ox, oy) {
    if (i < 0 || i >= N || SURGE[i] === id) return;
    SURGE[i] = id;
    FLASH[i] = 1;
    HEAT[i] = 1;
    if (sig.rings) RING[i] = 1;
    var dx = SX[i] - ox, dy = SY[i] - oy, dl = Math.sqrt(dx * dx + dy * dy), sent = 0;
    for (var p = adjStart[i], q = adjStart[i + 1]; p < q; p++) {
      var k = adjList[p];
      if (SURGE[k] === id) continue;
      if (dl > 4 && (SX[k] - SX[i]) * dx + (SY[k] - SY[i]) * dy < 0) continue;
      SURGE[k] = id;
      send(i, k, 1, 1, charge, id);
      sent++;
    }
    if (!sent) onward(i, dl > 4 ? dx / dl : 0, dl > 4 ? dy / dl : 0, charge, id);
  }

  // A runner reached node j coming from `from`
  function arrive(j, from, charge, id) {
    FLASH[j] = 1;
    if (HEAT[j] < 0.8) HEAT[j] = 0.8;
    if (charge <= 0) {
      // Spent: one last flare
      if (sig.rings && RING[j] <= 0) RING[j] = 1;
      return;
    }
    var dx = SX[j] - SX[from], dy = SY[j] - SY[from], dl = Math.sqrt(dx * dx + dy * dy) || 1;
    onward(j, dx / dl, dy / dl, charge, id);
  }

  // From node j, heading (hx, hy) on screen: on to the connection most ahead,
  // sometimes forking; at a dead end, a jump or a pop
  function onward(j, hx, hy, charge, id) {
    var best = -1, bestS = -1e9, second = -1, secondS = -1e9;
    for (var p = adjStart[j], q = adjStart[j + 1]; p < q; p++) {
      var k = adjList[p];
      if (SURGE[k] === id) continue;
      var ex = SX[k] - SX[j], ey = SY[k] - SY[j], el = Math.sqrt(ex * ex + ey * ey) || 1;
      var sc = (ex * hx + ey * hy) / el + Math.random() * 0.8;
      if (sc > bestS) { second = best; secondS = bestS; best = k; bestS = sc; }
      else if (sc > secondS) { second = k; secondS = sc; }
    }
    if (best >= 0) {
      SURGE[best] = id;
      send(j, best, 1, 1, charge - 1, id);
      if (second >= 0 && charge > 2 && Math.random() < sig.branch) {
        SURGE[second] = id;
        send(j, second, 1, 1, charge - 1, id);
      }
      return;
    }
    // Dead end: the closest node in reach, not behind
    var R2 = sig.jump * sig.jump, target = -1;
    for (var i = 0; i < N; i++) {
      if (i === j || SURGE[i] === id || VIS[i] < 0.25) continue;
      var wx = X[i] - X[j], wy = Y[i] - Y[j], wz = Z[i] - Z[j], d2 = wx * wx + wy * wy + wz * wz;
      if (d2 >= R2) continue;
      var sx = SX[i] - SX[j], sy = SY[i] - SY[j], sl = Math.sqrt(sx * sx + sy * sy) || 1;
      if ((sx * hx + sy * hy) / sl < -0.1) continue;
      R2 = d2;
      target = i;
    }
    if (target >= 0) {
      SURGE[target] = id;
      send(j, target, 1, 2, charge - 1, id);
    } else {
      pop(j);
    }
  }

  // A runner with nowhere to go bursts: a flash, sparks and a little push
  function pop(j) {
    var pw = sig.popPower, size = SS[j] * (0.6 + 0.4 * pw);
    if (popN < POP_MAX) {
      popX[popN] = SX[j];
      popY[popN] = SY[j];
      popT[popN] = 0;
      popS[popN] = size;
      popSeed[popN] = Math.random();
      popN++;
    }
    FLASH[j] = 1;
    HEAT[j] = 1;
    burst(SX[j], SY[j], 90 * view.unit * size, 150 * view.unit * pw);
  }

  function stepPops(dt) {
    for (var i = 0; i < popN; i++) {
      popT[i] += dt;
      if (popT[i] < POP_LIFE) continue;
      popN--;
      popX[i] = popX[popN];
      popY[i] = popY[popN];
      popT[i] = popT[popN];
      popS[i] = popS[popN];
      popSeed[i] = popSeed[popN];
      i--;
    }
  }

  // Node i fires with energy e (0–1+), coming from node `from` (or -1): it
  // lights up and, unless it fired a moment ago, passes the signal on to its
  // neighbors with a little less energy
  function fire(i, e, from) {
    if (i < 0 || i >= N) return;
    var f = 0.4 + e * 0.6;
    if (FLASH[i] < f) FLASH[i] = f > 1 ? 1 : f;
    if (REFR[i] > 0) return;
    REFR[i] = sig.refr;
    if (sig.rings && e >= 0.3 && RING[i] <= 0) RING[i] = 1;
    if (e < sig.minE) return;
    var ne = e * sig.decay;
    for (var p = adjStart[i], q = adjStart[i + 1]; p < q; p++) {
      var k = adjList[p];
      if (k !== from) send(i, k, ne);
    }
  }

  function stepSignals(dt, L) {
    var far2 = L * L * 2.6, jump2 = sig.jump * sig.jump * 2;
    for (var s = 0; s < sigN; s++) {
      var a = sigFrom[s], b = sigTo[s], kind = sigKind[s];
      var dx = X[b] - X[a], dy = Y[b] - Y[a], dz = Z[b] - Z[a];
      var gone = dx * dx + dy * dy + dz * dz > (kind === 2 ? jump2 : far2);
      sigT[s] += sigRate[s] * dt;
      if (sigT[s] >= 1 || gone) {
        var e = sigE[s], charge = sigCharge[s], surge = sigSurge[s];
        // Remove (swap with the last) before passing it on, which may add more
        sigN--;
        sigFrom[s] = sigFrom[sigN];
        sigTo[s] = sigTo[sigN];
        sigT[s] = sigT[sigN];
        sigRate[s] = sigRate[sigN];
        sigE[s] = sigE[sigN];
        sigKind[s] = sigKind[sigN];
        sigCharge[s] = sigCharge[sigN];
        sigSurge[s] = sigSurge[sigN];
        s--;
        if (kind) runners--;
        if (gone) continue;
        if (kind) arrive(b, a, charge, surge);
        else fire(b, e, a);
      }
    }
    stepPops(dt);
  }

  // The visible node closest to (x, y) on screen, or -1
  function nearest(x, y, maxD) {
    var best = -1, bd = maxD !== undefined ? maxD * maxD : Infinity;
    for (var i = 0; i < N; i++) {
      if (VIS[i] < 0.3) continue;
      var dx = SX[i] - x, dy = SY[i] - y, d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = i; }
    }
    return best;
  }

  // A random node that can be seen, or -1
  function randomVisible() {
    for (var t = 0; t < 12; t++) {
      var i = (Math.random() * N) | 0;
      if (VIS[i] > 0.5 && SX[i] > 0 && SX[i] < view.W && SY[i] > 0 && SY[i] < view.H) return i;
    }
    return -1;
  }

  function clearSignals() {
    sigN = 0;
    runners = 0;
    popN = 0;
    ghostN = 0;
    for (var i = 0; i < N; i++) {
      FLASH[i] = HEAT[i] = RING[i] = 0;
    }
  }

  var views = { nodes: {}, links: {}, tris: {}, signals: {}, ghosts: {}, pops: {}, adj: {} };

  S.net = {
    view: view,
    sig: sig,
    layout: layout,
    move: move,
    project: project,
    fade: fade,
    cursor: cursor,
    vortex: vortex,
    burst: burst,
    shock: shock,
    connect: connect,
    setEdges: setEdges,
    edgeCount: function (slot) { return edgeSets[slot || 0].n; },
    fire: fire,
    newSurge: newSurge,
    launch: launch,
    stepSignals: stepSignals,
    POP_LIFE: POP_LIFE,
    nearest: nearest,
    randomVisible: randomVisible,
    clearSignals: clearSignals,
    scaleAt: scaleAt,
    pickDrift: pickDrift,
    // A push on node i (px/s), delivered smoothly
    nudge: function (i, vx, vy, vz) {
      PX[i] += vx;
      PY[i] += vy;
      PZ[i] += vz;
    },
    // Node i is taken by a formation or the clock: no push left over
    hold: function (i) {
      PX[i] = PY[i] = PZ[i] = IX[i] = IY[i] = IZ[i] = 0;
      JOIN[i] = 0;
    },
    ghost: ghost,
    GHOST_LIFE: GHOST_LIFE,
    setHole: setHole,
    inHole: inHole,
    freeNear: freeNear,
    // Live arrays (layout and growth replace them: read them through these;
    // the objects are reused, refreshed on each call)
    n: function () { return N; },
    a: function () {
      var o = views.nodes;
      if (o.X !== X) {
        o.X = X; o.Y = Y; o.Z = Z; o.IX = IX; o.IY = IY; o.IZ = IZ; o.VX = VX; o.VY = VY; o.VZ = VZ;
        o.SX = SX; o.SY = SY; o.SS = SS; o.PSX = PSX; o.PSY = PSY; o.D01 = D01; o.VIS = VIS;
        o.FLASH = FLASH; o.HEAT = HEAT; o.RING = RING; o.REFR = REFR; o.SEED = SEED; o.LOCK = LOCK; o.DEG = DEG;
        o.SURGE = SURGE; o.FADE = FADE; o.WAS = WAS; o.TX = TX; o.TY = TY; o.TZ = TZ;
        o.JOIN = JOIN; o.PX = PX; o.PY = PY; o.PZ = PZ;
      }
      return o;
    },
    links: function () {
      var o = views.links;
      o.n = linkN; o.a = linkA; o.b = linkB; o.s = linkS;
      return o;
    },
    tris: function () {
      var o = views.tris;
      o.n = triN; o.a = triA; o.b = triB; o.c = triC; o.s = triS;
      return o;
    },
    signals: function () {
      var o = views.signals;
      o.n = sigN; o.from = sigFrom; o.to = sigTo; o.t = sigT; o.e = sigE; o.kind = sigKind;
      o.runners = runners;
      return o;
    },
    ghosts: function () {
      var o = views.ghosts;
      o.n = ghostN; o.a = ghostA; o.b = ghostB; o.s = ghostS; o.t = ghostT;
      return o;
    },
    pops: function () {
      var o = views.pops;
      o.n = popN; o.x = popX; o.y = popY; o.t = popT; o.s = popS; o.seed = popSeed;
      return o;
    },
    adj: function () {
      var o = views.adj;
      o.start = adjStart; o.list = adjList;
      return o;
    }
  };
})(window.Plexus = window.Plexus || {});
