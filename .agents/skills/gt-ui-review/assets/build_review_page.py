#!/usr/bin/env python3
"""Build a Wisconsin Creative UI review page from a spec JSON.

    python3 build_review_page.py spec.json out.html
    python3 build_review_page.py --example        # print a complete spec

Images are resized and embedded as data URIs, so the page is self-contained and
publishes as an Artifact without external requests.
"""
import base64
import html
import json
import subprocess
import sys
import tempfile
from pathlib import Path

PAIR_WIDTH = 620
WIDE_WIDTH = 900


def embed(path, width):
    src = Path(path).expanduser()
    if not src.is_file():
        raise SystemExit(f"image not found: {src}")
    with tempfile.TemporaryDirectory() as tmp:
        copy = Path(tmp) / src.name
        copy.write_bytes(src.read_bytes())
        subprocess.run(["sips", "-Z", str(width), str(copy)],
                       capture_output=True, check=False)
        data = copy.read_bytes()
    return "data:image/png;base64," + base64.b64encode(data).decode()


def esc(text):
    return html.escape(str(text), quote=False)


def rich(text):
    """Spec text may carry inline <code>/<strong>/<em>; leave those alone."""
    return str(text)


def stat_block(s):
    tone = " down" if s.get("tone") == "good" else ""
    return f"""
    <div class="stat">
      <p class="k">{esc(s['k'])}</p>
      <p class="v{tone}">{rich(s['v'])}</p>
      <p class="n">{rich(s.get('n', ''))}</p>
    </div>"""


def pair_block(p):
    wide = p.get("wide")
    width = WIDE_WIDTH if wide else PAIR_WIDTH
    return f"""
      <section class="pair">
        <div class="pair-head">
          <h3>{esc(p['title'])}</h3>
          <p>{rich(p.get('sub', ''))}</p>
        </div>
        <div class="shots">
          <figure>
            <span class="tag tag-before">{esc(p.get('beforeTag', 'Before'))}</span>
            <img src="{embed(p['before'], width)}" alt="{esc(p['title'])}, before">
            <figcaption>{rich(p.get('beforeCap', ''))}</figcaption>
          </figure>
          <figure>
            <span class="tag tag-after">{esc(p.get('afterTag', 'After'))}</span>
            <img src="{embed(p['after'], width)}" alt="{esc(p['title'])}, after">
            <figcaption>{rich(p.get('afterCap', ''))}</figcaption>
          </figure>
        </div>
      </section>"""


def section_block(sec):
    pairs = "".join(pair_block(p) for p in sec.get("pairs", []))
    note = f'<p class="sec-note">{rich(sec["note"])}</p>' if sec.get("note") else ""
    return f"""
  <h2>{esc(sec['heading'])}</h2>
  {note}
  {pairs}"""


def change_block(c):
    return f"""
  <div class="change">
    <h3>{esc(c['h'])}</h3>
    <div class="ba">
      <div><span class="lbl lbl-b">{esc(c.get('wasLabel', 'Was'))}</span><p>{rich(c['was'])}</p></div>
      <div><span class="lbl lbl-a">{esc(c.get('nowLabel', 'Now'))}</span><p>{rich(c['now'])}</p></div>
    </div>
  </div>"""


def panel(items, flag=False):
    lis = "".join(f"<li>{rich(i)}</li>" for i in items)
    cls = "panel flag" if flag else "panel"
    return f'<div class="{cls}"><ul>{lis}</ul></div>'


