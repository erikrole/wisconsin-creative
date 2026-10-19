// World Series OTS board logic. See index.html for URL options.
(() => {
  const qs = new URLSearchParams(location.search);
  const DEFAULT_GAME_PK = qs.get('game') || '849802';
  let gamePk = DEFAULT_GAME_PK;                      // the controller can point the board at another game
  const POLL_LIVE_MS = Math.max(3, Number(qs.get('poll')) || 5) * 1000;
  const POLL_PRE_MS = 30000, POLL_FINAL_MS = 300000;
  const FETCH_TIMEOUT_MS = 8000, MAX_RETRY_MS = 60000, CONTROL_POLL_MS = 5000;
  const API = 'https://statsapi.mlb.com';

  // Teams we expect. Logos are local files cropped to their artwork, sized to equal visual area
  // (max 46 tall, 52 wide). Any other team falls back to MLB's CDN logo and a neutral field.
  const TEAMS = {
    MIL: { city: 'MILWAUKEE', logo: 'logos/MIL.svg', w: 40, h: 44,
           field: 'linear-gradient(180deg, #22437a 0%, #12284B 55%, #0e2140 100%)', chip: 'linear-gradient(180deg, #13305e 0%, #091731 100%)' },
    TB:  { city: 'TAMPA BAY', logo: 'logos/TB.svg', w: 45, h: 40,
           field: 'linear-gradient(180deg, #13448a 0%, #092C5C 55%, #072348 100%)', chip: 'linear-gradient(180deg, #0a2b5a 0%, #051a38 100%)' },
    CLE: { city: 'CLEVELAND', logo: 'logos/CLE.svg', w: 30, h: 46,
           field: 'linear-gradient(180deg, #1a3a66 0%, #0C2340 55%, #0a1c34 100%)', chip: 'linear-gradient(180deg, #11294d 0%, #07152a 100%)' },
    TBD: { city: 'TBD', logo: '',
           field: 'linear-gradient(180deg, #2a3240 0%, #1c222c 100%)', chip: 'linear-gradient(180deg, #232a36 0%, #151a22 100%)' }
  };
  const GENERIC = { field: TEAMS.TBD.field, chip: TEAMS.TBD.chip, w: 42, h: 42 };

  const $ = (id) => document.getElementById(id);
  const nz = (v, d) => (v === null || v === undefined ? d : v);   // stand-in for nullish coalescing, which Chromium 66 lacks

  const scale = Number(qs.get('scale'));
  if (scale > 0) {
    $('board').style.transform = `scale(${scale})`;
    document.body.style.width = 825 * scale + 'px';
    document.body.style.height = 60 * scale + 'px';
  }

  // ---------- rendering: one normalised model -> the board ----------
  // model = { status: pre|live|break|delay|final (delay = suspended or postponed; no rain delays under the roof), gameNo, time, note,
  //           away/home: { abbr, id, city, runs }, inning, half: top|bottom|mid|end,
  //           bases: [1,3], balls, strikes, outs }

  const logoKey = { away: null, home: null };
  const shown = {};                                   // last text per element, so only real changes animate

  function animate(el, cls) { el.classList.remove('pop', 'drop', 'enter', 'fade', 'tick', cls); void el.getBoundingClientRect(); el.classList.add(cls); }
  function setText(el, text, cls) {
    text = text == null ? '' : String(text);
    const prev = shown[el.id];
    shown[el.id] = text;
    if (prev === text) return;
    if (cls === 'roll') {
      // Roll the new value in on an inner span; never put .roll on the box itself (it would break its layout).
      el.innerHTML = '';
      const span = document.createElement('span');
      if (prev !== undefined && prev !== '' && text !== '') span.className = 'roll';
      span.textContent = text;
      el.appendChild(span);
    } else {
      el.textContent = text;
      if (cls && prev !== undefined) animate(el, cls);
    }
  }
  let lastMode = null;

  function teamCfg(t) {
    if (!t || !t.abbr || t.abbr.includes('/')) return TEAMS.TBD;          // "TB/CLE" until the ALCS ends
    if (TEAMS[t.abbr]) return TEAMS[t.abbr];
    return { ...GENERIC, city: (t.city || t.abbr).toUpperCase(),
             logo: t.id ? `https://www.mlbstatic.com/team-logos/team-cap-on-dark/${t.id}.svg` : '' };
  }

  function paintTeam(side, t) {
    const cfg = teamCfg(t);
    $(side).style.background = cfg.field;
    $(side + 'Score').style.background = cfg.chip;
    const city = $(side + 'City');
    setText(city, cfg.city, 'fade');
    city.classList.toggle('long', cfg.city.length > 10);
    const key = cfg.logo || 'tbd';
    if (logoKey[side] === key) return;
    logoKey[side] = key;
    const slot = $(side + 'Logo');
    slot.textContent = '';
    if (!cfg.logo) { slot.innerHTML = '<div class="tbd">TBD</div>'; return; }
    const img = new Image();
    img.alt = cfg.city; img.width = cfg.w; img.height = cfg.h;
    img.onerror = () => { slot.innerHTML = '<div class="tbd">' + ((t && t.abbr) || 'TBD') + '</div>'; };
    img.src = cfg.logo;
    slot.appendChild(img);
    if (logoKey.painted) animate(slot, 'fade');
  }

  function render(m) {
    const b = $('board');
    const stale = b.classList.contains('stale');
    const mode = m.status === 'live' ? 'is-live' : m.status === 'break' ? 'is-break' : 'is-label';
    const noScore = m.status === 'pre' || m.away.runs == null;           // before first pitch, incl. a pregame delay
    b.className = [mode, noScore ? 'pre' : '', stale ? 'stale' : ''].join(' ').trim();
    if (lastMode && lastMode !== mode) animate(document.querySelector('.' + mode.replace('is-', 'm-')), 'enter');

    paintTeam('away', m.away);
    paintTeam('home', m.home);
    logoKey.painted = true;
    setText($('awayScore'), m.away.runs, 'roll');
    setText($('homeScore'), m.home.runs, 'roll');
    const fin = m.status === 'final';
    const aR = nz(m.away.runs, 0), hR = nz(m.home.runs, 0);
    $('away').classList.toggle('lost', fin && aR < hR);
    $('home').classList.toggle('lost', fin && hR < aR);
    $('away').classList.toggle('won', fin && aR > hR);
    $('home').classList.toggle('won', fin && hR > aR);

    if (m.status === 'live') {
      $('arrow').classList.toggle('down', m.half === 'bottom');
      setText($('inning'), m.inning, 'roll');
      const on = m.bases || [];
      [1, 2, 3].forEach((n) => {
        const el = $('b' + n), now = on.includes(n);
        el.classList.toggle('on', now);
      });
      // Only a new ball or strike animates; a count reset for the next batter just swaps.
      const bl = nz(m.balls, 0), sk = nz(m.strikes, 0);
      setText($('balls'), bl, bl > Number(nz(shown.balls, 0)) ? 'tick' : null);
      setText($('strikes'), sk, sk > Number(nz(shown.strikes, 0)) ? 'tick' : null);
      [1, 2, 3].forEach((n) => {
        const el = $('o' + n), was = el.classList.contains('on'), now = n <= (nz(m.outs, 0));
        el.classList.toggle('on', now);
        if (lastMode === 'is-live' && now && !was) animate(el, 'pop');                    // out recorded
      });
    } else if (m.status === 'break') {
      setText($('breakWord'), m.half === 'end' ? 'END' : 'MID');
      setText($('breakInning'), m.inning);
    } else {
      const label = $('label'), main = $('main');
      label.classList.toggle('muted', m.status !== 'pre');
      main.classList.toggle('gold', m.status !== 'pre');
      if (m.status === 'pre') {
        label.textContent = 'GAME ' + (m.gameNo || '');
        main.textContent = m.time || '';
      } else if (m.status === 'delay') {
        label.textContent = m.inning ? (m.half === 'bottom' ? '▼ ' : '▲ ') + m.inning : 'GAME ' + (m.gameNo || '');
        main.textContent = m.note || '';
      } else {
        label.textContent = 'GAME ' + (m.gameNo || '');
        main.textContent = (m.inning || 9) > 9 ? 'FINAL/' + m.inning : 'FINAL';
      }
    }
    lastMode = mode;
  }

  // ---------- MLB live feed -> model ----------
  function fromFeed(d) {
    const g = d.gameData, ls = (d.liveData && d.liveData.linescore) || {};
    const st = g.status || {};
    const detailed = (st.detailedState || '').toLowerCase();
    const team = (side) => {
      const t = g.teams[side] || {};
      const r = ls.teams && ls.teams[side] ? ls.teams[side].runs : null;
      return { abbr: t.abbreviation, id: t.id, city: t.locationName || t.franchiseName, runs: nz(r, null) };
    };
    const m = {
      gameNo: gameNo || '',
      time: g.datetime && g.datetime.dateTime
        ? new Date(g.datetime.dateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' })
        : '',
      away: team('away'), home: team('home'),
      inning: ls.currentInning || 0,
      half: ({ Top: 'top', Bottom: 'bottom', Middle: 'mid', End: 'end' })[ls.inningState] || (ls.isTopInning ? 'top' : 'bottom'),
      bases: ['first', 'second', 'third'].map((k, i) => (ls.offense && ls.offense[k] ? i + 1 : 0)).filter(Boolean),
      balls: ls.balls, strikes: ls.strikes, outs: ls.outs
    };
    const started = m.away.runs != null && m.inning > 0;
    if (/postponed/.test(detailed)) { m.status = 'delay'; m.note = 'POSTPONED'; m.inning = 0; }
    else if (/suspended/.test(detailed)) { m.status = 'delay'; m.note = 'SUSPENDED'; }
    else if (st.abstractGameState === 'Final') m.status = 'final';
    else if (st.abstractGameState === 'Live' && started) {
      // Three outs but the feed hasn't flipped to Middle/End yet: treat it as the break.
      if (m.outs >= 3 && m.half === 'top') m.half = 'mid';
      if (m.outs >= 3 && m.half === 'bottom') m.half = 'end';
      m.status = (m.half === 'mid' || m.half === 'end') ? 'break' : 'live';
    } else m.status = 'pre';
    if (m.status === 'pre' || (m.status === 'delay' && !started)) { m.away.runs = null; m.home.runs = null; }
    return m;
  }

  // ---------- polling ----------
  // The live feed has no series game number; the schedule endpoint does. Fetched once (retried until it works).
  let gameNo = qs.get('gameno') || '';
  async function loadGameNo() {
    if (gameNo) return;
    try {
      const s = await fetchJSON(`${API}/api/v1/schedule?gamePk=${gamePk}`);
      gameNo = s.dates[0].games[0].seriesGameNumber || '';
    } catch (e) { /* try again next tick */ }
  }
  let retry = 0, timer = null;
  function fetchJSON(url) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), FETCH_TIMEOUT_MS);
    return fetch(url, { signal: c.signal, cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .finally(() => clearTimeout(t));
  }
  async function tick(myGen) {
    let delay = POLL_LIVE_MS;
    try {
      if (!qs.get('feed')) await loadGameNo();
      const d = await fetchJSON(qs.get('feed') || `${API}/api/v1.1/game/${gamePk}/feed/live`);
      if (myGen !== gen) return;                 // the controller switched modes mid-request
      const m = fromFeed(d);
      render(m);
      delay = m.status === 'pre' ? POLL_PRE_MS : m.status === 'final' ? POLL_FINAL_MS : POLL_LIVE_MS;
      retry = 0;
      $('board').classList.remove('stale');
    } catch (e) {
      retry++;                                   // keep the last good frame; back off and retry
      delay = Math.min(1000 * 2 ** retry, MAX_RETRY_MS);
      if (retry >= 3) $('board').classList.add('stale');
      console.warn('OTS feed error', e);
    }
    if (myGen !== gen) return;
    clearTimeout(timer);
    timer = setTimeout(() => tick(myGen), delay);
  }

  // ---------- demo: every scenario, in game order (Brewers ahead or winning throughout) ----------
  const TB = { abbr: 'TB', id: 139 }, MIL = { abbr: 'MIL', id: 158 }, CLE = { abbr: 'CLE', id: 114 }, TBD = { abbr: 'TB/CLE' };
  const T = (t, runs) => ({ ...t, runs });
  const DEMO = {
    'pre-tbd':  { status: 'pre', gameNo: 2, time: '7:00 PM', away: T(TBD, null), home: T(MIL, null) },
    'pre-cle':  { status: 'pre', gameNo: 2, time: '7:00 PM', away: T(CLE, null), home: T(MIL, null) },
    'live':     { status: 'live', gameNo: 2, inning: 7, half: 'top', bases: [1, 3], balls: 2, strikes: 1, outs: 1, away: T(TB, 2), home: T(MIL, 4) },
    'mid':      { status: 'break', gameNo: 2, inning: 7, half: 'mid', away: T(TB, 2), home: T(MIL, 4) },
    'top9':     { status: 'live', gameNo: 2, inning: 9, half: 'top', bases: [1, 2, 3], balls: 3, strikes: 2, outs: 2, away: T(TB, 9), home: T(MIL, 10) },
    'final':    { status: 'final', gameNo: 2, inning: 9, away: T(TB, 1), home: T(MIL, 3) },
    'final-10': { status: 'final', gameNo: 2, inning: 10, away: T(TB, 4), home: T(MIL, 5) }
  };

  // ?demo=sim: a half inning play by play, to show the in-play animations.
  const L = (o) => ({ status: 'live', gameNo: 2, inning: 7, half: 'top', bases: [], balls: 0, strikes: 0, outs: 0, away: T(TB, 2), home: T(MIL, 4), ...o });
  const SIM = [
    L({}), L({ balls: 1 }), L({ balls: 1, strikes: 1 }), L({ bases: [1] }),                       // single
    L({ bases: [1], strikes: 1 }), L({ bases: [1], outs: 1 }),                                     // strikeout
    L({ bases: [2], outs: 1 }),                                                                     // stolen base
    L({ bases: [1, 3], outs: 1, balls: 2 }),                                                        // single, runner to 3rd
    L({ bases: [2], outs: 1, away: T(TB, 3) }),                                                     // double, run scores
    L({ bases: [2], outs: 2 }, ), L({ bases: [2], outs: 2, away: T(TB, 3), strikes: 2 }),
    L({ bases: [], outs: 3, away: T(TB, 3) }),                                                      // inning over
    { status: 'break', gameNo: 2, inning: 7, half: 'mid', away: T(TB, 3), home: T(MIL, 4) },
    L({ half: 'bottom', away: T(TB, 3) }), L({ half: 'bottom', bases: [1], away: T(TB, 3) }),
    L({ half: 'bottom', bases: [], away: T(TB, 3), home: T(MIL, 6) })                               // two-run homer
  ];
  SIM.forEach((m) => { if (m.away.runs == null) m.away.runs = 3; });

  // ---------- scripted games: ?demo=walkoff | slam | extras | comeback | game ----------
  // Each step only lists what changed: s status, i inning, h half, b bases, c count, o outs, a/m runs, t hold (ms).
  function script(steps) {
    let cur = { status: 'live', gameNo: 2, time: '7:00 PM', inning: 1, half: 'top', bases: [], balls: 0, strikes: 0, outs: 0, away: T(TB, 0), home: T(MIL, 0) };
    return steps.map((st) => {
      const n = { ...cur, away: { ...cur.away }, home: { ...cur.home } };
      if (st.s) n.status = st.s;
      if (st.i != null) n.inning = st.i;
      if (st.h) n.half = st.h;
      if (st.b) n.bases = st.b;
      if (st.c) { const [bb, ss] = st.c.split('-').map(Number); n.balls = bb; n.strikes = ss; }
      if (st.o != null) n.outs = st.o;
      if (st.a != null) n.away.runs = st.a;
      if (st.m != null) n.home.runs = st.m;
      if (st.opp) n.away = { ...st.opp, runs: n.away.runs };
      if (n.status !== 'live') { n.bases = []; n.balls = 0; n.strikes = 0; n.outs = 0; }
      if (n.status === 'pre') { n.away.runs = null; n.home.runs = null; }
      cur = n;
      return { m: n, t: st.t || 1200 };
    });
  }
  const GAMES = {
    // Tied 3-3 in the bottom 9th. Leadoff single, steal, two outs, walk-off single.
    walkoff: script([
      { s: 'break', i: 8, h: 'end', a: 3, m: 3, t: 1800 },
      { s: 'live', i: 9, h: 'bottom', c: '0-0', o: 0 }, { c: '1-0' }, { c: '1-1' }, { b: [1], c: '0-0' },
      { b: [2] }, { c: '0-1' }, { o: 1, c: '0-0' }, { c: '1-0' }, { o: 2, c: '0-0' }, { c: '0-1' }, { c: '1-1' }, { c: '1-2' },
      { b: [], m: 4, t: 900 }, { s: 'final', i: 9, t: 5000 }
    ]),
    // Tied 2-2, bottom 8th. Walk, hit by pitch, single loads them, grand slam.
    slam: script([
      { s: 'live', i: 8, h: 'bottom', a: 2, m: 2, c: '0-0' }, { c: '1-0' }, { c: '2-0' }, { c: '3-0' }, { b: [1], c: '0-0' },
      { c: '0-1' }, { b: [1, 2], c: '0-0' }, { c: '1-0' }, { b: [1, 2, 3], c: '0-0' }, { c: '0-1' }, { c: '1-1' },
      { b: [], m: 6, c: '0-0', t: 1600 }, { o: 1 }, { c: '0-1' }, { o: 2, c: '0-0' }, { o: 3, t: 900 },
      { s: 'break', i: 8, h: 'end', t: 1800 }, { s: 'live', i: 9, h: 'top', c: '0-0', o: 0 }, { o: 1 }, { c: '0-1' }, { o: 2, c: '0-0' },
      { c: '1-2' }, { o: 3, t: 900 }, { s: 'final', i: 9, t: 5000 }
    ]),
    // 3-3 after nine. Rays go down in order in the 10th, Brewers walk it off with a homer.
    extras: script([
      { s: 'break', i: 9, h: 'end', a: 3, m: 3, t: 1800 },
      { s: 'live', i: 10, h: 'top', c: '0-0', o: 0 }, { c: '0-1' }, { o: 1, c: '0-0' }, { c: '1-1' }, { o: 2, c: '0-0' }, { c: '0-2' }, { o: 3, t: 900 },
      { s: 'break', i: 10, h: 'mid', t: 1800 }, { s: 'live', i: 10, h: 'bottom', c: '0-0', o: 0 }, { c: '1-0' }, { c: '1-1' },
      { m: 4, c: '0-0', t: 900 }, { s: 'final', i: 10, t: 5000 }
    ]),
    // Rays up 3-0 in the 6th; Brewers chip back and take the lead in the 7th, then close it out.
    comeback: script([
      { s: 'live', i: 6, h: 'bottom', a: 3, m: 0, c: '0-0' }, { b: [1] }, { b: [1, 2], c: '0-0' }, { o: 1 }, { b: [2, 3], c: '0-0' },
      { b: [3], m: 1, o: 2 }, { c: '1-2' }, { o: 3, t: 900 }, { s: 'break', i: 6, h: 'end', t: 1800 },
      { s: 'live', i: 7, h: 'top', b: [], c: '0-0', o: 0 }, { o: 1 }, { o: 2 }, { o: 3, t: 900 }, { s: 'break', i: 7, h: 'mid', t: 1800 },
      { s: 'live', i: 7, h: 'bottom', c: '0-0', o: 0 }, { b: [1] }, { b: [1, 2] }, { b: [], m: 4, t: 1600 }, { o: 1 }, { o: 2 }, { o: 3, t: 900 },
      { s: 'break', i: 7, h: 'end', t: 1500 }, { s: 'break', i: 8, h: 'end', t: 1500 },
      { s: 'live', i: 9, h: 'top', c: '0-0', o: 0 }, { o: 1 }, { b: [1] }, { o: 2 }, { c: '2-2' }, { o: 3, t: 900 }, { s: 'final', i: 9, t: 5000 }
    ]),
    // Whole night, fast: opponent decided, pregame, first pitch, a few innings, final.
    game: script([
      { s: 'pre', opp: TBD, t: 2000 }, { s: 'pre', opp: TB, t: 2500 },
      { s: 'live', i: 1, h: 'top', a: 0, m: 0, c: '0-0', o: 0 }, { c: '0-1' }, { o: 1, c: '0-0' }, { o: 2 }, { o: 3, t: 900 },
      { s: 'break', i: 1, h: 'mid', t: 1500 }, { s: 'live', i: 1, h: 'bottom', o: 0 }, { b: [1] }, { b: [], m: 2, t: 1500 }, { o: 1 }, { o: 2 }, { o: 3, t: 900 },
      { s: 'break', i: 1, h: 'end', t: 1500 }, { s: 'break', i: 3, h: 'mid', t: 1300 }, { s: 'live', i: 3, h: 'bottom', o: 0, c: '0-0' },
      { b: [2] }, { m: 3, b: [] }, { o: 3, t: 900 }, { s: 'break', i: 5, h: 'end', a: 1, t: 1300 },
      { s: 'live', i: 7, h: 'top', o: 0 }, { b: [1] }, { b: [1, 2] }, { a: 2, b: [1] }, { o: 2 }, { o: 3, t: 900 }, { s: 'break', i: 7, h: 'mid', t: 1500 },
      { s: 'break', i: 8, h: 'end', m: 5, t: 1500 }, { s: 'live', i: 9, h: 'top', o: 0, c: '0-0' }, { o: 1 }, { o: 2 }, { c: '1-2' }, { o: 3, t: 900 },
      { s: 'final', i: 9, t: 6000 }
    ])
  };
  function playScript(frames) {
    let i = 0;
    const step = () => { render(frames[i].m); const t = frames[i].t; i = (i + 1) % frames.length; timer = setTimeout(step, t); };
    step();
  }

  // ---------- what to show: live feed, a demo scenario, or hold the current frame ----------
  let gen = 0;                                        // bumps on every mode change; stale loops check it and stop
  function stopAll() { gen++; clearTimeout(timer); clearInterval(timer); timer = null; retry = 0; }
  function playDemo(name) {
    const names = Object.keys(DEMO);
    if (GAMES[name]) return playScript(GAMES[name]);
    if (name === 'sim') return playScript(SIM.map((m) => ({ m, t: 1500 })));
    if (DEMO[name]) return render(DEMO[name]);
    playScript(names.map((n) => ({ m: DEMO[n], t: 3000 })));            // 'cycle': every state in game order
  }
  function apply(c) {
    stopAll();
    if (c.mode === 'hold') return;                    // leave the last frame on screen
    if (c.mode === 'demo') return playDemo(c.scenario || 'cycle');
    const pk = c.gamePk || DEFAULT_GAME_PK;
    if (pk !== gamePk) { gamePk = pk; if (!qs.get('gameno')) gameNo = ''; }
    tick(gen);
  }

  // Remote control: the board asks the site what to show every few seconds (staff change it at /ots/control.html).
  // A ?demo= or ?feed= URL, or ?control=0, is a manual test and ignores the controller.
  const demo = qs.get('demo');
  const controlled = !demo && !qs.get('feed') && qs.get('control') !== '0';
  let controlKey = null;
  async function pollControl() {
    try {
      const r = await fetchJSON('/api/ots/control');
      const c = r.data || {};
      const key = [c.mode, c.scenario, c.gamePk].join('|');
      if (key !== controlKey) { controlKey = key; apply(c); }
    } catch (e) {
      if (controlKey === null) { controlKey = 'live||'; apply({ mode: 'live' }); }   // site unreachable: run live
    }
    setTimeout(pollControl, CONTROL_POLL_MS);
  }

  if (demo) playDemo(demo === '1' ? 'cycle' : demo);
  else if (controlled) pollControl();
  else apply({ mode: 'live' });
  window.OTS = { render, fromFeed, DEMO, GAMES };      // for testing from the console
})();
