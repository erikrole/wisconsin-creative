/* Golden Hour page wiring. Venues, sun and weather maths live in core.js.
   Client-only apart from one optional forecast request to Open-Meteo (free,
   no key, coordinates rounded to ~1 km). The last location lives in localStorage. */
(function () {
  'use strict';

  var LOCATION_KEY = 'ght.location.v3';
  var LEGACY_LOCATION_KEY = 'ght.lastlocation.v2';
  var WEEK_KEY = 'ght.week.v1';
  var LIVE_REFRESH_MS = 20000;
  var WX_TIMEOUT_MS = 8000;

  var C = window.GoldenHourCore;
  var VENUE_GROUPS = C.VENUE_GROUPS, VENUES = C.VENUES, DEFAULT_VENUE = C.DEFAULT_VENUE, HOUR_MS = C.HOUR_MS;
  var sunAltitude = C.sunAltitude, sunAzimuth = C.sunAzimuth, compassPoint = C.compassPoint;
  var sunTimes = C.sunTimes, phaseFor = C.phaseFor, DEVICE_TZ = C.DEVICE_TZ;
  var offsetMs = C.offsetMs, zonedInstant = C.zonedInstant, civilIn = C.civilIn, validTimeZone = C.validTimeZone;
  var addDays = C.addDays, sameDay = C.sameDay, dayToValue = C.dayToValue, valueToDay = C.valueToDay;
  var dayOffset = C.dayOffset, weatherUrl = C.weatherUrl, weatherAt = C.weatherAt;

  /* ---------------- formatting ---------------- */

  function timeFormatter(tz) {
    return new Intl.DateTimeFormat([], { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  }
  function fmtTime(date) { return date ? timeFormatter(state.loc.tz).format(date) : '—'; }
  function fmtRange(a, b) {
    var f = timeFormatter(state.loc.tz);
    try { if (f.formatRange) return f.formatRange(a, b); } catch (e) { /* fall through */ }
    return f.format(a) + ' – ' + f.format(b);
  }
  function fmtDuration(ms) {
    var total = Math.max(0, Math.round(ms / 60000));
    var h = Math.floor(total / 60), m = total % 60;
    return h > 0 ? h + 'h ' + m + 'm' : m + ' min';
  }
  function zoneName(tz, style, at) {
    try {
      var part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: style })
        .formatToParts(at || new Date()).filter(function (p) { return p.type === 'timeZoneName'; })[0];
      return part ? part.value : tz;
    } catch (e) { return tz; }
  }
  function dateText(day, opts) {
    opts.timeZone = 'UTC';
    return new Date(Date.UTC(day.y, day.m - 1, day.d, 12)).toLocaleDateString([], opts);
  }
  function shortDate(day) { return dateText(day, { weekday: 'short', month: 'short', day: 'numeric' }); }
  function relativeTag(day) {
    var today = civilIn(new Date(), state.loc.tz);
    return sameDay(day, today) ? 'Today' : sameDay(day, addDays(today, 1)) ? 'Tomorrow' : sameDay(day, addDays(today, -1)) ? 'Yesterday' : '';
  }
  function dayHeading(day) {
    var tag = relativeTag(day);
    return tag ? tag + ', ' + dateText(day, { month: 'short', day: 'numeric' }) : shortDate(day);
  }
  function bearing(date) {
    var deg = sunAzimuth(date, state.loc.lat, state.loc.lon);
    return compassPoint(deg) + ' · ' + Math.round(deg) + '°';
  }

  /* ---------------- state + storage ---------------- */

  function storageGet(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
  function storageSet(key, value) { try { window.localStorage.setItem(key, value); } catch (e) { /* private mode */ } }

  function venueLocation(id) {
    var v = VENUES[id];
    return { kind: 'venue', id: v.id, label: v.name + (v.name.indexOf(v.city) === -1 ? ', ' + v.city : ''), lat: v.lat, lon: v.lon, tz: v.tz, tzKnown: true };
  }
  // GPS and typed points start on the device clock and switch to the spot's
  // own zone when the forecast reports it (or straight away if it was saved).
  function pointLocation(kind, lat, lon, tz) {
    var known = validTimeZone(tz);
    return {
      kind: kind, id: kind, label: (kind === 'gps' ? 'My location' : 'Custom') + ' (' + lat.toFixed(2) + ', ' + lon.toFixed(2) + ')',
      lat: lat, lon: lon, tz: known ? tz : DEVICE_TZ, tzKnown: known
    };
  }
  function validPoint(lat, lon) { return typeof lat === 'number' && typeof lon === 'number' && isFinite(lat) && isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180; }

  function loadSavedLocation() {
    var saved = null;
    try { saved = JSON.parse(storageGet(LOCATION_KEY) || 'null'); } catch (e) { saved = null; }
    if (saved && saved.kind === 'venue' && Object.prototype.hasOwnProperty.call(VENUES, saved.id)) return venueLocation(saved.id);
    if (saved && (saved.kind === 'gps' || saved.kind === 'custom') && validPoint(saved.lat, saved.lon)) return pointLocation(saved.kind, saved.lat, saved.lon, saved.tz);
    // An older build stored only a GPS fix (or the Madison default).
    try { saved = JSON.parse(storageGet(LEGACY_LOCATION_KEY) || 'null'); } catch (e) { saved = null; }
    if (saved && /^Your location/.test(saved.label || '') && validPoint(saved.lat, saved.lon)) return pointLocation('gps', saved.lat, saved.lon);
    return null;
  }
  function persistLocation() {
    var l = state.loc;
    storageSet(LOCATION_KEY, JSON.stringify(l.kind === 'venue' ? { kind: 'venue', id: l.id }
      : { kind: l.kind, lat: l.lat, lon: l.lon, tz: l.tzKnown ? l.tz : undefined }));
  }

  var params = new URLSearchParams(window.location.search);
  var initialLoc = null;
  var atParam = params.get('at');
  if (atParam && Object.prototype.hasOwnProperty.call(VENUES, atParam)) initialLoc = venueLocation(atParam);
  else if (validPoint(parseFloat(params.get('lat')), parseFloat(params.get('lon')))) initialLoc = pointLocation('custom', parseFloat(params.get('lat')), parseFloat(params.get('lon')));
  var state = { loc: initialLoc || loadSavedLocation() || venueLocation(DEFAULT_VENUE), week: storageGet(WEEK_KEY) === 'morning' ? 'morning' : 'evening' };
  state.day = valueToDay(params.get('date')) || civilIn(new Date(), state.loc.tz);
  // While the user is looking at "today", keep following it past midnight.
  state.followToday = sameDay(state.day, civilIn(new Date(), state.loc.tz));

  /* ---------------- elements ---------------- */

  var el = {};
  ['venue', 'date', 'date-label', 'prev-day', 'next-day', 'today-link', 'zone-note',
   'hero-eyebrow', 'hero-title', 'hero-sub', 'path', 'morning-card', 'evening-card', 'morning-tag', 'evening-tag',
   'morning-range', 'morning-sub', 'morning-blue', 'morning-blue-row', 'morning-sun', 'morning-sun-row', 'morning-wx',
   'evening-range', 'evening-sub', 'evening-blue', 'evening-blue-row', 'evening-sun', 'evening-sun-row', 'evening-wx',
   'week-list', 'week-note', 'week-evening', 'week-morning',
   'custom', 'lat', 'lon', 'apply-custom', 'copy-times', 'copy-link', 'status'
  ].forEach(function (id) { el[id] = document.getElementById(id); });
  var themeColor = document.querySelector('meta[name="theme-color"]');

  function node(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  /* ---------------- location picker ---------------- */

  function buildVenueOptions() {
    el.venue.textContent = '';
    VENUE_GROUPS.forEach(function (group) {
      var og = document.createElement('optgroup');
      og.label = group.label;
      group.venues.forEach(function (v) {
        var opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = v.name + (v.name.indexOf(v.city) === -1 ? ' · ' + v.city : '');
        og.appendChild(opt);
      });
      el.venue.appendChild(og);
    });
    var more = document.createElement('optgroup');
    more.label = 'Anywhere else';
    var gps = document.createElement('option');
    gps.value = 'gps';
    gps.textContent = state.loc.kind === 'gps' ? state.loc.label : 'Use my location';
    var custom = document.createElement('option');
    custom.value = 'custom';
    custom.textContent = state.loc.kind === 'custom' ? state.loc.label : 'Custom coordinates…';
    more.appendChild(gps);
    more.appendChild(custom);
    el.venue.appendChild(more);
    el.venue.value = state.loc.id;
  }

  function setLocation(loc) {
    var wasToday = state.followToday;
    state.loc = loc;
    // "Today" means today where the place is, not where this device is.
    if (wasToday) state.day = civilIn(new Date(), loc.tz);
    persistLocation();
    buildVenueOptions();
    render();
  }

  el.venue.addEventListener('change', function () {
    var value = el.venue.value;
    setStatus('');
    if (Object.prototype.hasOwnProperty.call(VENUES, value)) {
      el.custom.hidden = true;
      setLocation(venueLocation(value));
    } else if (value === 'custom') {
      el.custom.hidden = false;
      if (state.loc.kind !== 'venue') { el.lat.value = state.loc.lat.toFixed(4); el.lon.value = state.loc.lon.toFixed(4); }
      el.lat.focus();
      el.venue.value = state.loc.id;
    } else if (value === 'gps') {
      el.custom.hidden = true;
      el.venue.value = state.loc.id;
      locate();
    }
  });

  function locate() {
    if (!('geolocation' in navigator)) { setStatus('This browser can’t share its location.', 'error'); return; }
    setStatus('Finding you…');
    navigator.geolocation.getCurrentPosition(function (position) {
      setLocation(pointLocation('gps', position.coords.latitude, position.coords.longitude));
      setStatus('Using your location.');
    }, function (error) {
      setStatus(error.code === error.PERMISSION_DENIED
        ? 'Location access is off for this site. Pick a venue, or allow location in your browser settings.'
        : 'Couldn’t get your location. Pick a venue instead.', 'error');
    }, { timeout: 10000, maximumAge: 300000 });
  }

  function applyCustom() {
    var lat = parseFloat(el.lat.value), lon = parseFloat(el.lon.value);
    if (!validPoint(lat, lon)) { setStatus('Latitude runs −90 to 90 and longitude −180 to 180.', 'error'); return; }
    el.custom.hidden = true;
    setLocation(pointLocation('custom', lat, lon));
    setStatus('');
  }
  el['apply-custom'].addEventListener('click', applyCustom);
  [el.lat, el.lon].forEach(function (input) {
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') applyCustom();
      else if (event.key === 'Escape') { el.custom.hidden = true; el.venue.focus(); }
    });
  });

  /* ---------------- weather ----------------
     Best effort. One request covers the chosen day and the next seven when
     they fit in one range; any failure leaves the sun times untouched. A
     token drops answers that arrive after the user moved on. */

  var wx = { token: 0, status: 'idle', results: [] }, wxCache = {}, wxCacheKeys = [];

  function wxUrls() {
    var loc = state.loc, today = civilIn(new Date(), loc.tz), weekEnd = addDays(today, 6);
    var from = dayOffset(state.day, today) < 0 ? state.day : today;
    var to = dayOffset(state.day, weekEnd) > 0 ? state.day : weekEnd;
    var one = weatherUrl(loc.lat, loc.lon, from, to, today);
    if (one) return [one];
    return [weatherUrl(loc.lat, loc.lon, today, weekEnd, today), weatherUrl(loc.lat, loc.lon, state.day, state.day, today)]
      .filter(Boolean);
  }

  function fetchJson(url) {
    if (wxCache[url]) return Promise.resolve(wxCache[url]);
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, WX_TIMEOUT_MS) : null;
    return fetch(url, { referrerPolicy: 'no-referrer', credentials: 'omit', signal: ctrl ? ctrl.signal : undefined })
      .then(function (res) { if (!res.ok) throw new Error('weather ' + res.status); return res.json(); })
      .then(function (json) {
        if (!json || !json.hourly) throw new Error('weather: empty');
        wxCache[url] = json;
        wxCacheKeys.push(url);
        if (wxCacheKeys.length > 24) delete wxCache[wxCacheKeys.shift()];
        return json;
      })
      .then(function (json) { clearTimeout(timer); return json; }, function (error) { clearTimeout(timer); throw error; });
  }

  function loadWeather() {
    var token = ++wx.token, urls = wxUrls();
    wx.results = [];
    if (!urls.length || typeof fetch !== 'function') { wx.status = 'none'; paintWeather(); return; }
    wx.status = 'loading';
    paintWeather();
    Promise.all(urls.map(function (url) {
      return fetchJson(url).then(function (json) { return json; }, function () { return null; });
    })).then(function (list) {
      if (token !== wx.token) return;
      wx.results = list.filter(Boolean);
      wx.status = wx.results.length ? 'ok' : 'error';
      // GPS and typed points: adopt the zone the forecast reports.
      var zone = wx.results[0] && wx.results[0].timezone;
      if (state.loc.kind !== 'venue' && validTimeZone(zone) && (!state.loc.tzKnown || state.loc.tz !== zone)) {
        var wasToday = state.followToday;
        state.loc.tz = zone;
        state.loc.tzKnown = true;
        if (wasToday) state.day = civilIn(new Date(), zone);
        persistLocation();
        render();
        return;
      }
      paintWeather();
    });
  }

  function wxFor(start, end) {
    for (var i = 0; i < wx.results.length; i++) {
      var hit = weatherAt(wx.results[i], start, end);
      if (hit) return hit;
    }
    return null;
  }
  function wxDetail(w) {
    var bits = [w.cloud + '% cloud'];
    if (w.rain != null && w.rain >= 20) bits.push(w.rain + '% rain');
    if (w.temp != null) bits.push(w.temp + '°F');
    return bits.join(' · ');
  }
  function skyLine(w) {
    var line = node('span', 'sky-line');
    var dot = node('span', 'tone-dot');
    dot.setAttribute('data-tone', w.outlook.tone);
    dot.setAttribute('aria-hidden', 'true');
    line.appendChild(dot);
    line.appendChild(node('span', null, w.outlook.text));
    return line;
  }
  function muted(text) { return node('span', 'is-muted', text); }

  function paintWindowWeather(prefix, start, end) {
    var cell = el[prefix + '-wx'];
    cell.textContent = '';
    if (!start || !end) { cell.appendChild(muted('No window this day')); return; }
    if (wx.status === 'loading') { cell.appendChild(muted('Checking the forecast…')); return; }
    if (wx.status === 'none') {
      cell.appendChild(muted(dayOffset(state.day, civilIn(new Date(), state.loc.tz)) > 0 ? 'Forecast opens about 15 days out' : 'No forecast for this date'));
      return;
    }
    var w = wx.status === 'ok' ? wxFor(start, end) : null;
    if (!w) { cell.appendChild(muted(wx.status === 'error' ? 'Forecast unavailable right now' : 'No forecast for this date')); return; }
    cell.appendChild(skyLine(w));
    cell.appendChild(node('small', 'num', wxDetail(w)));
  }

  function paintWeather() {
    var t = times();
    paintWindowWeather('morning', t.goldStart, t.goldEnd);
    paintWindowWeather('evening', t.goldEvStart, t.goldEvEnd);
    renderWeek();
  }

  /* ---------------- rendering ---------------- */

  function setStatus(message, tone) {
    el.status.textContent = message || '';
    el.status.classList.toggle('is-error', tone === 'error');
  }

  function times() { return sunTimes(state.day, state.loc.lat, state.loc.lon); }

  function dayBounds() {
    return { start: zonedInstant(state.day, 0, state.loc.tz), end: zonedInstant(addDays(state.day, 1), 0, state.loc.tz) };
  }

  function renderWindow(prefix, start, end, sunEvent, sunWord, blueA, blueB) {
    var range = el[prefix + '-range'], sub = el[prefix + '-sub'];
    var noonAlt = sunAltitude(times().solarNoon, state.loc.lat, state.loc.lon);
    if (start && end) {
      range.textContent = fmtRange(start, end);
      sub.textContent = fmtDuration(end - start) + (sunEvent ? ' · ' + sunWord + ' ' + fmtTime(sunEvent) : '');
    } else if (start || end) {
      // The sun never climbs past 6°: golden light all day.
      range.textContent = 'Golden light all day';
      sub.textContent = sunEvent ? sunWord + ' ' + fmtTime(sunEvent) : '';
    } else {
      range.textContent = noonAlt > 6 ? 'No golden hour' : 'Sun stays low';
      sub.textContent = noonAlt > 6 ? 'The sun stays high around the clock' : 'Low light most of the day';
    }
    el[prefix + '-blue-row'].hidden = !(blueA && blueB);
    el[prefix + '-blue'].textContent = blueA && blueB ? fmtRange(blueA, blueB) : '';
    el[prefix + '-sun-row'].hidden = !sunEvent;
    el[prefix + '-sun'].textContent = sunEvent ? (prefix === 'morning' ? 'Rises ' : 'Sets ') + bearing(sunEvent) : '';
  }

  /* ---------------- week ---------------- */

  function renderWeek() {
    var today = civilIn(new Date(), state.loc.tz), list = el['week-list'];
    var evening = state.week === 'evening';
    el['week-evening'].setAttribute('aria-pressed', String(evening));
    el['week-morning'].setAttribute('aria-pressed', String(!evening));
    list.textContent = '';
    for (var i = 0; i < 7; i++) {
      var day = addDays(today, i), t = sunTimes(day, state.loc.lat, state.loc.lon);
      var a = evening ? t.goldEvStart : t.goldStart, b = evening ? t.goldEvEnd : t.goldEnd;
      var li = document.createElement('li');
      var row = node('button', 'week-row');
      row.type = 'button';
      row.setAttribute('data-day', dayToValue(day));
      if (sameDay(day, state.day)) row.setAttribute('aria-current', 'date');
      row.appendChild(node('span', 'week-day', i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : shortDate(day)));
      row.appendChild(node('span', 'week-time num', a && b ? fmtRange(a, b) : '—'));
      var sky = node('span', 'week-sky');
      var w = a && b && wx.status === 'ok' ? wxFor(a, b) : null;
      if (w) {
        var dot = node('span', 'tone-dot');
        dot.setAttribute('data-tone', w.outlook.tone);
        dot.setAttribute('aria-hidden', 'true');
        sky.appendChild(dot);
        sky.appendChild(node('span', null, w.outlook.text));
        sky.title = wxDetail(w);
      } else {
        sky.appendChild(node('span', 'is-muted', wx.status === 'loading' ? '…' : ''));
      }
      row.appendChild(sky);
      li.appendChild(row);
      list.appendChild(li);
    }
    el['week-note'].textContent = wx.status === 'error'
      ? 'The forecast didn’t load. Sun times are still exact.'
      : 'Sky outlook from Open-Meteo, at the middle of each window. A rule of thumb, not a promise.';
  }
  el['week-list'].addEventListener('click', function (event) {
    var row = event.target.closest ? event.target.closest('.week-row') : null;
    var day = row && valueToDay(row.getAttribute('data-day'));
    if (day) goTo(day);
  });
  function setWeek(which) {
    state.week = which;
    storageSet(WEEK_KEY, which);
    renderWeek();
  }
  el['week-evening'].addEventListener('click', function () { setWeek('evening'); });
  el['week-morning'].addEventListener('click', function () { setWeek('morning'); });

  /* ---------------- sun path ----------------
     The sun's real altitude through the day, sampled every 6 minutes. The
     golden and blue altitude bands are drawn as stripes, so where the curve
     crosses them *is* the window, not a separate annotation. Hover or drag
     to read any moment. */

  var PATH_W = 1000, PLOT_TOP = 14, PLOT_BOTTOM = 200;
  var pathDrawn = false, plot = null, scrubPct = null;

  function renderPath(t, bounds, now) {
    var lat = state.loc.lat, lon = state.loc.lon, span = bounds.end - bounds.start;
    var samples = [], hi = 12, lo = -12, i;
    for (i = 0; i <= 240; i++) {
      var at = new Date(bounds.start.getTime() + (span * i) / 240);
      var alt = sunAltitude(at, lat, lon);
      samples.push({ x: (i / 240) * PATH_W, alt: alt });
      hi = Math.max(hi, alt); lo = Math.min(lo, alt);
    }
    // Night below the blue band is squeezed (smoothly, no kink at −6°), so the
    // golden and blue bands get more of the plot.
    function squeeze(alt) { return alt < -6 ? -6 - 4 * Math.log(1 + (-6 - alt) / 4) : alt; }
    hi += 4; lo = squeeze(lo) - 2;
    function y(alt) { return PLOT_TOP + ((hi - squeeze(alt)) / (hi - lo)) * (PLOT_BOTTOM - PLOT_TOP); }
    function xAt(date) { return ((date - bounds.start) / span) * PATH_W; }
    function pts(list) { return list.map(function (p) { return p.x.toFixed(1) + ',' + y(p.alt).toFixed(1); }).join(' '); }
    plot = { bounds: bounds, y: y };

    // Highlighted runs where the sun sits in a band.
    var runs = { gold: [], blue: [] }, current = null;
    samples.forEach(function (p) {
      var tone = phaseFor(p.alt).tone;
      if (current && current.tone === tone) current.points.push(p);
      else {
        if (current) current.points.push(p);
        current = { tone: tone, points: [p] };
        if (runs[tone]) runs[tone].push(current);
      }
    });

    var svg = [], ns = ' vector-effect="non-scaling-stroke"', draw = pathDrawn ? '' : ' draw';
    svg.push('<svg viewBox="0 0 ' + PATH_W + ' ' + PLOT_BOTTOM + '" preserveAspectRatio="none" aria-hidden="true">');
    svg.push('<rect class="band-gold" x="0" y="' + y(6).toFixed(1) + '" width="' + PATH_W + '" height="' + (y(-4) - y(6)).toFixed(1) + '"/>');
    svg.push('<rect class="band-blue" x="0" y="' + y(-4).toFixed(1) + '" width="' + PATH_W + '" height="' + (y(-6) - y(-4)).toFixed(1) + '"/>');
    svg.push('<line class="horizon"' + ns + ' x1="0" x2="' + PATH_W + '" y1="' + y(-0.833).toFixed(1) + '" y2="' + y(-0.833).toFixed(1) + '"/>');
    svg.push('<polyline class="curve' + draw + '"' + ns + ' points="' + pts(samples) + '"/>');
    ['blue', 'gold'].forEach(function (tone) {
      runs[tone].forEach(function (run) {
        if (run.points.length > 1) svg.push('<polyline class="curve-' + tone + draw + '"' + ns + ' points="' + pts(run.points) + '"/>');
      });
    });
    svg.push('</svg>');
    // Labels and the sun are HTML over the stretched SVG, so they stay round and crisp.
    var html = ['<div class="path-plot">' + svg.join('')];
    html.push('<span class="band-label" style="top:' + ((y(6) + y(-4)) / 2 / PLOT_BOTTOM * 100).toFixed(2) + '%">Golden</span>');
    if (now && now >= bounds.start && now < bounds.end) {
      var nowAlt = sunAltitude(now, lat, lon);
      var left = (xAt(now) / PATH_W * 100).toFixed(2), top = (y(nowAlt) / PLOT_BOTTOM * 100).toFixed(2);
      html.push('<span class="now-line" style="left:' + left + '%;top:' + top + '%"></span>');
      html.push('<span class="sun' + (nowAlt > -0.833 ? '' : ' is-down') + '" style="left:' + left + '%;top:' + top + '%"></span>');
    }
    html.push('<span class="scrub" hidden></span><span class="scrub-dot" hidden></span><span class="scrub-tip num" hidden></span>');
    html.push('</div><div class="path-axis">');
    [0, 6, 12, 18, 24].forEach(function (h, idx) {
      var tick = h === 24 ? bounds.end : zonedInstant(state.day, h, state.loc.tz);
      html.push('<span style="left:' + (xAt(tick) / PATH_W * 100).toFixed(2) + '%">' + ['12 AM', '6 AM', 'Noon', '6 PM', '12 AM'][idx] + '</span>');
    });
    html.push('</div>');
    el.path.innerHTML = html.join('');
    pathDrawn = true;
    if (scrubPct !== null) showScrub(scrubPct);
  }

  function showScrub(pct) {
    var box = el.path.querySelector('.path-plot');
    if (!box || !plot) return;
    var line = box.querySelector('.scrub'), dot = box.querySelector('.scrub-dot'), tip = box.querySelector('.scrub-tip');
    var span = plot.bounds.end - plot.bounds.start;
    var at = new Date(plot.bounds.start.getTime() + span * pct);
    var alt = sunAltitude(at, state.loc.lat, state.loc.lon);
    var phase = phaseFor(alt);
    var left = (pct * 100).toFixed(2) + '%';
    line.style.left = left;
    dot.style.left = left;
    dot.style.top = (plot.y(alt) / PLOT_BOTTOM * 100).toFixed(2) + '%';
    tip.style.left = 'clamp(60px, ' + left + ', calc(100% - 60px))';
    tip.textContent = fmtTime(at) + ' · ' + phase.label + ' · ' + (alt >= 0 ? '' : '−') + Math.abs(alt).toFixed(0) + '°';
    line.hidden = dot.hidden = tip.hidden = false;
  }
  function hideScrub() {
    scrubPct = null;
    Array.prototype.forEach.call(el.path.querySelectorAll('.scrub, .scrub-dot, .scrub-tip'), function (n) { n.hidden = true; });
  }
  function scrubFrom(event) {
    var box = el.path.querySelector('.path-plot');
    if (!box) return;
    var rect = box.getBoundingClientRect();
    if (!rect.width) return;
    scrubPct = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    showScrub(scrubPct);
  }
  el.path.addEventListener('pointermove', scrubFrom);
  el.path.addEventListener('pointerdown', scrubFrom);
  el.path.addEventListener('pointerleave', hideScrub);
  el.path.addEventListener('pointercancel', hideScrub);

  function pathLabel(t) {
    var parts = ['The sun’s height through the day.'];
    if (t.goldStart && t.goldEnd) parts.push('Morning golden hour ' + fmtRange(t.goldStart, t.goldEnd) + '.');
    if (t.goldEvStart && t.goldEvEnd) parts.push('Evening golden hour ' + fmtRange(t.goldEvStart, t.goldEvEnd) + '.');
    return parts.join(' ');
  }

  function renderZoneNote() {
    var note = el['zone-note'];
    var now = new Date();
    if (!state.loc.tzKnown) {
      // A typed point still on the device clock: flag one that is clearly
      // somewhere else rather than silently showing odd times.
      var implied = Math.round(state.loc.lon / 15);
      var device = offsetMs(now, DEVICE_TZ) / HOUR_MS;
      note.hidden = !(state.loc.kind === 'custom' && Math.abs(device - implied) >= 3);
      note.textContent = 'Times use this device’s clock until the forecast finds this spot’s time zone';
      return;
    }
    var diffH = (offsetMs(now, state.loc.tz) - offsetMs(now, DEVICE_TZ)) / HOUR_MS;
    if (diffH === 0) { note.hidden = true; return; }
    var hours = Math.abs(diffH);
    note.hidden = false;
    note.textContent = 'Local time there (' + zoneName(state.loc.tz, 'short') + '), ' +
      hours + (hours === 1 ? ' hour ' : ' hours ') + (diffH > 0 ? 'ahead of you' : 'behind you');
  }

  function render() {
    var t = times();
    el.date.value = dayToValue(state.day);
    el['date-label'].textContent = dayHeading(state.day);
    renderWindow('morning', t.goldStart, t.goldEnd, t.sunrise, 'sunrise', t.blueStart, t.goldStart);
    renderWindow('evening', t.goldEvStart, t.goldEvEnd, t.sunset, 'sunset', t.goldEvEnd, t.blueEnd);
    el.path.setAttribute('aria-label', pathLabel(t));
    pathDrawn = false;
    renderZoneNote();
    el['today-link'].hidden = sameDay(state.day, civilIn(new Date(), state.loc.tz));
    syncUrl();
    loadWeather();
    refreshLive();
  }

  // Purpose-first labels: what changes about the light next.
  var NEXT_LABELS = { blueStart: 'Blue hour', goldStart: 'Golden hour', goldEvStart: 'Golden hour', blueEnd: 'dark' };
  var DEFAULT_TITLE = document.title;

  function nextEvents(now) {
    var list = [];
    [0, 1].forEach(function (offset) {
      var t = sunTimes(addDays(civilIn(now, state.loc.tz), offset), state.loc.lat, state.loc.lon);
      ['blueStart', 'goldStart', 'goldEnd', 'goldEvStart', 'goldEvEnd', 'blueEnd'].forEach(function (key) {
        if (t[key] && t[key] > now) list.push({ key: key, date: t[key] });
      });
    });
    return list.sort(function (a, b) { return a.date - b.date; });
  }

  function setSub(parts) {
    // parts: [text, bold, text, ...]; alternating plain and emphasised runs.
    el['hero-sub'].textContent = '';
    parts.forEach(function (part, i) {
      if (!part) return;
      // When the line wraps, keep a separator dot with the words before it
      // and a time with its AM or PM.
      el['hero-sub'].appendChild(node(i % 2 ? 'b' : 'span', null, part.replace(/ · /g, ' · ').replace(/ (AM|PM)\b/g, ' $1')));
    });
  }
  // [top of sky, bottom of sky]: the browser chrome takes the top colour and
  // overscroll / the page end take the bottom one.
  var SKY_COLORS = { night: ['#05071a', '#1a2150'], blue: ['#0a1440', '#3f64b8'], gold: ['#232552', '#eea763'], day: ['#7fb6f2', '#fbf3e4'] };
  function setSky(tone, live) {
    document.body.setAttribute('data-sky', tone);
    if (live) document.body.setAttribute('data-live', live);
    else document.body.removeAttribute('data-live');
    document.documentElement.style.backgroundColor = SKY_COLORS[tone][1];
    if (themeColor) themeColor.setAttribute('content', SKY_COLORS[tone][0]);
  }
  function placeName() {
    if (state.loc.kind !== 'venue') return state.loc.kind === 'gps' ? 'Your location' : 'Custom spot';
    return VENUES[state.loc.id].name;
  }

  var liveTimer = null;
  function refreshLive() {
    var now = new Date();
    var today = civilIn(now, state.loc.tz);
    if (state.followToday && !sameDay(state.day, today)) { state.day = today; render(); return; }
    var isToday = sameDay(state.day, today);
    var t = times();

    function within(a, b) { return a && b && now >= a && now < b; }
    function past(b) { return isToday && b && now >= b; }
    var morningNow = isToday && within(t.goldStart, t.goldEnd);
    var eveningNow = isToday && within(t.goldEvStart, t.goldEvEnd);
    el['morning-card'].classList.toggle('is-now', !!morningNow);
    el['evening-card'].classList.toggle('is-now', !!eveningNow);
    el['morning-card'].classList.toggle('is-past', !morningNow && !!past(t.goldEnd));
    el['evening-card'].classList.toggle('is-past', !eveningNow && !!past(t.goldEvEnd));
    el['morning-tag'].hidden = !morningNow;
    el['evening-tag'].hidden = !eveningNow;
    renderPath(t, dayBounds(), isToday ? now : null);

    if (!isToday) {
      // Another day: show its evening window under a golden sky.
      setSky('gold');
      el['hero-eyebrow'].textContent = dateText(state.day, { weekday: 'long', month: 'long', day: 'numeric' }) + ' · ' + placeName();
      el['hero-title'].textContent = 'Golden hour';
      if (t.goldEvStart && t.goldEvEnd) setSub(['Evening from ', fmtTime(t.goldEvStart), ' · ' + fmtDuration(t.goldEvEnd - t.goldEvStart), '']);
      else setSub(['', el['evening-range'].textContent]);
      document.title = DEFAULT_TITLE;
      return;
    }

    var phase = phaseFor(sunAltitude(now, state.loc.lat, state.loc.lon));
    var events = nextEvents(now);
    if (phase.active) {
      var ends = events[0];
      setSky(phase.tone, phase.tone);
      el['hero-eyebrow'].textContent = 'Now · ' + fmtTime(now) + ' · ' + placeName();
      el['hero-title'].textContent = phase.label;
      if (ends) setSub(['', fmtDuration(ends.date - now), ' left · until ' + fmtTime(ends.date), '']);
      else setSub(['', 'All day']);
      document.title = phase.label + (ends ? ' · ' + fmtDuration(ends.date - now) + ' left' : '');
    } else {
      setSky(phase.tone);
      var next = events.filter(function (e) { return NEXT_LABELS[e.key] && NEXT_LABELS[e.key] !== 'dark'; })[0];
      el['hero-eyebrow'].textContent = phase.label + ' · ' + fmtTime(now) + ' · ' + placeName();
      if (next) {
        el['hero-title'].textContent = NEXT_LABELS[next.key];
        var tomorrow = !sameDay(civilIn(next.date, state.loc.tz), today);
        setSub(['in ', fmtDuration(next.date - now), ' · starts ' + (tomorrow ? 'tomorrow ' : '') + fmtTime(next.date), '']);
      } else {
        el['hero-title'].textContent = phase.label;
        setSub(['']);
      }
      document.title = DEFAULT_TITLE;
    }
  }
  function startTimer() { if (!liveTimer) liveTimer = setInterval(refreshLive, LIVE_REFRESH_MS); }
  function stopTimer() { if (liveTimer) { clearInterval(liveTimer); liveTimer = null; } }
  // No ticking in a background tab; catch up the moment it comes back.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { stopTimer(); return; }
    refreshLive();
    startTimer();
  });

  /* ---------------- URL (shareable venue + date, never a GPS fix) ---------------- */

  function shareParams() {
    var p = new URLSearchParams();
    if (state.loc.kind === 'venue') p.set('at', state.loc.id);
    else if (state.loc.kind === 'custom') { p.set('lat', state.loc.lat.toFixed(4)); p.set('lon', state.loc.lon.toFixed(4)); }
    if (!sameDay(state.day, civilIn(new Date(), state.loc.tz))) p.set('date', dayToValue(state.day));
    return p.toString();
  }
  function syncUrl() {
    try {
      var qs = shareParams();
      window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''));
    } catch (e) { /* file:// or sandboxed */ }
  }

  /* ---------------- date controls ---------------- */

  function goTo(day) {
    state.day = day;
    state.followToday = sameDay(day, civilIn(new Date(), state.loc.tz));
    render();
  }
  el.date.addEventListener('change', function () { var d = valueToDay(el.date.value); if (d) goTo(d); });
  el['prev-day'].addEventListener('click', function () { goTo(addDays(state.day, -1)); });
  el['next-day'].addEventListener('click', function () { goTo(addDays(state.day, 1)); });
  el['today-link'].addEventListener('click', function () { goTo(civilIn(new Date(), state.loc.tz)); });

  document.addEventListener('keydown', function (event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    var tag = (event.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); goTo(addDays(state.day, -1)); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); goTo(addDays(state.day, 1)); }
    else if (event.key === 't' || event.key === 'T') { goTo(civilIn(new Date(), state.loc.tz)); }
  });

  /* ---------------- copy ---------------- */

  function copy(text, done) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) { setStatus('Copying needs a secure (https) page.', 'error'); return; }
    navigator.clipboard.writeText(text).then(function () { setStatus(done); }, function () { setStatus('This browser blocked copying.', 'error'); });
  }

  el['copy-times'].addEventListener('click', function () {
    var t = times();
    var zone = zoneName(state.loc.tz, 'short', t.solarNoon);
    function windowLine(label, a, b, event, word) {
      var line = label + ': ' + (a && b ? fmtRange(a, b) : '—') + (event ? ' (' + word + ' ' + fmtTime(event) + ', ' + bearing(event) + ')' : '');
      var w = a && b && wx.status === 'ok' ? wxFor(a, b) : null;
      return w ? line + ' · ' + w.outlook.text + ', ' + wxDetail(w) : line;
    }
    var lines = [
      'Golden hour · ' + state.loc.label + ' · ' + shortDate(state.day) + ' (' + zone + ')',
      windowLine('Morning', t.goldStart, t.goldEnd, t.sunrise, 'sunrise'),
      windowLine('Evening', t.goldEvStart, t.goldEvEnd, t.sunset, 'sunset')
    ];
    if (t.blueStart && t.goldStart && t.goldEvEnd && t.blueEnd) {
      lines.push('Blue hour: ' + fmtRange(t.blueStart, t.goldStart) + ' and ' + fmtRange(t.goldEvEnd, t.blueEnd));
    }
    copy(lines.join('\n'), 'Times copied.');
  });

  el['copy-link'].addEventListener('click', function () {
    var qs = shareParams();
    var url = window.location.origin + '/golden-hour' + (qs ? '?' + qs : '');
    copy(url, state.loc.kind === 'gps' ? 'Link copied. It opens on Camp Randall, since links never include your location.' : 'Link copied.');
  });

  /* ---------------- start ---------------- */

  buildVenueOptions();
  render();
  startTimer();
})();