CSS = """
  :root {
    --ground:#EEF0F4; --surface:#FFFFFF; --raised:#F7F8FA;
    --ink:#14171C; --muted:#5B6472; --faint:#8B95A3;
    --line:#D8DDE5; --accent:#C5050C; --good:#1B7F3B; --warn:#A65A00;
    --shadow:0 1px 2px rgba(20,23,28,.06), 0 8px 24px rgba(20,23,28,.06);
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --ground:#131519; --surface:#1B1E24; --raised:#22262E;
      --ink:#E9ECF1; --muted:#9AA4B2; --faint:#727D8C;
      --line:#2C313A; --accent:#F2545B; --good:#4ADE80; --warn:#F0A64A;
      --shadow:0 1px 2px rgba(0,0,0,.4), 0 8px 24px rgba(0,0,0,.35);
    }
  }
  :root[data-theme="dark"] {
    --ground:#131519; --surface:#1B1E24; --raised:#22262E;
    --ink:#E9ECF1; --muted:#9AA4B2; --faint:#727D8C;
    --line:#2C313A; --accent:#F2545B; --good:#4ADE80; --warn:#F0A64A;
    --shadow:0 1px 2px rgba(0,0,0,.4), 0 8px 24px rgba(0,0,0,.35);
  }
  * { box-sizing:border-box; }
  body {
    margin:0; background:var(--ground); color:var(--ink);
    font-family:"Public Sans", ui-sans-serif, system-ui, sans-serif;
    font-size:16px; line-height:1.6; -webkit-font-smoothing:antialiased;
  }
  .wrap { max-width:1080px; margin:0 auto; padding:56px 24px 96px; }
  .eyebrow {
    font-family:"IBM Plex Mono", ui-monospace, monospace; font-size:.72rem;
    letter-spacing:.14em; text-transform:uppercase; color:var(--accent); margin:0 0 14px;
  }
  h1 {
    font-family:"Archivo Narrow", Arial Narrow, sans-serif; font-weight:700;
    font-size:clamp(2.4rem,6vw,3.9rem); line-height:1.02; letter-spacing:-.015em;
    margin:0 0 18px; text-wrap:balance;
  }
  .lede { font-size:1.12rem; color:var(--muted); max-width:60ch; margin:0; }
  .rule { height:2px; background:var(--accent); width:64px; margin:34px 0 0; border:0; }
  .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:14px; margin:44px 0 0; }
  .stat { background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:20px; box-shadow:var(--shadow); }
  .stat .k { font-family:"IBM Plex Mono", monospace; font-size:.68rem; letter-spacing:.12em;
             text-transform:uppercase; color:var(--faint); margin:0 0 10px; }
  .stat .v { font-family:"Archivo Narrow", sans-serif; font-weight:700; font-size:2.15rem;
             line-height:1; margin:0 0 6px; font-variant-numeric:tabular-nums; }
  .stat .n { font-size:.86rem; color:var(--muted); margin:0; line-height:1.45; }
  .down { color:var(--good); }
  h2 { font-family:"Archivo Narrow", sans-serif; font-weight:700;
       font-size:1.9rem; letter-spacing:-.01em; margin:72px 0 6px; }
  .sec-note { color:var(--muted); margin:0 0 26px; font-size:.95rem; }
  .pair { margin:0 0 40px; }
  .pair-head h3 { font-family:"Archivo Narrow",sans-serif; font-weight:600; font-size:1.2rem; margin:0 0 2px; }
  .pair-head p { margin:0 0 16px; color:var(--muted); font-size:.92rem; }
  .shots { display:grid; grid-template-columns:1fr 1fr; gap:18px; }
  figure { margin:0; display:flex; flex-direction:column; gap:10px; }
  figure img { width:100%; height:auto; display:block; border-radius:14px;
               border:1px solid var(--line); box-shadow:var(--shadow); background:var(--surface); }
  figcaption { font-size:.85rem; color:var(--muted); line-height:1.5; }
  .tag { font-family:"IBM Plex Mono",monospace; font-size:.66rem; letter-spacing:.12em;
         text-transform:uppercase; padding:4px 9px; border-radius:5px; align-self:flex-start; font-weight:600; }
  .tag-before { background:color-mix(in srgb, var(--muted) 14%, transparent); color:var(--muted); }
  .tag-after { background:color-mix(in srgb, var(--accent) 13%, transparent); color:var(--accent); }
  .change { border-top:1px solid var(--line); padding:22px 0 4px; }
  .change h3 { font-family:"Archivo Narrow",sans-serif; font-weight:600; font-size:1.18rem; margin:0 0 14px; }
  .ba { display:grid; grid-template-columns:1fr 1fr; gap:26px; }
  .ba p { margin:6px 0 0; font-size:.93rem; color:var(--muted); }
  .lbl { font-family:"IBM Plex Mono",monospace; font-size:.64rem; letter-spacing:.13em;
         text-transform:uppercase; font-weight:600; }
  .lbl-b { color:var(--faint); }
  .lbl-a { color:var(--accent); }
  .panel { background:var(--surface); border:1px solid var(--line); border-radius:12px;
           padding:24px 26px; box-shadow:var(--shadow); }
  .panel ul { margin:0; padding-left:19px; }
  .panel li { margin:0 0 9px; font-size:.94rem; }
  .panel li:last-child { margin-bottom:0; }
  code { font-family:"IBM Plex Mono",monospace; font-size:.86em; background:var(--raised);
         border:1px solid var(--line); padding:1px 5px; border-radius:4px; }
  .flag { border-left:3px solid var(--warn); }
  @media (max-width:720px) {
    .wrap { padding:36px 16px 64px; }
    .ba { grid-template-columns:1fr; gap:16px; }
  }
"""

