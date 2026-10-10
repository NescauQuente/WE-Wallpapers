/*
 * Neural Plexus — Canvas 2D renderer, used when WebGL2 is unavailable.
 * Draws the same scene more simply: no bloom, no depth-of-field discs, no
 * shockwave lens. Lines are batched by opacity (a handful of strokes per
 * frame) and nodes are pre-rendered glow sprites.
 */
(function (S) {
  'use strict';

  var scene = S.scene;
  var ctx = null, canvas = null;
  var sprites = {}, spriteKey = '';
  var BUCKETS = 8;

  function init(c) {
    canvas = c;
    ctx = canvas.getContext('2d', { alpha: false });
    return !!ctx;
  }

  function css(rgb, a) {
    return 'rgba(' + Math.round(rgb[0] * 255) + ', ' + Math.round(rgb[1] * 255) + ', ' + Math.round(rgb[2] * 255) + ', ' + a + ')';
  }

  function sprite(rgb) {
    var s = 64, c = document.createElement('canvas');
    c.width = c.height = s;
    var x = c.getContext('2d'), g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255, 255, 255, 1)');
    g.addColorStop(0.12, css(rgb, 1));
    g.addColorStop(0.35, css(rgb, 0.25));
    g.addColorStop(1, css(rgb, 0));
    x.fillStyle = g;
    x.fillRect(0, 0, s, s);
    return c;
  }

  function pick(f, mix, heat) {
    if (heat > 0.5) return f.colP;
    return mix < 0.5 || f.rainbow ? f.colA : f.colB;
  }

  // Same input as Plexus.gl.frame
  function frame(f) {
    if (canvas.width !== f.W || canvas.height !== f.H) {
      canvas.width = f.W;
      canvas.height = f.H;
    }
    var key = f.colA.join() + '|' + f.colB.join() + '|' + f.colP.join();
    if (key !== spriteKey) {
      spriteKey = key;
      sprites = { A: sprite(f.colA), B: sprite(f.colB), P: sprite(f.colP) };
    }
    var c = ctx, sc = f.scene, W = f.W, H = f.H, i, b;

    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.fillStyle = css(f.bg, 1);
    c.fillRect(0, 0, W, H);
    c.globalCompositeOperation = 'lighter';
    for (i = 0; i < 3; i++) {
      var hx = f.haze[i * 4], hy = f.haze[i * 4 + 1], hr = f.haze[i * 4 + 2], ha = f.haze[i * 4 + 3];
      if (ha <= 0) continue;
      var col = [f.hazeC[i * 3], f.hazeC[i * 3 + 1], f.hazeC[i * 3 + 2]];
      var g = c.createRadialGradient(hx, hy, 0, hx, hy, hr * 1.6);
      g.addColorStop(0, css(col, Math.min(1, ha)));
      g.addColorStop(1, css(col, 0));
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
    }

    // Triangles, by opacity
    var T = sc.tris;
    for (b = 1; b <= 4; b++) {
      var lo = (b - 1) / 4 * 0.12, hi = b / 4 * 0.12, any = false;
      c.beginPath();
      for (i = 0; i < sc.triN; i++) {
        var o = i * scene.TRI, a = (T[o + 2] + T[o + 6] + T[o + 10]) / 3;
        if (a <= lo || (a > hi && b < 4)) continue;
        c.moveTo(T[o], T[o + 1]);
        c.lineTo(T[o + 4], T[o + 5]);
        c.lineTo(T[o + 8], T[o + 9]);
        c.closePath();
        any = true;
      }
      if (any) {
        c.fillStyle = css(f.colA, (lo + hi) / 2);
        c.fill();
      }
    }

    // Lines, by opacity (heated ones in the signal color)
    var L = sc.lines;
    c.lineCap = 'round';
    for (var hot = 0; hot < 2; hot++) {
      for (b = 1; b <= BUCKETS; b++) {
        var any2 = false;
        c.beginPath();
        for (i = 0; i < sc.lineN; i++) {
          var p = i * scene.LINE, al = Math.max(L[p + 4], L[p + 5]);
          if ((L[p + 9] > 0.5 ? 1 : 0) !== hot) continue;
          var bk = Math.min(BUCKETS, Math.ceil(al * BUCKETS));
          if (bk !== b) continue;
          c.moveTo(L[p], L[p + 1]);
          c.lineTo(L[p + 2], L[p + 3]);
          any2 = true;
        }
        if (any2) {
          c.strokeStyle = css(hot ? f.colP : f.colA, b / BUCKETS);
          c.lineWidth = 1;
          c.stroke();
        }
      }
    }

    // Nodes and rings
    var Pt = sc.points;
    for (i = 0; i < sc.pointN; i++) {
      var q = i * scene.POINT, x = Pt[q], y = Pt[q + 1], size = Pt[q + 2], alpha = Pt[q + 3];
      if (alpha <= 0.003) continue;
      if (Pt[q + 6] > 0.5) {
        c.globalAlpha = Math.min(1, alpha);
        c.strokeStyle = css(pick(f, Pt[q + 4], Pt[q + 5]), 1);
        c.lineWidth = Math.max(1, Pt[q + 7]);
        c.beginPath();
        c.arc(x, y, size / 2, 0, Math.PI * 2);
        c.stroke();
      } else {
        var s = size * (3 + 2 * f.glow) * (1 + Pt[q + 7] * 2);
        var mix = Pt[q + 4], heat = Pt[q + 5];
        c.globalAlpha = Math.min(1, alpha / (1 + Pt[q + 7] * 3));
        c.drawImage(heat > 0.5 ? sprites.P : mix < 0.5 || f.rainbow ? sprites.A : sprites.B, x - s / 2, y - s / 2, s, s);
      }
    }
    c.globalAlpha = 1;
    if (f.flash > 0.004) {
      c.fillStyle = 'rgba(255, 255, 255, ' + Math.min(1, f.flash) + ')';
      c.fillRect(0, 0, W, H);
    }
    c.globalCompositeOperation = 'source-over';
  }

  S.render2d = { init: init, frame: frame };
})(window.Plexus = window.Plexus || {});
