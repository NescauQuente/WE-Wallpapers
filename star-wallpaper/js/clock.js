/*
 * Starry Orbit — clock and date (HTML overlay for crisp text).
 * The date follows the wallpaper language (i18n.locale()). Below them, the
 * song playing (Wallpaper Engine media integration), which fades in anew on
 * every track change.
 */
(function (S) {
  'use strict';

  var util = S.util, i18n = S.i18n;

  var FONTS = {
    segoe: { family: "'Segoe UI Light', 'Segoe UI', system-ui, -apple-system, sans-serif", weight: 300, spacing: '0.02em' },
    bahnschrift: { family: "Bahnschrift, 'DIN Alternate', 'Segoe UI', sans-serif", weight: 300, spacing: '0.06em' },
    consolas: { family: "Consolas, 'Cascadia Mono', 'SF Mono', monospace", weight: 400, spacing: '0' },
    georgia: { family: "Georgia, 'Times New Roman', serif", weight: 400, spacing: '0.01em' }
  };

  var root, inner, hmEl, secEl, ampmEl, dateEl, songEl, songTitle, songArtist;
  var cfg = null, dateFmt = null, timer = null, lastPulse = 1, paused = false;
  var song = { title: '', artist: '', track: -1 }, songTimer = null;

  function el(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  function init() {
    root = el('div');
    root.id = 'so-clock';
    root.hidden = true;
    root.setAttribute('aria-hidden', 'true');
    inner = el('div', 'so-clock-inner');
    var time = el('div', 'so-clock-time');
    hmEl = el('span', 'so-hm');
    secEl = el('span', 'so-sec');
    ampmEl = el('span', 'so-ampm');
    time.append(hmEl, secEl, ampmEl);
    dateEl = el('div', 'so-clock-date');
    songEl = el('div', 'so-clock-song');
    songTitle = el('div', 'so-song-title');
    songArtist = el('div', 'so-song-artist');
    songEl.append(songTitle, songArtist);
    inner.append(time, dateEl, songEl);
    root.appendChild(inner);
    document.body.appendChild(root);
  }

  // c = derived config; box = screen area (CSS px) that holds the clock
  function apply(c, box) {
    cfg = c;
    clearTimeout(timer);
    timer = null;
    root.hidden = !c.clock;
    if (!c.clock) return;

    root.style.left = box.left + 'px';
    root.style.width = box.width + 'px';
    root.dataset.pos = c.clockpos;

    var f = FONTS[c.clockfont] || FONTS.segoe;
    root.style.fontFamily = f.family;
    root.style.fontWeight = f.weight;
    root.style.letterSpacing = f.spacing;
    root.style.setProperty('--so-clock-size', c.clocksize);

    var rgb = util.parseColor(c.clockcolor).map(function (v) { return Math.round(v * 255); });
    root.style.color = 'rgba(' + rgb.join(', ') + ', ' + c.clockopacity + ')';
    root.style.textShadow = c.clockglow
      ? '0 0 0.18em hsla(' + c.hue + ', ' + c.sat + '%, 65%, 0.55), 0 0 0.6em hsla(' + c.hue + ', ' + c.sat + '%, 55%, 0.35)'
      : 'none';

    dateEl.hidden = !c.clockdate;
    showSong();
    try {
      dateFmt = new Intl.DateTimeFormat(i18n.locale(), { weekday: 'long', day: 'numeric', month: 'long' });
    } catch (e) {
      dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    }
    tick();
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function tick() {
    var now = new Date(), hh = now.getHours(), twelve = cfg.clockformat === '12', ampm = '';
    if (twelve) {
      ampm = hh >= 12 ? 'PM' : 'AM';
      hh = hh % 12 || 12;
    }
    hmEl.textContent = (twelve ? hh : pad(hh)) + ':' + pad(now.getMinutes());
    secEl.textContent = cfg.clockseconds ? ':' + pad(now.getSeconds()) : '';
    ampmEl.textContent = ampm;
    if (cfg.clockdate) {
      var d = dateFmt.format(now);
      dateEl.textContent = d.charAt(0).toUpperCase() + d.slice(1);
    }
    // Sync with the turn of the second
    if (!paused) timer = setTimeout(tick, 1000 - now.getMilliseconds() + 10);
  }

  // While the wallpaper is paused the clock stops too, and catches up on resume
  function setPaused(value) {
    paused = value;
    clearTimeout(timer);
    timer = null;
    if (!paused && cfg && cfg.clock) tick();
  }

  // m = { playing, title, artist, track } (media.js state)
  function setSong(m) {
    var visible = !!(m.playing && m.title);
    var fresh = m.track !== song.track || !visible !== !song.visible;
    song = { title: m.title, artist: m.artist, track: m.track, visible: visible };
    if (fresh) showSong(true);
  }

  // A new song fades out the old one, then fades in
  function showSong(animate) {
    if (!songEl || !cfg) return;
    var on = cfg.clock && cfg.clocksong && song.visible;
    clearTimeout(songTimer);
    if (!on) {
      songEl.classList.remove('so-show');
      return;
    }
    var wasShown = songEl.classList.contains('so-show');
    function fill() {
      songTitle.textContent = song.title;
      songArtist.textContent = song.artist;
      songArtist.hidden = !song.artist;
      songEl.classList.add('so-show');
    }
    if (animate && wasShown) {
      songEl.classList.remove('so-show');
      songTimer = setTimeout(fill, 600);
    } else {
      fill();
    }
  }

  function setPulse(s) {
    if (Math.abs(s - lastPulse) < 0.001) return;
    lastPulse = s;
    inner.style.transform = s === 1 ? '' : 'scale(' + s.toFixed(4) + ')';
  }

  S.clock = { init: init, apply: apply, setPulse: setPulse, setPaused: setPaused, setSong: setSong };
})(window.Starry = window.Starry || {});
