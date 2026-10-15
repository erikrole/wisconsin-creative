/* Golden Hour page wiring. Venues and sun maths live in core.js.
   Client-only: no network requests. The last location lives in localStorage. */
(function () {
  'use strict';

  var LOCATION_KEY = 'ght.location.v3';
  var LEGACY_LOCATION_KEY = 'ght.lastlocation.v2';
  var LIVE_REFRESH_MS = 20000;

  var C = window.GoldenHourCore;
  var VENUE_GROUPS = C.VENUE_GROUPS, VENUES = C.VENUES, DEFAULT_VENUE = C.DEFAULT_VENUE, HOUR_MS = C.HOUR_MS;
  var sunAltitude = C.sunAltitude, sunTimes = C.sunTimes, phaseFor = C.phaseFor, DEVICE_TZ = C.DEVICE_TZ;
  var offsetMs = C.offsetMs, zonedInstant = C.zonedInstant, civilIn = C.civilIn;
  var addDays = C.addDays, sameDay = C.sameDay, dayToValue = C.dayToValue, valueToDay = C.valueToDay;

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
    return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
  }
  function zoneName(tz, style, at) {
    try {
      var part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: style })
        .formatToParts(at || new Date()).filter(function (p) { return p.type === 'timeZoneName'; })[0];
      return part ? part.value : tz;
    } catch (e) { return tz; }
  }
  function shortDate(day) {
    return new Date(Date.UTC(day.y, day.m - 1, day.d, 12)).toLocaleDateString([], { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
  }
  function dayHeading(day) {
    var today = civilIn(new Date(), state.loc.tz);
    var tag = sameDay(day, today) ? 'Today' : sameDay(day, addDays(today, 1)) ? 'Tomorrow' : sameDay(day, addDays(today, -1)) ? 'Yesterday' : '';
    if (tag === 'Today') return 'Today · ' + shortDate(day);
    return tag === 'Tomorrow' || tag === 'Yesterday' ? tag : shortDate(day);
  }

  /* ---------------- state + storage ---------------- */

  function storageGet(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
  function storageSet(key, value) { try { window.localStorage.setItem(key, value); } catch (e) { /* private mode */ } }

  function venueLocation(id) {
    var v = VENUES[id];
    return { kind: 'venue', id: v.id, label: v.name + (v.name.indexOf(v.city) === -1 ? ', ' + v.city : ''), lat: v.lat, lon: v.lon, tz: v.tz };
  }
  function pointLocation(kind, lat, lon) {
    return { kind: kind, id: kind, label: (kind === 'gps' ? 'My location' : 'Custom') + ' (' + lat.toFixed(2) + ', ' + lon.toFixed(2) + ')', lat: lat, lon: lon, tz: DEVICE_TZ };
  }
  function validPoint(lat, lon) { return isFinite(lat) && isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180; }

  function loadSavedLocation() {
    var saved = null;
    try { saved = JSON.parse(storageGet(LOCATION_KEY) || 'null'); } catch (e) { saved = null; }
    if (saved && saved.kind === 'venue' && VENUES[saved.id]) return venueLocation(saved.id);
    if (saved && (saved.kind === 'gps' || saved.kind === 'custom') && validPoint(saved.lat, saved.lon)) return pointLocation(saved.kind, saved.lat, saved.lon);
    // The previous build stored only a GPS fix (or the Madison default).
    try { saved = JSON.parse(storageGet(LEGACY_LOCATION_KEY) || 'null'); } catch (e) { saved = null; }
    if (saved && /^Your location/.test(saved.label || '') && validPoint(saved.lat, saved.lon)) return pointLocation('gps', saved.lat, saved.lon);
    return null;
  }
  function persistLocation() {
    var l = state.loc;
    storageSet(LOCATION_KEY, JSON.stringify(l.kind === 'venue' ? { kind: 'venue', id: l.id } : { kind: l.kind, lat: l.lat, lon: l.lon }));
  }

  var params = new URLSearchParams(window.location.search);
  var initialLoc = null;
  if (params.get('at') && VENUES[params.get('at')]) initialLoc = venueLocation(params.get('at'));
  else if (validPoint(parseFloat(params.get('lat')), parseFloat(params.get('lon')))) initialLoc = pointLocation('custom', parseFloat(params.get('lat')), parseFloat(params.get('lon')));
  var state = { loc: initialLoc || loadSavedLocation() || venueLocation(DEFAULT_VENUE) };
  state.day = valueToDay(params.get('date')) || civilIn(new Date(), state.loc.tz);
  // While the user is looking at "today", keep following it past midnight.
  state.followToday = sameDay(state.day, civilIn(new Date(), state.loc.tz));

  /* ---------------- elements ---------------- */

  var el = {};
  ['venue', 'date', 'date-label', 'prev-day', 'next-day', 'today-link', 'zone-note',
   'hero-eyebrow', 'hero-title', 'hero-sub', 'path', 'morning-card', 'evening-card', 'morning-tag', 'evening-tag',
   'morning-range', 'morning-sub', 'morning-blue', 'evening-range', 'evening-sub', 'evening-blue',
   'custom', 'lat', 'lon', 'apply-custom', 'copy-times', 'copy-link', 'status'
  ].forEach(function (id) { el[id] = document.getElementById(id); });
  var themeColor = document.querySelector('meta[name="theme-color"]');

  /* ---------------- location picker ---------------- */

  function buildVenueOptions() {
    el.venue.textContent = '';
    VENUE_GROUPS.forEach(function (group) {
      var og = document.createElement('optgroup');
      og.label = group.label;
      group.venues.forEach(function (v) {
        var opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = v.name + (v.name.indexOf(v.city) === -1 ? ' — ' + v.city : '');
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
    // "Today" means today where the venue is, not where this device is.
    if (wasToday) state.day = civilIn(new Date(), loc.tz);
    persistLocation();
    buildVenueOptions();
    render();
  }

  el.venue.addEventListener('change', function () {
    var value = el.venue.value;
    setStatus('');
    if (VENUES[value]) {
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
      setStatus('Using your location. Times are in this device’s time zone.');
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
    input.addEventListener('keydown', function (event) { if (event.key === 'Enter') applyCustom(); });
  });

  /* ---------------- rendering ---------------- */

  function setStatus(message, tone) {
    el.status.textContent = message || '';
    el.status.classList.toggle('is-error', tone === 'error');
  }

  function times() { return sunTimes(state.day, state.loc.lat, state.loc.lon); }

  function dayBounds() {
    return { start: zonedInstant(state.day, 0, state.loc.tz), end: zonedInstant(addDays(state.day, 1), 0, state.loc.tz) };
  }
  // Measured, not assumed 24h, so DST changeover days line up.
  function dayPct(date, bounds) {
    var span = bounds.end - bounds.start;
    return Math.max(0, Math.min(100, ((date - bounds.start) / span) * 100));
  }

  function renderWindow(prefix, start, end, sunEvent, sunWord, blueA, blueB) {
    var range = el[prefix + '-range'], sub = el[prefix + '-sub'], blue = el[prefix + '-blue'];
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
    if (blueA && blueB) {
      blue.hidden = false;
      blue.innerHTML = '';
      blue.appendChild(document.createElement('i'));
      blue.appendChild(document.createTextNode('Blue hour '));
      var b = document.createElement('b');
      b.textContent = fmtRange(blueA, blueB);
      blue.appendChild(b);
    } else {
      blue.hidden = true;
    }
  }

  /* ---------------- sun path ----------------
     The sun's real altitude through the day, sampled every 6 minutes. The
     golden and blue altitude bands are drawn as stripes, so where the curve
     crosses them *is* the window, not a separate annotation. */

  var PATH_W = 1000, PLOT_TOP = 14, PLOT_BOTTOM = 200;
  var pathDrawn = false;

  function renderPath(t, bounds, now) {
    var lat = state.loc.lat, lon = state.loc.lon, span = bounds.end - bounds.start;
    var samples = [], hi = 12, lo = -12, i;
    for (i = 0; i <= 240; i++) {
      var at = new Date(bounds.start.getTime() + (span * i) / 240);
      var alt = sunAltitude(at, lat, lon);
      samples.push({ x: (i / 240) * PATH_W, alt: alt });
      hi = Math.max(hi, alt); lo = Math.min(lo, alt);
    }
    hi += 4; lo -= 2;
    function y(alt) { return PLOT_TOP + ((hi - alt) / (hi - lo)) * (PLOT_BOTTOM - PLOT_TOP); }
    function xAt(date) { return ((date - bounds.start) / span) * PATH_W; }
    function pts(list) { return list.map(function (p) { return p.x.toFixed(1) + ',' + y(p.alt).toFixed(1); }).join(' '); }

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

    var svg = [], ns = ' vector-effect="non-scaling-stroke"';
    svg.push('<svg viewBox="0 0 ' + PATH_W + ' ' + PLOT_BOTTOM + '" preserveAspectRatio="none" aria-hidden="true">');
    svg.push('<rect class="band-gold" x="0" y="' + y(6).toFixed(1) + '" width="' + PATH_W + '" height="' + (y(-4) - y(6)).toFixed(1) + '"/>');
    svg.push('<rect class="band-blue" x="0" y="' + y(-4).toFixed(1) + '" width="' + PATH_W + '" height="' + (y(-6) - y(-4)).toFixed(1) + '"/>');
    svg.push('<line class="horizon"' + ns + ' x1="0" x2="' + PATH_W + '" y1="' + y(-0.833).toFixed(1) + '" y2="' + y(-0.833).toFixed(1) + '"/>');
    svg.push('<polyline class="curve' + (pathDrawn ? '' : ' draw') + '"' + ns + ' points="' + pts(samples) + '"/>');
    ['blue', 'gold'].forEach(function (tone) {
      runs[tone].forEach(function (run) {
        if (run.points.length > 1) svg.push('<polyline class="curve-' + tone + (pathDrawn ? '' : ' draw') + '"' + ns + ' points="' + pts(run.points) + '"/>');
      });
    });
    svg.push('</svg>');
    // Labels and the sun are HTML over the stretched SVG, so they stay round and crisp.
    var html = ['<div class="path-plot">' + svg.join('')];
    html.push('<span class="band-label" style="top:' + ((y(6) + y(-4)) / 2 / PLOT_BOTTOM * 100).toFixed(2) + '%">Golden</span>');
    if (now && now >= bounds.start && now < bounds.end) {
      var alt = sunAltitude(now, lat, lon);
      var left = (xAt(now) / PATH_W * 100).toFixed(2), top = (y(alt) / PLOT_BOTTOM * 100).toFixed(2);
      html.push('<span class="now-line" style="left:' + left + '%;top:' + top + '%"></span>');
      html.push('<span class="sun' + (alt > -0.833 ? '' : ' is-down') + '" style="left:' + left + '%;top:' + top + '%"></span>');
    }
    html.push('</div><div class="path-axis">');
    [0, 6, 12, 18, 24].forEach(function (h, idx) {
      var at = h === 24 ? bounds.end : zonedInstant(state.day, h, state.loc.tz);
      html.push('<span style="left:' + (xAt(at) / PATH_W * 100).toFixed(2) + '%">' + ['12 AM', '6 AM', 'Noon', '6 PM', '12 AM'][idx] + '</span>');
    });
    html.push('</div>');
    el.path.innerHTML = html.join('');
    pathDrawn = true;
  }

  function renderZoneNote() {
    var note = el['zone-note'];
    var now = new Date();
    var diffH = (offsetMs(now, state.loc.tz) - offsetMs(now, DEVICE_TZ)) / HOUR_MS;
    note.classList.remove('is-warn');
    if (state.loc.kind !== 'venue') {
      // GPS/custom points use the device clock; flag a custom point that is
      // clearly somewhere else rather than silently showing odd times.
      var implied = Math.round(state.loc.lon / 15);
      var device = offsetMs(now, DEVICE_TZ) / HOUR_MS;
      note.hidden = !(state.loc.kind === 'custom' && Math.abs(device - implied) >= 3);
      note.textContent = 'Times use this device’s clock. This spot looks to be in another time zone.';
      note.classList.add('is-warn');
      return;
    }
    if (diffH === 0) { note.hidden = true; return; }
    var hours = Math.abs(diffH);
    note.hidden = false;
    note.textContent = 'Times in ' + zoneName(state.loc.tz, 'short') + ', local time there · ' +
      hours + (hours === 1 ? ' hour ' : ' hours ') + (diffH > 0 ? 'ahead of you' : 'behind you');
  }

  function render() {
    var t = times();
    var bounds = dayBounds();
    el.date.value = dayToValue(state.day);
    el['date-label'].textContent = dayHeading(state.day);
    renderWindow('morning', t.goldStart, t.goldEnd, t.sunrise, 'sunrise', t.blueStart, t.goldStart);
    renderWindow('evening', t.goldEvStart, t.goldEvEnd, t.sunset, 'sunset', t.goldEvEnd, t.blueEnd);
    pathDrawn = false;
    renderPath(t, bounds, sameDay(state.day, civilIn(new Date(), state.loc.tz)) ? new Date() : null);
    renderZoneNote();
    el['today-link'].hidden = sameDay(state.day, civilIn(new Date(), state.loc.tz));
    syncUrl();
    refreshLive();
  }

  // Purpose-first labels: what changes about the light next.
  var NEXT_LABELS = { blueStart: 'blue hour', goldStart: 'golden hour', goldEvStart: 'golden hour', blueEnd: 'dark' };
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

  function fmtLong(ms) {
    var total = Math.max(0, Math.round(ms / 60000));
    var h = Math.floor(total / 60), m = total % 60;
    return h > 0 ? h + 'h ' + m + 'm' : m + ' min';
  }
  function setSub(parts) {
    // parts: [text, bold, text, ...]; alternating plain and emphasised runs.
    el['hero-sub'].textContent = '';
    parts.forEach(function (part, i) {
      if (!part) return;
      var node = i % 2 ? document.createElement('b') : document.createElement('span');
      node.textContent = part;
      el['hero-sub'].appendChild(node);
    });
  }
  // [top of sky, bottom of sky]: the browser chrome takes the top colour and
  // overscroll / the page end take the bottom one.
  var SKY_COLORS = { night: ['#05071a', '#1a2150'], blue: ['#0a1440', '#3f64b8'], gold: ['#232552', '#eea763'], day: ['#7fb6f2', '#fbf3e4'] };
  function setSky(tone) {
    document.body.setAttribute('data-sky', tone);
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
    el['morning-card'].classList.toggle('is-now', morningNow);
    el['evening-card'].classList.toggle('is-now', eveningNow);
    el['morning-card'].classList.toggle('is-past', !morningNow && past(t.goldEnd));
    el['evening-card'].classList.toggle('is-past', !eveningNow && past(t.goldEvEnd));
    el['morning-tag'].hidden = !morningNow;
    el['evening-tag'].hidden = !eveningNow;

    if (!isToday) {
      // Another day: show its evening window under a golden sky.
      setSky('gold');
      document.body.removeAttribute('data-live');
      el['hero-eyebrow'].textContent = new Date(Date.UTC(state.day.y, state.day.m - 1, state.day.d, 12))
        .toLocaleDateString([], { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }) + ' · ' + placeName();
      el['hero-title'].textContent = 'Golden hour';
      if (t.goldEvStart && t.goldEvEnd) setSub(['Evening from ', fmtTime(t.goldEvStart), ' · ' + fmtLong(t.goldEvEnd - t.goldEvStart), '']);
      else setSub(['', el['evening-range'].textContent]);
      document.title = DEFAULT_TITLE;
      return;
    }

    var phase = phaseFor(sunAltitude(now, state.loc.lat, state.loc.lon));
    var events = nextEvents(now);
    setSky(phase.tone);
    renderPath(t, dayBounds(), now);
    if (phase.active) {
      var ends = events[0];
      document.body.setAttribute('data-live', phase.tone);
      el['hero-eyebrow'].textContent = 'Now · ' + fmtTime(now) + ' · ' + placeName();
      el['hero-title'].textContent = phase.label;
      if (ends) setSub(['', fmtLong(ends.date - now), ' left · until ' + fmtTime(ends.date), '']);
      else setSub(['', 'All day']);
      document.title = phase.label + (ends ? ' · ' + fmtLong(ends.date - now) + ' left' : '');
    } else {
      document.body.removeAttribute('data-live');
      var next = events.filter(function (e) { return NEXT_LABELS[e.key] && NEXT_LABELS[e.key] !== 'dark'; })[0];
      el['hero-eyebrow'].textContent = phase.label + ' · ' + fmtTime(now) + ' · ' + placeName();
      if (next) {
        el['hero-title'].textContent = NEXT_LABELS[next.key].charAt(0).toUpperCase() + NEXT_LABELS[next.key].slice(1);
        var tomorrow = !sameDay(civilIn(next.date, state.loc.tz), today);
        setSub(['in ', fmtLong(next.date - now), ' · starts ' + (tomorrow ? 'tomorrow ' : '') + fmtTime(next.date), '']);
      } else {
        el['hero-title'].textContent = phase.label;
        setSub(['']);
      }
      document.title = DEFAULT_TITLE;
    }

    if (!liveTimer) liveTimer = setInterval(refreshLive, LIVE_REFRESH_MS);
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshLive(); });

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
    var line = function (a, b) { return a && b ? fmtRange(a, b) : '—'; };
    var lines = [
      'Golden hour · ' + state.loc.label + ' · ' + shortDate(state.day) + ' (' + zone + ')',
      'Morning: ' + line(t.goldStart, t.goldEnd) + (t.sunrise ? ' (sunrise ' + fmtTime(t.sunrise) + ')' : ''),
      'Evening: ' + line(t.goldEvStart, t.goldEvEnd) + (t.sunset ? ' (sunset ' + fmtTime(t.sunset) + ')' : '')
    ];
    if (t.blueStart && t.goldStart && t.goldEvEnd && t.blueEnd) {
      lines.push('Blue hour: ' + line(t.blueStart, t.goldStart) + ' and ' + line(t.goldEvEnd, t.blueEnd));
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
})();
