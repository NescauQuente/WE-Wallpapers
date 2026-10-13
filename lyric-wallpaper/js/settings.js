/*
 * Lyric Stage — settings schema.
 *
 * Single source of truth for the hidden browser menu and for the Wallpaper
 * Engine project.json, which is generated from this file by
 * dev/lyric-wallpaper/build-project.js. After changing this file, run:
 *
 *   node dev/lyric-wallpaper/build-project.js
 *
 * Labels are in English. Their translations live in js/lang/<code>.js, keyed
 * by where they appear: 'g.<group>', 'n.<group>' (group note), 's.<key>' (an
 * option) and 'o.<key>.<value>' (a choice of a combo). Wallpaper Engine picks
 * the panel language from its own UI language (the localization block
 * generated in project.json); the hidden menu follows the "language" setting.
 *
 * Values use the WE format: slider = number, bool = boolean,
 * color = "r g b" (0–1), combo = string, textinput = string,
 * file = string (a local path chosen in Wallpaper Engine, '' when none).
 *
 * Option fields:
 *   look    → part of the visual style; themes (presets) may set it
 *   fx      → what must be rebuilt when it changes: layout | lang
 *   release → in the menu, only applied when the slider is released (heavy work)
 *   cond    → only shown when: 'key' (truthy) or { k, eq } / { k, ne }
 *   menu    → false = Wallpaper Engine panel only
 *   we      → false = hidden menu only (not in the Wallpaper Engine panel)
 */
