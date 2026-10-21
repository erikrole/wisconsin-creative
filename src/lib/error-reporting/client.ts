import { BREADCRUMB_TYPES, routeTemplate, stripQuery, type Breadcrumb } from "./grouping";

/**
 * Browser side of error reporting: a ring of recent actions (navigation,
 * button presses, API calls, console errors) and a small queue that sends
 * uncaught errors to /api/errors. Nothing typed into a field, no request or
 * response bodies, and no query strings are recorded.
 */

const MAX_BREADCRUMBS = 30;
const MAX_REPORTS_PER_PAGE = 20;
const MAX_REPEATS = 3;
const ENDPOINT = "/api/errors";
// Background telemetry would crowd out the actions that explain a failure.
const QUIET_PATHS = new Set([ENDPOINT, "/api/product-events"]);

type BreadcrumbType = (typeof BREADCRUMB_TYPES)[number];
type ClientReport = {
  kind: "error" | "unhandled_rejection" | "render_error";
  name?: string;
  message: string;
  stack?: string;
  digest?: string;
  screen?: string;
  occurredAt: string;
  breadcrumbs: Breadcrumb[];
};

const breadcrumbs: Breadcrumb[] = [];
const sentKeys = new Map<string, number>();
let sentCount = 0;
let installed = false;
const queue: ClientReport[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export const BUILD = {
  appBuild: process.env.NEXT_PUBLIC_BUILD_SHA || null,
  releaseChannel: process.env.NEXT_PUBLIC_DEPLOY_ENV || "development",
};

export function addBreadcrumb(type: BreadcrumbType, message: string, data?: Breadcrumb["data"]): void {
  breadcrumbs.push({ at: new Date().toISOString(), type, message: message.slice(0, 200), ...(data ? { data } : {}) });
  if (breadcrumbs.length > MAX_BREADCRUMBS) breadcrumbs.splice(0, breadcrumbs.length - MAX_BREADCRUMBS);
}

export function recentBreadcrumbs(): Breadcrumb[] {
  return breadcrumbs.slice();
}

export function currentScreen(): string | null {
  return typeof window === "undefined" ? null : stripQuery(window.location.pathname);
}

/** Context attached to a "Report a problem" submission. */
export function supportContext() {
  return { platform: "web" as const, ...BUILD, screen: currentScreen(), breadcrumbs: recentBreadcrumbs() };
}

function errorParts(value: unknown): { name?: string; message: string; stack?: string } {
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (typeof value === "string") return { message: value };
  try {
    return { message: JSON.stringify(value)?.slice(0, 500) ?? String(value) };
  } catch {
    return { message: String(value) };
  }
}

/** Noise that says nothing about this app: extensions, cross-origin scripts, benign browser warnings. */
export function isIgnorableError(message: string, stack?: string, filename?: string): boolean {
  if (/^(Script error\.?|ResizeObserver loop)/i.test(message)) return true;
  if (/AbortError|The user aborted a request|signal is aborted/i.test(message)) return true;
  const source = `${filename ?? ""}\n${stack ?? ""}`;
  return /(chrome|moz|safari(-web)?)-extension:\/\//.test(source);
}

export function reportClientError(
  value: unknown,
  options: { kind?: ClientReport["kind"]; digest?: string; filename?: string } = {},
): void {
  if (typeof window === "undefined") return;
  const parts = errorParts(value);
  if (isIgnorableError(parts.message, parts.stack, options.filename)) return;
  const key = `${parts.name ?? ""}:${parts.message}`.slice(0, 300);
  const repeats = sentKeys.get(key) ?? 0;
  if (repeats >= MAX_REPEATS || sentCount >= MAX_REPORTS_PER_PAGE) return;
  sentKeys.set(key, repeats + 1);
  sentCount += 1;
  queue.push({
    kind: options.kind ?? "error",
    ...parts,
    ...(options.digest ? { digest: options.digest } : {}),
    screen: currentScreen() ?? undefined,
    occurredAt: new Date().toISOString(),
    breadcrumbs: recentBreadcrumbs(),
  });
  if (!flushTimer) flushTimer = setTimeout(flush, 1_000);
}

function flush(): void {
  flushTimer = null;
  if (queue.length === 0) return;
  const reports = queue.splice(0, 5);
  void nativeFetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client: { platform: "web", ...BUILD }, reports }),
    keepalive: true,
  }).catch(() => undefined);
  if (queue.length > 0) flushTimer = setTimeout(flush, 1_000);
}

let nativeFetch: typeof fetch = (...args) => fetch(...args);

function controlLabel(element: Element): string | null {
  const labelled = element.getAttribute("aria-label") ?? element.getAttribute("title");
  const text = labelled ?? element.textContent ?? "";
  const label = text.replace(/\s+/g, " ").trim().slice(0, 60);
  return label || null;
}

function onClick(event: MouseEvent): void {
  const target = event.target instanceof Element ? event.target : null;
  const control = target?.closest("button, a, [role='button'], [role='menuitem'], [role='tab'], [role='option'], [role='switch'], [role='checkbox']");
  if (!control || control.closest("[data-private]")) return;
  const role = control.getAttribute("role") ?? control.tagName.toLowerCase();
  const label = controlLabel(control);
  const href = control instanceof HTMLAnchorElement ? routeTemplate(control.getAttribute("href")) : null;
  addBreadcrumb("click", `${role === "a" ? "link" : role}${label ? ` "${label}"` : ""}`, href ? { href } : undefined);
}

function wrapFetch(): void {
  const original = window.fetch.bind(window);
  nativeFetch = original;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let path: string | null = null;
    try {
      const parsed = new URL(url, window.location.href);
      if (parsed.origin === window.location.origin && parsed.pathname.startsWith("/api/") && !QUIET_PATHS.has(parsed.pathname)) {
        path = routeTemplate(parsed.pathname);
      }
    } catch {
      path = null;
    }
    if (!path) return original(input, init);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const started = performance.now();
    try {
      const response = await original(input, init);
      const ms = Math.round(performance.now() - started);
      const requestId = response.headers.get("x-vercel-id");
      addBreadcrumb("api", `${method} ${path} → ${response.status}`, {
        ms,
        ...(response.status >= 400 && requestId ? { requestId } : {}),
      });
      return response;
    } catch (error) {
      addBreadcrumb("api", `${method} ${path} → failed`, { ms: Math.round(performance.now() - started), error: errorParts(error).message.slice(0, 80) });
      throw error;
    }
  };
}

function wrapConsoleError(): void {
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const first = args[0];
    const message = first instanceof Error ? `${first.name}: ${first.message}` : typeof first === "string" ? first : errorParts(first).message;
    addBreadcrumb("log", message.slice(0, 160));
    original(...args);
  };
}

export function installErrorReporting(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  addBreadcrumb("lifecycle", "page loaded", { screen: routeTemplate(window.location.pathname) });
  window.addEventListener("error", (event) => {
    reportClientError(event.error ?? event.message, { filename: event.filename });
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportClientError(event.reason, { kind: "unhandled_rejection" });
  });
  document.addEventListener("click", onClick, { capture: true, passive: true });
  document.addEventListener("visibilitychange", () => {
    addBreadcrumb("lifecycle", document.visibilityState === "hidden" ? "app hidden" : "app visible");
    if (document.visibilityState === "hidden") flush();
  });
  wrapFetch();
  wrapConsoleError();
}