EXAMPLE = {
    "title": "Schedule Row Rework",
    "eyebrow": "iOS · Wisconsin Creative",
    "lede": "One sentence on who reads this screen and what it must answer.",
    "stats": [
        {"k": "Standard row", "v": "&minus;26%", "n": "84pt &rarr; 62pt, measured off the captures", "tone": "good"},
        {"k": "Rows per screen", "v": "5 &rarr; 7", "n": "Same viewport, same fixture data"},
    ],
    "sections": [
        {"heading": "Side by side",
         "note": "Same build, same fixture data, same scroll positions.",
         "pairs": [
             {"title": "Top of list", "sub": "Today and Tomorrow.",
              "before": "before/top.png", "beforeCap": "What the reader had to do.",
              "after": "after/top.png", "afterCap": "What they do now."},
         ]},
    ],
    "changes": [
        {"h": "Time was buried in the card",
         "was": "Where it sat, and what that cost the reader.",
         "now": "What replaced it, and why that answers the question faster."},
    ],
    "verification": [
        "<strong>45 Swift unit tests</strong> pass.",
        "<strong>Full web suite:</strong> 3406 passing, 3 failing; the 3 reproduce on a clean checkout of <code>HEAD</code>.",
    ],
    "notes": [
        "Anything you did not do, and what it would take to finish it.",
    ],
}


def build(spec):
    stats = "".join(stat_block(s) for s in spec.get("stats", []))
    stats_html = f'<div class="stats">{stats}</div>' if stats else ""
    sections = "".join(section_block(s) for s in spec.get("sections", []))
    changes = spec.get("changes", [])
    changes_html = ""
    if changes:
        note = spec.get("changesNote", "")
        note_html = f'<p class="sec-note">{rich(note)}</p>' if note else ""
        changes_html = (f'<h2>{esc(spec.get("changesHeading", "What changed, and why"))}</h2>'
                        + note_html + "".join(change_block(c) for c in changes))
    verif = spec.get("verification", [])
    verif_html = f"<h2>Verification</h2>{panel(verif)}" if verif else ""
    notes = spec.get("notes", [])
    notes_html = (f'<h2>{esc(spec.get("notesHeading", "Things to know"))}</h2>'
                  + panel(notes, flag=True)) if notes else ""

    return f"""<title>{esc(spec['title'])}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo+Narrow:wght@600;700&family=Public+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap">
<style>{CSS}</style>

<div class="wrap">
  <header>
    <p class="eyebrow">{esc(spec.get('eyebrow', ''))}</p>
    <h1>{esc(spec['title'])}</h1>
    <p class="lede">{rich(spec.get('lede', ''))}</p>
    <hr class="rule">
  </header>
  {stats_html}
  {sections}
  {changes_html}
  {verif_html}
  {notes_html}
</div>
"""


def main():
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        raise SystemExit(__doc__)
    if args[0] == "--example":
        print(json.dumps(EXAMPLE, indent=2))
        return
    if len(args) != 2:
        raise SystemExit(__doc__)
    spec = json.loads(Path(args[0]).read_text())
    out = Path(args[1])
    out.write_text(build(spec))
    print(f"wrote {out} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
