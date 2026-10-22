/* Photo Frame — drop photos, get them matted with their credit and camera settings.
   Everything runs in this tab: files are read with FileReader, decoded with
   createImageBitmap, drawn on a canvas and saved, shared or copied as an image.
   Nothing is uploaded, and the export carries no EXIF (so no GPS) from the original.
   Only the look (size, border, layout, color, file type), the field switches and the
   credit live in localStorage. */
(function () {
  'use strict';

  var core = window.PhotoFrameCore;
  var STORE = 'photo-frame-v2';
  var MAX_PHOTOS = 12;
  var MAX_PIXELS = 200e6;
  var PREVIEW_SOURCE = 1600;
  var FONT = '"Gotham", system-ui, -apple-system, "Segoe UI", sans-serif';

  // Credit is shared by every photo; the rest come from each photo's EXIF and can be edited per photo.
  var FIELDS = [
    { id: 'credit', label: 'Credit', on: true, ph: 'Photographer', group: 'credit' },
    { id: 'caption', label: 'Caption', on: false, ph: 'Wisconsin vs. Iowa', group: 'credit' },
    { id: 'date', label: 'Date', on: false, ph: 'Oct 14, 2026', group: 'credit' },
    { id: 'camera', label: 'Camera', on: true, ph: 'Sony A1', group: 'camera' },
    { id: 'lens', label: 'Lens', on: true, ph: 'FE 70-200mm F2.8 GM OSS II', group: 'camera' },
    { id: 'focal', label: 'Focal', on: true, ph: '200 mm', group: 'camera' },
    { id: 'aperture', label: 'Aperture', on: true, ph: 'f/2.8', group: 'camera' },
    { id: 'shutter', label: 'Shutter', on: true, ph: '1/1000 s', group: 'camera' },
    { id: 'iso', label: 'ISO', on: true, ph: '800', group: 'camera' }
  ];
  var STATS = ['focal', 'aperture', 'shutter', 'iso'];
  var EXIF_KEYS = ['camera', 'lens', 'focal', 'aperture', 'shutter', 'iso', 'date'];

  var FORMATS = {
    '4x5': { label: '4:5', ratio: 4 / 5 },
    '1x1': { label: '1:1', ratio: 1 },
    '9x16': { label: '9:16', ratio: 9 / 16 },
    original: { label: 'Original', ratio: 0 }
  };
  var BORDERS = { slim: { label: 'Slim', k: 0.6 }, regular: { label: 'Regular', k: 1 }, wide: { label: 'Wide', k: 1.5 } };
  var LAYOUTS = { split: { label: 'Split' }, centered: { label: 'Centered' } };
  var TYPES = {
    jpeg: { label: 'JPEG', mime: 'image/jpeg', ext: 'jpg', quality: 0.95 },
    png: { label: 'PNG', mime: 'image/png', ext: 'png' }
  };

  var SWATCHES = [
    { name: 'Black', hex: '#000000' },
    { name: 'Charcoal', hex: '#1c1c1f' },
    { name: 'White', hex: '#ffffff' },
    { name: 'Bone', hex: '#f1eee7' },
    { name: 'Badger red', hex: '#a00000' }
  ];

  var state = { format: '4x5', border: 'regular', layout: 'split', type: 'jpeg', color: '#000000', on: {}, credit: '', photos: [], current: -1 };
  var $ = function (id) { return document.getElementById(id); };
  var els = {};
  var nextId = 1;

  function storageGet() {
    try { return JSON.parse(window.localStorage.getItem(STORE) || 'null'); } catch (e) { return null; }
  }
  function storageSet() {
    try {
      window.localStorage.setItem(STORE, JSON.stringify({
        format: state.format, border: state.border, layout: state.layout, type: state.type,
        color: state.color, on: state.on, credit: state.credit
      }));
    } catch (e) { /* private mode: the choices just don't stick */ }
  }

  function current() {
    return state.photos[state.current] || null;
  }

  /* ---------- drawing ---------- */

  function valueOf(photo, id) {
    if (!state.on[id]) return '';
    return ((id === 'credit' ? state.credit : photo.values[id]) || '').trim();
  }

  function content(photo) {
    var stats = STATS.map(function (id) {
      var v = valueOf(photo, id);
      return v && id === 'iso' && !/iso/i.test(v) ? 'ISO ' + v : v;
    }).filter(Boolean);
    return {
      credit: valueOf(photo, 'credit'),
      stats: stats,
      sub: [valueOf(photo, 'caption'), valueOf(photo, 'date')].filter(Boolean).join('  ·  '),
      gear: [valueOf(photo, 'camera'), valueOf(photo, 'lens')].filter(Boolean).join('  ·  ')
    };
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Sizes are in units of u; u is a hundredth of the canvas width (fixed ratios)
  // or of the photo's short side (Original). The border setting scales `pad`.
  var SIZES = {
    social: { pad: 5.5, big: 2.5, small: 1.9, lead: 3.6, line: 1, radius: 1.1 },
    original: { pad: 4, big: 2.1, small: 1.6, lead: 3.2, line: 0.9, radius: 0.7 }
  };

  var probe = document.createElement('canvas').getContext('2d');
  function measure(text, size, weight) {
    probe.font = weight + ' ' + size + 'px ' + FONT;
    return probe.measureText(text).width;
  }
  function ellipsize(text, size, weight, max, strip) {
    if (measure(text, size, weight) <= max) return text;
    strip.cut = true;
    var t = text;
    while (t.length > 1 && measure(t + '…', size, weight) > max) t = t.slice(0, -1);
    return t.replace(/\s+$/, '') + '…';
  }

  /** Measures the strip for a column `innerW` wide and returns what to paint and how tall it is. */
  function layoutStrip(photo, u, z, innerW) {
    var c = content(photo);
    var big = z.big * u;
    var small = z.small * u;
    var gap = big * 1.5;
    var side = big * 2.2;
    var strip = { lines: [], h: 0, lead: z.lead * u, gap: gap, cut: false };
    var h = 0;

    function statsWidth(p, size) {
      return p.stats.reduce(function (n, s, i) { return n + measure(s, size, p.weight) + (i ? gap : 0); }, 0);
    }
    function addLine(parts, size) {
      strip.lines.push({ parts: parts, size: size, y: h });
      h += size * 1.5 + z.line * u;
    }
    function fit(p, size) {
      if (p.text) { p.text = ellipsize(p.text, size, p.weight, innerW, strip); p.w = measure(p.text, size, p.weight); }
      else {
        // Too many stats for one line: drop from the end rather than overflow the frame.
        while (p.stats.length > 1 && statsWidth(p, size) > innerW) { p.stats.pop(); strip.cut = true; }
        p.w = statsWidth(p, size);
      }
      return p;
    }

    // `left` and `right` are { text, weight, dim } or { stats, weight }; they share a row when they fit.
    function pair(left, right, size) {
      [left, right].forEach(function (p) { if (p) p.w = p.stats ? statsWidth(p, size) : measure(p.text, size, p.weight); });
      if (left && right && left.w + right.w + side <= innerW) {
        left.align = 'left';
        right.align = 'right';
        addLine([left, right], size);
        return;
      }
      [left, right].forEach(function (p) {
        if (!p) return;
        p.align = 'left';
        addLine([fit(p, size)], size);
      });
    }

    function centered(p, size) {
      if (!p) return;
      p.align = 'center';
      addLine([fit(p, size)], size);
    }

    var credit = c.credit ? { text: c.credit, weight: 700 } : null;
    var stats = c.stats.length ? { stats: c.stats, weight: 500 } : null;
    var sub = c.sub ? { text: c.sub, weight: 400, dim: true } : null;
    var gear = c.gear ? { text: c.gear, weight: 400, dim: true } : null;

    if (state.layout === 'centered') {
      centered(credit, big);
      centered(stats, small * 1.08);
      centered(sub, small);
      centered(gear, small);
    } else {
      pair(credit, stats, big);
      pair(sub, gear, small);
    }
    if (h) h -= z.line * u + strip.lines[strip.lines.length - 1].size * 0.25;
    strip.h = h ? strip.lead + h : 0;
    return strip;
  }

  function paintStrip(ctx, strip, ink, x0, y0, innerW) {
    strip.lines.forEach(function (line) {
      var y = y0 + strip.lead + line.y + line.size * 1.05;
      line.parts.forEach(function (p) {
        ctx.fillStyle = p.dim ? ink.dim : ink.ink;
        ctx.font = p.weight + ' ' + line.size + 'px ' + FONT;
        var x = p.align === 'right' ? x0 + innerW - p.w : p.align === 'center' ? x0 + (innerW - p.w) / 2 : x0;
        if (!p.stats) {
          ctx.fillText(p.text, x, y);
          return;
        }
        p.stats.forEach(function (s, i) {
          if (i) {
            ctx.fillStyle = ink.hair;
            ctx.fillRect(x - strip.gap / 2, y - line.size * 0.78, Math.max(1, line.size * 0.05), line.size * 0.86);
            ctx.fillStyle = ink.ink;
          }
          ctx.fillText(s, x, y);
          x += ctx.measureText(s).width + strip.gap;
        });
      });
    });
  }

  /**
   * Draws `photo` framed into `canvas` from `source` (its preview or full-size bitmap). For a fixed
   * ratio `size` is the canvas width and the photo is fitted and centered with the strip under it.
   * For Original it is the photo's width and the canvas grows around it. Returns the strip, or null
   * when the browser refused a canvas that big.
   */
  function draw(canvas, photo, source, size) {
    var ratio = FORMATS[state.format].ratio;
    var asp = photo.height / photo.width;
    var ink = core.inkFor(state.color);
    var k = BORDERS[state.border].k;
    var z, u, W, H, photoW, photoH, strip, left, top, pad;

    if (ratio) {
      z = SIZES.social;
      W = Math.round(size);
      H = Math.round(size / ratio);
      u = W / 100;
      pad = z.pad * k * u;
      var innerW = W - 2 * pad;
      photoW = innerW;
      // A tall photo narrows the column, so the strip is laid out again at that width.
      for (var i = 0; i < 6; i++) {
        strip = layoutStrip(photo, u, z, photoW);
        var room = Math.min(innerW, (H - 2 * pad - strip.h) / asp);
        if (Math.abs(room - photoW) < 1) break;
        photoW = Math.max(u, room);
      }
      photoH = photoW * asp;
      left = (W - photoW) / 2;
      top = (H - photoH - strip.h) / 2;
    } else {
      z = SIZES.original;
      photoW = size;
      photoH = Math.round(size * asp);
      u = Math.min(photoW, photoH) / 100;
      pad = z.pad * k * u;
      strip = layoutStrip(photo, u, z, photoW);
      W = Math.round(photoW + 2 * pad);
      H = Math.round(pad + photoH + strip.h + pad);
      left = pad;
      top = pad;
    }

    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d');
    if (!ctx || canvas.width !== W || canvas.height !== H) return null;

    ctx.fillStyle = state.color;
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.save();
    roundRect(ctx, left, top, photoW, photoH, z.radius * u);
    ctx.clip();
    ctx.drawImage(source, left, top, photoW, photoH);
    ctx.restore();

    ctx.textBaseline = 'alphabetic';
    paintStrip(ctx, strip, ink, left, top + photoH, photoW);
    return strip;
  }

  function outputSize(photo, forExport) {
    if (FORMATS[state.format].ratio) return forExport ? 2160 : 1080;
    return forExport ? photo.width : photo.preview.width;
  }

  /* ---------- page ---------- */

  function setStatus(message, tone) {
    els.status.textContent = message || '';
    els.status.className = 'status' + (tone ? ' ' + tone : '');
  }

  /** The note under the buttons for the current photo when nothing more urgent is showing. */
  function photoHint(photo, strip) {
    if (!photo) return '';
    if (strip && strip.cut) return 'Some text is too long for this frame and is cut short.';
    if (!photo.found) return 'No camera settings in this file. Type them in on the right.';
    if (state.on.credit && !state.credit.trim()) return 'Add a credit. It is remembered for next time.';
    return '';
  }

  function renderPreview() {
    var photo = current();
    if (!photo) return;
    var strip = draw(els.canvas, photo, photo.preview, outputSize(photo, false));
    els.canvas.setAttribute('aria-label', 'Framed preview of ' + photo.name);
    if (!busy) setStatus(photoHint(photo, strip), strip && strip.cut ? 'warn' : '');
  }

  var queued = false;
  function schedule() {
    invalidate();
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(function () { queued = false; renderPreview(); });
  }

  function segmented(container, options, key) {
    Object.keys(options).forEach(function (k) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'seg-button';
      b.textContent = options[k].label;
      b.dataset.value = k;
      b.addEventListener('click', function () {
        state[key] = k;
        syncControls();
        storageSet();
        schedule();
      });
      container.appendChild(b);
    });
  }

  function buildControls() {
    segmented(els.formats, FORMATS, 'format');
    segmented(els.borders, BORDERS, 'border');
    segmented(els.layouts, LAYOUTS, 'layout');
    segmented(els.types, TYPES, 'type');

    SWATCHES.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.setProperty('--c', s.hex);
      b.title = s.name;
      b.setAttribute('aria-label', s.name);
      b.dataset.hex = s.hex;
      b.addEventListener('click', function () { setColor(s.hex); });
      els.swatches.insertBefore(b, els.custom);
    });

    FIELDS.forEach(function (f) {
      var row = document.createElement('div');
      row.className = 'field';
      row.id = 'field-' + f.id;
      var label = document.createElement('label');
      label.htmlFor = 'val-' + f.id;
      label.textContent = f.label;
      var input = document.createElement('input');
      input.type = 'text';
      input.id = 'val-' + f.id;
      input.placeholder = f.ph;
      input.autocomplete = 'off';
      input.spellcheck = f.id === 'caption';
      input.maxLength = 120;
      var check = document.createElement('input');
      check.type = 'checkbox';
      check.className = 'switch';
      check.id = 'on-' + f.id;
      check.setAttribute('role', 'switch');
      check.setAttribute('aria-label', 'Show ' + f.label.toLowerCase() + ' on the frame');
      check.addEventListener('change', function () {
        state.on[f.id] = check.checked;
        row.classList.toggle('off', !check.checked);
        storageSet();
        schedule();
      });
      input.addEventListener('input', function () {
        if (f.id === 'credit') { state.credit = input.value; storageSet(); }
        else if (current()) current().values[f.id] = input.value;
        // Typing into a field that is switched off turns it on, since that is what was meant.
        if (input.value && !state.on[f.id]) { state.on[f.id] = true; check.checked = true; row.classList.remove('off'); storageSet(); }
        schedule();
      });
      row.appendChild(label);
      row.appendChild(input);
      row.appendChild(check);
      (f.group === 'credit' ? els.fieldsCredit : els.fieldsCamera).appendChild(row);
    });
  }

  function pressed(container, value) {
    Array.prototype.forEach.call(container.children, function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.value === value));
    });
  }

  function syncControls() {
    var photo = current();
    FIELDS.forEach(function (f) {
      $('on-' + f.id).checked = !!state.on[f.id];
      var input = $('val-' + f.id);
      var v = f.id === 'credit' ? state.credit : photo ? photo.values[f.id] || '' : '';
      if (input.value !== v) input.value = v;
      $('field-' + f.id).classList.toggle('off', !state.on[f.id]);
    });
    pressed(els.formats, state.format);
    pressed(els.borders, state.border);
    pressed(els.layouts, state.layout);
    pressed(els.types, state.type);
    var match = false;
    Array.prototype.forEach.call(els.swatches.querySelectorAll('.swatch'), function (b) {
      var active = b.dataset.hex.toLowerCase() === state.color.toLowerCase();
      b.setAttribute('aria-pressed', String(active));
      match = match || active;
    });
    els.color.value = state.color;
    els.custom.style.setProperty('--c', state.color);
    els.custom.classList.toggle('active', !match);
    syncPhotoUi();
  }

  function syncPhotoUi() {
    var photo = current();
    var n = state.photos.length;
    els.main.classList.toggle('empty', !n);
    els.export.disabled = !photo || busy;
    els.export.textContent = n > 1 ? 'Export this photo' : 'Export';
    els.exportAll.hidden = n < 2;
    els.exportAll.textContent = 'Export all ' + n;
    els.share.hidden = !canShareFiles;
    els.share.lastChild.nodeValue = n > 1 ? ' Share all ' + n : ' Share';
    els.copy.hidden = !canCopy;
    els.remove.hidden = !photo;
    els.remove.textContent = n > 1 ? 'Remove this photo' : 'Remove photo';
    [els.share, els.copy, els.exportAll].forEach(function (b) { b.disabled = busy; });
    // An odd one out spans the row so the footer stays tidy.
    var shown = Array.prototype.filter.call(els.secondary.children, function (b) { return !b.hidden; });
    shown.forEach(function (b, i) { b.style.gridColumn = i === shown.length - 1 && shown.length % 2 ? '1 / -1' : ''; });
    els.meta.textContent = photo ? photo.fileName + '  ·  ' + photo.width + ' × ' + photo.height : '';
    els.reset.hidden = !photo || !photo.found;

    var thumbs = els.strip.querySelectorAll('.thumb');
    Array.prototype.forEach.call(thumbs, function (t, i) {
      t.setAttribute('aria-current', String(i === state.current));
      if (i === state.current && typeof t.scrollIntoView === 'function') t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    els.strip.hidden = n < 2;
  }

  function setColor(hex) {
    state.color = hex;
    syncControls();
    storageSet();
    schedule();
  }

  function select(index) {
    if (index < 0 || index >= state.photos.length) return;
    state.current = index;
    syncControls();
    schedule();
  }

  /* ---------- loading ---------- */

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsArrayBuffer(file);
    });
  }

  function decode(file) {
    // Applies the EXIF orientation, so a vertical frame comes out vertical.
    return window.createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () {
      return window.createImageBitmap(file);
    });
  }

  function isHeic(file) {
    return /^image\/hei[cf]/.test(file.type) || /\.hei[cf]$/i.test(file.name);
  }

  function accepted(file) {
    return /^image\/(jpeg|png|webp)$/.test(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name) || isHeic(file);
  }

  function thumbFor(photo) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'thumb';
    b.title = photo.fileName;
    b.setAttribute('aria-label', photo.fileName);
    var c = document.createElement('canvas');
    var side = 112;
    c.width = side;
    c.height = side;
    var s = Math.max(side / photo.preview.width, side / photo.preview.height);
    var w = photo.preview.width * s;
    var h = photo.preview.height * s;
    c.getContext('2d').drawImage(photo.preview, (side - w) / 2, (side - h) / 2, w, h);
    b.appendChild(c);
    b.addEventListener('click', function () { select(state.photos.indexOf(photo)); });
    photo.thumb = b;
    return b;
  }

  /** Reads one file into a photo: EXIF values, size and a small preview. The full image is decoded again at export. */
  function loadOne(file) {
    return Promise.all([readFile(file), decode(file)]).then(function (res) {
      var info = core.readExif(res[0]);
      var bitmap = res[1];
      try {
        if (!bitmap.width || !bitmap.height) throw new Error('empty');
        if (bitmap.width * bitmap.height > MAX_PIXELS) throw new Error('too-big');
        var scale = Math.min(1, PREVIEW_SOURCE / Math.max(bitmap.width, bitmap.height));
        var small = document.createElement('canvas');
        small.width = Math.max(1, Math.round(bitmap.width * scale));
        small.height = Math.max(1, Math.round(bitmap.height * scale));
        var sctx = small.getContext('2d');
        sctx.imageSmoothingQuality = 'high';
        sctx.drawImage(bitmap, 0, 0, small.width, small.height);
        var values = {};
        EXIF_KEYS.forEach(function (k) { values[k] = info[k] || ''; });
        values.caption = '';
        return {
          id: nextId++,
          file: file,
          fileName: file.name || 'Pasted photo',
          name: (file.name || 'photo').replace(/\.[^.]+$/, '') || 'photo',
          width: bitmap.width,
          height: bitmap.height,
          preview: small,
          info: info,
          values: values,
          found: ['camera', 'lens', 'focal', 'aperture', 'shutter', 'iso'].some(function (k) { return info[k]; })
        };
      } finally {
        if (bitmap.close) bitmap.close();
      }
    });
  }

  function addFiles(list) {
    var files = Array.prototype.slice.call(list || []);
    if (!files.length || busy) return;
    var good = files.filter(accepted);
    var room = MAX_PHOTOS - state.photos.length;
    if (!good.length) { setStatus('Use a JPEG, PNG, WebP or HEIC photo.', 'error'); return; }
    if (room <= 0) { setStatus('That is the limit of ' + MAX_PHOTOS + ' photos. Remove one to add another.', 'error'); return; }
    var skipped = files.length - good.length + Math.max(0, good.length - room);
    good = good.slice(0, room);

    setBusy(true);
    setStatus(good.length > 1 ? 'Reading ' + good.length + ' photos…' : 'Reading photo…');
    var failed = [];
    var firstNew = -1;
    // One at a time keeps memory flat when someone drops a dozen 50 MP files.
    var chain = Promise.resolve();
    good.forEach(function (file) {
      chain = chain.then(function () {
        return loadOne(file).then(function (photo) {
          state.photos.push(photo);
          els.strip.insertBefore(thumbFor(photo), els.addThumb);
          if (firstNew < 0) firstNew = state.photos.length - 1;
          if (state.current < 0 || firstNew === state.photos.length - 1) select(state.photos.length - 1);
          else syncPhotoUi();
        }, function (err) {
          failed.push({ file: file, err: err });
        });
      });
    });
    chain.then(function () {
      setBusy(false);
      syncControls();
      if (failed.length) {
        var f = failed[0];
        var why = f.err && f.err.message === 'too-big' ? ' is too large to frame in a browser (over 200 megapixels).'
          : isHeic(f.file) ? ' is HEIC, which this browser cannot open. Try Safari, or export it as a JPEG.'
          : ' could not be opened as a photo.';
        setStatus((failed.length > 1 ? failed.length + ' files could not be opened. ' : '') + '“' + (f.file.name || 'That file') + '”' + why, 'error');
      } else if (skipped) {
        setStatus(skipped + (skipped === 1 ? ' file was' : ' files were') + ' skipped. Up to ' + MAX_PHOTOS + ' JPEG, PNG, WebP or HEIC photos at a time.', 'warn');
      } else {
        renderPreview();
      }
    });
  }

  function removeCurrent() {
    var photo = current();
    if (!photo || busy) return;
    state.photos.splice(state.current, 1);
    if (photo.thumb) photo.thumb.remove();
    state.current = Math.min(state.current, state.photos.length - 1);
    invalidate();
    syncControls();
    if (state.photos.length) schedule();
    else { setStatus(''); els.choose.focus(); }
  }

  function resetCurrent() {
    var photo = current();
    if (!photo) return;
    EXIF_KEYS.forEach(function (k) { photo.values[k] = photo.info[k] || ''; });
    syncControls();
    schedule();
  }

  /* ---------- export ---------- */

  var busy = false;
  function setBusy(on) {
    busy = on;
    syncPhotoUi();
  }

  function toBlob(canvas, type) {
    return new Promise(function (resolve) {
      try { canvas.toBlob(resolve, type.mime, type.quality); } catch (e) { resolve(null); }
    });
  }

  /** Renders one photo at full size from its original file. Steps down when the browser caps canvas size. */
  function render(photo, typeKey) {
    var type = TYPES[typeKey || state.type];
    var target = outputSize(photo, true);
    return decode(photo.file).then(function (bitmap) {
      var width = target;
      var attempt = 0;
      function run() {
        var canvas = document.createElement('canvas');
        var ok = null;
        try { ok = draw(canvas, photo, bitmap, width); } catch (e) { ok = null; }
        return (ok ? toBlob(canvas, type) : Promise.resolve(null)).then(function (blob) {
          var w = canvas.width;
          var h = canvas.height;
          // Free the backing store now instead of waiting for GC (matters on iPhone).
          canvas.width = canvas.height = 0;
          if (blob) return { blob: blob, width: w, height: h, scaled: width < target, name: core.exportName(photo.fileName, type.ext), mime: type.mime };
          attempt += 1;
          // Some browsers cap canvas size (iPhone Safari is the tight one), so step down.
          if (attempt > 6) throw new Error('canvas');
          width = Math.floor(width * 0.75);
          return run();
        });
      }
      return run().then(function (res) {
        if (bitmap.close) bitmap.close();
        return res;
      }, function (err) {
        if (bitmap.close) bitmap.close();
        throw err;
      });
    });
  }

  function download(res) {
    var url = URL.createObjectURL(res.blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = res.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  function sizeText(bytes) {
    return bytes > 1e6 ? (bytes / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1e3)) + ' KB';
  }

  function savedText(res) {
    return 'Saved ' + res.width + ' × ' + res.height + ', ' + sizeText(res.blob.size) +
      (res.scaled ? '. This browser limits image size, so it was scaled down to fit.' : '.');
  }

  function failText() {
    return 'This browser could not render the export. Try a smaller photo or another browser.';
  }

  function exportCurrent() {
    var photo = current();
    if (!photo || busy) return;
    setBusy(true);
    setStatus('Rendering…');
    render(photo).then(function (res) {
      download(res);
      setStatus(savedText(res));
    }, function () {
      setStatus(failText(), 'error');
    }).then(function () { setBusy(false); });
  }

  function exportAll() {
    if (busy || !state.photos.length) return;
    var photos = state.photos.slice();
    setBusy(true);
    var done = 0;
    var failed = 0;
    var chain = Promise.resolve();
    photos.forEach(function (photo, i) {
      chain = chain.then(function () {
        setStatus('Rendering ' + (i + 1) + ' of ' + photos.length + '…');
        return render(photo).then(function (res) {
          download(res);
          done += 1;
          // Browsers drop rapid back-to-back downloads, so leave a beat between them.
          return new Promise(function (r) { window.setTimeout(r, 350); });
        }, function () { failed += 1; });
      });
    });
    chain.then(function () {
      setBusy(false);
      if (failed) setStatus(done + ' saved. ' + failed + ' could not be rendered in this browser.', 'error');
      else setStatus('Saved ' + done + ' photos. If only one arrived, allow multiple downloads for this site.');
    });
  }

  /* Share needs a recent tap, and rendering can outlast it (Safari is strict). The rendered files are
     kept, so if the first tap times out the next tap shares them instantly. `ready` is cleared by any edit. */
  var ready = null;
  function invalidate() { ready = null; }

  var canShareFiles = (function () {
    try {
      return !!(navigator.share && navigator.canShare &&
        navigator.canShare({ files: [new File([new Blob(['x'], { type: 'image/jpeg' })], 'x.jpg', { type: 'image/jpeg' })] }));
    } catch (e) { return false; }
  })();
  var canCopy = !!(navigator.clipboard && navigator.clipboard.write && window.ClipboardItem);

  function shareFiles(files) {
    return navigator.share({ files: files }).then(function () {
      setStatus(files.length > 1 ? 'Shared ' + files.length + ' photos.' : 'Shared.');
    }, function (err) {
      if (err && err.name === 'AbortError') { setStatus(''); return; }
      if (err && err.name === 'NotAllowedError') { setStatus('Ready. Tap Share again to send.', 'warn'); return; }
      setStatus('Sharing did not work here. Use Export instead.', 'error');
    });
  }

  function share() {
    if (busy || !state.photos.length) return;
    if (ready) { shareFiles(ready); return; }
    var photos = state.photos.slice();
    setBusy(true);
    var files = [];
    var chain = Promise.resolve();
    photos.forEach(function (photo, i) {
      chain = chain.then(function () {
        setStatus(photos.length > 1 ? 'Preparing ' + (i + 1) + ' of ' + photos.length + '…' : 'Preparing…');
        return render(photo).then(function (res) { files.push(new File([res.blob], res.name, { type: res.mime })); });
      });
    });
    chain.then(function () {
      setBusy(false);
      ready = files;
      return shareFiles(files);
    }, function () {
      setBusy(false);
      setStatus(failText(), 'error');
    });
  }

  function copy() {
    var photo = current();
    if (!photo || busy) return;
    setBusy(true);
    setStatus('Copying…');
    // The clipboard takes PNG only. Passing the promise keeps Safari's tap permission alive while it renders.
    var blob = render(photo, 'png').then(function (res) { return res.blob; });
    var item;
    try { item = new window.ClipboardItem({ 'image/png': blob }); } catch (e) { item = null; }
    (item ? navigator.clipboard.write([item]) : Promise.reject(new Error('clipboard'))).then(function () {
      setStatus('Copied. Paste it anywhere.');
    }, function () {
      setStatus('This browser would not copy the image. Use Export instead.', 'error');
    }).then(function () { setBusy(false); });
    blob.catch(function () { /* reported above */ });
  }

  /* ---------- wiring ---------- */

  function applyTheme() {
    // Follows the light/dark choice made on /apps; otherwise the system setting.
    try {
      var t = window.localStorage.getItem('apps-theme');
      if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    } catch (e) { /* system setting */ }
  }

  function typing(e) {
    var t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  function init() {
    applyTheme();
    ['main', 'stage', 'canvas', 'strip', 'swatches', 'color', 'custom', 'status', 'file', 'export', 'exportAll', 'share', 'copy',
      'remove', 'choose', 'formats', 'borders', 'layouts', 'types', 'fieldsCredit', 'fieldsCamera', 'meta', 'reset', 'secondary'].forEach(function (id) {
      els[id] = $(id.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); }));
    });

    var add = document.createElement('button');
    add.type = 'button';
    add.className = 'add-thumb';
    add.title = 'Add photos';
    add.setAttribute('aria-label', 'Add photos');
    add.innerHTML = '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 3v12M3 9h12"/></svg>';
    add.addEventListener('click', function () { els.file.click(); });
    els.strip.appendChild(add);
    els.addThumb = add;

    var stored = storageGet();
    FIELDS.forEach(function (f) { state.on[f.id] = f.on; });
    if (stored) {
      if (stored.format in FORMATS) state.format = stored.format;
      if (stored.border in BORDERS) state.border = stored.border;
      if (stored.layout in LAYOUTS) state.layout = stored.layout;
      if (stored.type in TYPES) state.type = stored.type;
      if (/^#[0-9a-f]{6}$/i.test(stored.color || '')) state.color = stored.color;
      if (stored.on) FIELDS.forEach(function (f) { if (typeof stored.on[f.id] === 'boolean') state.on[f.id] = stored.on[f.id]; });
      if (typeof stored.credit === 'string') state.credit = stored.credit.slice(0, 120);
    }
    buildControls();
    syncControls();

    els.color.addEventListener('input', function () { setColor(els.color.value); });
    els.file.addEventListener('change', function () { addFiles(els.file.files); els.file.value = ''; });
    els.choose.addEventListener('click', function () { els.file.click(); });
    els.export.addEventListener('click', exportCurrent);
    els.exportAll.addEventListener('click', exportAll);
    els.share.addEventListener('click', share);
    els.copy.addEventListener('click', copy);
    els.remove.addEventListener('click', removeCurrent);
    els.reset.addEventListener('click', resetCurrent);

    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        exportCurrent();
        return;
      }
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowLeft' && state.current > 0) { e.preventDefault(); select(state.current - 1); }
      if (e.key === 'ArrowRight' && state.current < state.photos.length - 1) { e.preventDefault(); select(state.current + 1); }
    });

    var depth = 0;
    function hasFiles(e) {
      var types = e.dataTransfer && e.dataTransfer.types;
      return !!types && Array.prototype.indexOf.call(types, 'Files') >= 0;
    }
    document.addEventListener('dragenter', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      els.stage.classList.add('dragging');
    });
    document.addEventListener('dragover', function (e) { if (hasFiles(e)) e.preventDefault(); });
    document.addEventListener('dragleave', function (e) {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) els.stage.classList.remove('dragging');
    });
    document.addEventListener('drop', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      els.stage.classList.remove('dragging');
      addFiles(e.dataTransfer.files);
    });
    document.addEventListener('paste', function (e) {
      var files = e.clipboardData && e.clipboardData.files;
      if (files && files.length) { e.preventDefault(); addFiles(files); }
    });

    // Draw again once Gotham arrives, so the first frame doesn't use the fallback face.
    if (document.fonts && document.fonts.load) {
      Promise.all([document.fonts.load('700 20px Gotham'), document.fonts.load('500 20px Gotham'), document.fonts.load('400 20px Gotham')])
        .then(function () { schedule(); }, function () { /* system font stays */ });
    }
  }

  init();
})();
