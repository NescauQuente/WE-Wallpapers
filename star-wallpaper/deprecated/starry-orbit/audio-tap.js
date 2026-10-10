  // ---------------------------------------------------------------------------
  // Tab audio tap — shared by this project's CasaMOD mods (casamod/build.js
  // writes this file into each mod.js). Every same-origin <audio>/<video> that
  // plays in the tab is routed through one Web Audio analyser; the sound still
  // reaches the speakers. A media element can feed Web Audio only once, so the
  // first mod to load creates the tap and the others reuse it.
  // ---------------------------------------------------------------------------
  var audioTap = window.__casaAudioTap || (window.__casaAudioTap = (function () {
    var tap = { analyser: null, listeners: [] };
    var ctx = null, routed = new WeakSet(), pending = [];

    tap.listen = function (cb) {
      tap.listeners.push(cb);
      if (tap.analyser) cb(tap.analyser);
    };

    function context() {
      if (!ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        tap.analyser = ctx.createAnalyser();
        tap.analyser.fftSize = 4096;
        tap.analyser.smoothingTimeConstant = 0.55;
        tap.analyser.minDecibels = -85;
        tap.analyser.maxDecibels = -25;
        ctx.addEventListener('statechange', function () {
          if (ctx.state === 'running') pending.splice(0).forEach(tryRoute);
        });
        tap.listeners.forEach(function (cb) { cb(tap.analyser); });
      }
      return ctx;
    }

    // Browsers only start audio after a user gesture: unlock on the first one
    function unlock() {
      var c = context();
      if (c && c.state === 'suspended') c.resume();
    }
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (type) {
      window.addEventListener(type, unlock, { capture: true, passive: true });
    });

    function sameOrigin(url) {
      try {
        var u = new URL(url, location.href);
        return u.origin === location.origin || u.protocol === 'blob:' || u.protocol === 'data:';
      } catch (e) {
        return false;
      }
    }

    // Routes a media element through the analyser, once. Returns false when it
    // has to wait for the audio context to start. Cross-origin media would go
    // silent inside Web Audio, so it is left alone.
    function route(el) {
      if (routed.has(el)) return true;
      var src = el.currentSrc || el.src;
      if (!src) return false;
      if (!sameOrigin(src) && !el.crossOrigin) return true;
      var c = context();
      if (!c) return true;
      if (c.state !== 'running') return false;   // never mute media through a suspended context
      try {
        var node = c.createMediaElementSource(el);
        node.connect(c.destination);
        node.connect(tap.analyser);
      } catch (e) {
        // Already connected to another context by someone else: nothing to tap
      }
      routed.add(el);
      return true;
    }

    function tryRoute(el) {
      if (!route(el) && pending.indexOf(el) < 0) pending.push(el);
    }

    var nativePlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      try { tryRoute(this); } catch (e) { /* never break playback */ }
      return nativePlay.apply(this, arguments);
    };
    document.addEventListener('playing', function (e) {
      if (e.target instanceof HTMLMediaElement) tryRoute(e.target);
    }, true);

    return tap;
  })());
