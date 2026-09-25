/*
 * QR Studio core — shared by the browser app (index.html) and the CLI (cli/qr-studio.js).
 *
 * Everything here is pure: payload encoding, validation, colour rules, design
 * normalisation, QR option building and small binary helpers. Nothing touches the
 * DOM except through objects that are passed in, so the same rules gate both front ends.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QRStudioCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '2.0.0';

  // Byte-mode capacity of a version-40 symbol at each error-correction level.
  var CAPACITY = { L: 2953, M: 2331, Q: 1663, H: 1273 };
  var EC_LEVELS = ['L', 'M', 'Q', 'H'];
  var EC_RECOVERY = { L: 7, M: 15, Q: 25, H: 30 };

  // Past version 10 (57 modules) codes get busy enough to need real print size.
  var DENSE_MODULES = 57;
  // Conservative print module for phone cameras at arm's length.
  var PRINT_MODULE_MM = 0.5;
  // A circle backing is shrunk so it covers about as much of the code as the square one.
  var CIRCLE_IMAGE_FACTOR = 0.85;

  var STYLES = {
    square: { label: 'Classic', dots: 'square', corner: 'square', cornerDot: 'square' },
    dots: { label: 'Dots', dots: 'dots', corner: 'extra-rounded', cornerDot: 'dot' },
    soft: { label: 'Soft', dots: 'extra-rounded', corner: 'extra-rounded', cornerDot: 'dot' },
    cut: { label: 'Cut', dots: 'classy', corner: 'square', cornerDot: 'square' }
  };

  // Names used by QR Studio 1.x, kept so old library entries and settings still load.
  var STYLE_ALIASES = { rounded: 'dots', 'extra-rounded': 'soft', classy: 'cut', classic: 'square' };

  var PLATES = ['none', 'square', 'circle'];

  var DESIGN_DEFAULTS = {
    style: 'square',
    fill: '#171717',
    background: '#FFFFFF',
    eye: null,              // null = same as fill
    logo: 'none',           // 'none' | 'brand:<id>' | 'custom'
    logoData: '',           // data URL, only when logo === 'custom'
    logoScale: 24,
    plate: 'none',
    plateColor: '#FFFFFF',
    ec: 'auto',
    quietZone: 4
  };

  var LOGO_SCALE = { min: 12, max: 32 };
  var QUIET_ZONE = { min: 1, max: 8 };

  var PALETTE = {
    fill: [
      ['#171717', 'Ink'], ['#A00000', 'Badger red'], ['#282728', 'Charcoal'],
      ['#14213D', 'Navy'], ['#14532D', 'Forest'], ['#4C1D95', 'Plum']
    ],
    background: [
      ['#FFFFFF', 'White'], ['transparent', 'Transparent'], ['#F7F4ED', 'Cream'], ['#FFF8E1', 'Butter']
    ]
  };

  /* ------------------------------------------------------------------ */
  /* content types                                                       */
  /* ------------------------------------------------------------------ */

  var TYPES = {
    url: {
      label: 'Link',
      fields: [
        { key: 'url', label: 'Link', kind: 'url', placeholder: 'https://uwbadgers.com', required: true, maxLength: 2000 }
      ],
      utm: true
    },
    wifi: {
      label: 'Wi-Fi',
      fields: [
        { key: 'ssid', label: 'Network name', kind: 'text', placeholder: 'Camp Randall Guest', required: true, maxLength: 64 },
        { key: 'security', label: 'Security', kind: 'select', options: [['WPA', 'WPA / WPA2 / WPA3'], ['WEP', 'WEP'], ['nopass', 'None (open)']], initial: 'WPA' },
        { key: 'password', label: 'Password', kind: 'password', maxLength: 128 },
        { key: 'hidden', label: 'Hidden network', kind: 'checkbox' }
      ]
    },
    email: {
      label: 'Email',
      fields: [
        { key: 'to', label: 'To', kind: 'email', placeholder: 'name@athletics.wisc.edu', required: true, maxLength: 254 },
        { key: 'subject', label: 'Subject', kind: 'text', maxLength: 200 },
        { key: 'body', label: 'Message', kind: 'textarea', maxLength: 800 }
      ]
    },
    phone: {
      label: 'Phone',
      fields: [
        { key: 'phone', label: 'Phone number', kind: 'tel', placeholder: '+1 608 262 1440', required: true, maxLength: 32 }
      ]
    },
    sms: {
      label: 'Text message',
      fields: [
        { key: 'phone', label: 'Send to', kind: 'tel', placeholder: '+1 608 262 1440', required: true, maxLength: 32 },
        { key: 'message', label: 'Message', kind: 'textarea', maxLength: 600 }
      ]
    },
    contact: {
      label: 'Contact',
      fields: [
        { key: 'firstName', label: 'First name', kind: 'text', maxLength: 80, half: true },
        { key: 'lastName', label: 'Last name', kind: 'text', maxLength: 80, half: true },
        { key: 'org', label: 'Organisation', kind: 'text', placeholder: 'Wisconsin Athletics', maxLength: 120 },
        { key: 'title', label: 'Job title', kind: 'text', maxLength: 120 },
        { key: 'phone', label: 'Phone', kind: 'tel', maxLength: 32, half: true },
        { key: 'email', label: 'Email', kind: 'email', maxLength: 254, half: true },
        { key: 'website', label: 'Website', kind: 'url', maxLength: 300 }
      ]
    },
    text: {
      label: 'Text',
      fields: [
        { key: 'text', label: 'Text', kind: 'textarea', placeholder: 'Anything a phone should show when scanned', required: true, maxLength: 1200 }
      ]
    }
  };

  var UTM_FIELDS = [
    ['utmSource', 'utm_source', 'Source', 'flyer'],
    ['utmMedium', 'utm_medium', 'Medium', 'qr'],
    ['utmCampaign', 'utm_campaign', 'Campaign', 'homecoming-2026'],
    ['utmContent', 'utm_content', 'Content', 'north-gate']
  ];

  // Registry lookups must ignore inherited keys such as "__proto__" and "constructor",
  // which arrive through imported libraries, CSV headers and CLI flags.
  function has(obj, key) {
    return Boolean(obj) && Object.prototype.hasOwnProperty.call(obj, key);
  }

  function str(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function isBlank(value) {
    return str(value).trim() === '';
  }

  function utf8Length(text) {
    return new TextEncoder().encode(text).length;
  }

  // The vendored QR library maps each UTF-16 code unit to a single byte, which
  // corrupts anything outside Latin-1. Hand it UTF-8 bytes as a binary string instead.
  function toByteString(text) {
    var bytes = new TextEncoder().encode(text);
    var out = '';
    for (var i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
    return out;
  }

  function parseWebUrl(raw, label) {
    label = label || 'link';
    var value = str(raw).trim();
    if (!value) return { ok: false, message: 'Enter a ' + label + '.' };
    if (/\s/.test(value)) return { ok: false, message: 'Links cannot contain spaces. Remove them, or encode each space as %20.' };
    if (/[\u0000-\u001f\u007f]/.test(value)) return { ok: false, message: 'That link contains control characters.' };

    // A domain running straight into a second scheme is two pastes, not one link.
    var beforeQuery = value.split(/[?#]/)[0];
    if (/\.[a-z]{2,}(:\d+)?https?:?\/\//i.test(beforeQuery)) {
      return { ok: false, message: 'This looks like two links pasted together. Keep just one.' };
    }

    var hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value);
    var looksLikeHostPort = /^[^/:]+:\d+(\/|$)/.test(value);
    var parsed;
    try {
      parsed = new URL(hasScheme && !looksLikeHostPort ? value : 'https://' + value);
    } catch (error) {
      return { ok: false, message: 'Enter a complete link, for example https://example.com/page.' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, message: 'Only http:// and https:// links can be encoded here. Use the Text type for anything else.' };
    }
    var host = parsed.hostname;
    if (!host) return { ok: false, message: 'That link is missing a domain name.' };
    var isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.charAt(0) === '[';
    // The URL parser turns "42" or "0x7f.1" into an IPv4 address; only accept IPs typed out in full.
    if (isIp && value.toLowerCase().indexOf(host) === -1) {
      return { ok: false, message: 'That is not a full domain name. Use something like example.com.' };
    }
    if (host !== 'localhost' && !isIp && host.indexOf('.') === -1) {
      return { ok: false, message: 'That is not a full domain name. Use something like example.com.' };
    }
    if (/\.$/.test(host) || /\.\./.test(host)) return { ok: false, message: 'That domain name is malformed.' };
    var tld = host.split('.').pop();
    if (!isIp && host !== 'localhost' && !/^([a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(tld)) {
      return { ok: false, message: 'The domain ending ".' + tld + '" is not valid.' };
    }

    var notes = [];
    if (!hasScheme || looksLikeHostPort) notes.push('Assumed https:// — add it to be explicit.');
    if (host === 'localhost' || isIp && /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) {
      notes.push('This address only works on a private network, not from a fan\u2019s phone.');
    }
    if (parsed.username || parsed.password) notes.push('The link contains a username or password, and anyone who scans it can read them.');
    if ((beforeQuery.match(/https?:\/\//gi) || []).length > 1) notes.push('The link contains a second http(s):// — check it is not two links run together.');
    if (parsed.protocol === 'http:') notes.push('Plain http:// links show a "Not secure" warning on most phones.');
    return { ok: true, url: parsed, notes: notes };
  }

  // Appends UTM parameters without re-serialising the existing query, so links
  // that rely on exact encoding survive untouched.
  function withUtm(parsed, content) {
    var pairs = [];
    for (var i = 0; i < UTM_FIELDS.length; i += 1) {
      var value = str(content[UTM_FIELDS[i][0]]).trim();
      if (value) {
        if (parsed.searchParams.has(UTM_FIELDS[i][1])) {
          return { ok: false, field: UTM_FIELDS[i][0], message: 'The link already has ' + UTM_FIELDS[i][1] + '. Remove it from the link or clear this field.' };
        }
        pairs.push(UTM_FIELDS[i][1] + '=' + encodeURIComponent(value));
      }
    }
    var href = parsed.href;
    if (!pairs.length) return { ok: true, value: href };
    var hashAt = href.indexOf('#');
    var hash = hashAt === -1 ? '' : href.slice(hashAt);
    var base = hashAt === -1 ? href : href.slice(0, hashAt);
    var joiner = base.indexOf('?') === -1 ? '?' : (/[?&]$/.test(base) ? '' : '&');
    return { ok: true, value: base + joiner + pairs.join('&') + hash };
  }

  function wifiEscape(text) {
    return str(text).replace(/([\\;,":])/g, '\\$1');
  }

  function vcardEscape(text) {
    return str(text).trim().replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
  }

  var EMAIL_RE = /^[^\s@"<>(),;:]+@[^\s@"<>(),;:]+\.[^\s@"<>(),;:]{2,}$/;

  function cleanPhone(raw) {
    var value = str(raw).trim();
    var cleaned = value.replace(/[\s().\-\u00a0]/g, '');
    if (!/^\+?\d{3,20}$/.test(cleaned)) return null;
    return cleaned;
  }

  function fail(field, message) {
    var errors = {};
    errors[field] = message;
    return { ok: false, errors: errors, field: field, message: message, notes: [] };
  }

  var BUILDERS = {
    url: function (c) {
      var parsed = parseWebUrl(c.url, 'link');
      if (!parsed.ok) return fail('url', parsed.message);
      var tagged = withUtm(parsed.url, c);
      if (!tagged.ok) return fail(tagged.field, tagged.message);
      return { ok: true, value: tagged.value, notes: parsed.notes };
    },

    wifi: function (c) {
      var ssid = str(c.ssid);
      if (isBlank(ssid)) return fail('ssid', 'Enter the network name.');
      if (utf8Length(ssid) > 32) return fail('ssid', 'Wi-Fi network names are at most 32 bytes.');
      var security = ['WPA', 'WEP', 'nopass'].indexOf(c.security) === -1 ? 'WPA' : c.security;
      var password = str(c.password);
      var notes = [];
      if (security !== 'nopass') {
        if (!password) return fail('password', 'Enter the password, or set security to None.');
        if (security === 'WPA' && (password.length < 8 || password.length > 63)) {
          return fail('password', 'WPA passwords are 8 to 63 characters.');
        }
        if (security === 'WEP' && [5, 10, 13, 26].indexOf(password.length) === -1) {
          notes.push('WEP keys are normally 5, 10, 13 or 26 characters.');
        }
        notes.push('Anyone who photographs this code can read the password.');
      }
      var value = 'WIFI:T:' + security + ';S:' + wifiEscape(ssid) + ';';
      if (security !== 'nopass') value += 'P:' + wifiEscape(password) + ';';
      if (c.hidden === true || /^(true|1|yes)$/i.test(str(c.hidden).trim())) value += 'H:true;';
      return { ok: true, value: value + ';', notes: notes };
    },

    email: function (c) {
      var to = str(c.to).trim();
      if (!to) return fail('to', 'Enter an email address.');
      if (!EMAIL_RE.test(to)) return fail('to', 'That does not look like an email address.');
      var query = [];
      if (!isBlank(c.subject)) query.push('subject=' + encodeURIComponent(str(c.subject).trim()));
      if (!isBlank(c.body)) query.push('body=' + encodeURIComponent(str(c.body).replace(/\r?\n/g, '\r\n')));
      return { ok: true, value: 'mailto:' + to + (query.length ? '?' + query.join('&') : ''), notes: [] };
    },

    phone: function (c) {
      if (isBlank(c.phone)) return fail('phone', 'Enter a phone number.');
      var phone = cleanPhone(c.phone);
      if (!phone) return fail('phone', 'Use digits only, with an optional leading +.');
      var notes = phone.charAt(0) === '+' ? [] : ['Add the country code (for example +1) so it dials from anywhere.'];
      return { ok: true, value: 'tel:' + phone, notes: notes };
    },

    sms: function (c) {
      if (isBlank(c.phone)) return fail('phone', 'Enter a phone number.');
      var phone = cleanPhone(c.phone);
      if (!phone) return fail('phone', 'Use digits only, with an optional leading +.');
      var message = str(c.message).replace(/\r\n/g, '\n');
      return { ok: true, value: 'SMSTO:' + phone + ':' + message, notes: [] };
    },

    contact: function (c) {
      var first = str(c.firstName).trim();
      var last = str(c.lastName).trim();
      var org = str(c.org).trim();
      if (!first && !last && !org) return fail('firstName', 'Enter a name or an organisation.');
      var lines = ['BEGIN:VCARD', 'VERSION:3.0'];
      var full = (first + ' ' + last).trim() || org;
      lines.push('N:' + vcardEscape(last) + ';' + vcardEscape(first) + ';;;');
      lines.push('FN:' + vcardEscape(full));
      if (org) lines.push('ORG:' + vcardEscape(org));
      if (!isBlank(c.title)) lines.push('TITLE:' + vcardEscape(c.title));
      if (!isBlank(c.phone)) {
        var phone = cleanPhone(c.phone);
        if (!phone) return fail('phone', 'Use digits only, with an optional leading +.');
        lines.push('TEL;TYPE=CELL:' + phone);
      }
      if (!isBlank(c.email)) {
        if (!EMAIL_RE.test(str(c.email).trim())) return fail('email', 'That does not look like an email address.');
        lines.push('EMAIL:' + str(c.email).trim());
      }
      if (!isBlank(c.website)) {
        var site = parseWebUrl(c.website, 'website');
        if (!site.ok) return fail('website', site.message);
        lines.push('URL:' + vcardEscape(site.url.href));
      }
      lines.push('END:VCARD');
      return { ok: true, value: lines.join('\r\n'), notes: [] };
    },

    text: function (c) {
      var text = str(c.text);
      if (isBlank(text)) return fail('text', 'Enter some text.');
      var notes = [];
      if (/^\s*https?:\/\//i.test(text)) notes.push('This looks like a link. The Link type validates it and can add UTM tags.');
      return { ok: true, value: text.replace(/\r\n/g, '\n'), notes: notes };
    }
  };

  function buildPayload(type, content) {
    var builder = has(BUILDERS, type) ? BUILDERS[type] : null;
    if (!builder) return fail('type', 'Unknown content type "' + type + '".');
    var result = builder(content || {});
    if (result.ok) {
      result.errors = {};
      result.bytes = utf8Length(result.value);
    }
    return result;
  }

  function emptyContent(type) {
    var content = {};
    var spec = has(TYPES, type) ? TYPES[type] : null;
    if (!spec) return content;
    spec.fields.forEach(function (field) {
      content[field.key] = field.kind === 'checkbox' ? false : (field.initial || '');
    });
    if (spec.utm) UTM_FIELDS.forEach(function (utm) { content[utm[0]] = ''; });
    return content;
  }

  function normalizeContent(type, input) {
    var content = emptyContent(type);
    if (!input || typeof input !== 'object') return content;
    Object.keys(content).forEach(function (key) {
      if (!has(input, key)) return;
      if (typeof content[key] === 'boolean') content[key] = input[key] === true || input[key] === 'true';
      else content[key] = str(input[key]).slice(0, 4000);
    });
    return content;
  }

  /* ------------------------------------------------------------------ */
  /* design                                                              */
  /* ------------------------------------------------------------------ */

  function normalizeHex(value) {
    var text = str(value).trim();
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
    if (!m) return null;
    var hex = m[1];
    if (hex.length === 3) hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
    return '#' + hex.toUpperCase();
  }

  function clampInt(value, min, max, fallback) {
    var n = Math.round(Number(value));
    if (!isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  var LOGO_DATA_RE = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[a-z0-9+/=]+$/i;

  function normalizeDesign(input) {
    var d = {};
    var warnings = [];
    input = input && typeof input === 'object' ? input : {};

    var style = str(input.style).toLowerCase();
    if (has(STYLE_ALIASES, style)) style = STYLE_ALIASES[style];
    d.style = has(STYLES, style) ? style : DESIGN_DEFAULTS.style;
    if (input.style !== undefined && d.style !== style) warnings.push('Unknown style "' + input.style + '"; using Classic.');

    d.fill = normalizeHex(input.fill) || DESIGN_DEFAULTS.fill;
    if (input.fill !== undefined && !normalizeHex(input.fill)) warnings.push('Fill "' + input.fill + '" is not a hex colour; using ' + d.fill + '.');

    if (str(input.background).toLowerCase() === 'transparent' || str(input.background).toLowerCase() === 'none') d.background = 'transparent';
    else {
      d.background = normalizeHex(input.background) || DESIGN_DEFAULTS.background;
      if (input.background !== undefined && !normalizeHex(input.background)) warnings.push('Background "' + input.background + '" is not a hex colour; using white.');
    }

    d.eye = input.eye === null || input.eye === undefined || input.eye === '' || input.eye === false ? null : normalizeHex(input.eye);

    var logo = str(input.logo || 'none');
    d.logoData = '';
    if (logo === 'custom') {
      var data = str(input.logoData);
      if (LOGO_DATA_RE.test(data)) { d.logo = 'custom'; d.logoData = data; }
      else { d.logo = 'none'; warnings.push('The custom logo was missing or unreadable, so it was dropped.'); }
    } else if (/^brand:[a-z0-9-]+$/.test(logo)) {
      d.logo = logo;
    } else {
      d.logo = 'none';
    }

    d.logoScale = clampInt(input.logoScale, LOGO_SCALE.min, LOGO_SCALE.max, DESIGN_DEFAULTS.logoScale);
    d.plate = PLATES.indexOf(input.plate) === -1 ? 'none' : input.plate;
    d.plateColor = normalizeHex(input.plateColor) || DESIGN_DEFAULTS.plateColor;
    var ec = str(input.ec).toUpperCase();
    d.ec = EC_LEVELS.indexOf(ec) === -1 ? 'auto' : ec;
    d.quietZone = clampInt(input.quietZone, QUIET_ZONE.min, QUIET_ZONE.max, DESIGN_DEFAULTS.quietZone);
    return { design: d, warnings: warnings };
  }

  function resolveEc(design) {
    if (design.ec !== 'auto') return design.ec;
    return design.logo !== 'none' ? 'H' : 'M';
  }

  /* ------------------------------------------------------------------ */
  /* colour                                                              */
  /* ------------------------------------------------------------------ */

  function channel(value) {
    var c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function luminance(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return 1;
    var n = parseInt(m[1], 16);
    return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  }

  function contrastRatio(a, b) {
    var la = luminance(a);
    var lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  // Scanners look for dark modules on a light field. The fill and the corner eyes
  // are both judged, because a pale eye breaks detection even when the dots are fine.
  function colourVerdict(design) {
    var bg = design.background === 'transparent' ? '#FFFFFF' : design.background;
    var parts = [['fill', design.fill]];
    if (design.eye && design.eye !== design.fill) parts.push(['eye', design.eye]);

    var worst = null;
    parts.forEach(function (part) {
      var ratio = contrastRatio(part[1], bg);
      var inverted = luminance(part[1]) > luminance(bg);
      var level = inverted || ratio < 3 ? 'bad' : ratio < 4.5 ? 'warn' : 'ok';
      var rank = { ok: 0, warn: 1, bad: 2 }[level];
      if (!worst || rank > worst.rank || (rank === worst.rank && ratio < worst.ratio)) {
        worst = { part: part[0], ratio: ratio, inverted: inverted, level: level, rank: rank };
      }
    });

    var what = worst.part === 'eye' ? 'corner eyes' : 'code';
    var message;
    if (worst.inverted) message = 'The ' + what + ' is lighter than the background. Many scanners reject inverted codes \u2014 use a dark colour on a light background.';
    else if (worst.level === 'bad') message = 'Contrast between the ' + what + ' and the background is too low to scan reliably.';
    else if (worst.level === 'warn') message = 'Contrast is marginal. It may fail on worn print or in poor light.';
    else message = design.background === 'transparent'
      ? 'Transparent background \u2014 place it only on a light, plain surface.'
      : 'Dark on light \u2014 the most reliable combination.';

    return { level: worst.level, ratio: worst.ratio, part: worst.part, message: message };
  }

  /* ------------------------------------------------------------------ */
  /* QR construction                                                     */
  /* ------------------------------------------------------------------ */

  function quietMarginPx(size, moduleCount, quietZone) {
    if (!moduleCount) return Math.round(size * 0.06);
    return Math.round(quietZone * size / (moduleCount + quietZone * 2));
  }

  // Builds options for qr-code-styling. `payload` is the real (Unicode) string;
  // it is converted to UTF-8 bytes here so every caller encodes the same way.
  function qrOptions(payload, design, opts) {
    opts = opts || {};
    var size = opts.size || 1200;
    var style = has(STYLES, design.style) ? STYLES[design.style] : STYLES.square;
    var eye = design.eye || design.fill;
    var hasLogo = Boolean(opts.logoUrl);
    var imageSize = design.logoScale / 100 * (design.plate === 'circle' ? CIRCLE_IMAGE_FACTOR : 1);
    var options = {
      width: size,
      height: size,
      type: 'svg',
      margin: quietMarginPx(size, opts.moduleCount, design.quietZone),
      data: toByteString(payload),
      image: hasLogo ? opts.logoUrl : undefined,
      qrOptions: { errorCorrectionLevel: resolveEc(design), mode: 'Byte', typeNumber: 0 },
      dotsOptions: { color: design.fill, type: style.dots, roundSize: true },
      cornersSquareOptions: { color: eye, type: style.corner },
      cornersDotOptions: { color: eye, type: style.cornerDot },
      backgroundOptions: { color: design.background === 'transparent' ? 'transparent' : design.background },
      imageOptions: {
        // saveAsBlob re-fetches the logo over XHR with no error handler, which hangs
        // the render forever. Logos are always data URLs, so skip that round trip.
        saveAsBlob: false,
        crossOrigin: 'anonymous',
        margin: Math.max(1, Math.round(size * 0.01)),
        imageSize: imageSize,
        hideBackgroundDots: true
      }
    };
    if (opts.jsdom) options.jsdom = opts.jsdom;
    if (opts.nodeCanvas) options.nodeCanvas = opts.nodeCanvas;
    return options;
  }

  // Draws the logo backing as a vector shape behind the <image>, so SVG and PNG
  // exports both carry it. Works with any DOM (browser or jsdom).
  // Also rewrites qr-code-styling's quoted clip-path references (url('#id')), which
  // resvg and some print RIPs ignore, leaving a solid square instead of a code.
  function plateExtension(design) {
    return function (svg) {
      var clipped = svg.querySelectorAll('[clip-path]');
      for (var c = 0; c < clipped.length; c += 1) {
        var ref = clipped[c].getAttribute('clip-path');
        var fixed = ref.replace(/url\(\s*['"](#[^'"]+)['"]\s*\)/, 'url($1)');
        if (fixed !== ref) clipped[c].setAttribute('clip-path', fixed);
      }
      // Square modules are separate rects; without this, scaled copies show hairline seams.
      if (design.style === 'square') svg.setAttribute('shape-rendering', 'crispEdges');
      if (design.plate === 'none' || design.logo === 'none') return;
      var image = svg.querySelector('image');
      if (!image) return;
      var x = parseFloat(image.getAttribute('x'));
      var y = parseFloat(image.getAttribute('y'));
      var w = parseFloat(image.getAttribute('width'));
      var h = parseFloat(image.getAttribute('height'));
      if (!isFinite(x) || !isFinite(y) || !isFinite(w) || !isFinite(h)) return;

      var ns = 'http://www.w3.org/2000/svg';
      var doc = svg.ownerDocument;
      var span = Math.max(w, h);
      var pad = span * 0.10;
      var plate;
      if (design.plate === 'circle') {
        plate = doc.createElementNS(ns, 'circle');
        plate.setAttribute('cx', String(x + w / 2));
        plate.setAttribute('cy', String(y + h / 2));
        plate.setAttribute('r', String(span * 0.72));
      } else {
        plate = doc.createElementNS(ns, 'rect');
        plate.setAttribute('x', String(x - pad));
        plate.setAttribute('y', String(y - pad));
        plate.setAttribute('width', String(w + pad * 2));
        plate.setAttribute('height', String(h + pad * 2));
        plate.setAttribute('rx', String(pad * 0.9));
      }
      plate.setAttribute('fill', design.plateColor);
      image.parentNode.insertBefore(plate, image);
    };
  }

  // Checks that must pass before anything is exported. `moduleCount` is optional.
  function assess(payloadResult, design, moduleCount) {
    var ec = resolveEc(design);
    var out = { ok: true, blockers: [], warnings: [], ec: ec, moduleCount: moduleCount || 0 };
    if (!payloadResult.ok) {
      out.ok = false;
      out.blockers.push(payloadResult.message);
      return out;
    }
    if (payloadResult.bytes > CAPACITY[ec]) {
      out.ok = false;
      var lower = EC_LEVELS.filter(function (level) { return CAPACITY[level] >= payloadResult.bytes; });
      out.blockers.push('Too much content: ' + payloadResult.bytes + ' bytes, and error correction ' + ec +
        ' holds ' + CAPACITY[ec] + '.' + (lower.length ? ' Shorten it or lower error correction to ' + lower[lower.length - 1] + '.' : ' Shorten it.'));
    }
    var colour = colourVerdict(design);
    if (colour.level === 'bad') { out.ok = false; out.blockers.push(colour.message); }
    else if (colour.level === 'warn') out.warnings.push(colour.message);

    if (design.logo !== 'none' && EC_RECOVERY[ec] < 25) {
      out.warnings.push('A centre logo needs error correction Q or H; ' + ec + ' leaves little room for it.');
    }
    if (moduleCount && moduleCount > DENSE_MODULES) {
      out.warnings.push('This code is dense (' + moduleCount + '\u00d7' + moduleCount + '). A shorter link prints smaller and scans faster.');
    }
    (payloadResult.notes || []).forEach(function (note) { out.warnings.push(note); });
    out.colour = colour;
    return out;
  }

  function versionFor(moduleCount) {
    return moduleCount ? (moduleCount - 17) / 4 : 0;
  }

  function printGuide(moduleCount, quietZone) {
    if (!moduleCount) return null;
    var span = moduleCount + quietZone * 2;
    var minMm = span * PRINT_MODULE_MM;
    return {
      modules: moduleCount,
      version: versionFor(moduleCount),
      minMm: Math.ceil(minMm),
      minIn: Math.ceil(minMm / 25.4 * 10) / 10,
      // Rule of thumb: scanning distance is about ten times the code's width.
      distanceM: function (widthMm) { return widthMm * 10 / 1000; }
    };
  }

  /* ------------------------------------------------------------------ */
  /* logos                                                               */
  /* ------------------------------------------------------------------ */

  function base64Ascii(text) {
    if (typeof btoa === 'function') return btoa(text);
    return Buffer.from(text, 'binary').toString('base64');
  }

  function svgToDataUrl(svgText) {
    return 'data:image/svg+xml;base64,' + base64Ascii(toByteString(svgText));
  }

  // `brands` is the registry from assets/brand-logos.js (or the CLI's loader).
  function brandSvg(id, design, brands) {
    var brand = has(brands, id) ? brands[id] : null;
    if (!brand) return null;
    var svg = brand.svg;
    if (brand.recolor) {
      var colour = design.fill;
      svg = svg.replace(new RegExp(brand.recolor, 'gi'), colour);
    }
    return svg;
  }

  function logoUrlFor(design, brands) {
    if (design.logo === 'custom') return design.logoData || '';
    if (design.logo.indexOf('brand:') === 0) {
      var svg = brandSvg(design.logo.slice(6), design, brands);
      return svg ? svgToDataUrl(svg) : '';
    }
    return '';
  }

  var SVG_BLOCKED = ['script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'animate',
    'animatetransform', 'animatemotion', 'set', 'handler', 'listener'];

  // Strips anything active or external from an uploaded SVG and makes sure it has
  // intrinsic dimensions (browsers otherwise report 0 and the logo vanishes).
  function sanitizeSvg(text, DOMParserCtor, XMLSerializerCtor) {
    var doc = new DOMParserCtor().parseFromString(str(text), 'image/svg+xml');
    var svg = doc.documentElement;
    if (!svg || svg.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) {
      throw new Error('svg-parse');
    }
    var removed = 0;
    var all = svg.getElementsByTagName('*');
    for (var i = all.length - 1; i >= 0; i -= 1) {
      var node = all[i];
      var name = String(node.localName || node.nodeName).toLowerCase();
      if (SVG_BLOCKED.indexOf(name) !== -1 || (name === 'style' && /@import|url\(\s*['"]?(?!#)/i.test(node.textContent))) {
        node.parentNode.removeChild(node);
        removed += 1;
      }
    }
    var nodes = [svg].concat(Array.prototype.slice.call(svg.getElementsByTagName('*')));
    nodes.forEach(function (node) {
      Array.prototype.slice.call(node.attributes).forEach(function (attr) {
        var n = attr.name.toLowerCase();
        var v = String(attr.value).trim();
        var external = (n === 'href' || n === 'xlink:href' || n === 'src') && !/^#/.test(v) && !/^data:image\/(png|jpeg|gif|webp);/i.test(v);
        var styleUrl = n === 'style' && /url\(\s*['"]?(?!#)/i.test(v);
        if (/^on/.test(n) || external || styleUrl || /javascript:/i.test(v)) {
          node.removeAttribute(attr.name);
          removed += 1;
        }
      });
    });

    var w = parseFloat(svg.getAttribute('width'));
    var h = parseFloat(svg.getAttribute('height'));
    var percent = /%/.test(svg.getAttribute('width') || '') || /%/.test(svg.getAttribute('height') || '');
    if (!(w > 0 && h > 0) || percent) {
      var vb = str(svg.getAttribute('viewBox')).trim().split(/[\s,]+/).map(Number);
      if (vb.length !== 4 || !(vb[2] > 0 && vb[3] > 0)) throw new Error('dimensions');
      var scale = 1000 / Math.max(vb[2], vb[3]);
      svg.setAttribute('width', String(Math.round(vb[2] * scale)));
      svg.setAttribute('height', String(Math.round(vb[3] * scale)));
    }
    return { svg: new XMLSerializerCtor().serializeToString(svg), removed: removed };
  }

  /* ------------------------------------------------------------------ */
  /* files                                                               */
  /* ------------------------------------------------------------------ */

  function slugify(text, fallback) {
    var slug = str(text).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
    return slug || (fallback === undefined ? 'qr-code' : fallback);
  }

  function fileBase(name, type, content, payload) {
    if (!isBlank(name)) return 'qr-' + slugify(name);
    if (type === 'url' && payload) {
      try {
        var u = new URL(payload);
        return 'qr-' + slugify(u.hostname.replace(/^www\./, '') + '-' + u.pathname, 'link');
      } catch (error) { /* fall through */ }
    }
    var hint = {
      wifi: content && content.ssid, email: content && content.to, phone: content && content.phone,
      sms: content && content.phone, contact: content && ((content.firstName || '') + ' ' + (content.lastName || '') || content.org),
      text: content && str(content.text).slice(0, 30)
    }[type];
    return 'qr-' + (type || 'code') + (hint && slugify(hint, '') ? '-' + slugify(hint, '') : '');
  }

  var CRC_TABLE = null;

  function crc32(bytes, start, end) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Uint32Array(256);
      for (var n = 0; n < 256; n += 1) {
        var c = n;
        for (var k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        CRC_TABLE[n] = c >>> 0;
      }
    }
    var crc = 0xffffffff;
    for (var i = start; i < end; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  // Writes a pHYs chunk so print software opens the PNG at the intended DPI.
  function setPngDpi(bytes, dpi) {
    var sig = [137, 80, 78, 71, 13, 10, 26, 10];
    for (var s = 0; s < 8; s += 1) if (bytes[s] !== sig[s]) throw new Error('not-png');
    var ppm = Math.round(dpi / 0.0254);
    var chunks = [];
    var offset = 8;
    var insertAt = -1;
    while (offset < bytes.length) {
      var len = ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
      var type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
      var total = 12 + len;
      if (type !== 'pHYs') chunks.push(bytes.subarray(offset, offset + total));
      if (type === 'IHDR') insertAt = chunks.length;
      offset += total;
      if (type === 'IEND') break;
    }
    if (insertAt === -1) throw new Error('not-png');
    var phys = new Uint8Array(21);
    var view = new DataView(phys.buffer);
    view.setUint32(0, 9);
    phys.set([112, 72, 89, 115], 4);
    view.setUint32(8, ppm);
    view.setUint32(12, ppm);
    phys[16] = 1;
    view.setUint32(17, crc32(phys, 4, 17));
    chunks.splice(insertAt, 0, phys);
    var size = 8;
    chunks.forEach(function (chunk) { size += chunk.length; });
    var out = new Uint8Array(size);
    out.set(sig, 0);
    var at = 8;
    chunks.forEach(function (chunk) { out.set(chunk, at); at += chunk.length; });
    return out;
  }

  function parseCsv(text) {
    text = str(text).replace(/^\ufeff/, '');
    var rows = [];
    var row = [];
    var field = '';
    var quoted = false;
    for (var i = 0; i < text.length; i += 1) {
      var ch = text.charAt(i);
      if (quoted) {
        if (ch === '"') {
          if (text.charAt(i + 1) === '"') { field += '"'; i += 1; } else quoted = false;
        } else field += ch;
      } else if (ch === '"' && field === '') quoted = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text.charAt(i + 1) === '\n') i += 1;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else field += ch;
    }
    if (quoted) throw new Error('Unclosed quote in CSV.');
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    rows = rows.filter(function (r) { return r.some(function (cell) { return cell.trim() !== ''; }); });
    if (!rows.length) return [];
    var header = rows[0].map(function (h) { return h.trim(); });
    return rows.slice(1).map(function (r, index) {
      var obj = { __line: index + 2 };
      header.forEach(function (h, col) { if (h) obj[h] = r[col] === undefined ? '' : r[col]; });
      return obj;
    });
  }

  function shellQuote(value) {
    var text = str(value);
    if (/^[A-Za-z0-9_\/.:=@%+,-]+$/.test(text)) return text;
    return "'" + text.replace(/'/g, "'\\''") + "'";
  }

  var CONTENT_FLAGS = {
    ssid: 'ssid', security: 'security', password: 'password', hidden: 'hidden', to: 'to', subject: 'subject',
    body: 'body', phone: 'phone', message: 'message', firstName: 'first-name', lastName: 'last-name', org: 'org',
    title: 'title', email: 'email', website: 'website', utmSource: 'utm-source', utmMedium: 'utm-medium',
    utmCampaign: 'utm-campaign', utmContent: 'utm-content'
  };

  var PRIMARY_FIELD = { url: 'url', text: 'text' };

  // The CLI command that reproduces the current design. Custom logos are written as a
  // placeholder path because the browser cannot know where the file lives on disk.
  function cliCommand(type, content, design, opts) {
    opts = opts || {};
    var parts = ['qr-studio', 'make'];
    if (type !== 'url') parts.push('--type', type);
    if (PRIMARY_FIELD[type]) parts.push(shellQuote(content[PRIMARY_FIELD[type]] || ''));
    Object.keys(CONTENT_FLAGS).forEach(function (key) {
      if (!(key in content) || key === PRIMARY_FIELD[type]) return;
      var value = content[key];
      if (value === false || isBlank(value)) return;
      if (key === 'security' && value === 'WPA') return;
      if (value === true) parts.push('--' + CONTENT_FLAGS[key]);
      else parts.push('--' + CONTENT_FLAGS[key], shellQuote(value));
    });
    var d = DESIGN_DEFAULTS;
    if (design.style !== d.style) parts.push('--style', design.style);
    if (design.fill !== d.fill) parts.push('--fill', shellQuote(design.fill));
    if (design.background !== d.background) parts.push('--bg', shellQuote(design.background));
    if (design.eye) parts.push('--eye', shellQuote(design.eye));
    if (design.logo !== 'none') parts.push('--logo', design.logo === 'custom' ? shellQuote(opts.logoPath || 'path/to/logo.png') : design.logo.slice(6));
    if (design.logo !== 'none' && design.logoScale !== d.logoScale) parts.push('--logo-scale', String(design.logoScale));
    if (design.logo !== 'none' && design.plate !== 'none') {
      parts.push('--plate', design.plate);
      if (design.plateColor !== d.plateColor) parts.push('--plate-color', shellQuote(design.plateColor));
    }
    if (design.ec !== 'auto') parts.push('--ec', design.ec);
    if (design.quietZone !== d.quietZone) parts.push('--quiet-zone', String(design.quietZone));
    if (opts.size) parts.push('--size', String(opts.size));
    parts.push('-o', shellQuote(opts.output || 'qr-code.png'));
    return parts.join(' ');
  }

  return {
    VERSION: VERSION,
    has: has,
    CAPACITY: CAPACITY,
    EC_LEVELS: EC_LEVELS,
    EC_RECOVERY: EC_RECOVERY,
    STYLES: STYLES,
    STYLE_ALIASES: STYLE_ALIASES,
    PLATES: PLATES,
    DESIGN_DEFAULTS: DESIGN_DEFAULTS,
    LOGO_SCALE: LOGO_SCALE,
    QUIET_ZONE: QUIET_ZONE,
    PALETTE: PALETTE,
    TYPES: TYPES,
    UTM_FIELDS: UTM_FIELDS,
    CONTENT_FLAGS: CONTENT_FLAGS,
    utf8Length: utf8Length,
    toByteString: toByteString,
    buildPayload: buildPayload,
    emptyContent: emptyContent,
    normalizeContent: normalizeContent,
    normalizeHex: normalizeHex,
    normalizeDesign: normalizeDesign,
    resolveEc: resolveEc,
    luminance: luminance,
    contrastRatio: contrastRatio,
    colourVerdict: colourVerdict,
    qrOptions: qrOptions,
    plateExtension: plateExtension,
    assess: assess,
    printGuide: printGuide,
    svgToDataUrl: svgToDataUrl,
    brandSvg: brandSvg,
    logoUrlFor: logoUrlFor,
    sanitizeSvg: sanitizeSvg,
    slugify: slugify,
    fileBase: fileBase,
    setPngDpi: setPngDpi,
    parseCsv: parseCsv,
    shellQuote: shellQuote,
    cliCommand: cliCommand
  };
});
