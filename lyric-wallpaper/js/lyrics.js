/*
 * Lyric Stage — the lyrics: looked up online at lrclib.net (a free, open
 * database of lyrics, most of them timed line by line) from the title and
 * artist the player reports, and parsed from the LRC format into timed lines
 * for stage.js.
 *
 * The lyrics are only kept in memory (the last 40 songs): nothing is saved.
 * To stay friendly to the free service there is one request at a time, and
 * a quick run of skipped songs only looks up the last one.
 *
 * The lookup, for the song's cleaned-up title and artist (cleanTitle):
 *   1. /api/get — the exact song (with its duration when known);
 *   2. /api/search by title and artist — the best result (below);
 *   3. /api/search with free text, then by title and artist for the other
 *      readings of the title (e.g. the original one).
 * It stops at the first timed lyrics, or when the service cannot be reached;
 * untimed (plain) ones are only used when no timed ones turn up. The best
 * result: timed and within 3 s of the song's duration (the same recording),
 * then any timed, then plain.
 */
(function (S) {
  'use strict';

  var API = 'https://lrclib.net/api/';
  var CLIENT = 'Lyric Stage (https://github.com/UsuarioDeJava/WE-Wallpapers)';
  var CACHE_MAX = 40;
  var NEAR = 3;          // s: a result this close to the song's duration is the same recording
  var LAST_LINE = 6;     // s: how long the last line lasts
  var MAX_T = 3600;      // s: a stamp of an hour or more is not a song: rejected
  var VARIANTS = 3;      // other readings of the title that are also looked up

  // ---------------------------------------------------------------------------
  // LRC
  // ---------------------------------------------------------------------------

  // [mm:ss.xx], [m:ss], [mm:ss.xxx], [mm:ss:xx]
  var STAMP = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,6}))?\]/;
  // [h:mm:ss.xx]
  var HOURS = /^\[(\d{1,2}):(\d{1,2}):(\d{1,2})[.:](\d{1,6})\]/;
  // A stamp left inside the text (with the spaces around it)
  var INLINE = /\s*\[\d{1,3}:\d{1,2}(?:[.:]\d{1,6})?\]\s*/g;
  // Enhanced LRC: a stamp before each word, <mm:ss.xx>
  var WORD = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,6}))?>/g;
  // Metadata: [ar:…], [ti:…], [al:…], [by:…], [length:…], [offset:…]
  var TAG = /^\[([a-z#][\w#-]*):([^\]]*)\]$/i;

  // A stamp's match → seconds, or -1 when it is not a valid song time
  function stampTime(m) {
    var s = +m[2];
    if (s >= 60) return -1;
    var t = +m[1] * 60 + s;
    if (m[3]) t += +m[3] / Math.pow(10, m[3].length);
    return t < MAX_T ? t : -1;
  }

  function hoursTime(m) {
    if (+m[2] >= 60 || +m[3] >= 60) return -1;
    var t = +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / Math.pow(10, m[4].length);
    return t < MAX_T ? t : -1;
  }

  function addWord(words, seg, t) {
    if (!seg) return;
    if (!seg.trim()) {
      // Spaces between words belong to the word before
      if (words.length) words[words.length - 1].text += seg;
      return;
    }
    words.push({ t: t, text: seg });
  }

  // The text of a line with word stamps → [{ t, text }] (joined, the words
  // give back the line's text, spaces included), or null without word stamps
  function splitWords(body, t0) {
    var words = [], m, last = 0, t = t0;
    WORD.lastIndex = 0;
    while ((m = WORD.exec(body))) {
      addWord(words, body.slice(last, m.index), t);
      var wt = stampTime(m);
      if (wt >= 0) t = wt;
      last = WORD.lastIndex;
    }
    if (!last) return null;
    addWord(words, body.slice(last), t);
    if (words.length) {
      words[0].text = words[0].text.replace(/^\s+/, '');
      var w = words[words.length - 1];
      w.text = w.text.replace(/\s+$/, '');
    }
    return words;
  }

  function shiftWords(words, dt) {
    if (!words) return null;
    return words.map(function (w) { return { t: w.t + dt, text: w.text }; });
  }

  // Two lines at the same time become one ("first / second"); an empty one
  // gives way to one with text, and an exact repeat is dropped
  function merge(into, e) {
    if (!e.text || e.text === into.text) return;
    if (!into.text) {
      into.text = e.text;
      into.words = e.words;
      return;
    }
    if (into.words && e.words) {
      into.words[into.words.length - 1].text += ' / ';
      into.words = into.words.concat(e.words);
    } else {
      into.words = null;
    }
    into.text += ' / ' + e.text;
  }

  // LRC text → { lines: [{ t, end, text, words }], hasWords }, sorted by t.
  // Lines without text are kept (instrumental breaks). end = the next line's
  // t; the last line lasts LAST_LINE s (or up to the end of the song when it
  // ends sooner). duration (s, optional): the song's.
  function parseLRC(text, duration) {
    var rows = String(text || '').replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
    var list = [], offset = 0, i, m;
    for (i = 0; i < rows.length; i++) {
      var row = rows[i].trim(), times = [], stamped = false;
      while (row.charAt(0) === '[') {
        var t = -1;
        if ((m = HOURS.exec(row))) t = hoursTime(m);
        else if ((m = STAMP.exec(row))) t = stampTime(m);
        else break;
        stamped = true;
        if (t >= 0) times.push(t);
        row = row.slice(m[0].length).replace(/^\s+/, '');
      }
      if (!stamped) {
        // Metadata (only the offset matters) or a line without a time
        if ((m = TAG.exec(row)) && m[1].toLowerCase() === 'offset') {
          var o = parseFloat(m[2]);
          if (isFinite(o)) offset = o / 1000;
        }
        continue;
      }
      if (!times.length) continue;
      var body = row.replace(INLINE, ' '), words = splitWords(body, times[0]);
      var line = words ? words.map(function (w) { return w.text; }).join('') : body.trim();
      if (words && !words.length) words = null;
      for (var k = 0; k < times.length; k++) {
        list.push({ t: times[k], text: line, words: shiftWords(words, times[k] - times[0]), n: list.length });
      }
    }

    // [offset:+ms] makes the lyrics come sooner
    if (offset) {
      list.forEach(function (e) {
        e.t = Math.max(0, e.t - offset);
        if (e.words) e.words.forEach(function (w) { w.t = Math.max(0, w.t - offset); });
      });
    }
    list.sort(function (a, b) { return a.t - b.t || a.n - b.n; });

    var lines = [];
    for (i = 0; i < list.length; i++) {
      var e = list[i], prev = lines[lines.length - 1];
      if (prev && e.t - prev.t < 0.0005) merge(prev, e);
      else lines.push({ t: e.t, end: 0, text: e.text, words: e.words });
    }
    var hasWords = false;
    duration = +duration || 0;
    for (i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (i + 1 < lines.length) ln.end = lines[i + 1].t;
      else ln.end = duration > ln.t ? Math.min(duration, ln.t + LAST_LINE) : ln.t + LAST_LINE;
      if (ln.words) hasWords = true;
    }
    return { lines: lines, hasWords: hasWords };
  }

  // The index of the line being sung at pos (s): the last one that started,
  // -1 before the first
  function lineAt(lines, pos) {
    var lo = 0, hi = lines ? lines.length - 1 : -1, found = -1;
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

  // ---------------------------------------------------------------------------
  // Titles: what players report → what lrclib.net knows
  // ---------------------------------------------------------------------------

  // Words that mark a bracket group as noise, not title: "(Official Video)"
  var NOISE = new RegExp('(?:^|[^a-z0-9])(?:' + [
    'official', 'oficial', 'officiel', 'video', 'vídeo', 'videoclipe', 'clipe', 'clip', 'mv', 'm/v',
    'lyrics?', 'letra', 'legendad[oa]', 'tradução', 'traducción', 'audio', 'áudio', 'visuali[sz]er',
    'remaster(?:ed)?', 'remasteri[sz]ad[oa]', 'hd', 'hq', '4k', 'explicit', 'clean', 'mono', 'stereo',
    'bonus', 'deluxe', 'demo', 'live', 'ao vivo', 'en vivo', 'acoustic', 'acústic[oa]', 'version',
    'versão', 'versión', 'edit', 'mix', 'single', 'radio', 'anniversary', 'from'
  ].join('|') + ')(?:$|[^a-z0-9])', 'i');
  var CREDIT = /^(?:feat\.?|ft\.?|featuring|with|prod\.?)\s/i;
  var GROUP = /\s*[(\[【]([^()\[\]【】]*)[)\]】]/g;
  // A " - …" tail that names a version of the song ("Song - Remastered 2011",
  // "Song - Radio Edit", "Song - Live at …", 'Song - From "Film"'). Stricter
  // than NOISE: on YouTube " - " separates the artist from the song.
  var VERSION_HEAD = new RegExp('^(?:(?:19|20)\\d\\d\\s+)?(?:' + [
    'remaster(?:ed)?', 'remasteri[sz]ad[oa]', 're-?recorded', 'mono', 'stereo', 'demo', 'acoustic',
    'acústic[oa]', 'explicit', 'clean', 'bonus track', 'deluxe(?: edition)?', 'live(?:\\s+(?:at|from|in|on)\\s.*)?',
    '(?:ao|en)\\s+vivo(?:\\s.*)?', 'from\\s+["“\'‘].*'
  ].join('|') + ')(?:\\s+(?:19|20)\\d\\d)?$', 'i');
  var VERSION_END = /(?:^|\s)(?:version|versão|versión|edit|mix|remaster(?:ed)?|edition)(?:\s+(?:19|20)\d\d)?$/i;
  var DASH = /^(.+?)\s+[-–—]\s+(.+)$/;
  var TAIL = /\s+[-–—]\s+([^-–—]+)$/;
  // "Song feat. Someone", up to a " - " that may follow ("Artist feat. X - Song")
  var FEAT = /\s+(?:feat\.?|ft\.|featuring)\s.*?(?=\s+[-–—]\s|$)/i;
  // A browser tab's title: "(2) Artist - Song - YouTube"
  var SITE = /\s+[-–—]\s+YouTube(?:\s+Music)?$/i;

  function tidy(s) {
    return s.replace(/\s+/g, ' ').replace(/^[\s\-–—|:]+|[\s\-–—|:]+$/g, '');
  }

  // A loose form for comparisons: lower case, no accents, no spaces or punctuation
  function norm(s) {
    s = String(s || '').toLowerCase();
    if (s.normalize) s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    return s.replace(/[\s!-\/:-@\[-`{-~\u00a0-\u00bf\u2000-\u206f\u3000-\u303f\uff01-\uff0f]+/g, '');
  }

  // One contains the other (both not empty)
  function near(a, b) {
    return !!a && !!b && (a === b || a.indexOf(b) >= 0 || b.indexOf(a) >= 0);
  }

  function cleanTrack(t, artist) {
    if (SITE.test(t)) t = t.replace(SITE, '').replace(/^\(\d+\)\s+/, '');
    for (var pass = 0; pass < 2; pass++) {
      t = t.replace(GROUP, function (all, inner) {
        return NOISE.test(inner) || CREDIT.test(inner.trim()) ? '' : all;
      });
    }
    t = t.replace(/\s*(?:\||｜|\/\/).*$/, '');                     // "Song | Official Video"
    t = t.replace(FEAT, '');
    // "Song - Remastered 2011" (but not "Artist - Live Wire Song": what is left
    // must not be just the artist)
    var m, ar = norm(artist);
    while ((m = TAIL.exec(t)) && (VERSION_HEAD.test(m[1]) || VERSION_END.test(m[1])) &&
      !(ar && norm(t.slice(0, m.index)) === ar)) {
      t = t.slice(0, m.index);
    }
    t = t.replace(/["“”„«»]/g, '');
    t = tidy(t);
    var w = /^['‘’「『](.*)['‘’」』]$/.exec(t);
    return w ? tidy(w[1]) : t;
  }

  // The title and artist the player reports → { track, artist, variants, query }.
  // variants: every reading worth looking up, the best first ({ track, artist },
  // the same as the result's), the original title and artist last. query:
  // the words for the free-text search.
  function cleanTitle(title, artist) {
    title = tidy(String(title || ''));
    artist = tidy(String(artist || ''));
    var a = artist, topic = false, vevo = false;
    if (/\s+-\s+topic$/i.test(a)) {          // YouTube Music's channels: "Artist - Topic"
      a = a.replace(/\s+-\s+topic$/i, '');
      topic = true;
    }
    if (/.vevo$/i.test(a)) {                 // "ArtistVEVO"
      a = a.replace(/\s*vevo$/i, '');
      vevo = true;
    }
    a = tidy(a.replace(GROUP, function (all, inner) { return CREDIT.test(inner.trim()) ? '' : all; })
      .replace(/\s+(?:feat\.?|ft\.|featuring)\s.*$/i, ''));
    var channel = vevo || /(?:official|oficial|music|records|tv|channel)$/i.test(a);

    var t = cleanTrack(title, a) || title;
    var best = { track: t, artist: a || artist }, extra = [], query = '';
    // YouTube: "Artist - Song" uploaded by the artist's channel. Otherwise
    // both readings are kept for later: "Song - Something" by the artist, and
    // "Artist - Song" uploaded by someone else.
    var m = topic ? null : DASH.exec(t);
    if (m) {
      var split = { track: tidy(m[2]), artist: tidy(m[1]) };
      if (channel || !a || near(norm(m[1]), norm(a))) {
        best = split;
      } else {
        extra.push({ track: tidy(m[1]), artist: best.artist });
        extra.push(split);
        // Uploaded by someone else: the title holds both the artist and the song
        query = t;
      }
    }
    // Several artists: also the first one alone
    var first = /^(.+?)\s*(?:,|;|\s\/\s|\s&\s|\s[x×]\s)\s*.+$/i.exec(best.artist);
    if (first) extra.push({ track: best.track, artist: tidy(first[1]) });
    extra.push({ track: title, artist: artist });

    var variants = [best], seen = {};
    seen[keyOf(best)] = true;
    extra.forEach(function (v) {
      var k = keyOf(v);
      if (v.track && !seen[k]) {
        seen[k] = true;
        variants.push(v);
      }
    });
    if (!query) query = best.track + (best.artist ? ' ' + best.artist : '');
    // Words only: the service reads some signs as search operators
    query = tidy(query.replace(/[\-–—|\/\\()\[\]{}【】"“”„«»:;!?*^+~<>=#$%&,.]+/g, ' '));
    return { track: best.track, artist: best.artist, variants: variants, query: query };
  }

  function keyOf(v) {
    return v.artist.toLowerCase() + '\n' + v.track.toLowerCase();
  }

  // ---------------------------------------------------------------------------
  // Results
  // ---------------------------------------------------------------------------
  var cache = typeof Map === 'function' ? new Map() : null;

  function cacheGet(key) {
    if (!cache || !cache.has(key)) return null;
    var r = cache.get(key);
    cache.delete(key);      // most recently used last
    cache.set(key, r);
    return r;
  }

  function cachePut(key, r) {
    if (!cache) return;
    cache.delete(key);
    cache.set(key, r);
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }

  function hasText(s) {
    return typeof s === 'string' && !!s.trim();
  }

  function cleanText(s) {
    return hasText(s) ? s.replace(/\r\n?/g, '\n').trim() : '';
  }

  function empty(status) {
    return { status: status, lines: [], plain: '', hasWords: false, match: null };
  }

  // An lrclib.net item → a result ('synced' falls back to 'plain' when its
  // LRC holds no line)
  function result(status, item, source, dur) {
    var r = empty(status);
    r.match = {
      id: item.id,
      track: item.trackName || '',
      artist: item.artistName || '',
      album: item.albumName || '',
      duration: +item.duration || 0,
      source: source
    };
    if (status === 'instrumental') return r;
    r.plain = cleanText(item.plainLyrics);
    if (status === 'synced') {
      var p = parseLRC(item.syncedLyrics, dur || +item.duration || 0);
      if (!p.lines.length) {
        r.status = r.plain ? 'plain' : 'notfound';
        return r;
      }
      r.lines = p.lines;
      r.hasWords = p.hasWords;
      if (!r.plain) {
        r.plain = p.lines.map(function (l) { return l.text; }).filter(Boolean).join('\n');
      }
    }
    return r;
  }

  // The first name of "A, B", "A & B", "A feat. B"…
  var FIRST = /^(.+?)\s*(?:,|;|\s\/\s|\s&\s|\s[x×]\s|\s(?:feat\.?|ft\.?|featuring|with)\s).*$/i;

  function artistFits(item, v) {
    var y = norm(v.artist);
    if (!y) return true;
    var x = norm(item.artistName);
    if (near(x, y)) return true;
    var fx = FIRST.exec(String(item.artistName || '')), fy = FIRST.exec(v.artist);
    return near(norm(fx ? fx[1] : item.artistName), norm(fy ? fy[1] : v.artist));
  }

  // How good a search result is for the reading v of the song (0 = not it):
  // 6 timed and the same duration, 5 timed, 4 plain and the same duration,
  // 3 instrumental and the same duration, 2 plain; half a point more when
  // the title is exactly ours. Both titles are cleaned up first ("Song
  // (Remastered)" is "Song"); a longer or shorter title ("Kite" and "Kite
  // Story"), or another artist, only counts with the same duration.
  function score(item, v, dur) {
    if (!item || typeof item !== 'object') return 0;
    var their = String(item.trackName || ''), a = norm(cleanTrack(their, String(item.artistName || '')) || their);
    var b = norm(cleanTrack(v.track, v.artist) || v.track);
    if (!a || !b) return 0;
    var same = dur > 0 && item.duration != null && isFinite(+item.duration) && Math.abs(+item.duration - dur) <= NEAR;
    var exact = a === b;
    if (!exact && !(same && (a.indexOf(b) >= 0 || b.indexOf(a) >= 0))) return 0;
    if (!same && !artistFits(item, v)) return 0;
    var bonus = exact ? 0.5 : 0;
    if (hasText(item.syncedLyrics)) return (same ? 6 : 5) + bonus;
    if (hasText(item.plainLyrics)) return (same ? 4 : 2) + bonus;
    return item.instrumental && same ? 3 + bonus : 0;
  }

  // Keeps the best untimed find; returns the result when it is timed
  function consider(j, item, s, source) {
    if (!item || !s) return null;
    if (s >= 5) {
      var r = result('synced', item, source, j.dur);
      if (r.status === 'synced') return r;
      s = r.status !== 'plain' ? 0 : s === 6 ? 4 : 2;
      if (!s) return null;
    }
    if (!j.best || s > j.best.s) {
      j.best = { s: s, r: result(s === 3 ? 'instrumental' : 'plain', item, source, j.dur) };
    }
    return null;
  }

  function fromGet(j, d) {
    if (!d || typeof d !== 'object') return null;
    if (d.instrumental) return result('instrumental', d, 'get', j.dur);
    return consider(j, d, hasText(d.syncedLyrics) ? 6 : hasText(d.plainLyrics) ? 4 : 0, 'get');
  }

  function fromSearch(j, list, st) {
    if (!Array.isArray(list)) return null;
    var best = null, bestS = 0, bestD = Infinity;
    for (var i = 0; i < list.length; i++) {
      var s = score(list[i], st.v, j.dur);
      if (!s || s < bestS) continue;
      var d = j.dur > 0 && list[i].duration != null && isFinite(+list[i].duration) ? Math.abs(+list[i].duration - j.dur) : Infinity;
      if (s > bestS || d < bestD) {
        best = list[i];
        bestS = s;
        bestD = d;
      }
    }
    return consider(j, best, Math.floor(bestS), st.source);
  }

  // ---------------------------------------------------------------------------
  // Requests (one at a time)
  // ---------------------------------------------------------------------------
  var CANCELLED = { kind: 'cancelled' };
  var FAILED = { kind: 'error' };
  var NOTFOUND = { kind: 'notfound' };
  var TIMEOUT = { kind: 'timeout' };
  var OFFLINE = { kind: 'offline' };

  var useHeader = true;           // false once the header turned out to be refused (CORS)
  var chain = Promise.resolve();  // the request in flight (never rejects)

  // Retry-After: seconds or an HTTP date
  function retryAfter(res) {
    var v = res.headers && typeof res.headers.get === 'function' ? res.headers.get('Retry-After') : null;
    var s = parseFloat(v);
    if (!isFinite(s)) {
      var d = Date.parse(v);
      s = isFinite(d) ? (d - Date.now()) / 1000 : 2;
    }
    return Math.min(api.maxRetryWait, Math.max(0, s));
  }

  // One fetch → ok (with the JSON), notfound (404, or another answer that
  // the request was not right: 400, 410, 422), busy (429/503, with the wait),
  // cors (a TypeError: the request was refused or the network is down),
  // timeout, error or cancelled
  function attempt(j, url, header, mayWait) {
    return new Promise(function (resolve) {
      if (j.dead) return resolve(CANCELLED);
      var fetchFn = api.fetch;
      if (typeof fetchFn !== 'function') return resolve(FAILED);
      var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      var done = false;
      var timer = setTimeout(function () {
        if (ctrl) ctrl.abort();
        end(TIMEOUT);
      }, api.timeoutMs);
      function end(r) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (j.abort === stop) j.abort = null;
        resolve(r);
      }
      function stop() {
        if (ctrl) ctrl.abort();
        end(CANCELLED);
      }
      j.abort = stop;
      var opts = { method: 'GET' };
      if (header) opts.headers = { 'Lrclib-Client': CLIENT };
      if (ctrl) opts.signal = ctrl.signal;
      var p;
      try { p = fetchFn(url, opts); } catch (e) { p = Promise.reject(e); }
      Promise.resolve(p).then(function (res) {
        if (done) return;
        var code = res.status;
        if (code === 404 || code === 400 || code === 410 || code === 422) return end(NOTFOUND);
        if ((code === 429 || code === 503) && mayWait) return end({ kind: 'busy', wait: retryAfter(res) });
        if (!res.ok) return end(FAILED);
        return res.json().then(function (data) { end({ kind: 'ok', data: data }); });
      }, function (err) {
        // The fetch itself failed: a TypeError is a refused request or no network
        end(err && (err instanceof TypeError || err.name === 'TypeError') ? { kind: 'cors' } : FAILED);
      }).then(null, function () { end(FAILED); });
    });
  }

  // Waits s seconds (cut short when the lookup is cancelled)
  function wait(j, s) {
    return new Promise(function (resolve) {
      var timer = setTimeout(wake, s * 1000);
      function wake() {
        clearTimeout(timer);
        if (j.abort === wake) j.abort = null;
        resolve();
      }
      j.abort = wake;
    });
  }

  // A request with its retries: once without the header when the fetch
  // throws (the header needs a CORS preflight), once after Retry-After when
  // the service is busy. Throwing without the header too: offline.
  function requestOnce(j, url) {
    var triedBare = false, waited = false;
    function go(header) {
      return attempt(j, url, header, !waited).then(function (r) {
        if (r.kind === 'cors') {
          if (!header || triedBare || j.dead) return j.dead ? CANCELLED : OFFLINE;
          triedBare = true;
          return go(false).then(function (r2) {
            if (r2.kind === 'ok' || r2.kind === 'notfound') useHeader = false;
            return r2;
          });
        }
        if (r.kind === 'busy') {
          waited = true;
          return wait(j, r.wait).then(function () { return j.dead ? CANCELLED : go(header); });
        }
        return r;
      });
    }
    return go(useHeader).then(null, function () { return FAILED; });
  }

  function request(j, url) {
    var p = chain.then(function () { return j.dead ? CANCELLED : requestOnce(j, url); })
      .then(null, function () { return FAILED; });
    chain = p;
    return p;
  }

  // ---------------------------------------------------------------------------
  // Lookup
  // ---------------------------------------------------------------------------
  var state = {
    status: 'off',        // off | searching | synced | plain | instrumental | notfound | error
    lines: [],
    plain: '',
    hasWords: false,
    match: null,          // { id, track, artist, album, duration, source } of what was found
    key: ''               // the song (cleaned artist and title)
  };

  var job = null;         // the lookup under way

  function setState(r, key) {
    state.status = r.status;
    state.lines = r.lines;
    state.plain = r.plain;
    state.hasWords = r.hasWords;
    state.match = r.match;
    state.key = key;
  }

  function qs(v) {
    return 'search?track_name=' + encodeURIComponent(v.track) +
      (v.artist ? '&artist_name=' + encodeURIComponent(v.artist) : '');
  }

  function plan(j) {
    var vs = j.c.variants, v = vs[0], steps = [], seen = {};
    function add(st) {
      if (seen[st.url]) return;
      seen[st.url] = true;
      steps.push(st);
    }
    if (v.artist) {
      add({
        get: true, v: v, source: 'get',
        url: API + 'get?track_name=' + encodeURIComponent(v.track) + '&artist_name=' + encodeURIComponent(v.artist) +
          (j.dur > 0 ? '&duration=' + Math.round(j.dur) : '')
      });
    }
    add({ v: v, source: 'search', url: API + qs(v) });
    if (j.c.query) add({ v: v, source: 'q', url: API + 'search?q=' + encodeURIComponent(j.c.query) });
    for (var i = 1; i < vs.length && i <= VARIANTS; i++) add({ v: vs[i], source: 'search', url: API + qs(vs[i]) });
    return steps;
  }

  function finish(j, r, store) {
    if (j.dead || job !== j) return;
    job = null;
    // Kept unless something failed on the way (the timed lyrics may have been
    // in the request that failed: the next time the song plays, ask again)
    if (store && r.status !== 'error' && (r.status === 'synced' || !j.errored)) cachePut(j.key, r);
    setState(r, j.key);
    if (j.cb) {
      try { j.cb(r); } catch (e) { setTimeout(function () { throw e; }); }
    }
  }

  function run(j) {
    j.timer = 0;
    var steps = plan(j), i = 0;
    function next() {
      if (j.dead) return;
      if (i >= steps.length) {
        finish(j, j.best ? j.best.r : empty(j.errored ? 'error' : 'notfound'), true);
        return;
      }
      var st = steps[i++];
      request(j, st.url).then(function (res) {
        if (j.dead) return;
        if (res.kind === 'error' || res.kind === 'timeout' || res.kind === 'offline') {
          j.errored = true;
          // The service cannot be reached: the next requests would fail too
          if (res.kind === 'offline' || (res.kind === 'timeout' && ++j.timeouts >= 2)) i = steps.length;
        } else if (res.kind === 'ok') {
          var found = st.get ? fromGet(j, res.data) : fromSearch(j, res.data, st);
          if (found) {
            finish(j, found, true);
            return;
          }
        }
        next();
      });
    }
    next();
  }

  function cancelJob() {
    if (!job) return;
    job.dead = true;
    clearTimeout(job.timer);
    if (job.abort) job.abort();
    job = null;
  }

  // Looks up the lyrics of meta = { title, artist, album, duration (s, 0 =
  // unknown) } and calls cb(result) once, always later (never during load):
  //   result = { status: 'synced'|'plain'|'instrumental'|'notfound'|'error',
  //              lines, plain, hasWords, match }
  // A newer load() cancels this one (its cb is never called), except a load()
  // of the same song while this one is under way: that one only takes over
  // the callback (and the duration, when it now knows it).
  function load(meta, cb) {
    meta = meta || {};
    var c = cleanTitle(meta.title, meta.artist), key = keyOf(c);
    var dur = +meta.duration > 0 ? +meta.duration : 0;
    if (job && job.key === key) {
      job.cb = cb;
      if (dur) job.dur = dur;
      return;
    }
    cancelJob();
    var j = job = {
      key: key, c: c, dur: dur, cb: cb, dead: false,
      timer: 0, abort: null, best: null, errored: false, timeouts: 0
    };
    var known = c.track ? cacheGet(key) : empty('notfound');
    if (known) {
      setState(known, key);
      j.timer = setTimeout(function () { finish(j, known, false); }, 0);
      return;
    }
    setState(empty('searching'), key);
    // Songs skipped in a quick run: only the last one is looked up
    j.timer = setTimeout(function () { run(j); }, api.debounceMs);
  }

  // Stops the lookup under way (its cb is never called) and clears the lyrics
  function cancel() {
    cancelJob();
    setState(empty('off'), '');
  }

  function clearCache() {
    if (cache) cache.clear();
  }

  var api = {
    parseLRC: parseLRC,
    cleanTitle: cleanTitle,
    lineAt: lineAt,
    load: load,
    cancel: cancel,
    clearCache: clearCache,
    state: state,
    fetch: typeof window.fetch === 'function' ? window.fetch.bind(window) : null,  // tests replace it
    debounceMs: 600,
    timeoutMs: 8000,
    maxRetryWait: 20      // s: the longest Retry-After honored
  };

  S.lyrics = api;
})(window.Lyric = window.Lyric || {});
