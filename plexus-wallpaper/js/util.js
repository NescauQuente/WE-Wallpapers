/*
 * Neural Plexus — shared utilities (math and colors).
 * Colors use the Wallpaper Engine format: "r g b" with values from 0 to 1.
 */
(function (S) {
  'use strict';

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // Random integer between min and max (inclusive), same as the original mod
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

  S.util = {
    clamp: clamp,
    random: random,
    smoothstep: smoothstep,
    parseColor: parseColor,
    rgbToHsl: rgbToHsl,
    hslToRgb: hslToRgb,
    rgbCss: rgbCss,
    weToHex: weToHex,
    hexToWe: hexToWe
  };
})(window.Plexus = window.Plexus || {});
