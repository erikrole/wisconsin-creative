/* Board Sizes page wiring. Data lives in boards.json (loaded as the generated
   data.js), cross-referenced from the
   Board Info sheet, the 2024 Camp Randall guide, Colosseum's deliverables
   sheet and the Board Builder. Client-only: no network requests.

   Views: ?v=<venue> (a venue's boards), ?c=<content type> (the boards one
   piece of content needs), ?q=<search> (across venues), ?p=agents (files and
   rules for agents and tools), ?p=issues (every open question). #<id> jumps
   to a display or zone by its stable id. &share=1 hides the way back to the
   rest of the site. */
(function () {
  'use strict';

  var DATA = window.BOARD_DATA;
  var VENUE_KEY = 'boards.venue.v1';
  var el = {};
  ['search', 'nav-venues', 'nav-broad', 'nav-gameday', 'nav-ref', 'tools-link', 'side-foot', 'menu', 'scrim', 'mobile-title',
   'crumbs', 'title', 'actions', 'subtitle', 'props', 'callout', 'summary', 'view', 'empty', 'footnote', 'toast'
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

  var params = new URLSearchParams(window.location.search);
  var state = {
    venue: venueById[params.get('v')] ? params.get('v') : (venueById[storageGet(VENUE_KEY)] ? storageGet(VENUE_KEY) : VENUES[0].id),
    content: CONTENT[params.get('c')] ? params.get('c') : null,
    page: PAGES[params.get('p')] ? params.get('p') : null,
    query: params.get('q') || '',
    share: params.get('share') === '1'
  };
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
    warn: '<path d="M8 2.2 14.3 13H1.7z"/><path d="M8 6.5v3.2M8 11.4v.1"/>',
    info: '<circle cx="8" cy="8" r="6"/><path d="M8 7.2v4M8 4.9v.1"/>'
  };
  function slug(s) { return s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function cardId(v, d) { return d.id; }

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
  // name; a size like 1920x1080 matches exactly, zones and whole displays.
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
      zone: function (z, d, v) { return has([z.name, d.name, d.sheetName || '', d.group || '', d.processor || '', v.name, size(z.w, z.h)].join(' ')); },
      display: function (d, v) { return has([d.name, d.sheetName || '', d.group || '', d.processor || '', v.name, size(d.w, d.h)].join(' ')); }
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
    b.addEventListener('click', function () { onClick(); closeNav(); });
    li.appendChild(b);
    return li;
  }
  function boardCount(c) { return canvasCount(c); }

  function renderNav() {
    var searching = !!state.query.trim();
    el['nav-venues'].textContent = '';
    VENUES.forEach(function (v) {
      el['nav-venues'].appendChild(navButton(v.name, v.displays.length, !searching && !state.content && !state.page && state.venue === v.id, function () {
        state.venue = v.id; state.content = null; state.page = null; clearSearch(); storageSet(VENUE_KEY, v.id); render(true);
      }));
    });
    el['nav-ref'].textContent = '';
    [['agents', 'For agents & tools', null], ['issues', 'Open issues', OPEN_ISSUES.length]].forEach(function (pg) {
      el['nav-ref'].appendChild(navButton(pg[1], pg[2], !searching && state.page === pg[0], function () { openPage(pg[0]); }));
    });
    el['nav-broad'].textContent = '';
    DATA.content.broad.forEach(function (c) {
      el['nav-broad'].appendChild(navButton(c.name, boardCount(c), !searching && state.content === c.id, function () { openContent(c.id); }));
    });
    el['nav-gameday'].textContent = '';
    DATA.content.gameDay.forEach(function (g) {
      var li = node('li');
      var det = node('details');
      var open = g.items.some(function (c) { return c.id === state.content; });
      if (open) det.open = true;
      var sum = node('summary');
      sum.appendChild(icon('<path d="M6 3.5 10.5 8 6 12.5"/>')).setAttribute('class', 'icon chev');
      sum.appendChild(node('span', '', g.name));
      sum.appendChild(node('span', 'count', String(g.items.length)));
      det.appendChild(sum);
      var ul = node('ul');
      g.items.forEach(function (c) {
        ul.appendChild(navButton(c.name.replace(/^(Score|Noise|Play 1|Play 2|Living Hold): /, ''), boardCount(c), !searching && state.content === c.id, function () { openContent(c.id); }));
      });
      det.appendChild(ul);
      li.appendChild(det);
      el['nav-gameday'].appendChild(li);
    });
  }

  function openContent(id) { state.content = id; state.page = null; clearSearch(); render(true); }
  function openPage(id) { state.page = id; state.content = null; clearSearch(); render(true); }
  function clearSearch() { state.query = ''; el.search.value = ''; }
  function closeNav() { document.body.classList.remove('nav-open'); el.menu.setAttribute('aria-expanded', 'false'); }
  el.menu.addEventListener('click', function () {
    var open = !document.body.classList.contains('nav-open');
    document.body.classList.toggle('nav-open', open);
    el.menu.setAttribute('aria-expanded', String(open));
  });
  el.scrim.addEventListener('click', closeNav);

  /* ---------------- drawing ---------------- */

  function renderFigure(d, isHot) {
    var wrap = node('div', 'figure');
    var svg = svgNode('svg', { viewBox: '0 0 ' + d.w + ' ' + d.h, preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true' });
    var id = 'hatch-' + slug((d.processor || '') + d.name + d.w);
    var defs = svgNode('defs', {});
    defs.innerHTML = '<pattern id="' + id + '" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="10" fill="currentColor" fill-opacity=".1"/><line x1="0" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="2.5" stroke-opacity=".7"/></pattern>';
    svg.appendChild(defs);
    svg.appendChild(svgNode('rect', { class: 'canvas', x: 0, y: 0, width: d.w, height: d.h, 'vector-effect': 'non-scaling-stroke' }));
    var used = {}, placed = 0;
    d.zones.forEach(function (z) {
      (z.at || []).forEach(function (p) {
        var top = p.y, left = p.x;
        if (left >= d.w || top >= d.h || left + z.w <= 0 || top + z.h <= 0) return;
        placed++;
        var from = z.atFrom === 'derived' ? 'derived' : 'stated';
        used[from] = true;
        svg.appendChild(svgNode('rect', {
          class: 'zone zone-' + from + (isHot && isHot(z) ? ' is-hot' : ''), 'data-zone': d.name + '|' + z.n,
          x: Math.max(0, left), y: Math.max(0, top),
          width: Math.min(z.w, d.w - Math.max(0, left)), height: Math.min(z.h, d.h - Math.max(0, top)),
          'vector-effect': 'non-scaling-stroke'
        }));
      });
    });
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
    // Cap tall boards at 180 px (the figure narrows to keep its proportions);
    // keep hairline ribbons at least 6 px so they stay visible.
    wrap.style.maxWidth = Math.round((180 * d.w) / d.h) + 'px';
    svg.style.minHeight = '6px';
    wrap.appendChild(svg);
    var dw = node('div', 'dim dim-w'); dw.appendChild(node('span', '', d.w.toLocaleString('en-US') + ' px')); wrap.appendChild(dw);
    var dh = node('div', 'dim dim-h'); dh.appendChild(node('span', '', d.h.toLocaleString('en-US') + ' px')); wrap.appendChild(dh);
    return { el: wrap, placed: placed, used: used };
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
    if (opts.pad) {
      ctx.setLineDash([line * 2, line * 2]);
      ctx.strokeRect(opts.pad, opts.pad, w - opts.pad * 2, h - opts.pad * 2);
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

  function sourcePills(d) {
    var wrap = node('span');
    Object.keys(DATA.sources).forEach(function (key) {
      if (!d.sources || !d.sources[key]) return;
      var p = node('span', 'pill src', DATA.sources[key].label + (key === 'guide' ? ' ' + d.sources[key] : ''));
      p.title = DATA.sources[key].detail + ' — listed as “' + d.sources[key] + '”';
      wrap.appendChild(p);
    });
    return wrap;
  }
  function deliveryPills(delivery) {
    if (!delivery) return null;
    var wrap = node('span');
    [['fps', function (v) { return v + ' fps'; }], ['video', null], ['still', function (v) { return 'Stills: ' + v; }], ['duration', null], ['audio', function (v) { return 'Audio: ' + v; }]]
      .forEach(function (pair) {
        var v = delivery[pair[0]];
        if (v) wrap.appendChild(node('span', 'pill mono', pair[1] ? pair[1](v) : v));
      });
    return wrap;
  }

  function renderDisplay(v, d, match, showVenue) {
    var displayHit = match && match.display(d, v);
    var zoneMatch = match && !displayHit ? function (z) { return match.zone(z, d, v); } : null;
    var zones = zoneMatch ? d.zones.filter(zoneMatch) : d.zones;
    if (match && !displayHit && !zones.length) return null;

    var card = node('section', 'card');
    card.id = cardId(v, d);
    card.setAttribute('aria-label', v.name + ' ' + d.name);
    var head = node('div', 'card-head');
    head.appendChild(node('h2', '', d.name));
    if (showVenue) head.appendChild(node('span', 'venue-of', v.name));
    if (d.processor) head.appendChild(node('span', 'pill mono', d.processor));
    var dims = node('span', 'dims', pretty(d.w, d.h));
    dims.appendChild(node('small', '', ratio(d.w, d.h) + (d.zones.length ? ' · ' + d.zones.length + ' zone' + (d.zones.length === 1 ? '' : 's') : '')));
    head.appendChild(dims);
    card.appendChild(head);

    var props = node('div', 'card-props');
    props.appendChild(idPills(d.id));
    props.appendChild(sourcePills(d));
    var del = deliveryPills(d.delivery);
    if (del) props.appendChild(del);
    card.appendChild(props);

    var drawing = node('div', 'drawing');
    var fig = renderFigure(d, zoneMatch);
    drawing.appendChild(fig.el);
    var legend = renderLegend(fig.used);
    if (legend) drawing.appendChild(legend);
    var figNote = d.placedNote || (!fig.placed && d.zones.length ? 'The sources give sizes for this display, not zone positions.' : '');
    if (figNote) drawing.appendChild(node('p', 'fig-note', figNote));
    if (d.link) {
      var a = node('a', 'fig-link', d.link.label + ' ↗');
      a.href = d.link.href; a.target = '_blank'; a.rel = 'noopener noreferrer';
      drawing.appendChild(a);
    }
    card.appendChild(drawing);

    if (zones.length) {
      var list = node('div', 'zones');
      groupZones(zones).forEach(function (row) { list.appendChild(renderZoneRow(v, d, row, card, !!zoneMatch)); });
      card.appendChild(list);
    }

    var foot = node('div', 'card-foot');
    var info = (d.notes || []).slice();
    var pads = d.zones.filter(function (z) { return z.pad; });
    if (pads.length) info.push('Windows tagged “' + pads[0].pad + ' px pad”: keep content ' + pads[0].pad + ' px inside every edge; the board draws a border over them. Deliver at full size.');
    if (info.length || (d.issues && d.issues.length)) {
      var notes = node('ul', 'notes');
      (d.issues || []).forEach(function (i) { notes.appendChild(issueItem(i)); });
      info.forEach(function (n) { notes.appendChild(node('li', '', n)); });
      foot.appendChild(notes);
    }
    foot.appendChild(button('Copy ' + size(d.w, d.h), 'copy', function () { copy(size(d.w, d.h), 'Copied ' + size(d.w, d.h)); }));
    foot.appendChild(button('Guide PNG', 'image', function () {
      downloadGuide({ w: d.w, h: d.h, zones: d.zones, overlays: d.overlays,
        label: (d.processor ? d.processor + ' · ' : '') + d.name + ' ' + size(d.w, d.h),
        filename: v.code + '_' + slug(d.name) + '_' + size(d.w, d.h) + '_guide.png' });
    }));
    card.appendChild(foot);
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

  function thumbFor(w, h) {
    var thumb = node('span', 'thumb');
    var box = node('i');
    var scale = Math.min(40 / w, 22 / h);
    box.style.width = Math.max(2, w * scale) + 'px';
    box.style.height = Math.max(2, h * scale) + 'px';
    thumb.appendChild(box);
    return thumb;
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
  function sizeButton(w, h, label) {
    var b = node('button', 'size', pretty(w, h));
    b.type = 'button';
    b.title = 'Copy ' + size(w, h);
    b.setAttribute('aria-label', 'Copy size ' + size(w, h) + (label ? ' for ' + label : ''));
    b.addEventListener('click', function () { copy(size(w, h), 'Copied ' + size(w, h), b); });
    return b;
  }

  function renderZoneRow(v, d, row, card, matching) {
    var z = row.first;
    var r = node('div', 'zone-row' + (matching ? ' is-match' : ''));
    r.id = z.id;
    var keys = row.zones.map(function (x) { return d.name + '|' + x.n; });
    r.addEventListener('mouseenter', function () { hot(card, keys, true); });
    r.addEventListener('mouseleave', function () { if (!matching) hot(card, keys, false); });
    r.appendChild(thumbFor(row.w, row.h));

    var name = node('span', 'zone-name');
    name.appendChild(node('b', '', row.base));
    var tags = specTags(z);
    row.layers.slice().reverse().forEach(function (l) { tags.insertBefore(node('span', 'tag', l), tags.firstChild); });
    if (tags.childNodes.length) name.appendChild(tags);
    var bits = [];
    if (row.zones[0].n != null) bits.push('#' + row.zones.map(function (x) { return x.n; }).join(', #'));
    bits.push(ratio(row.w, row.h));
    if (z.at) bits.push(z.at.map(function (p) { return 'x ' + p.x + ', y ' + p.y; }).join(' · ') + (z.atFrom === 'derived' ? ' (from sizes)' : ''));
    if (z.page) bits.push('guide p. ' + z.page);
    name.appendChild(node('span', 'zone-meta', bits.join(' · ')));
    var idLine = node('span', 'zone-id');
    var idb = node('button', '', row.zones.map(function (x) { return x.id.slice(d.id.length + 1); }).join(' · '));
    idb.type = 'button';
    idb.title = 'Copy ' + z.id;
    idb.setAttribute('aria-label', 'Copy id ' + z.id);
    idb.addEventListener('click', function () { copy(z.id, 'Copied ' + z.id, idb); });
    idLine.appendChild(idb);
    name.appendChild(idLine);
    if ((z.issues && z.issues.length) || (z.notes && z.notes.length)) {
      var ul = node('ul', 'zone-notes');
      (z.issues || []).forEach(function (i) { var li = issueItem(i); li.className = 'red'; ul.appendChild(li); });
      (z.notes || []).forEach(function (n) { ul.appendChild(node('li', '', n)); });
      name.appendChild(ul);
    }
    r.appendChild(name);
    r.appendChild(sizeButton(row.w, row.h, row.base));

    var js = node('button', 'mini');
    js.type = 'button';
    js.title = 'Copy this zone as JSON (id, size, position, delivery, issues)';
    js.setAttribute('aria-label', 'Copy JSON for ' + row.base);
    js.appendChild(icon(ICONS.json));
    js.addEventListener('click', function () { copy(zoneJson(v, d, z, row), 'Copied JSON for ' + z.id, js); });
    var png = node('button', 'mini');
    png.type = 'button';
    png.title = 'Download a ' + size(row.w, row.h) + ' guide PNG';
    png.setAttribute('aria-label', png.title + ' for ' + row.base);
    png.appendChild(icon(ICONS.image));
    png.addEventListener('click', function () {
      downloadGuide({ w: row.w, h: row.h, pad: z.pad, label: row.base + ' ' + size(row.w, row.h),
        filename: v.code + '_' + slug(d.name) + '_' + slug(row.base) + '_' + size(row.w, row.h) + '.png' });
    });
    var tools = node('span', 'row-tools');
    tools.appendChild(js);
    tools.appendChild(png);
    r.appendChild(tools);
    return r;
  }

  function hot(card, keys, on) {
    keys.forEach(function (k) {
      Array.prototype.forEach.call(card.querySelectorAll('[data-zone="' + k.replace(/"/g, '\\"') + '"]'), function (rect) {
        rect.classList.toggle('is-hot', on);
      });
    });
  }

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
    el.callout.textContent = '';

    setActions([
      button('Copy sizes', 'copy', function () {
        copy(rows.map(function (r) { return r.v.name + ' · ' + r.label + (r.count > 1 ? ' (×' + r.count + ')' : '') + ' — ' + size(r.w, r.h); }).join('\n'), 'Copied ' + rows.length + ' sizes');
      }),
      button('AE comps', 'ae', function () {
        var name = 'board-sizes_' + slug(c.name).toLowerCase() + '.jsx';
        download(name, aeScript(c, rows), 'text/plain');
        toast('Downloaded ' + name + ' (' + rows.length + ' comps)');
      }),
      csvButton(function () { return contentCsv(c, rows); }, 'board-sizes_' + slug(c.name).toLowerCase() + '.csv')
    ]);

    el.view.textContent = '';
    var box = node('div', 'targets');
    unique(rows.map(function (r) { return r.v.id; })).forEach(function (vid) {
      var mine = rows.filter(function (r) { return r.v.id === vid; });
      var h = node('h3', '', venueById[vid].name);
      h.appendChild(node('small', '', mine.length + ' canvas' + (mine.length === 1 ? '' : 'es')));
      box.appendChild(h);
      mine.forEach(function (r) {
        var row = node('div', 't-row');
        row.appendChild(thumbFor(r.w, r.h));
        var nm = node('span', 't-name');
        var a = node('a', '', r.label);
        var target = r.ids ? r.ids[0] : r.d.id;
        a.href = '?v=' + r.v.id + (state.share ? '&share=1' : '') + '#' + target;
        a.addEventListener('click', function (e) { e.preventDefault(); goTo(target); });
        var b = node('b'); b.appendChild(a); nm.appendChild(b);
        var tags = specTags(r.z);
        (r.layers || []).slice().reverse().forEach(function (l) { tags.insertBefore(node('span', 'tag', l), tags.firstChild); });
        if (r.count > 1) tags.insertBefore(node('span', 'tag', '×' + r.count), tags.firstChild);
        if (tags.childNodes.length) nm.appendChild(tags);
        var del = r.d.delivery || {};
        var spec = r.z.stillOnly ? [del.still || 'Stills'] : [del.fps ? del.fps + ' fps' : '', del.video || ''];
        var sub = spec.concat([r.z.page ? 'guide p. ' + r.z.page : '']).filter(Boolean).join(' · ');
        if (sub) nm.appendChild(node('span', 't-sub', sub));
        row.appendChild(nm);
        row.appendChild(sizeButton(r.w, r.h, r.label));
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

  // Opens the venue that holds a display or zone id and flashes it. A BG
  // layer shares its FG row, so fall back to the row's first zone, then the card.
  function goTo(id, smooth) {
    var hit = BY_ID[id];
    if (!hit) return false;
    state.venue = hit.v.id; state.content = null; state.page = null; clearSearch();
    storageSet(VENUE_KEY, hit.v.id);
    render(false);
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
  function csvButton(build, filename) {
    return button('CSV', 'download', function () {
      var rows = build();
      download(filename, toCsv(rows), 'text/csv');
      toast('Downloaded ' + filename + ' (' + (rows.length - 1) + ' rows)');
    });
  }
  function contentCsv(c, rows) {
    var out = [['Content', 'Venue', 'Display', 'Zone', 'Ids', 'Placements', 'Width', 'Height', 'Frame rate', 'Video', 'Stills only', 'Duration', 'Border pad (px)', 'Guide page']];
    rows.forEach(function (r) {
      var del = r.d.delivery || {};
      out.push([c.name, r.v.name, r.d.name, r.zone || '', (r.ids || [r.d.id]).join(' '), r.count, r.w, r.h, r.z.stillOnly ? '' : del.fps, r.z.stillOnly ? del.still : del.video, r.z.stillOnly ? 'yes' : '', r.z.duration || (c.duration ? c.duration + ' s' : ''), r.z.pad, r.z.page]);
    });
    return out;
  }
  function displaysCsv(match) {
    var rows = [['Id', 'Venue', 'Group', 'Processor', 'Display', 'Display size', 'Zone #', 'Zone', 'Width', 'Height',
      'Positions (x,y)', 'Position source', 'Frame rate', 'Video', 'Stills', 'Duration', 'Stills only', 'Border pad (px)', 'Guide page', 'Sources', 'Notes']];
    VENUES.forEach(function (v) {
      if (!match && v.id !== state.venue) return;
      v.displays.forEach(function (d) {
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
    if (DATA.links && DATA.links.aeTemplate) {
      var a = node('a', 'btn');
      a.href = DATA.links.aeTemplate; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.appendChild(icon(ICONS.ae));
      a.appendChild(document.createTextNode('AE template'));
      el.actions.appendChild(a);
    }
    el.actions.appendChild(button('Share link', 'link', function () {
      copy(shareUrl(), 'Link copied. It opens this page with no way back to the rest of the site.');
    }, 'primary'));
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
    'Check issues before final delivery and tell the person about them. Never resolve a conflict silently.',
    'Respect delivery specs: fps, stills only, exact durations, border pad, audio. When fps is missing, ask or use 59.94.',
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
    el.callout.textContent = '';
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
    setActions([button('Copy agent prompt', 'copy', function () { copy(SNIPPETS[2][1], 'Copied the agent prompt'); })]);

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
      'The {} button on a zone copies it as JSON with its manifest version, ready to paste into a prompt or config.'
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
      OPEN_ISSUES.length + ' places where the sources disagree or leave something open. Confirm these before final delivery; agents see the same list in every record’s issues.');
    setActions([]);
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

  /* ---------------- venue + search views ---------------- */

  function renderVenue(v, match) {
    el.crumbs.textContent = match ? 'Search' : 'Venues';
    el.props.hidden = true;
    el.callout.textContent = '';
    var zones = 0;
    v.displays.forEach(function (d) { zones += d.zones.length; });
    el.title.textContent = match ? '“' + state.query.trim() + '”' : v.name;
    el.subtitle.textContent = match ? 'Matches across every venue.' : v.displays.length + ' display' + (v.displays.length === 1 ? '' : 's') + ' · ' + zones + ' zone' + (zones === 1 ? '' : 's');
    if (!match && v.notes && v.notes.length) {
      var box = node('div', 'callout');
      box.appendChild(icon(ICONS.info));
      var ul = node('ul');
      v.notes.forEach(function (t) { ul.appendChild(node('li', '', t)); });
      box.appendChild(ul);
      el.callout.appendChild(box);
    }
    setActions([csvButton(function () { return displaysCsv(match); }, match ? 'board-sizes_search.csv' : 'board-sizes_' + v.id + '.csv')]);

    el.view.textContent = '';
    var shownDisplays = 0, shownZones = 0;
    (match ? VENUES : [v]).forEach(function (venue) {
      var first = true, group = null;
      venue.displays.forEach(function (d) {
        var out = renderDisplay(venue, d, match, false);
        if (!out) return;
        if (match && first) { el.view.appendChild(node('h2', 'group-title', venue.name)); first = false; }
        if (!match && d.group && d.group !== group) el.view.appendChild(node('h2', 'group-title', d.group));
        group = d.group || null;
        el.view.appendChild(out.el);
        shownDisplays++; shownZones += out.zones;
      });
    });
    el.empty.hidden = shownDisplays > 0;
    el.summary.textContent = match ? shownDisplays + ' display' + (shownDisplays === 1 ? '' : 's') + ', ' + shownZones + ' zone' + (shownZones === 1 ? '' : 's') : '';
  }

  /* ---------------- page ---------------- */

  function currentParams() {
    var p = new URLSearchParams();
    if (state.query.trim()) p.set('q', state.query.trim());
    else if (state.page) p.set('p', state.page);
    else if (state.content) p.set('c', state.content);
    else p.set('v', state.venue);
    return p;
  }
  function syncUrl() {
    try {
      var p = currentParams();
      if (state.share) p.set('share', '1');
      window.history.replaceState(null, '', window.location.pathname + '?' + p.toString());
    } catch (e) { /* file:// */ }
  }

  function render(scrollTop) {
    renderNav();
    var match = matcher(state.query);
    if (!match && state.page === 'agents') renderAgents();
    else if (!match && state.page === 'issues') renderIssues();
    else if (!match && state.content && CONTENT[state.content]) renderContent(CONTENT[state.content]);
    else renderVenue(venueById[state.venue], match);
    el['mobile-title'].textContent = el.title.textContent;
    document.title = el.title.textContent + ' · Board Sizes';
    syncUrl();
    if (scrollTop) window.scrollTo(0, 0);
  }

  el.footnote.textContent = 'Manifest ' + DATA.version + ' (updated ' + DATA.updated + '). Sizes are width × height in px; positions are x, y from the top-left. Sources: ' +
    Object.keys(DATA.sources).map(function (k) { return DATA.sources[k].detail; }).join('; ') +
    '. Red notes are open issues: confirm those before final delivery.';

  var searchTimer = null;
  el.search.value = state.query;
  el.search.addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { state.query = el.search.value; render(false); }, 120);
  });
  document.addEventListener('keydown', function (event) {
    var typing = /^(input|textarea|select)$/i.test((event.target.tagName || ''));
    if (event.key === '/' && !typing) { event.preventDefault(); el.search.focus(); el.search.select(); }
    else if (event.key === 'Escape') {
      if (document.body.classList.contains('nav-open')) closeNav();
      else if (document.activeElement === el.search && el.search.value) { clearSearch(); render(false); }
    }
  });

  var initialHash = decodeURIComponent(window.location.hash.slice(1));
  if (!(initialHash && !state.query && !state.content && !state.page && goTo(initialHash, false))) render(false);
  window.addEventListener('hashchange', function () { goTo(decodeURIComponent(window.location.hash.slice(1))); });
})();
