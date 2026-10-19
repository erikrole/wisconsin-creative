/* Photo Frame — drop a photo, get it matted with its credit and camera settings.
   Everything runs in this tab: the file is read with FileReader, decoded with
   createImageBitmap, drawn on a canvas and saved as PNG. Nothing is uploaded.
   Only the size, frame color, credit and on/off choices live in localStorage. */
(function () {
  'use strict';

  var core = window.PhotoFrameCore;
  var STORE = 'photo-frame-v2';
  var PREVIEW_SOURCE = 1600;
  var FONT = '"Gotham", system-ui, -apple-system, "Segoe UI", sans-serif';

  var FIELDS = [
    { id: 'credit', label: 'Credit', on: true, ph: 'Photographer' },
    { id: 'caption', label: 'Caption', on: false, ph: 'Wisconsin vs. Iowa' },
    { id: 'camera', label: 'Camera', on: true, ph: 'Sony A1' },
    { id: 'lens', label: 'Lens', on: true, ph: 'FE 70-200mm F2.8 GM OII' },
    { id: 'date', label: 'Date', on: false, ph: 'Oct 14, 2026' },
    { id: 'focal', label: 'Focal length', on: true, ph: '200 mm' },
    { id: 'aperture', label: 'Aperture', on: true, ph: 'f/2.8' },
    { id: 'shutter', label: 'Shutter', on: true, ph: '1/1000 s' },
    { id: 'iso', label: 'ISO', on: true, ph: '800' }
  ];
  var STATS = ['focal', 'aperture', 'shutter', 'iso'];

  var FORMATS = {
    '4x5': { label: '4:5', ratio: 4 / 5 },
    '1x1': { label: '1:1', ratio: 1 },
    '9x16': { label: '9:16', ratio: 9 / 16 },
    original: { label: 'Original', ratio: 0 }
  };

  var SWATCHES = [
    { name: 'Black', hex: '#000000' },
    { name: 'Charcoal', hex: '#1c1c1f' },
    { name: 'White', hex: '#ffffff' },
    { name: 'Bone', hex: '#f1eee7' },
    { name: 'Badger red', hex: '#a00000' }
  ];

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

  function value(id) {
    return state.on[id] ? (state.values[id] || '').trim() : '';
  }

  /** The text on the strip: credit and stats on the first line, caption/date and gear on the second. */
  function content() {
    var stats = STATS.map(function (id) {
      var v = value(id);
      return v && id === 'iso' ? 'ISO ' + v : v;
    }).filter(Boolean);
    var sub = [value('caption'), value('date')].filter(Boolean).join('  ·  ');
    var gear = [value('camera'), value('lens')].filter(Boolean).join('  ·  ');
    return { credit: value('credit'), stats: stats, sub: sub, gear: gear };
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
  // or of the photo's short side (Original).
  var SIZES = {
    social: { pad: 5.5, big: 2.5, small: 1.9, lead: 3.6, line: 1, radius: 1.1, tail: 0 },
    original: { pad: 4, big: 2.1, small: 1.6, lead: 3.2, line: 0.9, radius: 0.7, tail: 0 }
  };


  /** Measures the strip for a column `innerW` wide and returns what to paint and how tall it is. */
  function layoutStrip(u, z, innerW) {
    var c = content();
    var probe = document.createElement('canvas').getContext('2d');
    var big = z.big * u;
    var small = z.small * u;
    var gap = big * 1.5;
    var side = big * 2.2;
    var lines = [];
    var h = 0;

    function width(text, size, weight) {
      probe.font = weight + ' ' + size + 'px ' + FONT;
      return probe.measureText(text).width;
    }
    function ellipsize(text, size, weight, max) {
      if (width(text, size, weight) <= max) return text;
      var t = text;
      while (t.length > 1 && width(t + '…', size, weight) > max) t = t.slice(0, -1);
      return t + '…';
    }
    function addLine(parts, size) {
      lines.push({ parts: parts, size: size, y: h });
      h += size * 1.5 + z.line * u;
    }

    // `left` and `right` are { text, weight, dim } or { stats, weight }; they share a row when they fit.
    function pair(left, right, size) {
      if (left) left.w = width(left.text, size, left.weight);
      if (right) right.w = right.stats
        ? right.stats.reduce(function (n, s, i) { return n + width(s, size, right.weight) + (i ? gap : 0); }, 0)
        : width(right.text, size, right.weight);
      if (left && right && left.w + right.w + side <= innerW) {
        left.align = 'left';
        right.align = 'right';
        addLine([left, right], size);
        return;
      }
      [left, right].forEach(function (p) {
        if (!p) return;
        p.align = 'left';
        if (p.text) { p.text = ellipsize(p.text, size, p.weight, innerW); p.w = width(p.text, size, p.weight); }
        addLine([p], size);
      });
    }

    pair(
      c.credit ? { text: c.credit, weight: 700 } : null,
      c.stats.length ? { stats: c.stats, weight: 500 } : null,
      big
    );
    pair(
      c.sub ? { text: c.sub, weight: 400, dim: true } : null,
      c.gear ? { text: c.gear, weight: 400, dim: true } : null,
      small
    );
    if (h) h -= z.line * u + lines[lines.length - 1].size * 0.25;
    return { lines: lines, h: h ? z.lead * u + h : 0, lead: z.lead * u, gap: gap };
  }

  function paintStrip(ctx, strip, ink, x0, y0, innerW) {
    strip.lines.forEach(function (line) {
      var y = y0 + strip.lead + line.y + line.size * 1.05;
      line.parts.forEach(function (p) {
        ctx.fillStyle = p.dim ? ink.dim : ink.ink;
        ctx.font = p.weight + ' ' + line.size + 'px ' + FONT;
        var x = p.align === 'right' ? x0 + innerW - p.w : x0;
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
   * Draws the framed photo into `canvas`. For a fixed ratio `size` is the canvas width and the photo
   * is fitted and centered with the strip under it. For Original it is the photo's width and the
   * canvas grows around it.
   */
  function draw(canvas, source, size) {
    var ratio = FORMATS[state.format].ratio;
    var asp = state.height / state.width;
    var ink = core.inkFor(state.color);
    var z, u, W, H, photoW, photoH, strip, left, top;

    if (ratio) {
      z = SIZES.social;
      W = Math.round(size);
      H = Math.round(size / ratio);
      u = W / 100;
      var pad = z.pad * u;
      var innerW = W - 2 * pad;
      photoW = innerW;
      // A tall photo narrows the column, so the strip is laid out again at that width.
      for (var i = 0; i < 6; i++) {
        strip = layoutStrip(u, z, photoW);
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
      strip = layoutStrip(u, z, photoW);
      W = Math.round(photoW + 2 * z.pad * u);
      H = Math.round(z.pad * u + photoH + strip.h + z.pad * u);
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
    ctx.save();
    roundRect(ctx, left, top, photoW, photoH, z.radius * u);
    ctx.clip();
    ctx.drawImage(source, left, top, photoW, photoH);
    ctx.restore();

    ctx.textBaseline = 'alphabetic';
    paintStrip(ctx, strip, ink, left, top + photoH, photoW);
    return true;
  }

  function outputSize(forExport) {
    if (FORMATS[state.format].ratio) return forExport ? 2160 : 1080;
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
    Object.keys(FORMATS).forEach(function (key) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'seg-button';
      b.textContent = FORMATS[key].label;
      b.dataset.format = key;
      b.addEventListener('click', function () { state.format = key; syncControls(); storageSet(); schedule(); });
      els.formats.appendChild(b);
    });

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
      var check = document.createElement('input');
      check.type = 'checkbox';
      check.id = 'on-' + f.id;
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
      check.addEventListener('change', function () {
        state.on[f.id] = check.checked;
        row.classList.toggle('off', !check.checked);
        storageSet();
        schedule();
      });
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
      $('on-' + f.id).parentNode.classList.toggle('off', !state.on[f.id]);
    });
    Array.prototype.forEach.call(els.formats.children, function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.format === state.format));
    });
    var match = false;
    Array.prototype.forEach.call(els.swatches.querySelectorAll('.swatch'), function (b) {
      var active = b.dataset.hex.toLowerCase() === state.color.toLowerCase();
      b.setAttribute('aria-pressed', String(active));
      match = match || active;
    });
    els.color.value = state.color;
    els.custom.style.setProperty('--c', state.color);
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
      var scale = Math.min(1, PREVIEW_SOURCE / bitmap.width);
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
      els.export.disabled = false;
      els.change.hidden = false;
      syncControls();
      renderPreview();
      var found = ['camera', 'lens', 'focal', 'aperture', 'shutter', 'iso'].filter(function (k) { return info[k]; }).length;
      setStatus(!found ? 'No camera settings found in this file. Open Details to type them in.' : state.values.credit ? '' : 'Add a credit in Details. It is remembered for next time.');
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
    setStatus('Rendering…');
    var target = outputSize(true);
    var width = target;
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
      setStatus('Saved ' + res.canvas.width + ' × ' + res.canvas.height + (width < target ? '. This browser limits canvas size, so it was scaled down to fit.' : ''));
    }).catch(function () {
      setStatus('This browser could not render the export. Try a smaller photo or another browser.', true);
    }).then(function () { els.export.disabled = !state.bitmap; });
  }

  function toggleDetails(open) {
    els.details.hidden = !open;
    els.detailsToggle.setAttribute('aria-expanded', String(open));
  }

  function init() {
    ['stage', 'canvas', 'fields', 'swatches', 'color', 'custom', 'status', 'file', 'export', 'drop', 'change', 'formats', 'details', 'detailsToggle'].forEach(function (id) {
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
    els.change.addEventListener('click', function () { els.file.click(); });
    els.detailsToggle.addEventListener('click', function () { toggleDetails(els.details.hidden); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !els.details.hidden) { toggleDetails(false); els.detailsToggle.focus(); }
    });
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
      Promise.all([document.fonts.load('700 20px Gotham'), document.fonts.load('500 20px Gotham'), document.fonts.load('400 20px Gotham')])
        .then(function () { schedule(); }, function () { /* system font stays */ });
    }
  }

  init();
})();
