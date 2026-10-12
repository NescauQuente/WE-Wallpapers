/*
 * Lyric Stage — where we are in the song, in seconds (the lyrics follow it).
 *
 * The players that report the timeline send the position now and then, not
 * every frame: between two reports the clock runs on its own. A report close
 * to the clock's estimate (within 1 s) is blended in over a fraction of a
 * second so the lyrics never jump: when the clock was behind it speeds up a
 * little, when it was ahead it slows down (at most it stands still for a
 * moment, it never runs backwards). A report farther away is a seek: the
 * clock jumps there. Without any report (the player does not tell) the clock
 * starts at 0 when the song starts playing, which is right when the song is
 * heard from its start. Pausing freezes the clock, blending included.
 *
 * Reports are snapshots that can reach us late (the player took them a
 * moment before), never early: so a report a little behind the clock is
 * most likely stale and does not pull the lyrics back. Only when several in a
 * row are all behind does the clock step back, by the smallest of those leads
 * (the freshest report). A report ahead of the clock is always taken.
 *
 * Every call takes the time from the caller (performance.now(), in ms), so
 * the clock is deterministic: the tests pass the times they want. A call
 * without a time uses performance.now().
 */
(function (S) {
  'use strict';

  var BLEND = 0.4;    // s of play: how long a small correction takes to blend in
  var SNAP = 1.0;     // s: a report farther than this from the estimate is a seek
  var STALE = 2.5;   // s: a report up to this far behind the clock may just be late
  var BEHIND = 3;     // reports in a row behind the clock before it steps back
  var LOOP = 1.5;     // s: a repeated start report this close to the end may be the song starting over

  // The caller's time, or now when it gave none (a missing time would stop the clock)
  function ms(nowMs) {
    if (typeof nowMs === 'number' && isFinite(nowMs)) return nowMs;
    return window.performance && performance.now ? performance.now() : Date.now();
  }

  function make() {
    var playing = false;
    var base = 0;       // the song's true position (s) at baseAt…
    var baseAt = -1;    // …in ms; -1 = this song's clock has not started yet
    var gap = 0;        // shown minus true position at baseAt (s): the
    var gapRate = 0;    // correction still to blend in, and how fast it closes
                        // (s per second of play)
    var has = false;    // a real report arrived for this song
    var dur = 0;        // s, 0 = unknown
    var lastPos = -1, lastDur = -1;   // the last report
    var loopAt = -1, loopPos = 0;     // a start report repeated near the end (ms, s), -1 = none
    var fresh = true;   // the next report is taken as is (new song, after a pause)
    var leads = [];     // how far behind the clock the last reports were (s)

    // Seconds of play since baseAt (none while paused)
    function played(nowMs) {
      if (!playing || baseAt < 0) return 0;
      var s = (nowMs - baseAt) / 1000;
      return s > 0 ? s : 0;
    }

    // What is left of the correction after s seconds of play
    function gapAfter(s) {
      if (gap === 0) return 0;
      var g = (gap > 0 ? gap : -gap) - gapRate * s;
      if (g <= 0) return 0;
      return gap > 0 ? g : -g;
    }

    // Moves the anchor to nowMs; the position keeps the same course
    function rebase(nowMs) {
      var s = played(nowMs);
      base += s;
      gap = gapAfter(s);
      if (gap === 0) gapRate = 0;
      baseAt = nowMs;
    }

    // The smooth position at nowMs (s), between 0 and the duration when known.
    // A song that is playing but whose clock has not started yet starts now.
    function position(nowMs) {
      nowMs = ms(nowMs);
      if (baseAt < 0 && playing) baseAt = nowMs;
      var s = played(nowMs), p = base + s + gapAfter(s);
      if (dur > 0 && p >= dur) {
        if (loopAt >= 0) {
          // The song played to its end and had started over (see timeline)
          base = loopPos;
          baseAt = loopAt;
          gap = gapRate = 0;
          loopAt = -1;
          return position(nowMs);
        }
        p = dur;
      }
      return p > 0 ? p : 0;
    }

    // A new song: forget everything but whether the player is playing. With
    // nowMs the new song's clock starts there; without it, at the next call
    // that passes a time.
    function reset(nowMs) {
      base = 0;
      gap = 0;
      gapRate = 0;
      has = false;
      dur = 0;
      lastPos = lastDur = -1;
      loopAt = -1;
      fresh = true;
      leads.length = 0;
      baseAt = typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : -1;
    }

    function setPlaying(p, nowMs) {
      nowMs = ms(nowMs);
      p = !!p;
      if (p === playing) {
        if (p && baseAt < 0) baseAt = nowMs;
        return;
      }
      loopAt = -1;
      rebase(nowMs);
      playing = p;
      fresh = true;
      leads.length = 0;
    }

    // A real report: the song is at `pos` (s) at nowMs; d = its duration (0 = unknown)
    function timeline(pos, d, nowMs) {
      pos = +pos;
      d = +d;
      if (!isFinite(pos) || pos < 0) return;
      if (!isFinite(d) || d < 0) d = 0;
      nowMs = ms(nowMs);
      // Some players repeat their last report while the song goes on: stale.
      // A start report repeated at the end of the song may be the song
      // starting over (repeat one): it applies if the clock reaches the end.
      if (has && playing && pos === lastPos && d === lastDur) {
        if (dur > 0 && pos < LOOP && position(nowMs) >= dur - LOOP) {
          loopAt = nowMs;
          loopPos = pos;
        }
        return;
      }
      loopAt = -1;
      lastPos = pos;
      lastDur = d;
      if (d > 0) dur = d;
      var shown = position(nowMs);
      var diff = shown - pos;
      if (!fresh && playing && diff > 0 && diff <= STALE) {
        // Behind the clock: probably a late snapshot. Step back only when the
        // last few all were, and only by the smallest lead
        leads.push(diff);
        if (leads.length > BEHIND) leads.shift();
        if (leads.length < BEHIND) { has = true; return; }
        diff = Math.min.apply(null, leads);
        leads.length = 0;
        if (diff < 0.15) { has = true; return; }
        pos = shown - diff;
      } else {
        leads.length = 0;
      }
      fresh = false;
      rebase(nowMs);
      base = pos;
      if (diff > SNAP || diff < -SNAP) {
        gap = 0;
        gapRate = 0;
      } else {
        // Behind: catch up in BLEND. Ahead: slow down, at most to a standstill
        // (a 0.8 s lead waits 0.8 s), so the position never goes backwards.
        gap = diff;
        gapRate = diff > 0 ? diff / Math.max(BLEND, diff) : -diff / BLEND;
      }
      has = true;
    }

    return {
      reset: reset,
      setPlaying: setPlaying,
      timeline: timeline,
      position: position,
      synced: function () { return has; },
      duration: function () { return dur; },
      playing: function () { return playing; },
      create: make     // a separate clock (tests)
    };
  }

  S.songclock = make();
})(window.Lyric = window.Lyric || {});
