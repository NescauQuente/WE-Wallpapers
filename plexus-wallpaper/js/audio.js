/*
 * Neural Plexus — audio.
 *
 * Sources:
 *  - Wallpaper Engine: wallpaperRegisterAudioListener delivers 128 values
 *    (64 bands for the left channel + 64 for the right, bass to treble).
 *  - Browser: microphone or tab/screen audio via Web Audio, converted to the
 *    same 64 bands (log scale from 30 Hz to 16 kHz).
 *
 * Output (state): smoothed, normalized bands (0–1), bass, volume, beat
 * detection (onBeat), treble hits (onTreble), drops (onDrop) and time spent
 * in silence.
 */
(function (S) {
  'use strict';

  var BANDS = 64;
  var BASS_BANDS = 6;
  var PEAK_FLOOR = 0.02;

  var raw = new Float32Array(BANDS);
  var smooth = new Float32Array(BANDS);
  var peaks = new Float32Array(BANDS);

  var state = {
    bands: smooth,
    bass: 0,
    volume: 0,
    raw: 0,
    silentFor: 0,
    treble: 0,
    lastBeat: 0,
    lastTreble: 0,
    lastDrop: 0,
    source: null,          // 'we' | 'mic' | 'display' | null
    onBeat: null,          // function (strength 0.45–1.4)
    onTreble: null,        // function (strength 0.4–1.2): sharp treble hits (hi-hats, snares)
    onDrop: null,          // function (strength 0.4–1): the bass slams back after a build-up
    onSourceChange: null
  };

  var TREBLE_FROM = 40;
  var beatAvg = 0, beatCool = 0, prevBass = 0;
  var trebleAvg = 0, trebleCool = 0, prevTreble = 0;
  var lull = 0, dropCool = 0;
  var DROP_LULL = 2.5;       // seconds of music without bass that make a build-up
  var DROP_COOLDOWN = 25;    // a drop at most this often

  // Merge both channels into 64 bands
  function feed(arr) {
    for (var i = 0; i < BANDS; i++) {
      raw[i] = ((arr[i] || 0) + (arr[i + BANDS] || 0)) / 2;
    }
  }

  if (typeof window.wallpaperRegisterAudioListener === 'function') {
    window.wallpaperRegisterAudioListener(feed);
    state.source = 'we';
  }

  // ---------------------------------------------------------------------------
  // Browser capture
  // ---------------------------------------------------------------------------
  var CAPTURE = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  var actx = null, analyser = null, srcNode = null, stream = null, freqData = null, edges = null;

  function computeEdges(sampleRate, fftSize) {
    var binHz = sampleRate / fftSize, fMin = 30, fMax = 16000;
    var e = new Uint16Array(BANDS + 1);
    for (var i = 0; i <= BANDS; i++) {
      e[i] = Math.max(1, Math.round(fMin * Math.pow(fMax / fMin, i / BANDS) / binHz));
      if (i > 0 && e[i] <= e[i - 1]) e[i] = e[i - 1] + 1;
    }
    return e;
  }

  // Read the analyser and write in the same format Wallpaper Engine uses
  function pump() {
    if (!analyser) return;
    analyser.getByteFrequencyData(freqData);
    for (var b = 0; b < BANDS; b++) {
      var m = 0;
      for (var k = edges[b]; k < edges[b + 1] && k < freqData.length; k++) if (freqData[k] > m) m = freqData[k];
      var v = m / 255;
      raw[b] = v * v;
    }
  }

  function changed() {
    if (state.onSourceChange) state.onSourceChange(state.source);
  }

  function release() {
    if (srcNode) srcNode.disconnect();
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    srcNode = analyser = stream = null;
  }

  function attach(s, kind) {
    release();
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!actx) actx = new AC();
    if (actx.state === 'suspended') actx.resume();

    analyser = actx.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0.3;
    analyser.minDecibels = -85;
    analyser.maxDecibels = -25;
    srcNode = actx.createMediaStreamSource(s);
    srcNode.connect(analyser);
    freqData = new Uint8Array(analyser.frequencyBinCount);
    edges = computeEdges(actx.sampleRate, analyser.fftSize);

    stream = s;
    state.source = kind;
    // If the user stops sharing from the browser UI
    s.getTracks().forEach(function (t) {
      t.addEventListener('ended', function () { if (stream === s) stop(); });
    });
    changed();
  }

  function unsupported() {
    var e = new Error('unsupported');
    e.name = 'UnsupportedError';
    return Promise.reject(e);
  }

  function useMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return unsupported();
    return navigator.mediaDevices.getUserMedia({ audio: CAPTURE }).then(function (s) { attach(s, 'mic'); });
  }

  // A tab or the whole screen (on Windows, "Share system audio"). Browsers
  // require the video too, but only the audio is used: ask for a small,
  // slow picture so capturing it costs little
  var DISPLAY_VIDEO = { frameRate: 1, width: 320, height: 180 };

  function useDisplay() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) return unsupported();
    return navigator.mediaDevices.getDisplayMedia({ video: DISPLAY_VIDEO, audio: CAPTURE }).then(function (s) {
      if (!s.getAudioTracks().length) {
        s.getTracks().forEach(function (t) { t.stop(); });
        var e = new Error('noaudio');
        e.name = 'NoAudioError';
        throw e;
      }
      attach(s, 'display');
    });
  }

  function stop() {
    release();
    if (state.source !== 'we') state.source = null;
    raw.fill(0);
    changed();
  }

  // ---------------------------------------------------------------------------
  // Per-frame processing
  // ---------------------------------------------------------------------------
  function update(dt, enabled, sens) {
    pump();

    // A hit shows up at once (within a frame); it fades out more gently
    var attack = 1 - Math.exp(-dt * 80);
    var decay = 1 - Math.exp(-dt * 8);
    var peakDecay = Math.exp(-dt * 0.15);
    var sum = 0, rawSum = 0, bassSum = 0, trebleSum = 0;

    for (var i = 0; i < BANDS; i++) {
      var v = enabled ? raw[i] : 0;
      rawSum += v;
      // Adaptive per-band normalization: (weak) treble bands react too
      peaks[i] = Math.max(peaks[i] * peakDecay, v, PEAK_FLOOR);
      var n = Math.min(1, v / peaks[i]);
      var cur = smooth[i];
      cur += (n - cur) * (n > cur ? attack : decay);
      smooth[i] = cur;
      sum += cur;
      if (i < BASS_BANDS) bassSum += cur;
      else if (i >= TREBLE_FROM) trebleSum += cur;
    }

    state.volume = sum / BANDS;
    state.bass = bassSum / BASS_BANDS;
    state.treble = trebleSum / (BANDS - TREBLE_FROM);
    state.raw = rawSum / BANDS;
    state.silentFor = state.raw < 0.001 ? state.silentFor + dt : 0;

    // Beat: bass rising well above its recent average
    var b = state.bass * sens;
    beatAvg += (b - beatAvg) * (1 - Math.exp(-dt * 1.5));
    beatCool -= dt;
    if (enabled && b > prevBass && b > 0.32 && b > beatAvg * 1.25 + 0.1 && beatCool <= 0) {
      beatCool = 0.28;
      state.lastBeat = performance.now();
      if (state.onBeat) state.onBeat(Math.min(1.4, Math.max(0.45, (b - beatAvg) * 2.2)));
    }
    prevBass = b;

    // Treble hit: same idea, shorter cooldown (hi-hats are fast)
    var tr = state.treble * sens;
    trebleAvg += (tr - trebleAvg) * (1 - Math.exp(-dt * 2));
    trebleCool -= dt;
    if (enabled && tr > prevTreble && tr > 0.25 && tr > trebleAvg * 1.15 + 0.06 && trebleCool <= 0) {
      trebleCool = 0.1;
      state.lastTreble = performance.now();
      if (state.onTreble) state.onTreble(Math.min(1.2, Math.max(0.4, (tr - trebleAvg) * 2.5)));
    }
    prevTreble = tr;

    // Drop: music keeps playing with little bass for a while (the build-up),
    // then the bass slams back. Silence between songs is not a build-up.
    dropCool -= dt;
    if (enabled && state.volume > 0.12) {
      if (state.bass < 0.28) {
        lull = Math.min(lull + dt, 12);
      } else if (state.bass > 0.62 && lull >= DROP_LULL) {
        if (dropCool <= 0) {
          dropCool = DROP_COOLDOWN;
          state.lastDrop = performance.now();
          if (state.onDrop) state.onDrop(Math.min(1, 0.4 + lull / 10));
        }
        lull = 0;
      } else if (state.bass > 0.45) {
        lull = Math.max(0, lull - dt * 2);
      }
    } else {
      lull = 0;
    }
  }

  S.audio = {
    BANDS: BANDS,
    state: state,
    feed: feed,
    update: update,
    useMic: useMic,
    useDisplay: useDisplay,
    attach: attach,
    stop: stop
  };
})(window.Plexus = window.Plexus || {});
