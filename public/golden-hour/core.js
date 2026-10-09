/* Golden Hour core — venues, sun position and time-zone maths. No DOM.
   Loaded by the page before app.js and by tests/static-tools.test.ts. */
(function (root) {
  'use strict';

  /* -----------------------------------------------------------------------
     Venues. Coordinates are stadium/arena-level; the sun moves ~1 minute per
     ~20 km, so campus-level precision is far inside the model's own error.
     Every venue carries its real IANA time zone, so a road shoot reads in
     local time wherever this page is opened.
     ----------------------------------------------------------------------- */
  var CHICAGO = 'America/Chicago', NEW_YORK = 'America/New_York', DETROIT = 'America/Detroit';
  var INDIANA = 'America/Indiana/Indianapolis', LA = 'America/Los_Angeles';

  var VENUE_GROUPS = [
    { label: 'Wisconsin', venues: [
      { id: 'camp-randall', name: 'Camp Randall Stadium', city: 'Madison', lat: 43.0700, lon: -89.4127, tz: CHICAGO },
      { id: 'kohl-center', name: 'Kohl Center', city: 'Madison', lat: 43.0697, lon: -89.3963, tz: CHICAGO },
      { id: 'field-house', name: 'UW Field House', city: 'Madison', lat: 43.0696, lon: -89.4132, tz: CHICAGO },
      { id: 'labahn', name: 'LaBahn Arena', city: 'Madison', lat: 43.0689, lon: -89.3975, tz: CHICAGO }
    ] },
    { label: 'Big Ten road', venues: [
      { id: 'illinois', name: 'Illinois', city: 'Champaign', lat: 40.0992, lon: -88.2360, tz: CHICAGO },
      { id: 'indiana', name: 'Indiana', city: 'Bloomington', lat: 39.1808, lon: -86.5256, tz: INDIANA },
      { id: 'iowa', name: 'Iowa', city: 'Iowa City', lat: 41.6587, lon: -91.5511, tz: CHICAGO },
      { id: 'maryland', name: 'Maryland', city: 'College Park', lat: 38.9903, lon: -76.9474, tz: NEW_YORK },
      { id: 'michigan', name: 'Michigan', city: 'Ann Arbor', lat: 42.2658, lon: -83.7487, tz: DETROIT },
      { id: 'michigan-state', name: 'Michigan State', city: 'East Lansing', lat: 42.7281, lon: -84.4848, tz: DETROIT },
      { id: 'minnesota', name: 'Minnesota', city: 'Minneapolis', lat: 44.9765, lon: -93.2246, tz: CHICAGO },
      { id: 'nebraska', name: 'Nebraska', city: 'Lincoln', lat: 40.8206, lon: -96.7056, tz: CHICAGO },
      { id: 'northwestern', name: 'Northwestern', city: 'Evanston', lat: 42.0656, lon: -87.6925, tz: CHICAGO },
      { id: 'ohio-state', name: 'Ohio State', city: 'Columbus', lat: 40.0017, lon: -83.0197, tz: NEW_YORK },
      { id: 'oregon', name: 'Oregon', city: 'Eugene', lat: 44.0582, lon: -123.0685, tz: LA },
      { id: 'penn-state', name: 'Penn State', city: 'State College', lat: 40.8122, lon: -77.8561, tz: NEW_YORK },
      { id: 'purdue', name: 'Purdue', city: 'West Lafayette', lat: 40.4351, lon: -86.9186, tz: INDIANA },
      { id: 'rutgers', name: 'Rutgers', city: 'Piscataway', lat: 40.5138, lon: -74.4648, tz: NEW_YORK },
      { id: 'ucla', name: 'UCLA', city: 'Pasadena', lat: 34.1613, lon: -118.1676, tz: LA },
      { id: 'usc', name: 'USC', city: 'Los Angeles', lat: 34.0141, lon: -118.2879, tz: LA },
      { id: 'washington', name: 'Washington', city: 'Seattle', lat: 47.6503, lon: -122.3016, tz: LA }
    ] }
  ];
  var VENUES = {};
  VENUE_GROUPS.forEach(function (g) { g.venues.forEach(function (v) { VENUES[v.id] = v; }); });
  var DEFAULT_VENUE = 'camp-randall';

  /* -----------------------------------------------------------------------
     Solar position — the standard low-precision Astronomical Almanac
     formulas behind SunCalc.js (BSD-2-Clause, (c) Vladimir Agafonkin),
     reimplemented without a dependency. Clock times land within 1–3 minutes
     of timeanddate.com for Madison.
     ----------------------------------------------------------------------- */
  var PI = Math.PI, RAD = PI / 180, DAY_MS = 86400000, HOUR_MS = 3600000, J1970 = 2440588, J2000 = 2451545;
  var OBLIQUITY = RAD * 23.4397, J0 = 0.0009;

  function toDays(date) { return (date.valueOf() / DAY_MS - 0.5 + J1970) - J2000; }
  function fromJulian(j) { return isNaN(j) ? null : new Date((j + 0.5 - J1970) * DAY_MS); }
  function rightAscension(l) { return Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY), Math.cos(l)); }
  function declination(l) { return Math.asin(Math.sin(OBLIQUITY) * Math.sin(l)); }
  function altitudeOf(H, phi, dec) { return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)); }
  function siderealTime(d, lw) { return RAD * (280.16 + 360.9856235 * d) - lw; }
  function solarMeanAnomaly(d) { return RAD * (357.5291 + 0.98560028 * d); }
  function eclipticLongitude(M) {
    var C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    return M + C + RAD * 102.9372 + PI;
  }

  function sunAltitude(date, lat, lon) {
    var d = toDays(date), L = eclipticLongitude(solarMeanAnomaly(d));
    var H = siderealTime(d, RAD * -lon) - rightAscension(L);
    return altitudeOf(H, RAD * lat, declination(L)) / RAD;
  }

  function julianCycle(d, lw) { return Math.round(d - J0 - lw / (2 * PI)); }
  function approxTransit(Ht, lw, n) { return J0 + (Ht + lw) / (2 * PI) + n; }
  function solarTransitJ(ds, M, L) { return J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L); }
  function hourAngle(h, phi, dec) { return Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec))); }

  // Photographer convention (PhotoPills): golden hour is the sun between +6°
  // and −4°, blue hour between −4° and −6°. Sunrise/sunset (−0.833°) are
  // reported alongside for reference.
  var ANGLES = [
    [-6, 'blueStart', 'blueEnd'],
    [-4, 'goldStart', 'goldEvEnd'],
    [-0.833, 'sunrise', 'sunset'],
    [6, 'goldEnd', 'goldEvStart']
  ];

  // Sun times for a civil date at a location. The reference instant is local
  // *solar* noon, which keeps the Julian cycle on the right day in any zone.
  function sunTimes(day, lat, lon) {
    var ref = new Date(Date.UTC(day.y, day.m - 1, day.d, 12) - (lon / 15) * HOUR_MS);
    var lw = RAD * -lon, phi = RAD * lat, d = toDays(ref);
    var n = julianCycle(d, lw), ds = approxTransit(0, lw, n);
    var M = solarMeanAnomaly(ds), L = eclipticLongitude(M), dec = declination(L);
    var Jnoon = solarTransitJ(ds, M, L);
    var out = { solarNoon: fromJulian(Jnoon) };
    ANGLES.forEach(function (row) {
      var w = hourAngle(row[0] * RAD, phi, dec);
      var Jset = isNaN(w) ? NaN : solarTransitJ(approxTransit(w, lw, n), M, L);
      out[row[1]] = fromJulian(isNaN(Jset) ? NaN : Jnoon - (Jset - Jnoon));
      out[row[2]] = fromJulian(Jset);
    });
    return out;
  }

  function phaseFor(altitude) {
    if (altitude > 6) return { tone: 'day', label: 'Daylight' };
    if (altitude > -4) return { tone: 'gold', label: 'Golden hour', active: true };
    if (altitude > -6) return { tone: 'blue', label: 'Blue hour', active: true };
    return { tone: 'night', label: 'Dark' };
  }

  /* ---------------- time zones (Intl only, no library) ---------------- */

  var DEVICE_TZ = (function () {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; }
  })();

  var partsCache = {};
  function partsFormatter(tz) {
    if (!partsCache[tz]) {
      partsCache[tz] = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric'
      });
    }
    return partsCache[tz];
  }
  function zonedParts(date, tz) {
    var p = {};
    partsFormatter(tz).formatToParts(date).forEach(function (part) { p[part.type] = Number(part.value); });
    return { y: p.year, m: p.month, d: p.day, h: p.hour % 24, mi: p.minute, s: p.second };
  }
  function offsetMs(date, tz) {
    var p = zonedParts(date, tz);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(date.getTime() / 1000) * 1000;
  }
  // Wall-clock time in a zone → instant. Two passes settle DST boundaries.
  function zonedInstant(day, hour, tz) {
    var guess = Date.UTC(day.y, day.m - 1, day.d, hour, 0, 0);
    var t = guess - offsetMs(new Date(guess), tz);
    return new Date(guess - offsetMs(new Date(t), tz));
  }

  function civilIn(date, tz) { var p = zonedParts(date, tz); return { y: p.y, m: p.m, d: p.d }; }
  function addDays(day, n) {
    var t = new Date(Date.UTC(day.y, day.m - 1, day.d + n));
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  }
  function sameDay(a, b) { return a.y === b.y && a.m === b.m && a.d === b.d; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function dayToValue(day) { return day.y + '-' + pad(day.m) + '-' + pad(day.d); }
  function valueToDay(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    if (!m) return null;
    var day = { y: +m[1], m: +m[2], d: +m[3] };
    var check = addDays(day, 0);
    return sameDay(day, check) ? day : null;
  }

  var api = {
    VENUE_GROUPS: VENUE_GROUPS, VENUES: VENUES, DEFAULT_VENUE: DEFAULT_VENUE, HOUR_MS: HOUR_MS,
    sunAltitude: sunAltitude, sunTimes: sunTimes, phaseFor: phaseFor, DEVICE_TZ: DEVICE_TZ,
    zonedParts: zonedParts, offsetMs: offsetMs, zonedInstant: zonedInstant, civilIn: civilIn,
    addDays: addDays, sameDay: sameDay, dayToValue: dayToValue, valueToDay: valueToDay
  };
  root.GoldenHourCore = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
