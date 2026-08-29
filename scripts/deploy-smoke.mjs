#!/usr/bin/env node

const baseUrl = normalizeBaseUrl(process.env.DEPLOY_SMOKE_BASE_URL ?? "http://localhost:3000");
const isLocalTarget = ["localhost", "127.0.0.1", "::1"].includes(baseUrl.hostname);
const defaultLocalEmail = "admin@creative.local";
const defaultLocalPassword = "ChangeMeNow123!";
const email = process.env.DEPLOY_SMOKE_EMAIL ?? (isLocalTarget ? defaultLocalEmail : "");
const password = process.env.DEPLOY_SMOKE_PASSWORD ?? (isLocalTarget ? defaultLocalPassword : "");

const publicChecks = [
  { path: "/about", terms: ["Built around physical handoffs", "Wisconsin Creative Wisconsin Creative"] },
  { path: "/about/features", terms: ["Features by workflow.", "What the public pages cover."] },
  { path: "/about/tech-stack", terms: ["Web app, Postgres data, native iOS.", "Major platform pieces."] },
  { path: "/about/security", terms: ["Public pages do not expose operations.", "Security controls at a high level."] },
  { path: "/about/field-work", terms: ["Native iOS and kiosk cover field work.", "Phone, counter, and web have different jobs."] },
  { path: "/privacy", terms: ["Wisconsin Creative Privacy Policy", "What We Collect"] },
  { path: "/login", terms: ["Wisconsin Creative", "Sign in to your account"] },
];

const protectedChecks = [
  { path: "/", terms: ["Dashboard"] },
];

const results = [];

main().catch((error) => {
  console.error(`deploy smoke failed: ${error.message}`);
  process.exit(1);
});

async function main() {
  console.log(`Deploy smoke target: ${baseUrl.origin}`);

  for (const check of publicChecks) {
    await smokePublicPage(check);
  }

  await smokeProtectedRedirect("/");

  if (email && password) {
    const cookie = await login();
    for (const check of protectedChecks) {
      await smokeAuthenticatedPage(check, cookie);
    }
  } else {
    results.push(["auth", "skipped", "set DEPLOY_SMOKE_EMAIL and DEPLOY_SMOKE_PASSWORD for authenticated checks"]);
  }

  printResults();
}

async function smokePublicPage(check) {
  const response = await request(check.path);
  assertOk(response, check.path);
  assertNonceCsp(response.headers, check.path);
  const html = await response.text();
  assertNonceInHtml(html, check.path);
  assertTerms(html, check.terms, check.path);
  results.push([check.path, "ok", "public page rendered with nonce CSP"]);
}

async function smokeProtectedRedirect(path) {
  const response = await request(path, { redirect: "manual" });
  const location = response.headers.get("location") ?? "";
  if (![307, 308].includes(response.status) || !location.includes("/login")) {
    throw new Error(`${path} should redirect unauthenticated users to /login, got ${response.status} ${location}`);
  }
  assertNonceCsp(response.headers, `${path} redirect`);
  results.push([path, "ok", "unauthenticated request redirects to /login"]);
}

async function login() {
  const response = await request("/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: baseUrl.origin,
    },
    body: JSON.stringify({ email, password, rememberMe: false }),
    redirect: "manual",
  });

  if (response.status !== 200) {
    const body = await response.text();
    throw new Error(`login failed with ${response.status}: ${body.slice(0, 240)}`);
  }

  const cookie = readSetCookie(response.headers);
  if (!cookie) {
    throw new Error("login did not return a session cookie");
  }

  results.push(["/api/auth/login", "ok", `authenticated as ${email}`]);
  return cookie;
}

async function smokeAuthenticatedPage(check, cookie) {
  const response = await request(check.path, {
    headers: { cookie },
  });
  assertOk(response, check.path);
  assertNonceCsp(response.headers, check.path);
  const html = await response.text();
  assertNonceInHtml(html, check.path);
  assertTerms(html, check.terms, check.path);
  results.push([check.path, "ok", "authenticated page rendered with nonce CSP"]);
}

async function request(path, options = {}) {
  const url = new URL(path, baseUrl);
  return fetch(url, options);
}

function assertOk(response, label) {
  if (!response.ok) {
    throw new Error(`${label} returned ${response.status}`);
  }
}

function assertNonceCsp(headers, label) {
  const csp = headers.get("content-security-policy") ?? "";
  const scriptSrc = readDirective(csp, "script-src");
  if (!scriptSrc) {
    throw new Error(`${label} is missing script-src in Content-Security-Policy`);
  }
  if (!/\'nonce-[^']+\'/.test(scriptSrc)) {
    throw new Error(`${label} script-src is missing a nonce: ${scriptSrc}`);
  }
  if (!scriptSrc.includes("'strict-dynamic'")) {
    throw new Error(`${label} script-src is missing strict-dynamic: ${scriptSrc}`);
  }
  if (scriptSrc.includes("'unsafe-inline'")) {
    throw new Error(`${label} script-src still allows unsafe-inline: ${scriptSrc}`);
  }
}

function assertNonceInHtml(html, label) {
  if (!/\snonce="[^"]+"/.test(html)) {
    throw new Error(`${label} HTML does not contain nonce-bearing scripts`);
  }
}

function assertTerms(html, terms, label) {
  for (const term of terms) {
    if (!html.includes(term)) {
      throw new Error(`${label} HTML is missing expected text: ${term}`);
    }
  }
}

function readDirective(csp, directive) {
  const part = csp
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${directive} `));
  return part ?? "";
}

function readSetCookie(headers) {
  const cookies = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : [headers.get("set-cookie")].filter(Boolean);
  return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

function normalizeBaseUrl(value) {
  try {
    const url = new URL(value);
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    throw new Error(`DEPLOY_SMOKE_BASE_URL is not a valid URL: ${value}`);
  }
}

function printResults() {
  for (const [target, status, detail] of results) {
    console.log(`${status.padEnd(7)} ${target} - ${detail}`);
  }
}
