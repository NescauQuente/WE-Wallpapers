/*
 * Starry Orbit — seeded procedural noise (used by the CPU nebula).
 * 2D simplex based on Stefan Gustavson's public-domain algorithm.
 */
(function (S) {
  'use strict';

  // Small deterministic pseudo-random generator
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var F2 = 0.5 * (Math.sqrt(3) - 1);
  var G2 = (3 - Math.sqrt(3)) / 6;
  var GX = new Float32Array([1, -1, 1, -1, 1, -1, 0, 0]);
  var GY = new Float32Array([1, 1, -1, -1, 0, 0, 1, -1]);

  // Returns a simplex(x, y) function → roughly [-1, 1]
  function createSimplex(rand) {
    var p = new Uint8Array(256), i;
    for (i = 0; i < 256; i++) p[i] = i;
    for (i = 255; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1)), t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    var perm = new Uint8Array(512), mod8 = new Uint8Array(512);
    for (i = 0; i < 512; i++) {
      perm[i] = p[i & 255];
      mod8[i] = perm[i] % 8;
    }

    return function (xin, yin) {
      var s = (xin + yin) * F2;
      var i = Math.floor(xin + s), j = Math.floor(yin + s);
      var t = (i + j) * G2;
      var x0 = xin - (i - t), y0 = yin - (j - t);
      var i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
      var x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
      var x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
      var ii = i & 255, jj = j & 255;
      var n = 0, g, tt;

      tt = 0.5 - x0 * x0 - y0 * y0;
      if (tt > 0) { g = mod8[ii + perm[jj]]; tt *= tt; n += tt * tt * (GX[g] * x0 + GY[g] * y0); }
      tt = 0.5 - x1 * x1 - y1 * y1;
      if (tt > 0) { g = mod8[ii + i1 + perm[jj + j1]]; tt *= tt; n += tt * tt * (GX[g] * x1 + GY[g] * y1); }
      tt = 0.5 - x2 * x2 - y2 * y2;
      if (tt > 0) { g = mod8[ii + 1 + perm[jj + 1]]; tt *= tt; n += tt * tt * (GX[g] * x2 + GY[g] * y2); }

      return 70 * n;
    };
  }

  // Fractal noise (several octaves summed)
  function fbm(noise, x, y, octaves) {
    var sum = 0, amp = 1, freq = 1, norm = 0;
    for (var o = 0; o < octaves; o++) {
      sum += amp * noise(x * freq, y * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return sum / norm;
  }

  S.noise = { mulberry32: mulberry32, createSimplex: createSimplex, fbm: fbm };
})(window.Starry = window.Starry || {});
