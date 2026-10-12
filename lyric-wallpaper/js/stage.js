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
 * The song card is big in the middle at the start of a song (and while there
 * are no lyrics to show), then small in the bottom left corner.
 */
(function (S) {
  'use strict';

  var CARD_TIME = 5;        // s: the big song card at the start of a song
  var CARD_LEAD = 0.8;      // s: it makes way this long before the first line
  var GAP_MIN = 6;          // s: a pause this long after a line is sung shows "♪ ♪ ♪"
  var HOLD = 1.5;           // s: a sung line stays this long before the pause takes over
  var INTRO_MIN = 3;        // s: an intro (or an empty line) this long shows "♪ ♪ ♪"
  var OUTRO_MIN = 4;        // s: the same after the last line
  var MSG_TIME = 8;         // s: how long a message (not found, error…) stays
  var SEARCH_AFTER = 0.6;   // s: "Looking for the lyrics…" only for slow lookups
  var ESTIMATED_AFTER = 4;  // s: no position reported this long → say timing is estimated
  var NO_MEDIA_AFTER = 3;   // s: no song info this long → say how to turn it on
  var OUT_TIME = 0.9;       // s: a line that left is recycled after its transition
  var MAX_ROWS = 2;
  var MIN_FIT = 0.4;        // the smallest a long line shrinks to
  var SIDE = 0.6;           // scale of the previous and next lines…
  var SIDE_REL = 0.8;       // …and never more than this of the current one (a shrunk long line)
  var PULSE = 0.02;         // the bass pulse of the current line (2 %)

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
  var SPLIT = /[぀-ヿ㐀-䶿一-鿿豈-﫿]\s*|[^\s぀-ヿ㐀-䶿一-鿿豈-﫿]+\s*/g;

  var cfg = {
    lyricfont: 'segoe', lyricsize: 1, lyricpos: 'center', lyricanim: 'karaoke',
    lyriccontext: true, glowtext: true, songcard: 'corner', showcover: true
  };
  var font = FONTS.segoe;

  var root = null, wrap, box, plainBox, plainText, statusEl;
  var hero, heroCover, heroTitle, heroArtist, heroStatus;
  var corner, cornerCover, cornerTitle, cornerArtist;
  var cctx = null;           // a 2D context that normalizes CSS colors

  // The song
  var now = 0, visible = false, opacity = -1;
  var track, title = '', artist = '', cover = null, cardTime = 0;
  var textColor = null, accentColor = null;

  // Synced lines
  var lines = null, firstText = -1, prevText = null, nextText = null, gapAt = null;
  var pool = [];             // { el, inEl, tx, fill, span, id, role, gap, line, tok, … }
  var cur = null, prev = null, next = null, curId = NO_ITEM, baseIdx = -1;
  var gapStart = 0, gapEnd = 1;
  var fontPx = 40, boxW = 800, dirty = true, rebuild = false;
  var pulse = 0, pulseSet = 1, coverSet = 1;
  var timingSing = 0;        // second result of timing()

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
  // language change (it refreshes the messages)
  function apply(c) {
    Object.keys(cfg).forEach(function (k) { if (c && c[k] !== undefined) cfg[k] = c[k]; });
    if (!wrap) return;
    font = FONTS[cfg.lyricfont] || FONTS.segoe;
    var st = wrap.style;
    st.setProperty('--ls-font', font.family);
    st.setProperty('--ls-weight', font.weight);
    st.setProperty('--ls-title-weight', font.title);
    st.setProperty('--ls-spacing', font.spacing);
    st.setProperty('--ls-lh', font.lh);
    st.setProperty('--ls-case', font.upper ? 'uppercase' : 'none');
    st.setProperty('--ls-size', Math.min(2, Math.max(0.5, +cfg.lyricsize || 1)));
    wrap.dataset.pos = /^(center|lower|left)$/.test(cfg.lyricpos) ? cfg.lyricpos : 'center';
    wrap.dataset.anim = /^(karaoke|words|fade)$/.test(cfg.lyricanim) ? cfg.lyricanim : 'karaoke';
    wrap.dataset.font = cfg.lyricfont;
    wrap.classList.toggle('ls-ctx', !!cfg.lyriccontext);
    wrap.classList.toggle('ls-glowing', !!cfg.glowtext);
    rebuild = true;          // the lines again (mode, font, language of the labels)
    cover = null;            // showcover may have changed
    msgKey = null;           // the language may have changed
    dirty = true;
  }

  // CSS colors (or [r, g, b] from 0 to 1) → the color variables
  function rgbOf(c, fb) {
    if (Array.isArray(c)) return [c[0] * 255, c[1] * 255, c[2] * 255];
    if (!cctx || !c) return fb;
    cctx.fillStyle = '#010203';
    cctx.fillStyle = String(c);
    var v = cctx.fillStyle;
    if (v.charAt(0) === '#') {
      if (v === '#010203' && c !== '#010203') return fb;
      return [parseInt(v.substr(1, 2), 16), parseInt(v.substr(3, 2), 16), parseInt(v.substr(5, 2), 16)];
    }
    var m = v.match(/[\d.]+/g);
    return m && m.length >= 3 ? [+m[0], +m[1], +m[2]] : fb;
  }

  function rgba(c, a) {
    return 'rgba(' + Math.round(c[0]) + ', ' + Math.round(c[1]) + ', ' + Math.round(c[2]) + ', ' + a + ')';
  }

  function colors(text, accent) {
    if (text === textColor && accent === accentColor) return;
    textColor = text;
    accentColor = accent;
    var tc = rgbOf(text, [255, 255, 255]), ac = rgbOf(accent, [169, 193, 255]), st = wrap.style;
    st.setProperty('--ls-text', rgba(tc, 1));
    st.setProperty('--ls-dim', rgba(tc, 0.45));
    st.setProperty('--ls-accent', rgba(ac, 1));
    st.setProperty('--ls-glow', rgba(ac, 0.5));
    st.setProperty('--ls-glow-soft', rgba(ac, 0.22));
    st.setProperty('--ls-halo', rgba(ac, 0.28));
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
    prevText = nextText = gapAt = null;
    clearItems();
    if (!lines) return;
    var n = lines.length, i, last = -1;
    prevText = new Int32Array(n);
    nextText = new Int32Array(n);
    gapAt = new Float64Array(n);
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
    var ln = lines[i];
    var songEnd = duration > ln.end ? duration : ln.end + 60;
    if (!ln.text) {
      // An empty line marks a pause; a short one keeps the line before
      if (i === n - 1 || ln.end - ln.t >= INTRO_MIN) {
        gapStart = ln.t;
        gapEnd = i === n - 1 ? songEnd : ln.end;
        return 2 * i + 3;
      }
      return prevText[i] >= 0 ? 2 * prevText[i] + 2 : NONE;
    }
    if (pos >= gapAt[i]) {
      gapStart = gapAt[i];
      gapEnd = ln.end;
      return 2 * i + 3;
    }
    // After the last line: the outro
    if (i === n - 1 && pos >= ln.end && (duration <= 0 || duration - ln.end >= OUTRO_MIN)) {
      gapStart = ln.end;
      gapEnd = songEnd;
      return 2 * i + 3;
    }
    return 2 * i + 2;
  }

  // ---------------------------------------------------------------------------
  // The pool of line elements
  // ---------------------------------------------------------------------------

  function makeRec() {
    var r = {
      el: el('div', 'ls-line', box), inEl: null, tx: null, fill: null, span: null,
      id: NO_ITEM, role: '', gap: false, rtl: false, line: null, tok: null, total: 0, endT: 0,
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
    var r = findRec(id);
    if (r) return r;
    for (var i = 0; i < pool.length && !r; i++) if (!pool[i].role) r = pool[i];
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
    r.el.style.removeProperty('--p');
    r.inEl.style.transform = '';
    content(r);
  }

  // Builds the element's content for its item, in the current animation mode
  function content(r) {
    var id = r.id, anim = cfg.lyricanim;
    r.tx.textContent = '';
    r.span.textContent = '';
    r.tok = null;
    r.gap = id === WHOLE || (id & 1) === 1;
    if (r.gap) {
      r.line = null;
      r.rtl = false;
      var notes = el('div', 'ls-notes', r.tx);
      for (var k = 0; k < 3; k++) el('span', 'ls-n', notes).textContent = '♪';
      el('div', 'ls-gap-label', r.tx).textContent = id === WHOLE ? t('lyrics.instrumental') : '';
      if (id === WHOLE) r.el.style.setProperty('--p', '1');
    } else {
      var line = r.line = lines[(id - 2) / 2];
      tokens(r, line);
      if (anim === 'words') {
        for (var i = 0; i < r.tok.length; i++) {
          var w = r.tok[i];
          w.el = el('span', 'ls-w', r.tx);
          w.el.textContent = w.word;
          if (w.space) r.tx.appendChild(document.createTextNode(w.space));
        }
      } else {
        r.tx.textContent = line.text;
      }
      if (anim === 'karaoke') r.span.textContent = line.text;
      r.rtl = getComputedStyle(r.el).direction === 'rtl';
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
      fit = Math.max(MIN_FIT, Math.min(1, boxW * MAX_ROWS * 0.86 / Math.max(1, w)));
      for (var k = 0; k < 5; k++) {
        st.setProperty('--fit', fit.toFixed(3));
        h = r.inEl.offsetHeight;
        if (h <= lh * fit * (MAX_ROWS + 0.4) || fit <= MIN_FIT) break;
        fit = Math.max(MIN_FIT, fit * 0.92);
      }
    }
    r.h = h;
    r.fit = fit;
  }

  function baseClass(r) {
    return 'ls-line' + (r.gap ? ' ls-gap' : '') + (r.rtl ? ' ls-rtl' : '');
  }

  function roleClass(r) {
    return baseClass(r) + ' ls-' + r.role;
  }

  function place(r, y, sc) {
    r.y = y;
    r.sc = sc;
    r.el.style.transform = 'translate(0, ' + y.toFixed(1) + 'px) scale(' + sc + ')';
  }

  // Leaves: up (or down after a seek back) and fades; a pause shrinks away
  function leave(r, back) {
    r.role = 'out';
    r.outAt = now;
    r.fresh = false;
    r.el.className = roleClass(r);
    if (r.gap) place(r, r.y + r.h * r.sc * 0.2, r.sc * 0.6);
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
    var g = fontPx * 0.42, ctx = cfg.lyriccontext;
    var hc = cur ? cur.h : fontPx * font.lh, y0 = -hc / 2, fresh = false;
    var list = [prev, cur, next], ys = [0, y0, 0], scs = [0.94, 1, 0.94];
    var roles = ['prev', 'cur', 'next'], fc = cur ? cur.fit : 1;
    if (prev) {
      if (ctx) scs[0] = Math.min(SIDE, SIDE_REL * fc / prev.fit);
      ys[0] = ctx ? y0 - g - prev.h * scs[0] : -prev.h / 2 - fontPx * 0.8;
    }
    if (next) {
      if (ctx) scs[2] = Math.min(SIDE, SIDE_REL * fc / next.fit);
      ys[2] = ctx ? y0 + hc + g : -next.h / 2 + fontPx * 0.8;
    }
    for (var i = 0; i < 3; i++) {
      var r = list[i];
      if (!r) continue;
      r.role = roles[i];
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
      r = list[i];
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

  // Every line leaves (new lyrics, or none)
  function clearItems() {
    for (var i = 0; i < pool.length; i++) {
      var r = pool[i];
      if (r.role === 'new') recycle(r);
      else if (r.role && r.role !== 'out') leave(r, false);
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
      if (cfg.lyricanim === 'words') {
        for (k = 0; k < n && tok[k].t <= pos + 0.05; k++);
        if (k !== r.lit) lightWords(r, k);
        return;
      }
      if (cfg.lyricanim !== 'karaoke') return;
      if (!n || r.total <= 0) p = 1;
      else if (pos <= tok[0].t) p = 0;
      else {
        for (k = n - 1; k > 0 && tok[k].t > pos; k--);
        var a = tok[k].t, b = k + 1 < n ? tok[k + 1].t : r.endT;
        var f = b > a ? clamp01((pos - a) / (b - a)) : 1;
        p = (tok[k].c0 + (tok[k].c1 - tok[k].c0) * f) / r.total;
      }
    }
    if (Math.abs(p - r.p) < 0.0015 && !(p === 1 && r.p !== 1)) return;
    r.p = p;
    r.el.style.setProperty('--p', p.toFixed(4));
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
    }
    var c = (cfg.showcover && s.cover) || '';
    if (c !== cover) {
      cover = c;
      if (c) heroCover.src = cornerCover.src = c;
      wrap.classList.toggle('ls-nocover', !c);
    }
  }

  // The message to show (a key of i18n.js) or ''
  function message(s, on, hasTitle, dt) {
    if (!hasTitle) {
      if (!on && cfg.songcard === 'off') return '';
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
        return !s.synced && statusAge >= ESTIMATED_AFTER && statusAge < ESTIMATED_AFTER + MSG_TIME ? 'lyrics.estimated' : '';
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

    // The bass pulse: quick to rise, slow to fall
    var aim = clamp01((+s.bass || 0) * 0.75 + (+s.beat || 0) * 0.35);
    pulse += (aim - pulse) * Math.min(1, dt * (aim > pulse ? 14 : 4));
    var sc = Math.round((1 + PULSE * pulse) * 2000) / 2000;
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

  function itemText(r) {
    return !r ? null : r.gap ? '\u266A' : r.line.text;
  }

  // For tests: what shows now
  function state() {
    return {
      visible: visible, hero: heroOn, corner: cornerOn, lyrics: lyricsOn, plain: plainOn,
      item: curId, message: msgKey || '', messageAt: msgAt,
      cur: itemText(cur), prev: itemText(prev), next: itemText(next),
      pool: pool.length
    };
  }

  S.stage = { init: init, apply: apply, update: update, state: state };
})(window.Lyric = window.Lyric || {});
