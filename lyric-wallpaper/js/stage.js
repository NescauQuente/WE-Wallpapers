/*
 * Lyric Stage — the stage: the lyrics, line by line, and the song card, as
 * HTML over the background (crisp text, cheap motion). Styles in
 * css/stage.css.
 *
 * main.js calls update(dt, s) every frame with the song position and the
 * lyrics found. The DOM is only touched when something changes (a new line, a
 * word, a message); per frame only the current line's progress (the CSS
 * variable --p) and its bass pulse (a transform) are written.
 *
 * The synced lines are a small pool of elements. Each holds an item: a lyric
 * line or a pause ("♪ ♪ ♪"), and has a role: the current item, the line
 * before it (above), the line after it (below) or leaving. A new line only
 * changes roles, transforms and classes; the CSS transitions animate it. A
 * line is measured once when it comes in: long ones wrap to two rows at most
 * and shrink to fit. Each line takes its direction from its text
 * (dir="auto"), so Arabic and Hebrew lyrics read right to left.
 *
 * The song card is big in the middle for the first seconds of a song (and
 * while there are no lyrics to show), then small in the bottom left corner.
 * It makes way early when the singing starts sooner (or is already under way
 * when the show comes in): the lyrics are never hidden behind it.
 *
 * API: init(root), apply(cfg), update(dt, s), state() (for tests).
 */
