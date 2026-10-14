// The /apps page, rendered per request so it can sit behind sign-in. Edit the app
// data below (version, release date, links) when an app ships.
import { formatAppDate } from "@/lib/apps-page-format";

export type AppEntry = {
  name: string;
  icon?: string;
  platform: string;
  status: string;
  statusKind: "live" | "beta" | "soon";
  blurb: string;
  version?: string;
  /** ISO date (YYYY-MM-DD) in Madison time. */
  released?: string;
  href?: string;
  cta?: string;
};

export const appEntries: AppEntry[] = [
  {
    name: "Wisconsin Creative",
    icon: "wisconsin-creative",
    platform: "iPhone and iPad",
    status: "",
    statusKind: "live",
    blurb: "Reserve and check out gear, see your shifts, and look up equipment.",
    version: "1.2",
    released: "2026-09-14",
    href: "https://apps.apple.com/us/app/wisconsin-creative/id6763456945",
    cta: "View on the App Store",
  },
  {
    name: "Offload",
    icon: "offload",
    platform: "macOS",
    status: "Beta",
    statusKind: "beta",
    blurb: "Ingests Sony FX6 and FX3 cards, matches clips to the play-by-play, and names them for editing.",
    version: "1.0.8",
  },
  {
    name: "Radio Clip",
    icon: "radio",
    platform: "macOS",
    status: "Coming soon",
    statusKind: "soon",
    blurb: "Cuts highlight clips from radio broadcasts and exports them as MP3.",
    version: "0.1.0",
  },
  {
    name: "Media Lab",
    platform: "",
    status: "Coming Late 2026",
    statusKind: "soon",
    blurb: "Media asset management on top of our existing media drive. Metadata, search, and quick viewing without moving files.",
  },
];

