/*
 * Starry Orbit — the music playing on the PC (Wallpaper Engine media
 * integration: Spotify, browsers, any player that reports to Windows).
 *
 * Wallpaper Engine sends the song (title, artist), whether it is playing and
 * the main colors of its album cover. main.js tints the sky with those colors
 * and the clock shows the song. Outside Wallpaper Engine (browser, Live
 * Wallpapers on CasaOS) none of this exists and nothing changes.
 */
(function (S) {
  'use strict';

  var util = S.util;

  var state = {
    enabled: true,        // media integration turned on in Wallpaper Engine
    playing: false,
    title: '',
    artist: '',
    palette: null,        // { hue, sat, light, hue2 } from the album cover, or null
    track: 0,             // bumps on every new song
    onChange: null        // function () — song, playback or colors changed
  };

  function changed() {
    if (state.onChange) state.onChange();
  }

  // '#rgb', '#rrggbb', 'rgb(r, g, b)' (0–255) or 'r g b' (0–1) → [r, g, b] 0–1
  function parseColor(c) {
    if (Array.isArray(c) && c.length >= 3) return c.slice(0, 3).map(function (v) { return util.clamp(+v || 0, 0, 1); });
    if (typeof c !== 'string') return null;
    var s = c.trim(), m;
    if ((m = /^#([0-9a-f]{3})$/i.exec(s))) {
      return m[1].split('').map(function (x) { return parseInt(x + x, 16) / 255; });
    }
    if ((m = /^#([0-9a-f]{6})/i.exec(s))) {
      return [0, 2, 4].map(function (i) { return parseInt(m[1].substr(i, 2), 16) / 255; });
    }
    if ((m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s))) {
      return [m[1], m[2], m[3]].map(function (v) { return util.clamp(+v / 255, 0, 1); });
    }
    var p = s.split(/\s+/).map(Number);
    if (p.length === 3 && p.every(function (v) { return isFinite(v); })) {
      return p.map(function (v) { return util.clamp(v > 1 ? v / 255 : v, 0, 1); });
    }
    return null;
  }

  // Album colors → the sky: the most vivid color becomes the stars, another
  // clearly different one the nebula's second hue. Grey covers give a
  // silvery sky; very dark or washed-out colors are kept readable.
  // Wallpaper Engine sends them from the most dominant on: between two
  // equally vivid colors, the more dominant one wins.
  function paletteFrom(colors) {
    var list = [];
    colors.forEach(function (c, i) {
      var rgb = parseColor(c);
      if (rgb) list.push({ hsl: util.rgbToHsl(rgb), weight: 1 - 0.08 * i });
    });
    if (!list.length) return null;
    function vivid(c) { return c.hsl[1] * (1 - Math.min(1, Math.abs(c.hsl[2] - 55) / 50)) * c.weight; }
    list.sort(function (a, b) { return vivid(b) - vivid(a); });
    list = list.map(function (c) { return c.hsl; });
    var main = list[0], second = null;
    for (var i = 1; i < list.length; i++) {
      var d = Math.abs(((list[i][0] - main[0]) % 360 + 540) % 360 - 180);
      if (list[i][1] > 15 && d > 20) { second = list[i]; break; }
    }
    return {
      hue: main[0],
      sat: main[1],
      // A grey cover: silvery stars
      light: main[1] < 8 ? 70 : util.clamp(main[2], 40, 72),
      hue2: second ? second[0] : null
    };
  }

  function setStatus(e) {
    state.enabled = !!(e && e.enabled);
    if (!state.enabled) state.playing = false;
    changed();
  }

  function setProperties(e) {
    var title = (e && e.title) || '', artist = (e && (e.artist || e.albumArtist)) || '';
    if (title === state.title && artist === state.artist) return;
    state.title = title;
    state.artist = artist;
    state.track++;
    changed();
  }

  function setThumbnail(e) {
    if (!e) return;
    state.palette = paletteFrom([e.primaryColor, e.secondaryColor, e.tertiaryColor]);
    changed();
  }

  function setPlayback(e) {
    var I = window.wallpaperMediaIntegration;
    var playing = I && I.PLAYBACK_PLAYING !== undefined ? e.state === I.PLAYBACK_PLAYING : e.state === 1;
    if (playing === state.playing) return;
    state.playing = playing;
    changed();
  }

  function register(name, fn) {
    if (typeof window[name] !== 'function') return false;
    try { window[name](fn); return true; } catch (e) { return false; }
  }

  register('wallpaperRegisterMediaStatusListener', setStatus);
  register('wallpaperRegisterMediaPropertiesListener', setProperties);
  register('wallpaperRegisterMediaThumbnailListener', setThumbnail);
  register('wallpaperRegisterMediaPlaybackListener', setPlayback);

  S.media = {
    state: state,
    parseColor: parseColor,
    paletteFrom: paletteFrom,
    // Also used by tests to play the part of Wallpaper Engine
    setStatus: setStatus,
    setProperties: setProperties,
    setThumbnail: setThumbnail,
    setPlayback: setPlayback
  };
})(window.Starry = window.Starry || {});