(function (S) {
  'use strict';

  var CARD_TIME = 5;        // s: the big song card at the start of a song
  var CARD_LEAD = 1.2;      // s: it makes way this long before the first line
  var GAP_MIN = 6;          // s: a pause this long after a line is sung shows "♪ ♪ ♪"
  var HOLD = 1.5;           // s: a sung line stays this long before the pause takes over
  var INTRO_MIN = 3;        // s: an intro (or an empty line) this long shows "♪ ♪ ♪"
  var OUTRO_MIN = 4;        // s: the same after the last line
  var MSG_TIME = 8;         // s: how long a message (not found, error…) stays
  var SEARCH_AFTER = 0.6;   // s: "Looking for the lyrics…" only for slow lookups
  var ESTIMATED_AFTER = 4;  // s: no position reported this long → say timing is estimated
  var NO_MEDIA_AFTER = 3;   // s: no song info this long → say how to turn it on
  var OUT_TIME = 0.9;       // s: a line that left is recycled after its transition
  var POOL_MAX = 9;         // line elements; past this a fast seek reuses the oldest leaving one
  var MAX_ROWS = 2;
  var MIN_PX = 2.6;         // a long line shrinks down to about this, in --ls-u (1 % of the height)…
  var MIN_FIT = 0.2;        // …but always may to this share of its size (a big size setting)…
  var MAX_MIN_FIT = 0.5;    // …and always may to half of it (a small size setting)
  var SIDE = 0.6;           // scale of the previous and next lines…
  var SIDE_REL = 0.8;       // …and never more than this of the current one (a shrunk long line)
  var PULSE = 0.02;         // the bass pulse of the current line (2 %)
  var KICK = 0.045;         // the beat kick of the current line ('lyricbeat')
  var CHORUS_SCALE = 1.07;  // a chorus line ('chorus') is this much bigger

  // Item ids: line i → 2i + 2; the pause after line i → 2i + 3 (the intro,
  // before line 0, is 1); NONE = nothing current; WHOLE = the whole song is
  // instrumental. Ids grow with time, so a smaller one means a seek back.
  var NONE = 0, WHOLE = -2, NO_ITEM = -99;

  // Windows fonts first. lh = line height, title = weight of the card title
  var FONTS = {
    segoe: { family: '"Segoe UI Variable Display", "Segoe UI", system-ui, -apple-system, sans-serif', weight: 600, title: 700, spacing: '-0.01em', lh: 1.14, upper: false },
    bahnschrift: { family: 'Bahnschrift, "DIN Alternate", "Segoe UI", sans-serif', weight: 600, title: 700, spacing: '0.01em', lh: 1.12, upper: false },
    georgia: { family: 'Georgia, "Times New Roman", serif', weight: 400, title: 700, spacing: '0', lh: 1.16, upper: false },
    impact: { family: 'Impact, "Arial Black", Haettenschweiler, sans-serif', weight: 400, title: 400, spacing: '0.02em', lh: 1.06, upper: true },
    consolas: { family: 'Consolas, "Cascadia Mono", "Courier New", monospace', weight: 400, title: 700, spacing: '0', lh: 1.16, upper: false }
  };

  // Chinese and Japanese have no spaces: each character is a "word"
  var SPLIT = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]\s*|[^\s\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+\s*/g;
  // Right-to-left letters (Hebrew, Arabic…): the words of a line with them
  // stay inline, so the browser orders a mixed line right
  var BIDI = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/;

  var cfg = {
    lyricfont: 'segoe', lyricsize: 1, lyricpos: 'center', lyricanim: 'karaoke',
    lyriccontext: true, glowtext: true, songcard: 'corner', showcover: true,
    chorus: true, lyricbeat: true, progress: true, coverstyle: 'square', sidecard: true
  };
  var font = FONTS.segoe;
  var applied = null;        // what the last apply() set: { key: value, …, lang }
  var LAYOUT_KEYS = ['lyricfont', 'lyricsize', 'lyricpos', 'lyriccontext', 'lyricanim'];

  var root = null, wrap, box, plainBox, plainText, statusEl;
  var hero, heroCover, heroTitle, heroArtist, heroStatus;
  var corner, cornerCover, cornerTitle, cornerArtist;
  var progBox, progFill, progTime, progSet = -1, progSec = -1, progOn = false;
  var kick = 0, playing = true;
  // A wallpaper spanned across monitors: the stage on one screen, a "now
  // playing" panel on each of the others
  var sides = [], sideOn = false, sideSet = -1;
  var cctx = null;           // a 2D context that normalizes CSS colors

  // The song
  var now = 0, visible = false, opacity = -1;
  var track, title = '', artist = '', cover = null, cardTime = 0;
  var textColor = null, accentColor = null;
  var tRGB = [-1, -1, -1], aRGB = [-1, -1, -1];   // the colors set, 0–255

  // Synced lines. tailId/pauseFrom: what shows at the end of each line (its
  // own id, or the pause under way and when it started), so a pause runs on
  // across the empty lines after it
  var lines = null, firstText = -1, prevText = null, nextText = null, gapAt = null;
  var tailId = null, pauseFrom = null;
  var pool = [];             // { el, inEl, tx, fill, span, pEl, id, role, gap, line, tok, … }
  var cur = null, prev = null, next = null, curId = NO_ITEM, baseIdx = -1;
  var gapStart = 0, gapEnd = 1;
  var fontPx = 40, boxW = 800, minFit = 0.4, dirty = true, rebuild = false;
  var pulse = 0, pulseSet = 1, coverSet = 1;
  var timingSing = 0;        // second result of timing()
  var ROLES = ['prev', 'cur', 'next'], slots = [null, null, null], ys = [0, 0, 0], scs = [1, 1, 1];

  // Lyrics without timing
  var plain = null, plainEls = [], plainMid = [], plainH = 0, plainView = 0, plainY = NaN, plainHot = -1;

  // What shows
  var heroOn = false, cornerOn = false, lyricsOn = false, plainOn = false;
  var status = '', statusAge = 0, msgKey = null, msgAt = '', noMedia = 0;

  function el(tag, cls, parent) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  }

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  function smooth(a, b, x) {
    var t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  }

  function t(key) {
    return S.i18n && S.i18n.t ? S.i18n.t(key) : key;
  }

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------

  function init(r) {
    if (wrap) return;        // built once
    root = r || document.getElementById('ls-stage');
    root.setAttribute('aria-hidden', 'true');
    wrap = el('div', 'ls-wrap ls-off', root);
    wrap.style.opacity = '0';

    box = el('div', 'ls-lyrics', wrap);
    plainBox = el('div', 'ls-plain', wrap);
    plainText = el('div', 'ls-plain-text', plainBox);

    hero = el('div', 'ls-hero', wrap);
    heroCover = el('img', 'ls-hero-cover', hero);
    heroTitle = el('div', 'ls-hero-title', hero);
    heroArtist = el('div', 'ls-hero-artist', hero);
    heroStatus = el('div', 'ls-hero-status', hero);

    corner = el('div', 'ls-corner', wrap);
    cornerCover = el('img', 'ls-corner-cover', corner);
    var text = el('div', 'ls-corner-text', corner);
    cornerTitle = el('div', 'ls-corner-title', text);
    cornerArtist = el('div', 'ls-corner-artist', text);
    // How far into the song: a thin bar and the time
    progBox = el('div', 'ls-prog', text);
    progFill = el('div', 'ls-prog-fill', el('div', 'ls-prog-bar', progBox));
    progTime = el('div', 'ls-prog-time', progBox);
    [heroTitle, heroArtist, cornerTitle, cornerArtist].forEach(function (e) { e.dir = 'auto'; });
    heroCover.alt = cornerCover.alt = '';
    heroCover.onerror = function () { if (cover) wrap.classList.add('ls-nocover'); };

    statusEl = el('div', 'ls-status', wrap);

    try { cctx = document.createElement('canvas').getContext('2d'); } catch (e) { cctx = null; }
    window.addEventListener('resize', function () { dirty = true; });
    // A font that loads late changes the widths: measure again
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { dirty = true; });
    apply(cfg);
    colors('#ffffff', '#a9c1ff');
  }

  // c = typed settings: lyricfont, lyricsize, lyricpos, lyricanim,
  // lyriccontext, glowtext, songcard, showcover. Also call it after a
  // language change (it refreshes the messages). Only what changed is redone:
  // main may call it on any setting change, and rebuilding the lines would
  // restart their animations
  function apply(c) {
    Object.keys(cfg).forEach(function (k) { if (c && c[k] !== undefined) cfg[k] = c[k]; });
    if (!/^(karaoke|words|fade|blur|typewriter)$/.test(cfg.lyricanim)) cfg.lyricanim = 'karaoke';
    if (!/^(center|lower|left)$/.test(cfg.lyricpos)) cfg.lyricpos = 'center';
    if (!wrap) return;
    var lang = S.i18n && S.i18n.lang ? S.i18n.lang() : '', was = applied;
    applied = { lang: lang };
    Object.keys(cfg).forEach(function (k) { applied[k] = cfg[k]; });
    if (!was || was.lang !== lang || was.lyricanim !== cfg.lyricanim || was.chorus !== cfg.chorus) rebuild = true;   // the line contents
    if (rebuild || LAYOUT_KEYS.some(function (k) { return was[k] !== cfg[k]; })) dirty = true;   // measure again
    if (!was || was.showcover !== cfg.showcover) cover = null;
    if (!was || was.lang !== lang) msgKey = null;

    font = FONTS[cfg.lyricfont] || FONTS.segoe;
    var st = wrap.style;
    st.setProperty('--ls-font', font.family);
    st.setProperty('--ls-weight', font.weight);
    st.setProperty('--ls-title-weight', font.title);
    st.setProperty('--ls-spacing', font.spacing);
    st.setProperty('--ls-lh', font.lh);
    st.setProperty('--ls-case', font.upper ? 'uppercase' : 'none');
    st.setProperty('--ls-size', Math.min(2, Math.max(0.5, +cfg.lyricsize || 1)));
    wrap.dataset.pos = cfg.lyricpos;
    wrap.dataset.anim = cfg.lyricanim;
    wrap.dataset.font = cfg.lyricfont;
    wrap.dataset.cover = cfg.coverstyle === 'vinyl' ? 'vinyl' : 'square';
    wrap.classList.toggle('ls-ctx', !!cfg.lyriccontext);
    wrap.classList.toggle('ls-glowing', !!cfg.glowtext);
  }

  // A CSS color (or [r, g, b] from 0 to 1) → out as 0–255 integers; fb when
  // it cannot be read. Returns true when out changed
  function rgbInto(c, out, fb) {
    var r = fb[0], g = fb[1], b = fb[2];
    if (c && typeof c === 'object' && c.length >= 3) {
      r = c[0] * 255;
      g = c[1] * 255;
      b = c[2] * 255;
    } else if (c && cctx) {
      cctx.fillStyle = '#010203';
      cctx.fillStyle = String(c);
      var v = cctx.fillStyle, m;
      if (v.charAt(0) === '#') {
        if (v !== '#010203' || c === '#010203') {
          r = parseInt(v.substr(1, 2), 16);
          g = parseInt(v.substr(3, 2), 16);
          b = parseInt(v.substr(5, 2), 16);
        }
      } else if ((m = v.match(/[\d.]+/g)) && m.length >= 3) {
        r = +m[0];
        g = +m[1];
        b = +m[2];
      }
    }
    r = Math.round(Math.min(255, Math.max(0, r)) || 0);
    g = Math.round(Math.min(255, Math.max(0, g)) || 0);
    b = Math.round(Math.min(255, Math.max(0, b)) || 0);
    if (r === out[0] && g === out[1] && b === out[2]) return false;
    out[0] = r;
    out[1] = g;
    out[2] = b;
    return true;
  }

  function rgba(c, a) {
    return 'rgba(' + c[0] + ', ' + c[1] + ', ' + c[2] + ', ' + a + ')';
  }

  var WHITE = [255, 255, 255], ACCENT = [169, 193, 255];

  // The color variables. Strings are compared as they come; arrays (which
  // main may ease in place) by their values. The variables are only written
  // when a color really changed: they restyle the whole stage
  function colors(text, accent) {
    var arrays = typeof text === 'object' || typeof accent === 'object';
    if (!arrays && text === textColor && accent === accentColor) return;
    textColor = text;
    accentColor = accent;
    var st = wrap.style;
    if (rgbInto(text, tRGB, WHITE)) {
      st.setProperty('--ls-text', rgba(tRGB, 1));
      st.setProperty('--ls-dim', rgba(tRGB, 0.45));
    }
    if (rgbInto(accent, aRGB, ACCENT)) {
      st.setProperty('--ls-accent', rgba(aRGB, 1));
      st.setProperty('--ls-glow', rgba(aRGB, 0.5));
      st.setProperty('--ls-glow-soft', rgba(aRGB, 0.22));
      st.setProperty('--ls-halo', rgba(aRGB, 0.28));
    }
  }

  // ---------------------------------------------------------------------------
  // Line timing
  // ---------------------------------------------------------------------------

  // Characters that take time to sing: a Chinese or Japanese character (or a
  // Korean syllable) counts as about three letters
  function weight(text) {
    var n = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c <= 32 || c === 160) continue;
      if ((c >= 0x3040 && c <= 0x30ff) || (c >= 0x3400 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff)) n += 3;
      else if (c >= 0xac00 && c <= 0xd7af) n += 2.5;
      else n += 1;
    }
    return n;
  }

  // When the line is fully sung (s, song time). Word stamps say it; without
  // them it is estimated from the length of the line, never later than the
  // next line. timingSing = how long the singing takes (for the pauses)
  function timing(line) {
    var span = line.end - line.t, w = line.words;
    if (w && w.length) {
      var last = w[w.length - 1];
      var endT = Math.min(line.end, last.t + Math.min(1.2, Math.max(0.3, weight(last.text) * 0.08 + 0.25)));
      timingSing = Math.max(0.3, endT - line.t);
      return endT;
    }
    var sing = Math.min(10, Math.max(1, 0.6 + weight(line.text) * 0.075));
    timingSing = sing;
    return line.t + Math.max(Math.min(0.5, span), Math.min(span * 0.9, sing * 1.5));
  }

  // New lyrics: where the text lines and the pauses are
  function setLines(list) {
    lines = list && list.length ? list : null;
    firstText = -1;
    prevText = nextText = gapAt = tailId = pauseFrom = null;
    clearItems();
    if (!lines) return;
    var n = lines.length, i, last = -1;
    prevText = new Int32Array(n);
    nextText = new Int32Array(n);
    gapAt = new Float64Array(n);
    tailId = new Int32Array(n);
    pauseFrom = new Float64Array(n);
    for (i = 0; i < n; i++) {
      prevText[i] = last;
      if (lines[i].text) last = i;
      gapAt[i] = Infinity;
      if (!lines[i].text) continue;
      var endT = timing(lines[i]);
      if (lines[i].end - lines[i].t - timingSing >= GAP_MIN) {
        gapAt[i] = Math.max(endT, lines[i].t + timingSing) + HOLD;
      }
    }
    for (i = n - 1, last = -1; i >= 0; i--) {
      nextText[i] = last;
      if (lines[i].text) last = i;
    }
    firstText = last;
    // What shows at the end of each line. An empty line goes on with a pause
    // already under way (the same "♪ ♪ ♪", not a new one), starts one when it
    // is long, and otherwise keeps the line before
    var id = firstText >= 0 && lines[firstText].t >= INTRO_MIN ? 1 : NONE, from = 0;
    for (i = 0; i < n; i++) {
      var ln = lines[i];
      if (ln.text) {
        id = gapAt[i] < ln.end ? 2 * i + 3 : 2 * i + 2;
        from = gapAt[i];
      } else if (!(id & 1) && (i === n - 1 || ln.end - ln.t >= INTRO_MIN)) {
        id = 2 * i + 3;
        from = ln.t;
      }
      tailId[i] = id;
      pauseFrom[i] = from;
    }
  }

  // The index of the line being sung at pos (−1 before the first)
  function lineAt(pos) {
    var lo = 0, hi = lines.length - 1, found = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (lines[mid].t <= pos) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  }

  // The item to show at pos (see the ids above); for a pause it also sets
  // gapStart and gapEnd. duration = the song's (0 = unknown)
  function itemAt(pos, duration) {
    var i = lineAt(pos), n = lines.length;
    baseIdx = i;
    if (i < 0) {
      if (firstText >= 0 && lines[firstText].t >= INTRO_MIN) {
        gapStart = 0;
        gapEnd = lines[firstText].t;
        return 1;
      }
      return NONE;
    }
    var ln = lines[i], id;
    var songEnd = duration > ln.end ? duration : ln.end + 60;
    if (ln.text) {
      if (pos < gapAt[i]) {
        // After the last line: the outro
        if (i === n - 1 && pos >= ln.end && (duration <= 0 || duration - ln.end >= OUTRO_MIN)) {
          gapStart = ln.end;
          gapEnd = songEnd;
          return 2 * i + 3;
        }
        return 2 * i + 2;
      }
      id = 2 * i + 3;
      gapStart = gapAt[i];
    } else {
      // An empty line: the pause under way, or the line before (see setLines)
      id = tailId[i];
      if (!(id & 1)) return id;
      gapStart = pauseFrom[i];
    }
    // A pause lasts until the next sung line (across empty ones)
    gapEnd = nextText[i] >= 0 ? lines[nextText[i]].t : songEnd;
    return id;
  }

  // ---------------------------------------------------------------------------
  // The pool of line elements
  // ---------------------------------------------------------------------------

  function makeRec() {
    var r = {
      el: el('div', 'ls-line', box), inEl: null, tx: null, fill: null, span: null, pEl: null,
      id: NO_ITEM, role: '', gap: false, rtl: false, bidi: false, line: null, tok: null, total: 0, endT: 0,
      h: 0, fit: 1, y: 0, sc: 1, p: -1, lit: -1, outAt: 0, fresh: false
    };
    r.el.dir = 'auto';
    r.el.hidden = true;
    r.inEl = el('div', 'ls-in', r.el);
    r.tx = el('div', 'ls-tx', r.inEl);
    r.fill = el('div', 'ls-fill', r.inEl);
    r.span = el('span', '', r.fill);
    pool.push(r);
    return r;
  }

  function findRec(id) {
    for (var i = 0; i < pool.length; i++) if (pool[i].role && pool[i].id === id) return pool[i];
    return null;
  }

  // The element that shows item id (an existing one, or a free one filled)
  function take(id) {
    if (id === NO_ITEM || id === NONE) return null;
    var r = findRec(id), i;
    if (r) return r;
    for (i = 0; i < pool.length && !r; i++) if (!pool[i].role) r = pool[i];
    if (!r && pool.length >= POOL_MAX) {
      // Seeking fast: the line that left first makes room
      for (i = 0; i < pool.length; i++) {
        if (pool[i].role === 'out' && (!r || pool[i].outAt < r.outAt)) r = pool[i];
      }
      if (r) recycle(r);
    }
    if (!r) r = makeRec();
    fill(r, id);
    return r;
  }

  // The words of a line with their times: the word stamps, or the line's
  // singing time spread over its characters
  function tokens(r, line) {
    var src = line.words && line.words.length ? line.words : null;
    var parts = src || line.text.match(SPLIT) || [line.text];
    var tok = [], total = 0, i;
    for (i = 0; i < parts.length; i++) {
      var raw = src ? parts[i].text : parts[i], word = raw.replace(/\s+$/, '');
      if (!word.trim()) continue;
      var n = Math.max(1, weight(word));
      tok.push({ t: src ? parts[i].t : 0, word: word, space: raw.slice(word.length), c0: total, c1: total + n, el: null });
      total += n;
    }
    var endT = timing(line);
    if (!src) {
      for (i = 0; i < tok.length; i++) tok[i].t = line.t + (endT - line.t) * tok[i].c0 / total;
    }
    r.tok = tok;
    r.total = total;
    r.endT = endT;
  }

  function fill(r, id) {
    r.id = id;
    r.role = 'new';
    r.fresh = true;
    r.p = -1;
    r.lit = -1;
    r.el.hidden = false;
    r.inEl.style.transform = '';
    content(r);
  }

  // Builds the element's content for its item, in the current animation mode.
  // The progress (--p) is set on the element that uses it, the karaoke fill
  // or the notes: a variable on the whole line would restyle all of it
  function content(r) {
    var id = r.id, anim = cfg.lyricanim;
    r.tx.textContent = '';
    r.span.textContent = '';
    r.tx.style.removeProperty('--p');
    r.span.style.removeProperty('--p');
    r.tok = null;
    r.bidi = false;
    r.gap = id === WHOLE || (id & 1) === 1;
    r.pEl = r.gap ? r.tx : r.span;
    if (r.gap) {
      r.line = null;
      r.rtl = false;
      var notes = el('div', 'ls-notes', r.tx);
      for (var k = 0; k < 3; k++) el('span', 'ls-n', notes).textContent = '\u266a';
      el('div', 'ls-gap-label', r.tx).textContent = id === WHOLE ? t('lyrics.instrumental') : '';
      if (id === WHOLE) r.tx.style.setProperty('--p', '1');
    } else {
      var line = r.line = lines[(id - 2) / 2];
      tokens(r, line);
      r.chars = null;
      if (anim === 'words' || anim === 'blur') {
        for (var i = 0; i < r.tok.length; i++) {
          var w = r.tok[i];
          w.el = el('span', 'ls-w', r.tx);
          w.el.textContent = w.word;
          if (w.space) r.tx.appendChild(document.createTextNode(w.space));
        }
      } else if (anim === 'typewriter') {
        // Letter by letter: one span per character (only on the lines on screen)
        r.chars = [];
        r.cLit = -1;
        var letters = Array.from(line.text);
        for (var c = 0; c < letters.length; c++) {
          var ch = el('span', 'ls-c', r.tx);
          ch.textContent = letters[c];
          r.chars.push(ch);
        }
      } else {
        r.tx.textContent = line.text;
      }
      if (anim === 'karaoke') r.span.textContent = line.text;
      r.rtl = getComputedStyle(r.el).direction === 'rtl';
      r.bidi = BIDI.test(line.text);
    }
    r.el.className = roleClass(r);
    measure(r);
  }

  // Fits the line to two rows at most: shrinks it to the width it needs
  function measure(r) {
    var st = r.el.style, fit = 1, lh = fontPx * font.lh;
    st.setProperty('--fit', '1');
    var h = r.inEl.offsetHeight;
    if (!r.gap && h > lh * (MAX_ROWS + 0.4)) {
      r.el.classList.add('ls-measure');
      var w = r.tx.offsetWidth;
      r.el.classList.remove('ls-measure');
      fit = Math.max(minFit, Math.min(1, boxW * MAX_ROWS * 0.86 / Math.max(1, w)));
      for (var k = 0; k < 6; k++) {
        st.setProperty('--fit', fit.toFixed(3));
        h = r.inEl.offsetHeight;
        if (h <= lh * fit * (MAX_ROWS + 0.4) || fit <= minFit) break;
        fit = Math.max(minFit, fit * 0.92);
      }
    }
    r.h = h;
    r.fit = fit;
  }

  function baseClass(r) {
    return 'ls-line' + (r.gap ? ' ls-gap' : '') + (r.rtl ? ' ls-rtl' : '') + (r.bidi ? ' ls-bidi' : '') +
      (cfg.chorus && r.line && r.line.chorus ? ' ls-chorus' : '');
  }

  function roleClass(r) {
    return baseClass(r) + ' ls-' + r.role;
  }

  function place(r, y, sc) {
    r.y = y;
    r.sc = sc;
    r.el.style.transform = 'translate(0, ' + y.toFixed(1) + 'px) scale(' + sc + ')';
  }

  // Leaves: up (or down after a seek back) and fades; a pause fades quickly
  // where it is (the next line comes up through its place)
  function leave(r, back) {
    r.role = 'out';
    r.outAt = now;
    r.fresh = false;
    r.el.className = roleClass(r);
    if (r.gap) place(r, r.y - fontPx * 0.25, r.sc * 0.8);
    else if (cfg.lyriccontext) place(r, back ? r.y + fontPx * 1.6 : r.y - r.h * r.sc - fontPx * 0.5, r.sc * 0.9);
    else place(r, r.y + (back ? 1 : -1) * fontPx * 0.8, r.sc * 0.96);
  }

  function recycle(r) {
    r.role = '';
    r.id = NO_ITEM;
    r.el.hidden = true;
    r.el.className = 'ls-line';
    r.el.style.transform = '';
    r.tx.textContent = '';
    r.span.textContent = '';
    r.tok = null;
    r.line = null;
  }

  // Places the previous, current and next items around the anchor; new ones
  // come in from below (from above after a seek back)
  function layout(back) {
    var g = fontPx * 0.42, ctx = cfg.lyriccontext, i, r;
    var hc = cur ? cur.h : fontPx * font.lh, y0 = -hc / 2, fresh = false, fc = cur ? cur.fit : 1;
    slots[0] = prev;
    slots[1] = cur;
    slots[2] = next;
    ys[0] = ys[2] = 0;
    ys[1] = y0;
    scs[0] = scs[2] = 0.94;
    scs[1] = 1;
    if (prev) {
      if (ctx) scs[0] = Math.min(SIDE, SIDE_REL * fc / prev.fit);
      ys[0] = ctx ? y0 - g - prev.h * scs[0] : -prev.h / 2 - fontPx * 0.8;
    }
    if (next) {
      if (ctx) scs[2] = Math.min(SIDE, SIDE_REL * fc / next.fit);
      ys[2] = ctx ? y0 + hc + g : -next.h / 2 + fontPx * 0.8;
    }
    for (i = 0; i < 3; i++) {
      r = slots[i];
      if (!r) continue;
      r.role = ROLES[i];
      if (r.fresh) {
        // Starting point, without a transition
        r.el.style.transition = 'none';
        r.el.className = baseClass(r);
        place(r, ys[i] + (back ? -1 : 1) * fontPx * (i === 2 ? 0.9 : 0.6), scs[i] * 0.96);
        fresh = true;
      } else {
        r.el.className = roleClass(r);
        place(r, ys[i], scs[i]);
      }
    }
    if (!fresh) return;
    void box.offsetWidth;
    for (i = 0; i < 3; i++) {
      r = slots[i];
      if (!r || !r.fresh) continue;
      r.fresh = false;
      r.el.style.transition = '';
      r.el.className = roleClass(r);
      place(r, ys[i], scs[i]);
    }
  }

  // A new current item: roles move, lines come and go
  function setItem(id) {
    var back = curId !== NO_ITEM && id !== WHOLE && curId !== WHOLE && id < curId;
    curId = id;
    var pId = NO_ITEM, nId = NO_ITEM, i;
    if (id === NONE) {
      i = baseIdx < 0 ? firstText : nextText[baseIdx];
      if (i >= 0) nId = 2 * i + 2;
    } else if (id !== WHOLE) {
      i = (id - 2) >> 1;     // the line (for a pause: the line before it, −1 for the intro)
      if (id & 1) {
        if (i >= 0) pId = lines[i].text ? 2 * i + 2 : (prevText[i] >= 0 ? 2 * prevText[i] + 2 : NO_ITEM);
        var nx = i >= 0 ? nextText[i] : firstText;
        if (nx >= 0) nId = 2 * nx + 2;
      } else {
        if (prevText[i] >= 0) pId = 2 * prevText[i] + 2;
        if (nextText[i] >= 0) nId = 2 * nextText[i] + 2;
      }
    }
    var oldCur = cur;
    var p = take(pId), c = take(id), n = take(nId);
    for (i = 0; i < pool.length; i++) {
      var r = pool[i];
      if (r.role && r.role !== 'out' && r !== p && r !== c && r !== n) leave(r, back);
    }
    prev = p;
    cur = c;
    next = n;
    if (oldCur && oldCur !== cur) oldCur.inEl.style.transform = '';
    pulseSet = 1;
    layout(back);
  }

  // Every line leaves (new lyrics, or none). Their ids are dropped: the same
  // id in the new lyrics is another line
  function clearItems() {
    for (var i = 0; i < pool.length; i++) {
      var r = pool[i];
      if (r.role === 'new') recycle(r);
      else if (r.role && r.role !== 'out') leave(r, false);
      r.id = NO_ITEM;
    }
    cur = prev = next = null;
    curId = NO_ITEM;
  }

  // The current item's progress: the karaoke fill, the words, the notes
  function progress(pos) {
    var r = cur;
    if (!r) return;
    var p;
    if (r.gap) {
      if (r.id === WHOLE) return;
      p = clamp01((pos - gapStart) / Math.max(0.1, gapEnd - gapStart));
    } else {
      var tok = r.tok, n = tok.length, k;
      if (cfg.lyricanim === 'words' || cfg.lyricanim === 'blur') {
        for (k = 0; k < n && tok[k].t <= pos + 0.05; k++);
        if (k !== r.lit) lightWords(r, k);
        return;
      }
      if (cfg.lyricanim !== 'karaoke' && cfg.lyricanim !== 'typewriter') return;
      if (!n || r.total <= 0) p = 1;
      else if (pos <= tok[0].t) p = 0;
      else {
        for (k = n - 1; k > 0 && tok[k].t > pos; k--);
        var a = tok[k].t, b = k + 1 < n ? tok[k + 1].t : r.endT;
        var f = b > a ? clamp01((pos - a) / (b - a)) : 1;
        p = (tok[k].c0 + (tok[k].c1 - tok[k].c0) * f) / r.total;
      }
    }
    if (r.chars) {
      lightChars(r, Math.round(p * r.chars.length));
      return;
    }
    if (Math.abs(p - r.p) < 0.0015 && !(p === 1 && r.p !== 1)) return;
    r.p = p;
    r.pEl.style.setProperty('--p', p.toFixed(4));
  }

  // Typewriter: the first k letters are typed, a caret after the last one
  function lightChars(r, k) {
    if (k === r.cLit) return;
    // Only the letters between the old count and the new one change
    var ch = r.chars;
    var a = r.cLit < 0 ? 0 : Math.max(0, Math.min(k, r.cLit) - 1);
    var b = r.cLit < 0 ? ch.length : Math.min(ch.length, Math.max(k, r.cLit) + 1);
    for (var i = a; i < b; i++) {
      ch[i].classList.toggle('ls-on', i < k);
      ch[i].classList.toggle('ls-caret', i === k - 1 && k < ch.length);
    }
    r.cLit = k;
  }

  // Words mode: the first k words are on, the last of them is the newest
  function lightWords(r, k) {
    var tok = r.tok;
    for (var i = 0; i < tok.length; i++) {
      tok[i].el.classList.toggle('ls-on', i < k);
      tok[i].el.classList.toggle('ls-now', i === k - 1);
    }
    r.lit = k;
  }

  // ---------------------------------------------------------------------------
  // Lyrics without timing
  // ---------------------------------------------------------------------------

  function setPlain(text) {
    plain = text || '';
    plainText.textContent = '';
    plainEls = [];
    plainHot = -1;
    plainY = NaN;
    var rows = plain.replace(/\r\n?/g, '\n').split('\n');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i].trim();
      if (!row) {
        // Blank lines between verses: one gap at most
        if (plainText.lastChild && plainText.lastChild.className === 'ls-pl') el('div', 'ls-pl-gap', plainText);
        continue;
      }
      var e = el('div', 'ls-pl', plainText);
      e.dir = 'auto';
      e.textContent = row;
      plainEls.push(e);
    }
    measurePlain();
  }

  function measurePlain() {
    plainView = plainBox.clientHeight;
    plainH = plainText.offsetHeight;
    plainMid = plainEls.map(function (e) { return e.offsetTop + e.offsetHeight / 2; });
    plainY = NaN;
  }

  // The text scrolls with the song: where the song is (pos / duration, the
  // lyrics usually start a bit in and end a bit before the end) is the part
  // in the middle, lit
  function scrollPlain(pos, duration) {
    if (!plainEls.length || !plainH) return;
    var f = duration > 0 ? pos / duration : pos / (plainEls.length * 3.5);
    f = clamp01((f - 0.06) / 0.86);
    var focus = plainView * 0.45, at = f * plainH, y = Math.round((focus - at) * 2) / 2;
    if (y !== plainY) {
      plainY = y;
      plainText.style.transform = 'translate3d(0, ' + y + 'px, 0)';
    }
    var lo = 0, hi = plainMid.length - 1;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (plainMid[mid] < at) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && at - plainMid[lo - 1] < plainMid[lo] - at) lo--;
    if (lo !== plainHot) {
      if (plainHot >= 0 && plainEls[plainHot]) plainEls[plainHot].classList.remove('ls-hot');
      plainHot = lo;
      plainEls[lo].classList.add('ls-hot');
    }
  }

  // ---------------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------------

  // Measures again after a resize or a settings change
  function relayout() {
    dirty = false;
    fontPx = parseFloat(getComputedStyle(box).fontSize) || 40;
    boxW = box.clientWidth || 800;
    // How far a long line may shrink: to about MIN_PX, kept within
    // MIN_FIT…MAX_MIN_FIT of the set size
    var u = Math.min(wrap.clientHeight, wrap.clientWidth * 1.25) / 100 || 9;
    minFit = Math.min(MAX_MIN_FIT, Math.max(MIN_FIT, MIN_PX * u / fontPx));
    for (var i = 0; i < pool.length; i++) {
      var r = pool[i];
      if (r.role === 'out') recycle(r);
      else if (r.role) {
        if (rebuild) {
          content(r);
          r.p = r.lit = -1;
          if (r.id === WHOLE) r.p = 1;
        } else {
          measure(r);
        }
        r.fresh = false;
      }
    }
    rebuild = false;
    if (cur || prev || next) layout(false);
    if (plain) measurePlain();
  }

  function hide() {
    visible = false;
    opacity = 0;
    wrap.style.opacity = '0';
    wrap.classList.add('ls-off');
  }

  function toggle(e, on) { e.classList.toggle('ls-on', on); }

  // A new song: the card shows it, the old lines leave
  function song(s) {
    var tt = s.title || '', aa = s.artist || '';
    if (s.track !== track) {
      // A skip while a card shows: its content fades in anew
      if (track !== undefined && (heroOn || cornerOn)) {
        hero.classList.remove('ls-swap');
        corner.classList.remove('ls-swap');
        void hero.offsetWidth;
        hero.classList.add('ls-swap');
        corner.classList.add('ls-swap');
      }
      track = s.track;
      cardTime = 0;
      statusAge = 0;
    }
    if (tt !== title || aa !== artist) {
      title = tt;
      artist = aa;
      heroTitle.textContent = cornerTitle.textContent = tt;
      heroArtist.textContent = cornerArtist.textContent = aa;
      for (var i = 0; i < sides.length; i++) {
        sides[i].title.textContent = tt;
        sides[i].artist.textContent = aa;
      }
    }
    var c = (cfg.showcover && s.cover) || '';
    if (c !== cover) {
      cover = c;
      if (c) heroCover.src = cornerCover.src = c;
      for (var j = 0; j < sides.length; j++) if (c) sides[j].cover.src = c;
      wrap.classList.toggle('ls-nocover', !c);
    }
  }

  // The message to show (a key of i18n.js) or ''
  function message(s, on, hasTitle, dt) {
    if (hasTitle) {
      noMedia = 0;
    } else {
      // Only when Wallpaper Engine's media integration is off: a show of
      // sound alone (a music bot…) with it on needs no advice
      if (!s.mediaOff || (!on && cfg.songcard === 'off')) return '';
      noMedia += dt;
      return noMedia >= NO_MEDIA_AFTER && noMedia < NO_MEDIA_AFTER + 10 ? 'show.noMedia' : '';
    }
    if (!on) return '';
    switch (status) {
      case 'searching': return statusAge >= SEARCH_AFTER ? 'lyrics.searching' : '';
      case 'notfound': return statusAge < MSG_TIME ? 'lyrics.notFound' : '';
      case 'error': return statusAge < MSG_TIME ? 'lyrics.error' : '';
      case 'plain': return statusAge < MSG_TIME + 2 ? 'lyrics.plain' : '';
      case 'synced':
        return s.synced === false && statusAge >= ESTIMATED_AFTER && statusAge < ESTIMATED_AFTER + MSG_TIME ? 'lyrics.estimated' : '';
    }
    return '';
  }

  // s = { show, lyricsOn, track, title, artist, cover, status, lines, plain,
  //       pos, duration, synced, textColor, accentColor, bass, beat }
  function update(dt, s) {
    if (!wrap || !s) return;
    dt = dt > 0 ? Math.min(dt, 0.25) : 0;
    now += dt;

    // Hidden while the show is under half way; fades in over the rest
    var v = smooth(0.5, 0.9, +s.show || 0);
    if (v <= 0) {
      if (visible) hide();
      return;
    }
    if (!visible) {
      visible = true;
      wrap.classList.remove('ls-off');
      cardTime = 0;          // the show starts: present the song
      noMedia = 0;
    }
    if (Math.abs(v - opacity) > 0.004 || (v === 1 && opacity !== 1)) {
      opacity = v;
      wrap.style.opacity = v === 1 ? '' : v.toFixed(3);
    }
    if (dirty) relayout();
    colors(s.textColor, s.accentColor);
    song(s);
    var pl = s.playing !== false;
    if (pl !== playing) {
      playing = pl;
      wrap.classList.toggle('ls-paused', !pl);   // the vinyl stops turning
    }
    cardTime += dt;

    // What the lyrics give
    var on = s.lyricsOn !== false;
    var st = on ? s.status || 'off' : 'off';
    if (st !== status) {
      status = st;
      statusAge = 0;
    }
    statusAge += dt;
    var mode = '';
    if (st === 'synced' && s.lines && s.lines.length) mode = 'synced';
    else if (st === 'plain' && s.plain) mode = 'plain';
    else if (st === 'instrumental') mode = 'inst';

    var list = mode === 'synced' ? s.lines : null;
    if (list !== lines) setLines(list);
    var pos = +s.pos || 0, duration = +s.duration || 0;
    if (mode === 'synced') {
      var id = itemAt(pos, duration);
      if (id !== curId) setItem(id);
      progress(pos);
    } else if (mode === 'inst') {
      if (curId !== WHOLE) setItem(WHOLE);
    } else if (curId !== NO_ITEM) {
      clearItems();
    }
    var plainWant = mode === 'plain';
    if (plainWant && s.plain !== plain) setPlain(s.plain);

    // The big card, the small one, the lyrics
    var hasTitle = !!title;
    var early = cardTime < CARD_TIME &&
      !(mode === 'synced' && firstText >= 0 && pos >= lines[firstText].t - CARD_LEAD);
    var heroWant = cfg.songcard !== 'off' && hasTitle && (early || (!mode && cfg.songcard === 'corner'));
    var cornerWant = cfg.songcard === 'corner' && hasTitle && !heroWant;
    var lyricsWant = !heroWant && (mode === 'synced' || mode === 'inst');
    plainWant = plainWant && !heroWant;
    if (heroWant !== heroOn) toggle(hero, heroOn = heroWant);
    if (cornerWant !== cornerOn) toggle(corner, cornerOn = cornerWant);
    if (lyricsWant !== lyricsOn) toggle(box, lyricsOn = lyricsWant);
    if (plainWant !== plainOn) toggle(plainBox, plainOn = plainWant);
    if (plainOn) scrollPlain(pos, duration);

    // Messages
    var key = message(s, on, hasTitle, dt);
    var at = heroOn ? 'hero' : lyricsOn || plainOn ? 'top' : 'center';
    if (key !== msgKey || (key && at !== msgAt)) {
      msgKey = key;
      msgAt = at;
      var target = at === 'hero' ? heroStatus : statusEl;
      if (key) {
        target.textContent = t(key);
        target.dir = S.i18n && S.i18n.dir ? S.i18n.dir() : 'ltr';
        if (target === statusEl) statusEl.dataset.at = at;
      }
      toggle(heroStatus, !!key && target === heroStatus);
      toggle(statusEl, !!key && target === statusEl);
    }

    progressBar(+s.pos || 0, +s.duration || 0);

    // The bass pulse: quick to rise, slow to fall. With 'lyricbeat' a beat
    // also kicks the line (a short jump in size); a chorus line is bigger
    var aim = clamp01((+s.bass || 0) * 0.75 + (+s.beat || 0) * 0.35);
    pulse += (aim - pulse) * Math.min(1, dt * (aim > pulse ? 14 : 4));
    var kickAim = cfg.lyricbeat ? clamp01(+s.beat || 0) : 0;
    kick = kickAim > kick ? kickAim : kick * Math.exp(-dt * 7);
    if (kick < 0.002) kick = 0;
    var big = cur && cfg.chorus && cur.line && cur.line.chorus ? CHORUS_SCALE : 1;
    var sc = Math.round((1 + PULSE * pulse + KICK * kick) * big * 2000) / 2000;
    if (cur && lyricsOn && sc !== pulseSet) {
      pulseSet = sc;
      cur.inEl.style.transform = sc === 1 ? '' : 'scale(' + sc + ')';
    }
    sc = Math.round((1 + PULSE * 0.75 * pulse) * 2000) / 2000;
    if (heroOn && cover && sc !== coverSet) {
      coverSet = sc;
      heroCover.style.transform = sc === 1 ? '' : 'scale(' + sc + ')';
    }

    // Lines that finished leaving go back to the pool
    for (var i = 0; i < pool.length; i++) {
      if (pool[i].role === 'out' && now - pool[i].outAt > OUT_TIME) recycle(pool[i]);
    }
  }

  // regions: the screens, in CSS px ({ x0, w }), left to right; index: the one
  // with the lyrics. One screen (or none given): the whole page
  function setScreens(regions, index) {
    if (!wrap) return;
    var n = regions && regions.length > 1 ? regions.length : 1;
    index = Math.min(n - 1, Math.max(0, index | 0));
    var st = wrap.style, r = n > 1 ? regions[index] : null;
    st.left = r ? r.x0 + 'px' : '';
    st.right = r ? 'auto' : '';
    st.width = r ? r.w + 'px' : '';
    st.overflow = r ? 'visible' : '';   // the panels sit on the other screens
    if (r) st.setProperty('--ls-vw', (r.w / 100) + 'px');
    else st.removeProperty('--ls-vw');
    while (sides.length) {
      var old = sides.pop();
      old.el.parentNode.removeChild(old.el);
    }
    for (var i = 0; r && i < n; i++) {
      if (i === index) continue;
      var o = regions[i], side = { el: el('div', 'ls-side', wrap) };
      side.el.style.left = (o.x0 - r.x0) + 'px';
      side.el.style.width = o.w + 'px';
      side.cover = el('img', 'ls-side-cover', side.el);
      side.cover.alt = '';
      side.title = el('div', 'ls-side-title', side.el);
      side.artist = el('div', 'ls-side-artist', side.el);
      side.title.dir = side.artist.dir = 'auto';
      var pr = el('div', 'ls-side-prog', side.el);
      side.fill = el('div', 'ls-prog-fill', el('div', 'ls-prog-bar', pr));
      side.time = el('div', 'ls-prog-time', pr);
      side.title.textContent = title;
      side.artist.textContent = artist;
      if (cover) side.cover.src = cover;
      sides.push(side);
    }
    sideOn = false;
    sideSet = -1;
    dirty = true;
  }

  // The song's progress in the corner card: the bar moves smoothly, the time
  // changes once a second; nothing without a known duration
  function progressBar(pos, duration) {
    // The other screens: the panel shows with a song, its bar with a duration
    var sw = sides.length > 0 && cfg.sidecard && !!title;
    if (sw !== sideOn) {
      sideOn = sw;
      for (var i = 0; i < sides.length; i++) sides[i].el.classList.toggle('ls-on', sw);
    }
    if (sideOn) {
      var known = duration > 0, sq = known ? Math.round(clamp01(pos / duration) * 1000) : -2;
      if (sq !== sideSet) {
        var sec2 = Math.floor(pos), txt = known ? clock(pos) + ' / ' + clock(duration) : '';
        for (var k = 0; k < sides.length; k++) {
          sides[k].fill.style.transform = 'scaleX(' + (known ? sq / 1000 : 0) + ')';
          if (sides[k].sec !== sec2 || !known) {
            sides[k].sec = sec2;
            sides[k].time.textContent = txt;
          }
          sides[k].el.classList.toggle('ls-noprog', !known);
        }
        sideSet = sq;
      }
    }
    var want = cornerOn && cfg.progress && duration > 0;
    if (want !== progOn) {
      progOn = want;
      progBox.classList.toggle('ls-on', want);
    }
    if (!want) return;
    var p = clamp01(pos / duration), q = Math.round(p * 1000);
    if (q !== progSet) {
      progSet = q;
      progFill.style.transform = 'scaleX(' + (q / 1000) + ')';
    }
    var sec = Math.floor(pos);
    if (sec !== progSec) {
      progSec = sec;
      progTime.textContent = clock(pos) + ' / ' + clock(duration);
    }
  }

  function clock(t) {
    t = Math.max(0, Math.floor(t));
    var m = Math.floor(t / 60), x = t % 60;
    return m + ':' + (x < 10 ? '0' : '') + x;
  }

  function itemText(r) {
    return !r ? null : r.gap ? '\u266A' : r.line.text;
  }

  // For tests: what shows now
  function state() {
    return {
      visible: visible, hero: heroOn, corner: cornerOn, lyrics: lyricsOn, plain: plainOn,
      item: curId, message: msgKey || '', messageAt: msgAt,
      cur: itemText(cur), prev: itemText(prev), next: itemText(next),
      pool: pool.length, sides: sides.length, sideOn: sideOn
    };
  }

  S.stage = {
    init: init, apply: apply, update: update, state: state, setScreens: setScreens,
    heroOn: function () { return heroOn; }     // the big song card is on screen
  };
})(window.Lyric = window.Lyric || {});
