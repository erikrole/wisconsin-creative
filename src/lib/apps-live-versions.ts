// Current versions for the /apps cards, read from where each app is published so the
// page does not go stale. Every lookup is optional: on any failure the page falls back
// to the version written in apps-page.ts.
export type LiveVersion = { version: string; released?: string };
export type LiveVersions = Partial<
  Record<"wisconsin-creative" | "offload", LiveVersion>
>;

const APP_STORE_ID = "6763456945";
const OFFLOAD_RELEASES = "erikrole/offload-releases";
const REVALIDATE_SECONDS = 600;
const TIMEOUT_MS = 3000;
const VERSION = /^\d+(\.\d+){1,3}$/;

async function getJson(
  url: string,
  headers?: Record<string, string>,
): Promise<unknown> {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    next: { revalidate: REVALIDATE_SECONDS },
  });
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);
  return response.json();
}

/** YYYY-MM-DD in Madison time, so a late-evening release isn't shown as tomorrow. */
export function madisonDate(iso: string): string | undefined {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
  }).format(date);
}

export function parseAppStore(body: unknown): LiveVersion | undefined {
  const first = (
    body as {
      results?: Array<{
        version?: unknown;
        currentVersionReleaseDate?: unknown;
      }>;
    }
  )?.results?.[0];
  if (
    !first ||
    typeof first.version !== "string" ||
    !VERSION.test(first.version)
  )
    return undefined;
  const released =
    typeof first.currentVersionReleaseDate === "string"
      ? madisonDate(first.currentVersionReleaseDate)
      : undefined;
  return { version: first.version, released };
}

export function parseGithubRelease(body: unknown): LiveVersion | undefined {
  const tag = (body as { tag_name?: unknown })?.tag_name;
  const version = typeof tag === "string" ? tag.replace(/^v/i, "") : "";
  return VERSION.test(version) ? { version } : undefined;
}

export async function loadLiveVersions(): Promise<LiveVersions> {
  const [store, offload] = await Promise.allSettled([
    getJson(`https://itunes.apple.com/lookup?id=${APP_STORE_ID}&country=us`),
    getJson(
      `https://api.github.com/repos/${OFFLOAD_RELEASES}/releases/latest`,
      { accept: "application/vnd.github+json" },
    ),
  ]);
  const live: LiveVersions = {};
  if (store.status === "fulfilled") {
    const parsed = parseAppStore(store.value);
    if (parsed) live["wisconsin-creative"] = parsed;
  }
  if (offload.status === "fulfilled") {
    const parsed = parseGithubRelease(offload.value);
    if (parsed) live.offload = parsed;
  }
  return live;
}
