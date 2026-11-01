import { readFileSync } from "node:fs";
import { expect, type APIRequestContext, type APIResponse, type Browser, type Locator, type Page, type PlaywrightWorkerArgs } from "@playwright/test";

type Playwright = PlaywrightWorkerArgs["playwright"];

export type Seed = {
  password: string;
  location: { id: string; name: string };
  users: Record<"admin" | "staff" | "student" | "teammate", { id: string; email: string; name: string; wiscard?: string }>;
  assets: Record<"roam1" | "roam2" | "lens1" | "broken", { id: string; tag: string }>;
  event: { id: string; summary: string; startsAt: string; endsAt: string };
  shifts: { open: string; held: string; heldAssignment: string };
};
export type Who = keyof Seed["users"];

export const seed: Seed = JSON.parse(readFileSync(process.env.E2E_FLOWS_SEED_FILE!, "utf8"));
export const baseURL = process.env.E2E_FLOWS_BASE_URL!;
export const CHICAGO = "America/Chicago";

/** Where auth.setup.ts saves each person's signed-in browser state. */
export const stateFile = (who: Who) => `test-results/e2e-flows/auth/${who}.json`;

/** A page already signed in as one of the seeded people (no extra login). */
export async function pageAs(browser: Browser, who: Who): Promise<Page> {
  const context = await browser.newContext({ storageState: stateFile(who) });
  return context.newPage();
}

/** An API client carrying that person's session cookie. */
export async function apiAs(playwright: Playwright, who: Who): Promise<APIRequestContext> {
  return playwright.request.newContext({ baseURL, extraHTTPHeaders: { origin: baseURL }, storageState: stateFile(who) });
}

/** Register a kiosk iPad the way an admin does, redeem its code, and return the kiosk's own client. */
export async function activateKiosk(playwright: Playwright, admin: APIRequestContext, name: string) {
  const created = await admin.post("/api/kiosk-devices", { data: { name, locationId: seed.location.id } });
  expect(created.status(), await created.text()).toBe(201);
  const { activationCode } = await created.json();
  const kiosk = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { origin: baseURL } });
  await json(kiosk.post("/api/kiosk/activate", { data: { code: activationCode } }));
  return kiosk;
}

/** Parse a response that must have succeeded, failing with the body when it did not. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- callers pick the shape; default stays loose on purpose
export async function json<T = any>(pending: Promise<APIResponse> | APIResponse): Promise<T> {
  const response = await pending;
  expect(response.ok(), `${response.url()} -> ${response.status()} ${await response.text().catch(() => "")}`).toBeTruthy();
  return response.json();
}

/** The kiosk's idempotency key, in the `<ms>:<uuid>` shape the receipts accept. */
export const kioskRequestId = () => `${Date.now()}:${crypto.randomUUID()}`;

/** "Nov 2, 2026, 5:00 PM" in Madison time, the way the app labels instants. */
export function madisonDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: CHICAGO });
}

/** "Mon 5:00 pm": the short chip the wizard and schedule use, in Madison time. */
export function madisonChip(iso: string) {
  const date = new Date(iso);
  const day = date.toLocaleDateString("en-US", { weekday: "short", timeZone: CHICAGO });
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: CHICAGO }).toLowerCase();
  return `${day} ${time}`;
}

/** Click a control that opens something, retrying while the page is still hydrating. */
export async function clickOpens(control: Locator, opened: Locator) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await control.click();
    try {
      await expect(opened).toBeVisible({ timeout: 3_000 });
      return;
    } catch {
      if (attempt === 3) throw new Error(`${control} opened nothing after four tries`);
    }
  }
}

/** A booking as the admin API reads it (the kiosk is the only writer of custody). */
export async function bookingStatus(playwright: Playwright, id: string) {
  const body = await json((await apiAs(playwright, "admin")).get(`/api/bookings/${id}`));
  return (body.data ?? body).status as string;
}
