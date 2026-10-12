/*
 * Lyric Stage — shared utilities (math, colors and local file URLs).
 * Colors use the Wallpaper Engine format: "r g b" with values from 0 to 1.
 */
(function (S) {
  'use strict';

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function lerp(a, b, t) { return a + (b - a) * t; }

  // Random integer between min and max (inclusive)
  function random(min, max) {
    if (arguments.length < 2) { max = min; min = 0; }
    if (min > max) { var t = max; max = min; min = t; }
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function smoothstep(a, b, x) {
    var t = (x - a) / (b - a);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return t * t * (3 - 2 * t);
  }

  // Cubic ease in and out, t from 0 to 1 (transitions)
  function ease(t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function parseColor(str) {
    var p = String(str || '').trim().split(/\s+/);
    return [0, 1, 2].map(function (i) { return clamp(parseFloat(p[i]) || 0, 0, 1); });
  }

  // [r, g, b] (0–1) → [hue in degrees, saturation %, lightness %]
  function rgbToHsl(rgb) {
    var r = rgb[0], g = rgb[1], b = rgb[2];
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var l = (max + min) / 2, h = 0, s = 0;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
  }

  // Hue in degrees, s and l from 0 to 1 → [r, g, b] from 0 to 255
  function hslToRgb(h, s, l) {
    h = (((h % 360) + 360) % 360) / 60;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs((h % 2) - 1));
    var m = l - c / 2, r = 0, g = 0, b = 0;
    if (h < 1) { r = c; g = x; }
    else if (h < 2) { r = x; g = c; }
    else if (h < 3) { g = c; b = x; }
    else if (h < 4) { g = x; b = c; }
    else if (h < 5) { r = x; b = c; }
    else { r = c; b = x; }
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }

  function rgbCss(str) {
    return 'rgb(' + parseColor(str).map(function (v) { return Math.round(v * 255); }).join(', ') + ')';
  }

  // [r, g, b] (0–1) and an optional alpha → a CSS color
  function arrCss(rgb, a) {
    var r = Math.round(clamp(rgb[0], 0, 1) * 255);
    var g = Math.round(clamp(rgb[1], 0, 1) * 255);
    var b = Math.round(clamp(rgb[2], 0, 1) * 255);
    return a === undefined
      ? 'rgb(' + r + ', ' + g + ', ' + b + ')'
      : 'rgba(' + r + ', ' + g + ', ' + b + ', ' + clamp(a, 0, 1) + ')';
  }

  // Relative luminance (WCAG) of an [r, g, b] color from 0 to 1
  function luminance(rgb) {
    var lin = rgb.map(function (v) { return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  }

  function weToHex(str) {
    return '#' + parseColor(str).map(function (v) {
      return ('0' + Math.round(v * 255).toString(16)).slice(-2);
    }).join('');
  }

  function hexToWe(hex) {
    return [1, 3, 5].map(function (i) {
      return (parseInt(hex.substr(i, 2), 16) / 255).toFixed(3);
    }).join(' ');
  }

  // A local path from a Wallpaper Engine 'file' property → a file:/// URL.
  // Wallpaper Engine may hand the path over already percent-encoded
  // ("C%3A/Users/My%20Pictures/a.jpg") or plain ("C:\Users\My Pictures\a.jpg"):
  // an encoded path is decoded once, then every path is encoded once, so both
  // end up the same. A path with backslashes is plain (encoding turns them into
  // %5C), so a '%' in its file names stays as it is. '#' and '?' would cut the
  // path short and quotes or parentheses would end a CSS url(…), so they are
  // escaped too: the result is safe in url("…") and url('…'). Network shares
  // (\\server\share\…) become file://server/share/…. A value that is already a
  // URL is kept; '' (or a path that cannot be encoded) gives ''.
  function fileUrl(path) {
    path = String(path || '').trim();
    if (!path) return '';
    if (/^(file|https?|data|blob):/i.test(path)) return path;
    if (path.indexOf('\\') < 0) {
      try { path = decodeURIComponent(path); } catch (e) {}
    }
    // \\?\C:\… and \\?\UNC\server\… are long-path spellings of C:\… and \\server\…
    path = path.replace(/\\/g, '/').replace(/^\/\/[?.]\/(unc\/)?/i, function (m, unc) { return unc ? '//' : ''; });
    var share = /^\/\/[^/]/.test(path) && !/^\/+[a-z]:/i.test(path);
    path = path.replace(/^\/+/, '');
    try { path = encodeURI(path); } catch (e) { return ''; }
    return (share ? 'file://' : 'file:///') + path.replace(/[#?'()]/g, function (c) {
      return '%' + c.charCodeAt(0).toString(16).toUpperCase();
    });
  }

  S.util = {
    clamp: clamp,
    lerp: lerp,
    random: random,
    smoothstep: smoothstep,
    ease: ease,
    parseColor: parseColor,
    rgbToHsl: rgbToHsl,
    hslToRgb: hslToRgb,
    rgbCss: rgbCss,
    arrCss: arrCss,
    luminance: luminance,
    weToHex: weToHex,
    hexToWe: hexToWe,
    fileUrl: fileUrl
  };
})(window.Lyric = window.Lyric || {});
