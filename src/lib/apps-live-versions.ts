// Current versions for the /apps cards, read from where each app is published so the
// page does not go stale. Every lookup is optional: on any failure the page falls back
// to the version written in apps-page.ts.
export type LiveVersion = {
  version: string;
  released?: string;
  /** Versioned download URL, only when the release asset names that version. */
  href?: string;
  releaseHref?: string;
  /** Minimum system version stated by the release, such as "macOS 15 or later". */
  requires?: string;
};
export type LiveVersions = Partial<
  Record<"wisconsin-creative" | "offload" | "fetch", LiveVersion>
>;

const APP_STORE_ID = "6763456945";
const OFFLOAD_RELEASES = "erikrole/offload-releases";
const FETCH_RELEASES = "erikrole/fetch-releases";
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

const IOS_VERSION = /^\d+(\.\d+){1,2}$/;
const MACOS_REQUIREMENT = /macOS\s+(\d+(?:\.\d+){0,2})\s+(?:or|and)\s+later/i;

export function parseAppStore(body: unknown): LiveVersion | undefined {
  const first = (
    body as {
      results?: Array<{
        version?: unknown;
        currentVersionReleaseDate?: unknown;
        minimumOsVersion?: unknown;
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
  const requires =
    typeof first.minimumOsVersion === "string" &&
    IOS_VERSION.test(first.minimumOsVersion)
      ? `iOS ${first.minimumOsVersion} or later`
      : undefined;
  return compact({ version: first.version, released, requires });
}

function githubDownload(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com")
      return undefined;
    if (
      !parsed.pathname.startsWith(
        `/${OFFLOAD_RELEASES}/releases/download/`,
      )
    )
      return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function pickDmg(assets: unknown, version: string): string | undefined {
  if (!Array.isArray(assets)) return undefined;
  const dmgs = assets.flatMap((asset) => {
    const name = (asset as { name?: unknown })?.name;
    const href = githubDownload(
      (asset as { browser_download_url?: unknown })?.browser_download_url,
    );
    return typeof name === "string" && name.endsWith(".dmg") && href
      ? [{ name, href }]
      : [];
  });
  return (
    dmgs.find((asset) => asset.name === `Offload-${version}.dmg`)?.href ??
    dmgs.find((asset) => asset.name === "Offload.dmg")?.href
  );
}

function releasePage(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com")
      return undefined;
    if (!parsed.pathname.startsWith(`/${OFFLOAD_RELEASES}/releases/tag/`))
      return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function macOSFromNotes(notes: unknown): string | undefined {
  if (typeof notes !== "string") return undefined;
  const match = notes.match(MACOS_REQUIREMENT);
  return match ? `macOS ${match[1]} or later` : undefined;
}

function compact(version: LiveVersion): LiveVersion {
  return {
    version: version.version,
    ...(version.released ? { released: version.released } : {}),
    ...(version.href ? { href: version.href } : {}),
    ...(version.releaseHref ? { releaseHref: version.releaseHref } : {}),
    ...(version.requires ? { requires: version.requires } : {}),
  };
}

export function parseGithubRelease(body: unknown): LiveVersion | undefined {
  const record = body as {
    tag_name?: unknown;
    published_at?: unknown;
    html_url?: unknown;
    body?: unknown;
    assets?: unknown;
  } | null;
  const version =
    typeof record?.tag_name === "string"
      ? record.tag_name.replace(/^v/i, "")
      : "";
  if (!VERSION.test(version)) return undefined;
  const released =
    typeof record?.published_at === "string"
      ? madisonDate(record.published_at)
      : undefined;
  return compact({
    version,
    released,
    href: pickDmg(record?.assets, version),
    releaseHref: releasePage(record?.html_url),
    requires: macOSFromNotes(record?.body),
  });
}

export async function loadLiveVersions(): Promise<LiveVersions> {
  const [store, offload, fetchApp] = await Promise.allSettled([
    getJson(`https://itunes.apple.com/lookup?id=${APP_STORE_ID}&country=us`),
    getJson(
      `https://api.github.com/repos/${OFFLOAD_RELEASES}/releases/latest`,
      { accept: "application/vnd.github+json" },
    ),
    getJson(
      `https://api.github.com/repos/${FETCH_RELEASES}/releases/latest`,
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
  if (fetchApp.status === "fulfilled") {
    const parsed = parseGithubRelease(fetchApp.value);
    if (parsed) live.fetch = parsed;
  }
  return live;
}
