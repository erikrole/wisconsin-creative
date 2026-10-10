import type { FootballScore } from "@/lib/football-results";

/** Shared team/profile treatment. Source links are public game pages, never crew details. */
export function FootballFinalScore({ score }: { score: FootballScore | null | undefined }) {
  if (!score) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {score.status === "verified" ? (
        <span className="font-semibold tabular-nums" aria-label={`Final: Wisconsin ${score.wisconsin}, opponent ${score.opponent}`}>
          {score.wisconsin}–{score.opponent} <span className="font-normal text-muted-foreground">Final · Wisconsin first</span>
        </span>
      ) : (
        <span className="text-muted-foreground">{score.status === "disputed" ? "Score under review" : "Awaiting score verification"}</span>
      )}
      {score.stale && <span className="text-muted-foreground">Refresh delayed</span>}
      {score.sources.map((source) => (
        <a key={source.provider} href={source.url} target="_blank" rel="noopener noreferrer"
          className="inline-flex min-h-10 min-w-10 items-center text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={`Last checked ${new Date(source.observedAt).toLocaleString("en-US", { timeZone: "America/Chicago" })} Central`}>
          {source.provider === "UW" ? "UWBadgers" : "ESPN"}<span className="sr-only"> game details (opens in a new tab)</span>
        </a>
      ))}
    </div>
  );
}
