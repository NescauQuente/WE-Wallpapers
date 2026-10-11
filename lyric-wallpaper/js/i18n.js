/*
 * Lyric Stage — internationalization.
 *
 * English is built in: the UI strings below and the setting labels in
 * settings.js. Every other language is a dictionary in js/lang/<code>.js that
 * registers itself with Lyric.i18n.add(code, { key: text }). Missing keys fall
 * back along the chain (pt-pt → pt → English), so a dictionary can be partial.
 *
 * Automatic language: the language Wallpaper Engine reports, then the
 * browser's; anything unrecognized falls back to English.
 *
 * The lyrics themselves are never translated: they show as the song has them.
 */
(function (S) {
  'use strict';

  var MESSAGES = {
    'menu.title': 'Settings',
    'menu.reset': 'Defaults',
    'menu.resetTitle': 'Restore every default value',
    'menu.close': 'Close (Esc)',
    'menu.custom': 'Custom',
    'menu.hint': 'M toggles this menu · Esc closes',

    'toast.open': 'Press M to open the settings',
    'toast.reset': 'Default values restored',
    'toast.imported': 'Settings imported',

    'audio.mic': 'Microphone',
    'audio.micTitle': 'Use the microphone',
    'audio.display': 'Tab or screen',
    'audio.displayTitle': 'Capture audio from a tab or the system (check "Share audio")',
    'audio.stop': 'Stop',
    'audio.stopTitle': 'Stop capturing audio',
    'audio.meterTitle': 'Incoming audio spectrum',
    'audio.waiting': 'Waiting for permission…',
    'audio.denied': 'Permission denied.',
    'audio.noAudio': 'No audio was shared. Check "Share audio" when picking the tab or screen.',
    'audio.noMic': 'No microphone found.',
    'audio.unsupported': 'This browser cannot capture audio here.',
    'audio.failed': 'Could not capture audio.',
    'audio.listeningMic': 'Listening to the microphone.',
    'audio.listeningDisplay': 'Listening to the shared tab or screen.',
    'audio.none': 'No source. Pick one to make the audio react.',

    'share.title': 'Share settings',
    'share.export': 'Export code',
    'share.exportTitle': 'Generate a code with the current settings',
    'share.import': 'Import code',
    'share.importTitle': 'Apply a settings code',
    'share.apply': 'Apply',
    'share.applyTitle': 'Apply the pasted code',
    'share.close': 'Close',
    'share.placeholder': 'Paste the LYRIC1:… code here',
    'share.copied': 'Copied! It also works in the "Import code" field in Wallpaper Engine.',
    'share.copyManual': 'Select and copy the code above.',
    'share.pasteHint': 'Paste the code and click Apply.',
    'share.invalid': 'Invalid code.',

    'lyrics.searching': 'Looking for the lyrics…',
    'lyrics.notFound': 'No lyrics found for this song',
    'lyrics.instrumental': 'Instrumental',
    'lyrics.plain': 'Lyrics without timing: following the song approximately',
    'lyrics.error': 'Could not reach the lyrics service',
    'lyrics.estimated': 'This player does not report the song position: timing counted from the start of the song',

    'show.noMedia': 'No song info: turn on "Media integration" in the Wallpaper Engine settings'
  };

  var LANGS = {};   // code → { name, locale, we }
  S.settings.LANGUAGES.forEach(function (l) { LANGS[l[0]] = { name: l[1], locale: l[2], we: l[3] }; });

  var FALLBACK = { 'pt-pt': 'pt' };
  var RTL = { ar: true };
  var dicts = {};
  var lang = 'en';

  function add(code, dict) {
    var d = dicts[code] || (dicts[code] = {});
    Object.keys(dict).forEach(function (k) { d[k] = dict[k]; });
  }

  // Any spelling of a language → a supported code: 'pt-BR', 'pt_br', 'zh-chs',
  // 'zh-Hant-TW', 'nb-NO', 'no_no', 'Portuguese'… Unknown → 'en'.
  function normalize(code) {
    var c = String(code || '').trim().toLowerCase().replace(/_/g, '-');
    if (/^portug/.test(c)) return 'pt';
    if (LANGS[c]) return c;
    var base = c.split('-')[0];
    if (base === 'zh') return /-(tw|hk|mo|hant|cht)\b/.test(c) ? 'zh-tw' : 'zh-cn';
    if (base === 'pt') return /-pt\b/.test(c) ? 'pt-pt' : 'pt';
    if (base === 'nb' || base === 'nn') return 'no';
    return LANGS[base] ? base : 'en';
  }

  function detect(hint) {
    if (hint) return normalize(hint);
    var list = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language];
    return normalize(list[0]);
  }

  // setting: 'auto' or a language code
  function resolve(setting, hint) {
    return LANGS[setting] ? setting : detect(hint);
  }

  function setLang(code) {
    lang = LANGS[code] ? code : 'en';
    // Right-to-left only applies to the menu, the toasts and the stage
    // messages (they set dir on themselves); each lyric line picks its own
    // direction from its text (dir="auto")
    document.documentElement.lang = locale();
  }

  // The text for key in the current language; en is the English text for keys
  // that are not UI messages (setting labels)
  function t(key, en) {
    for (var c = lang; c; c = FALLBACK[c]) {
      var d = dicts[c];
      if (d && d[key] !== undefined) return d[key];
    }
    if (en !== undefined) return en;
    return MESSAGES[key] !== undefined ? MESSAGES[key] : key;
  }

  function locale() { return LANGS[lang].locale; }
  function dir() { return RTL[lang] ? 'rtl' : 'ltr'; }

  S.i18n = {
    MESSAGES: MESSAGES,
    add: add,
    t: t,
    resolve: resolve,
    detect: detect,
    setLang: setLang,
    locale: locale,
    dir: dir,
    lang: function () { return lang; },
    dicts: function () { return dicts; }
  };
})(window.Lyric = window.Lyric || {});
