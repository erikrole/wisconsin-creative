  const GAMES = [
    ['game', 'Whole night, fast', 'Opponent decided, pregame, first pitch, a few innings, Brewers win 5-2.'],
    ['walkoff', 'Walk-off single', 'Tied 3-3 in the bottom 9th: leadoff single, steal, two outs, walk-off single.'],
    ['slam', 'Grand slam', 'Tied 2-2 in the bottom 8th: walk, hit by pitch, single, grand slam, then the 9th.'],
    ['comeback', 'Comeback', 'Rays up 3-0 in the 6th; Brewers get one back, then take the lead in the 7th.'],
    ['extras', 'Extra innings', '3-3 after nine; Rays go down in order in the 10th, Brewers walk it off with a homer.'],
    ['sim', 'Half inning, pitch by pitch', 'Single, strikeout, steal, first and third, RBI double, third out, MID 7, two-run homer.']
  ];
  const list = document.getElementById('list');
  let zoom = 2;
  for (const [id, title, note] of GAMES) {
    const sec = document.createElement('section');
    sec.innerHTML = `<div class="row"><div><h2></h2><p></p></div><button type="button">Restart</button></div><div class="frame"><iframe title=""></iframe></div>`;
    sec.querySelector('h2').textContent = title;
    sec.querySelector('p').textContent = note;
    const f = sec.querySelector('iframe');
    f.title = title;
    f.src = `index.html?demo=${id}`;
    sec.querySelector('button').onclick = () => { f.src = f.src; };
    list.appendChild(sec);
  }
  function setZoom(z) {
    zoom = z;
    document.querySelectorAll('iframe').forEach((f) => { f.style.transform = `scale(${z})`; f.parentNode.style.width = 825 * z + 'px'; f.parentNode.style.height = 60 * z + 'px'; });
    document.getElementById('z1').setAttribute('aria-pressed', z === 1);
    document.getElementById('z2').setAttribute('aria-pressed', z === 2);
  }
  document.getElementById('z1').onclick = () => setZoom(1);
  document.getElementById('z2').onclick = () => setZoom(2);
  document.getElementById('restart').onclick = () => document.querySelectorAll('iframe').forEach((f) => { f.src = f.src; });
  setZoom(2);
