import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { materialUrl } from "./cli.mjs";

const PAGEUP = "https://uwstudents.dc4.pageuppeople.com";
export function boardCount(text) {
  const match = /Application Complete\s*\((\d+)\)/i.exec(text);
  if (!match) throw new Error("Cannot verify the refreshed Application Complete count. Stop instead of using a partial board.");
  return Number(match[1]);
}
export function scanRecords(links) {
  const records = new Map();
  for (const link of links) {
    const url = new URL(link.url);
    const id = url.searchParams.get("applicationId");
    if (!id || !/^\d{1,60}$/.test(id) || url.origin !== PAGEUP) continue;
    if (!["/ApplicantProgressBoard/OpenResume", "/ApplicantProgressBoard/OpenApplicationAnswers", "/ApplicantProgressBoard/OpenCoverLetter"].includes(url.pathname)) continue;
    const key = url.pathname.endsWith("OpenResume") ? "resumeUrl" : url.pathname.endsWith("OpenApplicationAnswers") ? "applicationFormUrl" : "otherMaterialsUrl";
    const record = records.get(id) ?? { applicationId: id, name: link.name ?? null };
    record[key] = materialUrl(link.url, id);
    records.set(id, record);
  }
  return [...records.values()];
}
export async function scanPageUp(browser, requisitionId) {
  const page = await browser.newPage();
  try {
    await page.goto(`${PAGEUP}/ManageApplications/ApplicantProgressBoard?lJobId=${encodeURIComponent(requisitionId)}`, { waitUntil: "domcontentloaded" });
    await page.reload({ waitUntil: "domcontentloaded" });
    if (!page.url().startsWith(PAGEUP)) throw new Error(`PageUp redirected to ${new URL(page.url()).origin}. Sign-in is not available to this session.`);
    await page.getByRole("heading", { name: "Application Complete", exact: true }).waitFor({ timeout: 30000 });
    // PageUp renders a temporary (0) before its first cards arrive. Never accept it as an empty pool.
    await page.locator('a[href*="OpenApplicationAnswers"]').first().waitFor({ timeout: 30000 });
    const count = boardCount(await page.locator("body").innerText());
    const captured = new Map();
    for (let batch = 0; batch < 60; batch++) {
      const snapshot = await page.locator("body").evaluate(body => {
        const heading = [...body.querySelectorAll("h2")].find(h => h.textContent.trim() === "Application Complete");
        let column = heading?.parentElement;
        while (column && !column.querySelector(".overflow-y-auto")) column = column.parentElement;
        if (!column || column.querySelectorAll("h2").length !== 1) throw new Error("Cannot isolate Application Complete column");
        const scroll = column.querySelector(".overflow-y-auto");
        const links = [...column.querySelectorAll("a[href]")].map(a => {
          let parent = a.parentElement;
          let name = null;
          for (let depth = 0; parent && depth < 10; depth++, parent = parent.parentElement) {
            const headings = parent.querySelectorAll("h3");
            if (headings.length === 1) { name = headings[0].textContent?.trim() ?? null; break; }
          }
          return { url: a.href, name };
        });
        scroll.scrollTop = scroll.scrollHeight;
        return { links, height: scroll.scrollHeight };
      });
      for (const record of scanRecords(snapshot.links)) captured.set(record.applicationId, record);
      if (captured.size === count) break;
      if (captured.size > count) throw new Error("PageUp count changed during capture; refresh before importing.");
      await page.waitForFunction(previous => {
        const heading = [...document.querySelectorAll("h2")].find(h => h.textContent.trim() === "Application Complete");
        let column = heading?.parentElement;
        while (column && !column.querySelector(".overflow-y-auto")) column = column.parentElement;
        return column?.querySelector(".overflow-y-auto")?.scrollHeight > previous;
      }, snapshot.height, { timeout: 15000 });
    }
    const applicants = [...captured.values()];
    if (applicants.length !== count || boardCount(await page.locator("body").innerText()) !== count) throw new Error(`Board completeness check failed: ${count} expected, ${applicants.length} Application IDs captured. No import was started.`);
    return { version: 1, source: "pageup", requisitionId, refreshedAt: new Date().toISOString(), expectedCount: count, applicants };
  } catch (err) {
    if (err.name === "TimeoutError") throw new Error("PageUp board did not become readable. Sign-in, page layout, or loading needs attention; no cached data was used.");
    throw err;
  } finally { await page.close(); }
}
export async function fetchPageUpMaterial(request, sourceUrl) {
  let url = sourceUrl;
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (new URL(url).origin !== PAGEUP) throw new Error("Document destination is outside PageUp.");
    const response = await request.get(url, { timeout: 30000, maxRedirects: 0 });
    if (response.status() < 300 || response.status() >= 400) return response;
    const location = response.headers().location;
    if (!location) return response;
    const next = new URL(location, url);
    if (next.origin !== PAGEUP || !["/v5.3/provider/document/transferDocument.ashx", "/v5.3/provider/manageApplicants/printAnswers.asp"].includes(next.pathname)) throw new Error("Document redirected outside the verified PageUp material routes.");
    url = next.href;
  }
  throw new Error("PageUp document redirect limit exceeded.");
}
export async function captureMaterials(browser, scan, output) {
  if (scan?.version !== 1 || scan?.source !== "pageup" || !/^\d{1,60}$/.test(scan.requisitionId ?? "") || !Array.isArray(scan.applicants) || scan.applicants.length > 500 || scan.applicants.some((a) => !/^\d{1,60}$/.test(a.applicationId ?? ""))) throw new Error("Invalid PageUp scan manifest.");
  // Create a new private directory; never overwrite prior capture evidence.
  await mkdir(output, { mode: 0o700 });
  const results = [];
  for (const applicant of scan.applicants) {
    const files = [];
    const unavailable = [];
    for (const key of ["resumeUrl", "applicationFormUrl", "otherMaterialsUrl"]) {
      if (!applicant[key]) { unavailable.push(key); continue; }
      const url = materialUrl(applicant[key], applicant.applicationId);
      const response = await fetchPageUpMaterial(browser.request, url);
      if (!response.ok()) { unavailable.push(key); continue; }
      const contentType = response.headers()["content-type"] ?? "";
      const bytes = await response.body();
      if (bytes.length > 20 * 1024 * 1024) { unavailable.push(key); continue; }
      let path;
      if (bytes.subarray(0, 5).toString() === "%PDF-") {
        path = join(output, `${applicant.applicationId}-${key}.pdf`);
        await writeFile(path, bytes, { mode: 0o600, flag: "wx" });
      } else if (contentType.includes("html")) {
        const page = await browser.newPage();
        try {
          await page.goto(url, { waitUntil: "domcontentloaded" });
          if (!page.url().startsWith(PAGEUP)) { unavailable.push(key); continue; }
          const text = await page.locator("body").innerText();
          if (/sign in|log in|authentication required/i.test(text.slice(0, 600)) || text.trim().length < 30) { unavailable.push(key); continue; }
          path = join(output, `${applicant.applicationId}-${key}.txt`);
          await writeFile(path, text, { mode: 0o600, flag: "wx" });
        } finally { await page.close(); }
      } else { unavailable.push(key); continue; }
      files.push({ kind: key, path, sourceUrl: url });
    }
    results.push({ applicationId: applicant.applicationId, files, unavailable });
  }
  await writeFile(join(output, "materials.json"), JSON.stringify({ source: "pageup", requisitionId: scan.requisitionId, capturedAt: new Date().toISOString(), applicants: results }, null, 2), { mode: 0o600, flag: "wx" });
  return { output, applicants: results.length, unavailable: results.reduce((sum, a) => sum + a.unavailable.length, 0) };
}
