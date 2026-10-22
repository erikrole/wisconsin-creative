/* Board Sizes page wiring. Data lives in boards.json (loaded as the generated
   data.js), cross-referenced from the
   Board Info sheet, the 2024 Camp Randall guide, Colosseum's deliverables
   sheet and the Board Builder. Client-only: no network requests.

   Views: ?v=<venue> (a venue's boards), ?d=<display id> (one board, large,
   with its layouts; &l=<layout id> picks one), ?c=<content type> (the boards
   one piece of content needs), ?q=<search> (across venues), ?p=agents (files
   and rules for agents and tools), ?p=issues (every open question). #<id>
   jumps to a display or zone by its stable id. &share=1 hides the way back to
   the rest of the site. Moving between views adds a history entry; typing a
   search doesn't. */
(function () {
  'use strict';

  var DATA = window.BOARD_DATA;
  var VENUE_KEY = 'boards.venue.v1';
  var el = {};
  ['search', 'nav-venues', 'nav-ref', 'menu-toggle', 'top-links',
   'crumbs', 'title', 'actions', 'subtitle', 'props', 'summary', 'view', 'empty', 'footnote', 'toast'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  function storageGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function storageSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  // A hand-typed or truncated link can carry a bad escape like %E0; read it
  // as typed instead of throwing and leaving the page blank.
  function safeDecode(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }

  var VENUES = DATA.venues;
  // Lookups keyed by URL and search text have no prototype, so ?d=constructor
  // and friends miss instead of throwing.
  function dict() { return Object.create(null); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  var venueById = dict();
  VENUES.forEach(function (v) { venueById[v.id] = v; });
  // Stable ids → where they live, and the production canvas keys built from them.
  var BY_ID = dict();
  VENUES.forEach(function (v) {
    v.displays.forEach(function (d) {
      BY_ID[d.id] = { v: v, d: d };
      d.zones.forEach(function (z) { BY_ID[z.id] = { v: v, d: d, z: z }; });
    });
  });
  var KEYS = dict();
  DATA.canvases.forEach(function (c) {
    var v = venueById[c.venue];
    var d = v && v.displays.filter(function (x) { return x.name === c.display; })[0];
    if (!d || c.within) return;
    var z = c.zone != null ? d.zones.filter(function (x) { return x.name === c.zone; })[0] : null;
    var id = z ? z.id : d.id;
    (KEYS[id] = KEYS[id] || []).push(c.key);
  });
  var KEY_ID = dict();
  Object.keys(KEYS).forEach(function (id) { KEYS[id].forEach(function (k) { KEY_ID[k] = id; }); });
  var ISSUE_LABEL = { conflict: 'Sources disagree', tbd: 'Not final', unconfirmed: 'Unconfirmed', naming: 'Names may change' };
  var OPEN_ISSUES = [];
  VENUES.forEach(function (v) {
    v.displays.forEach(function (d) {
      (d.issues || []).forEach(function (i) { OPEN_ISSUES.push({ v: v, d: d, issue: i }); });
      d.zones.forEach(function (z) { (z.issues || []).forEach(function (i) { OPEN_ISSUES.push({ v: v, d: d, z: z, issue: i }); }); });
    });
  });
  var PAGES = { agents: 1, issues: 1, terms: 1 };

  // Plain-English meanings for the words the boards use, for people new to
  // them. Shown on the Board terms page and as hover hints where they appear.
  var TERMS = [
    ['FG / BG', 'fgbg', 'Foreground and background: two layers of the same window in the board’s control system. One asset usually fills both.'],
    ['GIP', 'gip', 'Game in progress: the strip where the live score, clock and game info sit.'],
    ['Fascia (ribbon)', 'fascia', 'The long, short LED boards that run around the seating bowl. Very wide, very short, and they often scroll.'],
    ['Speaker scrim', 'scrim', 'Speakers hang in front of part of the board. Content behind the scrim is hard to see, so keep it plain.'],
    ['Pad', 'pad', 'Keep anything important this many pixels inside every edge.'],
    ['IPTV / StadiumVision', 'iptv', 'The concourse and suite TVs at Camp Randall, not the LED boards.'],
    ['Id and canvas key', 'ids', 'Stable names for scripts and production tools like the After Effects Board Builder. Turn on Technical details to see them.']
  ];
  var TERM = dict();
  TERMS.forEach(function (t) { TERM[t[1]] = t[2]; });
  // Hover hint for a zone or display name, from the first term it uses.
  function termFor(name) {
    var n = name.toLowerCase();
    if (/\bgip\b/.test(n)) return TERM.gip;
    if (/fascia|ribbon|\bring\b/.test(n)) return TERM.fascia;
    if (/iptv/.test(n)) return TERM.iptv;
    return null;
  }

  // Everyday words people search with, mapped to the words the boards use.
  var SYNONYMS = {
    ribbon: ['fascia', 'ring'], ribbons: ['fascia', 'ring'], ticker: ['fascia', 'ring'], halo: ['ring'],
    tv: ['iptv'], tvs: ['iptv'], television: ['iptv'], concourse: ['iptv'], suite: ['iptv'], stadiumvision: ['iptv'],
    score: ['gip'], clock: ['gip'], bug: ['gip'],
    ad: ['ad', 'sponsor'], ads: ['ad', 'sponsor'], sponsor: ['sponsor', 'ad'], commercial: ['ad', 'sponsor'],
    football: ['camp randall'], basketball: ['kohl center'], hockey: ['kohl center', 'labahn'], volleyball: ['field house'], softball: ['goodman'],
    stadium: ['camp randall'], arena: ['kohl center', 'labahn']
  };
  var TECH_KEY = 'boards.tech.v1';
  var showTech = storageGet(TECH_KEY) === '1';

  var CONTENT = dict();
  DATA.content.broad.forEach(function (c) { c.kind = 'broad'; CONTENT[c.id] = c; });
  DATA.content.gameDay.forEach(function (g) { g.items.forEach(function (c) { c.kind = 'gameDay'; c.group = g.name; CONTENT[c.id] = c; }); });

  function isDisplay(id) { return !!(BY_ID[id] && !BY_ID[id].z); }
  var state = {};
  function readParams() {
    var params = new URLSearchParams(window.location.search);
    var d = isDisplay(params.get('d')) ? params.get('d') : null;
    state.display = d;
    state.layout = d && (BY_ID[d].d.layouts || []).some(function (l) { return l.id === params.get('l'); }) ? params.get('l') : null;
    state.filter = 'all';
    state.venue = d ? BY_ID[d].v.id : venueById[params.get('v')] ? params.get('v') : (venueById[storageGet(VENUE_KEY)] ? storageGet(VENUE_KEY) : VENUES[0].id);
    state.content = CONTENT[params.get('c')] ? params.get('c') : null;
    state.page = own(PAGES, params.get('p')) ? params.get('p') : null;
    state.query = params.get('q') || '';
    state.narrow = params.get('n') || '';
    state.venueFilter = params.get('f') === 'issues' ? 'issues' : 'all';
    state.share = params.get('share') === '1';
  }
  readParams();
  if (state.share) {
    document.body.classList.add('is-share');
    // Shared links keep the tool's name but drop the way back to the site.
    var apps = document.querySelector('.wc-apps');
    if (apps) apps.hidden = true;
  }

  /* ---------------- helpers ---------------- */

  function size(w, h) { return w + 'x' + h; }
  function pretty(w, h) { return w.toLocaleString('en-US') + ' × ' + h.toLocaleString('en-US'); }
  function gcd(a, b) { return b ? gcd(b, a % b) : a; }
  function ratio(w, h) {
    var g = gcd(w, h), a = w / g, b = h / g;
    if (a <= 32 && b <= 32) return a + ':' + b;
    var r = w / h;
    return r >= 1 ? (Math.round(r * 100) / 100) + ':1' : '1:' + (Math.round((h / w) * 100) / 100);
  }
  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  var SVGNS = 'http://www.w3.org/2000/svg';
  function svgNode(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function icon(paths) {
    var s = svgNode('svg', { class: 'icon', viewBox: '0 0 16 16', 'aria-hidden': 'true' });
    s.innerHTML = paths;
    return s;
  }
  var ICONS = {
    link: '<path d="M6.8 9.2a2.8 2.8 0 0 0 4 0l2.2-2.2a2.8 2.8 0 0 0-4-4l-.9.9"/><path d="M9.2 6.8a2.8 2.8 0 0 0-4 0L3 9a2.8 2.8 0 0 0 4 4l.9-.9"/>',
    download: '<path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/>',
    copy: '<rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5"/>',
    ae: '<rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="m4.8 10.8 1.7-5.6 1.7 5.6M5.3 9.2h2.4M9.6 9.4h2.6c0-1.2-.5-1.9-1.3-1.9s-1.3.8-1.3 1.7.5 1.6 1.4 1.6c.5 0 .9-.2 1.2-.5"/>',
    image: '<rect x="2.5" y="3.5" width="11" height="9" rx="1"/><path d="m4.5 10.5 2.5-2.5 2 2 1.5-1.5 1.5 1.5"/>',
    arrow: '<path d="M6 3.5 10.5 8 6 12.5"/>',
    json: '<path d="M5.5 2.5c-1.5 0-2 .7-2 2v1.6c0 .9-.5 1.4-1.3 1.9.8.5 1.3 1 1.3 1.9v1.6c0 1.3.5 2 2 2M10.5 2.5c1.5 0 2 .7 2 2v1.6c0 .9.5 1.4 1.3 1.9-.8.5-1.3 1-1.3 1.9v1.6c0 1.3-.5 2-2 2"/>',
    warn: '<path d="M8 2.2 14.3 13H1.7z"/><path d="M8 6.5v3.2M8 11.4v.1"/>',
    more: '<circle cx="3.5" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="12.5" cy="8" r=".9" fill="currentColor" stroke="none"/>',
    prev: '<path d="M10 3.5 5.5 8l4.5 4.5"/>',
    next: '<path d="M6 3.5 10.5 8 6 12.5"/>',
    share: '<path d="M8 10V2.5M5 5.5l3-3 3 3"/><path d="M3.5 8.5v4a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-4"/>',
    plus: '<path d="M8 3v10M3 8h10"/>',
    close: '<path d="m4 4 8 8M12 4l-8 8"/>'
  };
  function slug(s) { return s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

  var toastTimer = null;
  function toast(message) {
    el.toast.textContent = message;
    el.toast.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('is-on'); }, 1800);
  }
  function copy(text, done, button) {
    function ok() {
      toast(done);
      if (button) { button.classList.add('is-copied'); setTimeout(function () { button.classList.remove('is-copied'); }, 1200); }
    }
    function fallback() { if (legacyCopy(text)) ok(); else toast('This browser blocked copying.'); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fallback);
    else fallback();
  }
  // For browsers without the async clipboard (plain http, older Safari, some
  // embedded views): select a hidden textarea and use the old copy command.
  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
    var active = document.activeElement;
    document.body.appendChild(ta);
    ta.select();
    var done = false;
    try { done = document.execCommand('copy'); } catch (e) { done = false; }
    ta.remove();
    if (active && active.focus) active.focus({ preventScroll: true });
    return done;
  }
  function download(filename, text, type) {
    var url = URL.createObjectURL(new Blob([text], { type: type }));
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  function button(label, iconName, onClick, cls) {
    var b = node('button', 'btn' + (cls ? ' ' + cls : ''));
    b.type = 'button';
    if (iconName) b.appendChild(icon(ICONS[iconName]));
    b.appendChild(document.createTextNode(label));
    b.addEventListener('click', onClick);
    return b;
  }
  function escXml(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function canvasByKey(key) {
    for (var i = 0; i < DATA.canvases.length; i++) if (DATA.canvases[i].key === key) return DATA.canvases[i];
    return null;
  }
  // Title-safe inset only when every canvas for this id records the same one.
  function recordedInset(id) {
    var vals = (KEYS[id] || []).map(function (k) { var c = canvasByKey(k); return c && c.safeInset; }).filter(function (n) { return n != null; });
    if (!vals.length || !vals.every(function (n) { return n === vals[0]; })) return null;
    return vals[0];
  }
  function fpsConflict(d, z) {
    var issues = ((z && z.issues) || []).concat(d.issues || []);
    return issues.some(function (i) { return i.field === 'fps' || (i.kind === 'conflict' && /frame rate|fps/i.test(i.text)); });
  }
  // Exact size, aspect, and only the safe-area facts the manifest records.
  function specText(v, d, z) {
    var w = z ? z.w : d.w, h = z ? z.h : d.h;
    var lines = [v.name + ' · ' + d.name + (z ? ' · ' + baseName(z.name) : ''), size(w, h), ratio(w, h)];
    if (z && z.at && z.at.length) lines.push('at ' + z.at.map(function (p) { return p.x + ', ' + p.y; }).join(' / '));
    var safe = [];
    if (z && z.pad) safe.push('keep ' + z.pad + ' px inside every edge');
    var inset = recordedInset(z ? z.id : d.id);
    if (inset) safe.push(inset + ' px title safe');
    if (!z && d.overlays) {
      d.overlays.forEach(function (o) {
        if ((o.kind === 'crop' || o.kind === 'scrim') && o.w && o.h) safe.push(o.label + ' ' + o.w + 'x' + o.h + ' at ' + o.x + ',' + o.y);
        else if (o.x != null) safe.push(o.label + ' at x ' + o.x);
        else if (o.y != null) safe.push(o.label + ' at y ' + o.y);
      });
    }
    lines.push(safe.length ? 'safe area: ' + safe.join('; ') : 'safe area: none recorded');
    if (z && z.stillOnly) lines.push('stills only');
    else if (fpsConflict(d, z)) lines.push('frame rate: sources disagree');
    else if (d.delivery && d.delivery.fps) lines.push('frame rate: ' + d.delivery.fps + ' fps');
    lines.push('id: ' + (z ? z.id : d.id));
    lines.push('manifest: ' + DATA.version);
    return lines.join('\n');
  }
  function rowSpec(v, d, row) {
    var text = specText(v, d, row.first);
    if (row.layers && row.layers.length > 1) text = text.replace('\nid:', '\nlayers: ' + row.layers.join(' + ') + '\nid:');
    return text;
  }
  function guideName(v, d, row, ext) {
    return v.code + '_' + slug(d.name) + (row ? '_' + slug(row.base) : '') + '_' + size(row ? row.w : d.w, row ? row.h : d.h) + '_guide.' + ext;
  }
  function guideSvg(opts) {
    var w = opts.w, h = opts.h, i = opts.inset;
    var font = h < 80 ? Math.max(10, Math.round(h * 0.45)) : Math.max(14, Math.min(48, Math.round(Math.min(w, h) * 0.04)));
    var out = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">',
      '<rect width="' + w + '" height="' + h + '" fill="#ffffff"/>',
      '<rect x="0.5" y="0.5" width="' + (w - 1) + '" height="' + (h - 1) + '" fill="none" stroke="#1f1e1b" stroke-width="1"/>'
    ];
    if (i) out.push('<rect x="' + i + '" y="' + i + '" width="' + (w - i * 2) + '" height="' + (h - i * 2) + '" fill="none" stroke="#b3261e" stroke-width="2" stroke-dasharray="12 8"/>');
    (opts.overlays || []).forEach(function (o) {
      if (o.kind === 'crop' || o.kind === 'scrim') out.push('<rect x="' + o.x + '" y="' + o.y + '" width="' + o.w + '" height="' + o.h + '" fill="#b3261e" fill-opacity="0.16" stroke="#b3261e" stroke-width="2"/>');
      else {
        var vertical = o.x != null;
        out.push('<line x1="' + (vertical ? o.x : 0) + '" y1="' + (vertical ? 0 : o.y) + '" x2="' + (vertical ? o.x : w) + '" y2="' + (vertical ? h : o.y) + '" stroke="#b3261e" stroke-width="2" stroke-dasharray="10 8"/>');
      }
    });
    (opts.zones || []).forEach(function (z) {
      if (z.w === w && z.h === h) return;
      (z.at || []).forEach(function (p) {
        out.push('<rect x="' + p.x + '" y="' + p.y + '" width="' + z.w + '" height="' + z.h + '" fill="none" stroke="#2b6cb0" stroke-width="2"/>');
      });
    });
    out.push('<text x="' + Math.max(8, Math.round(w * 0.02)) + '" y="' + Math.max(font + 6, Math.round(Math.min(h - 8, h * 0.12))) + '" fill="#1f1e1b" font-family="ui-monospace, Menlo, monospace" font-size="' + font + '">' + escXml(opts.label) + '</text>');
    out.push('</svg>', '');
    return out.join('\n');
  }
  function downloadSvg(opts) {
    download(opts.filename, guideSvg(opts), 'image/svg+xml');
    toast('Downloaded ' + opts.filename);
  }
  function closeMenus(except) {
    Array.prototype.forEach.call(document.querySelectorAll('details.menu[open]'), function (d) { if (d !== except) d.removeAttribute('open'); });
  }
  // A small menu on <details>. compact draws it as a ⋯ icon (zone rows).
  // Opening from the keyboard focuses the first item; arrows move, Escape
  // closes and returns focus to the button.
  function moreMenu(items, name, compact) {
    var det = node('details', 'menu');
    var sum = node('summary', 'btn' + (compact ? ' dots' : ''));
    sum.setAttribute('aria-label', 'More actions' + (name ? ' for ' + name : ''));
    sum.setAttribute('aria-haspopup', 'menu');
    if (compact) { sum.appendChild(icon(ICONS.more)); sum.title = 'More'; }
    else sum.appendChild(document.createTextNode('More'));
    det.appendChild(sum);
    var pop = node('div', 'menu-pop');
    pop.setAttribute('role', 'menu');
    items.forEach(function (item) {
      var b = node('button', 'menu-item');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      if (item.icon && ICONS[item.icon]) b.appendChild(icon(ICONS[item.icon]));
      b.appendChild(document.createTextNode(item.label));
      b.addEventListener('click', function () { det.removeAttribute('open'); sum.focus({ preventScroll: true }); item.onClick(); });
      pop.appendChild(b);
    });
    det.appendChild(pop);
    var byKey = false;
    sum.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') byKey = true;
      else if (e.key === 'ArrowDown' && !det.open) { e.preventDefault(); byKey = true; det.open = true; }
    });
    det.addEventListener('click', function (e) { e.stopPropagation(); });
    pop.addEventListener('keydown', function (e) {
      var list = Array.prototype.slice.call(pop.querySelectorAll('.menu-item'));
      var i = list.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length].focus();
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        list[e.key === 'Home' ? 0 : list.length - 1].focus();
      } else if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        det.removeAttribute('open'); sum.focus();
      } else if (e.key === 'Tab') {
        det.removeAttribute('open');
      }
    });
    det.addEventListener('toggle', function () {
      sum.setAttribute('aria-expanded', String(det.open));
      if (!det.open) { byKey = false; return; }
      closeMenus(det);
      var r = sum.getBoundingClientRect();
      pop.style.position = 'fixed';
      pop.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
      pop.style.left = 'auto';
      pop.style.top = (r.bottom + 4) + 'px';
      requestAnimationFrame(function () {
        var top = r.bottom + 4;
        if (top + pop.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - pop.offsetHeight - 4);
        pop.style.top = top + 'px';
        if (byKey) { var first = pop.querySelector('.menu-item'); if (first) first.focus(); }
      });
    });
    sum.setAttribute('aria-expanded', 'false');
    return det;
  }
  function shareItem() {
    return { label: 'Copy share link', icon: 'link', onClick: function () { copy(shareUrl(), 'Link copied'); } };
  }
  function withShare(items) {
    if (DATA.links && DATA.links.aeTemplate) items.push({ label: 'AE template', icon: 'ae', onClick: function () { window.open(DATA.links.aeTemplate, '_blank', 'noopener'); } });
    items.push(shareItem());
    return items;
  }

  // "Wing-Left-FG" and "Wing-Left-BG" are one zone with two layers; show them
  // as one row with FG / BG tags. Anything unpaired stays as its own row.
  var LAYER = /[-\s]+(FG|BG)$/;
  function baseName(name) { var m = LAYER.exec(name); return (m ? name.slice(0, m.index) : name).replace(/-\s+/, '-'); }
  function groupZones(zones) {
    var rows = [], byKey = {};
    zones.forEach(function (z) {
      var m = LAYER.exec(z.name);
      var base = baseName(z.name);
      var key = base + '|' + z.w + 'x' + z.h + '|' + JSON.stringify(z.at || null);
      if (m && byKey[key] && byKey[key].layers.indexOf(m[1]) === -1) { byKey[key].layers.push(m[1]); byKey[key].zones.push(z); return; }
      var row = { base: base, w: z.w, h: z.h, first: z, layers: m ? [m[1]] : [], zones: [z] };
      if (m) byKey[key] = row;
      rows.push(row);
    });
    return rows;
  }
  function findDisplay(t) {
    var v = venueById[t.venue];
    var d = v && v.displays.filter(function (x) { return x.name === t.display; })[0];
    return d ? { v: v, d: d } : null;
  }

  // Search: words must all appear in the zone, display, processor or venue
  // name, id or canvas key; a size like 1920x1080 matches exactly, zones and
  // whole displays. Enter on an exact id or key opens it.
  function matcher(query) {
    var q = query.trim().toLowerCase().replace(/,/g, '');
    if (!q) return null;
    var sm = /^(\d+)\s*[x×*]\s*(\d+)$/.exec(q);
    if (sm) {
      var want = sm[1] + 'x' + sm[2];
      return { zone: function (z) { return size(z.w, z.h) === want; }, display: function (d) { return size(d.w, d.h) === want; } };
    }
    var words = q.split(/\s+/);
    function has(hay) {
      hay = hay.toLowerCase();
      return words.every(function (w) {
        return hay.indexOf(w) !== -1 || (own(SYNONYMS, w) ? SYNONYMS[w] : []).some(function (alt) { return hay.indexOf(alt) !== -1; });
      });
    }
    return {
      zone: function (z, d, v) { return has([z.name, z.id, (KEYS[z.id] || []).join(' '), d.name, d.sheetName || '', d.group || '', d.processor || '', v.name, size(z.w, z.h)].join(' ')); },
      display: function (d, v) { return has([d.name, d.id, (KEYS[d.id] || []).join(' '), d.sheetName || '', d.group || '', d.processor || '', v.name, size(d.w, d.h)].join(' ')); }
    };
  }

  /* ---------------- sidebar ---------------- */

  function navButton(label, count, current, onClick, warn) {
    var li = node('li');
    var b = node('button');
    b.type = 'button';
    b.setAttribute('aria-current', String(!!current));
    b.appendChild(node('span', '', label));
    if (count != null) b.appendChild(node('span', 'count' + (warn ? ' is-warn' : ''), String(count)));
    b.addEventListener('click', onClick);
    li.appendChild(b);
    return li;
  }

  function renderNav() {
    var searching = !!state.query.trim();
    el['nav-venues'].textContent = '';
    VENUES.forEach(function (v) {
      el['nav-venues'].appendChild(navButton(v.name, v.displays.length, !searching && !state.content && !state.page && state.venue === v.id, function () {
        go({ venue: v.id });
      }));
    });
    el['nav-ref'].textContent = '';
    [['terms', 'Board terms', null], ['agents', 'For agents & tools', null], ['issues', 'Open issues', OPEN_ISSUES.length]].forEach(function (pg) {
      el['nav-ref'].appendChild(navButton(pg[1], pg[2], !searching && state.page === pg[0], function () { closeTopMenu(); openPage(pg[0]); }, pg[0] === 'issues' && pg[2] > 0));
    });
    el['nav-ref'].appendChild(techToggle());
    applyTech();
  }

  // Every move between views goes through here: reset the view, apply the
  // change, render and add a history entry.
  function go(patch) {
    state.content = null; state.page = null; state.display = null; state.layout = null; state.filter = 'all'; state.narrow = ''; state.venueFilter = 'all';
    clearSearch();
    Object.keys(patch).forEach(function (k) { state[k] = patch[k]; });
    if (state.display) state.venue = BY_ID[state.display].v.id;
    storageSet(VENUE_KEY, state.venue);
    render(true, true);
    // Move focus to the new view's heading so keyboard and screen reader users land on it.
    el.title.setAttribute('tabindex', '-1');
    el.title.focus({ preventScroll: true });
  }
  function openContent(id) { go({ content: id }); }
  function openPage(id) { go({ page: id }); }
  function openBoard(id) { go({ display: id }); }
  function boardLink(id, label, cls) {
    var a = node('a', cls || '', label);
    a.href = '?d=' + encodeURIComponent(id) + (state.share ? '&share=1' : '');
    a.addEventListener('click', function (e) { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); openBoard(id); });
    return a;
  }
  function clearSearch() { state.query = ''; el.search.value = ''; }

  /* ---------------- drawing ---------------- */

  // The board, to scale. Canvas, crops, scrims and seams are SVG; zones are
  // HTML buttons placed in % on top, so they can carry labels (shown only when
  // the zone is big enough, via container queries), take focus, and link to
  // their row. Zones that fill the whole board are the board itself.
  // opts.big draws a taller board view; opts.show(row) returns 'show',
  // 'dim' or 'hide' for each zone (layouts hide, filters dim).
  function renderFigure(v, d, isHot, card, opts) {
    opts = opts || {};
    var wrap = node('div', 'figure');
    var svg = svgNode('svg', { viewBox: '0 0 ' + d.w + ' ' + d.h, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    var id = 'hatch-' + slug((d.processor || '') + d.name + d.w);
    var defs = svgNode('defs', {});
    defs.innerHTML = '<pattern id="' + id + '" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="10" fill="currentColor" fill-opacity=".1"/><line x1="0" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="2.5" stroke-opacity=".7"/></pattern>';
    svg.appendChild(defs);
    svg.appendChild(svgNode('rect', { class: 'canvas', x: 0, y: 0, width: d.w, height: d.h, 'vector-effect': 'non-scaling-stroke' }));
    // Previewed art sits on the board's canvas, under the crops, scrims and
    // seams, so you see what the board will hide.
    // Videos play muted on a loop inside a foreignObject, so they stack in
    // the same order as images.
    (opts.art || []).forEach(function (piece) {
      if (piece.hidden) return;
      piece.places.forEach(function (p) {
        if (!piece.art.video) {
          svg.appendChild(svgNode('image', { class: 'art', href: piece.art.url, x: p.x, y: p.y, width: p.w, height: p.h, preserveAspectRatio: 'none' }));
          return;
        }
        var fo = svgNode('foreignObject', { class: 'art', x: p.x, y: p.y, width: p.w, height: p.h });
        var vid = document.createElement('video');
        vid.muted = true; vid.loop = true; vid.autoplay = true; vid.playsInline = true;
        vid.setAttribute('muted', ''); vid.setAttribute('playsinline', '');
        vid.className = 'art-video';
        vid.src = piece.art.url;
        fo.appendChild(vid);
        svg.appendChild(fo);
      });
    });
    var hasArt = !!(opts.art && opts.art.length);
    var used = {}, placed = 0;
    (d.overlays || []).forEach(function (o) {
      if (o.kind === 'crop' || o.kind === 'scrim') {
        var g = svgNode('g', { class: 'ov-' + o.kind });
        // Over previewed art, dim what the board hides so the cut reads.
        if (hasArt) g.appendChild(svgNode('rect', { x: o.x, y: o.y, width: o.w, height: o.h, fill: '#000', 'fill-opacity': '0.5' }));
        g.appendChild(svgNode('rect', { x: o.x, y: o.y, width: o.w, height: o.h, fill: 'url(#' + id + ')' }));
        svg.appendChild(g);
        used[o.kind] = true;
      } else {
        var vertical = o.x != null;
        svg.appendChild(svgNode('line', {
          class: 'ov-seam', 'vector-effect': 'non-scaling-stroke',
          x1: vertical ? o.x : 0, x2: vertical ? o.x : d.w, y1: vertical ? 0 : o.y, y2: vertical ? d.h : o.y
        }));
        used[o.kind === 'break' ? 'break' : 'seam'] = true;
      }
    });
    wrap.appendChild(svg);

    var layer = node('div', 'hits');
    // One rect per placed position, clipped to the board. Zones that fill the
    // whole board are the board itself.
    var rects = [];
    groupZones(d.zones).forEach(function (row) {
      var z = row.first;
      var shown = opts.show ? opts.show(row) : 'show';
      if (shown === 'hide') return;
      (z.at || []).forEach(function (p) {
        if (p.x >= d.w || p.y >= d.h) return;
        placed++;
        used[z.atFrom === 'derived' ? 'derived' : 'stated'] = true;
        if (z.w === d.w && z.h === d.h) {
          // Not drawn, but it outlines the whole board when its row is hovered or picked.
          var whole = node('span', 'zone-whole');
          whole.setAttribute('data-zone', d.name + '|' + z.n);
          layer.appendChild(whole);
          return;
        }
        rects.push({ row: row, z: z, dim: shown === 'dim', x: p.x, y: p.y, w: Math.min(z.w, d.w - p.x), h: Math.min(z.h, d.h - p.y) });
      });
    });
    // A zone that holds others is an alternative layout of the same space
    // (Frame-Left around the wing and ads). Its label moves to its top-left
    // corner, and when the zones inside fill most of it (over half, sampled on
    // a 24 × 24 grid) it shows only on hover or pick.
    function holds(a, b) { return a !== b && b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h && (a.w > b.w || a.h > b.h); }
    function covered(r, kids) {
      var hit = 0, n = 24;
      for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) {
        var px = r.x + (i + 0.5) * r.w / n, py = r.y + (j + 0.5) * r.h / n;
        if (kids.some(function (k) { return px >= k.x && px < k.x + k.w && py >= k.y && py < k.y + k.h; })) hit++;
      }
      return hit / (n * n);
    }
    rects.forEach(function (r) {
      var kids = rects.filter(function (o) { return holds(r, o); });
      r.parent = kids.length > 0;
      r.hidden = r.parent && covered(r, kids) > 0.5;
    });
    // Largest first, so smaller zones sit on top and win the pointer.
    rects.sort(function (a, b) { return b.w * b.h - a.w * a.h; });
    rects.forEach(function (rc) {
      var row = rc.row, z = rc.z;
      var b = node('button', 'zone-hit zone-' + (z.atFrom === 'derived' ? 'derived' : 'stated') + (rc.parent ? ' is-parent' : '') + (rc.hidden ? ' is-covered' : '') + (rc.dim ? ' is-dim' : '') + (isHot && isHot(z) ? ' is-match' : ''));
      b.type = 'button';
      b.setAttribute('data-zone', d.name + '|' + z.n);
      b.setAttribute('data-area', String(rc.w * rc.h));
      b.setAttribute('data-row', row.first.id);
      b.style.left = (rc.x / d.w * 100) + '%';
      b.style.top = (rc.y / d.h * 100) + '%';
      b.style.width = (rc.w / d.w * 100) + '%';
      b.style.height = (rc.h / d.h * 100) + '%';
      b.title = row.base + ' · ' + pretty(z.w, z.h);
      b.setAttribute('aria-label', row.base + ', ' + size(z.w, z.h) + ': show in the list');
      var label = node('span', 'zone-label');
      label.appendChild(node('b', '', row.base));
      label.appendChild(node('i', '', pretty(z.w, z.h)));
      b.appendChild(label);
      var keys = row.zones.map(function (x) { return d.name + '|' + x.n; });
      b.addEventListener('mouseenter', function () { hot(card, keys, true); });
      b.addEventListener('mouseleave', function () { hot(card, keys, false); });
      b.addEventListener('focus', function () { hot(card, keys, true); });
      b.addEventListener('blur', function () { hot(card, keys, false); });
      b.addEventListener('click', function () {
        pick(card, keys);
        var r = document.getElementById(row.first.id);
        if (r) r.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
      layer.appendChild(b);
    });
    wrap.appendChild(layer);
    // Cap tall boards (260 px in a card, 440 px in the board view): the figure
    // narrows to keep its proportions. In the board view, ribbons draw at
    // least 64 px tall and scroll sideways instead of shrinking to a hairline.
    var capH = opts.big ? 440 : 260;
    wrap.style.maxWidth = Math.round((capH * d.w) / d.h) + 'px';
    // The board view pins the drawing while the list scrolls, so it also
    // keeps to 38% of the window height.
    if (opts.big) wrap.style.maxWidth = 'min(' + wrap.style.maxWidth + ', calc(38vh * ' + (d.w / d.h).toFixed(4) + '))';
    var ribbon = opts.big && d.w / d.h >= 8;
    if (ribbon) { wrap.style.width = Math.round((64 * d.w) / d.h) + 'px'; wrap.style.maxWidth = 'none'; }
    // The sizer's percent padding resolves against the figure's own width, so
    // the drawing keeps the board's aspect ratio at any width; hairline
    // ribbons stay at least 8 px tall.
    var sizer = node('div', 'sizer');
    sizer.style.paddingBottom = 'max(' + (d.h / d.w * 100) + '%, 8px)';
    wrap.insertBefore(sizer, wrap.firstChild);
    if (window.ResizeObserver) new ResizeObserver(function () { declutter(wrap); }).observe(wrap);
    var dw = node('div', 'dim dim-w'); dw.appendChild(node('span', '', d.w.toLocaleString('en-US') + ' px')); wrap.appendChild(dw);
    var dh = node('div', 'dim dim-h'); dh.appendChild(node('span', '', d.h.toLocaleString('en-US') + ' px')); wrap.appendChild(dh);
    return { el: wrap, placed: placed, used: used, ribbon: ribbon };
  }

  // Where a zone sits on its board, at thumbnail size. Falls back to the
  // zone's own shape when no source gives a position.
  function miniMap(d, z, w, h) {
    var thumb = node('span', 'thumb');
    if (!z || !z.at || !z.at.length || (z.w === d.w && z.h === d.h)) {
      var box = node('i', 'shape');
      var scale = Math.min(44 / w, 24 / h);
      box.style.width = Math.max(2, w * scale) + 'px';
      box.style.height = Math.max(2, h * scale) + 'px';
      thumb.appendChild(box);
      return thumb;
    }
    var board = node('i', 'board');
    var bs = Math.min(48 / d.w, 26 / d.h);
    board.style.width = Math.max(4, d.w * bs) + 'px';
    board.style.height = Math.max(3, d.h * bs) + 'px';
    z.at.forEach(function (p) {
      var spot = node('b');
      spot.style.left = (p.x / d.w * 100) + '%';
      spot.style.top = (p.y / d.h * 100) + '%';
      spot.style.width = Math.max(z.w / d.w * 100, 4) + '%';
      spot.style.height = Math.max(z.h / d.h * 100, 12) + '%';
      board.appendChild(spot);
    });
    thumb.appendChild(board);
    thumb.title = 'Where it sits on ' + d.name;
    return thumb;
  }

  // Every display at a venue on one shared scale: a skyline you can click.
  function renderOverview(v) {
    var maxW = Math.max.apply(null, v.displays.map(function (d) { return d.w; }));
    var maxH = Math.max.apply(null, v.displays.map(function (d) { return d.h; }));
    // One scale for every tile: the widest board fills a cell, the tallest fits.
    var scale = Math.min(112 / maxW, 40 / maxH);
    var box = node('nav', 'overview');
    box.setAttribute('aria-label', v.name + ' displays, to scale');
    var head = node('div', 'overview-head');
    head.appendChild(node('span', '', 'At a glance'));
    head.appendChild(node('small', '', 'Every display drawn on one scale. Pick one to jump to it.'));
    box.appendChild(head);
    var strip = node('div', 'overview-strip');
    strip.style.setProperty('--tile-h', Math.max(8, Math.ceil(maxH * scale)) + 'px');
    v.displays.forEach(function (d) {
      var b = node('button', 'ov-item');
      b.type = 'button';
      var tile = node('span', 'ov-tile');
      tile.style.width = Math.max(3, d.w * scale) + 'px';
      tile.style.height = Math.max(2, d.h * scale) + 'px';
      if ((d.issues || []).length || d.zones.some(function (z) { return z.issues; })) tile.classList.add('has-issue');
      b.appendChild(tile);
      var cap = node('span', 'ov-cap');
      cap.appendChild(node('b', '', d.name));
      cap.appendChild(node('i', '', pretty(d.w, d.h)));
      b.appendChild(cap);
      b.setAttribute('aria-label', d.name + ', ' + size(d.w, d.h));
      b.addEventListener('click', function () { goTo(d.id); });
      strip.appendChild(b);
    });
    box.appendChild(strip);
    return box;
  }

  var LEGEND = {
    stated: 'Zone', derived: 'Zone (position from sizes)', crop: 'Cropped on the board',
    scrim: 'Behind the speaker scrim', seam: 'TV seam', 'break': 'Angle starts'
  };
  function renderLegend(used) {
    var keys = Object.keys(LEGEND).filter(function (k) { return used[k]; });
    if (!keys.length) return null;
    var list = node('ul', 'legend');
    keys.forEach(function (k) {
      var li = node('li');
      li.appendChild(node('i', 'key key-' + k));
      li.appendChild(document.createTextNode(LEGEND[k]));
      var hint = { scrim: TERM.scrim }[k];
      if (hint) { li.title = hint; li.classList.add('has-term'); }
      list.appendChild(li);
    });
    return list;
  }

  /* ---------------- PNG guides ---------------- */

  function downloadGuide(opts) {
    var w = opts.w, h = opts.h;
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d');
    if (!ctx) { toast('This browser can’t draw the guide.'); return; }
    var line = Math.max(2, Math.round(Math.min(w, h) / 200));
    ctx.lineWidth = line;
    (opts.overlays || []).forEach(function (o) {
      if (o.kind === 'crop' || o.kind === 'scrim') {
        ctx.fillStyle = o.kind === 'crop' ? 'rgba(255, 70, 70, 0.35)' : 'rgba(40, 40, 40, 0.55)';
        ctx.fillRect(o.x, o.y, o.w, o.h);
      }
    });
    ctx.strokeStyle = '#ffb000';
    ctx.setLineDash([line * 4, line * 3]);
    (opts.zones || []).forEach(function (z) {
      (z.at || []).forEach(function (p) { ctx.strokeRect(p.x + line / 2, p.y + line / 2, z.w - line, z.h - line); });
    });
    ctx.strokeStyle = '#ff4646';
    (opts.overlays || []).forEach(function (o) {
      if (o.kind === 'crop' || o.kind === 'scrim') return;
      ctx.beginPath();
      if (o.x != null) { ctx.moveTo(o.x, 0); ctx.lineTo(o.x, h); } else { ctx.moveTo(0, o.y); ctx.lineTo(w, o.y); }
      ctx.stroke();
    });
    var inset = opts.inset || opts.pad;
    if (inset) {
      ctx.setLineDash([line * 2, line * 2]);
      ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = '#00b3ff';
    ctx.strokeRect(line / 2, line / 2, w - line, h - line);
    var label = opts.label;
    var fontPx = Math.max(10, Math.min(Math.round(h * 0.16), Math.round(w / (label.length * 0.62))));
    ctx.font = '600 ' + fontPx + 'px ui-monospace, Menlo, monospace';
    ctx.fillStyle = 'rgba(0, 179, 255, 0.9)';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(label, w / 2, h / 2);
    canvas.toBlob(function (blob) {
      if (!blob) { toast('Couldn’t make the PNG.'); return; }
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = opts.filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      toast('Downloaded ' + opts.filename);
    }, 'image/png');
  }

  /* ---------------- display cards ---------------- */

  // opts.board: the one-board view (no head, large drawing); opts.show(row)
  // as in renderFigure. Hidden and dimmed zones drop out of the list.
  function renderDisplay(v, d, match, showVenue, opts) {
    opts = opts || {};
    var displayHit = match && match.display(d, v);
    var zoneMatch = match && !displayHit ? function (z) { return match.zone(z, d, v); } : null;
    var zones = zoneMatch ? d.zones.filter(zoneMatch) : d.zones;
    if (match && !displayHit && !zones.length) return null;

    var card = node('section', 'card' + (opts.board ? ' is-board' : ''));
    card.id = d.id;
    card.setAttribute('aria-label', v.name + ' ' + d.name);
    var head = node('div', 'card-head');
    var title = node('div', 'card-title');
    var h2 = node('h2');
    var dl = boardLink(d.id, d.name, 'board-link');
    if (termFor(d.name)) dl.title = termFor(d.name);
    h2.appendChild(dl);
    title.appendChild(h2);
    if (showVenue) title.appendChild(node('span', 'venue-of', v.name));
    title.appendChild(node('span', 'card-meta', ratio(d.w, d.h) + (d.zones.length ? ' · ' + d.zones.length + ' zone' + (d.zones.length === 1 ? '' : 's') : '')));
    if (d.processor) title.appendChild(node('span', 'processor', d.processor));
    head.appendChild(title);
    var dims = node('div', 'dims');
    dims.appendChild(sizeButton(d.w, d.h, d.name, specText(v, d, null)));
    head.appendChild(dims);
    if (!opts.board) card.appendChild(head);

    var props = node('div', 'card-props');
    props.appendChild(idPills(d.id));
    card.appendChild(props);

    var drawing = node('div', 'drawing');
    var fig = renderFigure(v, d, zoneMatch, card, { big: opts.board, show: opts.show, art: opts.art });
    if (fig.ribbon) {
      drawing.classList.add('is-scroll');
      drawing.tabIndex = 0;
      drawing.setAttribute('role', 'region');
      drawing.setAttribute('aria-label', d.name + ', scroll sideways for the full width');
    }
    // Pin the drawing while the list scrolls, but only when it shows zones.
    // Rows scroll in below it (--pin feeds their scroll-margin-top).
    if (opts.board && fig.placed) {
      drawing.classList.add('is-pinned');
      if (window.ResizeObserver) new ResizeObserver(function () { card.style.setProperty('--pin', drawing.offsetHeight + 'px'); }).observe(drawing);
    }
    drawing.appendChild(fig.el);
    var legend = renderLegend(fig.used);
    if (legend) drawing.appendChild(legend);
    if (opts.board) {
      drawing.classList.add('art-target');
      drawing.setAttribute('data-drop', 'Drop on a zone to pin it there, or anywhere to place by size');
      var withArt = !!(opts.art && opts.art.length);
      if (withArt) drawing.classList.add('has-art');
      if (withArt && !artZones) drawing.classList.add('hide-zones');
      if (!withArt) drawing.appendChild(node('p', 'fig-note art-hint', 'Drop, paste or pick images or videos to preview them on the board. Several pieces can go on at once, and they stay on this device.'));
    }
    if (!fig.placed && d.zones.length) {
      drawing.appendChild(node('p', 'fig-note', 'The sources give sizes for this display, not zone positions.'));
      if (opts.board) {
        var sc = renderScale(d, card, opts.show);
        sc.style.width = fig.el.style.width;
        sc.style.maxWidth = fig.el.style.maxWidth;
        drawing.appendChild(sc);
      }
    }
    if (d.link) {
      var a = node('a', 'fig-link', d.link.label + ' ↗');
      a.href = d.link.href; a.target = '_blank'; a.rel = 'noopener noreferrer';
      drawing.appendChild(a);
    }
    card.appendChild(drawing);

    var rows = groupZones(zones).filter(function (row) { return !opts.show || opts.show(row) === 'show'; });
    if (rows.length) {
      var list = node('div', 'zones');
      rows.forEach(function (row) { list.appendChild(renderZoneRow(v, d, row, card, !!zoneMatch)); });
      card.appendChild(list);
    } else if (opts.board && d.zones.length) {
      card.appendChild(node('p', 'zones-empty', 'No zones match this filter.'));
    }

    var foot = node('div', 'card-foot');
    if (d.issues && d.issues.length) {
      var notes = node('ul', 'notes');
      d.issues.forEach(function (i) { notes.appendChild(issueItem(i)); });
      foot.appendChild(notes);
    }
    if (!opts.board) {
      var acts = node('div', 'foot-actions');
      foot.appendChild(acts);
      acts.appendChild(moreMenu([
        { label: 'Guide SVG', icon: 'image', onClick: function () { downloadSvg(Object.assign({}, guideOpts(v, d, null), { filename: guideName(v, d, null, 'svg') })); } },
        { label: 'Guide PNG', icon: 'image', onClick: function () { downloadGuide(guideOpts(v, d, null)); } }
      ], d.name, true));
    }
    if (foot.childNodes.length) card.appendChild(foot);
    return { el: card, zones: zones.length };
  }

  // A display's or zone's stable id (click to copy) and the canvas keys built from it.
  function idPills(id) {
    var wrap = node('span', 'ids');
    var b = node('button', 'pill mono id-pill', id);
    b.type = 'button';
    b.title = 'Stable id: copy it into a project, a prompt or a script';
    b.setAttribute('aria-label', 'Copy id ' + id);
    b.addEventListener('click', function () { copy(id, 'Copied ' + id, b); });
    wrap.appendChild(b);
    (KEYS[id] || []).forEach(function (k) {
      var p = node('span', 'pill mono key-pill', k);
      p.title = 'Canvas key the After Effects Board Builder and other production tools use';
      wrap.appendChild(p);
    });
    return wrap;
  }
  function issueItem(i) {
    var li = node('li', 'is-open');
    var b = node('b', '', (ISSUE_LABEL[i.kind] || i.kind) + (i.field ? ' (' + i.field + ')' : '') + ': ');
    li.appendChild(b);
    li.appendChild(document.createTextNode(i.text));
    return li;
  }
  function zoneJson(v, d, z, row) {
    var fps = d.delivery && parseFloat(d.delivery.fps);
    var out = { id: z.id, venue: v.id, display: d.name, zone: z.name, w: z.w, h: z.h, at: z.at || null };
    if (row && row.zones.length > 1) out.layers = row.zones.map(function (x) { return x.id; });
    if (!z.stillOnly && isFinite(fps)) out.fps = fps;
    if (z.stillOnly) out.stillOnly = true;
    if (z.duration) out.duration = z.duration;
    if (z.pad) out.pad = z.pad;
    if (KEYS[z.id]) out.canvasKeys = KEYS[z.id];
    var issues = (z.issues || []).concat(d.issues || []);
    if (issues.length) out.issues = issues;
    out.manifest = DATA.version;
    return JSON.stringify(out, null, 2);
  }

  function specTags(z) {
    var tags = node('span', 'tags');
    if (z.stillOnly) { var so = node('span', 'tag', 'Stills only'); tags.appendChild(so); }
    if (z.duration) tags.appendChild(node('span', 'tag', z.duration));
    if (z.pad) { var t = node('span', 'tag warn', z.pad + ' px pad'); t.title = 'Keep content ' + z.pad + ' px inside every edge.'; tags.appendChild(t); }
    (z.issues || []).forEach(function (i) { var it = node('span', 'tag warn', ISSUE_LABEL[i.kind] || i.kind); it.title = i.text; tags.appendChild(it); });
    (z.id && KEYS[z.id] || []).forEach(function (k) { var kt = node('span', 'tag mono', k); kt.title = 'Canvas key for production tools'; tags.appendChild(kt); });
    return tags;
  }
  function guideOpts(v, d, row) {
    var w = row ? row.w : d.w, h = row ? row.h : d.h;
    var label = (row ? row.base : d.name) + ' ' + size(w, h);
    return {
      w: w, h: h,
      inset: row ? row.first.pad : recordedInset(d.id),
      overlays: row ? null : d.overlays,
      zones: row ? null : d.zones,
      pad: row ? row.first.pad : null,
      label: label,
      filename: guideName(v, d, row, 'png')
    };
  }
  function sizeButton(w, h, label, spec) {
    var b = node('button', 'size');
    b.type = 'button';
    b.appendChild(icon(ICONS.copy));
    b.appendChild(document.createTextNode(pretty(w, h)));
    b.title = 'Copy size, aspect ratio, and safe area';
    b.setAttribute('aria-label', 'Copy spec for ' + (label || size(w, h)));
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      copy(spec || size(w, h), 'Copied ' + size(w, h), b);
    });
    return b;
  }

  function renderZoneRow(v, d, row, card, matching) {
    var z = row.first;
    var r = node('div', 'zone-row' + (matching ? ' is-match' : ''));
    r.id = z.id;
    var keys = row.zones.map(function (x) { return d.name + '|' + x.n; });
    r.setAttribute('data-zone', keys[0]);
    r.addEventListener('mouseenter', function () { hot(card, keys, true); });
    r.addEventListener('mouseleave', function () { hot(card, keys, false); });
    r.addEventListener('click', function (e) { if (!e.target.closest('button, a')) pick(card, keys); });
    r.appendChild(miniMap(d, z, row.w, row.h));

    var name = node('span', 'zone-name');
    var line = node('span', 'zone-line');
    var nb = node('b', '', row.base);
    var hint = termFor(row.base);
    if (hint) { nb.title = hint; nb.classList.add('has-term'); }
    line.appendChild(nb);
    var tags = specTags(z);
    if (row.layers.length) {
      var lt = node('span', 'tag layers', row.layers.join(' + '));
      lt.title = row.layers.length > 1 ? TERM.fgbg : 'One layer (' + row.layers[0] + ') of a window in the board’s control system.';
      tags.insertBefore(lt, tags.firstChild);
    }
    if (tags.childNodes.length) line.appendChild(tags);
    name.appendChild(line);
    var meta = node('span', 'zone-meta');
    var idb = node('button', 'zone-id', row.zones.map(function (x) { return x.id.slice(d.id.length + 1); }).join(' + '));
    idb.type = 'button';
    idb.title = 'Copy id ' + z.id;
    idb.setAttribute('aria-label', 'Copy id ' + z.id);
    idb.addEventListener('click', function () { copy(z.id, 'Copied ' + z.id, idb); });
    meta.appendChild(idb);
    var bits = [];
    if (z.at) bits.push(z.at.map(function (p) { return 'x ' + p.x.toLocaleString('en-US') + ' y ' + p.y.toLocaleString('en-US'); }).join(' · ') + (z.atFrom === 'derived' ? ' (from sizes)' : ''));
    bits.push(ratio(row.w, row.h));
    var rest = node('span', '', bits.join(' · '));
    if (row.zones[0].n != null) rest.title = 'Zone ' + row.zones.map(function (x) { return '#' + x.n; }).join(', ') + ' in the source sheet';
    meta.appendChild(rest);
    name.appendChild(meta);
    if (z.issues && z.issues.length) {
      var ul = node('ul', 'zone-notes');
      z.issues.forEach(function (i) { var li = issueItem(i); li.className = 'red'; ul.appendChild(li); });
      name.appendChild(ul);
    }
    r.appendChild(name);
    r.appendChild(sizeButton(row.w, row.h, row.base, rowSpec(v, d, row)));
    var pngOpts = guideOpts(v, d, row);
    pngOpts.filename = guideName(v, d, row, 'png');
    r.appendChild(moreMenu([
      { label: 'Copy JSON', icon: 'json', onClick: function () { copy(zoneJson(v, d, z, row), 'Copied JSON for ' + z.id); } },
      { label: 'Guide SVG', icon: 'image', onClick: function () { downloadSvg(Object.assign({}, pngOpts, { filename: guideName(v, d, row, 'svg') })); } },
      { label: 'Guide PNG', icon: 'image', onClick: function () { downloadGuide(pngOpts); } }
    ], row.base, true));
    return r;
  }

  // Labels that would overlap a smaller zone's label hide until their zone is
  // hovered or picked. Smallest first: the most specific zones keep theirs.
  // Zones that hold others go last, so the zones inside keep their labels.
  function declutter(fig) {
    var hits = Array.prototype.slice.call(fig.querySelectorAll('.zone-hit:not(.is-covered)'));
    hits.forEach(function (b) { b.classList.remove('is-crowded'); });
    hits.sort(function (a, b) {
      return a.classList.contains('is-parent') - b.classList.contains('is-parent') || a.getAttribute('data-area') - b.getAttribute('data-area');
    });
    var kept = [];
    hits.forEach(function (b) {
      var label = b.querySelector('.zone-label');
      var r = label && label.getBoundingClientRect();
      if (!r || !r.width) return;
      var clash = kept.some(function (k) { return r.left < k.right + 2 && r.right > k.left - 2 && r.top < k.bottom + 1 && r.bottom > k.top - 1; });
      if (clash) b.classList.add('is-crowded'); else kept.push(r);
    });
  }

  // Click a zone in the drawing or its row to pick it; it stays lit until you
  // pick another, pick it again or press Escape. Works without hover (touch).
  function pick(card, keys) {
    var again = card.getAttribute('data-picked') === keys[0];
    clearPicks();
    if (again) return;
    card.setAttribute('data-picked', keys[0]);
    eachZone(card, keys, function (n) { n.classList.add('is-picked'); });
  }
  function clearPicks() {
    Array.prototype.forEach.call(document.querySelectorAll('.is-picked'), function (n) { n.classList.remove('is-picked'); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-picked]'), function (n) { n.removeAttribute('data-picked'); });
  }

  // Every node (drawn zone, list row) that stands for one of these zones.
  function eachZone(card, keys, fn) {
    keys.forEach(function (k) {
      Array.prototype.forEach.call(card.querySelectorAll('[data-zone="' + k.replace(/"/g, '\\"') + '"]'), fn);
    });
  }
  function hot(card, keys, on) { eachZone(card, keys, function (n) { n.classList.toggle('is-hot', on); }); }

  /* ---------------- content types ---------------- */

  // Every canvas one piece of content needs. Zones on the same display with
  // the same size are one asset placed several times, so they share a row.
  function mergedLabel(names) {
    if (names.length === 1) return names[0];
    var parts = names.map(function (n) { var i = n.lastIndexOf('-'); return i > 0 ? [n.slice(0, i), n.slice(i + 1)] : [n, '']; });
    var prefix = parts[0][0];
    var shared = parts.every(function (p) { return p[0] === prefix && p[1]; });
    return shared ? prefix + '-' + parts.map(function (p) { return p[1]; }).join(' / ') : names.join(', ');
  }
  function contentRows(c) {
    var rows = [];
    c.targets.forEach(function (t) {
      var found = findDisplay(t);
      if (!found) return;
      var v = found.v, d = found.d;
      if (!t.zones) { rows.push({ v: v, d: d, label: d.name, w: d.w, h: d.h, z: {}, count: 1, names: [] }); return; }
      var groups = groupZones(d.zones);
      t.zones.forEach(function (zb) {
        var g = groups.filter(function (row) { return row.base === zb; })[0];
        if (!g) return;
        var same = rows.filter(function (r) { return r.d === d && r.names.length && r.w === g.w && r.h === g.h; })[0];
        if (same) { same.names.push(zb); same.ids.push(g.first.id); same.count++; return; }
        rows.push({ v: v, d: d, names: [zb], ids: [g.first.id], w: g.w, h: g.h, z: g.first, layers: g.layers, count: 1 });
      });
    });
    rows.forEach(function (r) {
      if (r.names.length) { r.zone = mergedLabel(r.names); r.label = r.d.name + ' › ' + r.zone; }
    });
    return rows;
  }
  function canvasCount(c) { return contentRows(c).length; }

  function fpsFor(d) {
    var f = d.delivery && parseFloat(d.delivery.fps);
    return isFinite(f) && f > 0 ? f : 59.94;
  }

  function aeScript(c, rows) {
    var dur = c.duration || 10;
    var specs = rows.map(function (r) {
      return [r.v.code + ' | ' + r.label.replace(' › ', ' – ') + (r.count > 1 ? ' (×' + r.count + ')' : '') + ' | ' + size(r.w, r.h), r.w, r.h, fpsFor(r.d), dur];
    });
    var unsure = [];
    rows.forEach(function (r) { if (fpsConflict(r.d) && unsure.indexOf(r.d) === -1) unsure.push(r.d); });
    // The BOM makes After Effects read the file as UTF-8, so ·, – and × survive in names.
    return '\uFEFF' + [
      '// Board Sizes · ' + c.name,
      '// ' + specs.length + ' comps, ' + (c.board ? 'one for the whole board and one per distinct zone size' : 'one per distinct canvas this content needs (×N = placed N times on that board)') + ', in a new project folder.',
      '// Frame rates follow the venue guide where it states one; otherwise 59.94.'
    ].concat(unsure.map(function (d) { return '// Check the frame rate for ' + d.name + ': sources disagree, so this uses ' + fpsFor(d) + '.'; }), [
      '// Duration ' + dur + ' s' + (c.duration ? ' (from Colosseum’s deliverables sheet)' : ' (placeholder)') + '. Run from File › Scripts › Run Script File.',
      '(function () {',
      '  if (!app.project) app.newProject();',
      '  app.beginUndoGroup(' + JSON.stringify('Board Sizes: ' + c.name) + ');',
      '  var folder = app.project.items.addFolder(' + JSON.stringify(c.name + ' · boards') + ');',
      '  var specs = ' + JSON.stringify(specs) + ';',
      '  for (var i = 0; i < specs.length; i++) {',
      '    var s = specs[i];',
      '    var comp = app.project.items.addComp(s[0], s[1], s[2], 1, s[4], s[3]);',
      '    comp.parentFolder = folder;',
      '  }',
      '  app.endUndoGroup();',
      '  alert(specs.length + " comps created in " + folder.name + ".");',
      '})();',
      ''
    ]).join('\n');
  }

  function renderContent(c) {
    var rows = contentRows(c);
    el.crumbs.textContent = '';
    var back = node('a', 'crumb-link', 'What are you making?');
    back.href = '?v=' + state.venue + (state.share ? '&share=1' : '');
    back.addEventListener('click', function (e) { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); go({ venue: state.venue }); });
    el.crumbs.appendChild(back);
    el.crumbs.appendChild(document.createTextNode(c.kind === 'broad' ? '' : ' · Game day · ' + c.group));
    el.title.textContent = c.name;
    el.subtitle.textContent = c.about || 'The boards Colosseum builds this for, across every venue.';

    el.props.textContent = '';
    function prop(k, valueNode) { el.props.appendChild(node('dt', '', k)); var dd = node('dd'); dd.appendChild(valueNode); el.props.appendChild(dd); }
    var placements = rows.reduce(function (n, r) { return n + r.count; }, 0);
    prop('Boards', document.createTextNode(rows.length + ' canvases to build' + (placements > rows.length ? ' (' + placements + ' placements)' : '') + ' at ' + unique(rows.map(function (r) { return r.v.id; })).length + ' venue' + (unique(rows.map(function (r) { return r.v.id; })).length === 1 ? '' : 's')));
    if (c.duration) prop('Duration', node('span', 'pill mono', c.duration + ' s'));
    if (c.sponsor) prop('Sponsor', node('span', 'pill', c.sponsor));
    else if (c.sponsorSlot) prop('Sponsor', node('span', 'pill', 'Sponsor slot (partner varies)'));
    if (c.social && c.social.length) {
      var soc = node('span', 'pills');
      c.social.forEach(function (s) { soc.appendChild(node('span', 'pill', s)); });
      prop('Also for social', soc);
    }
    if (c.note) prop('Note', document.createTextNode(c.note));
    prop('Source', c.kind === 'broad'
      ? node('span', 'pill draft', 'Draft list: correct it in boards.json')
      : node('span', 'pill src', 'Colosseum deliverables'));
    el.props.hidden = false;

    setActions([
      button('Copy spec', 'copy', function () {
        copy(rows.map(function (r) {
          return specText(r.v, r.d, r.names && r.names.length ? r.z : null) + (r.count > 1 ? '\nplacements: ' + r.count : '');
        }).join('\n\n'), 'Copied ' + rows.length + ' specs');
      }, 'primary'),
      moreMenu(withShare([
        { label: 'AE comps script', icon: 'ae', onClick: function () {
          var name = 'board-sizes_' + slug(c.name).toLowerCase() + '.jsx';
          download(name, aeScript(c, rows), 'text/plain');
          toast('Downloaded ' + name + ' (' + rows.length + ' comps)');
        } },
        { label: 'Download CSV', icon: 'download', onClick: function () {
          var filename = 'board-sizes_' + slug(c.name).toLowerCase() + '.csv';
          var table = contentCsv(c, rows);
          download(filename, toCsv(table), 'text/csv');
          toast('Downloaded ' + filename + ' (' + (table.length - 1) + ' rows)');
        } }
      ]), c.name)
    ]);

    el.view.textContent = '';
    el.view.appendChild(exportsTray(rows));
    var box = node('div', 'targets art-target');
    box.setAttribute('data-drop', 'Drop exports to check them against every canvas');
    unique(rows.map(function (r) { return r.v.id; })).forEach(function (vid) {
      var mine = rows.filter(function (r) { return r.v.id === vid; });
      var h = node('h2', '', venueById[vid].name);
      h.appendChild(node('small', '', mine.length + ' canvas' + (mine.length === 1 ? '' : 'es')));
      box.appendChild(h);
      mine.forEach(function (r) {
        var row = node('div', 't-row' + (arts.length ? ' has-art' : ''));
        row.appendChild(miniMap(r.d, r.z.at ? r.z : null, r.w, r.h));
        var nm = node('span', 't-name');
        var a = node('a', '', r.label);
        var target = r.ids ? r.ids[0] : r.d.id;
        a.href = '?v=' + r.v.id + (state.share ? '&share=1' : '') + '#' + target;
        a.addEventListener('click', function (e) { e.preventDefault(); goTo(target); });
        var b = node('b'); b.appendChild(a); nm.appendChild(b);
        var tags = specTags(r.z);
        if (r.layers && r.layers.length) tags.insertBefore(node('span', 'tag layers', r.layers.join(' + ')), tags.firstChild);
        if (r.count > 1) tags.insertBefore(node('span', 'tag', '×' + r.count), tags.firstChild);
        if (tags.childNodes.length) nm.appendChild(tags);
        row.appendChild(nm);
        row.appendChild(sizeButton(r.w, r.h, r.label, specText(r.v, r.d, r.names && r.names.length ? r.z : null)));
        if (arts.length) row.appendChild(exportStatus(r));
        var open = node('a', 'mini');
        open.href = a.href;
        open.title = arts.length ? 'Preview on ' + r.d.name : 'Open ' + r.d.name;
        open.setAttribute('aria-label', 'Open ' + r.d.name + ' at ' + r.v.name);
        open.appendChild(icon(ICONS.arrow));
        // With exports loaded, the arrow opens the board itself with them on it.
        open.addEventListener('click', function (e) { e.preventDefault(); if (arts.length) openBoard(r.d.id); else goTo(target); });
        row.appendChild(open);
        box.appendChild(row);
      });
    });
    el.view.appendChild(box);
    el.summary.textContent = '';
    el.empty.hidden = rows.length > 0;
  }

  // Opens the venue that holds a display or zone id and flashes it; a zone on
  // the board already open stays in that board's view. A BG layer shares its
  // FG row, so fall back to the row's first zone, then the card.
  function goTo(id, smooth, push) {
    var hit = BY_ID[id];
    if (!hit) return false;
    if (!(state.display === hit.d.id && !state.query && el.view.childNodes.length)) {
      state.venue = hit.v.id; state.content = null; state.page = null; state.display = null; clearSearch();
      storageSet(VENUE_KEY, hit.v.id);
      render(false, push !== false);
    }
    var target = document.getElementById(id);
    if (!target && hit.z) {
      var rows = groupZones(hit.d.zones).filter(function (r) { return r.zones.indexOf(hit.z) !== -1; });
      target = rows.length ? document.getElementById(rows[0].first.id) : null;
    }
    target = target || document.getElementById(hit.d.id);
    if (target) {
      target.scrollIntoView({ behavior: smooth === false ? 'auto' : 'smooth', block: hit.z ? 'center' : 'start' });
      target.classList.add('is-flash');
      setTimeout(function () { target.classList.remove('is-flash'); }, 1600);
    }
    try { window.history.replaceState(null, '', window.location.pathname + window.location.search + '#' + id); } catch (e) { /* file:// */ }
    return true;
  }

  function unique(list) { return list.filter(function (x, i) { return list.indexOf(x) === i; }); }

  /* ---------------- CSV + actions ---------------- */

  function csvCell(s) { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function toCsv(rows) { return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\n') + '\n'; }
  function contentCsv(c, rows) {
    var out = [['Content', 'Venue', 'Display', 'Zone', 'Ids', 'Placements', 'Width', 'Height', 'Frame rate', 'Video', 'Stills only', 'Duration', 'Border pad (px)', 'Guide page']];
    rows.forEach(function (r) {
      var del = r.d.delivery || {};
      out.push([c.name, r.v.name, r.d.name, r.zone || '', (r.ids || [r.d.id]).join(' '), r.count, r.w, r.h, r.z.stillOnly ? '' : del.fps, r.z.stillOnly ? del.still : del.video, r.z.stillOnly ? 'yes' : '', r.z.duration || (c.duration ? c.duration + ' s' : ''), r.z.pad, r.z.page]);
    });
    return out;
  }
  function displaysCsv(match, only) {
    var rows = [['Id', 'Venue', 'Group', 'Processor', 'Display', 'Display size', 'Zone #', 'Zone', 'Width', 'Height',
      'Positions (x,y)', 'Position source', 'Frame rate', 'Video', 'Stills', 'Duration', 'Stills only', 'Border pad (px)', 'Guide page', 'Sources', 'Notes']];
    VENUES.forEach(function (v) {
      if (!match && v.id !== state.venue) return;
      v.displays.forEach(function (d) {
        if (only && d !== only) return;
        var displayHit = match && match.display(d, v);
        var srcs = Object.keys(d.sources || {}).map(function (k) { return DATA.sources[k].label; }).join('; ');
        var del = d.delivery || {};
        var list = d.zones.length ? d.zones : [{ id: d.id, name: '(whole display)', w: d.w, h: d.h }];
        list.forEach(function (z) {
          if (match && !displayHit && !match.zone(z, d, v)) return;
          rows.push([z.id, v.name, d.group, d.processor, d.name, size(d.w, d.h), z.n, z.name, z.w, z.h,
            (z.at || []).map(function (p) { return p.x + ',' + p.y; }).join(' | '), z.atFrom,
            del.fps, del.video, del.still, z.duration || del.duration, z.stillOnly ? 'yes' : '', z.pad, z.page, srcs,
            (z.issues || []).concat(d.issues || []).map(function (i) { return i.kind + ': ' + i.text; }).concat(z.notes || []).concat(d.notes || []).join(' / ')]);
        });
      });
    });
    return rows;
  }

  function shareUrl() {
    var p = currentParams();
    p.set('share', '1');
    return window.location.origin + '/board-sizes?' + p.toString();
  }
  function setActions(list) {
    el.actions.textContent = '';
    list.forEach(function (b) { el.actions.appendChild(b); });
  }

  /* ---------------- agents + issues pages ---------------- */

  var SITE = 'https://wisconsincreative.com/board-sizes';
  var FILES = [
    ['llms.txt', 'Read first. Rules for agents, every size as a table, open issues and the changelog, in plain Markdown.'],
    ['index.json', 'Start here in code. One flat record per display and zone: id, size, aspect, positions, fps, delivery, canvas keys, issues and a deep link. Also canvases and content types resolved to ids.'],
    ['boards.json', 'The hand-edited source. Pin this exact file in production tools; the After Effects Board Builder does.'],
    ['boards.schema.json', 'JSON Schema for boards.json.'],
    ['boards.csv', 'index.json as a spreadsheet.']
  ];
  var RULES = [
    'Never hardcode or guess a board size. Look it up here and note the manifest version you used.',
    'Refer to boards by id (camp-randall/north-board/main-video-fg) or, in production tools, by canvas key (MAIN_VIDEO). Names keep the processor’s typos; ids and keys never change.',
    'Sizes are width × height in px. Positions are {x, y} from the display’s top-left.',
    'Check issues on the boards you touch and tell the person about them. Never resolve a conflict silently.',
    'FG and BG are two processor layers of one window: build one asset unless the content needs both.',
    'To change a size, edit boards.json in the Wisconsin Creative repo and run node scripts/build-board-sizes.mjs. Never edit generated files.'
  ];
  var SNIPPETS = [
    ['JavaScript', 'const idx = await (await fetch("' + SITE + '/index.json")).json();\nconst main = idx.boards.find((b) => b.id === "camp-randall/north-board/main-video-fg");\n// main.w, main.h, main.at, main.fps, main.issues'],
    ['Python', 'import json, urllib.request\nidx = json.load(urllib.request.urlopen("' + SITE + '/index.json"))\nsizes = {b["id"]: (b["w"], b["h"]) for b in idx["boards"]}'],
    ['Agent prompt', 'Board sizes: read ' + SITE + '/llms.txt and look up every canvas there by id. Do not hardcode sizes. Report the manifest version you used and any open issues on the boards you touch.']
  ];

  function pageHead(crumb, title, sub) {
    el.crumbs.textContent = crumb;
    el.title.textContent = title;
    el.subtitle.textContent = sub;
    el.props.hidden = true;
    el.props.textContent = '';
    el.summary.textContent = '';
    el.empty.hidden = true;
    el.view.textContent = '';
  }
  function section(title, sub) {
    var box = node('section', 'card doc');
    var h = node('div', 'card-head');
    h.appendChild(node('h2', '', title));
    if (sub) h.appendChild(node('span', 'venue-of', sub));
    box.appendChild(h);
    el.view.appendChild(box);
    return box;
  }

  function renderAgents() {
    var stats = { displays: 0, zones: 0 };
    VENUES.forEach(function (v) { stats.displays += v.displays.length; v.displays.forEach(function (d) { stats.zones += d.zones.length; }); });
    pageHead('Reference', 'For agents & tools',
      'Everything here is published as plain files, so scripts, templates and AI agents can use the same sizes people see on this page.');
    el.props.hidden = false;
    function prop(k, v) { el.props.appendChild(node('dt', '', k)); var dd = node('dd'); dd.appendChild(v); el.props.appendChild(dd); }
    prop('Manifest', node('span', 'pill mono', DATA.version));
    prop('Updated', document.createTextNode(DATA.updated));
    prop('Covers', document.createTextNode(VENUES.length + ' venues · ' + stats.displays + ' displays · ' + stats.zones + ' zones · ' + DATA.canvases.length + ' canvas keys'));
    setActions([
      button('Copy agent prompt', 'copy', function () { copy(SNIPPETS[2][1], 'Copied the agent prompt'); }, 'primary'),
      moreMenu(withShare([]), 'agent files')
    ]);

    var files = section('Files', SITE + '/');
    var list = node('div', 'zones');
    FILES.forEach(function (f) {
      var r = node('div', 'zone-row file-row');
      r.appendChild(node('span', 'thumb file-ico', f[0].split('.').pop().toUpperCase()));
      var nm = node('span', 'zone-name');
      var a = node('a', '', f[0]);
      a.href = f[0]; a.target = '_blank'; a.rel = 'noopener';
      var b = node('b'); b.appendChild(a); nm.appendChild(b);
      nm.appendChild(node('span', 't-sub', f[1]));
      r.appendChild(nm);
      var cb = node('button', 'size', 'Copy URL');
      cb.type = 'button';
      cb.addEventListener('click', function () { copy(SITE + '/' + f[0], 'Copied ' + f[0] + ' URL', cb); });
      r.appendChild(cb);
      list.appendChild(r);
    });
    files.appendChild(list);

    var rules = section('Rules for agents');
    var ol = node('ol', 'doc-list');
    RULES.forEach(function (t) { ol.appendChild(node('li', '', t)); });
    rules.appendChild(ol);

    var ids = section('Ids, keys and links');
    var idl = node('ul', 'doc-list');
    [
      'Every display has an id like camp-randall/north-board; every zone adds its own slug: camp-randall/north-board/frame-left. Click any id on this site to copy it.',
      'Canvas keys (UPPER_SNAKE, shown in grey mono tags) are the ' + DATA.canvases.length + ' canvases production tools build against. They point at a display or zone and always match its size.',
      'Link to any board with ?v=<venue>#<id>, e.g. ' + SITE + '?v=kohl-center#kohl-center/360-fascia. Content types link as ?c=<id>.',
      'More on a zone copies it as JSON with its manifest version, or downloads an SVG or PNG guide at that zone’s exact pixel size.'
    ].forEach(function (t) { idl.appendChild(node('li', '', t)); });
    ids.appendChild(idl);

    var code = section('Snippets');
    SNIPPETS.forEach(function (sn) {
      var wrap = node('div', 'snippet');
      var head = node('div', 'snippet-head');
      head.appendChild(node('span', '', sn[0]));
      var cb = node('button', 'size', 'Copy');
      cb.type = 'button';
      cb.addEventListener('click', function () { copy(sn[1], 'Copied ' + sn[0] + ' snippet', cb); });
      head.appendChild(cb);
      wrap.appendChild(head);
      wrap.appendChild(node('pre', sn[0] === 'Agent prompt' ? 'wrap' : '', sn[1]));
      code.appendChild(wrap);
    });

    var ch = section('Changes');
    var cl = node('ul', 'doc-list changes');
    (DATA.changes || []).forEach(function (c) {
      var li = node('li');
      li.appendChild(node('span', 'pill mono', c.version));
      li.appendChild(document.createTextNode(' ' + c.summary));
      cl.appendChild(li);
    });
    ch.appendChild(cl);
  }

  function renderIssues() {
    pageHead('Reference', 'Open issues',
      OPEN_ISSUES.length + ' places where the sources disagree or leave something open. Agents see the same list in every record’s issues.');
    setActions([moreMenu(withShare([]), 'open issues')]);
    Object.keys(ISSUE_LABEL).forEach(function (kind) {
      var mine = OPEN_ISSUES.filter(function (x) { return x.issue.kind === kind; });
      if (!mine.length) return;
      var box = section(ISSUE_LABEL[kind], mine.length + ' · ' + kind);
      var list = node('div', 'zones');
      mine.forEach(function (x) {
        var id = x.z ? x.z.id : x.d.id;
        var r = node('div', 't-row issue-row');
        var ic = node('span', 'thumb warn-ico'); ic.appendChild(icon(ICONS.warn)); r.appendChild(ic);
        var nm = node('span', 't-name');
        var a = node('a', '', x.v.name + ' › ' + x.d.name + (x.z ? ' › ' + x.z.name : ''));
        a.href = '?v=' + x.v.id + (state.share ? '&share=1' : '') + '#' + id;
        a.addEventListener('click', function (e) { e.preventDefault(); goTo(id); });
        var b = node('b'); b.appendChild(a); nm.appendChild(b);
        nm.appendChild(node('span', 't-sub', x.issue.text));
        r.appendChild(nm);
        var item = x.z || x.d;
        r.appendChild(node('span', 'size static', pretty(item.w, item.h)));
        list.appendChild(r);
      });
      box.appendChild(list);
    });
  }

  /* ---------------- one board ---------------- */

  // Every zone of a board without positions, on the board's own scale (the
  // list is as wide as the drawing), packed left to right.
  function renderScale(d, card, show) {
    var rows = groupZones(d.zones).filter(function (r) { return !show || show(r) === 'show'; });
    var box = node('div', 'scale');
    box.appendChild(node('p', 'scale-head', 'Zones to scale'));
    var list = node('ul', 'scale-list');
    rows.forEach(function (row) {
      var li = node('li', 'scale-item');
      var keys = row.zones.map(function (x) { return d.name + '|' + x.n; });
      li.setAttribute('data-zone', keys[0]);
      var bar = node('button', 'scale-bar');
      bar.type = 'button';
      li.style.width = (row.w / d.w * 100) + '%';
      bar.style.setProperty('--aw', row.w);
      bar.style.setProperty('--ah', row.h);
      bar.setAttribute('aria-label', row.base + ', ' + size(row.w, row.h) + ': show in the list');
      bar.addEventListener('mouseenter', function () { hot(card, keys, true); });
      bar.addEventListener('mouseleave', function () { hot(card, keys, false); });
      bar.addEventListener('click', function () {
        pick(card, keys);
        var r = document.getElementById(row.first.id);
        if (r) r.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
      li.appendChild(bar);
      var cap = node('span', 'scale-cap');
      cap.appendChild(node('b', '', row.base));
      cap.appendChild(node('i', '', pretty(row.w, row.h)));
      li.appendChild(cap);
      list.appendChild(li);
    });
    box.appendChild(list);
    return box;
  }

  var FILTERS = [
    ['all', 'All', function () { return true; }],
    ['video', 'Video', function (z) { return !z.stillOnly; }],
    ['stills', 'Stills only', function (z) { return !!z.stillOnly; }],
    ['issues', 'Open issues', function (z, d) { return !!((z.issues && z.issues.length) || (d.issues && d.issues.length)); }]
  ];
  function neighbor(id, step) {
    var all = [];
    VENUES.forEach(function (v) { v.displays.forEach(function (d) { all.push(d); }); });
    var i = all.map(function (d) { return d.id; }).indexOf(id);
    return all[i + step] || null;
  }
  function chip(label, on, onClick, extra) {
    var b = node('button', 'chip', label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(!!on));
    if (extra != null) b.appendChild(node('span', 'chip-n', String(extra)));
    b.addEventListener('click', onClick);
    return b;
  }

  /* ---------------- newcomers: technical details, terms, guided start ---------------- */

  // Ids, canvas keys and processor names are for scripts and production
  // tools; most people only need sizes, so they stay hidden until asked for.
  function applyTech() {
    document.body.classList.toggle('hide-tech', !showTech);
    var b = document.getElementById('tech-toggle');
    if (b) b.setAttribute('aria-pressed', String(showTech));
  }
  function techToggle() {
    var li = node('li');
    var b = node('button');
    b.type = 'button';
    b.id = 'tech-toggle';
    b.className = 'tech-toggle';
    b.title = 'Show ids, canvas keys and processor names';
    b.appendChild(node('span', '', 'Technical details'));
    b.appendChild(node('span', 'switch'));
    b.addEventListener('click', function () {
      showTech = !showTech;
      storageSet(TECH_KEY, showTech ? '1' : '0');
      applyTech();
    });
    li.appendChild(b);
    return li;
  }

  function renderTerms() {
    pageHead('Reference', 'Board terms', 'Venue words used across these boards.');
    setActions([moreMenu(withShare([]), 'board terms')]);
    var box = section('Terms');
    var list = node('dl', 'terms');
    TERMS.forEach(function (t) {
      list.appendChild(node('dt', '', t[0]));
      list.appendChild(node('dd', '', t[2]));
    });
    box.appendChild(list);
  }

  // "What are you making?": the mapped content types, as a start for people
  // who know what they're building but not which boards it needs.
  function renderStart(v) {
    var box = node('section', 'start');
    box.setAttribute('aria-label', 'What are you making?');
    var head = node('div', 'start-head');
    head.appendChild(node('h2', '', 'What are you making?'));
    var sub = node('p', '', 'Pick one to see every board and size it needs. ');
    var tl = node('a', '', 'Board terms');
    tl.href = '?p=terms' + (state.share ? '&share=1' : '');
    tl.addEventListener('click', function (e) { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); openPage('terms'); });
    sub.appendChild(tl);
    head.appendChild(sub);
    box.appendChild(head);
    var row = node('div', 'start-row');
    function startLink(c, cls) {
      var a = node('a', 'start-item' + (cls ? ' ' + cls : ''));
      a.href = '?c=' + encodeURIComponent(c.id) + (state.share ? '&share=1' : '');
      a.appendChild(node('b', '', c.name));
      var n = canvasCount(c);
      a.appendChild(node('i', '', n + ' canvas' + (n === 1 ? '' : 'es')));
      a.addEventListener('click', function (e) { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); openContent(c.id); });
      return a;
    }
    DATA.content.broad.forEach(function (c) {
      if (contentRows(c).some(function (r) { return r.v.id === v.id; })) row.appendChild(startLink(c));
    });
    var games = DATA.content.gameDay.filter(function (g) {
      return g.items.some(function (c) { return contentRows(c).some(function (r) { return r.v.id === v.id; }); });
    });
    if (games.length) {
      var det = node('details', 'start-more');
      var sum = node('summary', 'start-item');
      sum.appendChild(node('b', '', 'Game day pieces'));
      var count = games.reduce(function (n, g) { return n + g.items.length; }, 0);
      sum.appendChild(node('i', '', count + ' pieces'));
      det.appendChild(sum);
      var pop = node('div', 'start-games');
      games.forEach(function (g) {
        var grp = node('div', 'start-group');
        grp.appendChild(node('h3', '', g.name));
        g.items.forEach(function (c) { grp.appendChild(startLink(c, 'is-small')); });
        pop.appendChild(grp);
      });
      det.appendChild(pop);
      row.appendChild(det);
    }
    if (!row.childNodes.length) return null;
    box.appendChild(row);
    return box;
  }
  // Content types whose name has every search word, shown above the boards.
  function contentHits(query) {
    var words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length || /^\d/.test(words[0])) return [];
    return Object.keys(CONTENT).map(function (id) { return CONTENT[id]; }).filter(function (c) {
      var name = c.name.toLowerCase();
      return words.every(function (w) { return name.indexOf(w) !== -1; });
    }).slice(0, 6);
  }

  /* ---------------- art preview ---------------- */

  // Images and videos dropped, pasted or picked in the board view, drawn on
  // the board at true scale. Several pieces can sit on one board at once (a
  // main video, wings and ads), each placed by its size or pinned to a zone.
  // Nothing leaves the browser: each piece is a blob: URL, revoked when it is
  // removed, and the set stays while you move between boards.
  var arts = [];
  var artSeq = 0;
  var artZones = true;
  var MAX_ART = 12;
  var MAX_IMAGE_BYTES = 80 * 1024 * 1024;
  var artInput = document.createElement('input');
  artInput.type = 'file';
  artInput.accept = 'image/*,video/mp4,video/webm,video/quicktime';
  artInput.multiple = true;
  artInput.hidden = true;
  artInput.addEventListener('change', function () { if (artInput.files) addArt(artInput.files); artInput.value = ''; });
  document.body.appendChild(artInput);
  function pickArt() { artInput.click(); }
  // Art goes on a board view, or is checked against a content type's canvases.
  function artView() { return !!((state.display || state.content) && !state.query && !state.page); }
  function isVideo(file) { return /^video\//.test(file.type || '') || /\.(mp4|m4v|webm|mov)$/i.test(file.name || ''); }
  // Adds files in the order given; pin (optional) is a zone row on the open
  // board, for a piece dropped onto that zone.
  function addArt(files, pin) {
    files = Array.prototype.slice.call(files);
    var usable = files.filter(function (f) { return /^image\//.test(f.type || '') || isVideo(f); });
    if (!usable.length) { toast('That isn’t an image or video. Try a PNG, JPEG, WebP or MP4.'); return; }
    if (arts.length + usable.length > MAX_ART) { toast('Up to ' + MAX_ART + ' pieces at once. Remove some first.'); usable = usable.slice(0, Math.max(0, MAX_ART - arts.length)); }
    usable.forEach(function (file) { loadArt(file, usable.length === 1 ? pin : null); });
  }
  function loadArt(file, pin) {
    var video = isVideo(file);
    if (!video && file.size > MAX_IMAGE_BYTES) { toast(file.name + ' is over 80 MB.'); return; }
    var url = URL.createObjectURL(file);
    var name = file.name || (video ? 'Pasted video' : 'Pasted image');
    function fail() { URL.revokeObjectURL(url); toast(video ? 'This browser can’t play ' + name + '. Try an H.264 MP4 or WebM.' : 'Couldn’t read ' + name + '.'); }
    function done(media, w, h) {
      if (!w || !h) { fail(); return; }
      // A piece pinned to a zone replaces whatever was pinned there before.
      if (pin) arts.filter(function (a) { return a.pin && a.pin.d === pin.d && a.pin.row === pin.row; }).forEach(function (a) { dropArt(a, true); });
      arts.push({ id: ++artSeq, url: url, name: name, w: w, h: h, video: video, media: media, pin: pin || null });
      if (artView()) render(false);
    }
    if (video) {
      var v = document.createElement('video');
      v.muted = true; v.preload = 'auto'; v.playsInline = true;
      v.onloadeddata = function () { done(v, v.videoWidth, v.videoHeight); };
      v.onerror = fail;
      v.src = url;
    } else {
      var img = new Image();
      img.onload = function () { done(img, img.naturalWidth, img.naturalHeight); };
      img.onerror = fail;
      img.src = url;
    }
  }
  function dropArt(a, quiet) {
    URL.revokeObjectURL(a.url);
    arts = arts.filter(function (x) { return x !== a; });
    if (!quiet && artView()) render(false);
  }
  function clearArt() {
    arts.forEach(function (a) { URL.revokeObjectURL(a.url); });
    arts = [];
    if (artView()) render(false);
  }
  function sameShape(aw, ah, bw, bh) { return aw * bh === ah * bw; }
  function artRows(d) { return groupZones(d.zones).filter(function (r) { return !(r.w === d.w && r.h === d.h); }); }
  // Where every piece goes on this board, in drawing order (whole-board
  // pieces first, zone pieces over them):
  // 1. a piece pinned to a zone goes there, stretched if it's the wrong size;
  // 2. a piece at a zone's exact size takes every free zone of that size, and
  //    pieces of the same size share them in turn (left wing, right wing);
  // 3. then the whole board at its exact size, the same shape as the board or
  //    a zone at another scale, or scaled to fit and flagged.
  // When two pieces claim the same spot the later one is drawn and the
  // earlier one says so.
  function placeArts(d) {
    var rows = artRows(d);
    function hasAt(row) { return !!(row.first.at && row.first.at.length); }
    function fit(a) {
      var sc = Math.min(d.w / a.w, d.h / a.h), w = Math.round(a.w * sc), h = Math.round(a.h * sc);
      return [{ x: Math.round((d.w - w) / 2), y: Math.round((d.h - h) / 2), w: w, h: h }];
    }
    // Zones with no position on file (most indoor boards) still match by size;
    // the art is drawn fit to the board and the note says why.
    function at(a, list) {
      if (!list.every(hasAt)) return fit(a);
      return [].concat.apply([], list.map(function (row) { return row.first.at.map(function (p) { return { x: p.x, y: p.y, w: row.w, h: row.h }; }); }));
    }
    function names(list) {
      var n = list.map(function (r) { return r.base; });
      var s = n.length > 2 ? n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1] : n.join(' and ');
      var count = list.reduce(function (k, r) { return k + (hasAt(r) ? r.first.at.length : 1); }, 0);
      if (!list.every(hasAt)) return s + ' (no position on file, shown fit to the board)';
      return s + (count > list.length ? ' (' + count + ' placements)' : '');
    }
    var out = arts.map(function (a) { return { art: a }; });
    var taken = {};
    out.forEach(function (p) {
      var a = p.art;
      var row = a.pin && a.pin.d === d.id && rows.filter(function (r) { return r.first.id === a.pin.row; })[0];
      if (!row) return;
      var exact = a.w === row.w && a.h === row.h;
      p.rows = [row]; p.zone = true; p.ok = exact;
      p.note = exact ? 'Exact size for ' + names([row]) + '.' : 'Stretched onto ' + names([row]) + '. Build at ' + pretty(row.w, row.h) + '.';
      taken[row.first.id] = p;
    });
    var bySize = {};
    out.forEach(function (p) {
      if (p.rows) return;
      var a = p.art;
      if (!rows.some(function (r) { return r.w === a.w && r.h === a.h; })) return;
      (bySize[a.w + 'x' + a.h] = bySize[a.w + 'x' + a.h] || []).push(p);
    });
    Object.keys(bySize).forEach(function (k) {
      var group = bySize[k], a0 = group[0].art;
      var free = rows.filter(function (r) { return r.w === a0.w && r.h === a0.h && !taken[r.first.id]; });
      group.forEach(function (p, i) {
        var mine = free.filter(function (r, j) { return j % group.length === i; });
        p.zone = true;
        if (!mine.length) { p.rows = []; p.hidden = true; p.ok = false; p.note = 'Every ' + pretty(a0.w, a0.h) + ' zone already has a piece.'; return; }
        p.rows = mine; p.ok = true; p.note = 'Exact size for ' + names(mine) + '.';
        mine.forEach(function (r) { taken[r.first.id] = p; });
      });
    });
    var boardPiece = null;
    out.forEach(function (p) {
      if (p.rows) return;
      var a = p.art;
      if (a.w === d.w && a.h === d.h) {
        if (boardPiece) { boardPiece.hidden = true; boardPiece.ok = false; boardPiece.note = 'Covered by ' + a.name + '.'; }
        boardPiece = p; p.places = [{ x: 0, y: 0, w: d.w, h: d.h }]; p.ok = true; p.note = 'Exact size for this board.'; return;
      }
      if (sameShape(a.w, a.h, d.w, d.h)) { p.places = [{ x: 0, y: 0, w: d.w, h: d.h }]; p.ok = false; p.note = 'Same shape as the board at ' + Math.round(a.w / d.w * 100) + '% size. Build at ' + pretty(d.w, d.h) + '.'; return; }
      var shape = rows.filter(function (r) { return sameShape(a.w, a.h, r.w, r.h) && !taken[r.first.id]; })[0];
      if (shape) { p.rows = [shape]; p.zone = true; p.ok = false; p.note = 'Same shape as ' + names([shape]) + ' at ' + Math.round(a.w / shape.w * 100) + '% size. Build at ' + pretty(shape.w, shape.h) + '.'; taken[shape.first.id] = p; return; }
      p.places = fit(a); p.ok = false; p.note = 'Not a size on this board, so it’s scaled to fit. Build at ' + pretty(d.w, d.h) + '.';
    });
    out.forEach(function (p) { if (!p.places) p.places = p.rows && p.rows.length ? at(p.art, p.rows) : []; });
    // Larger zones first, so an ad over a wing (the same space in another
    // layout) is drawn on top, as the hit areas are.
    function area(p) { return p.places.reduce(function (n, r) { return Math.max(n, r.w * r.h); }, 0); }
    var zoned = out.filter(function (p) { return p.zone; }).sort(function (a, b) { return area(b) - area(a); });
    return out.filter(function (p) { return !p.zone; }).concat(zoned);
  }
  function artThumb(a) {
    var t = node('span', 'art-thumb');
    if (a.video) {
      var v = document.createElement('video');
      v.muted = true; v.preload = 'metadata'; v.src = a.url + '#t=0.1';
      v.setAttribute('aria-hidden', 'true');
      t.appendChild(v);
      t.appendChild(node('span', 'art-kind', 'Video'));
    } else {
      t.style.backgroundImage = 'url("' + a.url + '")';
    }
    return t;
  }
  function artTray(v, d, placed) {
    var box = node('section', 'art-tray');
    box.setAttribute('aria-label', 'Preview art');
    var head = node('div', 'art-head');
    var off = placed.filter(function (p) { return !p.ok; }).length;
    var title = node('span', 'art-title');
    title.appendChild(node('b', '', 'Preview art'));
    title.appendChild(node('span', 'art-sum', placed.length + (placed.length === 1 ? ' piece' : ' pieces') + (off ? ' · ' + off + ' to check' : ' · all exact')));
    head.appendChild(title);
    var tools = node('span', 'art-tools');
    tools.appendChild(chip('Zones', artZones, function () { artZones = !artZones; render(false); }));
    var add = button('Add', 'plus', pickArt); add.classList.add('ghost'); tools.appendChild(add);
    var mk = button('Mockup PNG', 'download', function () { downloadMockup(v, d, placed); }); mk.classList.add('ghost'); tools.appendChild(mk);
    var xb = button('Clear', null, clearArt); xb.classList.add('ghost'); tools.appendChild(xb);
    head.appendChild(tools);
    box.appendChild(head);
    var list = node('ul', 'art-list');
    var rows = artRows(d);
    // Listed in the order they were added, not the drawing order.
    arts.forEach(function (a) {
      var p = placed.filter(function (x) { return x.art === a; })[0];
      var li = node('li', 'art-item' + (p.ok ? '' : ' is-off'));
      li.appendChild(artThumb(a));
      var text = node('span', 'art-text');
      var nm = node('b', '', a.name);
      nm.title = a.name;
      text.appendChild(nm);
      text.appendChild(node('i', '', pretty(a.w, a.h)));
      text.appendChild(node('span', 'art-note', p.note));
      li.appendChild(text);
      // Place on: automatic by size, or pinned to one of this board's zones.
      var sel = node('select', 'art-place');
      sel.setAttribute('aria-label', 'Place ' + a.name);
      sel.appendChild(new Option('By size', ''));
      rows.forEach(function (r) { sel.appendChild(new Option(r.base + ' · ' + size(r.w, r.h), r.first.id)); });
      sel.value = a.pin && a.pin.d === d.id ? a.pin.row : '';
      sel.addEventListener('change', function () { a.pin = sel.value ? { d: d.id, row: sel.value } : null; render(false); });
      li.appendChild(sel);
      var rm = node('button', 'btn icon-only ghost art-rm');
      rm.type = 'button';
      rm.setAttribute('aria-label', 'Remove ' + a.name);
      rm.title = 'Remove';
      rm.appendChild(icon(ICONS.close));
      rm.addEventListener('click', function () { dropArt(a); });
      li.appendChild(rm);
      list.appendChild(li);
    });
    box.appendChild(list);
    return box;
  }
  // On a content type's page the same pieces become an exports check: each
  // canvas is covered by a piece at its exact size or still missing, and a
  // piece that fits nothing here says so.
  function exportFor(r) { return arts.filter(function (a) { return a.w === r.w && a.h === r.h; }).pop() || null; }
  function exportsTray(rows) {
    if (!arts.length) {
      var hint = node('button', 'art-empty');
      hint.type = 'button';
      hint.appendChild(icon(ICONS.image));
      var t = node('span');
      t.appendChild(node('b', '', 'Check your exports'));
      t.appendChild(node('span', '', 'Drop or pick your renders to see which canvases are covered and which are still missing. They stay on this device.'));
      hint.appendChild(t);
      hint.addEventListener('click', pickArt);
      return hint;
    }
    var covered = rows.filter(exportFor).length;
    var stray = arts.filter(function (a) { return !rows.some(function (r) { return r.w === a.w && r.h === a.h; }); }).length;
    var box = node('section', 'art-tray');
    box.setAttribute('aria-label', 'Your exports');
    var head = node('div', 'art-head');
    var title = node('span', 'art-title');
    title.appendChild(node('b', '', 'Your exports'));
    title.appendChild(node('span', 'art-sum', covered + ' of ' + rows.length + ' canvases covered' + (stray ? ' · ' + stray + ' to check' : '')));
    head.appendChild(title);
    var tools = node('span', 'art-tools');
    var add = button('Add', 'plus', pickArt); add.classList.add('ghost'); tools.appendChild(add);
    var xb = button('Clear', null, clearArt); xb.classList.add('ghost'); tools.appendChild(xb);
    head.appendChild(tools);
    box.appendChild(head);
    var meter = node('div', 'art-meter' + (covered === rows.length ? ' is-done' : ''));
    meter.setAttribute('role', 'progressbar');
    meter.setAttribute('aria-label', 'Canvases covered');
    meter.setAttribute('aria-valuemin', '0');
    meter.setAttribute('aria-valuemax', String(rows.length));
    meter.setAttribute('aria-valuenow', String(covered));
    var fill = node('span');
    fill.style.width = (rows.length ? covered / rows.length * 100 : 0) + '%';
    meter.appendChild(fill);
    box.appendChild(meter);
    var list = node('ul', 'art-list');
    arts.forEach(function (a) {
      var fits = rows.filter(function (r) { return exportFor(r) === a; });
      var same = rows.filter(function (r) { return r.w === a.w && r.h === a.h; });
      var shape = rows.filter(function (r) { return sameShape(a.w, a.h, r.w, r.h); })[0];
      var note = fits.length ? 'Covers ' + fits[0].label + (fits.length > 1 ? ' and ' + (fits.length - 1) + ' more' : '') + '.'
        : same.length ? 'Same size as a later piece, which is used instead.'
        : shape ? 'No canvas here is this size. Same shape as ' + shape.label + ': build at ' + pretty(shape.w, shape.h) + '.'
        : 'No canvas here is this size.';
      var li = node('li', 'art-item is-compact' + (fits.length ? '' : ' is-off'));
      li.appendChild(artThumb(a));
      var text = node('span', 'art-text');
      var nm = node('b', '', a.name);
      nm.title = a.name;
      text.appendChild(nm);
      text.appendChild(node('i', '', pretty(a.w, a.h)));
      text.appendChild(node('span', 'art-note', note));
      li.appendChild(text);
      var rm = node('button', 'btn icon-only ghost art-rm');
      rm.type = 'button';
      rm.setAttribute('aria-label', 'Remove ' + a.name);
      rm.title = 'Remove';
      rm.appendChild(icon(ICONS.close));
      rm.addEventListener('click', function () { dropArt(a); });
      li.appendChild(rm);
      list.appendChild(li);
    });
    box.appendChild(list);
    return box;
  }
  function exportStatus(r) {
    var a = exportFor(r);
    var s = node('span', 't-art' + (a ? ' is-ok' : ' is-missing'));
    if (a) {
      var th = artThumb(a);
      th.classList.add('is-tiny');
      s.appendChild(th);
      var nm = node('span', 't-art-name', a.name);
      s.title = a.name;
      s.appendChild(nm);
    } else {
      s.appendChild(node('span', '', 'Missing'));
    }
    return s;
  }
  // The board with every piece on it, as the board shows it (crops and
  // scrims blacked out), for sending round before a render. Videos give the
  // frame they're on.
  function downloadMockup(v, d, placed) {
    var sc = Math.min(1, 4096 / d.w, 4096 / d.h);
    var cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(d.w * sc)); cv.height = Math.max(1, Math.round(d.h * sc));
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.scale(sc, sc);
    placed.forEach(function (p) {
      if (p.hidden) return;
      p.places.forEach(function (r) { try { ctx.drawImage(p.art.media, r.x, r.y, r.w, r.h); } catch (e) { /* a video with no frame yet */ } });
    });
    (d.overlays || []).forEach(function (o) {
      if (o.kind !== 'crop' && o.kind !== 'scrim') return;
      ctx.fillStyle = o.kind === 'crop' ? '#000' : 'rgba(0,0,0,.6)';
      ctx.fillRect(o.x, o.y, o.w, o.h);
    });
    var name = 'board-sizes_' + d.id.replace(/\//g, '_') + '_mockup.png';
    cv.toBlob(function (blob) {
      if (!blob) { toast('Couldn’t make the mockup.'); return; }
      download(name, blob, 'image/png');
      toast('Downloaded ' + name);
    }, 'image/png');
  }
  function boardComps(v, d) {
    var rows = [{ v: v, d: d, label: d.name, w: d.w, h: d.h, count: 1 }];
    groupZones(d.zones).forEach(function (row) {
      if (rows.some(function (r) { return r.w === row.w && r.h === row.h; })) {
        var same = rows.filter(function (r) { return r.w === row.w && r.h === row.h && r !== rows[0]; })[0];
        if (same) same.label += ' / ' + row.base;
        return;
      }
      rows.push({ v: v, d: d, label: d.name + ' › ' + row.base, w: row.w, h: row.h, count: 1 });
    });
    return rows;
  }

  function renderBoard(v, d) {
    el.crumbs.textContent = '';
    var back = node('a', 'crumb-link', v.name);
    back.href = '?v=' + v.id + (state.share ? '&share=1' : '');
    back.addEventListener('click', function (e) { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); go({ venue: v.id }); });
    el.crumbs.appendChild(back);
    if (d.group) el.crumbs.appendChild(document.createTextNode(' · ' + d.group));
    el.title.textContent = d.name;
    el.subtitle.textContent = [pretty(d.w, d.h) + ' px', ratio(d.w, d.h), d.zones.length + ' zone' + (d.zones.length === 1 ? '' : 's'), d.processor].filter(Boolean).join(' · ');
    el.props.hidden = true;
    el.props.textContent = '';
    el.summary.textContent = '';
    el.empty.hidden = true;

    var prev = neighbor(d.id, -1), next = neighbor(d.id, 1);
    var acts = [];
    var pager = node('span', 'pager');
    [[prev, 'prev', 'Previous board', '←'], [next, 'next', 'Next board', '→']].forEach(function (x) {
      var b = node('button', 'btn pager-btn');
      b.type = 'button';
      b.appendChild(icon(ICONS[x[1]]));
      b.disabled = !x[0];
      b.title = x[0] ? x[2] + ': ' + x[0].name + ' (' + x[3] + ')' : x[2];
      b.setAttribute('aria-label', b.title);
      if (x[0]) b.addEventListener('click', function () { openBoard(x[0].id); });
      pager.appendChild(b);
    });
    acts.push(pager);
    var ab = button('Preview art', 'image', pickArt, 'art-btn');
    ab.title = 'Preview images or videos on this board. They stay on this device.';
    acts.push(ab);
    acts.push(button('Copy spec', 'copy', function () { copy(specText(v, d, null), 'Copied ' + d.name); }, 'primary'));
    acts.push(moreMenu(withShare([
      { label: 'Guide SVG', icon: 'image', onClick: function () { downloadSvg(Object.assign({}, guideOpts(v, d, null), { filename: guideName(v, d, null, 'svg') })); } },
      { label: 'Guide PNG', icon: 'image', onClick: function () { downloadGuide(guideOpts(v, d, null)); } },
      { label: 'Download CSV', icon: 'download', onClick: function () {
        var filename = 'board-sizes_' + d.id.replace(/\//g, '_') + '.csv';
        var table = displaysCsv(null, d);
        download(filename, toCsv(table), 'text/csv');
        toast('Downloaded ' + filename + ' (' + (table.length - 1) + ' rows)');
      } },
      { label: 'AE comps script', icon: 'ae', onClick: function () {
        var rows = boardComps(v, d);
        var name = 'board-sizes_' + d.id.replace(/\//g, '_') + '.jsx';
        download(name, aeScript({ name: v.name + ' ' + d.name, board: true }, rows), 'text/plain');
        toast('Downloaded ' + name + ' (' + rows.length + ' comps)');
      } },
      { label: 'Copy id', icon: 'copy', onClick: function () { copy(d.id, 'Copied ' + d.id); } }
    ]), d.name));
    setActions(acts);

    var layout = state.layout && (d.layouts || []).filter(function (l) { return l.id === state.layout; })[0];
    var inLayout = layout ? function (row) { return row.zones.some(function (z) { return layout.zones.indexOf(z.id) !== -1; }); } : null;
    var filter = FILTERS.filter(function (f) { return f[0] === state.filter; })[0] || FILTERS[0];
    function show(row) {
      if (inLayout && !inLayout(row)) return 'hide';
      return filter[2](row.first, d) ? 'show' : 'dim';
    }

    el.view.textContent = '';
    var bar = node('div', 'board-bar');
    if (d.layouts && d.layouts.length) {
      var lg = node('div', 'chips');
      lg.setAttribute('role', 'group');
      lg.setAttribute('aria-label', 'Layouts');
      lg.appendChild(node('span', 'chips-label', 'Layout'));
      lg.appendChild(chip('All zones', !layout, function () { state.layout = null; render(false); }));
      d.layouts.forEach(function (l) {
        var c = chip(l.name, layout === l, function () { state.layout = l.id; render(false); });
        if (l.draft) c.title = 'Draft: inferred from zone geometry, not yet confirmed';
        lg.appendChild(c);
      });
      if (d.layouts.some(function (l) { return l.draft; })) {
        var dt = node('span', 'tag draft-tag', 'Draft');
        dt.title = 'Layouts inferred from zone geometry; confirm them, then drop draft in boards.json';
        lg.appendChild(dt);
      }
      bar.appendChild(lg);
    }
    var rowsAll = groupZones(d.zones).filter(function (row) { return !inLayout || inLayout(row); });
    var fg = node('div', 'chips');
    fg.setAttribute('role', 'group');
    fg.setAttribute('aria-label', 'Filter zones');
    fg.appendChild(node('span', 'chips-label', 'Show'));
    FILTERS.forEach(function (f) {
      var n = rowsAll.filter(function (row) { return f[2](row.first, d); }).length;
      if (f[0] !== 'all' && (!n || n === rowsAll.length)) return;
      fg.appendChild(chip(f[1], filter === f, function () { state.filter = f[0]; render(false); }, n));
    });
    if (fg.querySelectorAll('.chip').length > 1) bar.appendChild(fg);
    var placed = arts.length ? placeArts(d) : null;
    if (bar.childNodes.length) el.view.appendChild(bar);
    if (placed) el.view.appendChild(artTray(v, d, placed));
    el.view.appendChild(renderDisplay(v, d, null, false, { board: true, show: show, art: placed }).el);
  }

  /* ---------------- venue + search views ---------------- */

  function renderVenue(v, match) {
    el.crumbs.textContent = match ? 'Search' : '';
    el.props.hidden = true;
    var zones = 0;
    v.displays.forEach(function (d) { zones += d.zones.length; });
    el.title.textContent = match ? '“' + state.query.trim() + '”' : v.name;
    el.subtitle.textContent = match ? 'Matches across every venue.' : v.displays.length + ' display' + (v.displays.length === 1 ? '' : 's') + ' · ' + zones + ' zone' + (zones === 1 ? '' : 's');
    setActions([moreMenu(withShare([
      { label: 'Download CSV', icon: 'download', onClick: function () {
        var filename = match ? 'board-sizes_search.csv' : 'board-sizes_' + v.id + '.csv';
        var table = displaysCsv(match);
        download(filename, toCsv(table), 'text/csv');
        toast('Downloaded ' + filename + ' (' + (table.length - 1) + ' rows)');
      } }
    ]), match ? 'search results' : v.name)]);

    function hasIssue(d) { return !!((d.issues && d.issues.length) || d.zones.some(function (z) { return z.issues && z.issues.length; })); }
    function searchHit(venue, d) {
      if (!match) return true;
      if (match.display(d, venue)) return true;
      return d.zones.some(function (z) { return match.zone(z, d, venue); });
    }
    el.view.textContent = '';
    var filters = node('div', 'chips');
    filters.setAttribute('role', 'group');
    if (match) {
      var hits = VENUES.map(function (venue) {
        return { id: venue.id, name: venue.name, n: venue.displays.filter(function (d) { return searchHit(venue, d); }).length };
      }).filter(function (h) { return h.n; });
      var allN = hits.reduce(function (s, h) { return s + h.n; }, 0);
      var issueN = 0;
      VENUES.forEach(function (venue) { venue.displays.forEach(function (d) { if (searchHit(venue, d) && hasIssue(d)) issueN++; }); });
      if (state.narrow && state.narrow !== 'issues' && !hits.some(function (h) { return h.id === state.narrow; })) state.narrow = '';
      filters.setAttribute('aria-label', 'Filter search results');
      filters.appendChild(chip('All venues', !state.narrow, function () { state.narrow = ''; render(false); }, allN));
      hits.forEach(function (h) { filters.appendChild(chip(h.name, state.narrow === h.id, function () { state.narrow = h.id; render(false); }, h.n)); });
      if (issueN) filters.appendChild(chip('Open issues', state.narrow === 'issues', function () { state.narrow = 'issues'; render(false); }, issueN));
      el.view.appendChild(filters);
    } else if (v.displays.some(hasIssue)) {
      filters.setAttribute('aria-label', 'Filter displays');
      filters.appendChild(chip('All displays', state.venueFilter !== 'issues', function () { state.venueFilter = 'all'; render(false); }, v.displays.length));
      filters.appendChild(chip('Open issues', state.venueFilter === 'issues', function () { state.venueFilter = 'issues'; render(false); }, v.displays.filter(hasIssue).length));
      el.view.appendChild(filters);
    }
    if (!match && state.venueFilter !== 'issues') { var start = renderStart(v); if (start) el.view.appendChild(start); }
    if (match) {
      var made = contentHits(state.query);
      if (made.length) {
        var mk = node('div', 'chips made');
        mk.setAttribute('role', 'group');
        mk.setAttribute('aria-label', 'Content that matches');
        mk.appendChild(node('span', 'chips-label', 'Making'));
        made.forEach(function (c) {
          var a = node('a', 'chip', c.name);
          a.href = '?c=' + encodeURIComponent(c.id);
          a.addEventListener('click', function (e) { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); openContent(c.id); });
          mk.appendChild(a);
        });
        el.view.appendChild(mk);
      }
    }
    if (!match && v.displays.length > 1 && state.venueFilter !== 'issues') el.view.appendChild(renderOverview(v));
    var shownDisplays = 0, shownZones = 0;
    (match ? VENUES : [v]).forEach(function (venue) {
      if (match && state.narrow && state.narrow !== 'issues' && venue.id !== state.narrow) return;
      var first = true, group = null;
      venue.displays.forEach(function (d) {
        if (match && state.narrow === 'issues' && !hasIssue(d)) return;
        if (!match && state.venueFilter === 'issues' && !hasIssue(d)) return;
        var out = renderDisplay(venue, d, match, false);
        if (!out) return;
        if (match && first) { el.view.appendChild(node('h2', 'group-title', venue.name)); first = false; }
        if (!match && d.group && d.group !== group) el.view.appendChild(node('h2', 'group-title', d.group));
        group = d.group || null;
        el.view.appendChild(out.el);
        shownDisplays++; shownZones += out.zones;
      });
    });
    el.empty.textContent = match ? 'Nothing matches that. Try a board name like “Fascia” or a size like 1920x1080.' : 'No displays with open issues at this venue.';
    el.empty.hidden = shownDisplays > 0;
    el.summary.textContent = match ? shownDisplays + ' display' + (shownDisplays === 1 ? '' : 's') + ', ' + shownZones + ' zone' + (shownZones === 1 ? '' : 's') : '';
  }

  /* ---------------- page ---------------- */

  function currentParams() {
    var p = new URLSearchParams();
    if (state.query.trim()) {
      p.set('q', state.query.trim());
      if (state.narrow) p.set('n', state.narrow);
    }
    else if (state.page) p.set('p', state.page);
    else if (state.content) p.set('c', state.content);
    else if (state.display) { p.set('d', state.display); if (state.layout) p.set('l', state.layout); }
    else {
      p.set('v', state.venue);
      if (state.venueFilter === 'issues') p.set('f', 'issues');
    }
    return p;
  }
  function syncUrl(push) {
    try {
      var p = currentParams();
      if (state.share) p.set('share', '1');
      var url = window.location.pathname + '?' + p.toString();
      if (push && url !== window.location.pathname + window.location.search) window.history.pushState(null, '', url);
      else window.history.replaceState(null, '', url + (push ? '' : window.location.hash));
    } catch (e) { /* file:// */ }
  }

  function render(scrollTop, push) {
    renderNav();
    var match = matcher(state.query);
    if (!match && state.display) renderBoard(BY_ID[state.display].v, BY_ID[state.display].d);
    else if (!match && state.page === 'agents') renderAgents();
    else if (!match && state.page === 'issues') renderIssues();
    else if (!match && state.page === 'terms') renderTerms();
    else if (!match && state.content && CONTENT[state.content]) renderContent(CONTENT[state.content]);
    else renderVenue(venueById[state.venue], match);
    document.body.classList.toggle('is-board-view', !match && !!state.display);
    document.title = el.title.textContent + ' · Board Sizes';
    syncUrl(push);
    if (scrollTop) window.scrollTo(0, 0);
  }

  el.footnote.textContent = 'Manifest ' + DATA.version + ' (updated ' + DATA.updated + '). Copy spec includes the size, aspect ratio, and any safe area the manifest records. Red notes are open questions.';

  var searchTimer = null;
  el.search.value = state.query;
  el.search.addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { state.query = el.search.value; render(false); }, 120);
  });
  el.search.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter') return;
    var q = el.search.value.trim();
    var id = BY_ID[q] ? q : KEY_ID[q.toUpperCase()];
    if (!id) return;
    event.preventDefault();
    el.search.blur();
    if (isDisplay(id)) openBoard(id);
    else { openBoard(BY_ID[id].d.id); goTo(id, true, false); }
  });
  // Phones fold the reference links into a menu beside the brand.
  function closeTopMenu(focusToggle) {
    if (!el['top-links'].classList.contains('is-open')) return false;
    el['top-links'].classList.remove('is-open');
    el['menu-toggle'].setAttribute('aria-expanded', 'false');
    if (focusToggle) el['menu-toggle'].focus();
    return true;
  }
  el['menu-toggle'].addEventListener('click', function (e) {
    e.stopPropagation();
    var open = !el['top-links'].classList.contains('is-open');
    el['top-links'].classList.toggle('is-open', open);
    el['menu-toggle'].setAttribute('aria-expanded', String(open));
    if (open) { var first = el['top-links'].querySelector('button, a'); if (first) first.focus(); }
  });
  // Tabbing out of the phone menu closes it, like a click outside does.
  el['top-links'].addEventListener('focusout', function (e) {
    if (e.relatedTarget && !el['top-links'].contains(e.relatedTarget) && e.relatedTarget !== el['menu-toggle']) closeTopMenu();
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('details.menu')) closeMenus();
    if (!e.target.closest || !e.target.closest('#top-links')) closeTopMenu();
  });
  window.addEventListener('scroll', function () { closeMenus(); }, true);
  document.addEventListener('keydown', function (event) {
    var typing = /^(input|textarea|select)$/i.test((event.target.tagName || ''));
    if (event.key === '/' && !typing) { event.preventDefault(); el.search.focus(); el.search.select(); }
    else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && (document.activeElement === document.body || !document.activeElement) && state.display && !state.query && !event.metaKey && !event.altKey) {
      var nb = neighbor(state.display, event.key === 'ArrowLeft' ? -1 : 1);
      if (nb) { event.preventDefault(); openBoard(nb.id); }
    }
    else if (event.key === 'Escape') {
      if (closeTopMenu(true)) return;
      if (document.querySelector('details.menu[open]')) closeMenus();
      else if (document.querySelector('.is-picked') && document.activeElement !== el.search) clearPicks();
      else if (document.activeElement === el.search && el.search.value) { clearSearch(); render(false); }
    }
  });

  // Drop an image anywhere in the board view (the drawing lights up), or
  // paste one. Outside the board view a dropped file is ignored rather than
  // letting the browser navigate away to it.
  function hasFiles(e) { return !!(e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1); }
  var dragDepth = 0;
  document.addEventListener('dragenter', function (e) { if (!hasFiles(e)) return; dragDepth++; if (artView()) document.body.classList.add('is-dragging'); });
  document.addEventListener('dragleave', function (e) { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) { document.body.classList.remove('is-dragging'); clearDropZone(); } });
  document.addEventListener('dragover', function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = artView() ? 'copy' : 'none';
    var hit = e.target.closest && e.target.closest('.is-board-view .zone-hit');
    if (hit && hit.classList.contains('is-drop')) return;
    clearDropZone();
    if (hit) hit.classList.add('is-drop');
  });
  document.addEventListener('drop', function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('is-dragging');
    clearDropZone();
    if (!artView() || !e.dataTransfer.files.length) return;
    var hit = e.target.closest && e.target.closest('.is-board-view .zone-hit');
    addArt(e.dataTransfer.files, hit && state.display ? { d: state.display, row: hit.getAttribute('data-row') } : null);
  });
  // While dragging, light up the zone a drop would pin to.
  function clearDropZone() { var o = document.querySelector('.zone-hit.is-drop'); if (o) o.classList.remove('is-drop'); }
  document.addEventListener('paste', function (e) {
    if (!artView() || /^(input|textarea)$/i.test(e.target.tagName || '')) return;
    var items = Array.prototype.slice.call((e.clipboardData && e.clipboardData.files) || []).filter(function (f) { return /^image\//.test(f.type) || isVideo(f); });
    if (items.length) { e.preventDefault(); addArt(items); }
  });

  var initialHash = safeDecode(window.location.hash.slice(1));
  // Draw the requested view first, so a #zone on the open board only scrolls to it.
  render(false);
  if (initialHash && !state.query && !state.content && !state.page) goTo(initialHash, false, false);
  window.addEventListener('popstate', function () {
    readParams();
    el.search.value = state.query;
    var hash = safeDecode(window.location.hash.slice(1));
    if (!(hash && !state.query && !state.content && !state.page && goTo(hash, false, false))) render(true);
  });
  window.addEventListener('hashchange', function () { goTo(safeDecode(window.location.hash.slice(1)), true, false); });
})();
