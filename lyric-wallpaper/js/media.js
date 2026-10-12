/*
 * Lyric Stage — the music playing on the PC (Wallpaper Engine media
 * integration: Spotify, browsers, any player that reports to Windows).
 *
 * Wallpaper Engine sends the song (title, artist, album), whether it is
 * playing, the album cover with its main colors and, for the players that
 * report it, where the song is (the timeline). main.js turns the wallpaper
 * into the show while a song plays, looks up its lyrics (lyrics.js), follows
 * the song (songclock.js) and tints the show with the album colors. Outside
 * Wallpaper Engine (a browser) none of this exists and nothing happens.
 */
(function (S) {
  'use strict';

  var util = S.util;

  var state = {
    enabled: true,        // media integration turned on in Wallpaper Engine
    playing: false,
    title: '',
    artist: '',
    album: '',
    cover: '',            // the album cover as a data URL, '' when there is none
    palette: null,        // { hue, sat, light, hue2 } from the album cover, or null
    colors: null,         // [[r, g, b], …] 0–1: the cover's main colors (most dominant first), or null
    track: 0,             // bumps on every new song
    // Where the song is, from the last report (seconds). Not every player
    // reports it: has stays false then. at = performance.now() of the report.
    timeline: { has: false, position: 0, duration: 0, at: 0 },
    onChange: null,       // function () — song, playback, cover or colors changed
    onTimeline: null      // function (position, duration) — a timeline report
  };

  function now() {
    return window.performance && performance.now ? performance.now() : Date.now();
  }

  function changed() {
    if (state.onChange) state.onChange();
  }

  function text(v) {
    return typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v).trim();
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

  // Album colors → the show's hues: the most vivid color leads, another
  // clearly different one is the second hue. Grey covers give a silvery
  // look; very dark or washed-out colors are kept readable. Wallpaper Engine
  // sends them from the most dominant on: between two equally vivid colors,
  // the more dominant one wins.
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
      // A grey cover: silvery
      light: main[1] < 8 ? 70 : util.clamp(main[2], 40, 72),
      hue2: second ? second[0] : null
    };
  }

  function sameColors(a, b) {
    if (!a || !b) return a === b;
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1] || a[i][2] !== b[i][2]) return false;
    }
    return true;
  }

  function setStatus(e) {
    state.enabled = !!(e && e.enabled);
    if (!state.enabled) state.playing = false;
    changed();
  }

  function setProperties(e) {
    var title = text(e && e.title), artist = text(e && (e.artist || e.albumArtist));
    var album = text(e && e.albumTitle);
    if (title === state.title && artist === state.artist) {
      if (album === state.album) return;
      state.album = album;
      changed();
      return;
    }
    state.title = title;
    state.artist = artist;
    state.album = album;
    state.track++;
    // A new song: its timeline is unknown until the player reports it
    var tl = state.timeline;
    tl.has = false;
    tl.position = 0;
    tl.duration = 0;
    tl.at = 0;
    changed();
  }

  function setThumbnail(e) {
    if (!e) return;
    var raw = [e.primaryColor, e.secondaryColor, e.tertiaryColor];
    var colors = [];
    raw.forEach(function (c) {
      var rgb = parseColor(c);
      if (rgb) colors.push(rgb);
    });
    if (!colors.length) colors = null;
    // A data URL ("data:image/png;base64,…"); anything else is ignored
    var cover = typeof e.thumbnail === 'string' && /^(data:|blob:|https?:|file:)/i.test(e.thumbnail.trim())
      ? e.thumbnail.trim() : '';
    if (cover === state.cover && sameColors(colors, state.colors)) return;
    state.cover = cover;
    state.colors = colors;
    state.palette = paletteFrom(raw);
    changed();
  }

  function setPlayback(e) {
    if (!e) return;
    var I = window.wallpaperMediaIntegration;
    var playing = I && I.PLAYBACK_PLAYING !== undefined ? e.state === I.PLAYBACK_PLAYING : e.state === 1;
    if (playing === state.playing) return;
    state.playing = playing;
    changed();
  }

  // Where the song is: { position, duration } in seconds. 0 and 0 means the
  // player does not report it. Some players hand over milliseconds: a
  // duration over 10 hours, or a position far past the duration that fits
  // once read as milliseconds, is converted.
  function setTimeline(e) {
    if (!e) return;
    var pos = +e.position, dur = +e.duration;
    if (!isFinite(pos) || pos < 0) pos = 0;
    if (!isFinite(dur) || dur < 0) dur = 0;
    if (pos === 0 && dur === 0) return;
    if (dur > 36000) {
      pos /= 1000;
      dur /= 1000;
    } else if (dur > 0 && pos > dur + 5 && pos / 1000 <= dur + 5) {
      pos /= 1000;
    }
    if (dur > 0 && pos > dur) pos = dur;
    var tl = state.timeline;
    tl.has = true;
    tl.position = pos;
    tl.duration = dur;
    tl.at = now();
    if (state.onTimeline) state.onTimeline(pos, dur);
  }

  function register(name, fn) {
    if (typeof window[name] !== 'function') return false;
    try { window[name](fn); return true; } catch (e) { return false; }
  }

  register('wallpaperRegisterMediaStatusListener', setStatus);
  register('wallpaperRegisterMediaPropertiesListener', setProperties);
  register('wallpaperRegisterMediaThumbnailListener', setThumbnail);
  register('wallpaperRegisterMediaPlaybackListener', setPlayback);
  register('wallpaperRegisterMediaTimelineListener', setTimeline);

  S.media = {
    state: state,
    parseColor: parseColor,
    paletteFrom: paletteFrom,
    // Also used by tests to play the part of Wallpaper Engine
    setStatus: setStatus,
    setProperties: setProperties,
    setThumbnail: setThumbnail,
    setPlayback: setPlayback,
    setTimeline: setTimeline
  };
})(window.Lyric = window.Lyric || {});
