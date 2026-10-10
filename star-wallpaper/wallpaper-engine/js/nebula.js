/*
 * Starry Orbit — procedural nebula (CPU fallback when WebGL2 is unavailable).
 *
 * 1. Builds a density field (domain-warped fractal noise, filaments and
 *    dust lanes) in time slices, without stalling the animation.
 * 2. Colors the field with two hues; recoloring is cheap, so changing the
 *    color does not require regenerating everything.
 */
(function (S) {
  'use strict';

  var noise = S.noise, util = S.util;
  var SIZE = 512;

  var ready = null;     // last finished field: { seed, dens, mix }
  var pending = null;   // generation in progress: { seed, cancelled }
  var tex = null, texCtx = null, img = null;

  // Returns the field for the requested seed, or null while it is being generated
  function request(seed) {
    if (ready && ready.seed === seed) return ready;
    if (!pending || pending.seed !== seed) generate(seed);
    return null;
  }

  function generate(seed) {
    if (pending) pending.cancelled = true;
    var job = pending = { seed: seed, cancelled: false };

    var rand = noise.mulberry32(seed * 7919 + 17);
    var n1 = noise.createSimplex(rand), n2 = noise.createSimplex(rand), n3 = noise.createSimplex(rand);
    var fbm = noise.fbm, ss = util.smoothstep;
    var dens = new Float32Array(SIZE * SIZE), mix = new Float32Array(SIZE * SIZE);
    var half = SIZE / 2, freq = 2.4 / SIZE, y = 0;

    function row(y) {
      for (var x = 0; x < SIZE; x++) {
        var px = x * freq, py = y * freq;

        // Light domain warping: distort space with another noise → gas shapes
        var qx = fbm(n1, px, py, 3), qy = fbm(n1, px + 5.2, py + 1.3, 3);
        var v = fbm(n2, px + 1.1 * qx, py + 1.1 * qy, 6);
        var d = ss(-0.25, 0.65, v);
        d = Math.pow(d, 1.6);

        // Subtle filaments ("ridged" noise), only inside the clouds
        var ridge = 1 - Math.abs(fbm(n3, px * 1.3 + qx, py * 1.3 + qy, 4));
        var fil = ridge * ridge * ridge;
        fil *= fil;

        // Dark dust lanes
        var dust = ss(0.05, 0.5, fbm(n3, px * 1.7 + 17.1, py * 1.7 + 9.4, 4));
        d = d * (1 - 0.55 * dust) + fil * d * 0.6;

        // Concentrate toward the center and fade the texture edges
        var dx = (x - half) / half, dy = (y - half) / half, r = Math.sqrt(dx * dx + dy * dy);
        d *= (1 - ss(0.62, 1, r)) * (0.6 + 0.4 * Math.max(0, 1 - r));

        var i = y * SIZE + x;
        dens[i] = d < 0 ? 0 : d > 1 ? 1 : d;
        mix[i] = ss(-0.35, 0.35, fbm(n2, px * 0.7 + 11.3, py * 0.7 + 4.7, 3));
      }
    }

    (function slice() {
      if (job.cancelled) return;
      var t0 = performance.now();
      while (y < SIZE && performance.now() - t0 < 8) row(y++);
      if (y < SIZE) {
        setTimeout(slice, 0);
      } else {
        ready = { seed: seed, dens: dens, mix: mix };
        if (pending === job) pending = null;
      }
    })();
  }

  // Paints the field with two hues (degrees) and saturation (%) → reused canvas
  function colorize(field, hueA, hueB, sat) {
    if (!tex) {
      tex = document.createElement('canvas');
      tex.width = tex.height = SIZE;
      texCtx = tex.getContext('2d');
      img = texCtx.createImageData(SIZE, SIZE);
    }
    var A = util.hslToRgb(hueA, sat / 100, 0.5);
    var B = util.hslToRgb(hueB, sat / 100, 0.45);
    var data = img.data, dens = field.dens, mix = field.mix;

    for (var i = 0, j = 0; i < dens.length; i++, j += 4) {
      var d = dens[i], m = mix[i];
      var bright = 0.5 + 0.5 * d;
      var highlight = d * d * d * 60;
      data[j] = (A[0] + (B[0] - A[0]) * m) * bright + highlight;
      data[j + 1] = (A[1] + (B[1] - A[1]) * m) * bright + highlight;
      data[j + 2] = (A[2] + (B[2] - A[2]) * m) * bright + highlight;
      data[j + 3] = d * 320;
    }
    texCtx.putImageData(img, 0, 0);
    return tex;
  }

  S.nebula = { request: request, colorize: colorize, SIZE: SIZE };
})(window.Starry = window.Starry || {});