function esc(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const placeholderIcon = `<svg viewBox="0 0 96 96" width="96" height="96"><rect width="96" height="96" rx="22" fill="#c5050c"/><rect x="22" y="26" width="52" height="44" rx="6" fill="none" stroke="#fff" stroke-width="4"/><circle cx="37" cy="41" r="5" fill="#fff"/><path d="M24 66l16-16 10 10 8-8 14 14z" fill="#fff"/></svg>`;

function appCard(app: AppEntry) {
  const platformPill = app.platform ? `<span class="pill left">${esc(app.platform)}</span>` : "";
  const statusPill = app.status ? `<span class="pill right ${app.statusKind}">${esc(app.status)}</span>` : "";
  const meta = app.version
    ? `<p class="meta">Version ${esc(app.version)}${app.released ? ` · ${formatAppDate(app.released)}` : ""}</p>`
    : "";
  const body = `
          <div class="art">${platformPill}${statusPill}${app.icon ? `<img src="/apps/icons/${app.icon}.png" alt="" width="96" height="96">` : placeholderIcon}</div>
          <div class="copy">
            <h2>${esc(app.name)}</h2>
            <p>${esc(app.blurb)}</p>
            ${meta}
            ${app.cta ? `<span class="go${app.href ? "" : " pending"}">${esc(app.cta)} <i>→</i></span>` : ""}
          </div>`;
  return app.href
    ? `<li><a class="tool app" href="${esc(app.href)}">${body}</a></li>`
    : `<li><div class="tool app soon">${body}</div></li>`;
}

export function renderAppsPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="referrer" content="no-referrer">
  <meta name="robots" content="noindex">
  <meta name="color-scheme" content="light">
  <meta name="theme-color" content="#c5050c">
  <title>Wisconsin Creative Tools</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3.5' fill='%23c5050c'/%3E%3Cpath fill='%23fff' d='M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H3zM9 9h4v4H9z'/%3E%3C/svg%3E">
  <style>
@font-face { font-family: "Gotham"; src: url("/Gotham-Black.woff2") format("woff2"); font-weight: 800; font-display: swap; }
    @font-face { font-family: "Gotham"; src: url("/Gotham-Bold.woff2") format("woff2"); font-weight: 700; font-display: swap; }
    @font-face { font-family: "Gotham"; src: url("/Gotham-Book.woff2") format("woff2"); font-weight: 400; font-display: swap; }


    /* The hub is plain paper so each tool's own look can show on its card. */
    :root {
      --paper: #f3f1ec; --ink: #15151a; --ink-2: #4a4a52; --ink-3: #7a7973; --line: #dcd9d1;
      --red: #c5050c; --focus: #c5050c; --ease: cubic-bezier(0.2, 0, 0, 1);
      --font: "Gotham", system-ui, -apple-system, "Segoe UI", sans-serif;
      --mono: var(--font);
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-width: 300px; background: var(--paper); color: var(--ink); font-family: var(--font); font-size: 15px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
    :focus-visible { outline: 3px solid var(--focus); outline-offset: 4px; border-radius: 18px; }

    .topbar { display: flex; align-items: center; gap: 10px; padding: max(18px, env(safe-area-inset-top)) clamp(16px, 4vw, 40px) 0; }
    .mw { width: 36px; height: 36px; display: block; }
    .mark { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 8px; background: var(--red); }
    .mark svg { width: 15px; height: 15px; }
    .topbar span { font-size: 12px; font-weight: 800; letter-spacing: 0.2em; text-transform: uppercase; }

    main { width: min(1200px, calc(100% - 32px)); margin: 0 auto; padding: clamp(36px, 8vw, 88px) 0 64px; }
    .band { height: 6px; background: var(--red); }
    .kicker { margin: 0 0 14px; font-size: 12px; font-weight: 800; letter-spacing: 0.2em; text-transform: uppercase; color: var(--red); }
    h1 { margin: 0; font-size: clamp(36px, 7vw, 72px); font-weight: 800; letter-spacing: -0.03em; line-height: 0.95; text-transform: uppercase; }
    h1 em { font-style: normal; color: var(--red); }
    .lede { margin: 22px 0 clamp(32px, 6vw, 56px); max-width: 520px; font-size: 17px; color: var(--ink-2); }

    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; list-style: none; margin: 0; padding: 0; }
    @media (max-width: 1000px) { .grid { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 560px) { .grid { grid-template-columns: 1fr; } }
    .tool {
      position: relative; display: flex; flex-direction: column; height: 100%; min-height: 340px; overflow: hidden;
      border-radius: 22px; color: inherit; text-decoration: none;
      box-shadow: 0 1px 2px rgba(20, 20, 25, 0.08), 0 18px 40px -24px rgba(20, 20, 25, 0.45);
      transition: transform 260ms var(--ease), box-shadow 260ms var(--ease);
    }
    .tool::after { content: ""; position: absolute; inset: 0; border-radius: inherit; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.12); pointer-events: none; }
    .app::after { box-shadow: none; }
    .tool:hover { transform: translateY(-4px); box-shadow: 0 1px 2px rgba(20, 20, 25, 0.08), 0 30px 60px -26px rgba(20, 20, 25, 0.55); }
    .art { position: relative; flex: none; height: 188px; }
    .copy { position: relative; display: flex; flex-direction: column; flex: 1; padding: 20px 22px 22px; }
    .copy h2 { margin: 0 0 6px; font-size: 22px; font-weight: 800; letter-spacing: -0.01em; text-transform: uppercase; }
    .copy p { margin: 0; font-size: 14px; line-height: 1.5; }
    .go { display: inline-flex; align-items: center; gap: 8px; margin-top: auto; padding-top: 16px; font-size: 14px; font-weight: 700; letter-spacing: 0.01em; }
    .go i { display: inline-block; transition: transform 260ms var(--ease); font-style: normal; }
    .tool:hover .go i { transform: translateX(4px); }

    /* Golden Hour: its evening sky and the sun's arc */
    .gh { background: linear-gradient(180deg, #232552 0%, #4b3f78 30%, #9c5277 58%, #de7560 80%, #f4a24c 100%); color: #fff7ee; }
    .gh .copy p { color: rgba(255, 247, 238, 0.82); }
    .gh .art svg { position: absolute; inset: 16px 16px 0; width: calc(100% - 32px); height: calc(100% - 16px); }

    /* Timelapse: the viewfinder */
    .tl { background: #0c0d0f; color: #f2f2ef; }
    .tl .copy p { color: #b9b9b3; }
    .tl .art { height: 172px; margin: 16px 16px 0; border-radius: 14px; background: radial-gradient(80% 70% at 50% 45%, rgba(255,255,255,.06), transparent 70%), #050506; border: 1px solid #26272d; display: grid; place-items: center; }
    .tl .corner { position: absolute; width: 18px; height: 18px; border: 0 solid rgba(255,255,255,.75); }
    .tl .c1 { top: 10px; left: 10px; border-top-width: 2px; border-left-width: 2px; }
    .tl .c2 { top: 10px; right: 10px; border-top-width: 2px; border-right-width: 2px; }
    .tl .c3 { bottom: 10px; left: 10px; border-bottom-width: 2px; border-left-width: 2px; }
    .tl .c4 { bottom: 10px; right: 10px; border-bottom-width: 2px; border-right-width: 2px; }
    .tl .rec { position: absolute; top: 12px; left: 36px; display: flex; align-items: center; gap: 6px; font-family: var(--mono); font-size: 11px; color: #b9b9b3; }
    .tl .rec i { width: 7px; height: 7px; border-radius: 50%; background: #ff3b3b; box-shadow: 0 0 8px rgba(255,59,59,.8); }
    .tl .readout { text-align: center; }
    .tl .readout small { display: block; font-size: 10px; font-weight: 700; letter-spacing: 0.22em; color: #ffb224; }
    .tl .readout b { font-size: 64px; font-weight: 800; letter-spacing: -0.04em; line-height: 1; }

    /* Board Sizes: blueprint */
    .bs { background: #0b2a52; color: #eef5ff;
      background-image: linear-gradient(rgba(150,195,255,.12) 1px, transparent 1px), linear-gradient(90deg, rgba(150,195,255,.12) 1px, transparent 1px);
      background-size: 22px 22px; }
    .bs .copy p { color: #b7cdec; }
    .bs .art { display: grid; place-items: center; }
    .bs .art svg { width: 78%; height: auto; }

    /* QR Studio: its red and a code */
    .qr { background: #a00000; color: #fff; }
    .qr .copy p { color: rgba(255, 255, 255, 0.84); }
    .qr .art { display: grid; place-items: center; }
    .qr .code { width: 132px; height: 132px; padding: 12px; border-radius: 16px; background: #fff; box-shadow: 0 16px 34px -14px rgba(0,0,0,.6); transform: rotate(-4deg); transition: transform 260ms var(--ease); }
    .tool.qr:hover .code { transform: rotate(0); }
    .qr .code svg { width: 100%; height: 100%; display: block; }


    h2.section { margin: clamp(40px, 7vw, 72px) 0 18px; font-size: 13px; font-weight: 800; letter-spacing: 0.2em; text-transform: uppercase; color: var(--ink-3); }
    h2.section:first-of-type { margin-top: 0; }
    .app { background: #fff; border: 1px solid var(--line); min-height: 0; }
    .app .art { height: 176px; padding-top: 26px; display: grid; place-items: center; background: #ebe8e1; }
    .app .art img { width: 96px; height: 96px; filter: drop-shadow(0 10px 14px rgba(20, 20, 25, 0.35)); }
    .app .copy p { color: var(--ink-2); }
    .app .copy p.meta { margin-top: 12px; font-size: 13px; font-weight: 700; color: var(--ink); }
    .app .go { color: var(--red); }
    .app .go.pending { color: var(--ink-3); }
    .pill { position: absolute; top: 14px; padding: 4px 11px; border-radius: 999px; background: rgba(255,255,255,0.85); border: 1px solid var(--line); color: var(--ink-2); font-size: 12px; font-weight: 700; letter-spacing: 0.01em; }
    .pill.left { left: 14px; }
    .pill.right { right: 14px; }
    .pill.beta { background: #e6efff; border-color: #c9dbff; color: #1d4fb3; }
    .pill.soon { color: var(--ink-3); }
    .app.soon { box-shadow: none; }
    .app.soon:hover { transform: none; }
    a.app .go, a.tool .go { }

    .foot { margin-top: 40px; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--ink-3); border-top: 1px solid var(--line); padding-top: 16px; }
    @media (prefers-reduced-motion: reduce) { .tool, .go i, .qr .code { transition: none; } .tool:hover { transform: none; } }
  
  </style>
</head>
<body>
  <div class="band" aria-hidden="true"></div>
  <header class="topbar">
    <img class="mw" src="/apps/motion-w.svg" alt="" width="36" height="36">
  </header>
  <main>
    <h1>Wisconsin Creative <em>Tools</em></h1>
    <p class="lede">Apps and tools for gear, footage, and game-day work.</p>
    <h2 class="section">Apps</h2>
    <ul class="grid apps">
      ${appEntries.map(appCard).join("\n      ")}
    </ul>
    <h2 class="section">Tools</h2>
    <ul class="grid">
      <li>
        <a class="tool gh" href="/golden-hour">
          <div class="art" aria-hidden="true">
            <svg viewBox="0 0 300 170" preserveAspectRatio="none">
              <rect x="0" y="104" width="300" height="16" fill="#ffc861" opacity=".28"/>
              <path d="M0 160 C 60 150, 90 20, 150 20 S 240 150, 300 160" fill="none" stroke="rgba(255,255,255,.6)" stroke-width="2"/>
              <path d="M58 120 L72 100" stroke="#ffc861" stroke-width="5" stroke-linecap="round"/>
              <path d="M228 100 L242 120" stroke="#ffc861" stroke-width="5" stroke-linecap="round"/>
              <line x1="0" x2="300" y1="112" y2="112" stroke="rgba(255,255,255,.55)" stroke-dasharray="2 5"/>
            </svg>
          </div>
          <div class="copy">
            <h2>Golden Hour</h2>
            <p>Golden hour times for Camp Randall and Big Ten road venues, in local time.</p>
            <span class="go">Open <i>→</i></span>
          </div>
        </a>
      </li>
      <li>
        <a class="tool tl" href="/timelapse">
          <div class="art" aria-hidden="true">
            <span class="corner c1"></span><span class="corner c2"></span><span class="corner c3"></span><span class="corner c4"></span>
            <span class="rec"><i></i>S&amp;Q · 1 fps</span>
            <div class="readout"><small>Clip length</small><b>20s</b></div>
          </div>
          <div class="copy">
            <h2>Timelapse</h2>
            <p>Interval, frame rate, roll time, and clip length for the FX3, A1, A1 II, A7 V, and A9 III.</p>
            <span class="go">Open <i>→</i></span>
          </div>
        </a>
      </li>
      <li>
        <a class="tool bs" href="/board-sizes">
          <div class="art" aria-hidden="true">
            <svg viewBox="0 0 240 120" fill="none">
              <rect x="10" y="22" width="220" height="55" stroke="#eef5ff" stroke-width="1.5"/>
              <rect x="10" y="22" width="118" height="55" stroke="#7fc3ff" stroke-dasharray="4 3" fill="rgba(127,195,255,.12)"/>
              <rect x="10" y="90" width="220" height="6" stroke="#eef5ff" stroke-width="1.2"/>
              <path d="M10 10h220M10 6v8M230 6v8" stroke="#ff7a6b"/>
              <text x="120" y="8" fill="#b7cdec" font-size="8" font-family="Gotham, system-ui, sans-serif" text-anchor="middle">5760 px</text>
            </svg>
          </div>
          <div class="copy">
            <h2>Board Sizes</h2>
            <p>Canvas sizes, zones, and delivery specs for every board at five venues, with guide PNGs.</p>
            <span class="go">Open <i>→</i></span>
          </div>
        </a>
      </li>
      <li>
        <a class="tool qr" href="/qrcode">
          <div class="art" aria-hidden="true">
            <div class="code"><svg viewBox="0 0 21 21" shape-rendering="crispEdges"><path fill="#15151a" d="M0 0h7v7H0zM1 1v5h5V1zM2 2h3v3H2zM14 0h7v7h-7zM15 1v5h5V1zM16 2h3v3h-3zM0 14h7v7H0zM1 15v5h5v-5zM2 16h3v3H2zM8 0h1v2H8zM10 1h2v1h-2zM9 3h3v1H9zM8 5h2v2H8zM11 6h2v2h-2zM8 8h3v1H8zM0 8h2v1H0zM3 9h3v1H3zM13 8h2v2h-2zM16 8h3v1h-3zM19 10h2v2h-2zM8 10h1v3H8zM10 11h3v1h-3zM14 11h3v2h-3zM1 11h2v2H1zM4 12h2v1H4zM9 14h2v2H9zM12 13h2v2h-2zM15 14h2v1h-2zM18 14h3v2h-3zM8 17h3v1H8zM12 16h1v3h-1zM14 17h3v2h-3zM18 17h1v1h-1zM9 19h2v2H9zM19 19h2v2h-2zM15 20h2v1h-2z"/></svg></div>
          </div>
          <div class="copy">
            <h2>QR Studio</h2>
            <p>Branded QR codes for links, Wi-Fi, and contacts, checked for scannability before export.</p>
            <span class="go">Open <i>→</i></span>
          </div>
        </a>
      </li>
    </ul>

    <p class="foot"><span></span><span><a href="/about" style="color:inherit">About</a> · <a href="/releases" style="color:inherit">Releases</a></span></p>
  </main>
</body>
</html>`;
}
