// Product pages for the Mac apps, served at /apps/<slug>. Public and noindex,
// like /apps. Every claim comes from the app's own README or release notes.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { LiveVersion } from "@/lib/apps-live-versions";

export type ProductShot = { file: string; alt: string; caption: string; width: number; height: number };

export type ProductPage = {
  slug: "fetch" | "offload";
  name: string;
  icon: string;
  tagline: string;
  intro: string;
  version: string;
  requires: string;
  download: string;
  releases: string;
  features: Array<{ title: string; body: string }>;
  steps: Array<{ title: string; body: string }>;
  shots: ProductShot[];
  notes: string[];
};

function esc(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function shotFigure(shot: ProductShot) {
  if (!existsSync(join(process.cwd(), "public/apps/shots", shot.file))) return "";
  return `<figure><img src="/apps/shots/${esc(shot.file)}" alt="${esc(shot.alt)}" width="${shot.width}" height="${shot.height}" loading="lazy" decoding="async"><figcaption>${esc(shot.caption)}</figcaption></figure>`;
}

export function renderProductPage(page: ProductPage, nonce?: string, live?: LiveVersion) {
  const n = nonce ? ` nonce="${esc(nonce)}"` : "";
  const version = live?.version ?? page.version;
  const requires = live && live.version !== page.version ? (live.requires ?? page.requires) : page.requires;
  const url = `https://wisconsincreative.com/apps/${page.slug}`;
  const shots = page.shots.map(shotFigure).filter(Boolean);
  const description = `${page.name}: ${page.tagline}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="referrer" content="no-referrer">
  <meta name="robots" content="noindex">
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${url}">
  <meta property="og:title" content="${esc(page.name)} for macOS">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="https://wisconsincreative.com/apps/icons/${esc(page.icon)}.png">
  <meta name="twitter:card" content="summary">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#c5050c">
  <title>${esc(page.name)} for macOS</title>
  <script${n}>try{var t=localStorage.getItem("apps-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}</script>
  <link rel="icon" href="/apps/icons/${esc(page.icon)}.png">
  <style>
    @font-face { font-family: "Gotham"; src: url("/Gotham-Black.woff2") format("woff2"); font-weight: 800; font-display: swap; }
    @font-face { font-family: "Gotham"; src: url("/Gotham-Bold.woff2") format("woff2"); font-weight: 700; font-display: swap; }
    @font-face { font-family: "Gotham"; src: url("/Gotham-Book.woff2") format("woff2"); font-weight: 400; font-display: swap; }
    :root { --paper: #f3f1ec; --ink: #15151a; --ink-2: #4a4a52; --ink-3: #5c5b55; --line: #dcd9d1; --card: #fff; --red: #c5050c; --red-text: #c5050c; --ease: cubic-bezier(0.2, 0, 0, 1); --font: "Gotham", system-ui, -apple-system, "Segoe UI", sans-serif; }
    @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { color-scheme: dark; --paper: #121214; --ink: #f2f1ee; --ink-2: #b9b8b2; --ink-3: #8a8984; --line: #2c2c30; --card: #1c1c1f; --red-text: #ff5a60; } }
    :root[data-theme="dark"] { color-scheme: dark; --paper: #121214; --ink: #f2f1ee; --ink-2: #b9b8b2; --ink-3: #8a8984; --line: #2c2c30; --card: #1c1c1f; --red-text: #ff5a60; }
    * { box-sizing: border-box; }
    body { margin: 0; min-width: 300px; background: var(--paper); color: var(--ink); font-family: var(--font); font-size: 15px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
    :focus-visible { outline: 3px solid var(--red-text); outline-offset: 4px; border-radius: 12px; }
    .band { height: 6px; background: var(--red); }
    .topbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: max(18px, env(safe-area-inset-top)) clamp(16px, 4vw, 40px) 0; }
    .topbar a { color: var(--ink-2); font-size: 13px; font-weight: 700; text-decoration: none; }
    .topbar a:hover { color: var(--red-text); }
    .picker { display: inline-flex; padding: 3px; border-radius: 999px; background: var(--card); border: 1px solid var(--line); }
    .picker button { appearance: none; border: 0; background: none; padding: 5px 12px; border-radius: 999px; color: var(--ink-2); font: 700 12px var(--font); cursor: pointer; }
    .picker button[aria-pressed="true"] { background: var(--ink); color: var(--paper); }
    main { width: min(1040px, calc(100% - 32px)); margin: 0 auto; padding: clamp(32px, 7vw, 72px) 0 64px; }
    .hero { display: grid; grid-template-columns: auto 1fr; gap: 24px; align-items: center; }
    @media (max-width: 560px) { .hero { grid-template-columns: 1fr; } }
    .hero img { width: 112px; height: 112px; filter: drop-shadow(0 12px 18px rgba(20,20,25,.3)); }
    .kicker { margin: 0 0 10px; font-size: 12px; font-weight: 800; letter-spacing: .2em; text-transform: uppercase; color: var(--red-text); }
    h1 { margin: 0; font-size: clamp(36px, 7vw, 64px); font-weight: 800; letter-spacing: -.03em; line-height: .95; text-transform: uppercase; }
    .lede { margin: 18px 0 0; max-width: 620px; font-size: 17px; color: var(--ink-2); }
    .cta { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px; margin: 28px 0 8px; }
    .btn { display: inline-flex; align-items: center; gap: 8px; padding: 12px 22px; border-radius: 999px; background: var(--red); color: #fff; font-weight: 800; font-size: 15px; text-decoration: none; transition: transform 260ms var(--ease); }
    .btn:hover { transform: translateY(-2px); }
    .meta { font-size: 13px; font-weight: 700; color: var(--ink-2); }
    .meta span + span::before { content: "·"; margin: 0 8px; color: var(--ink-3); }
    h2 { margin: clamp(44px, 7vw, 72px) 0 18px; font-size: 13px; font-weight: 800; letter-spacing: .2em; text-transform: uppercase; color: var(--ink-3); }
    .shots { display: grid; gap: 20px; margin-top: clamp(32px, 6vw, 56px); }
    figure { margin: 0; }
    figure img { display: block; width: 100%; height: auto; border-radius: 14px; border: 1px solid var(--line); box-shadow: 0 1px 2px rgba(20,20,25,.08), 0 24px 48px -28px rgba(20,20,25,.5); }
    figcaption { margin-top: 10px; font-size: 13px; color: var(--ink-3); }
    .features { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; list-style: none; margin: 0; padding: 0; }
    @media (max-width: 700px) { .features { grid-template-columns: 1fr; } }
    .features li, .steps li { padding: 20px 22px; background: var(--card); border: 1px solid var(--line); border-radius: 18px; }
    h3 { margin: 0 0 6px; font-size: 17px; font-weight: 800; letter-spacing: -.01em; }
    .features p, .steps p { margin: 0; color: var(--ink-2); }
    .steps { counter-reset: s; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; list-style: none; margin: 0; padding: 0; }
    .steps li { counter-increment: s; }
    .steps li::before { content: counter(s); display: grid; place-items: center; width: 28px; height: 28px; margin-bottom: 12px; border-radius: 50%; background: var(--red); color: #fff; font-size: 13px; font-weight: 800; }
    .notes { margin: 0; padding-left: 20px; color: var(--ink-2); }
    .foot { margin-top: 56px; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--ink-3); border-top: 1px solid var(--line); padding-top: 16px; }
    .foot a { color: inherit; }
    @media (prefers-reduced-motion: reduce) { .btn { transition: none; } .btn:hover { transform: none; } }
  </style>
</head>
<body>
  <div class="band" aria-hidden="true"></div>
  <header class="topbar">
    <a href="/apps">← All apps</a>
    <div class="picker" role="group" aria-label="Appearance">
      <button type="button" data-mode="auto" aria-pressed="true">Auto</button>
      <button type="button" data-mode="light" aria-pressed="false">Light</button>
      <button type="button" data-mode="dark" aria-pressed="false">Dark</button>
    </div>
  </header>
  <main>
    <section class="hero">
      <img src="/apps/icons/${esc(page.icon)}.png" alt="" width="112" height="112">
      <div>
        <p class="kicker">Mac app</p>
        <h1>${esc(page.name)}</h1>
      </div>
    </section>
    <p class="lede">${esc(page.tagline)} ${esc(page.intro)}</p>
    <div class="cta">
      <a class="btn" href="${esc(page.download)}">Download for macOS <span aria-hidden="true">↓</span></a>
      <p class="meta"><span>Version ${esc(version)}</span><span>Requires ${esc(requires)}</span></p>
    </div>
    ${shots.length ? `<div class="shots">${shots.join("")}</div>` : ""}
    <h2>What it does</h2>
    <ul class="features">
      ${page.features.map((f) => `<li><h3>${esc(f.title)}</h3><p>${esc(f.body)}</p></li>`).join("\n      ")}
    </ul>
    <h2>How it works</h2>
    <ol class="steps">
      ${page.steps.map((s) => `<li><h3>${esc(s.title)}</h3><p>${esc(s.body)}</p></li>`).join("\n      ")}
    </ol>
    <h2>Good to know</h2>
    <ul class="notes">
      ${page.notes.map((line) => `<li>${esc(line)}</li>`).join("\n      ")}
    </ul>
    <p class="foot"><span><a href="${esc(page.releases)}">Release notes on GitHub</a></span><span><a href="/apps">All apps</a> · <a href="/about">About</a></span></p>
  </main>
  <script${n}>(function(){var r=document.documentElement,b=document.querySelectorAll(".picker button");function show(m){b.forEach(function(x){x.setAttribute("aria-pressed",String(x.dataset.mode===m))})}var saved="auto";try{var t=localStorage.getItem("apps-theme");if(t==="light"||t==="dark")saved=t}catch(e){}show(saved);b.forEach(function(x){x.addEventListener("click",function(){var m=x.dataset.mode;if(m==="auto")delete r.dataset.theme;else r.dataset.theme=m;try{if(m==="auto")localStorage.removeItem("apps-theme");else localStorage.setItem("apps-theme",m)}catch(e){}show(m)})})})();</script>
</body>
</html>`;
}
