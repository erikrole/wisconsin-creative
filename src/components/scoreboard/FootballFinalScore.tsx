import type { FootballGameDetails, FootballScore } from "@/lib/football-results";

/** "OT", "2OT" and so on; null in regulation. */
function overtimeLabel(overtimes: number): string | null {
  return overtimes <= 0 ? null : overtimes === 1 ? "OT" : `${overtimes}OT`;
}

/** Short facts line: ranked opponent and TV (overtime shows beside Final). Empty when ESPN had nothing. */
function footballDetailLabels(details: FootballGameDetails | null | undefined): string[] {
  if (!details) return [];
  return [
    details.opponentRank ? `Opponent ranked No. ${details.opponentRank}` : null,
    details.networks.length > 0 ? details.networks.join(", ") : null,
  ].filter((label): label is string => label !== null);
}

/** Shared team/profile treatment. Source links are public game pages, never crew details. */
export function FootballFinalScore({ score }: { score: FootballScore | null | undefined }) {
  if (!score || score.status !== "verified") return null;
  const facts = footballDetailLabels(score.details);
  const overtime = score.details ? overtimeLabel(score.details.overtimes) : null;
  return (
    <div className="mt-1 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <span className="font-semibold tabular-nums" aria-label={`Final${overtime ? ` in ${overtime}` : ""}: Wisconsin ${score.wisconsin}, opponent ${score.opponent}`}>
          {score.wisconsin}–{score.opponent}{" "}
          <span className="font-normal text-muted-foreground">Final{overtime ? `/${overtime}` : ""} · Wisconsin first</span>
        </span>
        <span className="flex items-center gap-3">
          {score.sources.map((source) => (
            <a key={source.provider} href={source.url} target="_blank" rel="noopener noreferrer"
              className="inline-flex min-h-8 items-center text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={`Last checked ${new Date(source.observedAt).toLocaleString("en-US", { timeZone: "America/Chicago" })} Central`}>
              {source.provider === "UW" ? "UW" : "ESPN"}<span className="sr-only"> game details (opens in a new tab)</span>
            </a>
          ))}
        </span>
      </div>
      {(facts.length > 0 || score.stale) && (
        <p className="text-muted-foreground">{[...facts, score.stale ? "Refresh delayed" : null].filter(Boolean).join(" · ")}</p>
      )}
    </div>
  );
}
