// Router output: places the fascia board and the corner chip on a 1920x1080 frame (see output.html).
(function () {
  var qs = new URLSearchParams(location.search);
  var pass = qs.get('demo') ? '?demo=' + encodeURIComponent(qs.get('demo')) : '';
  function place(id, src, extra) {
    var el = document.getElementById(id);
    var at = qs.get(id);
    if (at === 'off') { el.parentNode.removeChild(el); return; }
    if (at && /^\d{1,4},\d{1,4}$/.test(at)) {
      var xy = at.split(',');
      el.style.left = xy[0] + 'px';
      el.style.top = xy[1] + 'px';
    }
    el.src = src + (pass ? pass + (extra ? '&' + extra : '') : (extra ? '?' + extra : ''));
  }
  place('fascia', 'index.html', '');
  place('chip', 'chip.html', 'square=1');
})();
