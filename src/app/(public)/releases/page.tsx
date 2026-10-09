import { cn } from "@/lib/utils";
import {
  type Release,
  type ReleasePlatform,
  type ReleaseType,
  formatReleaseDate,
  groupReleases,
  releaseSlug,
  releases,
} from "@/lib/releases";

const platformStyles: Record<ReleasePlatform, string> = {
  Web: "bg-blue-50 text-blue-700 ring-blue-600/15",
  iOS: "bg-zinc-100 text-zinc-700 ring-zinc-600/15",
  Kiosk: "bg-red-50 text-[var(--wi-red)] ring-red-600/15",
  macOS: "bg-violet-50 text-violet-700 ring-violet-600/15",
};

const typeLabels: Record<ReleaseType, { label: string; dot: string }> = {
  feature: { label: "New", dot: "bg-[var(--wi-red)]" },
  improvement: { label: "Improved", dot: "bg-blue-600" },
  fixes: { label: "Fixes", dot: "bg-zinc-400" },
};

export default function ReleasesPage() {
  const months = groupReleases(releases);

  return (
    <main id="showroom-content">
      <header className="border-b border-border px-4 pb-10 pt-14 sm:px-6 sm:pt-20 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <p className="text-sm font-semibold text-[var(--wi-red)]">Releases</p>
          <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            What&rsquo;s new in Wisconsin Creative
          </h1>
          <p className="mt-4 max-w-2xl text-pretty text-base leading-7 text-muted-foreground sm:text-lg">
            New features, improvements, and fixes across web, iOS, the checkout kiosk, and the macOS menu bar app.
          </p>
          <nav aria-label="Jump to month" className="mt-8 flex flex-wrap gap-2">
            {months.map((month) => (
              <a
                key={month.key}
                href={`#${month.key}`}
                className="min-h-9 rounded-full border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground outline-none transition-[color,border-color,box-shadow] hover:border-foreground/30 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 motion-reduce:transition-none"
              >
                {month.label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <div className="px-4 pb-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          {months.map((month) => (
            <section key={month.key} id={month.key} aria-label={month.label} className="scroll-mt-32 md:scroll-mt-16">
              {month.days.map((day) => (
                <div
                  key={day.date}
                  className="grid gap-4 border-b border-border py-10 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-10 md:py-14"
                >
                  <div className="md:sticky md:top-24 md:self-start">
                    <time dateTime={day.date} className="text-sm font-medium text-muted-foreground">
                      {formatReleaseDate(day.date)}
                    </time>
                  </div>
                  <div className="min-w-0 divide-y divide-border">
                    {day.releases.map((release) => (
                      <ReleaseArticle key={releaseSlug(release)} release={release} />
                    ))}
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}

function ReleaseArticle({ release }: { release: Release }) {
  const slug = releaseSlug(release);
  const type = typeLabels[release.type];

  return (
    <article id={slug} className="scroll-mt-36 py-8 first:pt-0 last:pb-0 md:scroll-mt-24">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs font-medium text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className={cn("size-1.5 rounded-full", type.dot)} />
          {type.label}
        </span>
        <span className="flex flex-wrap gap-1.5">
          {release.platforms.map((platform) => (
            <span key={platform} className={cn("rounded-full px-2 py-0.5 ring-1 ring-inset", platformStyles[platform])}>
              {platform}
            </span>
          ))}
        </span>
        {release.version ? (
          <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-zinc-700">{release.version}</span>
        ) : null}
        {release.pr ? <span className="font-mono text-muted-foreground/80">PR #{release.pr}</span> : null}
      </div>

      <h2 className="mt-3 text-pretty text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
        <a href={`#${slug}`} className="rounded-sm outline-none hover:underline hover:decoration-foreground/20 hover:underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/40">
          {release.title}
        </a>
      </h2>
      <p className="mt-2 max-w-2xl text-pretty text-base leading-7 text-muted-foreground">{release.summary}</p>

      {release.details?.length ? (
        <ul className="mt-4 max-w-2xl space-y-2 text-[0.9375rem] leading-6 text-foreground/85">
          {release.details.map((detail) => (
            <li key={detail} className="relative pl-4 before:absolute before:left-0 before:top-[0.65rem] before:size-1 before:rounded-full before:bg-foreground/30">
              {detail}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
