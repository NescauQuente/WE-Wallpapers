/*
 * Lyric Stage — hidden settings menu (M key).
 * Built from the schema in settings.js; every change goes through
 * app.setValue, the same path as the Wallpaper Engine properties.
 * Rebuilt in place when the language changes.
 *
 * Options the menu cannot edit stay in the Wallpaper Engine panel only: those
 * marked menu: false and every type without a control here ('file': a browser
 * page cannot read a local path; 'textinput').
 */
(function (S) {
  'use strict';

  var settings = S.settings, util = S.util, i18n = S.i18n;
  var t = i18n.t;
  var OPEN_KEY = 'lyric-stage-menu-groups';
  var DEFAULT_OPEN = { theme: true, idle: true, show: true, lyrics: true };
  var CONTROLS = { bool: true, color: true, combo: true, slider: true };

  var app, panel = null;
  var inputs = {}, rows = [];
  var presetCustomOpt = null;
  var meter = null, meterCtx = null, meterRAF = null, meterColors = null;
  var audioBtns = null, audioStatus = null;
  var toastEl = null, toastTimer = null;
  var theme = null;

  // Creates an element with properties and children
  function h(tag, props, children) {
    var e = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        if (k === 'class') e.className = props[k];
        else if (k === 'text') e.textContent = props[k];
        else if (k in e) e[k] = props[k];
        else e.setAttribute(k, props[k]);
      });
    }
    (children || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }

  function button(label, title, onClick, cls) {
    var b = h('button', { type: 'button', text: label, title: title || '', class: cls || '' });
    b.addEventListener('click', onClick);
    return b;
  }

  function loadOpenState() {
    try { return JSON.parse(localStorage.getItem(OPEN_KEY) || '{}') || {}; } catch (e) { return {}; }
  }

  function saveOpenState(state) {
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function fmt(s, v) {
    var decimals = (String(s.step).split('.')[1] || '').length;
    return Number(v).toFixed(decimals);
  }

  // ---------------------------------------------------------------------------
  // Colors: the panel follows the wallpaper (its background becomes the panel,
  // its main color the accent)
  // ---------------------------------------------------------------------------
  function hsl(h, s, l, a) {
    return a === undefined
      ? 'hsl(' + h + ', ' + s + '%, ' + l + '%)'
      : 'hsla(' + h + ', ' + s + '%, ' + l + '%, ' + a + ')';
  }

  // c = { hue (degrees), sat (%), bgRGB: [r, g, b] 0–1 }: the main color and
  // the background behind the panel (light backgrounds get a light panel)
  function palette(c) {
    var bg = util.rgbToHsl(c.bgRGB), bh = bg[0], bs = Math.min(bg[1], 70);
    var h = c.hue, s = Math.min(c.sat, 90);
    var light = util.luminance(c.bgRGB) > 0.3;   // a bright background (Windows 11 light) gets a light panel
    var al = light ? 38 : s < 12 ? 82 : 68; // accent lightness readable on the panel
    var panelL = light ? util.clamp(bg[2], 90, 97) : util.clamp(bg[2], 6, 13);
    function accent(alpha) { return hsl(h, s, al, alpha); }
    return {
      scheme: light ? 'light' : 'dark',
      vars: {
        '--ls-panel-bg': hsl(bh, bs, panelL, light ? 0.9 : 0.86),
        '--ls-panel-solid': hsl(bh, bs, panelL),
        '--ls-panel-raised': light ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.05)',
        '--ls-panel-well': light ? 'rgba(0, 0, 0, 0.07)' : 'rgba(0, 0, 0, 0.28)',
        '--ls-panel-border': accent(light ? 0.32 : 0.18),
        '--ls-panel-divider': accent(light ? 0.16 : 0.09),
        '--ls-panel-scroll': accent(0.3),
        '--ls-panel-text': light ? hsl(h, Math.min(s, 35), 14) : hsl(h, Math.min(s, 45), 92),
        '--ls-panel-muted': light ? hsl(h, Math.min(s, 20), 38) : hsl(h, Math.min(s, 25), 68),
        '--ls-panel-accent': accent(),
        '--ls-panel-accent-soft': accent(light ? 0.14 : 0.18),
        '--ls-panel-danger': light ? '#c62828' : '#ff8f8f'
      }
    };
  }

  function applyTheme(el) {
    if (!el || !theme) return;
    Object.keys(theme.vars).forEach(function (k) { el.style.setProperty(k, theme.vars[k]); });
    el.style.colorScheme = theme.scheme;
  }

  function setTheme(c) {
    var next = palette(c);
    if (theme && JSON.stringify(theme) === JSON.stringify(next)) return;
    theme = next;
    applyTheme(panel);
    applyTheme(toastEl);
    if (panel && !panel.hidden) readMeterColors();
  }

  // ---------------------------------------------------------------------------
  // Building
  // ---------------------------------------------------------------------------
  function buildRow(s) {
    var id = 'ls-opt-' + s.key;
    var row = h('div', { class: 'ls-row ls-row-' + s.type });
    var label = h('label', { text: t('s.' + s.key, s.label), htmlFor: id });
    var inp;

    if (s.type === 'bool') {
      inp = h('input', { type: 'checkbox', id: id });
      inp.addEventListener('change', function () { app.setValue(s.key, inp.checked); });
      row.append(label, inp);
    } else if (s.type === 'color') {
      inp = h('input', { type: 'color', id: id });
      inp.addEventListener('input', function () { app.setValue(s.key, util.hexToWe(inp.value)); });
      row.append(label, inp);
    } else if (s.type === 'combo') {
      inp = h('select', { id: id });
      s.options.forEach(function (o) { inp.appendChild(h('option', { value: o[0], text: t('o.' + s.key + '.' + o[0], o[1]) })); });
      if (s.key === 'preset') {
        presetCustomOpt = h('option', { value: 'custom', text: t('menu.custom'), disabled: true });
        inp.appendChild(presetCustomOpt);
      }
      inp.addEventListener('change', function () { app.setValue(s.key, inp.value); });
      row.append(label, inp);
    } else {
      inp = h('input', { type: 'range', id: id, min: s.min, max: s.max, step: s.step });
      var val = h('span', { class: 'ls-val' });
      inp.valEl = val;
      inp.addEventListener('input', function () {
        val.textContent = fmt(s, inp.value);
        if (!s.release) app.setValue(s.key, Number(inp.value));
      });
      // Heavy options only apply when the slider is released
      if (s.release) inp.addEventListener('change', function () { app.setValue(s.key, Number(inp.value)); });
      row.append(label, val, inp);
    }

    inputs[s.key] = inp;
    rows.push({ s: s, el: row });
    return row;
  }

  function buildAudioSource() {
    var wrap = h('div', { class: 'ls-audio-src' });
    meter = h('canvas', { class: 'ls-meter', width: 288, height: 40, title: t('audio.meterTitle') });

    if (!app.isWE) {
      audioBtns = {
        mic: button(t('audio.mic'), t('audio.micTitle'), function () { start(app.audio.useMic); }),
        display: button(t('audio.display'), t('audio.displayTitle'), function () { start(app.audio.useDisplay); }),
        stop: button(t('audio.stop'), t('audio.stopTitle'), function () { app.audio.stop(); })
      };
      audioStatus = h('div', { class: 'ls-status' });
      wrap.append(h('div', { class: 'ls-btns' }, [audioBtns.mic, audioBtns.display, audioBtns.stop]), audioStatus);
      app.audio.state.onSourceChange = updateAudioStatus;
      updateAudioStatus();
    }

    wrap.appendChild(meter);
    return wrap;
  }

  function start(fn) {
    setAudioStatus(t('audio.waiting'));
    fn().catch(function (err) {
      var name = err && err.name;
      var msg = name === 'NotAllowedError' ? t('audio.denied')
        : name === 'NoAudioError' ? t('audio.noAudio')
        : name === 'NotFoundError' ? t('audio.noMic')
        : name === 'UnsupportedError' ? t('audio.unsupported')
        : t('audio.failed');
      updateAudioStatus();
      setAudioStatus(msg, true);
    });
  }

  function setAudioStatus(msg, isError) {
    if (!audioStatus) return;
    audioStatus.textContent = msg;
    audioStatus.classList.toggle('ls-error', !!isError);
  }

  function updateAudioStatus() {
    if (!audioBtns) return;
    var src = app.audio.state.source;
    setAudioStatus(src === 'mic' ? t('audio.listeningMic')
      : src === 'display' ? t('audio.listeningDisplay')
      : t('audio.none'));
    audioBtns.mic.classList.toggle('ls-active', src === 'mic');
    audioBtns.display.classList.toggle('ls-active', src === 'display');
    audioBtns.stop.disabled = !src;
  }

  function buildShare() {
    var ta = h('textarea', { rows: 3, spellcheck: false, dir: 'ltr', placeholder: t('share.placeholder') });
    var msg = h('div', { class: 'ls-io-msg' });
    var applyBtn = button(t('share.apply'), t('share.applyTitle'), onApply, 'ls-primary');
    var box = h('div', { class: 'ls-io', hidden: true }, [
      ta, msg,
      h('div', { class: 'ls-btns' }, [applyBtn, button(t('share.close'), '', function () { box.hidden = true; })])
    ]);

    function setMsg(text, isError) {
      msg.textContent = text;
      msg.classList.toggle('ls-error', !!isError);
    }

    function onExport() {
      var code = app.exportCode();
      ta.value = code;
      ta.readOnly = true;
      applyBtn.hidden = true;
      box.hidden = false;
      ta.select();
      var done = function () { setMsg(t('share.copied')); };
      var fail = function () { setMsg(t('share.copyManual')); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, fail);
      else fail();
    }

    function onImport() {
      ta.value = '';
      ta.readOnly = false;
      applyBtn.hidden = false;
      box.hidden = false;
      setMsg(t('share.pasteHint'));
      ta.focus();
    }

    function onApply() {
      if (app.importCode(ta.value)) {
        box.hidden = true;
        toast(t('toast.imported'));
      } else {
        setMsg(t('share.invalid'), true);
      }
    }

    return h('section', { class: 'ls-share' }, [
      h('h4', { text: t('share.title') }),
      h('div', { class: 'ls-btns' }, [
        button(t('share.export'), t('share.exportTitle'), onExport),
        button(t('share.import'), t('share.importTitle'), onImport)
      ]),
      box
    ]);
  }

  function build() {
    inputs = {};
    rows = [];
    presetCustomOpt = null;
    audioBtns = audioStatus = null;

    panel = h('aside', { id: 'ls-settings', hidden: true, 'aria-label': t('menu.title'), lang: i18n.locale(), dir: i18n.dir() });
    applyTheme(panel);

    panel.appendChild(h('header', null, [
      h('div', { class: 'ls-title' }, [h('strong', { text: 'Lyric Stage' }), h('span', { text: t('menu.title') })]),
      button(t('menu.reset'), t('menu.resetTitle'), function () {
        app.reset();
        toast(t('toast.reset'));
      }),
      button('✕', t('menu.close'), toggle, 'ls-icon')
    ]));

    var scroll = h('div', { class: 'ls-scroll' });
    var openState = loadOpenState();

    settings.GROUPS.forEach(function (g) {
      var items = settings.SCHEMA.filter(function (s) { return s.group === g.id && s.menu !== false && CONTROLS[s.type]; });
      if (!items.length) return;

      // "General" (language) stays pinned at the top, outside the collapsible groups
      if (g.id === 'general') {
        var top = h('div', { class: 'ls-general' });
        items.forEach(function (s) { top.appendChild(buildRow(s)); });
        scroll.appendChild(top);
        return;
      }

      var det = h('details', { class: 'ls-group' });
      det.open = g.id in openState ? !!openState[g.id] : !!DEFAULT_OPEN[g.id];
      det.addEventListener('toggle', function () {
        openState[g.id] = det.open;
        saveOpenState(openState);
      });
      det.appendChild(h('summary', { text: t('g.' + g.id, g.label) }));
      if (g.id === 'audio') det.appendChild(buildAudioSource());
      items.forEach(function (s) { det.appendChild(buildRow(s)); });
      scroll.appendChild(det);
    });

    scroll.appendChild(buildShare());
    scroll.appendChild(h('p', { class: 'ls-hint', text: t('menu.hint') }));
    panel.appendChild(scroll);
    document.body.appendChild(panel);
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  function sync() {
    if (!panel) return;
    var v = app.getValues();
    settings.SCHEMA.forEach(function (s) {
      var inp = inputs[s.key];
      if (!inp) return;
      var x = v[s.key];
      if (s.type === 'bool') inp.checked = !!x;
      else if (s.type === 'color') inp.value = util.weToHex(x);
      else if (s.type === 'combo') inp.value = x;
      else {
        if (document.activeElement !== inp) inp.value = x;
        inp.valEl.textContent = fmt(s, x);
      }
    });
    if (presetCustomOpt) presetCustomOpt.hidden = v.preset !== 'custom';
    rows.forEach(function (r) { r.el.hidden = !settings.condMet(r.s.cond, v); });
  }

  function drawMeter() {
    if (!meter || !panel || panel.hidden) { meterRAF = null; return; }
    if (!meterCtx || meterCtx.canvas !== meter) meterCtx = meter.getContext('2d');
    var c = meterCtx, W = meter.width, H = meter.height;
    var st = app.audio.state, bands = st.bands, n = bands.length, bw = W / n;
    var since = performance.now() - st.lastBeat, flash = since < 180 ? 1 - since / 180 : 0;
    c.clearRect(0, 0, W, H);
    for (var i = 0; i < n; i++) {
      var bh = Math.max(1, bands[i] * (H - 4));
      // Bass bands in the text color (they flash on beats), the rest in the accent
      c.globalAlpha = i < 6 ? 0.55 + 0.45 * flash : 0.7;
      c.fillStyle = i < 6 ? meterColors.bass : meterColors.bar;
      c.fillRect(i * bw + 0.5, H - bh, Math.max(1, bw - 1), bh);
    }
    c.globalAlpha = 1;
    meterRAF = requestAnimationFrame(drawMeter);
  }

  // The meter is a canvas: it takes its colors from the panel's CSS variables
  function readMeterColors() {
    var cs = getComputedStyle(panel);
    meterColors = {
      bar: cs.getPropertyValue('--ls-panel-accent').trim() || '#7aa2ff',
      bass: cs.getPropertyValue('--ls-panel-text').trim() || '#dde5ff'
    };
  }

  function startMeter() {
    if (!meter) return;
    readMeterColors();
    var dpr = window.devicePixelRatio || 1;
    meter.width = Math.round(meter.clientWidth * dpr) || 288;
    meter.height = Math.round(40 * dpr);
    if (!meterRAF) meterRAF = requestAnimationFrame(drawMeter);
  }

  function toggle() {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      sync();
      startMeter();
    }
  }

  // Rebuilds the panel in the current language, keeping it open and scrolled
  function relabel() {
    if (!panel) return;
    var wasOpen = !panel.hidden;
    var scrollEl = panel.querySelector('.ls-scroll');
    var scrollTop = scrollEl ? scrollEl.scrollTop : 0;
    if (meterRAF) { cancelAnimationFrame(meterRAF); meterRAF = null; }
    panel.remove();
    build();
    sync();
    if (wasOpen) {
      panel.hidden = false;
      panel.querySelector('.ls-scroll').scrollTop = scrollTop;
      startMeter();
    }
  }

  function toast(msg, ms) {
    if (!toastEl) {
      toastEl = h('div', { id: 'ls-toast', role: 'status' });
      applyTheme(toastEl);
      document.body.appendChild(toastEl);
    }
    toastEl.lang = i18n.locale();
    toastEl.dir = i18n.dir();
    toastEl.textContent = msg;
    toastEl.classList.add('ls-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('ls-show'); }, ms || 2200);
  }

  function init(a) {
    app = a;
    build();
    sync();

    window.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      var target = e.target, tag = target && target.tagName;
      if (tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && target.type === 'text')) {
        if (e.key === 'Escape') target.blur();
        return;
      }
      if (e.key === 'm' || e.key === 'M') toggle();
      else if (e.key === 'Escape' && !panel.hidden) toggle();
    });
  }

  function open() {
    if (panel && panel.hidden) toggle();
  }

  S.menu = { init: init, sync: sync, toggle: toggle, open: open, toast: toast, relabel: relabel, setTheme: setTheme };
})(window.Lyric = window.Lyric || {});
