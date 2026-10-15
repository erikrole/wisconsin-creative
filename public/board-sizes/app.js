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
  ['search', 'nav-venues', 'nav-ref', 'tools-link', 'side-foot',
   'crumbs', 'title', 'actions', 'subtitle', 'props', 'summary', 'view', 'empty', 'footnote', 'toast'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  function storageGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function storageSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* private mode */ } }

  var VENUES = DATA.venues;
  var venueById = {};
  VENUES.forEach(function (v) { venueById[v.id] = v; });
  // Stable ids → where they live, and the production canvas keys built from them.
  var BY_ID = {};
  VENUES.forEach(function (v) {
    v.displays.forEach(function (d) {
      BY_ID[d.id] = { v: v, d: d };
      d.zones.forEach(function (z) { BY_ID[z.id] = { v: v, d: d, z: z }; });
    });
  });
  var KEYS = {};
  DATA.canvases.forEach(function (c) {
    var v = venueById[c.venue];
    var d = v && v.displays.filter(function (x) { return x.name === c.display; })[0];
    if (!d || c.within) return;
    var z = c.zone != null ? d.zones.filter(function (x) { return x.name === c.zone; })[0] : null;
    var id = z ? z.id : d.id;
    (KEYS[id] = KEYS[id] || []).push(c.key);
  });
  var KEY_ID = {};
  Object.keys(KEYS).forEach(function (id) { KEYS[id].forEach(function (k) { KEY_ID[k] = id; }); });
  var ISSUE_LABEL = { conflict: 'Sources disagree', tbd: 'Not final', unconfirmed: 'Unconfirmed', naming: 'Names may change' };
  var OPEN_ISSUES = [];
  VENUES.forEach(function (v) {
    v.displays.forEach(function (d) {
      (d.issues || []).forEach(function (i) { OPEN_ISSUES.push({ v: v, d: d, issue: i }); });
      d.zones.forEach(function (z) { (z.issues || []).forEach(function (i) { OPEN_ISSUES.push({ v: v, d: d, z: z, issue: i }); }); });
    });
  });
  var PAGES = { agents: 1, issues: 1 };
  var CONTENT = {};
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
    state.page = PAGES[params.get('p')] ? params.get('p') : null;
    state.query = params.get('q') || '';
    state.narrow = params.get('n') || '';
    state.venueFilter = params.get('f') === 'issues' ? 'issues' : 'all';
    state.share = params.get('share') === '1';
  }
  readParams();
  if (state.share) {
    document.body.classList.add('is-share');
    el['side-foot'].hidden = true;
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
    warn: '<path d="M8 2.2 14.3 13H1.7z"/><path d="M8 6.5v3.2M8 11.4v.1"/>'
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
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, function () { toast('This browser blocked copying.'); });
    else toast('Copying needs a secure (https) page.');
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
  function moreMenu(items, name) {
    var det = node('details', 'menu');
    var sum = node('summary', 'btn');
    sum.setAttribute('aria-label', 'More actions' + (name ? ' for ' + name : ''));
    sum.appendChild(document.createTextNode('More'));
    det.appendChild(sum);
    var pop = node('div', 'menu-pop');
    items.forEach(function (item) {
      var b = node('button', 'menu-item', item.label);
      b.type = 'button';
      b.addEventListener('click', function () { det.removeAttribute('open'); item.onClick(); });
      pop.appendChild(b);
    });
    det.appendChild(pop);
    det.addEventListener('click', function (e) { e.stopPropagation(); });
    det.addEventListener('toggle', function () {
      if (!det.open) return;
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
      });
    });
    return det;
  }
  function shareItem() {
    return { label: 'Share link', onClick: function () { copy(shareUrl(), 'Link copied'); } };
  }
  function withShare(items) {
    if (DATA.links && DATA.links.aeTemplate) items.push({ label: 'AE template', onClick: function () { window.open(DATA.links.aeTemplate, '_blank', 'noopener'); } });
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
    function has(hay) { hay = hay.toLowerCase(); return words.every(function (w) { return hay.indexOf(w) !== -1; }); }
    return {
      zone: function (z, d, v) { return has([z.name, z.id, (KEYS[z.id] || []).join(' '), d.name, d.sheetName || '', d.group || '', d.processor || '', v.name, size(z.w, z.h)].join(' ')); },
      display: function (d, v) { return has([d.name, d.id, (KEYS[d.id] || []).join(' '), d.sheetName || '', d.group || '', d.processor || '', v.name, size(d.w, d.h)].join(' ')); }
    };
  }

  /* ---------------- sidebar ---------------- */

  function navButton(label, count, current, onClick) {
    var li = node('li');
    var b = node('button');
    b.type = 'button';
    b.setAttribute('aria-current', String(!!current));
    b.appendChild(node('i', 'dot'));
    b.appendChild(node('span', '', label));
    if (count != null) b.appendChild(node('span', 'count', String(count)));
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
    [['agents', 'For agents & tools', null], ['issues', 'Open issues', OPEN_ISSUES.length]].forEach(function (pg) {
      el['nav-ref'].appendChild(navButton(pg[1], pg[2], !searching && state.page === pg[0], function () { openPage(pg[0]); }));
    });
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
    var used = {}, placed = 0;
    (d.overlays || []).forEach(function (o) {
      if (o.kind === 'crop' || o.kind === 'scrim') {
        var g = svgNode('g', { class: 'ov-' + o.kind });
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
    h2.appendChild(boardLink(d.id, d.name, 'board-link'));
    title.appendChild(h2);
    if (showVenue) title.appendChild(node('span', 'venue-of', v.name));
    if (d.processor) title.appendChild(node('span', 'processor', d.processor));
    head.appendChild(title);
    var dims = node('div', 'dims');
    dims.appendChild(sizeButton(d.w, d.h, d.name, specText(v, d, null)));
    dims.appendChild(node('small', '', ratio(d.w, d.h) + (d.zones.length ? ' · ' + d.zones.length + ' zone' + (d.zones.length === 1 ? '' : 's') : '')));
    head.appendChild(dims);
    if (!opts.board) card.appendChild(head);

    var props = node('div', 'card-props');
    props.appendChild(idPills(d.id));
    card.appendChild(props);

    var drawing = node('div', 'drawing');
    var fig = renderFigure(v, d, zoneMatch, card, { big: opts.board, show: opts.show });
    if (fig.ribbon) {
      drawing.classList.add('is-scroll');
      drawing.tabIndex = 0;
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
        { label: 'Guide SVG', onClick: function () { downloadSvg(Object.assign({}, guideOpts(v, d, null), { filename: guideName(v, d, null, 'svg') })); } },
        { label: 'Guide PNG', onClick: function () { downloadGuide(guideOpts(v, d, null)); } }
      ], d.name));
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
    if (z.stillOnly) tags.appendChild(node('span', 'tag', 'Stills only'));
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
    line.appendChild(node('b', '', row.base));
    var tags = specTags(z);
    if (row.layers.length) {
      var lt = node('span', 'tag layers', row.layers.join(' + '));
      lt.title = row.layers.length > 1 ? 'Two processor layers of one window: one asset fills both unless the content needs them separately.' : 'Processor layer';
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
      { label: 'Copy JSON', onClick: function () { copy(zoneJson(v, d, z, row), 'Copied JSON for ' + z.id); } },
      { label: 'Guide SVG', onClick: function () { downloadSvg(Object.assign({}, pngOpts, { filename: guideName(v, d, row, 'svg') })); } },
      { label: 'Guide PNG', onClick: function () { downloadGuide(pngOpts); } }
    ], row.base));
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
    return [
      '// Board Sizes · ' + c.name,
      '// ' + specs.length + ' comps, one per distinct canvas this content needs (×N = placed N times on that board), in a new project folder.',
      '// Frame rates follow the venue guide where it states one; otherwise 59.94.',
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
    ].join('\n');
  }

  function renderContent(c) {
    var rows = contentRows(c);
    el.crumbs.textContent = c.kind === 'broad' ? 'Content types' : 'Game day · ' + c.group;
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
        { label: 'AE comps', onClick: function () {
          var name = 'board-sizes_' + slug(c.name).toLowerCase() + '.jsx';
          download(name, aeScript(c, rows), 'text/plain');
          toast('Downloaded ' + name + ' (' + rows.length + ' comps)');
        } },
        { label: 'CSV', onClick: function () {
          var filename = 'board-sizes_' + slug(c.name).toLowerCase() + '.csv';
          var table = contentCsv(c, rows);
          download(filename, toCsv(table), 'text/csv');
          toast('Downloaded ' + filename + ' (' + (table.length - 1) + ' rows)');
        } }
      ]), c.name)
    ]);

    el.view.textContent = '';
    var box = node('div', 'targets');
    unique(rows.map(function (r) { return r.v.id; })).forEach(function (vid) {
      var mine = rows.filter(function (r) { return r.v.id === vid; });
      var h = node('h2', '', venueById[vid].name);
      h.appendChild(node('small', '', mine.length + ' canvas' + (mine.length === 1 ? '' : 'es')));
      box.appendChild(h);
      mine.forEach(function (r) {
        var row = node('div', 't-row');
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
        var open = node('a', 'mini');
        open.href = a.href;
        open.title = 'Open ' + r.d.name;
        open.setAttribute('aria-label', 'Open ' + r.d.name + ' at ' + r.v.name);
        open.appendChild(icon(ICONS.arrow));
        open.addEventListener('click', function (e) { e.preventDefault(); goTo(target); });
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
    if (!(hit.z && state.display === hit.d.id && !state.query)) {
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
    [[prev, '‹', 'Previous board'], [next, '›', 'Next board']].forEach(function (x) {
      var b = node('button', 'btn pager-btn', x[1]);
      b.type = 'button';
      b.disabled = !x[0];
      b.title = x[0] ? x[2] + ': ' + x[0].name + ' (' + (x[1] === '‹' ? '←' : '→') + ')' : x[2];
      b.setAttribute('aria-label', b.title);
      if (x[0]) b.addEventListener('click', function () { openBoard(x[0].id); });
      pager.appendChild(b);
    });
    acts.push(pager);
    acts.push(button('Copy spec', 'copy', function () { copy(specText(v, d, null), 'Copied ' + d.name); }, 'primary'));
    acts.push(moreMenu(withShare([
      { label: 'Guide SVG', onClick: function () { downloadSvg(Object.assign({}, guideOpts(v, d, null), { filename: guideName(v, d, null, 'svg') })); } },
      { label: 'Guide PNG', onClick: function () { downloadGuide(guideOpts(v, d, null)); } },
      { label: 'CSV', onClick: function () {
        var filename = 'board-sizes_' + d.id.replace(/\//g, '_') + '.csv';
        var table = displaysCsv(null, d);
        download(filename, toCsv(table), 'text/csv');
        toast('Downloaded ' + filename + ' (' + (table.length - 1) + ' rows)');
      } },
      { label: 'Copy id', onClick: function () { copy(d.id, 'Copied ' + d.id); } }
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
    if (bar.childNodes.length) el.view.appendChild(bar);
    el.view.appendChild(renderDisplay(v, d, null, false, { board: true, show: show }).el);
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
      { label: 'CSV', onClick: function () {
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
    else if (!match && state.content && CONTENT[state.content]) renderContent(CONTENT[state.content]);
    else renderVenue(venueById[state.venue], match);
    document.body.classList.toggle('is-board-view', !match && !!state.display);
    document.title = el.title.textContent + ' · Board Sizes';
    syncUrl(push);
    if (scrollTop) window.scrollTo(0, 0);
    requestAnimationFrame(function () {
      var sideEl = document.getElementById('side');
      if (!sideEl) return;
      if (sideEl.scrollHeight > sideEl.clientHeight + 2) sideEl.tabIndex = 0;
      else sideEl.removeAttribute('tabindex');
    });
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
  document.addEventListener('click', function (e) { if (!e.target.closest || !e.target.closest('details.menu')) closeMenus(); });
  window.addEventListener('scroll', function () { closeMenus(); }, true);
  document.addEventListener('keydown', function (event) {
    var typing = /^(input|textarea|select)$/i.test((event.target.tagName || ''));
    if (event.key === '/' && !typing) { event.preventDefault(); el.search.focus(); el.search.select(); }
    else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && (document.activeElement === document.body || !document.activeElement) && state.display && !state.query && !event.metaKey && !event.altKey) {
      var nb = neighbor(state.display, event.key === 'ArrowLeft' ? -1 : 1);
      if (nb) { event.preventDefault(); openBoard(nb.id); }
    }
    else if (event.key === 'Escape') {
      if (document.querySelector('details.menu[open]')) closeMenus();
      else if (document.querySelector('.is-picked') && document.activeElement !== el.search) clearPicks();
      else if (document.activeElement === el.search && el.search.value) { clearSearch(); render(false); }
    }
  });

  var initialHash = decodeURIComponent(window.location.hash.slice(1));
  if (!(initialHash && !state.query && !state.content && !state.page && goTo(initialHash, false, false))) render(false);
  window.addEventListener('popstate', function () {
    readParams();
    el.search.value = state.query;
    var hash = decodeURIComponent(window.location.hash.slice(1));
    if (!(hash && !state.query && !state.content && !state.page && goTo(hash, false, false))) render(true);
  });
  window.addEventListener('hashchange', function () { goTo(decodeURIComponent(window.location.hash.slice(1)), true, false); });
})();
