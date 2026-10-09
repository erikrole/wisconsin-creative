import { RssIcon } from "lucide-react";
import { ReleasesFeed } from "@/components/public-showroom/ReleasesFeed";
import { formatReleaseDate, releaseSlug, releases } from "@/lib/releases";

export default function ReleasesPage() {
  const latest = releases.find((release) => release.type !== "fixes") ?? releases[0];

  return (
    <main id="showroom-content" className="px-4 pb-24 sm:px-6 lg:px-8">
      <header className="mx-auto max-w-5xl pt-14 sm:pt-20">
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm font-semibold text-[var(--wi-red)]">Releases</p>
          <a
            href="/releases/feed.xml"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-2 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 motion-reduce:transition-none"
          >
            <RssIcon aria-hidden="true" className="size-4" />
            RSS
          </a>
        </div>
        <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          What&rsquo;s new in Wisconsin Creative
        </h1>
        <p className="mt-4 max-w-2xl text-pretty text-base leading-7 text-muted-foreground sm:text-lg">
          New features, improvements, and fixes across web, iOS, the checkout kiosk, and the macOS menu bar app.
        </p>
        {latest ? (
          <p className="mt-5 text-sm text-muted-foreground">
            Latest:{" "}
            <a
              href={`#${releaseSlug(latest)}`}
              className="rounded-sm font-medium text-foreground underline decoration-foreground/20 underline-offset-4 outline-none hover:decoration-foreground/60 focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              {latest.title}
            </a>{" "}
            · {formatReleaseDate(latest.date)}
          </p>
        ) : null}
      </header>
      <ReleasesFeed />
    </main>
  );
}
