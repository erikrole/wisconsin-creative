// The /apps page, rendered per request so it can sit behind sign-in. Edit the app
// data below (version, release date, links) when an app ships.
import { formatAppDate } from "@/lib/apps-page-format";

export type AppEntry = {
  name: string;
  icon: string;
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
    blurb: "Ingests camera cards, matches clips to the play-by-play, and names them for editing.",
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
    icon: "media-lab",
    platform: "",
    status: "Coming Late 2026",
    statusKind: "soon",
    blurb: "Media asset management on top of our existing media drive. Metadata, search, and quick viewing without moving files.",
  },
];

function esc(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function appCard(app: AppEntry) {
  const platformPill = app.platform ? `<span class="pill left">${esc(app.platform)}</span>` : "";
  const statusPill = app.status ? `<span class="pill right ${app.statusKind}">${esc(app.status)}</span>` : "";
  const meta = app.version
    ? `<p class="meta">Version ${esc(app.version)}${app.released ? ` · ${formatAppDate(app.released)}` : ""}</p>`
    : "";
  const body = `
          <div class="art">${platformPill}${statusPill}<img src="/apps/icons/${app.icon}.png" alt="" width="96" height="96"></div>
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

export function renderAppsPage(nonce?: string) {
  const n = nonce ? ` nonce="${esc(nonce)}"` : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="referrer" content="no-referrer">
  <meta name="robots" content="noindex">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#c5050c">
  <title>Wisconsin Creative Tools</title>
  <script${n}>try{var t=localStorage.getItem("apps-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}</script>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3.5' fill='%23c5050c'/%3E%3Cpath fill='%23fff' d='M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H3zM9 9h4v4H9z'/%3E%3C/svg%3E">
  <style>
@font-face { font-family: "Gotham"; src: url("/Gotham-Black.woff2") format("woff2"); font-weight: 800; font-display: swap; }
    @font-face { font-family: "Gotham"; src: url("/Gotham-Bold.woff2") format("woff2"); font-weight: 700; font-display: swap; }
    @font-face { font-family: "Gotham"; src: url("/Gotham-Book.woff2") format("woff2"); font-weight: 400; font-display: swap; }


    /* The hub is plain paper so each tool's own look can show on its card. */
    :root {
      --paper: #f3f1ec; --ink: #15151a; --ink-2: #4a4a52; --ink-3: #7a7973; --line: #dcd9d1;
      --card: #fff; --card-art: #ebe8e1; --pill: rgba(255,255,255,0.85);
      --beta-bg: #e6efff; --beta-line: #c9dbff; --beta-ink: #1d4fb3;
      --red: #c5050c; --red-text: #c5050c; --focus: #c5050c; --ease: cubic-bezier(0.2, 0, 0, 1);
      --font: "Gotham", system-ui, -apple-system, "Segoe UI", sans-serif;
      --mono: var(--font);
    }
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) { color-scheme: dark; --paper: #121214; --ink: #f2f1ee; --ink-2: #b9b8b2; --ink-3: #8a8984; --line: #2c2c30;
      --card: #1c1c1f; --card-art: #26262a; --pill: rgba(28,28,31,0.88);
      --beta-bg: #1b2a4d; --beta-line: #2b4278; --beta-ink: #8fb1ff;
      --red-text: #ff5a60; --focus: #ff5a60; }
    }
    :root[data-theme="dark"] { color-scheme: dark; --paper: #121214; --ink: #f2f1ee; --ink-2: #b9b8b2; --ink-3: #8a8984; --line: #2c2c30;
      --card: #1c1c1f; --card-art: #26262a; --pill: rgba(28,28,31,0.88);
      --beta-bg: #1b2a4d; --beta-line: #2b4278; --beta-ink: #8fb1ff;
      --red-text: #ff5a60; --focus: #ff5a60; }
    * { box-sizing: border-box; }
    body { margin: 0; min-width: 300px; background: var(--paper); color: var(--ink); font-family: var(--font); font-size: 15px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
    :focus-visible { outline: 3px solid var(--focus); outline-offset: 4px; border-radius: 18px; }

    .topbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: max(18px, env(safe-area-inset-top)) clamp(16px, 4vw, 40px) 0; }
    .mw { width: 36px; height: 36px; display: block; }
    .mark { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 8px; background: var(--red); }
    .mark svg { width: 15px; height: 15px; }
    .topbar span { font-size: 12px; font-weight: 800; letter-spacing: 0.2em; text-transform: uppercase; }

    main { width: min(1200px, calc(100% - 32px)); margin: 0 auto; padding: clamp(36px, 8vw, 88px) 0 64px; }
    .band { height: 6px; background: var(--red); }
    .picker { display: inline-flex; padding: 3px; border-radius: 999px; background: var(--card); border: 1px solid var(--line); }
    .picker button { appearance: none; border: 0; background: none; padding: 5px 12px; border-radius: 999px; color: var(--ink-2); font: 700 12px var(--font); cursor: pointer; }
    .picker button[aria-pressed="true"] { background: var(--ink); color: var(--paper); }
    .kicker { margin: 0 0 14px; font-size: 12px; font-weight: 800; letter-spacing: 0.2em; text-transform: uppercase; color: var(--red); }
    h1 { margin: 0; font-size: clamp(36px, 7vw, 72px); font-weight: 800; letter-spacing: -0.03em; line-height: 0.95; text-transform: uppercase; }
    h1 em { font-style: normal; color: var(--red-text); }
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

    /* Posters: each tool draws its own world; the art fills the top of the card. */
    .art svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; overflow: visible; }
    .art text { font-family: var(--font); font-weight: 700; }

    .gh { background: linear-gradient(180deg, #1d2050 0%, #46407a 34%, #a2547a 62%, #e8795a 84%, #f7a64a 100%); color: #fff7ee; }
    .gh .art svg { inset: 16px 16px 0; width: calc(100% - 32px); height: calc(100% - 16px); overflow: hidden; }
    .gh .copy p { color: rgba(255, 247, 238, 0.84); }

    .tl { background: #0b0c0e; color: #f2f2ef; }
    .tl .copy p { color: #b9b9b3; }

    .bs { background: #0b2a52; color: #eef5ff;
      background-image: linear-gradient(rgba(150,195,255,.11) 1px, transparent 1px), linear-gradient(90deg, rgba(150,195,255,.11) 1px, transparent 1px);
      background-size: 22px 22px; }
    .bs .copy p { color: #b7cdec; }

    .qr { background: #a00000; color: #fff; }
    .qr .copy p { color: rgba(255, 255, 255, 0.86); }
    .qr .code { position: absolute; left: 50%; top: 50%; width: 128px; height: 128px; margin: -64px 0 0 -64px; padding: 12px; border-radius: 18px; background: #fff; box-shadow: 0 18px 34px -14px rgba(0,0,0,.65); transform: rotate(-4deg); transition: transform 260ms var(--ease); }
    .tool.qr:hover .code { transform: rotate(0); }
    .qr .code svg { position: static; width: 100%; height: 100%; }
    .qr .ok { position: absolute; right: -14px; bottom: -14px; width: 40px; height: 40px; border-radius: 50%; background: #1f9d55; border: 3px solid #a00000; display: grid; place-items: center; }
    .qr .ok svg { width: 20px; height: 20px; }

    h2.section { margin: clamp(40px, 7vw, 72px) 0 18px; font-size: 13px; font-weight: 800; letter-spacing: 0.2em; text-transform: uppercase; color: var(--ink-3); }
    h2.section:first-of-type { margin-top: 0; }
    .app { background: var(--card); border: 1px solid var(--line); min-height: 0; }
    .app .art { height: 176px; padding-top: 26px; display: grid; place-items: center; background: var(--card-art); }
    .app .art img { width: 96px; height: 96px; filter: drop-shadow(0 10px 14px rgba(20, 20, 25, 0.35)); }
    .app .copy p { color: var(--ink-2); }
    .app .copy p.meta { margin-top: 12px; font-size: 13px; font-weight: 700; color: var(--ink); }
    .app .go { color: var(--red-text); }
    .app .go.pending { color: var(--ink-3); }
    .pill { position: absolute; top: 14px; padding: 4px 11px; border-radius: 999px; background: var(--pill); border: 1px solid var(--line); color: var(--ink-2); font-size: 12px; font-weight: 700; letter-spacing: 0.01em; }
    .pill.left { left: 14px; }
    .pill.right { right: 14px; }
    .pill.beta { background: var(--beta-bg); border-color: var(--beta-line); color: var(--beta-ink); }
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
    <div class="picker" role="group" aria-label="Appearance">
      <button type="button" data-mode="auto" aria-pressed="true">Auto</button>
      <button type="button" data-mode="light" aria-pressed="false">Light</button>
      <button type="button" data-mode="dark" aria-pressed="false">Dark</button>
    </div>
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
            <svg viewBox="0 0 200 188" preserveAspectRatio="xMidYMid meet">
              <g fill="none" stroke="#f2f2ef" stroke-opacity=".8" stroke-width="2"><path d="M14 42V22h20M186 42V22h-20M14 150v20h20M186 150v20h-20"/></g>
              <circle cx="28" cy="36" r="3.5" fill="#ff3b3b"/>
              <text x="38" y="39.5" fill="#b9b9b3" font-size="9" letter-spacing="1.2">REC · 1 FPS</text>
              <text x="100" y="76" fill="#ffb224" font-size="9" letter-spacing="2.4" text-anchor="middle">CLIP LENGTH</text>
              <text x="100" y="122" fill="#f2f2ef" font-size="52" font-weight="800" letter-spacing="-2" text-anchor="middle">20s</text>
              <g fill="#f2f2ef"><rect x="28" y="146" width="9" height="12" rx="1.5" opacity="0.2"/><rect x="45" y="146" width="9" height="12" rx="1.5" opacity="0.31"/><rect x="62" y="146" width="9" height="12" rx="1.5" opacity="0.43"/><rect x="79" y="146" width="9" height="12" rx="1.5" opacity="0.54"/><rect x="96" y="146" width="9" height="12" rx="1.5" opacity="0.66"/><rect x="113" y="146" width="9" height="12" rx="1.5" opacity="0.77"/><rect x="130" y="146" width="9" height="12" rx="1.5" opacity="0.89"/><rect x="147" y="146" width="9" height="12" rx="1.5" opacity="1.0"/></g>
              <rect x="166" y="142" width="3" height="20" rx="1.5" fill="#ffb224"/>
            </svg>
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
            <svg viewBox="0 0 200 188" preserveAspectRatio="xMidYMid meet" fill="none">
              <defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V6" stroke="#7fc3ff" stroke-opacity=".35"/></pattern></defs>
              <rect x="28" y="46" width="152" height="84" stroke="#eef5ff" stroke-width="1.6"/>
              <rect x="28" y="46" width="96" height="84" fill="url(#hatch)" stroke="#7fc3ff" stroke-dasharray="4 3"/>
              <rect x="28" y="142" width="152" height="12" stroke="#eef5ff" stroke-width="1.2"/>
              <path d="M28 30H180M28 25V35M180 25V35" stroke="#ff7a6b"/>
              <path d="M14 46V130M9 46H19M9 130H19" stroke="#ff7a6b"/>
              <text x="104" y="23" fill="#ffb1a8" font-size="9" letter-spacing="1.6" text-anchor="middle">W</text>
              <text x="4" y="88" fill="#ffb1a8" font-size="9" letter-spacing="1.6" text-anchor="middle" transform="rotate(-90 4 88)">H</text>
              <text x="76" y="91" fill="#bfe0ff" font-size="8" letter-spacing="1.4" text-anchor="middle">VIDEO ZONE</text>
              <text x="152" y="91" fill="#b7cdec" font-size="8" letter-spacing="1.4" text-anchor="middle" opacity=".8">SCORE</text>
              <text x="104" y="172" fill="#b7cdec" font-size="8" letter-spacing="1.4" text-anchor="middle">RIBBON</text>
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
            <div class="code"><svg viewBox="0 0 21 21" shape-rendering="crispEdges"><path fill="#15151a" d="M0 0h7v7H0zM1 1v5h5V1zM2 2h3v3H2zM14 0h7v7h-7zM15 1v5h5V1zM16 2h3v3h-3zM0 14h7v7H0zM1 15v5h5v-5zM2 16h3v3H2zM8 0h1v2H8zM10 1h2v1h-2zM9 3h3v1H9zM8 5h2v2H8zM11 6h2v2h-2zM8 8h3v1H8zM0 8h2v1H0zM3 9h3v1H3zM13 8h2v2h-2zM16 8h3v1h-3zM19 10h2v2h-2zM8 10h1v3H8zM10 11h3v1h-3zM14 11h3v2h-3zM1 11h2v2H1zM4 12h2v1H4zM9 14h2v2H9zM12 13h2v2h-2zM15 14h2v1h-2zM18 14h3v2h-3zM8 17h3v1H8zM12 16h1v3h-1zM14 17h3v2h-3zM18 17h1v1h-1zM9 19h2v2H9zM19 19h2v2h-2zM15 20h2v1h-2z"/></svg><span class="ok"><svg viewBox="0 0 20 20" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10.5l4 4 8-9"/></svg></span></div>
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
  <script${n}>(function(){var r=document.documentElement,b=document.querySelectorAll(".picker button");function show(m){b.forEach(function(x){x.setAttribute("aria-pressed",String(x.dataset.mode===m))})}var saved="auto";try{var t=localStorage.getItem("apps-theme");if(t==="light"||t==="dark")saved=t}catch(e){}show(saved);b.forEach(function(x){x.addEventListener("click",function(){var m=x.dataset.mode;if(m==="auto")delete r.dataset.theme;else r.dataset.theme=m;try{if(m==="auto")localStorage.removeItem("apps-theme");else localStorage.setItem("apps-theme",m)}catch(e){}show(m)})})})();</script>
</body>
</html>`;
}
