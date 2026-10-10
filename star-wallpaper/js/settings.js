/*
 * Starry Orbit — settings schema.
 *
 * Single source of truth for the hidden browser menu and for the Wallpaper
 * Engine project.json, which is generated from this file by
 * dev/star-wallpaper/build-project.js. After changing this file, run:
 *
 *   node dev/star-wallpaper/build-project.js
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
    { id: 'stars', label: 'Stars' },
    { id: 'color', label: 'Colors' },
    { id: 'nebula', label: 'Nebula' },
    { id: 'motion', label: 'Motion' },
    { id: 'interact', label: 'Mouse' },
    { id: 'wave', label: 'Gravitational wave' },
    { id: 'shooting', label: 'Shooting stars' },
    { id: 'planets', label: 'Planets' },
    { id: 'events', label: 'Rare events' },
    { id: 'audio', label: 'Audio' },
    { id: 'clock', label: 'Clock' },
    { id: 'screens', label: 'Monitors' },
    { id: 'advanced', label: 'Advanced' }
  ];

  // Ids are internal (kept stable so saved settings and codes keep working)
  var PRESETS = [
    { id: 'safira', label: 'Sapphire Night (Default)', values: {} },
    {
      id: 'ametista', label: 'Amethyst Nebula',
      values: {
        starcolor: '0.443 0.140 0.660', colormode: 'varied', colorvariance: 25,
        nebulaintensity: 0.85, nebulahue: 55, nebulascale: 1.4, nebulaseed: 23,
        audiohueamt: 40
      }
    },
    {
      id: 'aurora', label: 'Aurora Borealis',
      values: {
        starcolor: '0.120 0.680 0.540', colormode: 'varied', colorvariance: 40,
        nebulaintensity: 0.8, nebulahue: 115, nebulaseed: 42, nebulascale: 1.6, nebulaflow: 1.4,
        speed: 0.7, trail: 0.5
      }
    },
    {
      id: 'brasa', label: 'Solar Ember',
      values: {
        starcolor: '0.833 0.425 0.068', colormode: 'varied', colorvariance: 18,
        nebulaintensity: 0.75, nebulahue: -25, nebulaseed: 64, trail: 0.6,
        audiohueamt: 20
      }
    },
    {
      id: 'vialactea', label: 'True Milky Way',
      values: {
        starcolor: '0.240 0.347 0.560', colormode: 'spectrum', starcount: 2200, starsize: 0.85,
        twinklestrength: 1.5, nebulaintensity: 0.5, nebulahue: 25, nebulaseed: 11, nebulascale: 1.8,
        audiohue: false
      }
    },
    {
      id: 'neon', label: 'Neon Pulsar',
      values: {
        starcolor: '0.810 0.090 0.810', colormode: 'rainbow', rainbowspeed: 30,
        speed: 2.2, trail: 0.35, nebulaintensity: 0.9, nebulahue: -120, nebulaseed: 88, nebulaflow: 1.8,
        audiobassamt: 1.2, audiospeedamt: 4, audiohueamt: 90, audionebulaamt: 1.6,
        wavestrength: 1.6, shootingfreq: 20, lightningamt: 1.8
      }
    },
    {
      id: 'zen', label: 'Deep Zen',
      values: {
        starcolor: '0.209 0.437 0.551', starcount: 700, speed: 0.35, trail: 0.12,
        twinklestrength: 0.5, nebulaintensity: 0.45, nebulaspeed: 0.4, nebulaflow: 0.5, nebulahue: 30, nebulaseed: 5,
        audiobassamt: 0.25, audioshrinksize: 0.7, audiospeedamt: 0.6, audiofreqamt: 0.5, audiohue: false, audionebulaamt: 0.4,
        wavestrength: 0.5, wavespeed: 0.6, wavedrag: 0.6, shootingfreq: 2, shootingbeat: false,
        lightning: false, hyperspace: false
      }
    },
    {
      id: 'horizonte', label: 'Event Horizon',
      values: {
        starcolor: '0.950 0.620 0.050', colormode: 'varied', colorvariance: 20,
        starcount: 2600, starsize: 0.75, speed: 3, trail: 0.5,
        nebulaintensity: 1.1, nebulahue: -35, nebulaseed: 31, nebulascale: 1.1, nebulaflow: 1.5,
        custombg: true, bgcolor: '0.008 0.006 0.012', audiospeedamt: 3,
        wavestrength: 2, wavedrag: 2, lightningamt: 1.3, holestrength: 1.6
      }
    }
  ];

  var CLOCK = ['clock'];
  var AUDIO = ['audioenabled'];

  var SCHEMA = [
    // General
    { key: 'language', group: 'general', label: 'Language (menu and date)', type: 'combo', def: 'auto', fx: 'lang',
      options: [['auto', 'Automatic']].concat(LANGUAGES.map(function (l) { return [l[0], l[1]]; })) },
    { key: 'fpslimit', group: 'general', label: 'Frame rate limit', type: 'combo', def: '0', we: false,
      options: [['0', 'Unlimited'], ['60', '60 FPS'], ['30', '30 FPS']] },

    // Theme
    { key: 'preset', group: 'theme', label: 'Theme', type: 'combo', def: 'safira',
      options: PRESETS.map(function (p) { return [p.id, p.label]; }) },

    // Stars
    { key: 'starcount', group: 'stars', label: 'Count (per screen)', type: 'slider', min: 200, max: 5000, step: 50, def: 1200, look: true, fx: 'layout', release: true },
    { key: 'starsize', group: 'stars', label: 'Size', type: 'slider', min: 0.2, max: 3, step: 0.05, def: 1, look: true },
    { key: 'twinkle', group: 'stars', label: 'Twinkle', type: 'bool', def: true, look: true },
    { key: 'twinklestrength', group: 'stars', label: 'Twinkle strength', type: 'slider', min: 0.1, max: 5, step: 0.1, def: 1, look: true, cond: ['twinkle'] },

    // Colors
    { key: 'colormode', group: 'color', label: 'Color mode', type: 'combo', def: 'single', look: true,
      options: [
        ['single', 'Single color'],
        ['varied', 'Soft variation'],
        ['spectrum', 'Real stars (spectrum)'],
        ['rainbow', 'Rainbow by orbit']
      ] },
    { key: 'starcolor', group: 'color', label: 'Main color', type: 'color', def: '0.129 0.283 0.531', look: true, fx: 'color' },
    { key: 'colorvariance', group: 'color', label: 'Hue variation (°)', type: 'slider', min: 0, max: 120, step: 1, def: 30, look: true, cond: [{ k: 'colormode', eq: 'varied' }] },
    { key: 'rainbowspeed', group: 'color', label: 'Rainbow spin (°/s)', type: 'slider', min: 0, max: 90, step: 1, def: 12, look: true, cond: [{ k: 'colormode', eq: 'rainbow' }] },
    { key: 'custombg', group: 'color', label: 'Custom background', type: 'bool', def: false, look: true },
    { key: 'bgcolor', group: 'color', label: 'Background color', type: 'color', def: '0.022 0.051 0.098', look: true, cond: ['custombg'] },
    { key: 'mediacolors', group: 'color', label: 'Colors from the album cover (Wallpaper Engine)', type: 'bool', def: true },

    // Nebula
    { key: 'nebula', group: 'nebula', label: 'Nebula', type: 'bool', def: true, look: true },
    { key: 'nebulaintensity', group: 'nebula', label: 'Intensity', type: 'slider', min: 0.05, max: 2, step: 0.05, def: 0.6, look: true, cond: ['nebula'] },
    { key: 'nebulahue', group: 'nebula', label: 'Secondary hue (°)', type: 'slider', min: -180, max: 180, step: 1, def: 40, look: true, cond: ['nebula'] },
    { key: 'nebulascale', group: 'nebula', label: 'Cloud size', type: 'slider', min: 1, max: 3, step: 0.05, def: 1.2, look: true, cond: ['nebula'] },
    { key: 'nebulaseed', group: 'nebula', label: 'Shape (seed)', type: 'slider', min: 1, max: 99, step: 1, def: 7, look: true, release: true, cond: ['nebula'] },
    { key: 'nebulaspeed', group: 'nebula', label: 'Rotation', type: 'slider', min: 0, max: 3, step: 0.05, def: 1, look: true, cond: ['nebula'] },
    { key: 'nebulaflow', group: 'nebula', label: 'Fluidity (gas motion)', type: 'slider', min: 0, max: 3, step: 0.05, def: 1, look: true, cond: ['nebula'] },
    { key: 'nebulacore', group: 'nebula', label: 'Bright core', type: 'bool', def: true, look: true, cond: ['nebula'] },
    { key: 'nebulaquality', group: 'nebula', label: 'Nebula quality', type: 'combo', def: 'medium', cond: ['nebula'],
      options: [['low', 'Light'], ['medium', 'Normal'], ['high', 'High']] },

    // Motion
    { key: 'speed', group: 'motion', label: 'Rotation speed', type: 'slider', min: 0, max: 10, step: 0.1, def: 1, look: true },
    { key: 'clockwise', group: 'motion', label: 'Clockwise', type: 'bool', def: false, look: true },
    { key: 'trail', group: 'motion', label: 'Trail fade (lower = longer)', type: 'slider', min: 0.02, max: 1, step: 0.01, def: 0.8, look: true },
    { key: 'centerx', group: 'motion', label: 'Center X (%)', type: 'slider', min: 0, max: 100, step: 1, def: 50, fx: 'layout', release: true },
    { key: 'centery', group: 'motion', label: 'Center Y (%)', type: 'slider', min: 0, max: 100, step: 1, def: 50, fx: 'layout', release: true },

    // Mouse
    { key: 'parallax', group: 'interact', label: 'Mouse parallax', type: 'bool', def: true },
    { key: 'parallaxamt', group: 'interact', label: 'Parallax strength', type: 'slider', min: 0.1, max: 3, step: 0.05, def: 1, cond: ['parallax'] },
    { key: 'waveclick', group: 'interact', label: 'Click: gravitational wave', type: 'bool', def: true },
    { key: 'holedrag', group: 'interact', label: 'Click and hold/drag: black hole', type: 'bool', def: true },
    { key: 'holestrength', group: 'interact', label: 'Black hole strength', type: 'slider', min: 0.3, max: 3, step: 0.05, def: 1, look: true, cond: ['holedrag'] },
    { key: 'holeplanets', group: 'interact', label: 'Black hole draws in extra planets', type: 'bool', def: true, cond: ['holedrag'] },
    { key: 'holejets', group: 'interact', label: 'Relativistic jets when eating gas giants', type: 'bool', def: true, cond: ['holedrag'] },

    // Gravitational wave
    { key: 'wavebeat', group: 'wave', label: 'Trigger on bass beats', type: 'bool', def: true },
    { key: 'wavestrength', group: 'wave', label: 'Strength', type: 'slider', min: 0, max: 3, step: 0.05, def: 1, look: true },
    { key: 'wavespeed', group: 'wave', label: 'Speed', type: 'slider', min: 0.3, max: 3, step: 0.05, def: 1, look: true },
    { key: 'wavedrag', group: 'wave', label: 'Star weight (bends the front)', type: 'slider', min: 0, max: 3, step: 0.05, def: 1, look: true },
    { key: 'wavelens', group: 'wave', label: 'Space distortion (gravitational lens)', type: 'bool', def: true, look: true },

    // Shooting stars
    { key: 'shootingstars', group: 'shooting', label: 'Shooting stars', type: 'bool', def: true, look: true },
    { key: 'shootingfreq', group: 'shooting', label: 'Per minute', type: 'slider', min: 1, max: 60, step: 1, def: 6, look: true, cond: ['shootingstars'] },
    { key: 'shootingbeat', group: 'shooting', label: 'Also on bass beats', type: 'bool', def: true, look: true, cond: ['shootingstars'] },

    // Planets
    { key: 'planets', group: 'planets', label: 'Planets passing by', type: 'bool', def: true, look: true },
    { key: 'planetfreq', group: 'planets', label: 'Planets per minute', type: 'slider', min: 0.5, max: 12, step: 0.5, def: 3, look: true, cond: ['planets'] },

    // Rare events
    { key: 'events', group: 'events', label: 'Supernovas, comets and other rare events', type: 'bool', def: true },
    { key: 'eventsfreq', group: 'events', label: 'Minutes between events (average)', type: 'slider', min: 1, max: 30, step: 1, def: 6, cond: ['events'] },

    // Audio
    { key: 'audioenabled', group: 'audio', label: 'React to audio', type: 'bool', def: true },
    { key: 'audiosensitivity', group: 'audio', label: 'Overall sensitivity', type: 'slider', min: 0.1, max: 3, step: 0.05, def: 1, cond: AUDIO },
    { key: 'lightning', group: 'audio', label: 'Chain lightning between stars (bass)', type: 'bool', def: true, look: true, cond: AUDIO },
    { key: 'lightningamt', group: 'audio', label: 'Lightning intensity', type: 'slider', min: 0.2, max: 3, step: 0.05, def: 1, look: true, cond: ['audioenabled', 'lightning'] },
    { key: 'lightningsparks', group: 'audio', label: 'Sparks on treble hits', type: 'bool', def: true, look: true, cond: ['audioenabled', 'lightning'] },
    { key: 'audiobass', group: 'audio', label: 'Pulse with the bass', type: 'bool', def: true, look: true, cond: AUDIO },
    { key: 'audiobassamt', group: 'audio', label: 'Pulse strength', type: 'slider', min: 0, max: 3, step: 0.05, def: 0.75, look: true, cond: ['audioenabled', 'audiobass'] },
    { key: 'audioshrink', group: 'audio', label: 'Smaller stars while music plays', type: 'bool', def: true, look: true, cond: AUDIO },
    { key: 'audioshrinksize', group: 'audio', label: 'Star size while music plays', type: 'slider', min: 0.1, max: 1, step: 0.05, def: 0.3, look: true, cond: ['audioenabled', 'audioshrink'] },
    { key: 'hyperspace', group: 'audio', label: 'Hyperspace jump on the drop', type: 'bool', def: true, look: true, cond: AUDIO },
    { key: 'audiospeed', group: 'audio', label: 'Speed up with volume', type: 'bool', def: true, look: true, cond: AUDIO },
    { key: 'audiospeedamt', group: 'audio', label: 'Speed-up strength', type: 'slider', min: 0, max: 10, step: 0.1, def: 2, look: true, cond: ['audioenabled', 'audiospeed'] },
    { key: 'audiofreq', group: 'audio', label: 'Spectrum by radius (center = bass, edge = treble)', type: 'bool', def: true, look: true, cond: AUDIO },
    { key: 'audiofreqamt', group: 'audio', label: 'Spectrum strength', type: 'slider', min: 0, max: 3, step: 0.05, def: 1, look: true, cond: ['audioenabled', 'audiofreq'] },
    { key: 'audiohue', group: 'audio', label: 'Shift color with audio', type: 'bool', def: true, look: true, cond: AUDIO },
    { key: 'audiohueamt', group: 'audio', label: 'Color shift (°)', type: 'slider', min: 0, max: 180, step: 1, def: 30, look: true, cond: ['audioenabled', 'audiohue'] },
    { key: 'audionebula', group: 'audio', label: 'Nebula pulses with the bass', type: 'bool', def: true, look: true, cond: AUDIO },
    { key: 'audionebulaamt', group: 'audio', label: 'Nebula strength', type: 'slider', min: 0, max: 3, step: 0.05, def: 1, look: true, cond: ['audioenabled', 'audionebula'] },
    { key: 'pauseonsilence', group: 'audio', label: 'Pause on silence', type: 'bool', def: false, cond: AUDIO },

    // Clock
    { key: 'clock', group: 'clock', label: 'Show clock', type: 'bool', def: false, fx: 'clock' },
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
    { key: 'clockfont', group: 'clock', label: 'Font', type: 'combo', def: 'segoe', fx: 'clock', cond: CLOCK,
      options: [
        ['segoe', 'Modern'],
        ['bahnschrift', 'Futuristic'],
        ['consolas', 'Monospace'],
        ['georgia', 'Classic']
      ] },
    { key: 'clocksize', group: 'clock', label: 'Size', type: 'slider', min: 0.4, max: 3, step: 0.05, def: 1, fx: 'clock', cond: CLOCK },
    { key: 'clockopacity', group: 'clock', label: 'Opacity', type: 'slider', min: 0.1, max: 1, step: 0.05, def: 0.85, fx: 'clock', cond: CLOCK },
    { key: 'clockcolor', group: 'clock', label: 'Color', type: 'color', def: '0.920 0.945 1.000', fx: 'clock', cond: CLOCK },
    { key: 'clockglow', group: 'clock', label: 'Glow', type: 'bool', def: true, fx: 'clock', cond: CLOCK },
    { key: 'clockpulse', group: 'clock', label: 'Pulse with the bass', type: 'bool', def: false, cond: CLOCK },
    { key: 'clockscreen', group: 'clock', label: 'Clock screen', type: 'slider', min: 1, max: 4, step: 1, def: 1, fx: 'clock', cond: ['clock', { k: 'screens', ne: '1' }] },

    // Monitors
    { key: 'screens', group: 'screens', label: 'Galaxies (spanned across monitors)', type: 'combo', def: '1', fx: 'layout',
      options: [
        ['1', 'Single galaxy'],
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

  var CODE_PREFIX = 'STARRY1:';

  function encode(values) {
    return CODE_PREFIX + btoa(unescape(encodeURIComponent(JSON.stringify(values))));
  }

  // Accepts a STARRY1:… code or plain JSON. Returns null when invalid.
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
  else (window.Starry = window.Starry || {}).settings = api;
})();
