"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type Release,
  type ReleasePlatform,
  type ReleaseType,
  RECENT_RELEASE_DAYS,
  formatReleaseDate,
  groupReleases,
  isRecentRelease,
  releaseSlug,
  releases,
} from "@/lib/releases";

const platformOptions: { value: ReleasePlatform; label: string; dot: string }[] = [
  { value: "Web", label: "Web", dot: "bg-blue-600" },
  { value: "iOS", label: "iOS", dot: "bg-zinc-900" },
  { value: "Kiosk", label: "Kiosk", dot: "bg-emerald-600" },
  { value: "macOS", label: "Mac", dot: "bg-violet-600" },
];

const typeOptions: { value: ReleaseType; label: string; dot: string }[] = [
  { value: "feature", label: "New", dot: "bg-[var(--wi-red)]" },
  { value: "improvement", label: "Improved", dot: "bg-blue-600" },
  { value: "fixes", label: "Fixes", dot: "bg-zinc-400" },
];

const platformMeta = Object.fromEntries(platformOptions.map((option) => [option.value, option])) as Record<
  ReleasePlatform,
  (typeof platformOptions)[number]
>;
const typeMeta = Object.fromEntries(typeOptions.map((option) => [option.value, option])) as Record<
  ReleaseType,
  (typeof typeOptions)[number]
>;

const chipClass =
  "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium outline-none transition-[color,background-color,border-color,box-shadow] focus-visible:ring-[3px] focus-visible:ring-ring/40 motion-reduce:transition-none";

function chipState(active: boolean) {
  return active
    ? "border-foreground bg-foreground text-background"
    : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground";
}

