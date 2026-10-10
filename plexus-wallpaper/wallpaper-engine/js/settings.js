/*
 * Neural Plexus — settings schema.
 *
 * Single source of truth for the hidden browser menu and for the Wallpaper
 * Engine project.json, which is generated from this file by
 * tools/build-project.js. After changing this file, run:
 *
 *   node tools/build-project.js
 *
 * Labels are in English. Their translations live in js/lang/<code>.js, keyed
 * by where they appear: 'g.<group>', 'n.<group>' (group note), 's.<key>' (an
 * option) and 'o.<key>.<value>' (a choice of a combo). Wallpaper Engine picks
 * the panel language from its own UI language (the localization block
 * generated in project.json); the hidden menu follows the "language" setting.
 *
 * Values use the WE format: slider = number, bool = boolean,
 * color = "r g b" (0–1), combo = string, textinput = string.
 *
 * Option fields:
 *   look    → part of the visual style; themes (presets) may set it
 *   fx      → what must be rebuilt when it changes: layout | color | clock | lang
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
    { id: 'nodes', label: 'Nodes' },
    { id: 'links', label: 'Connections' },
    { id: 'color', label: 'Colors' },
    { id: 'effects', label: 'Effects' },
    { id: 'motion', label: 'Motion' },
    { id: 'signals', label: 'Signals' },
    { id: 'interact', label: 'Mouse' },
    { id: 'shapes', label: 'Formations' },
    { id: 'audio', label: 'Audio' },
    { id: 'clock', label: 'Clock' },
    { id: 'screens', label: 'Monitors' },
    { id: 'advanced', label: 'Advanced' }
  ];

  // Ids are internal (kept stable so saved settings and codes keep working)
  var PRESETS = [
    { id: 'circuit', label: 'Circuit Blue (Default)', values: {} },
    {
      id: 'synapse', label: 'Neural Synapse',
      values: {
        nodecolor: '0.930 0.260 0.720', color2: '0.420 0.200 0.950', pulsecolor: '1.000 0.860 0.960',
        signalrate: 4, signalreach: 1.4, hazeamt: 1.3, triopacity: 0.3, audiohueamt: 40
      }
    },
    {
      id: 'matrix', label: 'Green Code',
      values: {
        nodecolor: '0.100 0.950 0.380', colormode: 'single', pulsecolor: '0.820 1.000 0.820',
        custombg: true, bgcolor: '0.004 0.020 0.008', signalspeed: 1.6, signalrate: 5,
        triangles: false, haze: false, linkwidth: 0.8, audiohue: false
      }
    },
    {
      id: 'ember', label: 'Ember Web',
      values: {
        nodecolor: '1.000 0.560 0.120', color2: '0.900 0.150 0.080', pulsecolor: '1.000 0.900 0.620',
        hazeamt: 0.7, bloomamt: 1.3, audiohueamt: 20
      }
    },
    {
      id: 'aurora', label: 'Aurora',
      values: {
        nodecolor: '0.150 0.950 0.700', color2: '0.550 0.300 1.000', colormode: 'gradient',
        pulsecolor: '0.880 1.000 0.960', hazeamt: 1.6, speed: 0.8
      }
    },
    {
      id: 'mono', label: 'Silver Monochrome',
      values: {
        nodecolor: '0.850 0.880 0.950', colormode: 'single', pulsecolor: '1.000 1.000 1.000',
        custombg: true, bgcolor: '0.020 0.020 0.024', haze: false, bloomamt: 0.6,
        linkopacity: 0.5, triopacity: 0.2, audiohue: false
      }
    },
    {
      id: 'cyber', label: 'Cyberpunk',
      values: {
        nodecolor: '1.000 0.150 0.650', color2: '0.050 0.900 1.000', colormode: 'gradient',
        pulsecolor: '1.000 0.950 0.300', bloomamt: 1.6, signalrate: 4, speed: 1.4, linkwidth: 1.2,
        audiohueamt: 60
      }
    },
    {
      id: 'prism', label: 'Prism',
      values: {
        colormode: 'rainbow', rainbowspeed: 20, pulsecolor: '1.000 1.000 1.000',
        custombg: true, bgcolor: '0.016 0.016 0.031', hazeamt: 0.7, signalrate: 3
      }
    },
    {
      id: 'zen', label: 'Deep Zen',
      values: {
        nodecolor: '0.350 0.600 0.750', color2: '0.250 0.300 0.600', nodecount: 130, speed: 0.5,
        signalrate: 0.4, signalspeed: 0.6, triopacity: 0.2, bloomamt: 0.7, hazeamt: 0.7,
        audiobeat: false, audiobreathamt: 0.5, audiodrop: false, audiohue: false
      }
    }
  ];

  var CLOCK = ['clock'];
  var AUDIO = ['audioenabled'];
  var TWO_COLORS = [{ k: 'colormode', ne: 'single' }, { k: 'colormode', ne: 'rainbow' }];

  var SCHEMA = [
    // General
    { key: 'language', group: 'general', label: 'Language (menu and date)', type: 'combo', def: 'auto', fx: 'lang',
      options: [['auto', 'Automatic']].concat(LANGUAGES.map(function (l) { return [l[0], l[1]]; })) },
    { key: 'fpslimit', group: 'general', label: 'Frame rate limit', type: 'combo', def: '0', we: false,
      options: [['0', 'Unlimited'], ['60', '60 FPS'], ['30', '30 FPS']] },
    { key: 'quality', group: 'general', label: 'Render resolution', type: 'combo', def: '1', fx: 'layout',
      options: [['1', 'Full'], ['0.75', '75% (lighter)'], ['0.5', '50% (lightest)']] },

    // Theme
    { key: 'preset', group: 'theme', label: 'Theme', type: 'combo', def: 'circuit',
      options: PRESETS.map(function (p) { return [p.id, p.label]; }) },

    // Nodes
    { key: 'nodecount', group: 'nodes', label: 'Count (per screen)', type: 'slider', min: 30, max: 800, step: 10, def: 300, look: true, fx: 'layout', release: true },
    { key: 'nodesize', group: 'nodes', label: 'Size', type: 'slider', min: 0.2, max: 4, step: 0.05, def: 1, look: true },
    { key: 'nodeglow', group: 'nodes', label: 'Glow', type: 'slider', min: 0, max: 3, step: 0.05, def: 1, look: true },
    { key: 'twinkle', group: 'nodes', label: 'Twinkle', type: 'bool', def: true, look: true },
    { key: 'depth', group: 'nodes', label: 'Depth (3D)', type: 'slider', min: 0, max: 2, step: 0.05, def: 1, look: true, fx: 'layout', release: true },
    { key: 'dust', group: 'nodes', label: 'Background dust', type: 'bool', def: true, look: true },

    // Connections
    { key: 'linkdist', group: 'links', label: 'Connection distance', type: 'slider', min: 60, max: 400, step: 5, def: 200, look: true },
    { key: 'linkwidth', group: 'links', label: 'Line width', type: 'slider', min: 0.3, max: 4, step: 0.05, def: 1, look: true },
    { key: 'linkopacity', group: 'links', label: 'Line opacity', type: 'slider', min: 0.05, max: 1, step: 0.05, def: 0.7, look: true },
    { key: 'triangles', group: 'links', label: 'Fill the triangles', type: 'bool', def: true, look: true },
    { key: 'triopacity', group: 'links', label: 'Triangle opacity', type: 'slider', min: 0.05, max: 1, step: 0.05, def: 0.35, look: true, cond: ['triangles'] },

    // Colors
    { key: 'colormode', group: 'color', label: 'Color mode', type: 'combo', def: 'depth', look: true,
      options: [
        ['single', 'Single color'],
        ['depth', 'By depth (near → far)'],
        ['gradient', 'Gradient (left → right)'],
        ['rainbow', 'Rainbow']
      ] },
    { key: 'nodecolor', group: 'color', label: 'Main color', type: 'color', def: '0.000 0.604 0.780', look: true, fx: 'color' },
    { key: 'color2', group: 'color', label: 'Second color', type: 'color', def: '0.330 0.240 0.900', look: true, cond: TWO_COLORS },
    { key: 'rainbowspeed', group: 'color', label: 'Rainbow spin (°/s)', type: 'slider', min: 0, max: 90, step: 1, def: 12, look: true, cond: [{ k: 'colormode', eq: 'rainbow' }] },
    { key: 'pulsecolor', group: 'color', label: 'Signal color', type: 'color', def: '0.720 0.960 1.000', look: true },
    { key: 'custombg', group: 'color', label: 'Custom background', type: 'bool', def: false, look: true },
    { key: 'bgcolor', group: 'color', label: 'Background color', type: 'color', def: '0.031 0.039 0.051', look: true, cond: ['custombg'] },
    { key: 'mediacolors', group: 'color', label: 'Colors from the album cover (Wallpaper Engine)', type: 'bool', def: true },

    // Effects
    { key: 'bloom', group: 'effects', label: 'Glow (bloom)', type: 'bool', def: true, look: true },
    { key: 'bloomamt', group: 'effects', label: 'Glow strength', type: 'slider', min: 0.1, max: 3, step: 0.05, def: 1, look: true, cond: ['bloom'] },
    { key: 'dof', group: 'effects', label: 'Depth of field (near and far nodes blur)', type: 'bool', def: true, look: true },
    { key: 'haze', group: 'effects', label: 'Background haze', type: 'bool', def: true, look: true },
    { key: 'hazeamt', group: 'effects', label: 'Haze intensity', type: 'slider', min: 0.1, max: 3, step: 0.05, def: 1, look: true, cond: ['haze'] },
    { key: 'distortion', group: 'effects', label: 'Shockwaves bend space', type: 'bool', def: true, look: true },

    // Motion
    { key: 'speed', group: 'motion', label: 'Drift speed', type: 'slider', min: 0, max: 5, step: 0.05, def: 1, look: true },
    { key: 'sway', group: 'motion', label: 'Slow camera sway', type: 'bool', def: true, look: true },
    { key: 'parallax', group: 'motion', label: 'Mouse parallax', type: 'bool', def: true },
    { key: 'parallaxamt', group: 'motion', label: 'Parallax strength', type: 'slider', min: 0.1, max: 3, step: 0.05, def: 1, cond: ['parallax'] },

    // Signals
    { key: 'signals', group: 'signals', label: 'Signals travel along the connections', type: 'bool', def: true, look: true },
    { key: 'signalrate', group: 'signals', label: 'Spontaneous signals per second', type: 'slider', min: 0, max: 20, step: 0.1, def: 1.5, look: true, cond: ['signals'] },
    { key: 'signalspeed', group: 'signals', label: 'Signal speed', type: 'slider', min: 0.2, max: 4, step: 0.05, def: 1, look: true, cond: ['signals'] },
    { key: 'signalreach', group: 'signals', label: 'Chain reaction reach', type: 'slider', min: 0.2, max: 3, step: 0.05, def: 1, look: true, cond: ['signals'] },
    { key: 'rings', group: 'signals', label: 'A ring when a node fires', type: 'bool', def: true, look: true, cond: ['signals'] },

    // Mouse
    { key: 'mouselinks', group: 'interact', label: 'Connect the cursor to nearby nodes', type: 'bool', def: true },
    { key: 'mouseforce', group: 'interact', label: 'Cursor force', type: 'combo', def: 'attract',
      options: [['none', 'None'], ['attract', 'Attract'], ['repel', 'Repel']] },
    { key: 'mouseradius', group: 'interact', label: 'Cursor reach', type: 'slider', min: 60, max: 500, step: 10, def: 200 },
    { key: 'clickfire', group: 'interact', label: 'Click: chain reaction and shockwave', type: 'bool', def: true },
    { key: 'surgeamt', group: 'interact', label: 'Overcharge strength', type: 'slider', min: 0.3, max: 3, step: 0.05, def: 1 },
    { key: 'singularity', group: 'interact', label: 'Click and hold/drag: singularity (release to explode)', type: 'bool', def: true },
    { key: 'singularityamt', group: 'interact', label: 'Singularity strength', type: 'slider', min: 0.3, max: 3, step: 0.05, def: 1, cond: ['singularity'] },

    // Formations
    { key: 'shapes', group: 'shapes', label: 'Nodes come together into shapes now and then', type: 'bool', def: true },
    { key: 'shapefreq', group: 'shapes', label: 'Minutes between formations (average)', type: 'slider', min: 1, max: 30, step: 1, def: 3, cond: ['shapes'] },
    { key: 'shapehold', group: 'shapes', label: 'Seconds each formation holds', type: 'slider', min: 5, max: 60, step: 1, def: 16, cond: ['shapes'] },
    { key: 'shapesize', group: 'shapes', label: 'Formation size', type: 'slider', min: 0.5, max: 1.6, step: 0.05, def: 1, cond: ['shapes'] },
    { key: 'shapeclock', group: 'shapes', label: 'The time is one of the formations', type: 'bool', def: true, cond: ['shapes'] },

    // Audio
    { key: 'audioenabled', group: 'audio', label: 'React to audio', type: 'bool', def: true },
    { key: 'audiosensitivity', group: 'audio', label: 'Overall sensitivity', type: 'slider', min: 0.1, max: 3, step: 0.05, def: 1, cond: AUDIO },
    { key: 'audiobeat', group: 'audio', label: 'Chain reactions on bass beats', type: 'bool', def: true, look: true, cond: AUDIO },
    { key: 'audiobreath', group: 'audio', label: 'Connections stretch with the bass', type: 'bool', def: true, look: true, cond: AUDIO },
    { key: 'audiobreathamt', group: 'audio', label: 'Stretch strength', type: 'slider', min: 0, max: 3, step: 0.05, def: 1, look: true, cond: ['audioenabled', 'audiobreath'] },
    { key: 'audiosize', group: 'audio', label: 'Pulse with the bass', type: 'bool', def: true, look: true, cond: AUDIO },
    { key: 'audiosizeamt', group: 'audio', label: 'Pulse strength', type: 'slider', min: 0, max: 3, step: 0.05, def: 1, look: true, cond: ['audioenabled', 'audiosize'] },
    { key: 'audiospectrum', group: 'audio', label: 'Spectrum across the network', type: 'combo', def: 'radius', look: true, cond: AUDIO,
      options: [
        ['off', 'Off'],
        ['radius', 'Center = bass, edge = treble'],
        ['x', 'Left = bass, right = treble'],
        ['depth', 'Near = bass, far = treble']
      ] },
    { key: 'audiospectrumamt', group: 'audio', label: 'Spectrum strength', type: 'slider', min: 0, max: 3, step: 0.05, def: 1, look: true, cond: ['audioenabled', { k: 'audiospectrum', ne: 'off' }] },
    { key: 'audiosparks', group: 'audio', label: 'Sparks on treble hits', type: 'bool', def: true, look: true, cond: AUDIO },
    { key: 'audiodrop', group: 'audio', label: 'Flight through the network on the drop', type: 'bool', def: true, look: true, cond: AUDIO },
    { key: 'visualizer', group: 'audio', label: 'Audio visualizer when music plays', type: 'bool', def: true, cond: AUDIO },
    { key: 'vizstyle', group: 'audio', label: 'Visualizer style', type: 'combo', def: 'alternate', cond: ['audioenabled', 'visualizer'],
      options: [
        ['alternate', 'Alternate'],
        ['terrain', '3D spectrogram (landscape)'],
        ['tunnel', 'Spectrum tunnel']
      ] },
    { key: 'audiospeed', group: 'audio', label: 'Speed up with volume', type: 'bool', def: true, look: true, cond: AUDIO },
    { key: 'audiospeedamt', group: 'audio', label: 'Speed-up strength', type: 'slider', min: 0, max: 10, step: 0.1, def: 2, look: true, cond: ['audioenabled', 'audiospeed'] },
    { key: 'audiohue', group: 'audio', label: 'Shift color with audio', type: 'bool', def: true, look: true, cond: AUDIO },
    { key: 'audiohueamt', group: 'audio', label: 'Color shift (°)', type: 'slider', min: 0, max: 180, step: 1, def: 30, look: true, cond: ['audioenabled', 'audiohue'] },
    { key: 'pauseonsilence', group: 'audio', label: 'Pause on silence', type: 'bool', def: false, cond: AUDIO },

    // Clock
    { key: 'clock', group: 'clock', label: 'Show clock', type: 'bool', def: false, fx: 'clock layout' },
    { key: 'clockformat', group: 'clock', label: 'Format', type: 'combo', def: '24', fx: 'clock', cond: CLOCK,
      options: [['24', '24-hour'], ['12', '12-hour (AM/PM)']] },
    { key: 'clockseconds', group: 'clock', label: 'Show seconds', type: 'bool', def: false, fx: 'clock', cond: CLOCK },
    { key: 'clockdate', group: 'clock', label: 'Show date', type: 'bool', def: true, fx: 'clock', cond: CLOCK },
    { key: 'clocksong', group: 'clock', label: 'Show the song playing (Wallpaper Engine)', type: 'bool', def: true, fx: 'clock', cond: CLOCK },
    { key: 'clockpos', group: 'clock', label: 'Position', type: 'combo', def: 'center', fx: 'clock', cond: CLOCK,
      options: [
        ['center', 'Center'],
        ['top-left', 'Top left'],
        ['top-center', 'Top center'],
        ['top-right', 'Top right'],
        ['bottom-left', 'Bottom left'],
        ['bottom-center', 'Bottom center'],
        ['bottom-right', 'Bottom right']
      ] },
    { key: 'clockfont', group: 'clock', label: 'Font', type: 'combo', def: 'particles', fx: 'clock layout', cond: CLOCK,
      options: [
        ['particles', 'Particles (drawn by the network)'],
        ['segoe', 'Modern'],
        ['bahnschrift', 'Futuristic'],
        ['consolas', 'Monospace'],
        ['georgia', 'Classic']
      ] },
    { key: 'clocksize', group: 'clock', label: 'Size', type: 'slider', min: 0.4, max: 3, step: 0.05, def: 1, fx: 'clock', cond: CLOCK },
    { key: 'clockopacity', group: 'clock', label: 'Opacity', type: 'slider', min: 0.1, max: 1, step: 0.05, def: 0.85, fx: 'clock', cond: CLOCK },
    { key: 'clockcolor', group: 'clock', label: 'Color', type: 'color', def: '0.920 0.945 1.000', fx: 'clock', cond: CLOCK },
    { key: 'clockglow', group: 'clock', label: 'Glow', type: 'bool', def: true, fx: 'clock', cond: CLOCK },
    { key: 'clockhour', group: 'clock', label: 'At the turn of the hour, big in the middle of the screen', type: 'bool', def: true, cond: ['clock', { k: 'clockfont', eq: 'particles' }] },
    { key: 'clockpulse', group: 'clock', label: 'Pulse with the bass', type: 'bool', def: false, cond: CLOCK },
    { key: 'clockscreen', group: 'clock', label: 'Clock screen', type: 'slider', min: 1, max: 4, step: 1, def: 1, fx: 'clock', cond: ['clock', { k: 'screens', ne: '1' }] },

    // Monitors
    { key: 'screens', group: 'screens', label: 'Monitors (wallpaper spanned across them)', type: 'combo', def: '1', fx: 'layout',
      options: [
        ['1', 'Single screen'],
        ['auto', 'Automatic (by aspect ratio)'],
        ['2', '2 screens side by side'],
        ['3', '3 screens side by side'],
        ['4', '4 screens side by side']
      ] },

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
        return typeof v === 'string' ? v : undefined;
    }
    return undefined;
  }

  var CODE_PREFIX = 'PLEXUS1:';

  function encode(values) {
    return CODE_PREFIX + btoa(unescape(encodeURIComponent(JSON.stringify(values))));
  }

  // Accepts a PLEXUS1:… code or plain JSON. Returns null when invalid.
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
      if (k === 'importcode' || k === 'preset') return;
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
  else (window.Plexus = window.Plexus || {}).settings = api;
})();
