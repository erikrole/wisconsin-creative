/* QR Studio — browser app. Rules live in core.js; this file is UI, rendering and storage. */
(function () {
  'use strict';

  var core = window.QRStudioCore;
  var BRANDS = window.QRStudioBrandLogos || {};

  function $(id) { return document.getElementById(id); }

  if (typeof window.QRCodeStyling !== 'function' || !core) {
    $('qr-code').textContent = '';
    $('stale-note').hidden = false;
    $('stale-note').textContent = 'The generator did not load. Keep vendor/, core.js and app.js next to index.html.';
    $('download').disabled = true;
    return;
  }

  var PREVIEW_SIZE = 1000;
  var THUMB_SIZE = 200;
  var SMALL_CHECK_PX = 240;
  var RENDER_DEBOUNCE_MS = 120;
  var SCAN_DEBOUNCE_MS = 350;
  var MAX_LOGO_INPUT_BYTES = 8 * 1024 * 1024;
  var RASTER_LOGO_MAX_PX = 1024;
  var MAX_LIBRARY_ITEMS = 60;
  var MAX_IMPORT_BYTES = 25 * 1024 * 1024;
  var EXPORT_DPI = 300;

  var KEYS = {
    library: 'qr-studio.library.v2',
    logos: 'qr-studio.logos.v2',
    session: 'qr-studio.session.v2',
    theme: 'qr-studio.theme.v1',
    libraryV1: 'qr-studio.library.v1'
  };

  var SAMPLE = 'https://uwbadgers.com';
  var LOOKS = [
    { id: 'ink', label: 'Ink', design: { style: 'square', fill: '#171717', background: '#FFFFFF', eye: null, logo: 'none', plate: 'none' } },
    { id: 'motion', label: 'Motion W', design: { style: 'square', fill: '#171717', background: '#FFFFFF', eye: null, logo: 'brand:motion-w', plate: 'none', logoScale: 24 } },
    { id: 'badger', label: 'Badger red', design: { style: 'dots', fill: '#A00000', background: '#FFFFFF', eye: null, logo: 'brand:motion-w-mono', plate: 'circle', plateColor: '#FFFFFF', logoScale: 26 } },
    { id: 'eyes', label: 'Red eyes', design: { style: 'soft', fill: '#171717', background: '#FFFFFF', eye: '#A00000', logo: 'brand:motion-w', plate: 'none', logoScale: 24 } },
    { id: 'cut', label: 'Charcoal', design: { style: 'cut', fill: '#282728', background: '#F7F4ED', eye: null, logo: 'none', plate: 'none' } },
    { id: 'clear', label: 'Transparent', design: { style: 'square', fill: '#171717', background: 'transparent', eye: null, logo: 'none', plate: 'none' } }
  ];

  var TYPE_ICONS = {
    url: '<path d="M6.5 9.5a3 3 0 0 0 4.2.2l2-2a3 3 0 0 0-4.2-4.2l-.7.7"/><path d="M9.5 6.5a3 3 0 0 0-4.2-.2l-2 2a3 3 0 0 0 4.2 4.2l.7-.7"/>',
    wifi: '<path d="M2 6.2a8.5 8.5 0 0 1 12 0M4.2 8.6a5.3 5.3 0 0 1 7.6 0M6.4 11a2.2 2.2 0 0 1 3.2 0"/><circle cx="8" cy="13" r=".6" fill="currentColor"/>',
    email: '<rect x="2" y="3.5" width="12" height="9" rx="1.5"/><path d="M2.5 4.5 8 9l5.5-4.5"/>',
    phone: '<path d="M5.5 2.5h-2a1 1 0 0 0-1 1.1A10.5 10.5 0 0 0 12.4 13.5a1 1 0 0 0 1.1-1v-2l-2.6-1-1.3 1.3a7 7 0 0 1-3.4-3.4L7.5 6 6.5 2.5z"/>',
    sms: '<path d="M2.5 3.5h11v7.5H7l-3 2.5v-2.5H2.5z"/>',
    contact: '<circle cx="8" cy="6" r="2.6"/><path d="M3 13.5a5 5 0 0 1 10 0"/>',
    text: '<path d="M3 4h10M3 7h10M3 10h7M3 13h5"/>'
  };

  /* ================= state ================= */

  var state = {
    type: 'url',
    contents: {},
    name: '',
    design: core.normalizeDesign({}).design,
    customLogo: '',
    format: 'png',
    size: 1200
  };
  Object.keys(core.TYPES).forEach(function (type) { state.contents[type] = core.emptyContent(type); });
  state.contents.url.url = 'https://uwbadgers.com';

  var view = {
    payload: null,
    assessment: null,
    moduleCount: 0,
    logoUrl: '',
    scan: 'idle',        // idle | busy | ok | small | fail | unavailable
    scanToken: 0,
    renderTimer: null,
    scanTimer: null,
    sessionTimer: null,
    busyExport: false
  };

  var library = [];
  var countCache = {};

  /* ================= small helpers ================= */

  function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch (error) { return null; }
  }

  function storageSet(key, value) {
    try { window.localStorage.setItem(key, value); return true; } catch (error) { return false; }
  }

  var toastTimer = null;
  function toast(message, tone) {
    var el = $('toast');
    el.textContent = message;
    el.className = 'toast is-shown' + (tone === 'error' ? ' is-error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, tone === 'error' ? 5200 : 2600);
  }

  function setStatus(message, tone) {
    var el = $('status');
    el.textContent = message || '';
    el.className = 'status' + (tone ? ' is-' + tone : '');
  }

  function h(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (key) {
      var value = attrs[key];
      if (value === undefined || value === null || value === false) return;
      if (key === 'text') node.textContent = value;
      else if (key === 'className') node.className = value;
      else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    });
    (children || []).forEach(function (child) { if (child) node.appendChild(child); });
    return node;
  }

  function icon(paths) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    // Icon markup is a fixed constant in this file, never user input.
    svg.innerHTML = paths;
    return svg;
  }

  function copyText(text, done) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      toast('Copying needs a secure page. Serve the folder over http://localhost.', 'error');
      return;
    }
    navigator.clipboard.writeText(text).then(function () { toast(done); }, function () {
      toast('Copy was blocked by the browser.', 'error');
    });
  }

  function isTyping(target) {
    return target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  }

  // Design with the custom logo resolved; falls back to no logo if the data is gone.
  function renderDesign() {
    var d = Object.assign({}, state.design);
    if (d.logo === 'custom') {
      if (state.customLogo) d.logoData = state.customLogo;
      else d.logo = 'none';
    } else {
      d.logoData = '';
    }
    if (d.logo.indexOf('brand:') === 0 && !core.has(BRANDS, d.logo.slice(6))) d.logo = 'none';
    return d;
  }

  /* ================= QR instances ================= */

  var currentDesign = renderDesign();
  var qrCode = new QRCodeStyling(core.qrOptions(SAMPLE, currentDesign, { size: PREVIEW_SIZE }));
  // The extension reads the live design so it never needs re-applying (which re-renders).
  qrCode.applyExtension(function (svg) { core.plateExtension(currentDesign)(svg); });
  qrCode.append($('qr-code'));

  function makeInstance(payload, design, size, moduleCount, logoUrl) {
    var instance = new QRCodeStyling(core.qrOptions(payload, design, { size: size, moduleCount: moduleCount, logoUrl: logoUrl || undefined }));
    instance.applyExtension(core.plateExtension(design));
    return instance;
  }

  function moduleCountFor(payload, design) {
    var key = core.resolveEc(design) + '|' + payload;
    if (countCache[key]) return countCache[key];
    var probe = new QRCodeStyling({
      width: 64, height: 64, type: 'svg', data: core.toByteString(payload),
      qrOptions: { errorCorrectionLevel: core.resolveEc(design), mode: 'Byte', typeNumber: 0 }
    });
    var count = probe._qr ? probe._qr.getModuleCount() : 0;
    countCache[key] = count;
    return count;
  }

  /* ================= content UI ================= */

  function buildTypes() {
    var wrap = $('types');
    Object.keys(core.TYPES).forEach(function (type) {
      var input = h('input', { type: 'radio', name: 'type', id: 'type-' + type, value: type });
      input.checked = type === state.type;
      input.addEventListener('change', function () {
        if (!input.checked) return;
        state.type = type;
        buildFields();
        render();
        var first = $('fields').querySelector('input, textarea, select');
        if (first) first.focus();
      });
      var label = h('label', { for: 'type-' + type }, [icon(TYPE_ICONS[type]), document.createTextNode(core.TYPES[type].label)]);
      wrap.appendChild(input);
      wrap.appendChild(label);
    });
  }

  function fieldControl(field, content, idPrefix) {
    var id = idPrefix + field.key;
    var value = content[field.key];
    var control;
    function onInput() {
      content[field.key] = field.kind === 'checkbox' ? control.checked : control.value;
      scheduleRender();
    }

    if (field.kind === 'checkbox') {
      control = h('input', { type: 'checkbox', id: id });
      control.checked = Boolean(value);
      control.addEventListener('change', onInput);
      return h('div', { className: 'field' }, [h('label', { className: 'check', for: id }, [control, h('span', { text: field.label })])]);
    }

    if (field.kind === 'select') {
      control = h('select', { className: 'select', id: id });
      field.options.forEach(function (option) {
        var opt = h('option', { value: option[0], text: option[1] });
        if (option[0] === value) opt.selected = true;
        control.appendChild(opt);
      });
      control.addEventListener('change', function () { onInput(); syncPasswordVisibility(); });
    } else if (field.kind === 'textarea') {
      control = h('textarea', { className: 'textarea', id: id, maxlength: field.maxLength, placeholder: field.placeholder || '', spellcheck: 'true' });
      control.value = value || '';
      control.addEventListener('input', onInput);
    } else {
      var type = { url: 'url', email: 'email', tel: 'tel', password: 'password' }[field.kind] || 'text';
      control = h('input', {
        className: 'input' + (field.key === 'url' ? ' input-lg' : ''), id: id, type: type,
        maxlength: field.maxLength, placeholder: field.placeholder || '',
        autocomplete: field.kind === 'password' ? 'off' : 'off', spellcheck: 'false',
        inputmode: field.kind === 'url' ? 'url' : field.kind === 'tel' ? 'tel' : field.kind === 'email' ? 'email' : null
      });
      control.value = value || '';
      control.addEventListener('input', onInput);
    }
    control.setAttribute('aria-describedby', id + '-error');

    var label = h('label', { for: id }, [document.createTextNode(field.label)]);
    if (!field.required && field.kind !== 'select' && state.type !== 'contact') label.appendChild(h('span', { className: 'optional', text: ' — optional' }));

    var inner = control;
    if (field.kind === 'password') {
      var toggle = h('button', { type: 'button', className: 'pw-toggle', text: 'Show', 'aria-controls': id });
      toggle.addEventListener('click', function () {
        var showing = control.type === 'text';
        control.type = showing ? 'password' : 'text';
        toggle.textContent = showing ? 'Show' : 'Hide';
      });
      inner = h('div', { className: 'pw-wrap' }, [control, toggle]);
    }
    var error = h('p', { className: 'field-error', id: id + '-error', hidden: true });
    return h('div', { className: 'field' + (field.half ? ' half' : ''), 'data-key': field.key }, [label, inner, error]);
  }

  function syncPasswordVisibility() {
    if (state.type !== 'wifi') return;
    var row = $('fields').querySelector('[data-key="password"]');
    if (row) row.hidden = state.contents.wifi.security === 'nopass';
  }

  function buildFields() {
    var spec = core.TYPES[state.type];
    var wrap = $('fields');
    wrap.textContent = '';
    spec.fields.forEach(function (field) { wrap.appendChild(fieldControl(field, state.contents[state.type], 'f-')); });
    syncPasswordVisibility();
    $('utm-box').hidden = !spec.utm;
    Array.prototype.forEach.call(document.querySelectorAll('input[name="type"]'), function (input) {
      input.checked = input.value === state.type;
    });
  }

  function buildUtm() {
    var wrap = $('utm-fields');
    core.UTM_FIELDS.forEach(function (utm) {
      var field = { key: utm[0], label: utm[2], kind: 'text', placeholder: utm[3], maxLength: 120, half: true };
      var row = fieldControl(field, state.contents.url, 'u-');
      var optional = row.querySelector('.optional');
      if (optional) optional.remove();
      wrap.appendChild(row);
    });
  }

  function refreshContentInputs() {
    buildFields();
    var content = state.contents.url;
    core.UTM_FIELDS.forEach(function (utm) { $('u-' + utm[0]).value = content[utm[0]] || ''; });
    $('name').value = state.name;
  }

  function showFieldErrors(result) {
    var errors = (result && result.errors) || {};
    Array.prototype.forEach.call(document.querySelectorAll('#fields [data-key], #utm-fields [data-key]'), function (row) {
      var key = row.getAttribute('data-key');
      var control = row.querySelector('input, textarea, select');
      var error = row.querySelector('.field-error');
      var message = errors[key];
      // Only flag an empty required field once the user has typed something anywhere.
      var shouldShow = Boolean(message) && (control.value !== '' || row.dataset.touched === '1');
      if (control) control.setAttribute('aria-invalid', shouldShow ? 'true' : 'false');
      if (error) { error.hidden = !shouldShow; error.textContent = shouldShow ? message : ''; }
      if (message && control && control.value !== '') row.dataset.touched = '1';
    });
    var utmCount = core.UTM_FIELDS.filter(function (utm) { return String(state.contents.url[utm[0]] || '').trim(); }).length;
    $('utm-badge').hidden = !utmCount;
    $('utm-badge').textContent = utmCount + ' tag' + (utmCount === 1 ? '' : 's');
    if (errors.utmSource || errors.utmMedium || errors.utmCampaign || errors.utmContent) $('utm-box').open = true;
  }

  /* ================= look UI ================= */

  function lookMatches(look) {
    var d = state.design;
    return Object.keys(look.design).every(function (key) {
      var want = look.design[key];
      if (key === 'plateColor' && look.design.plate === 'none') return true;
      return d[key] === want;
    });
  }

  function buildLooks() {
    var wrap = $('looks');
    LOOKS.forEach(function (look) {
      var design = core.normalizeDesign(Object.assign({}, core.DESIGN_DEFAULTS, look.design)).design;
      var thumb = h('span', { className: 'look-thumb' + (design.background === 'transparent' ? ' is-transparent' : '') });
      var button = h('button', { type: 'button', className: 'look', 'data-look': look.id, 'aria-pressed': 'false' }, [thumb, h('span', { text: look.label })]);
      button.addEventListener('click', function () {
        Object.assign(state.design, look.design);
        if (look.design.eye === null) state.design.eye = null;
        syncDesignControls();
        render();
      });
      wrap.appendChild(button);
      try {
        var count = moduleCountFor(SAMPLE, design);
        var instance = makeInstance(SAMPLE, design, 180, count, core.logoUrlFor(design, BRANDS));
        instance.append(thumb);
      } catch (error) { /* a missing thumbnail is cosmetic */ }
    });
  }

  function brandPreviewUrl(id) {
    var svg = core.brandSvg(id, { fill: '#A00000' }, BRANDS);
    return svg ? core.svgToDataUrl(svg) : '';
  }

  function buildLogoTiles() {
    var wrap = $('logo-tiles');
    wrap.textContent = '';
    var options = [{ value: 'none', label: 'None', art: h('span', { className: 'none-mark' }) }];
    Object.keys(BRANDS).forEach(function (id) {
      options.push({ value: 'brand:' + id, label: BRANDS[id].label.replace(', one colour', ' mono'), art: h('img', { src: brandPreviewUrl(id), alt: '' }), title: BRANDS[id].hint });
    });
    if (state.customLogo) options.push({ value: 'custom', label: 'Yours', art: h('img', { src: state.customLogo, alt: '' }), removable: true });

    options.forEach(function (option, index) {
      var id = 'logo-' + index;
      var input = h('input', { type: 'radio', name: 'logo', id: id, value: option.value });
      input.checked = state.design.logo === option.value;
      input.addEventListener('change', function () {
        if (!input.checked) return;
        state.design.logo = option.value;
        syncLogoOptions();
        render();
      });
      var tile = h('label', { className: 'tile', for: id, title: option.title || null }, [h('span', { className: 'tile-art' }, [option.art]), h('span', { text: option.label })]);
      if (option.removable) {
        var remove = h('button', { type: 'button', className: 'remove', 'aria-label': 'Remove your logo', text: '×' });
        remove.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          state.customLogo = '';
          if (state.design.logo === 'custom') state.design.logo = 'none';
          buildLogoTiles();
          syncLogoOptions();
          render();
          toast('Logo removed.');
        });
        tile.appendChild(remove);
      }
      wrap.appendChild(input);
      wrap.appendChild(tile);
    });

    var upload = h('button', { type: 'button', className: 'tile is-drop', id: 'upload-tile', title: 'PNG, JPG, WebP or SVG. You can also drop or paste an image anywhere.' },
      [h('span', { className: 'tile-art' }, [icon('<path d="M8 11V3M4.5 6.5 8 3l3.5 3.5M3 13h10"/>')]), h('span', { text: state.customLogo ? 'Replace' : 'Upload' })]);
    upload.addEventListener('click', function () { $('logo-input').click(); });
    ['dragenter', 'dragover'].forEach(function (name) {
      upload.addEventListener(name, function (event) { event.preventDefault(); upload.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (name) {
      upload.addEventListener(name, function () { upload.classList.remove('is-over'); });
    });
    wrap.appendChild(upload);
  }

  function syncLogoOptions() {
    var hasLogo = renderDesign().logo !== 'none';
    $('logo-options').hidden = !hasLogo;
    $('logo-scale').value = String(state.design.logoScale);
    $('logo-scale-out').value = state.design.logoScale + '%';
    Array.prototype.forEach.call(document.querySelectorAll('input[name="plate"]'), function (input) { input.checked = input.value === state.design.plate; });
    $('plate-hex').hidden = state.design.plate === 'none';
    setHex('plate', state.design.plateColor);
    Array.prototype.forEach.call(document.querySelectorAll('input[name="logo"]'), function (input) { input.checked = input.value === state.design.logo; });
  }

  function buildShapeTiles() {
    var wrap = $('shape-tiles');
    Object.keys(core.STYLES).forEach(function (key) {
      var art = h('span', { className: 'shape-art' });
      for (var i = 0; i < 9; i += 1) art.appendChild(h('i'));
      var input = h('input', { type: 'radio', name: 'style', id: 'style-' + key, value: key });
      input.addEventListener('change', function () {
        if (!input.checked) return;
        state.design.style = key;
        render();
      });
      wrap.appendChild(input);
      wrap.appendChild(h('label', { className: 'tile', for: 'style-' + key, 'data-shape': key }, [art, h('span', { text: core.STYLES[key].label })]));
    });
  }

  /* colour rows */

  var COLOUR_ROWS = [
    { key: 'fill', label: 'Code', palette: core.PALETTE.fill },
    { key: 'background', label: 'Background', palette: core.PALETTE.background },
    { key: 'eye', label: 'Corner eyes', palette: [[null, 'Same as code'], ['#A00000', 'Badger red'], ['#171717', 'Ink']] }
  ];

  function swatchValue(value) { return value === null ? 'same' : value; }

  function buildColourRows() {
    var wrap = $('colour-rows');
    COLOUR_ROWS.forEach(function (row) {
      var swatches = h('div', { className: 'colour-controls', role: 'group', 'aria-label': row.label + ' colour' });
      row.palette.forEach(function (preset) {
        var button = h('button', { type: 'button', className: 'swatch', title: preset[1], 'aria-label': preset[1], 'data-value': swatchValue(preset[0]) });
        if (preset[0] === 'transparent') button.className += ' swatch-check';
        else if (preset[0] === null) { button.className += ' swatch-same'; button.textContent = '='; }
        else button.style.background = preset[0];
        button.addEventListener('click', function () { setColour(row.key, preset[0]); });
        swatches.appendChild(button);
      });
      var picker = h('input', { type: 'color', id: row.key + '-color', 'aria-label': row.label + ' colour picker' });
      var text = h('input', { type: 'text', id: row.key + '-text', maxlength: '7', spellcheck: 'false', 'aria-label': row.label + ' hex value', autocomplete: 'off' });
      picker.addEventListener('input', function () { setColour(row.key, picker.value); });
      text.addEventListener('input', function () {
        var hex = core.normalizeHex(text.value);
        var ok = Boolean(hex) || (row.key === 'background' && /^(transparent|none)$/i.test(text.value.trim()));
        text.setAttribute('aria-invalid', ok ? 'false' : 'true');
        if (hex && text.value.replace('#', '').length >= 6) setColour(row.key, hex, true);
      });
      text.addEventListener('change', function () {
        var hex = core.normalizeHex(text.value);
        if (row.key === 'background' && /^(transparent|none)$/i.test(text.value.trim())) setColour(row.key, 'transparent');
        else if (hex) setColour(row.key, hex);
        else syncColourRows();
      });
      wrap.appendChild(h('div', { className: 'colour-row' }, [
        h('span', { className: 'label', text: row.label }),
        h('span', { className: 'hex' }, [picker, text]),
        swatches
      ]));
    });
  }

  function setColour(key, value, fromText) {
    if (key === 'eye') state.design.eye = value === null ? null : core.normalizeHex(value);
    else if (key === 'background' && value === 'transparent') state.design.background = 'transparent';
    else state.design[key] = core.normalizeHex(value) || state.design[key];
    syncColourRows(fromText ? key : null);
    // Mono logos take the code colour, so their tile art should follow.
    render();
  }

  function setHex(prefix, value) {
    var picker = $(prefix + '-color');
    var text = $(prefix + '-text');
    if (value && value !== 'transparent') picker.value = value.toLowerCase();
    if (text && document.activeElement !== text) {
      text.value = value === 'transparent' ? 'NONE' : value || '';
      text.setAttribute('aria-invalid', 'false');
    }
  }

  function syncColourRows(skipTextFor) {
    COLOUR_ROWS.forEach(function (row) {
      var value = state.design[row.key];
      var shown = row.key === 'eye' ? (value || state.design.fill) : value;
      if (skipTextFor !== row.key) setHex(row.key, shown);
      else if (shown !== 'transparent') $(row.key + '-color').value = shown.toLowerCase();
      Array.prototype.forEach.call(document.querySelectorAll('#colour-rows .colour-row:nth-child(' + (COLOUR_ROWS.indexOf(row) + 1) + ') .swatch'), function (button) {
        var match = button.getAttribute('data-value') === (row.key === 'eye' && value === null ? 'same' : String(value));
        button.setAttribute('aria-pressed', String(match));
      });
    });
  }

  /* advanced */

  function buildEc() {
    var wrap = $('ec-seg');
    ['auto'].concat(core.EC_LEVELS).forEach(function (level) {
      var input = h('input', { type: 'radio', name: 'ec', id: 'ec-' + level, value: level });
      input.addEventListener('change', function () {
        if (!input.checked) return;
        state.design.ec = level;
        render();
      });
      wrap.appendChild(input);
      wrap.appendChild(h('label', { for: 'ec-' + level, text: level === 'auto' ? 'Auto' : level, title: level === 'auto' ? '' : core.EC_RECOVERY[level] + '% recovery' }));
    });
  }

  function syncDesignControls() {
    Array.prototype.forEach.call(document.querySelectorAll('input[name="style"]'), function (input) { input.checked = input.value === state.design.style; });
    Array.prototype.forEach.call(document.querySelectorAll('input[name="ec"]'), function (input) { input.checked = input.value === state.design.ec; });
    $('quiet-zone').value = String(state.design.quietZone);
    $('quiet-zone-out').value = state.design.quietZone + (state.design.quietZone === 1 ? ' module' : ' modules');
    syncColourRows();
    syncLogoOptions();
  }

  /* ================= render ================= */

  function scheduleRender() {
    clearTimeout(view.renderTimer);
    view.renderTimer = setTimeout(render, RENDER_DEBOUNCE_MS);
  }

  function render() {
    clearTimeout(view.renderTimer);
    var design = renderDesign();
    currentDesign = design;
    var payload = core.buildPayload(state.type, state.contents[state.type]);
    view.payload = payload;
    showFieldErrors(payload);

    // Colour verdict is independent of the content.
    var colour = core.colourVerdict(design);
    var verdict = $('verdict');
    verdict.className = 'verdict' + (colour.level === 'ok' ? '' : ' is-' + colour.level);
    verdict.textContent = '';
    verdict.appendChild(h('b', { text: colour.ratio.toFixed(1) + ':1' }));
    verdict.appendChild(h('span', { text: colour.message }));
    $('sheet').classList.toggle('is-transparent', design.background === 'transparent');

    var advanced = [];
    if (design.ec !== 'auto') advanced.push('EC ' + design.ec);
    if (design.quietZone !== 4) advanced.push('Quiet ' + design.quietZone);
    $('advanced-badge').hidden = !advanced.length;
    $('advanced-badge').textContent = advanced.join(' · ');
    $('ec-aside').textContent = 'Using ' + core.resolveEc(design) + ' · ' + core.EC_RECOVERY[core.resolveEc(design)] + '% recovery';

    Array.prototype.forEach.call(document.querySelectorAll('.look'), function (button) {
      var look = LOOKS.filter(function (l) { return l.id === button.getAttribute('data-look'); })[0];
      button.setAttribute('aria-pressed', String(lookMatches(look)));
    });

    $('payload-box').hidden = !payload.ok;
    if (payload.ok) $('payload-value').textContent = payload.value;

    var assessment = core.assess(payload, design);
    var capacityBlocked = payload.ok && payload.bytes > core.CAPACITY[core.resolveEc(design)];
    if (!payload.ok || capacityBlocked) {
      view.assessment = assessment;
      view.moduleCount = 0;
      markStale(payload.ok ? assessment.blockers[0] : (hasAnyInput() ? payload.message : 'Add content to see your code.'));
      renderNotes(assessment);
      updateChips();
      updateExportState();
      saveSessionSoon();
      return;
    }

    var count = 0;
    try { count = moduleCountFor(payload.value, design); } catch (error) { count = 0; }
    view.moduleCount = count;
    view.assessment = core.assess(payload, design, count);
    view.logoUrl = core.logoUrlFor(design, BRANDS);

    try {
      qrCode.update(core.qrOptions(payload.value, design, { size: PREVIEW_SIZE, moduleCount: count, logoUrl: view.logoUrl || undefined }));
      $('sheet').classList.remove('is-stale');
      $('stale-note').hidden = true;
      $('qr-code').setAttribute('aria-label', 'QR code encoding ' + payload.value);
    } catch (error) {
      markStale('That content could not be encoded.');
    }

    renderNotes(view.assessment);
    scheduleScan();
    updateChips();
    updateExportState();
    saveSessionSoon();
  }

  function hasAnyInput() {
    var content = state.contents[state.type];
    return Object.keys(content).some(function (key) { return typeof content[key] === 'string' && content[key].trim() && key !== 'security'; });
  }

  function markStale(message) {
    $('sheet').classList.add('is-stale');
    $('stale-note').hidden = false;
    $('stale-note').textContent = message;
    $('qr-code').setAttribute('aria-label', 'QR code preview is out of date: ' + message);
    view.scanToken += 1;
    view.scan = 'idle';
  }

  function renderNotes(assessment) {
    var list = $('notes');
    list.textContent = '';
    if (!assessment) return;
    var payloadOk = view.payload && view.payload.ok;
    // Field errors are already shown next to the field; only list design-level blockers.
    (payloadOk ? assessment.blockers : []).forEach(function (message) { list.appendChild(h('li', { className: 'is-bad', text: message })); });
    assessment.warnings.forEach(function (message) {
      if (assessment.colour && message === assessment.colour.message) return; // shown in the colour panel
      list.appendChild(h('li', { text: message }));
    });
  }

  function setChip(id, text, tone, busy) {
    var chip = $(id);
    chip.hidden = !text;
    if (!text) return;
    chip.className = 'chip' + (tone ? ' is-' + tone : '') + (busy ? ' is-busy' : '');
    chip.textContent = '';
    chip.appendChild(h('span', { className: 'dot' }));
    chip.appendChild(h('span', { text: text }));
  }

  function updateChips() {
    var count = view.moduleCount;
    var ready = view.payload && view.payload.ok && count;
    var scanText = {
      idle: ready ? 'Checking…' : 'No code yet',
      busy: 'Checking…',
      ok: 'Scans',
      small: 'Scans — keep it over 25 mm',
      fail: 'Does not scan',
      unavailable: 'Scan check unavailable'
    }[view.scan];
    var scanTone = { ok: 'ok', small: 'warn', fail: 'bad' }[view.scan] || '';
    setChip('chip-scan', scanText, scanTone, view.scan === 'busy' || (view.scan === 'idle' && ready));
    if (!ready) { setChip('chip-size', ''); setChip('chip-print', ''); return; }
    var guide = core.printGuide(count, currentDesign.quietZone);
    setChip('chip-size', 'v' + guide.version + ' · ' + count + '×' + count + ' · EC ' + core.resolveEc(currentDesign), count > 57 ? 'warn' : '');
    setChip('chip-print', 'Print ≥ ' + (guide.minMm >= 10 ? (guide.minMm / 10).toFixed(1) + ' cm' : guide.minMm + ' mm') + ' / ' + guide.minIn + ' in', '');
  }

  function exportBlockReason() {
    if (!view.payload || !view.payload.ok) return view.payload && hasAnyInput() ? view.payload.message : 'Add content first.';
    if (view.assessment && !view.assessment.ok) return view.assessment.blockers[0];
    if (view.scan === 'fail') return 'The code does not decode. Shrink the logo, raise contrast or error correction.';
    return '';
  }

  function updateExportState() {
    var reason = exportBlockReason();
    var blocked = Boolean(reason) || view.busyExport;
    ['download', 'copy-image', 'save-library', 'copy-cli'].forEach(function (id) { $(id).disabled = blocked; });
    $('download').title = reason || '';
    if (reason && view.payload && view.payload.ok) setStatus(reason, 'error');
    else if (!view.busyExport) setStatus(printHint());
  }

  function printHint() {
    var inches = state.size / EXPORT_DPI;
    return state.format === 'svg'
      ? 'Vector — scales to any print size.'
      : state.size + ' px prints ' + inches.toFixed(1) + ' in (' + (inches * 2.54).toFixed(1) + ' cm) wide at ' + EXPORT_DPI + ' dpi.';
  }

  /* ================= scan check ================= */

  var detector = null;
  if ('BarcodeDetector' in window) {
    try { detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (error) { detector = null; }
  }

  function scheduleScan() {
    clearTimeout(view.scanTimer);
    view.scanToken += 1;
    var token = view.scanToken;
    view.scan = 'busy';
    view.scanTimer = setTimeout(function () { runScan(token); }, SCAN_DEBOUNCE_MS);
  }

  function decodeBitmap(bitmap, expected) {
    var viaDetector = detector
      ? detector.detect(bitmap).then(function (found) {
        return found.some(function (item) { return item.rawValue === expected; });
      }, function () { return false; })
      : Promise.resolve(false);
    return viaDetector.then(function (ok) {
      if (ok || typeof window.jsQR !== 'function') return ok;
      var canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0);
      var data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      var found = window.jsQR(data.data, data.width, data.height, { inversionAttempts: 'attemptBoth' });
      return Boolean(found && found.data === expected);
    });
  }

  function decodeAt(payload, design, size, count, logoUrl) {
    return makeInstance(payload, design, size, count, logoUrl).getRawData('png')
      .then(function (blob) { return createImageBitmap(blob); })
      .then(function (bitmap) { return decodeBitmap(bitmap, payload); });
  }

  function runScan(token) {
    if (token !== view.scanToken || !view.payload || !view.payload.ok || !view.moduleCount) return;
    if (!detector && typeof window.jsQR !== 'function') { view.scan = 'unavailable'; updateChips(); updateExportState(); return; }
    var payload = view.payload.value;
    var design = currentDesign;
    var count = view.moduleCount;
    var logoUrl = view.logoUrl;
    var span = count + design.quietZone * 2;
    // Camera-like resolutions, matching the CLI check.
    var sizes = [8, 12, 5].map(function (px) { return Math.max(160, Math.min(1600, Math.round(span * px))); });

    function tryFull(i) {
      if (i >= sizes.length) return Promise.resolve(false);
      return decodeAt(payload, design, sizes[i], count, logoUrl).then(function (ok) { return ok || tryFull(i + 1); });
    }

    tryFull(0).then(function (full) {
      if (!full) return { full: false, small: false };
      return decodeAt(payload, design, SMALL_CHECK_PX, count, logoUrl).then(function (small) { return { full: true, small: small }; });
    }).then(function (result) {
      if (token !== view.scanToken) return;
      view.scan = !result.full ? 'fail' : result.small ? 'ok' : 'small';
      updateChips();
      updateExportState();
    }).catch(function () {
      if (token !== view.scanToken) return;
      view.scan = 'unavailable';
      updateChips();
      updateExportState();
    });
  }

  /* ================= export ================= */

  function currentFileBase() {
    return core.fileBase(state.name, state.type, state.contents[state.type], view.payload && view.payload.value);
  }

  function triggerDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = h('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function renderFile(format, size) {
    var instance = makeInstance(view.payload.value, currentDesign, size, view.moduleCount, view.logoUrl);
    return instance.getRawData(format).then(function (blob) {
      if (!blob) throw new Error('empty');
      if (format === 'svg') return blob;
      return blob.arrayBuffer().then(function (buffer) {
        return new Blob([core.setPngDpi(new Uint8Array(buffer), EXPORT_DPI)], { type: 'image/png' });
      });
    });
  }

  function withExportLock(work) {
    if (view.busyExport || exportBlockReason()) {
      var reason = exportBlockReason();
      if (reason) toast(reason, 'error');
      return;
    }
    view.busyExport = true;
    updateExportState();
    Promise.resolve().then(work).catch(function (error) {
      toast(error && error.userMessage || 'Export failed. Try a smaller size, or remove the logo and retry.', 'error');
    }).then(function () {
      view.busyExport = false;
      updateExportState();
    });
  }

  function download() {
    withExportLock(function () {
      var format = state.format;
      var name = currentFileBase() + '.' + format;
      setStatus('Rendering ' + format.toUpperCase() + '…');
      return renderFile(format, state.size).then(function (blob) {
        triggerDownload(blob, name);
        toast('Saved ' + name);
        return addToLibrary(true);
      });
    });
  }

  function copyImage() {
    withExportLock(function () {
      var blobPromise = renderFile('png', state.size);
      // Safari needs the ClipboardItem created synchronously with a promise inside.
      return navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })])
        .then(function () { toast('PNG copied to the clipboard.'); }, function () {
          var error = new Error('clipboard');
          error.userMessage = 'The browser blocked copying. Download the file instead.';
          throw error;
        });
    });
  }

  function copyCli() {
    if (exportBlockReason()) { toast(exportBlockReason(), 'error'); return; }
    var cmd = core.cliCommand(state.type, state.contents[state.type], currentDesign, {
      size: state.size !== 1200 ? state.size : null,
      output: currentFileBase() + '.' + state.format
    });
    copyText(cmd, currentDesign.logo === 'custom' ? 'Command copied — replace the logo path with your file.' : 'Command copied.');
  }

  /* ================= custom logo ================= */

  function readAsDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { reject(new Error('read')); };
      reader.readAsDataURL(blob);
    });
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('decode')); };
      img.src = src;
    });
  }

  // Large rasters are scaled down so saved codes do not exhaust browser storage.
  function shrinkRaster(img, dataUrl, file) {
    var longest = Math.max(img.naturalWidth, img.naturalHeight);
    if (longest <= RASTER_LOGO_MAX_PX && file.size <= 600 * 1024) return dataUrl;
    var scale = Math.min(1, RASTER_LOGO_MAX_PX / longest);
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return file.type === 'image/jpeg' ? canvas.toDataURL('image/jpeg', 0.92) : canvas.toDataURL('image/png');
  }

  function acceptLogo(file) {
    if (!file) return;
    if (['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'].indexOf(file.type) === -1) {
      toast('Use a PNG, JPG, WebP or SVG logo.', 'error');
      return;
    }
    if (file.size > MAX_LOGO_INPUT_BYTES) {
      toast('Logo files must be under 8 MB (this one is ' + (file.size / 1048576).toFixed(1) + ' MB).', 'error');
      return;
    }
    var removed = 0;
    var work;
    if (file.type === 'image/svg+xml') {
      work = file.text().then(function (text) {
        var clean = core.sanitizeSvg(text, DOMParser, XMLSerializer);
        removed = clean.removed;
        var url = core.svgToDataUrl(clean.svg);
        return loadImage(url).then(function (img) {
          if (!img.naturalWidth || !img.naturalHeight) throw new Error('dimensions');
          return url;
        });
      });
    } else {
      work = readAsDataUrl(file).then(function (url) {
        return loadImage(url).then(function (img) {
          if (!img.naturalWidth || !img.naturalHeight) throw new Error('dimensions');
          return shrinkRaster(img, url, file);
        });
      });
    }
    work.then(function (url) {
      state.customLogo = url;
      state.design.logo = 'custom';
      buildLogoTiles();
      syncLogoOptions();
      render();
      toast(removed ? 'Logo added. Removed ' + removed + ' unsafe SVG element(s).' : 'Logo added.');
    }).catch(function (error) {
      var message = error && error.message;
      toast(message === 'dimensions' ? 'That SVG has no size. Re-export it with a viewBox, or use a PNG.'
        : message === 'svg-parse' ? 'That SVG could not be parsed.'
          : 'That file could not be read as an image.', 'error');
    }).then(function () { $('logo-input').value = ''; });
  }

  /* ================= library ================= */

  function hashString(text) {
    var h1 = 0x811c9dc5;
    for (var i = 0; i < text.length; i += 1) {
      h1 ^= text.charCodeAt(i);
      h1 = Math.imul(h1, 0x01000193);
    }
    return 'l' + (h1 >>> 0).toString(36) + text.length.toString(36);
  }

  var THUMB_RE = /^data:image\/png;base64,[a-z0-9+/=]+$/i;

  // Rebuilds an entry from untrusted storage or an imported file. The payload is
  // always re-derived from the content, never trusted as stored.
  function normalizeEntry(raw, logos) {
    if (!raw || typeof raw !== 'object') return null;
    var type = core.has(core.TYPES, raw.type) ? raw.type : null;
    if (!type) return null;
    var content = core.normalizeContent(type, raw.content);
    var designInput = Object.assign({}, raw.design || {});
    if (designInput.logo === 'custom' && !designInput.logoData && designInput.logoRef && logos) designInput.logoData = logos[designInput.logoRef];
    var design = core.normalizeDesign(designInput).design;
    var payload = core.buildPayload(type, content);
    if (!payload.ok) return null;
    return {
      id: String(raw.id || Date.now() + Math.random()).slice(0, 40),
      name: String(raw.name || '').slice(0, 80),
      type: type,
      content: content,
      design: design,
      payload: payload.value,
      savedAt: Number(raw.savedAt) || Date.now(),
      thumb: THUMB_RE.test(raw.thumb || '') ? raw.thumb : ''
    };
  }

  function safeNormalize(raw, logos) {
    try { return normalizeEntry(raw, logos); } catch (error) { return null; }
  }

  function migrateV1(items) {
    if (!Array.isArray(items)) return [];
    return items.map(function (item) {
      if (!item || !item.settings) return null;
      var s = item.settings;
      return safeNormalize({
        id: item.id, name: '', type: 'url', content: { url: item.url }, savedAt: item.savedAt, thumb: item.thumb,
        design: {
          style: s.style, fill: s.fill, background: s.background, eye: s.eyeEnabled ? s.eye : null,
          logo: s.logo ? 'custom' : 'none', logoData: s.logo, logoScale: s.logoScale, plate: s.plate, plateColor: s.plateColor
        }
      });
    }).filter(Boolean);
  }

  function readLibrary() {
    var raw = storageGet(KEYS.library);
    if (raw === null) {
      // First run of v2: bring QR Studio 1.x entries across, leaving the old key intact.
      var old = null;
      try { old = JSON.parse(storageGet(KEYS.libraryV1) || 'null'); } catch (error) { old = null; }
      var migrated = migrateV1(old);
      if (migrated.length) writeLibrary(migrated);
      return migrated;
    }
    var items;
    var logos;
    try { items = JSON.parse(raw); } catch (error) { items = []; }
    try { logos = JSON.parse(storageGet(KEYS.logos) || '{}') || {}; } catch (error) { logos = {}; }
    if (!Array.isArray(items)) items = [];
    return items.map(function (item) { return safeNormalize(item, logos); }).filter(Boolean);
  }

  function serialiseEntries(items) {
    var logos = {};
    var list = items.map(function (item) {
      var design = Object.assign({}, item.design);
      if (design.logo === 'custom' && design.logoData) {
        var ref = hashString(design.logoData);
        logos[ref] = design.logoData;
        design.logoRef = ref;
      }
      delete design.logoData;
      return { id: item.id, name: item.name, type: item.type, content: item.content, design: design, savedAt: item.savedAt, thumb: item.thumb };
    });
    return { list: list, logos: logos };
  }

  // Logos are stored once and referenced by hash. When storage is full the oldest
  // entries are dropped until the write fits, instead of failing the save.
  function writeLibrary(items) {
    var attempt = items.slice(0, MAX_LIBRARY_ITEMS);
    while (true) {
      var data = serialiseEntries(attempt);
      var logosJson = JSON.stringify(data.logos);
      var okLogos = storageSet(KEYS.logos, logosJson);
      if (okLogos && storageSet(KEYS.library, JSON.stringify(data.list))) {
        var dropped = items.length - attempt.length;
        library = attempt;
        return { ok: true, dropped: Math.max(0, dropped) };
      }
      if (!attempt.length) return { ok: false, dropped: items.length };
      attempt = attempt.slice(0, attempt.length - 1);
    }
  }

  function signature(entry) {
    var d = entry.design;
    return [entry.type, entry.payload, entry.name, d.style, d.fill, d.background, d.eye, d.logo,
      d.logo === 'custom' ? hashString(d.logoData || '') : '', d.logoScale, d.plate, d.plateColor, d.ec, d.quietZone].join('|');
  }

  function addToLibrary(silent) {
    if (!view.payload || !view.payload.ok) return Promise.resolve();
    var entry = normalizeEntry({
      id: String(Date.now()), name: state.name, type: state.type, content: state.contents[state.type],
      design: currentDesign, savedAt: Date.now()
    });
    if (!entry) return Promise.resolve();
    // Wi-Fi codes carry a password, so they are only stored when saved deliberately.
    if (silent && entry.type === 'wifi') return Promise.resolve();
    var sig = signature(entry);
    return makeInstance(entry.payload, currentDesign, THUMB_SIZE, view.moduleCount, view.logoUrl).getRawData('png')
      .then(readAsDataUrl)
      .then(function (thumb) {
        entry.thumb = thumb;
        var rest = library.filter(function (item) { return signature(item) !== sig; });
        var result = writeLibrary([entry].concat(rest));
        if (!result.ok) toast('Browser storage is full; this code was not saved to the library.', 'error');
        else if (result.dropped) toast('Library full — removed ' + result.dropped + ' oldest code(s).');
        else if (!silent) toast('Saved to the library.');
        renderLibrary();
      })
      .catch(function () { if (!silent) toast('Could not save to the library.', 'error'); });
  }

  function restore(entry) {
    state.type = entry.type;
    state.contents[entry.type] = core.normalizeContent(entry.type, entry.content);
    state.name = entry.name || '';
    var design = Object.assign({}, entry.design);
    if (design.logo === 'custom') state.customLogo = design.logoData;
    delete design.logoData;
    state.design = Object.assign(core.normalizeDesign({}).design, design);
    refreshContentInputs();
    buildLogoTiles();
    syncDesignControls();
    render();
    closeLibrary();
    toast('Loaded “' + (entry.name || entry.payload.replace(/^https?:\/\//, '').slice(0, 40)) + '”');
  }

  // Imported entries arrive without trusted thumbnails; draw them in the background.
  var backfilling = false;
  function backfillThumbs() {
    if (backfilling) return;
    var entry = library.filter(function (item) { return !item.thumb; })[0];
    if (!entry) return;
    backfilling = true;
    var design = entry.design;
    var count = 0;
    try { count = moduleCountFor(entry.payload, design); } catch (error) { count = 0; }
    makeInstance(entry.payload, design, THUMB_SIZE, count, core.logoUrlFor(design, BRANDS)).getRawData('png')
      .then(readAsDataUrl)
      .then(function (thumb) { entry.thumb = thumb; }, function () { entry.thumb = 'data:image/png;base64,'; })
      .then(function () {
        writeLibrary(library);
        backfilling = false;
        if (!$('library').hidden) renderLibrary();
        setTimeout(backfillThumbs, 30);
      });
  }

  function entryTitle(entry) {
    if (entry.name) return entry.name;
    if (entry.type === 'url') return entry.payload.replace(/^https?:\/\//, '');
    if (entry.type === 'wifi') return 'Wi-Fi · ' + entry.content.ssid;
    if (entry.type === 'contact') return ((entry.content.firstName || '') + ' ' + (entry.content.lastName || '')).trim() || entry.content.org;
    return core.TYPES[entry.type].label + ' · ' + entry.payload.slice(0, 40);
  }

  function renderLibrary() {
    var query = $('library-search').value.trim().toLowerCase();
    var grid = $('library-grid');
    grid.textContent = '';
    $('library-count').textContent = String(library.length);
    var shown = library.filter(function (entry) {
      return !query || (entryTitle(entry) + ' ' + entry.payload).toLowerCase().indexOf(query) !== -1;
    });
    $('library-empty').hidden = shown.length > 0;
    $('library-empty').textContent = library.length ? 'No saved codes match “' + query + '”.' : 'Nothing saved yet. Downloads and “Save to library” land here — in this browser only.';
    $('library-clear').disabled = !library.length;
    $('library-export').disabled = !library.length;
    backfillThumbs();

    shown.forEach(function (entry) {
      var open = h('button', { type: 'button', className: 'lib-open', 'aria-label': 'Open ' + entryTitle(entry) });
      open.addEventListener('click', function () { restore(entry); });
      var remove = h('button', { type: 'button', className: 'lib-remove', 'aria-label': 'Delete ' + entryTitle(entry), text: '×' });
      remove.addEventListener('click', function (event) {
        event.stopPropagation();
        writeLibrary(library.filter(function (other) { return other.id !== entry.id; }));
        renderLibrary();
        toast('Deleted from the library.');
      });
      var img = h('img', { alt: '', src: entry.thumb || 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="#eee"/></svg>') });
      grid.appendChild(h('div', { className: 'lib-card' }, [
        img,
        h('span', { className: 'lib-name', text: entryTitle(entry), title: entry.payload }),
        h('span', { className: 'lib-meta', text: core.TYPES[entry.type].label + ' · ' + new Date(entry.savedAt).toLocaleDateString() }),
        open, remove
      ]));
    });
  }

  var lastFocus = null;
  function openLibrary() {
    lastFocus = document.activeElement;
    renderLibrary();
    $('scrim').hidden = false;
    $('library').hidden = false;
    document.querySelector('.app').inert = true;
    requestAnimationFrame(function () {
      $('scrim').classList.add('is-open');
      $('library').classList.add('is-open');
      $('library-search').focus();
    });
  }

  function closeLibrary() {
    if ($('library').hidden) return;
    $('scrim').classList.remove('is-open');
    $('library').classList.remove('is-open');
    document.querySelector('.app').inert = false;
    setTimeout(function () { $('scrim').hidden = true; $('library').hidden = true; }, 220);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function exportLibrary() {
    var entries = library.map(function (entry) {
      return { id: entry.id, name: entry.name, type: entry.type, content: entry.content, design: entry.design, savedAt: entry.savedAt, thumb: entry.thumb };
    });
    var hasSecrets = library.some(function (entry) { return entry.type === 'wifi' && entry.content.password; });
    var blob = new Blob([JSON.stringify({ app: 'qr-studio', version: 2, exportedAt: new Date().toISOString(), entries: entries }, null, 2)], { type: 'application/json' });
    triggerDownload(blob, 'qr-studio-library-' + new Date().toISOString().slice(0, 10) + '.json');
    toast(hasSecrets ? 'Library exported. It includes Wi-Fi passwords — share it carefully.' : 'Library exported.');
  }

  function importLibrary(file) {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) { toast('That file is too large to be a QR Studio library.', 'error'); return; }
    file.text().then(function (text) {
      var parsed = JSON.parse(text);
      var incoming = Array.isArray(parsed) ? migrateV1(parsed)
        : parsed && parsed.app === 'qr-studio' && Array.isArray(parsed.entries) ? parsed.entries.map(function (e) { return safeNormalize(e); }).filter(Boolean)
          : null;
      if (!incoming) throw new Error('format');
      var total = Array.isArray(parsed) ? parsed.length : parsed.entries.length;
      var known = {};
      library.forEach(function (entry) { known[signature(entry)] = true; });
      var fresh = incoming.filter(function (entry) {
        var sig = signature(entry);
        if (known[sig]) return false;
        known[sig] = true;
        return true;
      });
      fresh.forEach(function (entry) { entry.id = String(Date.now()) + Math.random().toString(36).slice(2, 7); });
      var merged = fresh.concat(library).sort(function (a, b) { return b.savedAt - a.savedAt; });
      var result = writeLibrary(merged);
      renderLibrary();
      var skipped = total - incoming.length;
      toast('Imported ' + fresh.length + ' code(s)' +
        (incoming.length - fresh.length ? ', ' + (incoming.length - fresh.length) + ' already saved' : '') +
        (skipped ? ', ' + skipped + ' invalid skipped' : '') +
        (result.dropped ? ', ' + result.dropped + ' oldest dropped for space' : '') + '.');
    }).catch(function () {
      toast('That is not a QR Studio library file.', 'error');
    }).then(function () { $('library-file').value = ''; });
  }

  /* ================= session ================= */

  function saveSessionSoon() {
    clearTimeout(view.sessionTimer);
    view.sessionTimer = setTimeout(saveSession, 400);
  }

  function saveSession() {
    var contents = JSON.parse(JSON.stringify(state.contents));
    // Never persist a Wi-Fi password just because it was typed.
    contents.wifi.password = '';
    var design = Object.assign({}, state.design);
    delete design.logoData;
    var session = { v: 2, type: state.type, contents: contents, name: state.name, design: design, format: state.format, size: state.size };
    if (state.customLogo && state.customLogo.length < 1500000) session.customLogo = state.customLogo;
    if (!storageSet(KEYS.session, JSON.stringify(session))) {
      delete session.customLogo;
      storageSet(KEYS.session, JSON.stringify(session));
    }
  }

  function loadSession() {
    var session;
    try { session = JSON.parse(storageGet(KEYS.session) || 'null'); } catch (error) { session = null; }
    if (!session || session.v !== 2) return;
    if (core.has(core.TYPES, session.type)) state.type = session.type;
    Object.keys(core.TYPES).forEach(function (type) {
      if (session.contents && session.contents[type]) state.contents[type] = core.normalizeContent(type, session.contents[type]);
    });
    state.name = String(session.name || '').slice(0, 80);
    if (typeof session.customLogo === 'string' && /^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(session.customLogo)) state.customLogo = session.customLogo;
    var designInput = Object.assign({}, session.design);
    if (designInput.logo === 'custom') designInput.logoData = state.customLogo;
    state.design = core.normalizeDesign(designInput).design;
    delete state.design.logoData;
    if (session.format === 'svg' || session.format === 'png') state.format = session.format;
    if ([600, 1200, 2400, 4800].indexOf(session.size) !== -1) state.size = session.size;
  }

  /* ================= theme ================= */

  var THEMES = ['system', 'light', 'dark'];
  function applyTheme(value) {
    if (value === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', value);
    var label = 'Theme: ' + { system: 'automatic', light: 'light', dark: 'dark' }[value];
    $('theme-toggle').setAttribute('aria-label', label);
    $('theme-toggle').title = label + ' (click to change)';
    storageSet(KEYS.theme, value);
  }

  /* ================= wiring ================= */

  function wire() {
    $('name').addEventListener('input', function () { state.name = $('name').value; saveSessionSoon(); });

    $('copy-payload').addEventListener('click', function () {
      if (view.payload && view.payload.ok) copyText(view.payload.value, 'Encoded text copied.');
    });

    $('reset-design').addEventListener('click', function () {
      state.design = core.normalizeDesign({}).design;
      syncDesignControls();
      render();
      toast('Look reset to defaults.');
    });

    $('logo-input').addEventListener('change', function () { acceptLogo($('logo-input').files && $('logo-input').files[0]); });

    $('logo-scale').addEventListener('input', function () {
      state.design.logoScale = Number($('logo-scale').value);
      $('logo-scale-out').value = state.design.logoScale + '%';
      scheduleRender();
    });

    Array.prototype.forEach.call(document.querySelectorAll('input[name="plate"]'), function (input) {
      input.addEventListener('change', function () {
        if (!input.checked) return;
        state.design.plate = input.value;
        $('plate-hex').hidden = input.value === 'none';
        render();
      });
    });
    $('plate-color').addEventListener('input', function () {
      state.design.plateColor = core.normalizeHex($('plate-color').value);
      setHex('plate', state.design.plateColor);
      scheduleRender();
    });
    $('plate-text').addEventListener('change', function () {
      var hex = core.normalizeHex($('plate-text').value);
      if (hex) state.design.plateColor = hex;
      setHex('plate', state.design.plateColor);
      render();
    });

    $('quiet-zone').addEventListener('input', function () {
      state.design.quietZone = Number($('quiet-zone').value);
      $('quiet-zone-out').value = state.design.quietZone + (state.design.quietZone === 1 ? ' module' : ' modules');
      scheduleRender();
    });

    Array.prototype.forEach.call(document.querySelectorAll('input[name="format"]'), function (input) {
      input.checked = input.value === state.format;
      input.addEventListener('change', function () {
        if (!input.checked) return;
        state.format = input.value;
        syncExportControls();
        updateExportState();
        saveSessionSoon();
      });
    });
    $('export-size').value = String(state.size);
    $('export-size').addEventListener('change', function () {
      state.size = Number($('export-size').value) || 1200;
      updateExportState();
      saveSessionSoon();
    });

    $('download').addEventListener('click', download);
    $('save-library').addEventListener('click', function () {
      if (exportBlockReason()) { toast(exportBlockReason(), 'error'); return; }
      addToLibrary(false);
    });
    $('copy-cli').addEventListener('click', copyCli);
    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      $('copy-image').hidden = false;
      $('copy-image').addEventListener('click', copyImage);
    }

    Array.prototype.forEach.call(document.querySelectorAll('input[name="view-size"]'), function (input) {
      input.addEventListener('change', function () {
        if (input.value === 'fit') $('sheet').removeAttribute('data-size');
        else $('sheet').setAttribute('data-size', input.value);
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('input[name="backdrop"]'), function (input) {
      input.addEventListener('change', function () {
        $('canvas').classList.toggle('backdrop-dark', input.value === 'dark');
        $('canvas').classList.toggle('backdrop-photo', input.value === 'photo');
      });
    });

    $('theme-toggle').addEventListener('click', function () {
      var current = storageGet(KEYS.theme) || 'system';
      applyTheme(THEMES[(THEMES.indexOf(current) + 1) % THEMES.length]);
    });

    $('open-library').addEventListener('click', openLibrary);
    $('close-library').addEventListener('click', closeLibrary);
    $('scrim').addEventListener('click', closeLibrary);
    $('library-search').addEventListener('input', renderLibrary);
    $('library-export').addEventListener('click', exportLibrary);
    $('library-import').addEventListener('click', function () { $('library-file').click(); });
    $('library-file').addEventListener('change', function () { importLibrary($('library-file').files && $('library-file').files[0]); });
    $('library-clear').addEventListener('click', function () {
      if (!window.confirm('Delete all ' + library.length + ' saved codes from this browser? Export first if you want a backup.')) return;
      writeLibrary([]);
      storageSet(KEYS.logos, '{}');
      renderLibrary();
      toast('Library cleared.');
    });

    document.addEventListener('keydown', function (event) {
      var mod = event.metaKey || event.ctrlKey;
      if (event.key === 'Escape' && !$('library').hidden) { event.preventDefault(); closeLibrary(); return; }
      if (mod && !event.altKey && (event.key === 's' || event.key === 'S')) {
        event.preventDefault();
        if ($('library').hidden) download();
        return;
      }
      if (mod && event.shiftKey && (event.key === 'c' || event.key === 'C') && !$('copy-image').hidden && $('library').hidden) {
        event.preventDefault();
        copyImage();
      }
    });

    // Paste an image to use it as the logo; paste a link outside a field to encode it.
    document.addEventListener('paste', function (event) {
      if (!$('library').hidden) return;
      var data = event.clipboardData;
      if (!data) return;
      var file = null;
      Array.prototype.forEach.call(data.items || [], function (item) {
        if (!file && item.kind === 'file' && /^image\//.test(item.type)) file = item.getAsFile();
      });
      if (file) { event.preventDefault(); acceptLogo(file); return; }
      if (isTyping(event.target)) return;
      var text = (data.getData('text/plain') || '').trim();
      if (/^https?:\/\/\S+$/i.test(text) && text.length <= 2000) {
        event.preventDefault();
        state.type = 'url';
        state.contents.url.url = text;
        refreshContentInputs();
        render();
        toast('Link pasted.');
      }
    });

    var dragDepth = 0;
    function hasFiles(event) {
      return event.dataTransfer && Array.prototype.indexOf.call(event.dataTransfer.types || [], 'Files') !== -1;
    }
    window.addEventListener('dragenter', function (event) {
      if (!hasFiles(event)) return;
      dragDepth += 1;
      document.body.classList.add('dropping');
    });
    window.addEventListener('dragleave', function () {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) document.body.classList.remove('dropping');
    });
    window.addEventListener('dragover', function (event) { if (hasFiles(event)) event.preventDefault(); });
    window.addEventListener('drop', function (event) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth = 0;
      document.body.classList.remove('dropping');
      acceptLogo(event.dataTransfer.files && event.dataTransfer.files[0]);
    });
  }

  function syncExportControls() {
    Array.prototype.forEach.call(document.querySelectorAll('input[name="format"]'), function (input) { input.checked = input.value === state.format; });
    $('export-size').disabled = false;
    $('download-label').textContent = 'Download ' + state.format.toUpperCase();
  }

  /* ================= start ================= */

  var isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  if (!isMac) $('download-kbd').textContent = 'Ctrl+S';

  loadSession();
  var savedTheme = storageGet(KEYS.theme);
  if (THEMES.indexOf(savedTheme) !== -1) applyTheme(savedTheme);

  buildTypes();
  buildFields();
  buildUtm();
  $('name').value = state.name;
  buildLooks();
  buildLogoTiles();
  buildShapeTiles();
  buildColourRows();
  buildEc();
  syncDesignControls();
  wire();
  syncExportControls();
  library = readLibrary();
  renderLibrary();
  render();
})();