export function ReleasesFeed() {
  const [platform, setPlatform] = useState<ReleasePlatform | null>(null);
  const [type, setType] = useState<ReleaseType | null>(null);
  const [showAll, setShowAll] = useState(false);

  // Deep links to a release (or month) outside the current view clear filters and
  // expand the full history, then scroll once it renders.
  const [pendingHash, setPendingHash] = useState<string | null>(null);

  useEffect(() => {
    function revealHashTarget() {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const existing = document.getElementById(id);
      if (existing) {
        if (existing instanceof HTMLDetailsElement) existing.open = true;
        return;
      }
      const known = releases.some((release) => releaseSlug(release) === id || release.date.startsWith(id));
      if (!known) return;
      setPlatform(null);
      setType(null);
      setShowAll(true);
      setPendingHash(id);
    }
    revealHashTarget();
    window.addEventListener("hashchange", revealHashTarget);
    return () => window.removeEventListener("hashchange", revealHashTarget);
  }, []);

  useEffect(() => {
    if (!pendingHash) return;
    const target = document.getElementById(pendingHash);
    if (target instanceof HTMLDetailsElement) target.open = true;
    target?.scrollIntoView();
    setPendingHash(null);
  }, [pendingHash]);

  const matching = useMemo(
    () =>
      releases.filter(
        (release) => (!platform || release.platforms.includes(platform)) && (!type || release.type === type),
      ),
    [platform, type],
  );
  const visible = showAll ? matching : matching.filter((release) => isRecentRelease(release));
  const hiddenCount = matching.length - visible.length;
  const months = groupReleases(visible);
  const allMonths = groupReleases(releases);
  const filtered = platform !== null || type !== null;

  function jumpToMonth(key: string) {
    window.history.replaceState(null, "", `#${key}`);
    if (document.getElementById(key)) {
      document.getElementById(key)?.scrollIntoView();
      return;
    }
    setPlatform(null);
    setType(null);
    setShowAll(true);
    setPendingHash(key);
  }

  return (
    <>
      <div className="mx-auto mt-8 max-w-5xl space-y-3">
        <nav aria-label="Jump to month" className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          {allMonths.map((month) => (
            <a
              key={month.key}
              href={`#${month.key}`}
              onClick={(event) => {
                event.preventDefault();
                jumpToMonth(month.key);
              }}
              className={cn(chipClass, chipState(false))}
            >
              {month.label}
            </a>
          ))}
        </nav>
        <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:gap-6">
          <div role="group" aria-label="Filter by app" className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:px-0">
            <button type="button" aria-pressed={platform === null} onClick={() => setPlatform(null)} className={cn(chipClass, chipState(platform === null))}>
              All apps
            </button>
            {platformOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={platform === option.value}
                onClick={() => setPlatform(platform === option.value ? null : option.value)}
                className={cn(chipClass, chipState(platform === option.value))}
              >
                <span aria-hidden="true" className={cn("size-1.5 rounded-full", option.dot)} />
                {option.label}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Filter by type" className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:px-0">
            {typeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={type === option.value}
                onClick={() => setType(type === option.value ? null : option.value)}
                className={cn(chipClass, chipState(type === option.value))}
              >
                <span aria-hidden="true" className={cn("size-1.5 rounded-full", option.dot)} />
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto mt-10 max-w-5xl">
        {months.length === 0 ? (
          <div className="border-t border-border py-16 text-center text-muted-foreground">
            <p>No releases match these filters.</p>
            <button
              type="button"
              onClick={() => {
                setPlatform(null);
                setType(null);
              }}
              className="mt-3 rounded-sm text-sm font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              Clear filters
            </button>
          </div>
        ) : null}

        {months.map((month) => (
          <section key={month.key} id={month.key} aria-labelledby={`${month.key}-heading`} className="scroll-mt-32 md:scroll-mt-16">
            <h2
              id={`${month.key}-heading`}
              className="sticky top-[7.5625rem] z-10 -mx-4 border-b border-border bg-white/95 px-4 py-3 text-sm font-semibold text-foreground backdrop-blur sm:-mx-6 sm:px-6 md:top-16 lg:-mx-8 lg:px-8"
            >
              {month.longLabel}
            </h2>
            {month.days.map((day, index) => (
              <div
                key={day.date}
                className={cn(
                  "grid gap-3 py-10 md:grid-cols-[9rem_minmax(0,1fr)] md:gap-10 md:py-12",
                  index > 0 && "border-t border-border",
                )}
              >
                <div className="md:sticky md:top-32 md:self-start">
                  <time dateTime={day.date} className="text-sm font-medium text-muted-foreground">
                    {formatReleaseDate(day.date)}
                  </time>
                </div>
                <div className="min-w-0 space-y-10">
                  {day.releases.map((release) =>
                    release.type === "fixes" ? (
                      <FixesRelease key={releaseSlug(release)} release={release} defaultOpen={type === "fixes"} />
                    ) : (
                      <ReleaseArticle key={releaseSlug(release)} release={release} />
                    ),
                  )}
                </div>
              </div>
            ))}
          </section>
        ))}

        {hiddenCount > 0 ? (
          <div className="border-t border-border py-12 text-center">
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="min-h-10 rounded-full border border-border px-5 py-2 text-sm font-medium text-foreground outline-none transition-[border-color,box-shadow] hover:border-foreground/30 focus-visible:ring-[3px] focus-visible:ring-ring/40 motion-reduce:transition-none"
            >
              Show {hiddenCount} earlier {hiddenCount === 1 ? "release" : "releases"}
            </button>
            <p className="mt-3 text-sm text-muted-foreground">
              Showing the last {RECENT_RELEASE_DAYS / 7} weeks{filtered ? " for these filters" : ""}.
            </p>
          </div>
        ) : null}
      </div>
    </>
  );
}

function ReleaseMeta({ release }: { release: Release }) {
  const kind = typeMeta[release.type];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs font-medium text-muted-foreground">
      <span className="inline-flex items-center gap-1.5 text-foreground/80">
        <span aria-hidden="true" className={cn("size-1.5 rounded-full", kind.dot)} />
        {kind.label}
      </span>
      {release.platforms.map((value) => (
        <span key={value} className="inline-flex items-center gap-1.5 rounded-full bg-zinc-50 px-2 py-0.5 text-zinc-700 ring-1 ring-inset ring-zinc-200">
          <span aria-hidden="true" className={cn("size-1.5 rounded-full", platformMeta[value].dot)} />
          {platformMeta[value].label}
        </span>
      ))}
      {release.version ? <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-zinc-700">{release.version}</span> : null}
    </div>
  );
}

function ReleaseDetails({ details }: { details?: string[] }) {
  if (!details?.length) return null;
  return (
    <ul className="mt-4 max-w-2xl space-y-2 text-[0.9375rem] leading-6 text-muted-foreground">
      {details.map((detail) => (
        <li key={detail} className="relative pl-4 before:absolute before:left-0 before:top-[0.65rem] before:size-1 before:rounded-full before:bg-foreground/25">
          {detail}
        </li>
      ))}
    </ul>
  );
}

function ReleaseArticle({ release }: { release: Release }) {
  const slug = releaseSlug(release);
  return (
    <article id={slug} className="scroll-mt-44 md:scroll-mt-32">
      <ReleaseMeta release={release} />
      <h3 className="mt-3 text-pretty text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
        <a href={`#${slug}`} className="rounded-sm outline-none hover:underline hover:decoration-foreground/20 hover:underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/40">
          {release.title}
        </a>
      </h3>
      <p className="mt-2 max-w-2xl text-pretty text-base leading-7 text-foreground/85">{release.summary}</p>
      <ReleaseDetails details={release.details} />
    </article>
  );
}

function FixesRelease({ release, defaultOpen }: { release: Release; defaultOpen: boolean }) {
  const slug = releaseSlug(release);
  const count = release.details?.length ?? 0;
  return (
    <details id={slug} open={defaultOpen || undefined} className="group scroll-mt-44 md:scroll-mt-32">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-2 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
        <ReleaseMeta release={release} />
        <span className="text-sm font-medium text-foreground">
          {release.title}
          <span className="font-normal text-muted-foreground"> · {count} {count === 1 ? "change" : "changes"}</span>
        </span>
        <ChevronDownIcon aria-hidden="true" className="size-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <p className="mt-3 max-w-2xl text-pretty text-[0.9375rem] leading-6 text-foreground/85">{release.summary}</p>
      <ReleaseDetails details={release.details} />
    </details>
  );
}