(function () {
  'use strict';

  // Supported languages: [code, native name, date locale, Wallpaper Engine code].
  // The codes cover the CasaOS languages; Catalan and Croatian have no
  // Wallpaper Engine UI, so its panel shows them in English.
  var LANGUAGES = [
    ['ar', 'العربية', 'ar', 'ar-sa'],
    ['be', 'Беларуская', 'be-BY', 'be-by'],
    ['bg', 'Български', 'bg-BG', 'bg-bg'],
    ['ca', 'Català', 'ca-ES', null],
    ['cs', 'Čeština', 'cs-CZ', 'cs-cz'],
    ['de', 'Deutsch', 'de-DE', 'de-de'],
    ['el', 'Ελληνικά', 'el-GR', 'el-gr'],
    ['en', 'English', 'en-US', 'en-us'],
    ['es', 'Español', 'es-ES', 'es-es'],
    ['fr', 'Français', 'fr-FR', 'fr-fr'],
    ['hr', 'Hrvatski', 'hr-HR', null],
    ['hu', 'Magyar', 'hu-HU', 'hu-hu'],
    ['id', 'Bahasa Indonesia', 'id-ID', 'id-id'],
    ['it', 'Italiano', 'it-IT', 'it-it'],
    ['ja', '日本語', 'ja-JP', 'ja-jp'],
    ['ko', '한국어', 'ko-KR', 'ko-kr'],
    ['nl', 'Nederlands', 'nl-NL', 'nl-nl'],
    ['no', 'Norsk', 'nb-NO', 'nb-no'],
    ['pl', 'Polski', 'pl-PL', 'pl-pl'],
    ['pt', 'Português (Brasil)', 'pt-BR', 'pt-br'],
    ['pt-pt', 'Português (Portugal)', 'pt-PT', 'pt-pt'],
    ['ro', 'Română', 'ro-RO', 'ro-ro'],
    ['ru', 'Русский', 'ru-RU', 'ru-ru'],
    ['sk', 'Slovenčina', 'sk-SK', 'sk-sk'],
    ['sl', 'Slovenščina', 'sl-SI', 'sl-si'],
    ['sv', 'Svenska', 'sv-SE', 'sv-se'],
    ['tr', 'Türkçe', 'tr-TR', 'tr-tr'],
    ['uk', 'Українська', 'uk-UA', 'uk-ua'],
    ['vi', 'Tiếng Việt', 'vi-VN', 'vi-vn'],
    ['zh-cn', '简体中文', 'zh-CN', 'zh-chs'],
    ['zh-tw', '繁體中文', 'zh-TW', 'zh-cht']
  ];

  var GROUPS = [
    { id: 'general', label: 'General' },
    { id: 'theme', label: 'Theme',
      note: 'The theme is the base. Any option below that you change takes priority over it.' },
    { id: 'idle', label: 'Before the music',
      note: 'Original artwork in the style of the Windows wallpapers. For the real one, pick "My image" and choose C:\\Windows\\Web\\Wallpaper\\Windows\\img0.jpg.' },
    { id: 'show', label: 'When music plays' },
    { id: 'lyrics', label: 'Lyrics',
      note: 'Lyrics are looked up online (lrclib.net) from the song title and artist that Wallpaper Engine reports. Turn on "Media integration" in the Wallpaper Engine settings.' },
    { id: 'audio', label: 'Audio' },
    { id: 'screens', label: 'Monitors' },
    { id: 'advanced', label: 'Advanced' }
  ];

  // Ids are internal (kept stable so saved settings and codes keep working)
  var PRESETS = [
    { id: 'stage', label: 'Album Stage (Default)', values: {} },
    {
      id: 'neon', label: 'Neon Concert',
      values: {
        bgstyle: 'spotlights', visualizer: 'radial', coverstyle: 'vinyl', lyricfont: 'bahnschrift', lyricanim: 'words', textmode: 'album',
        glowtext: true, particles: true, reactiveamt: 1.6
      }
    },
    {
      id: 'minimal', label: 'Minimal',
      values: {
        bgstyle: 'minimal', visualizer: 'silk', lyricfont: 'segoe', lyricanim: 'blur', lyricbeat: false, textmode: 'white',
        glowtext: false, particles: false, reactiveamt: 0.5, lyriccontext: false
      }
    },
    {
      id: 'cinema', label: 'Cinema',
      values: {
        bgstyle: 'cover', visualizer: 'off', coverstyle: 'vinyl', lyricfont: 'georgia', lyricanim: 'karaoke', lyricpos: 'lower',
        textmode: 'white', glowtext: true, particles: false, reactiveamt: 0.7
      }
    },
    {
      id: 'poster', label: 'Poster',
      values: {
        bgstyle: 'aurora', visualizer: 'led', lyricfont: 'impact', lyricanim: 'words', lyricpos: 'left', lyricsize: 1.25,
        textmode: 'album', glowtext: false, particles: true
      }
    }
  ];

  var AUDIO = ['audioenabled'];
  var LYRICS = ['lyrics'];

  var SCHEMA = [
    // General
    { key: 'language', group: 'general', label: 'Language (menu and messages)', type: 'combo', def: 'auto', fx: 'lang',
      options: [['auto', 'Automatic']].concat(LANGUAGES.map(function (l) { return [l[0], l[1]]; })) },
    { key: 'fpslimit', group: 'general', label: 'Frame rate limit', type: 'combo', def: '0', we: false,
      options: [['0', 'Unlimited'], ['60', '60 FPS'], ['30', '30 FPS']] },
    { key: 'quality', group: 'general', label: 'Render resolution', type: 'combo', def: '0.75', fx: 'layout',
      options: [['1', 'Full'], ['0.75', '75% (lighter)'], ['0.5', '50% (lightest)']] },

    // Theme
    { key: 'preset', group: 'theme', label: 'Theme', type: 'combo', def: 'stage',
      options: PRESETS.map(function (p) { return [p.id, p.label]; }) },

    // Before the music (idle)
    { key: 'idlestyle', group: 'idle', label: 'Wallpaper', type: 'combo', def: 'win11',
      options: [
        ['win11', 'Windows 11 style (light)'],
        ['win11dark', 'Windows 11 style (dark)'],
        ['win10', 'Windows 10 style'],
        ['image', 'My image']
      ] },
    { key: 'idleimage', group: 'idle', label: 'Image', type: 'file', def: '', menu: false,
      cond: [{ k: 'idlestyle', eq: 'image' }] },
    { key: 'idlemotion', group: 'idle', label: 'Gentle motion while waiting', type: 'bool', def: false },

    // When music plays (the show)
    { key: 'trigger', group: 'show', label: 'Turn into the show', type: 'combo', def: 'auto',
      options: [
        ['auto', 'Automatic'],
        ['media', 'Only when a player reports a song'],
        ['sound', 'Whenever there is sound for a few seconds'],
        ['always', 'Always (keep the show on)'],
        ['never', 'Never (keep the wallpaper)']
      ] },
    { key: 'soundtime', group: 'show', label: 'Seconds of sound with no song reported before the show starts', type: 'slider', min: 3, max: 60, step: 1, def: 10,
      cond: [{ k: 'trigger', ne: 'media' }, { k: 'trigger', ne: 'always' }, { k: 'trigger', ne: 'never' }] },
    { key: 'transition', group: 'show', label: 'Transition (seconds)', type: 'slider', min: 0.5, max: 6, step: 0.1, def: 2.5 },
    { key: 'transfx', group: 'show', label: 'Transition effect', type: 'combo', def: 'burn', look: true,
      options: [
        ['burn', 'Burning paper'],
        ['ripple', 'Ripples'],
        ['pixels', 'Pixels'],
        ['glass', 'Shattered glass'],
        ['sweep', 'Sweep of light'],
        ['vortex', 'Vortex'],
        ['glitch', 'Glitch'],
        ['random', 'Random (a different one each time)']
      ] },
    { key: 'returndelay', group: 'show', label: 'Back to the wallpaper after a pause of (seconds)', type: 'slider', min: 2, max: 60, step: 1, def: 8 },
    { key: 'bgstyle', group: 'show', label: 'Background', type: 'combo', def: 'aurora', look: true,
      options: [
        ['aurora', 'Aurora in the album colors'],
        ['spotlights', 'Concert spotlights'],
        ['cover', 'Blurred album cover'],
        ['minimal', 'Dark and minimal']
      ] },
    { key: 'reactive', group: 'show', label: 'Background reacts to the music', type: 'bool', def: true, look: true },
    { key: 'reactiveamt', group: 'show', label: 'Reaction strength', type: 'slider', min: 0, max: 3, step: 0.05, def: 1, look: true, cond: ['reactive'] },
    { key: 'particles', group: 'show', label: 'Floating particles', type: 'bool', def: true, look: true },
    { key: 'visualizer', group: 'show', label: 'Audio visualizer', type: 'combo', def: 'bars', look: true, cond: ['audioenabled'],
      options: [
        ['off', 'Off'],
        ['bars', 'Bars at the bottom'],
        ['wave', 'Wave at the bottom'],
        ['ring', 'Ring around the center'],
        ['mirror', 'Mirrored bars with a reflection'],
        ['led', 'LED equalizer'],
        ['radial', 'Spikes around the center'],
        ['silk', 'Silk waves'],
        ['edges', 'Bars on the screen edges'],
        ['pulse', 'Pulse rings']
      ] },
    { key: 'vizsmart', group: 'show', label: 'The visualizer grows when there is no line to sing', type: 'bool', def: true, look: true,
      cond: ['audioenabled', { k: 'visualizer', ne: 'off' }] },
    { key: 'vizsize', group: 'show', label: 'Visualizer size', type: 'slider', min: 0.3, max: 2, step: 0.05, def: 1, look: true,
      cond: ['audioenabled', { k: 'visualizer', ne: 'off' }] },
    { key: 'songcard', group: 'show', label: 'Song title and artist', type: 'combo', def: 'corner', look: true,
      options: [
        ['corner', 'At the start, then in a corner'],
        ['start', 'Only at the start of the song'],
        ['off', 'Off']
      ] },
    { key: 'showcover', group: 'show', label: 'Album cover next to the title', type: 'bool', def: true, look: true,
      cond: [{ k: 'songcard', ne: 'off' }] },
    { key: 'coverstyle', group: 'show', label: 'Album cover', type: 'combo', def: 'square', look: true,
      cond: [{ k: 'songcard', ne: 'off' }, 'showcover'],
      options: [['square', 'Square'], ['vinyl', 'Spinning vinyl record']] },
    { key: 'progress', group: 'show', label: 'Song progress in the corner card', type: 'bool', def: true,
      cond: [{ k: 'songcard', eq: 'corner' }] },
    { key: 'showcolor', group: 'show', label: 'Color when there is no album cover', type: 'color', def: '0.360 0.450 1.000', look: true },

    // Lyrics
    { key: 'lyrics', group: 'lyrics', label: 'Show the lyrics', type: 'bool', def: true },
    { key: 'lyricanim', group: 'lyrics', label: 'Animation', type: 'combo', def: 'karaoke', look: true, cond: LYRICS,
      options: [
        ['karaoke', 'Karaoke (the line fills as it is sung)'],
        ['words', 'Word by word'],
        ['fade', 'Whole line'],
        ['blur', 'Out of a blur'],
        ['typewriter', 'Typewriter']
      ] },
    { key: 'chorus', group: 'lyrics', label: 'Highlight the chorus (lines that come back)', type: 'bool', def: true, look: true, cond: LYRICS },
    { key: 'lyricbeat', group: 'lyrics', label: 'Lyrics jump on the beat, each new line flashes', type: 'bool', def: true, look: true, cond: LYRICS },
    { key: 'lyricfont', group: 'lyrics', label: 'Font', type: 'combo', def: 'segoe', look: true, cond: LYRICS,
      options: [
        ['segoe', 'Modern'],
        ['bahnschrift', 'Futuristic'],
        ['georgia', 'Classic'],
        ['impact', 'Bold poster'],
        ['consolas', 'Monospace']
      ] },
    { key: 'lyricsize', group: 'lyrics', label: 'Size', type: 'slider', min: 0.5, max: 2, step: 0.05, def: 1, look: true, cond: LYRICS },
    { key: 'lyricpos', group: 'lyrics', label: 'Position', type: 'combo', def: 'center', look: true, cond: LYRICS,
      options: [
        ['center', 'Center'],
        ['lower', 'Lower third'],
        ['left', 'Left, large']
      ] },
    { key: 'lyriccontext', group: 'lyrics', label: 'Show the previous and next lines', type: 'bool', def: true, look: true, cond: LYRICS },
    { key: 'textmode', group: 'lyrics', label: 'Text color', type: 'combo', def: 'album', look: true, cond: LYRICS,
      options: [
        ['album', 'From the album cover'],
        ['white', 'White'],
        ['custom', 'Custom']
      ] },
    { key: 'textcolor', group: 'lyrics', label: 'Custom text color', type: 'color', def: '1.000 0.850 0.400', look: true,
      cond: ['lyrics', { k: 'textmode', eq: 'custom' }] },
    { key: 'glowtext', group: 'lyrics', label: 'Glow', type: 'bool', def: true, look: true, cond: LYRICS },
    { key: 'lyricoffset', group: 'lyrics', label: 'Timing adjustment (seconds; raise it if the lyrics come too early)', type: 'slider', min: -3, max: 3, step: 0.1, def: 0, cond: LYRICS },

    // Audio
    { key: 'audioenabled', group: 'audio', label: 'React to audio', type: 'bool', def: true },
    { key: 'audiosensitivity', group: 'audio', label: 'Overall sensitivity', type: 'slider', min: 0.1, max: 3, step: 0.05, def: 1, cond: AUDIO },

    // Monitors
    { key: 'screens', group: 'screens', label: 'Monitors (wallpaper spanned across them)', type: 'combo', def: '1', fx: 'layout',
      options: [
        ['1', 'Single screen'],
        ['auto', 'Automatic (by aspect ratio)'],
        ['2', '2 screens side by side'],
        ['3', '3 screens side by side'],
        ['4', '4 screens side by side']
      ] },
    { key: 'lyricscreen', group: 'screens', label: 'Screen with the lyrics', type: 'slider', min: 1, max: 4, step: 1, def: 1, fx: 'layout',
      cond: [{ k: 'screens', ne: '1' }] },
    { key: 'sidecard', group: 'screens', label: 'The other screens show the song playing (cover, title, progress)', type: 'bool', def: true,
      cond: [{ k: 'screens', ne: '1' }] },

    // Advanced (WE only: in the browser, importing lives in the menu)
    { key: 'importcode', group: 'advanced', label: 'Import code (generated in the browser menu)', type: 'textinput', def: '', menu: false }
  ];

  var BY_KEY = {};
  SCHEMA.forEach(function (s) { BY_KEY[s.key] = s; });

  function defaults() {
    var d = {};
    SCHEMA.forEach(function (s) { d[s.key] = s.def; });
    return d;
  }

  function presetValues(id) {
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i].values;
    return {};
  }

  // Tolerant comparison (WE may format numbers and colors differently)
  function equal(a, b) {
    if (a === b) return true;
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6;
    if (typeof a === 'string' && typeof b === 'string') {
      var pa = a.trim().split(/\s+/), pb = b.trim().split(/\s+/);
      if (pa.length === 3 && pb.length === 3) {
        return pa.every(function (v, i) { return Math.abs(parseFloat(v) - parseFloat(pb[i])) < 0.003; });
      }
    }
    return false;
  }

  // Validates and normalizes a value; returns undefined when invalid
  function sanitize(key, v) {
    var s = BY_KEY[key];
    if (!s) return undefined;
    switch (s.type) {
      case 'slider':
        var n = Number(v);
        return isFinite(n) ? Math.min(s.max, Math.max(s.min, n)) : undefined;
      case 'bool':
        return typeof v === 'boolean' ? v : undefined;
      case 'color':
        if (typeof v !== 'string') return undefined;
        var p = v.trim().split(/\s+/).map(Number);
        if (p.length !== 3 || p.some(function (x) { return !isFinite(x); })) return undefined;
        return p.map(function (x) { return Math.min(1, Math.max(0, x)).toFixed(3); }).join(' ');
      case 'combo':
        v = String(v);
        if (key === 'preset' && v === 'custom') return v;
        return s.options.some(function (o) { return o[0] === v; }) ? v : undefined;
      case 'textinput':
      case 'file':
        return typeof v === 'string' ? v : undefined;
    }
    return undefined;
  }

  var CODE_PREFIX = 'LYRIC1:';

  function encode(values) {
    return CODE_PREFIX + btoa(unescape(encodeURIComponent(JSON.stringify(values))));
  }

  // Accepts a LYRIC1:… code or plain JSON. Returns null when invalid.
  function decode(str) {
    if (typeof str !== 'string' || !str.trim()) return null;
    str = str.trim();
    var obj;
    try {
      var json = str.indexOf(CODE_PREFIX) === 0
        ? decodeURIComponent(escape(atob(str.slice(CODE_PREFIX.length))))
        : str;
      obj = JSON.parse(json);
    } catch (e) {
      return null;
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    var out = {};
    Object.keys(obj).forEach(function (k) {
      if (k === 'importcode' || k === 'preset' || k === 'idleimage') return;
      var v = sanitize(k, obj[k]);
      if (v !== undefined) out[k] = v;
    });
    return out;
  }

  function condMet(cond, values) {
    if (!cond) return true;
    return cond.every(function (c) {
      if (typeof c === 'string') return !!values[c];
      if ('eq' in c) return values[c.k] === c.eq;
      if ('ne' in c) return values[c.k] !== c.ne;
      return true;
    });
  }

  function condToWE(cond) {
    return cond.map(function (c) {
      if (typeof c === 'string') return c + '.value == true';
      if ('eq' in c) return c.k + ".value == '" + c.eq + "'";
      return c.k + ".value != '" + c.ne + "'";
    }).join(' && ');
  }

  var api = {
    LANGUAGES: LANGUAGES,
    GROUPS: GROUPS,
    PRESETS: PRESETS,
    SCHEMA: SCHEMA,
    BY_KEY: BY_KEY,
    defaults: defaults,
    presetValues: presetValues,
    equal: equal,
    sanitize: sanitize,
    encode: encode,
    decode: decode,
    condMet: condMet,
    condToWE: condToWE
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else (window.Lyric = window.Lyric || {}).settings = api;
})();
