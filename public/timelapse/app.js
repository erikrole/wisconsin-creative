/* Timelapse page wiring. The maths, camera limits and their Sony sources
   live in core.js. Client-only: the last plan lives in localStorage.
 */
(function () {
  'use strict';

  var STATE_KEY = 'tlc.state.v3';

  var C = window.TimelapseCore;
  var BODIES = C.BODIES;
  var BODY_ORDER = C.BODY_ORDER;
  var METHODS = C.METHODS;
  var PRESETS = C.PRESETS;
  var fmtClock = C.fmtClock;
  var fmtClip = C.fmtClip;
  var fmtInterval = C.fmtInterval;
  var fmtCard = C.fmtCard;
  var fmtSpeed = C.fmtSpeed;
  var fmtSetting = C.fmtSetting;

  /* ---------------- elements + state ---------------- */

  var el = {};
  ['body', 'method', 'method-hint', 'rate-field', 'rate', 'rate-label', 'interval-field', 'interval', 'clip-field', 'clip',
   'fps', 'fps-label', 'roll-h', 'roll-m', 'roll-s', 'roll-label', 'roll-hint', 'format', 'format-label', 'format-hint',
   'result-label', 'result-value', 'result-sub', 'frames-label', 'stat-frames', 'stat-speed', 'stat-card', 'notes',
   'menu-card', 'menu-title', 'menu-rows', 'presets-block', 'chips', 'chips-hint', 'options-block', 'options',
   'copy-plan', 'status', 'hud-method', 'hud-body', 'funnel'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  var state = {
    body: 'fx3', method: 'sq', mode: 'settings',
    sqRate: 1, tlInterval: 4, ivInterval: 4,
    fps: 30, rollSeconds: 600, clipSeconds: 20,
    movieFormat: 's4k-100', photoFormat: 'craw'
  };

  var core = C.bind(state);
  var body = core.body;
  var isMovie = core.isMovie;
  var playbackList = core.playbackList;
  var fpsLabel = core.fpsLabel;
  var formats = core.formats;
  var currentFormat = core.currentFormat;
  var settingsList = core.settingsList;
  var usableSettings = core.usableSettings;
  var nearestSetting = core.nearestSetting;
  var currentInterval = core.currentInterval;
  var setIntervalValue = core.setIntervalValue;
  var normalize = core.normalize;
  var compute = core.compute;
  var blocked = core.blocked;
  var menuRows = core.menuRows;
  var subjectFor = core.subjectFor;

  function storageGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function storageSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* private mode */ } }

  /* ---------------- controls ---------------- */

  function fillSelect(select, items, value) {
    select.textContent = '';
    items.forEach(function (item) {
      var opt = document.createElement('option');
      opt.value = String(item.value);
      opt.textContent = item.label;
      if (item.disabled) opt.disabled = true;
      select.appendChild(opt);
    });
    select.value = String(value);
  }

  function buildMethods() {
    el.method.textContent = '';
    body().methods.forEach(function (key) {
      var input = document.createElement('input');
      input.type = 'radio'; input.name = 'method'; input.id = 'method-' + key; input.value = key;
      input.checked = key === state.method;
      input.addEventListener('change', function () { if (input.checked) switchMethod(key); });
      var label = document.createElement('label');
      label.htmlFor = input.id;
      label.textContent = METHODS[key].label;
      el.method.appendChild(input);
      el.method.appendChild(label);
    });
  }

  function syncControls() {
    normalize();
    var isSettings = state.mode === 'settings';
    fillSelect(el.body, BODY_ORDER.map(function (k) { return { value: k, label: BODIES[k].name }; }), state.body);
    buildMethods();
    el['method-hint'].textContent = METHODS[state.method].hint;

    el['rate-field'].hidden = !(isSettings && state.method !== 'iv');
    el['interval-field'].hidden = !(isSettings && state.method === 'iv');
    el['clip-field'].hidden = isSettings;
    el['rate-label'].textContent = state.method === 'sq' ? 'S&Q frame rate' : 'Shooting interval';
    fillSelect(el.rate, settingsList().map(function (s) {
      return {
        value: s.value,
        label: state.method === 'sq' ? s.value + ' fps · ' + fmtSpeed(state.fps / s.value) : s.value + ' s' + (s.usable ? '' : ' · HD only'),
        disabled: !s.usable
      };
    }), state.method === 'sq' ? state.sqRate : state.tlInterval);
    el.interval.value = String(state.ivInterval);
    el.clip.value = String(state.clipSeconds);

    el['fps-label'].textContent = state.method === 'iv' ? 'Timeline frame rate' : 'Record frame rate';
    fillSelect(el.fps, playbackList(), state.fps);

    el['roll-label'].textContent = isSettings ? 'Roll for' : 'Time you have to roll';
    el['roll-hint'].textContent = isSettings ? 'Real time the camera rolls.' : 'Your window, such as how long the sunset lasts. We’ll say exactly how long to roll.';
    var h = Math.floor(state.rollSeconds / 3600), m = Math.floor((state.rollSeconds % 3600) / 60), s = Math.round(state.rollSeconds % 60);
    el['roll-h'].value = String(h); el['roll-m'].value = String(m); el['roll-s'].value = String(s);

    el['format-label'].textContent = isMovie() ? 'Record format' : 'File type';
    el['format-hint'].textContent = isMovie()
      ? (state.method === 'tl' ? '4K time-lapse stops at 5 s. HD goes to 60 s.' : 'For the card estimate.')
      : 'Approximate size per shot, from Sony’s card tables.';
    fillSelect(el.format, formats().map(function (f) {
      return { value: f.id, label: isMovie() ? f.label : f.label + ' · ≈ ' + f.mb + ' MB' };
    }), currentFormat().id);

    el['frames-label'].textContent = state.method === 'iv' ? 'Shots' : 'Frames';
    el['presets-block'].hidden = !isSettings;
    el['options-block'].hidden = isSettings;
  }

  function readInputs() {
    state.body = el.body.value in BODIES ? el.body.value : state.body;
    state.fps = Number(el.fps.value) || state.fps;
    if (isMovie()) state.movieFormat = el.format.value; else state.photoFormat = el.format.value;
    var h = Math.max(0, Number(el['roll-h'].value) || 0);
    var m = Math.max(0, Number(el['roll-m'].value) || 0);
    var s = Math.max(0, Number(el['roll-s'].value) || 0);
    state.rollSeconds = h * 3600 + m * 60 + s;
    if (state.mode === 'clip') state.clipSeconds = Math.max(0, Number(el.clip.value) || 0);
    else if (state.method === 'iv') state.ivInterval = Number(el.interval.value) || 0;
    else if (state.method === 'sq') state.sqRate = Number(el.rate.value) || state.sqRate;
    else state.tlInterval = Number(el.rate.value) || state.tlInterval;
  }


  /* ---------------- render ---------------- */

  function renderNotes(notes) {
    el.notes.textContent = '';
    notes.forEach(function (note) {
      var div = document.createElement('div');
      div.className = 'note is-' + note.tone;
      var span = document.createElement('span');
      span.textContent = note.text;
      div.appendChild(span);
      el.notes.appendChild(div);
    });
  }

  function renderMenu(result) {
    el['menu-rows'].textContent = '';
    // Never show a combination that wouldn't produce the stated clip.
    if (blocked(result)) { el['menu-card'].hidden = true; return; }
    el['menu-card'].hidden = false;
    el['menu-title'].textContent = 'On the ' + body().name;
    menuRows(result).forEach(function (pair) {
      var row = document.createElement('div');
      row.className = 'menu-row';
      var l = document.createElement('span'); l.textContent = pair[0];
      var v = document.createElement('b'); v.textContent = pair[1];
      row.appendChild(l); row.appendChild(v);
      el['menu-rows'].appendChild(row);
    });
  }

  function renderChips() {
    el.chips.textContent = '';
    var shown = {};
    var list = usableSettings();
    var fastest = list[0].interval, slowest = list[list.length - 1].interval;
    PRESETS.forEach(function (preset) {
      var target;
      if (preset.interval < fastest - 1e-9 || preset.interval > slowest + 1e-9) target = { value: null, interval: preset.interval, usable: false };
      else target = nearestSetting(preset.interval);
      var key = target.usable ? String(target.value) : 'x' + preset.interval;
      if (shown[key]) return;
      shown[key] = true;
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip' + (target.usable && Math.abs(target.interval - currentInterval()) < 1e-6 ? ' is-active' : '');
      chip.disabled = !target.usable;
      var b = document.createElement('b');
      b.textContent = target.usable ? fmtSetting(state.method, target.value) : fmtInterval(preset.interval);
      var s = document.createElement('span');
      s.textContent = preset.label;
      chip.appendChild(b); chip.appendChild(s);
      if (!target.usable) {
        chip.title = state.method === 'sq' ? 'Slower than 1 fps: use Time-lapse or Interval' : 'Past the camera’s limit: needs an intervalometer';
        chip.setAttribute('aria-label', fmtInterval(preset.interval) + ', ' + preset.label + ', not possible with this method');
      }
      chip.addEventListener('click', function () { setIntervalValue(target); syncControls(); update(); });
      el.chips.appendChild(chip);
    });
    el['chips-hint'].textContent = state.method === 'sq'
      ? 'S&Q tops out at 1 frame a second, so it suits fast subjects. Slower cadences need Time-lapse or Interval.'
      : state.method === 'tl'
        ? 'Time-lapse runs 1–10 s in 1 s steps, then 20–60 s. In 4K it stops at 5 s.'
        : 'Interval shooting runs 1–60 s. Past that you need an external intervalometer.';
  }

  function renderOptions(result) {
    el.options.textContent = '';
    if (!(state.clipSeconds > 0)) return;
    var frames = Math.max(1, Math.round(state.clipSeconds * state.fps));
    var all = state.method === 'iv'
      ? [1, 2, 3, 4, 5, 8, 10, 15, 20, 30, 45, 60].map(function (s) { return { value: s, interval: s, usable: true }; })
      : settingsList();
    all.forEach(function (s) {
      var roll = frames * s.interval;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'option' + (result.valid && Math.abs(s.interval - result.interval) < 1e-6 ? ' is-closest' : '');
      btn.disabled = !s.usable;
      var main = document.createElement('span'); main.className = 'option-main';
      var b = document.createElement('b'); b.textContent = fmtSetting(state.method, s.value);
      var sub = document.createElement('span');
      sub.textContent = s.usable ? [fmtSpeed(s.interval * state.fps), subjectFor(s.interval)].filter(Boolean).join(' · ') : 'HD only';
      main.appendChild(b); main.appendChild(sub);
      var r = document.createElement('span'); r.className = 'option-roll'; r.textContent = 'Roll ' + fmtClock(roll);
      btn.appendChild(main); btn.appendChild(r);
      btn.addEventListener('click', function () {
        setIntervalValue(s);
        state.rollSeconds = Math.round(roll);
        state.mode = 'settings';
        document.getElementById('mode-settings').checked = true;
        syncControls();
        update();
      });
      el.options.appendChild(btn);
    });
  }

  function renderHud(result) {
    var setting = blocked(result) ? '—' : state.method === 'sq' ? state.sqRate + ' fps' : currentInterval() + ' s';
    el['hud-method'].textContent = METHODS[state.method].label.toUpperCase() + ' · ' + setting;
    el['hud-body'].textContent = body().name + ' · ' + fpsLabel();
    document.body.setAttribute('data-blocked', blocked(result) ? '1' : '0');
  }

  // Real time on top, clip underneath, joined by a cone: the speed-up drawn
  // to scale (the clip bar never shrinks below a sliver so it stays visible).
  function renderFunnel(result) {
    if (blocked(result)) { el.funnel.hidden = true; return; }
    el.funnel.hidden = false;
    var W = 1000, clipW = Math.max(14, Math.min(W, (result.clip / result.roll) * W));
    var x0 = (W - clipW) / 2, ticks = [], n = Math.min(result.frames, 80);
    for (var i = 0; i <= n; i++) {
      var x = (i / n) * W;
      ticks.push('<line class="tick" x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) + '" y1="2" y2="14" vector-effect="non-scaling-stroke"/>');
    }
    el.funnel.innerHTML =
      '<svg viewBox="0 0 ' + W + ' 86" preserveAspectRatio="none">' +
      '<defs><linearGradient id="cone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".08"/><stop offset="1" stop-color="#ffb224" stop-opacity=".35"/></linearGradient></defs>' +
      '<rect class="bar-real" x="0" y="0" width="' + W + '" height="16" rx="3"/>' + ticks.join('') +
      '<path class="cone" d="M0 16 L' + W + ' 16 L' + (x0 + clipW).toFixed(1) + ' 70 L' + x0.toFixed(1) + ' 70 Z"/>' +
      '<rect class="bar-clip" x="' + x0.toFixed(1) + '" y="70" width="' + clipW.toFixed(1) + '" height="16" rx="3"/>' +
      '</svg>' +
      '<div class="funnel-labels"><span>Real time <b>' + fmtClock(result.roll) + '</b></span><span>' +
      (result.frames > n ? 'every tick ≈ ' + Math.round(result.frames / n) + ' frames' : result.frames + ' frames') +
      '</span><span>Clip <b>' + fmtClip(result.clip) + '</b></span></div>';
  }

  function render(result) {
    renderHud(result);
    renderFunnel(result);
    renderNotes(result.notes);
    if (!result.valid) {
      el['result-label'].textContent = state.mode === 'settings' ? 'Clip length' : 'Setting';
      el['result-value'].textContent = '—';
      el['result-sub'].textContent = '';
      el['stat-frames'].textContent = '—';
      el['stat-speed'].textContent = '—';
      el['stat-card'].textContent = '—';
      el['menu-card'].hidden = true;
      if (state.mode === 'settings') renderChips(); else renderOptions(result);
      return;
    }
    if (state.mode === 'settings') {
      el['result-label'].textContent = 'Clip length';
      el['result-value'].textContent = fmtClip(result.clip);
      el['result-sub'].textContent = 'Rolling ' + fmtClock(result.roll) + ' at ' + fmtSetting(state.method, state.method === 'sq' ? state.sqRate : currentInterval()) +
        (state.method === 'sq' ? '' : ' intervals') + ', played at ' + fpsLabel();
    } else {
      el['result-label'].textContent = state.method === 'sq' ? 'S&Q frame rate' : 'Shooting interval';
      el['result-value'].textContent = fmtSetting(state.method, state.method === 'sq' ? state.sqRate : currentInterval());
      el['result-sub'].textContent = 'Roll ' + fmtClock(result.roll) + ' for a ' + fmtClip(result.clip) + ' clip at ' + fpsLabel();
    }
    el['stat-frames'].textContent = result.frames.toLocaleString();
    el['stat-speed'].textContent = fmtSpeed(result.speed);
    el['stat-card'].textContent = fmtCard(result.cardMb);
    renderMenu(result);
    if (state.mode === 'settings') renderChips(); else renderOptions(result);
  }

  var lastResult = null;
  function update() {
    readInputs();
    lastResult = compute();
    render(lastResult);
    // Clip mode snaps the setting; keep the (hidden) settings control in step.
    if (state.mode === 'clip' && state.method !== 'iv') el.rate.value = String(state.method === 'sq' ? state.sqRate : state.tlInterval);
    el.interval.value = String(state.ivInterval);
    storageSet(STATE_KEY, JSON.stringify(state));
    setStatus('');
  }

  /* ---------------- switching ---------------- */

  function carryInterval(previous) {
    // Keep the cadence as close as the new method allows.
    var target = previous;
    if (state.method === 'iv') state.ivInterval = Math.max(1, Math.min(60, Math.round(target)));
    else setIntervalValue(nearestSetting(target));
  }

  function switchMethod(key) {
    var prev = lastResult && lastResult.valid ? lastResult.interval : currentInterval();
    state.method = key;
    normalize();
    carryInterval(prev);
    syncControls();
    update();
  }

  el.body.addEventListener('change', function () {
    var prev = lastResult && lastResult.valid ? lastResult.interval : currentInterval();
    state.body = el.body.value;
    normalize();
    carryInterval(prev);
    syncControls();
    update();
  });

  Array.prototype.forEach.call(document.querySelectorAll('input[name="mode"]'), function (radio) {
    radio.addEventListener('change', function () {
      if (!radio.checked) return;
      var prev = lastResult;
      state.mode = radio.value;
      // Carry the plan across so switching views doesn't lose work.
      if (prev && prev.valid) {
        if (state.mode === 'clip') state.clipSeconds = Math.round(prev.clip * 10) / 10;
        else state.rollSeconds = Math.round(prev.roll);
      }
      syncControls();
      update();
    });
  });

  ['interval', 'clip', 'roll-h', 'roll-m', 'roll-s'].forEach(function (id) { el[id].addEventListener('input', update); });
  el.rate.addEventListener('change', update);
  el.format.addEventListener('change', function () {
    if (isMovie()) state.movieFormat = el.format.value; else state.photoFormat = el.format.value;
    syncControls();
    update();
  });
  // The record rate changes which S&Q rates and formats exist.
  el.fps.addEventListener('change', function () {
    var prev = currentInterval();
    state.fps = Number(el.fps.value) || state.fps;
    normalize();
    if (state.method === 'sq') carryInterval(prev);
    syncControls();
    update();
  });

  /* ---------------- copy ---------------- */

  function setStatus(message) { el.status.textContent = message || ''; }

  el['copy-plan'].addEventListener('click', function () {
    var result = lastResult || compute();
    if (blocked(result)) { setStatus('Fix the flagged issue first.'); return; }
    var lines = ['Timelapse plan · ' + body().name + ' · ' + METHODS[state.method].label];
    menuRows(result).forEach(function (pair) { lines.push(pair[0] + ': ' + pair[1]); });
    lines.push('Clip: ' + fmtClip(result.clip) + ' (' + fmtSpeed(result.speed) + ')');
    lines.push('Card: ≈ ' + fmtCard(result.cardMb));
    if (!navigator.clipboard || !navigator.clipboard.writeText) { setStatus('Copying needs a secure (https) page.'); return; }
    navigator.clipboard.writeText(lines.join('\n')).then(function () { setStatus('Plan copied.'); }, function () { setStatus('This browser blocked copying.'); });
  });

  /* ---------------- start ---------------- */

  var saved = null;
  try { saved = JSON.parse(storageGet(STATE_KEY) || 'null'); } catch (e) { saved = null; }
  if (saved && typeof saved === 'object') {
    if (BODIES[saved.body]) state.body = saved.body;
    if (METHODS[saved.method]) state.method = saved.method;
    if (saved.mode === 'settings' || saved.mode === 'clip') state.mode = saved.mode;
    ['sqRate', 'tlInterval', 'ivInterval', 'fps', 'rollSeconds', 'clipSeconds'].forEach(function (k) {
      if (isFinite(saved[k]) && saved[k] > 0) state[k] = saved[k];
    });
    if (typeof saved.movieFormat === 'string') state.movieFormat = saved.movieFormat;
    if (typeof saved.photoFormat === 'string') state.photoFormat = saved.photoFormat;
  }
  document.getElementById('mode-' + state.mode).checked = true;
  syncControls();
  update();
})();
