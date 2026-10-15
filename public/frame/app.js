/* Photo Frame — drop a photo, get it matted with its camera settings under it.
   Everything runs in this tab: the file is read with FileReader, decoded with
   createImageBitmap, drawn on a canvas and saved as PNG. Nothing is uploaded.
   Only the frame color, the credit and the on/off choices live in localStorage. */
(function () {
  'use strict';

  var core = window.PhotoFrameCore;
  var STORE = 'photo-frame-v1';
  var PREVIEW_WIDTH = 1400;
  var FONT = '"Gotham", system-ui, -apple-system, "Segoe UI", sans-serif';

  var FIELDS = [
    { id: 'credit', label: 'Credit', cell: 'Photo', kind: 'id', on: true, ph: 'Name' },
    { id: 'caption', label: 'Caption', cell: 'Caption', kind: 'id', on: false, ph: 'Wisconsin vs. Iowa' },
    { id: 'camera', label: 'Camera', cell: 'Camera', kind: 'gear', on: true, ph: 'Sony A1' },
    { id: 'lens', label: 'Lens', cell: 'Lens', kind: 'gear', on: true, ph: 'FE 70-200mm F2.8 GM OII' },
    { id: 'date', label: 'Date', cell: 'Date', kind: 'gear', on: false, ph: 'Oct 14, 2026' },
    { id: 'focal', label: 'Focal length', cell: 'Focal length', kind: 'stat', on: true, ph: '200 mm' },
    { id: 'aperture', label: 'Aperture', cell: 'Aperture', kind: 'stat', on: true, ph: 'f/2.8' },
    { id: 'shutter', label: 'Shutter', cell: 'Shutter', kind: 'stat', on: true, ph: '1/1000 s' },
    { id: 'iso', label: 'ISO', cell: 'ISO', kind: 'stat', on: true, ph: '800' }
  ];

  var SWATCHES = [
    { name: 'Black', hex: '#000000' },
    { name: 'Charcoal', hex: '#1c1c1f' },
    { name: 'White', hex: '#ffffff' },
    { name: 'Bone', hex: '#f1eee7' },
    { name: 'Badger red', hex: '#a00000' }
  ];

  var FORMATS = {
    '4x5': { label: '4:5', ratio: 4 / 5 },
    '1x1': { label: '1:1', ratio: 1 },
    '9x16': { label: '9:16', ratio: 9 / 16 },
    original: { label: 'Original', ratio: 0 }
  };

  var state = { format: '4x5', color: '#000000', on: {}, values: {}, name: 'photo', bitmap: null, preview: null, width: 0, height: 0 };
  var saved = { credit: '' };

  var $ = function (id) { return document.getElementById(id); };
  var els = {};

  function storageGet() {
    try { return JSON.parse(window.localStorage.getItem(STORE) || 'null'); } catch (e) { return null; }
  }
  function storageSet() {
    try {
      window.localStorage.setItem(STORE, JSON.stringify({ format: state.format, color: state.color, on: state.on, credit: saved.credit }));
    } catch (e) { /* private mode: the choices just don't stick */ }
  }

  /* ---------- drawing ---------- */

  function tracked(ctx, text, x, y, space) {
    var cx = x;
    for (var i = 0; i < text.length; i++) {
      ctx.fillText(text[i], cx, y);
      cx += ctx.measureText(text[i]).width + space;
    }
  }
  function trackedWidth(ctx, text, space) {
    var w = 0;
    for (var i = 0; i < text.length; i++) w += ctx.measureText(text[i]).width + space;
    return Math.max(0, w - space);
  }
  function fit(ctx, text, max) {
    if (ctx.measureText(text).width <= max) return text;
    var t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
    return t + '…';
  }

  function cellsFor() {
    var out = { left: [], right: [] };
    FIELDS.forEach(function (f) {
      var value = (state.values[f.id] || '').trim();
      if (!state.on[f.id] || !value) return;
      (f.kind === 'stat' ? out.right : out.left).push({ label: f.cell, value: value, strong: f.id !== 'caption' });
    });
    return out;
  }

  /** Rows of cells for a footer `innerW` wide, plus their height. All sizes derive from the unit `u`. */
  function layoutFooter(u, z, innerW) {
    var probe = document.createElement('canvas').getContext('2d');
    var cells = cellsFor();
    var gap = z.gap * u;
    function measure(cell) {
      probe.font = '700 ' + z.value * u + 'px ' + FONT;
      var vw = probe.measureText(cell.value).width;
      probe.font = '700 ' + z.label * u + 'px ' + FONT;
      var lw = trackedWidth(probe, cell.label.toUpperCase(), z.label * u * 0.16);
      cell.w = Math.min(Math.max(vw, lw), innerW);
    }
    cells.left.concat(cells.right).forEach(measure);
    function span(list) {
      return list.reduce(function (n, c, i) { return n + c.w + (i ? gap : 0); }, 0);
    }
    function wrap(list) {
      var rows = [];
      var row = [];
      var used = 0;
      list.forEach(function (c) {
        var next = row.length ? used + gap + c.w : c.w;
        if (row.length && next > innerW) { rows.push(row); row = []; next = c.w; }
        row.push(c);
        used = next;
      });
      if (row.length) rows.push(row);
      return rows;
    }
    var rows = [];
    if (cells.left.length && cells.right.length && span(cells.left) + span(cells.right) + 2 * gap <= innerW) {
      rows.push({ left: cells.left, right: cells.right });
    } else {
      wrap(cells.left).forEach(function (r) { rows.push({ left: r, right: [] }); });
      wrap(cells.right).forEach(function (r) { rows.push({ left: r, right: [] }); });
    }
    var cellH = (z.label + z.labelGap + z.value) * u;
    var rowGap = z.rowGap * u;
    return {
      rows: rows,
      span: span,
      cellH: cellH,
      rowGap: rowGap,
      gap: gap,
      lead: z.lead * u,
      h: rows.length ? z.lead * u + rows.length * cellH + (rows.length - 1) * rowGap : 0
    };
  }

  var ORIGINAL_SIZES = { pad: 4, gap: 5, label: 1.25, labelGap: 1.1, value: 2.6, rowGap: 3, lead: 3.4, tail: 4 };
  var SOCIAL_SIZES = { pad: 5, gap: 4, label: 1.7, labelGap: 1.3, value: 3.4, rowGap: 3.2, lead: 4, tail: 0 };

  /**
   * Draws the framed photo into `canvas`. For a fixed ratio `size` is the canvas width and the photo
   * is fitted inside it with its credit strip, centered. For Original it is the photo's width and the
   * canvas grows around it.
   */
  function draw(canvas, source, size) {
    var ratio = FORMATS[state.format].ratio;
    var asp = state.height / state.width;
    var ink = core.inkFor(state.color);
    var z, u, fu, W, H, photoW, photoH, footer, left, top;

    if (ratio) {
      z = SOCIAL_SIZES;
      W = Math.round(size);
      H = Math.round(size / ratio);
      u = W / 100;
      var pad = z.pad * u;
      photoW = W - 2 * pad;
      // A tall photo narrows the column, so the type steps down with it and the strip stays short.
      var inner = W - 2 * pad;
      for (var i = 0; i < 6; i++) {
        fu = u * Math.max(0.72, Math.min(1, photoW / inner));
        footer = layoutFooter(fu, z, photoW);
        var room = Math.min(W - 2 * pad, (H - 2 * pad - footer.h) / asp);
        if (Math.abs(room - photoW) < 1) break;
        photoW = Math.max(u, room);
      }
      photoH = photoW * asp;
      var block = photoH + footer.h;
      left = (W - photoW) / 2;
      top = (H - block) / 2;
    } else {
      z = ORIGINAL_SIZES;
      photoW = size;
      photoH = Math.round(size * asp);
      u = Math.min(photoW, photoH) / 100;
      fu = u;
      footer = layoutFooter(u, z, photoW);
      W = Math.round(photoW + 2 * z.pad * u);
      H = Math.round(z.pad * u + photoH + footer.h + (footer.rows.length ? z.tail * u : z.pad * u));
      left = z.pad * u;
      top = z.pad * u;
    }

    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d');
    if (!ctx || canvas.width !== W || canvas.height !== H) return false;

    ctx.fillStyle = state.color;
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, left, top, photoW, photoH);
    ctx.strokeStyle = ink.hair;
    ctx.lineWidth = Math.max(1, u * 0.12);
    ctx.strokeRect(left - ctx.lineWidth / 2, top - ctx.lineWidth / 2, photoW + ctx.lineWidth, photoH + ctx.lineWidth);

    ctx.textBaseline = 'alphabetic';
    var y = top + photoH + footer.lead;
    var labelSize = z.label * fu;
    var valueSize = z.value * fu;
    footer.rows.forEach(function (row) {
      function paint(list, startX) {
        var x = startX;
        list.forEach(function (c) {
          ctx.fillStyle = ink.dim;
          ctx.font = '700 ' + labelSize + 'px ' + FONT;
          tracked(ctx, c.label.toUpperCase(), x, y + labelSize, labelSize * 0.16);
          ctx.fillStyle = ink.ink;
          ctx.font = (c.strong ? '700 ' : '400 ') + valueSize + 'px ' + FONT;
          ctx.fillText(fit(ctx, c.value, photoW), x, y + labelSize + z.labelGap * fu + valueSize * 0.82);
          x += c.w + footer.gap;
        });
      }
      paint(row.left, left);
      if (row.right.length) paint(row.right, left + photoW - footer.span(row.right));
      y += footer.cellH + footer.rowGap;
    });
    return true;
  }

  function outputSize(forExport) {
    var f = FORMATS[state.format];
    if (f.ratio) return forExport ? 2160 : 1080;
    return forExport ? state.width : state.preview.width;
  }

  /* ---------- page ---------- */

  function setStatus(message, isError) {
    els.status.textContent = message || '';
    els.status.classList.toggle('error', !!isError);
  }

  function renderPreview() {
    if (!state.preview) return;
    draw(els.canvas, state.preview, outputSize(false));
    els.canvas.setAttribute('aria-label', 'Framed preview of ' + state.name);
  }

  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(function () { queued = false; renderPreview(); });
  }

  function buildControls() {
    els.swatches.innerHTML = '';
    SWATCHES.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.setProperty('--c', s.hex);
      b.title = s.name;
      b.setAttribute('aria-label', s.name);
      b.dataset.hex = s.hex;
      b.addEventListener('click', function () { setColor(s.hex); });
      els.swatches.appendChild(b);
    });

    els.formats.innerHTML = '';
    Object.keys(FORMATS).forEach(function (key) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'seg-button';
      b.textContent = FORMATS[key].label;
      b.dataset.format = key;
      b.addEventListener('click', function () { state.format = key; syncControls(); storageSet(); schedule(); });
      els.formats.appendChild(b);
    });

    els.fields.innerHTML = '';
    FIELDS.forEach(function (f) {
      var row = document.createElement('div');
      row.className = 'field';
      var check = document.createElement('input');
      check.type = 'checkbox';
      check.id = 'on-' + f.id;
      check.checked = !!state.on[f.id];
      check.setAttribute('aria-label', 'Show ' + f.label);
      var label = document.createElement('label');
      label.htmlFor = 'val-' + f.id;
      label.textContent = f.label;
      var input = document.createElement('input');
      input.type = 'text';
      input.id = 'val-' + f.id;
      input.placeholder = f.ph;
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.value = state.values[f.id] || '';
      check.addEventListener('change', function () { state.on[f.id] = check.checked; storageSet(); schedule(); });
      input.addEventListener('input', function () {
        state.values[f.id] = input.value;
        if (f.id === 'credit') { saved.credit = input.value; storageSet(); }
        schedule();
      });
      row.appendChild(check);
      row.appendChild(label);
      row.appendChild(input);
      els.fields.appendChild(row);
    });
  }

  function syncControls() {
    FIELDS.forEach(function (f) {
      $('on-' + f.id).checked = !!state.on[f.id];
      $('val-' + f.id).value = state.values[f.id] || '';
    });
    Array.prototype.forEach.call(els.formats.children, function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.format === state.format));
    });
    var match = false;
    Array.prototype.forEach.call(els.swatches.children, function (b) {
      var active = b.dataset.hex.toLowerCase() === state.color.toLowerCase();
      b.setAttribute('aria-pressed', String(active));
      match = match || active;
    });
    els.color.value = state.color;
    els.colorHex.textContent = state.color.toUpperCase();
    els.custom.classList.toggle('active', !match);
  }

  function setColor(hex) {
    state.color = hex;
    syncControls();
    storageSet();
    schedule();
  }

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

  function loadPhoto(file) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) {
      setStatus('Use a JPEG, PNG or WebP photo.', true);
      return;
    }
    setStatus('Reading photo…');
    Promise.all([readFile(file), decode(file)]).then(function (res) {
      var info = core.readExif(res[0]);
      var bitmap = res[1];
      state.bitmap = bitmap;
      state.width = bitmap.width;
      state.height = bitmap.height;
      state.name = file.name.replace(/\.[^.]+$/, '') || 'photo';
      var scale = Math.min(1, PREVIEW_WIDTH / bitmap.width);
      var small = document.createElement('canvas');
      small.width = Math.max(1, Math.round(bitmap.width * scale));
      small.height = Math.max(1, Math.round(bitmap.height * scale));
      var sctx = small.getContext('2d');
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(bitmap, 0, 0, small.width, small.height);
      state.preview = small;
      ['camera', 'lens', 'focal', 'aperture', 'shutter', 'iso', 'date'].forEach(function (k) { state.values[k] = info[k] || ''; });
      state.values.credit = saved.credit || info.artist || '';
      state.values.caption = '';
      els.stage.classList.add('has-photo');
      els.fileName.textContent = file.name;
      els.export.disabled = false;
      syncControls();
      renderPreview();
      var found = ['camera', 'lens', 'focal', 'aperture', 'shutter', 'iso'].filter(function (k) { return info[k]; }).length;
      setStatus(found ? '' : 'No camera settings found in this file. Type them in on the left.');
    }).catch(function () {
      setStatus('That file could not be opened as a photo.', true);
    });
  }

  function toBlob(canvas) {
    return new Promise(function (resolve) { canvas.toBlob(resolve, 'image/png'); });
  }

  function exportPng() {
    if (!state.bitmap) return;
    els.export.disabled = true;
    setStatus('Rendering full resolution…');
    var width = outputSize(true);
    var attempt = 0;
    function run() {
      var canvas = document.createElement('canvas');
      var ok = false;
      try { ok = draw(canvas, state.bitmap, width); } catch (e) { ok = false; }
      return (ok ? toBlob(canvas) : Promise.resolve(null)).then(function (blob) {
        if (blob) return { blob: blob, canvas: canvas };
        attempt += 1;
        // Some browsers cap canvas size (iPhone Safari is the tight one), so step down.
        if (attempt > 5) throw new Error('canvas');
        width = Math.floor(width * 0.75);
        return run();
      });
    }
    run().then(function (res) {
      var url = URL.createObjectURL(res.blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = state.name + '-framed.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      var reduced = width < outputSize(true);
      setStatus('Saved ' + a.download + ' (' + res.canvas.width + ' × ' + res.canvas.height + ')' +
        (reduced ? '. This browser limits canvas size, so it was scaled down to fit.' : '.'));
    }).catch(function () {
      setStatus('This browser could not render the export. Try a smaller photo or another browser.', true);
    }).then(function () { els.export.disabled = !state.bitmap; });
  }

  function init() {
    ['stage', 'canvas', 'fields', 'swatches', 'color', 'colorHex', 'custom', 'status', 'file', 'fileName', 'export', 'drop', 'choose', 'formats'].forEach(function (id) {
      els[id] = $(id.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); }));
    });
    var stored = storageGet();
    FIELDS.forEach(function (f) { state.on[f.id] = f.on; });
    if (stored) {
      if (stored.format in FORMATS) state.format = stored.format;
      if (/^#[0-9a-f]{6}$/i.test(stored.color || '')) state.color = stored.color;
      if (stored.on) FIELDS.forEach(function (f) { if (typeof stored.on[f.id] === 'boolean') state.on[f.id] = stored.on[f.id]; });
      if (typeof stored.credit === 'string') saved.credit = stored.credit;
    }
    state.values.credit = saved.credit;
    buildControls();
    syncControls();

    els.color.addEventListener('input', function () { setColor(els.color.value); });
    els.file.addEventListener('change', function () { loadPhoto(els.file.files[0]); els.file.value = ''; });
    els.export.addEventListener('click', exportPng);
    els.choose.addEventListener('click', function () { els.file.click(); });
    els.drop.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.file.click(); }
    });

    ['dragenter', 'dragover'].forEach(function (type) {
      document.addEventListener(type, function (e) { e.preventDefault(); els.stage.classList.add('dragging'); });
    });
    ['dragleave', 'drop'].forEach(function (type) {
      document.addEventListener(type, function (e) {
        e.preventDefault();
        if (type === 'drop' || !e.relatedTarget) els.stage.classList.remove('dragging');
      });
    });
    document.addEventListener('drop', function (e) {
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) loadPhoto(file);
    });
    document.addEventListener('paste', function (e) {
      var files = e.clipboardData && e.clipboardData.files;
      if (files && files[0]) loadPhoto(files[0]);
    });

    // Draw again once Gotham arrives, so the first frame doesn't use the fallback face.
    if (document.fonts && document.fonts.load) {
      Promise.all([document.fonts.load('700 20px Gotham'), document.fonts.load('400 20px Gotham')])
        .then(function () { schedule(); }, function () { /* system font stays */ });
    }
  }

  init();
})();
