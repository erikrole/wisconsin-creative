// OTS board controller: reads and changes /api/ots/control. Staff sign-in required to change it.
(() => {
  const $ = (id) => document.getElementById(id);
  let selected = 'live';
  let saved = null;

  // Keep the 825x60 preview scaled to the panel width.
  const frame = $('frame'), preview = $('preview');
  const fit = () => { frame.style.transform = `scale(${preview.clientWidth / 825})`; };
  window.addEventListener('resize', fit);
  fit();

  function setStatus(text, isError) {
    $('status').textContent = text;
    $('status').classList.toggle('error', !!isError);
  }

  function selectMode(mode) {
    selected = mode;
    document.querySelectorAll('.mode').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    $('scenario').disabled = mode !== 'demo';
    $('gamePk').disabled = mode !== 'live';
  }

  function describe(c) {
    const what = c.mode === 'demo' ? `Demo: ${$('scenario').querySelector(`option[value="${c.scenario}"]`)?.textContent || c.scenario}`
      : c.mode === 'hold' ? 'Hold (frozen)'
      : `Live${c.gamePk ? `, game ${c.gamePk}` : ', World Series Game 2'}`;
    const when = c.updatedAt ? new Date(c.updatedAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : null;
    return when ? `${what}. Changed by ${c.updatedBy || 'staff'} ${when}.` : `${what}. Not changed yet.`;
  }

  function show(c) {
    saved = c;
    selectMode(c.mode);
    $('scenario').value = c.scenario || 'cycle';
    $('gamePk').value = c.gamePk || '';
    $('meta').textContent = describe(c);
  }

  async function load(summaryOnly) {
    const res = await fetch('/api/ots/control/staff', { cache: 'no-store', credentials: 'same-origin' });
    if (res.status === 401 || res.status === 403) {
      document.body.classList.add('signed-out');
      if (res.status === 403) $('signin').querySelector('p').textContent = 'Your account can view the board but not change it. Ask an admin for staff access.';
      const pub = await fetch('/api/ots/control', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
      if (pub && pub.data) $('meta').textContent = describe({ ...pub.data, updatedBy: null });
      return;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const c = (await res.json()).data;
    if (summaryOnly) { saved = c; $('meta').textContent = describe(c); } else show(c);
  }

  async function apply() {
    const body = { mode: selected, scenario: $('scenario').value, gamePk: $('gamePk').value.trim() || null };
    $('apply').disabled = true;
    setStatus('Updating…');
    try {
      const res = await fetch('/api/ots/control', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json.details && json.details[0]) || json.error || `The board could not be updated (HTTP ${res.status}).`);
      show(json.data);
      setStatus('Sent. The board picks it up within 5 seconds.');
    } catch (e) {
      setStatus(e.message, true);
    } finally {
      $('apply').disabled = false;
    }
  }

  document.querySelectorAll('.mode').forEach((b) => b.addEventListener('click', () => selectMode(b.dataset.mode)));
  $('apply').addEventListener('click', apply);
  load().catch(() => setStatus('Could not reach the site. Check the connection and reload.', true));
  // Another staff member may change it; refresh the summary now and then.
  setInterval(() => { if (saved) load(true).catch(() => {}); }, 30000);   // summary only; never overwrite a pending choice
})();
