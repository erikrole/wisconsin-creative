import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ChapterBand } from "@/components/public-showroom/showroom-blocks";
import { publicApps, publicTools, type AppStatus } from "@/lib/public-apps";

const statusTone: Record<AppStatus | "live", "green" | "blue" | "gray"> = {
  available: "green",
  live: "green",
  "team-beta": "blue",
  "coming-soon": "gray",
};

export default function AppsPage() {
  return (
    <main id="showroom-content">
      <section className="bg-[#050505] text-white">
        <div className="mx-auto w-full max-w-5xl px-4 py-20 text-center sm:px-6 lg:px-8 lg:py-28">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-white/55">Apps and tools</p>
          <h1 className="mt-5 font-[var(--font-heading)] text-5xl! font-black! leading-none text-balance tracking-normal sm:text-7xl!">
            Built by the team, for the team.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-pretty text-white/70">
            Apps for gear, footage, and game-day work, plus small browser tools anyone can use.
          </p>
        </div>
      </section>

      <ChapterBand eyebrow="Apps" title="Installed apps." description="Native apps for the Wisconsin Creative team." />
      <section aria-label="Apps" className="bg-[#f4f4f4] px-4 pb-20 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-3">
          {publicApps.map((app) => (
            <article key={app.name} className="flex flex-col border-t border-border/70 pt-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{app.platform}</p>
                <Badge variant={statusTone[app.status]}>{app.statusLabel}</Badge>
              </div>
              <h2 className="mt-4 font-[var(--font-heading)] text-3xl! font-black! text-balance tracking-normal">{app.name}</h2>
              <p className="mt-3 text-sm leading-6 text-pretty text-muted-foreground">{app.summary}</p>
              {app.highlights.length > 0 && (
                <ul className="mt-5 flex flex-col gap-2 border-t border-border/70 pt-4 text-sm">
                  {app.highlights.map((item) => (
                    <li key={item} className="leading-6">
                      {item}
                    </li>
                  ))}
                </ul>
              )}
              {app.href && (
                <Link
                  href={app.href}
                  className="group mt-auto inline-flex min-h-10 items-center gap-2 pt-6 text-sm font-semibold outline-none hover:text-[var(--wi-red)] focus-visible:ring-[3px] focus-visible:ring-ring/40"
                >
                  {app.hrefLabel}
                  <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none motion-reduce:transition-none" aria-hidden="true" />
                </Link>
              )}
            </article>
          ))}
        </div>
      </section>

      <ChapterBand eyebrow="Tools" title="Open in your browser." description="No install and no sign-in." dark />
      <section aria-label="Tools" className="bg-[#080808] px-4 pb-20 text-white sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {publicTools.map((tool) => (
            <article key={tool.name} className="flex flex-col border-t border-white/20 pt-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-semibold text-balance">{tool.name}</h2>
                <Badge variant={statusTone[tool.status]}>{tool.statusLabel}</Badge>
              </div>
              <p className="mt-3 text-sm leading-6 text-pretty text-white/64">{tool.summary}</p>
              {tool.href && (
                <a
                  href={tool.href}
                  className="group mt-auto inline-flex min-h-10 items-center gap-2 pt-6 text-sm font-semibold text-white outline-none focus-visible:ring-[3px] focus-visible:ring-white/30"
                >
                  {tool.hrefLabel}
                  <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none motion-reduce:transition-none" aria-hidden="true" />
                </a>
              )}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
