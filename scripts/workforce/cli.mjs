#!/usr/bin/env node
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const PAGEUP = "https://uwstudents.dc4.pageuppeople.com";
const DEFAULT_SITE = "https://wisconsincreative.com";
export function parseOptions(argv) {
  return parseArgs({ args: argv, allowPositionals: true, options: {
    site: { type: "string", default: DEFAULT_SITE }, profile: { type: "string" },
    id: { type: "string" }, cycle: { type: "string" }, file: { type: "string" }, output: { type: "string" },
    requisition: { type: "string", default: "512089" }, apply: { type: "boolean", default: false },
    headed: { type: "boolean", default: false }, json: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
    term: { type: "string" }, year: { type: "string" }, "legacy-csv": { type: "boolean", default: false },
  } });
}
export function siteOrigin(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Use a site origin without credentials, path, or query.");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) throw new Error("HTTPS is required outside localhost.");
  return url.origin;
}
export function materialUrl(value, applicationId) {
  const url = new URL(value);
  if (url.origin !== PAGEUP || !["/ApplicantProgressBoard/OpenResume", "/ApplicantProgressBoard/OpenApplicationAnswers", "/ApplicantProgressBoard/OpenCoverLetter"].includes(url.pathname) || url.searchParams.get("applicationId") !== applicationId) throw new Error("Material link does not match its PageUp application.");
  return url.href;
}
export function validateIntake(value) {
  if (value?.version !== 1 || value?.source !== "pageup" || !/^\d{1,60}$/.test(value?.requisitionId ?? "") || !Array.isArray(value?.applicants) || !value.applicants.length || value.applicants.length > 500) throw new Error("Expected a version 1 PageUp intake batch with 1–500 applicants.");
  const ids = new Set();
  for (const a of value.applicants) {
    if (!/^\d{1,60}$/.test(a?.applicationId ?? "") || ids.has(a.applicationId)) throw new Error("Every applicant needs a distinct numeric Application ID.");
    ids.add(a.applicationId);
    const allowed = new Set(["applicationId", "name", "email", "phone", "standing", "graduation", "primaryArea", "verifiedAreas", "interests", "softwareExperience", "relevantExperience", "location", "summerAvailable", "resumeUrl", "applicationFormUrl", "otherMaterialsUrl", "portfolioUrl", "missingMaterials"]);
    if (["stage", "decision", "reviewed", "interviewed", "rating"].some(key => key in a)) throw new Error("Intake cannot set decisions, review state, interviews, or ratings.");
    if (Object.keys(a).some(key => !allowed.has(key))) throw new Error(`Application ${a.applicationId} contains unsupported fields.`);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email ?? "")) throw new Error(`Application ${a.applicationId} needs name and email in valid form.`);
    for (const key of ["resumeUrl", "applicationFormUrl", "otherMaterialsUrl", "portfolioUrl"]) {
      if (a[key] === undefined || a[key] === null || a[key] === "") continue;
      const url = new URL(a[key]);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("Material and portfolio links must use HTTPS without credentials.");
    }
    for (const key of ["verifiedAreas", "interests", "softwareExperience", "missingMaterials"]) {
      if (a[key] !== undefined && (!Array.isArray(a[key]) || a[key].some(value => typeof value !== "string"))) throw new Error(`Application ${a.applicationId} has an invalid ${key} list.`);
    }

    if (!a.name?.trim() || !a.email?.trim()) throw new Error(`Application ${a.applicationId} needs name and email.`);
    if (["stage", "decision", "reviewed", "interviewed", "rating"].some((key) => key in a)) throw new Error("Intake cannot set decisions, review state, interviews, or ratings.");
  }
  return value;
}
export async function requestJson(request, origin, path, { method = "GET", data, retries = 3 } = {}) {
  for (let attempt = 0; ; attempt++) {
    let response;
    try { response = await request.fetch(origin + path, { method, data, headers: { Origin: origin, "Content-Type": "application/json" }, timeout: 30000, maxRedirects: 0 }); }
    catch { throw new Error("Request interrupted. For an import, rerun its preview to reconcile Application IDs before retrying Apply."); }
    const status = response.status();
    if (status === 429 && attempt < retries) {
      const raw = response.headers()["retry-after"];
      const delay = Math.min(60000, Math.max(1000, Number(raw) * 1000 || 5000));
      await new Promise((resolveWait) => setTimeout(resolveWait, delay));
      continue;
    }
    if (status === 401 || status === 403 || (status >= 300 && status < 400)) throw new Error("Sign-in is required, or this account lacks admin access. Run workforce auth.");
    const type = response.headers()["content-type"] ?? "";
    if (!type.includes("json")) throw new Error(`Server returned a non-JSON response (${status}). Nothing should be assumed saved.`);
    const body = await response.json();
    if (!response.ok()) throw new Error(typeof body.error === "string" ? body.error : `Request failed (${status}).`);
    return body;
  }
}
export function intakeCsv(batch) {
  const headers = ["Application ID", "Applicant", "Email", "Decision / Stage", "Reviewed", "Interview", "Year", "Graduation", "Primary Area", "Relevant Experience", "Verified Areas", "Fields you have experience in", "Fields you are interested in", "Resume File", "Application Form", "Other Materials", "Portfolio Link", "Notes", "Phone", "Location", "Summer", "Do you have experience with the Adobe Creative Cloud Suite", "Missing Materials", "Source", "Requisition ID"];
  const rows = batch.applicants.map(a => [a.applicationId, a.name, a.email, "Applied", "FALSE", "FALSE", a.standing, a.graduation, a.primaryArea, a.relevantExperience, (a.verifiedAreas ?? []).join("; "), (a.verifiedAreas ?? []).join("; "), (a.interests ?? []).join("; "), a.resumeUrl, a.applicationFormUrl, a.otherMaterialsUrl, a.portfolioUrl, a.relevantExperience ? `Submitted materials: ${a.relevantExperience}` : "", a.phone, a.location, a.summerAvailable === undefined || a.summerAvailable === null ? "" : String(a.summerAvailable), (a.softwareExperience ?? []).join("; "), (a.missingMaterials ?? []).join("; "), "PageUp", batch.requisitionId]);
  return [headers, ...rows].map(row => row.map(cell => '"' + String(cell ?? "").replaceAll('"', '""') + '"').join(",")).join("\n");
}
async function privateJson(path, data) {
  await mkdir(resolve(path, ".."), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(data, null, 2) + "\n", { mode: 0o600, flag: "wx" });
}
function help() {
  return { version: 1, commands: {
    auth: "Open PageUp and Wisconsin Creative for manual sign-in; credentials stay in the local browser profile.",
    status: "Check Wisconsin Creative admin authentication.", cycles: "Read hiring cycles. Use cycles create --term FALL --year 2026 to create an open cycle.",
    applicants: "Read applicants: --cycle ID.", application: "Read one application and notes: --id ID.", verify: "Capture the current Hiring page privately: --cycle ID --output NEW_FILE.png.",
    "pageup scan": "Hard-refresh Application Complete board: --requisition 512089 --output NEW_FILE.json.",
    "pageup materials": "Capture form/resume/cover letter: --file SCAN.json --output NEW_DIRECTORY.",
    decisions: "Copy explicitly authorized spreadsheet decisions: --cycle ID --file BATCH.json; preview by default, --apply writes. Never run as autonomous applicant intake.",
    intake: "Preview extracted applicant JSON: --cycle ID --file INTAKE.json. Add --apply to write; validates all rows first.",
  }, authentication: "Isolated persistent browser profile; use --profile PATH or WORKFORCE_CLI_PROFILE. No passwords or cookies in command arguments/output.", decisions: "Intake is factual only and skips existing IDs. The decisions command requires explicit authorization to copy human decisions; review, interview, hire, and pass remain human-owned.", contract: "docs/WORKFORCE_CLI.md" };
}
export async function main(argv = process.argv.slice(2)) {
  const { positionals, values: options } = parseOptions(argv);
  const [command, subcommand] = positionals;
  if (!command || command === "help" || options.help) { process.stdout.write(JSON.stringify(help(), null, 2) + "\n"); return; }
  if (!['auth', 'status', 'cycles', 'applicants', 'pageup', 'intake', 'application', 'verify', 'decisions'].includes(command)) throw new Error("Unknown command. Run workforce help.");
  const origin = siteOrigin(options.site);
  const profile = resolve(options.profile ?? process.env.WORKFORCE_CLI_PROFILE ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".tmp", "workforce-cli", "browser"));
  await mkdir(profile, { recursive: true, mode: 0o700 });
  if ((await stat(profile)).mode & 0o077) throw new Error("Browser profile permissions must be private (0700).");
  const { chromium } = await import("@playwright/test");
  let browser;
  let connection;
  let backgroundEngine;
  let ownsBrowser = true;
  try {
    const portFile = await readFile(join(profile, "DevToolsActivePort"), "utf8").catch(() => "");
    const port = portFile.split("\n")[0];
    if (/^\d+$/.test(port)) {
      try {
        connection = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 3000 });
        browser = connection.contexts()[0];
        ownsBrowser = false;
      } catch { /* A previous browser may have stopped; launch this profile normally. */ }
    }
    if (!browser) browser = await chromium.launchPersistentContext(profile, { headless: command === "auth" || options.headed ? false : true, args: command === "auth" ? ["--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1"] : [] });
  } catch { throw new Error("The local browser could not start or connect. Verify Playwright Chromium is installed and the Workforce browser is reachable."); }
  if (connection && command !== "auth") {
    // Reuse this CLI's signed-in session without opening foreground tabs.
    const cookies = await browser.cookies([origin, PAGEUP]);
    backgroundEngine = await chromium.launch({ headless: true });
    browser = await backgroundEngine.newContext();
    await browser.addCookies(cookies);
    ownsBrowser = true;
  }
  const sessionPath = join(profile, "workforce-session.json");
  try {
    const info = await stat(sessionPath).catch(() => null);
    if (info && ownsBrowser && !backgroundEngine) {
      if (info.mode & 0o077) throw new Error("Saved session permissions must be private (0600).");
      const cookies = JSON.parse(await readFile(sessionPath, "utf8"));
      await browser.addCookies(cookies);
    }
    let result;
    if (command === "auth") {
      const page = await browser.newPage();
      await page.goto(origin + "/workforce/hiring");
      const pageup = await browser.newPage();
      await pageup.goto(`${PAGEUP}/ManageApplications/ApplicantProgressBoard?lJobId=${encodeURIComponent(options.requisition)}`);
      process.stderr.write("Complete sign-in in both browser tabs. The CLI will confirm readiness and keep this browser open for reuse. No credentials are printed.\n");
      let closed = false;
      let confirmed = false;
      browser.once("close", () => { closed = true; });
      const closeOnSignal = () => { void browser.close(); };
      process.once("SIGINT", closeOnSignal);
      try {
        while (!closed) {
          try {
            // Preserve session-only cookies locally before the browser closes.
            const cookies = await browser.cookies([origin, PAGEUP]);
            await writeFile(sessionPath, JSON.stringify(cookies), { mode: 0o600 });
            const pageupReady = browser.pages().some(p => new URL(p.url()).origin === PAGEUP && /ApplicantProgressBoard/.test(p.url()));
            if (pageupReady && !confirmed) {
              const board = browser.pages().find(p => new URL(p.url()).origin === PAGEUP && /ApplicantProgressBoard/.test(p.url()));
              if (await board.getByRole("heading", { name: "Application Complete", exact: true }).isVisible()) {
                const response = await browser.request.get(origin + "/api/me", { maxRedirects: 0 });
                if (response.ok() && (await response.json()).user?.role === "ADMIN") {
                  process.stdout.write(JSON.stringify({ authenticated: true, site: origin, pageup: true }) + "\n");
                  confirmed = true;
                }
              }
            }
          } catch (error) {
            if (closed) break;
            if (error.code) throw new Error("Could not save the private browser session.");
          }
          await new Promise(done => setTimeout(done, 1000));
        }
      } finally { process.removeListener("SIGINT", closeOnSignal); }
      return;
    }
    if (command === "pageup") {
      const { scanPageUp, captureMaterials } = await import("./pageup.mjs");
      if (subcommand === "scan") {
        if (!options.output || !/^\d{1,60}$/.test(options.requisition)) throw new Error("Use --requisition NUMBER and --output NEW_FILE.json.");
        result = await scanPageUp(browser, options.requisition);
        await privateJson(resolve(options.output), result);
        result = { count: result.applicants.length, output: resolve(options.output), refreshedAt: result.refreshedAt };
      } else if (subcommand === "materials") {
        if (!options.file || !options.output) throw new Error("Use --file SCAN.json and --output NEW_DIRECTORY.");
        result = await captureMaterials(browser, JSON.parse(await readFile(options.file, "utf8")), resolve(options.output));
      } else throw new Error("Use pageup scan or pageup materials.");
    } else {
      const me = await requestJson(browser.request, origin, "/api/me");
      if (me.user?.role !== "ADMIN" || me.user?.preview?.active) throw new Error("An admin session outside role preview is required.");
      if (command === "decisions") {
        if (!options.cycle || !options.file) throw new Error("Use --cycle ID and --file BATCH.json.");
        const { syncDecisions } = await import("./decisions.mjs");
        result = await syncDecisions(browser.request, origin, options.cycle, JSON.parse(await readFile(options.file, "utf8")), options.apply);
      }
      if (command === "application") {
        if (!options.id) throw new Error("--id ID is required.");
        result = await requestJson(browser.request, origin, `/api/hiring/applications/${encodeURIComponent(options.id)}`);
      }
      if (command === "verify") {
        if (!options.output) throw new Error("--output NEW_FILE.png is required.");
        const page = await browser.newPage();
        await page.setViewportSize({ width: 1440, height: 1100 });
        await page.goto(origin + "/workforce/hiring", { waitUntil: "domcontentloaded" });
        if (!options.cycle) throw new Error("--cycle ID is required.");
        const applications = await requestJson(browser.request, origin, `/api/hiring/applications?cycleId=${encodeURIComponent(options.cycle)}`);
        if (!applications.data?.length) throw new Error("This verification requires a cycle with saved applicants.");
        await page.locator("select").first().selectOption(options.cycle);
        await page.getByText(applications.data[0].name, { exact: true }).waitFor({ timeout: 30000 });
        await writeFile(resolve(options.output), await page.screenshot(), { mode: 0o600, flag: "wx" });
        result = { output: resolve(options.output), rendered: true };
      }
      if (command === "status") result = { authenticated: true, role: "ADMIN", site: origin };
      if (command === "cycles") {
        if (subcommand === "create") {
          if (!["FALL", "WINTER", "SPRING", "SUMMER"].includes(options.term) || !/^20\d{2}$/.test(options.year ?? "")) throw new Error("Use cycles create --term FALL|WINTER|SPRING|SUMMER --year YYYY.");
          const existing = await requestJson(browser.request, origin, "/api/hiring/cycles");
          const match = existing.data?.find(c => c.term === options.term && c.year === Number(options.year));
          result = match ? { data: match, existing: true } : await requestJson(browser.request, origin, "/api/hiring/cycles", { method: "POST", data: { term: options.term, year: Number(options.year), status: "OPEN" }, retries: 0 });
          const confirmed = await requestJson(browser.request, origin, "/api/hiring/cycles");
          if (!confirmed.data?.some(c => c.id === result.data?.id)) throw new Error("Cycle read-back failed. Read cycles before retrying creation.");
        } else result = await requestJson(browser.request, origin, "/api/hiring/cycles");
      }
      if (["applicants", "intake"].includes(command) && !options.cycle) throw new Error("--cycle ID is required.");
      if (command === "applicants") result = await requestJson(browser.request, origin, `/api/hiring/applications?cycleId=${encodeURIComponent(options.cycle)}`);
      if (command === "intake") {
        if (!options.file) throw new Error("--file INTAKE.json is required.");
        const input = await readFile(options.file, "utf8");
        if (input.length > 1_000_000) throw new Error("Intake file exceeds 1 MB. Split the batch.");
        const agentResults = validateIntake(JSON.parse(input));
        const payload = options["legacy-csv"] ? { cycleId: options.cycle, csv: intakeCsv(agentResults), blankDecisionMeansPassed: false } : { cycleId: options.cycle, agentResults };
        result = await requestJson(browser.request, origin, "/api/hiring/import", { method: "POST", data: payload });
        if (options.apply) {
          if (result.data?.counts?.invalid || result.data?.counts?.needs_review || result.data?.counts?.duplicate_in_file) throw new Error("Resolve invalid rows and possible duplicates before applying this batch.");
          const writable = (result.data?.counts?.create ?? 0) + (result.data?.counts?.attach ?? 0);
          if (writable) result = await requestJson(browser.request, origin, "/api/hiring/import", { method: "POST", data: { ...payload, apply: true }, retries: 0 });
          const saved = await requestJson(browser.request, origin, `/api/hiring/applications?cycleId=${encodeURIComponent(options.cycle)}`);
          const ids = new Set(saved.data?.map((a) => a.externalApplicationId));
          const missing = agentResults.applicants.filter((a) => !ids.has(a.applicationId)).map((a) => a.applicationId);
          if (missing.length) throw new Error(`Import read-back failed for ${missing.length} Application IDs. Rerun preview before retrying.`);
          result = { ...result, verifiedIds: agentResults.applicants.map((a) => a.applicationId) };
        }
      }
    }
    if (options.output && !["pageup", "verify"].includes(command)) {
      await privateJson(resolve(options.output), result);
      result = { output: resolve(options.output), counts: result.data?.counts, count: Array.isArray(result.data) ? result.data.length : undefined, verified: result.verifiedIds?.length };
    }
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } finally {
    if (ownsBrowser) await browser.close().catch(() => {});
    if (backgroundEngine) await backgroundEngine.close().catch(() => {});
    if (connection) await connection.close().catch(() => {}); // Disconnect; leave the sign-in browser open.
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((err) => { process.stderr.write(JSON.stringify({ error: err.message }) + "\n"); process.exitCode = 1; });
