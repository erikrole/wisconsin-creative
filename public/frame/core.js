/* Photo Frame core — reads EXIF from a photo and formats the settings shown on the frame.
   Client-only: the photo never leaves the browser, so there is no network code here.

   Reads JPEG (APP1), PNG (eXIf) and WebP (EXIF), and finds the Exif block inside
   HEIC/AVIF by scanning for its header. A file with no EXIF, or EXIF this parser
   cannot follow, gives an empty result and the fields are typed by hand. */
(function (root) {
  'use strict';

  var TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

  function ascii(view, start, length) {
    var out = '';
    for (var i = 0; i < length; i++) {
      var c = view.getUint8(start + i);
      if (c === 0) break;
      out += String.fromCharCode(c);
    }
    return out.trim();
  }

  function readValue(view, tiff, little, entry) {
    var type = entry.type;
    var count = entry.count;
    var size = (TYPE_SIZE[type] || 1) * count;
    var at = size <= 4 ? entry.at + 8 : tiff + view.getUint32(entry.at + 8, little);
    if (at < 0 || at + size > view.byteLength) return null;
    var out = [];
    var i;
    if (type === 2) return ascii(view, at, count);
    for (i = 0; i < count; i++) {
      if (type === 3) out.push(view.getUint16(at + i * 2, little));
      else if (type === 4) out.push(view.getUint32(at + i * 4, little));
      else if (type === 1 || type === 7) out.push(view.getUint8(at + i));
      else if (type === 6) out.push(view.getInt8(at + i));
      else if (type === 8) out.push(view.getInt16(at + i * 2, little));
      else if (type === 9) out.push(view.getInt32(at + i * 4, little));
      // Some editors write exposure values as floats or doubles instead of rationals.
      else if (type === 11) out.push(view.getFloat32(at + i * 4, little));
      else if (type === 12) out.push(view.getFloat64(at + i * 8, little));
      else if (type === 5 || type === 10) {
        var num = type === 5 ? view.getUint32(at + i * 8, little) : view.getInt32(at + i * 8, little);
        var den = type === 5 ? view.getUint32(at + i * 8 + 4, little) : view.getInt32(at + i * 8 + 4, little);
        out.push(den ? num / den : 0);
      }
    }
    return count === 1 ? out[0] : out;
  }

  function readIfd(view, tiff, little, offset, into) {
    var start = tiff + offset;
    if (offset < 8 || start + 2 > view.byteLength) return;
    var n = view.getUint16(start, little);
    for (var i = 0; i < n && i < 256; i++) {
      var at = start + 2 + i * 12;
      if (at + 12 > view.byteLength) break;
      var entry = { at: at, type: view.getUint16(at + 2, little), count: view.getUint32(at + 4, little) };
      var tag = view.getUint16(at, little);
      if (!entry.count || entry.count > 4096) continue;
      var value = readValue(view, tiff, little, entry);
      if (value !== null && value !== undefined) into[tag] = value;
    }
  }

  /** Reads the tags this tool shows from a TIFF block that starts at `tiff`. */
  function parseTiff(view, tiff) {
    var tags = {};
    if (tiff + 8 > view.byteLength) return tags;
    var order = view.getUint16(tiff, false);
    if (order !== 0x4949 && order !== 0x4d4d) return tags;
    var little = order === 0x4949;
    if (view.getUint16(tiff + 2, little) !== 42) return tags;
    var ifd0 = {};
    readIfd(view, tiff, little, view.getUint32(tiff + 4, little), ifd0);
    var exif = {};
    if (typeof ifd0[0x8769] === 'number') readIfd(view, tiff, little, ifd0[0x8769], exif);
    for (var k in exif) tags[k] = exif[k];
    for (var j in ifd0) if (!(j in tags)) tags[j] = ifd0[j];
    return tags;
  }

  function findTiff(view) {
    var len = view.byteLength;
    var i;
    if (len > 4 && view.getUint16(0, false) === 0xffd8) {
      i = 2;
      while (i + 4 < len) {
        if (view.getUint8(i) !== 0xff) return -1;
        var marker = view.getUint8(i + 1);
        if (marker === 0xda || marker === 0xd9) return -1;
        var size = view.getUint16(i + 2, false);
        if (marker === 0xe1 && ascii(view, i + 4, 4) === 'Exif') return i + 10;
        i += 2 + size;
      }
      return -1;
    }
    if (len > 12 && view.getUint32(0, false) === 0x89504e47) {
      i = 8;
      while (i + 12 <= len) {
        var chunk = view.getUint32(i, false);
        var name = ascii(view, i + 4, 4);
        if (name === 'eXIf') return i + 8;
        if (name === 'IDAT') return -1;
        i += 12 + chunk;
      }
      return -1;
    }
    if (len > 12 && ascii(view, 0, 4) === 'RIFF' && ascii(view, 8, 4) === 'WEBP') {
      i = 12;
      while (i + 8 <= len) {
        var csize = view.getUint32(i + 4, true);
        if (ascii(view, i, 4) === 'EXIF') {
          var body = i + 8;
          return ascii(view, body, 4) === 'Exif' ? body + 6 : body;
        }
        i += 8 + csize + (csize % 2);
      }
    }
    return scanForExif(view);
  }

  /** HEIC, AVIF and anything else: look for "Exif\0\0" followed by a TIFF header near the start. */
  function scanForExif(view) {
    var end = Math.min(view.byteLength - 10, 512 * 1024);
    for (var i = 0; i < end; i++) {
      if (view.getUint32(i, false) !== 0x45786966 || view.getUint16(i + 4, false) !== 0) continue;
      var order = view.getUint16(i + 6, false);
      if (order === 0x4949 || order === 0x4d4d) return i + 6;
    }
    return -1;
  }

  /** Raw tag map from an ArrayBuffer, or {} when the file has no readable EXIF. */
  function readTags(buffer) {
    try {
      var view = new DataView(buffer);
      var tiff = findTiff(view);
      return tiff < 0 ? {} : parseTiff(view, tiff);
    } catch (e) {
      return {};
    }
  }

  function text(v) {
    return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  }

  function num(v) {
    var n = Array.isArray(v) ? v[0] : v;
    return typeof n === 'number' && isFinite(n) && n > 0 ? n : 0;
  }

  /* Sony model codes the team shoots, to the names people use. */
  var SONY_MODELS = {
    'ILCE-1': 'A1', 'ILCE-1M2': 'A1 II', 'ILCE-9M3': 'A9 III', 'ILCE-9M2': 'A9 II', 'ILCE-9': 'A9',
    'ILCE-7M5': 'A7 V', 'ILCE-7M4': 'A7 IV', 'ILCE-7M3': 'A7 III', 'ILCE-7RM5': 'A7R V', 'ILCE-7RM4': 'A7R IV',
    'ILCE-7RM4A': 'A7R IVA', 'ILCE-7RM3': 'A7R III', 'ILCE-7SM3': 'A7S III', 'ILCE-7CM2': 'A7C II', 'ILCE-7CR': 'A7CR',
    'ILCE-6700': 'A6700', 'ILCE-6600': 'A6600', 'ILCE-6400': 'A6400',
    'ILME-FX3': 'FX3', 'ILME-FX3A': 'FX3', 'ILME-FX2': 'FX2', 'ILME-FX6': 'FX6', 'ILME-FX30': 'FX30'
  };

  function titleCase(s) {
    return s.toLowerCase().replace(/(^|\s)([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); });
  }

  function cameraName(make, model) {
    make = text(make);
    model = text(model);
    if (!model) return make;
    var brand = make.split(' ')[0];
    if (/^sony/i.test(make) || /^(ILCE|ILME)-/i.test(model)) {
      var friendly = SONY_MODELS[model.toUpperCase()];
      return 'Sony ' + (friendly || model.replace(/^(ILCE|ILME)-/i, ''));
    }
    // Phones are known by the model alone: "iPhone 16 Pro", not "Apple iPhone 16 Pro".
    if (/^(iPhone|iPad|Pixel)\b/.test(model)) return model;
    var shown = brand === brand.toUpperCase() && brand.length > 3 ? titleCase(brand) : brand;
    if (brand && model.toLowerCase().indexOf(brand.toLowerCase()) === 0) return shown + model.slice(brand.length);
    return (shown + ' ' + model).trim();
  }

  function formatAperture(f) {
    f = num(f);
    if (!f) return '';
    return 'f/' + (Math.round(f * 10) / 10).toString();
  }

  function formatShutter(seconds) {
    seconds = num(seconds);
    if (!seconds) return '';
    if (seconds < 0.3) return '1/' + Math.round(1 / seconds) + ' s';
    return (Math.round(seconds * 10) / 10).toString() + ' s';
  }

  function formatFocal(mm) {
    mm = num(mm);
    return mm ? Math.round(mm) + ' mm' : '';
  }

  function formatIso(iso) {
    iso = num(iso);
    return iso ? String(Math.round(iso)) : '';
  }

  /** "24-70mm F2.8" from LensSpecification (min/max focal, min/max aperture), for bodies that skip LensModel. */
  function formatLensSpec(spec) {
    if (!Array.isArray(spec) || spec.length < 4) return '';
    var lo = Math.round(num(spec[0]));
    var hi = Math.round(num(spec[1]));
    var f = num(spec[2]);
    if (!lo) return '';
    var range = hi && hi !== lo ? lo + '-' + hi + 'mm' : lo + 'mm';
    return f ? range + ' F' + Math.round(f * 10) / 10 : range;
  }

  /** "© 2026 Jane Doe. All rights reserved." to "Jane Doe", for a credit when Artist is empty. */
  function creditFromCopyright(raw) {
    var s = text(raw)
      .replace(/all rights reserved\.?/i, '')
      .replace(/^(©|\(c\)|copyright)\s*/i, '')
      .replace(/^(©|\(c\))\s*/i, '')
      .replace(/^\d{4}(\s*-\s*\d{4})?\s*/, '')
      .replace(/^(by|photo by)\s+/i, '')
      .replace(/[\s.,;]+$/, '');
    return s.length > 60 ? '' : s;
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function formatDate(raw) {
    var m = /^(\d{4}):(\d{2}):(\d{2})/.exec(text(raw));
    if (!m || +m[2] < 1 || +m[2] > 12) return '';
    return MONTHS[+m[2] - 1] + ' ' + +m[3] + ', ' + m[1];
  }

  /** The values the frame shows, as display strings, from a raw tag map. */
  function summarize(tags) {
    tags = tags || {};
    var lens = text(tags[0xa434]) || formatLensSpec(tags[0xa432]);
    // FNumber and ExposureTime first; the APEX values are the fallback some files carry instead.
    var fnum = num(tags[0x829d]) || (typeof tags[0x9202] === 'number' ? Math.pow(2, tags[0x9202] / 2) : 0);
    var time = num(tags[0x829a]) || (typeof tags[0x9201] === 'number' ? Math.pow(2, -tags[0x9201]) : 0);
    return {
      camera: cameraName(tags[0x010f], tags[0x0110]),
      lens: lens,
      focal: formatFocal(tags[0x920a]),
      aperture: formatAperture(fnum),
      shutter: formatShutter(time),
      iso: formatIso(tags[0x8827] || tags[0x8833]),
      date: formatDate(tags[0x9003] || tags[0x0132]),
      artist: text(tags[0x013b]) || creditFromCopyright(tags[0x8298])
    };
  }

  function readExif(buffer) {
    return summarize(readTags(buffer));
  }

  function parseHex(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function luminance(rgb) {
    var c = rgb.map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  /** Text and hairline colors that stay readable on any frame color. */
  function inkFor(hex) {
    var rgb = parseHex(hex) || [0, 0, 0];
    var dark = luminance(rgb) < 0.4;
    return dark
      ? { ink: '#f4f2ed', dim: 'rgba(244,242,237,0.58)', hair: 'rgba(255,255,255,0.14)' }
      : { ink: '#15151a', dim: 'rgba(21,21,26,0.6)', hair: 'rgba(0,0,0,0.14)' };
  }

  /** A safe download name: the photo's name without its extension, path or odd characters. */
  function exportName(fileName, ext) {
    var base = String(fileName || '').split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
    base = base.replace(/[\u0000-\u001f<>:"|?*]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
    return (base || 'photo') + '-framed.' + ext;
  }

  var api = {
    readTags: readTags,
    readExif: readExif,
    summarize: summarize,
    cameraName: cameraName,
    formatAperture: formatAperture,
    formatShutter: formatShutter,
    formatFocal: formatFocal,
    formatIso: formatIso,
    formatDate: formatDate,
    formatLensSpec: formatLensSpec,
    creditFromCopyright: creditFromCopyright,
    exportName: exportName,
    parseHex: parseHex,
    inkFor: inkFor
  };
  root.PhotoFrameCore = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
