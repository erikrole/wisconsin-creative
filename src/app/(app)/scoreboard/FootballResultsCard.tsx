"use client";

import { FootballFinalScore } from "@/components/scoreboard/FootballFinalScore";
import { FootballResultsRefresh } from "@/components/scoreboard/FootballResultsRefresh";
import { formatDateShort } from "@/lib/format";
import { siteLabel } from "@/lib/scoreboard-display";
import type { TeamScoreboard } from "@/lib/services/team-scoreboard";
import { ReportSectionCard } from "../reports/report-ui";

/** Finished football games with the verified final score, newest first. */
export function FootballResultsCard({ games, canRefresh, onRefresh }: {
  games: TeamScoreboard["footballGames"];
  canRefresh: boolean;
  onRefresh: () => void;
}) {
  const scored = games.filter((game) => game.finalScore?.status === "verified");
  if (scored.length === 0 && !canRefresh) return null;
  return (
    <ReportSectionCard title="Football finals" description="Final scores from UW Athletics, with rank and TV from ESPN. Wisconsin is listed first."
      contentClassName="p-0">
      {canRefresh ? <FootballResultsRefresh onRefresh={onRefresh} /> : null}
      {scored.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">No finished football games with a result yet.</p>
      ) : (
        <ul className="divide-y divide-border/50">
          {scored.map((game) => (
            <li key={game.id} className="px-4 py-3">
              <p className="text-sm font-medium">
                {game.site === "AWAY" ? "at" : "vs"} {game.opponent ?? "Opponent"}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {formatDateShort(game.startsAt, game.allDay)} · {siteLabel(game.site)}
                </span>
              </p>
              <FootballFinalScore score={game.finalScore} />
            </li>
          ))}
        </ul>
      )}
    </ReportSectionCard>
  );
}
