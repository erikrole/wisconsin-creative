/* Timelapse core — setting, roll time and clip length for the team's Sony bodies.
   Client-only: no network requests. Settings and theme live in localStorage.

   Every limit below is from Sony's Help Guides (helpguide.sony.net, NTSC):
   - S&Q Settings: quick-motion rates 240/120/60/30/15/8/4/2/1 fps against a
     23.98/29.97/59.94/119.88p record rate, on all five bodies. Sony computes
     speed from nominal rates (30 ÷ 8 = 3.75), and so do we.
   - Time-lapse movie (A7 V, A1 II, A9 III only): 1–10 s in 1 s steps, then
     20–60 s in 10 s steps; 4K cannot go past 5 s; 24/30/60p.
   - Interval Shoot Func. (all five, FX3 included): 1–60 s, 1–9999 shots.
   - Bitrates: Movie Settings tables, which S&Q and Time-lapse use as-is.
   - File sizes: derived from each body's "number of recordable images"
     table (card size ÷ count), so they are approximate. */
(function (root) {
  'use strict';

  var SQ_RATES = [240, 120, 60, 30, 15, 8, 4, 2, 1];
  var SQ_PLAYBACK = [
    { value: 24, label: '23.98p' }, { value: 30, label: '29.97p' },
    { value: 60, label: '59.94p' }, { value: 120, label: '119.88p' }
  ];
  var TL_PLAYBACK = [{ value: 24, label: '23.98p' }, { value: 30, label: '29.97p' }, { value: 60, label: '59.94p' }];
  var POST_PLAYBACK = [{ value: 24, label: '24p' }, { value: 30, label: '30p' }, { value: 60, label: '60p' }];
  var TL_INTERVALS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50, 60];
  var TL_4K_MAX = 5;
  var MAX_SHOTS = 9999;

  // Movie Settings bitrates (Mbps) per record frame rate. k4 marks 4K formats.
  var MOVIE_FORMATS = {
    24: [
      { id: 's4k-100', label: 'XAVC S 4K · 100 Mbps', mbps: 100, k4: true },
      { id: 's4k-60', label: 'XAVC S 4K · 60 Mbps', mbps: 60, k4: true },
      { id: 'hs4k-100', label: 'XAVC HS 4K · 100 Mbps', mbps: 100, k4: true },
      { id: 'si4k', label: 'XAVC S-I 4K · 240 Mbps', mbps: 240, k4: true },
      { id: 'shd', label: 'XAVC S HD · 50 Mbps', mbps: 50, k4: false }
    ],
    30: [
      { id: 's4k-140', label: 'XAVC S 4K · 140 Mbps', mbps: 140, k4: true },
      { id: 's4k-100', label: 'XAVC S 4K · 100 Mbps', mbps: 100, k4: true },
      { id: 's4k-60', label: 'XAVC S 4K · 60 Mbps', mbps: 60, k4: true },
      { id: 'si4k', label: 'XAVC S-I 4K · 300 Mbps', mbps: 300, k4: true },
      { id: 'shd', label: 'XAVC S HD · 50 Mbps', mbps: 50, k4: false }
    ],
    60: [
      { id: 's4k-150', label: 'XAVC S 4K · 150 Mbps', mbps: 150, k4: true },
      { id: 's4k-200', label: 'XAVC S 4K · 200 Mbps', mbps: 200, k4: true },
      { id: 'hs4k-150', label: 'XAVC HS 4K · 150 Mbps', mbps: 150, k4: true },
      { id: 'hs4k-200', label: 'XAVC HS 4K · 200 Mbps', mbps: 200, k4: true },
      { id: 'si4k', label: 'XAVC S-I 4K · 600 Mbps', mbps: 600, k4: true },
      { id: 'shd', label: 'XAVC S HD · 50 Mbps', mbps: 50, k4: false }
    ],
    120: [
      { id: 's4k-200', label: 'XAVC S 4K · 200 Mbps', mbps: 200, k4: true },
      { id: 's4k-280', label: 'XAVC S 4K · 280 Mbps', mbps: 280, k4: true },
      { id: 'hs4k-200', label: 'XAVC HS 4K · 200 Mbps', mbps: 200, k4: true },
      { id: 'hs4k-280', label: 'XAVC HS 4K · 280 Mbps', mbps: 280, k4: true },
      { id: 'shd', label: 'XAVC S HD · 100 Mbps', mbps: 100, k4: false }
    ]
  };

  var BODIES = {
    fx3: {
      name: 'FX3', methods: ['sq', 'iv'],
      photos: [
        { id: 'craw', label: 'Compressed RAW', mb: 19 }, { id: 'uraw', label: 'Uncompressed RAW', mb: 35 },
        { id: 'jxf', label: 'JPEG Extra fine', mb: 11 }, { id: 'jf', label: 'JPEG Fine', mb: 6 }
      ]
    },
    a1: {
      name: 'A1', methods: ['sq', 'iv'],
      photos: [
        { id: 'craw', label: 'Compressed RAW', mb: 70 }, { id: 'lraw', label: 'Lossless RAW', mb: 82 },
        { id: 'uraw', label: 'Uncompressed RAW', mb: 130 }, { id: 'jxf', label: 'JPEG Extra fine', mb: 39 },
        { id: 'jf', label: 'JPEG Fine', mb: 21 }
      ]
    },
    a1ii: {
      name: 'A1 II', methods: ['tl', 'sq', 'iv'], tlMinutes: { k4: 120, hd: 120 },
      photos: [
        { id: 'craw', label: 'Compressed RAW', mb: 70 }, { id: 'lraw', label: 'Lossless RAW (L)', mb: 80 },
        { id: 'uraw', label: 'Uncompressed RAW', mb: 130 }, { id: 'jxf', label: 'JPEG Extra fine', mb: 38 },
        { id: 'jf', label: 'JPEG Fine', mb: 20 }
      ]
    },
    a7v: {
      name: 'A7 V', methods: ['tl', 'sq', 'iv'], tlMinutes: { k4: 120, hd: 120 },
      photos: [
        { id: 'craw', label: 'Compressed RAW', mb: 35 }, { id: 'lraw', label: 'Lossless RAW', mb: 51 },
        { id: 'jxf', label: 'JPEG Extra fine', mb: 28 }, { id: 'jf', label: 'JPEG Fine', mb: 14 }
      ]
    },
    a9iii: {
      name: 'A9 III', methods: ['tl', 'sq', 'iv'], tlMinutes: { k4: 60, hd: 120 },
      photos: [
        { id: 'craw', label: 'Compressed RAW', mb: 33 }, { id: 'lraw', label: 'Lossless RAW', mb: 37 },
        { id: 'uraw', label: 'Uncompressed RAW', mb: 61 }, { id: 'jxf', label: 'JPEG Extra fine', mb: 20 },
        { id: 'jf', label: 'JPEG Fine', mb: 11 }
      ]
    }
  };
  var BODY_ORDER = ['fx3', 'a7v', 'a1', 'a1ii', 'a9iii'];

  var METHODS = {
    tl: { label: 'Time-lapse', hint: 'Records a finished movie in camera. Mode dial S&Q → Shoot Mode: Time-lapse.' },
    sq: { label: 'S&Q', hint: 'Records a finished quick-motion movie. Fastest option, but it can’t go slower than 1 frame a second.' },
    iv: { label: 'Interval', hint: 'Shoots stills you assemble in post (Imaging Edge or your NLE). Best quality, most card space.' }
  };

  var PRESETS = [
    { interval: 0.5, label: 'Crowds filling in' },
    { interval: 1, label: 'People, traffic' },
    { interval: 2, label: 'Fast clouds' },
    { interval: 4, label: 'Sunset, sunrise' },
    { interval: 8, label: 'Slow clouds' },
    { interval: 20, label: 'Sun, shadows' },
    { interval: 30, label: 'Stars' },
    { interval: 300, label: 'Construction' }
  ];

  /* ---------------- formatting ---------------- */

  function fmtClock(total) {
    var s = Math.max(0, Math.round(total));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    var parts = [];
    if (h) parts.push(h + 'h');
    if (m) parts.push(m + 'm');
    if (sec || !parts.length) parts.push(sec + 's');
    return parts.join(' ');
  }
  function fmtClip(seconds) {
    if (!isFinite(seconds) || seconds <= 0) return '—';
    if (seconds < 60) return (seconds < 10 ? Math.round(seconds * 10) / 10 : Math.round(seconds)) + 's';
    return fmtClock(seconds);
  }
  function fmtInterval(seconds) {
    if (seconds < 1) return '1/' + Math.round(1 / seconds) + ' s';
    if (seconds < 60) return (Math.round(seconds * 10) / 10) + ' s';
    return (Math.round(seconds / 6) / 10) + ' min';
  }
  function fmtCard(mb) {
    if (!isFinite(mb) || mb <= 0) return '—';
    if (mb < 1000) return Math.round(mb) + ' MB';
    var gb = mb / 1000;
    return (gb < 10 ? gb.toFixed(1) : Math.round(gb)) + ' GB';
  }
  function fmtSpeed(factor) {
    if (!isFinite(factor) || factor <= 0) return '—';
    if (factor >= 1000) return Math.round(factor / 100) / 10 + 'k×';
    if (factor >= 100) return Math.round(factor) + '×';
    return parseFloat(factor.toFixed(2)) + '×';
  }
  function fmtSetting(method, value) {
    return method === 'sq' ? value + ' fps' : value + ' s';
  }

  /* ---------------- state-bound helpers ----------------
     The page owns one mutable state object; these read and adjust it. */

  function bind(state) {
    function body() { return BODIES[state.body]; }
    function isMovie() { return state.method !== 'iv'; }

    /* ---------------- per-method options ---------------- */

    function playbackList() { return state.method === 'sq' ? SQ_PLAYBACK : state.method === 'tl' ? TL_PLAYBACK : POST_PLAYBACK; }
    function fpsLabel() {
      var m = playbackList().filter(function (o) { return o.value === state.fps; })[0];
      return m ? m.label : state.fps + 'p';
    }
    function formats() { return isMovie() ? MOVIE_FORMATS[state.fps] : body().photos; }
    function currentFormat() {
      var list = formats(), key = isMovie() ? state.movieFormat : state.photoFormat;
      return list.filter(function (f) { return f.id === key; })[0] || list[0];
    }
    function tlMax() { return state.method === 'tl' && currentFormat().k4 ? TL_4K_MAX : 60; }

    // Every value the camera can actually be set to, as seconds between frames.
    function settingsList() {
      if (state.method === 'sq') {
        return SQ_RATES.filter(function (r) { return r < state.fps; }).map(function (r) { return { value: r, interval: 1 / r, usable: true }; });
      }
      if (state.method === 'tl') {
        return TL_INTERVALS.map(function (s) { return { value: s, interval: s, usable: s <= tlMax() }; });
      }
      var list = [];
      for (var s = 1; s <= 60; s++) list.push({ value: s, interval: s, usable: true });
      return list;
    }
    function usableSettings() { return settingsList().filter(function (s) { return s.usable; }); }
    function nearestSetting(interval) {
      var list = usableSettings();
      return list.reduce(function (best, s) {
        return Math.abs(Math.log(s.interval / interval)) < Math.abs(Math.log(best.interval / interval)) ? s : best;
      }, list[0]);
    }
    function currentInterval() {
      if (state.method === 'sq') return 1 / state.sqRate;
      return state.method === 'tl' ? state.tlInterval : state.ivInterval;
    }
    function setIntervalValue(setting) {
      if (state.method === 'sq') state.sqRate = setting.value;
      else if (state.method === 'tl') state.tlInterval = setting.value;
      else state.ivInterval = setting.value;
    }

    // Bring every dependent value back inside what the current body and
    // method allow, then mirror state into the controls.
    function normalize() {
      if (body().methods.indexOf(state.method) === -1) state.method = body().methods[0];
      var fpsValues = playbackList().map(function (o) { return o.value; });
      if (fpsValues.indexOf(state.fps) === -1) state.fps = fpsValues.indexOf(30) !== -1 ? 30 : fpsValues[0];
      var list = formats();
      if (isMovie() && !list.some(function (f) { return f.id === state.movieFormat; })) state.movieFormat = list[0].id;
      if (!isMovie() && !list.some(function (f) { return f.id === state.photoFormat; })) state.photoFormat = list[0].id;
      var near = nearestSetting(currentInterval());
      if (state.method === 'iv') state.ivInterval = Math.max(1, Math.min(60, Math.round(state.ivInterval)));
      else if (!usableSettings().some(function (s) { return s.value === (state.method === 'sq' ? state.sqRate : state.tlInterval); })) setIntervalValue(near);
    }

    /* ---------------- the maths ----------------
       frames   = roll ÷ interval          (a part-interval makes no frame)
       clip     = frames ÷ playback fps
       speed-up = interval × playback fps
       In clip mode the frame count is fixed by the clip, the setting snaps to
       the nearest one the camera offers, and roll = frames × interval. */

    function compute() {
      var out = { valid: true, notes: [] };
      function error(text) { out.notes.push({ tone: 'error', text: text }); }
      function warn(text) { out.notes.push({ tone: 'warn', text: text }); }
      function info(text) { out.notes.push({ tone: 'info', text: text }); }

      if (state.rollSeconds <= 0) { out.valid = false; error(state.mode === 'clip' ? 'Set how long you have to roll.' : 'Set how long you’ll roll.'); return out; }

      if (state.mode === 'settings') {
        var interval = currentInterval();
        if (state.method === 'iv' && (!(interval >= 1) || interval > 60 || interval % 1 !== 0)) {
          out.valid = false;
          error(interval > 60
            ? 'Interval Shoot Func. stops at 60 s. For ' + fmtInterval(interval) + ' you need an external intervalometer or a remote app.'
            : 'Interval Shoot Func. takes whole seconds from 1 to 60.');
          return out;
        }
        out.interval = interval;
        out.roll = state.rollSeconds;
        out.frames = Math.floor(state.rollSeconds / interval + 1e-9);
      } else {
        if (!(state.clipSeconds > 0)) { out.valid = false; error('Set the clip length you need.'); return out; }
        out.frames = Math.max(1, Math.round(state.clipSeconds * state.fps));
        var ideal = state.rollSeconds / out.frames;
        var usable = usableSettings();
        var fastestInterval = usable[0].interval, slowestInterval = usable[usable.length - 1].interval;
        if (ideal > slowestInterval * 1.5) {
          out.valid = false;
          if (state.method === 'sq') error('That needs a frame every ' + fmtInterval(ideal) + ', and S&Q can’t go slower than 1 fps. Switch to ' + (body().methods.indexOf('tl') !== -1 ? 'Time-lapse or ' : '') + 'Interval, or roll for less time.');
          else if (state.method === 'tl' && tlMax() === TL_4K_MAX) error('That needs a frame every ' + fmtInterval(ideal) + '. 4K time-lapse stops at 5 s. Pick an HD format for up to 60 s, or roll for less time.');
          else error('That needs a frame every ' + fmtInterval(ideal) + ', past the camera’s 60 s limit. Use an external intervalometer, or roll for less time.');
          return out;
        }
        if (ideal < fastestInterval / 1.5) {
          out.valid = false;
          if (state.method === 'sq') error('That clip is longer than the roll at normal speed. Roll for longer or pick a shorter clip.');
          else error('That needs a frame every ' + fmtInterval(ideal) + ', faster than 1 s. Use S&Q, roll for longer, or pick a shorter clip.');
          return out;
        }
        var setting = nearestSetting(ideal);
        setIntervalValue(setting);
        out.interval = setting.interval;
        out.roll = out.frames * out.interval;
        var windowClip = Math.floor(state.rollSeconds / out.interval + 1e-9) / state.fps;
        if (Math.abs(out.roll - state.rollSeconds) / state.rollSeconds > 0.05) {
          info('Nearest setting is ' + fmtSetting(state.method, setting.value) + '. Roll ' + fmtClock(out.roll) +
            ' for exactly ' + fmtClip(state.clipSeconds) + '. Rolling your full ' + fmtClock(state.rollSeconds) + ' gives ' + fmtClip(windowClip) + '.');
        }
      }

      out.clip = out.frames / state.fps;
      out.speed = out.interval * state.fps;
      var format = currentFormat();
      out.cardMb = isMovie() ? out.clip * format.mbps / 8 : out.frames * format.mb;

      if (out.frames < 1) { out.valid = false; error('The interval is longer than the whole roll, so you wouldn’t get a single frame.'); return out; }
      if (state.method === 'iv' && out.frames > MAX_SHOTS) {
        error(out.frames.toLocaleString() + ' shots is over the camera’s 9,999 limit. Use a longer interval, or restart partway through.');
      }
      if (state.method === 'tl' && body().tlMinutes) {
        var limit = body().tlMinutes[format.k4 ? 'k4' : 'hd'];
        if (out.roll > limit * 60) warn('Sony lists about ' + limit + ' min of ' + (format.k4 ? '4K' : 'HD') + ' time-lapse recording on the ' + body().name + '. Plan to restart partway.');
      }
      if (out.clip < 3) warn('Under 3 seconds is hard to read on screen. Roll longer or use a shorter interval.');
      if (out.speed <= 2) warn('At ' + fmtSpeed(out.speed) + ' this barely reads as a timelapse. A lower frame rate or a longer interval will read faster.');
      if (out.roll > 2 * 3600) warn('Long roll: plan power (a dummy battery or USB-C power) and turn off auto power-off.');
      if (out.cardMb > 256000) warn('Over 256 GB. Plan a card swap or a bigger card.');
      return out;
    }

    function blocked(result) { return !result.valid || result.notes.some(function (n) { return n.tone === 'error'; }); }

    function menuRows(result) {
      var rows = [];
      if (state.method === 'sq') {
        rows.push(['Shoot Mode', 'S&Q']);
        rows.push(['S&Q Frame Rate', state.sqRate + ' fps']);
        rows.push(['Record frame rate', fpsLabel()]);
        rows.push(['Movie format', currentFormat().label]);
        rows.push(['Roll for', fmtClock(result.roll)]);
      } else if (state.method === 'tl') {
        rows.push(['Shoot Mode', 'Time-lapse']);
        rows.push(['Shooting Interval', state.tlInterval + ' s']);
        rows.push(['Record frame rate', fpsLabel()]);
        rows.push(['Movie format', currentFormat().label]);
        rows.push(['Roll for', fmtClock(result.roll)]);
      } else {
        rows.push(['Interval Shoot Func.', 'On']);
        rows.push(['Shooting Interval', state.ivInterval + ' s']);
        rows.push(['Number of Shots', result.frames.toLocaleString()]);
        rows.push(['Shutter Type in Interval', 'Electronic']);
        rows.push(['Build the clip at', fpsLabel() + ' in post']);
      }
      return rows;
    }

    function subjectFor(interval) {
      var best = null, delta = Infinity;
      PRESETS.forEach(function (p) {
        var d = Math.abs(Math.log(p.interval / interval));
        if (d < delta) { delta = d; best = p; }
      });
      return delta < Math.log(1.6) ? best.label : '';
    }

    return {
      body: body,
      isMovie: isMovie,
      playbackList: playbackList,
      fpsLabel: fpsLabel,
      formats: formats,
      currentFormat: currentFormat,
      tlMax: tlMax,
      settingsList: settingsList,
      usableSettings: usableSettings,
      nearestSetting: nearestSetting,
      currentInterval: currentInterval,
      setIntervalValue: setIntervalValue,
      normalize: normalize,
      compute: compute,
      blocked: blocked,
      menuRows: menuRows,
      subjectFor: subjectFor
    };
  }

  var api = {
    SQ_RATES: SQ_RATES,
    SQ_PLAYBACK: SQ_PLAYBACK,
    TL_PLAYBACK: TL_PLAYBACK,
    POST_PLAYBACK: POST_PLAYBACK,
    TL_INTERVALS: TL_INTERVALS,
    TL_4K_MAX: TL_4K_MAX,
    MAX_SHOTS: MAX_SHOTS,
    MOVIE_FORMATS: MOVIE_FORMATS,
    BODIES: BODIES,
    BODY_ORDER: BODY_ORDER,
    METHODS: METHODS,
    PRESETS: PRESETS,
    fmtClock: fmtClock,
    fmtClip: fmtClip,
    fmtInterval: fmtInterval,
    fmtCard: fmtCard,
    fmtSpeed: fmtSpeed,
    fmtSetting: fmtSetting,
    bind: bind
  };
  root.TimelapseCore = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
