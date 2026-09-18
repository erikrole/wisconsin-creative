import { Trophy } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Wins/losses/ties use the chart palette's available/problem/neutral roles. */
export const WIN_FILL = "var(--chart-2)";
export const LOSS_FILL = "var(--chart-5)";
export const TIE_FILL = "var(--chart-4)";

type RecordParts = {
  wins: number;
  losses: number;
  ties: number;
};

type VolumeParts = RecordParts & {
  games: number;
};

/**
 * The record as a proportion. The W-L-T bar mirrors the record label so the tie
 * segment stays in the same place as the tie count.
 */
export function RecordMeter({ wins, losses, ties }: RecordParts) {
  const games = wins + losses + ties;

  return (
    <div>
      <div className="flex h-2.5 gap-[3px] overflow-hidden" aria-hidden="true">
        {games === 0 ? (
          <div className="h-full w-full rounded-full bg-muted" />
        ) : (
          <>
            {wins > 0 ? <div className="h-full min-w-0 flex-1 rounded-full" style={{ flexGrow: wins, background: WIN_FILL }} /> : null}
            {losses > 0 ? <div className="h-full min-w-0 flex-1 rounded-full" style={{ flexGrow: losses, background: LOSS_FILL }} /> : null}
            {ties > 0 ? <div className="h-full min-w-0 flex-1 rounded-full" style={{ flexGrow: ties, background: TIE_FILL }} /> : null}
          </>
        )}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          <span className="size-[7px] rounded-full" style={{ background: WIN_FILL }} aria-hidden="true" />
          {wins} {wins === 1 ? "win" : "wins"}
        </span>
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          <span className="size-[7px] rounded-full" style={{ background: LOSS_FILL }} aria-hidden="true" />
          {losses} {losses === 1 ? "loss" : "losses"}
        </span>
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          <span className="size-[7px] rounded-full" style={{ background: TIE_FILL }} aria-hidden="true" />
          {ties} {ties === 1 ? "tie" : "ties"}
        </span>
      </div>
      <span className="sr-only">
        {games === 0
          ? "No resolved games yet"
          : `${wins} ${wins === 1 ? "win" : "wins"}, ${losses} ${losses === 1 ? "loss" : "losses"}, and ${ties} ${ties === 1 ? "tie" : "ties"} across ${games} ${games === 1 ? "game" : "games"}`}
      </span>
    </div>
  );
}

/**
 * Length is how much of the season this row is; the split inside it is how that
 * went. One mark, both questions.
 */
export function BucketBar({ row, maxGames }: { row: VolumeParts; maxGames: number }) {
  const share = maxGames > 0 ? (row.games / maxGames) * 100 : 0;

  return (
    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
      <div className="flex h-full" style={{ width: `${Math.max(share, row.games > 0 ? 3 : 0)}%` }}>
        {row.wins > 0 ? <div className="h-full min-w-0 flex-1" style={{ flexGrow: row.wins, background: WIN_FILL }} /> : null}
        {row.losses > 0 ? <div className="h-full min-w-0 flex-1" style={{ flexGrow: row.losses, background: LOSS_FILL }} /> : null}
        {row.ties > 0 ? <div className="h-full min-w-0 flex-1" style={{ flexGrow: row.ties, background: TIE_FILL }} /> : null}
      </div>
    </div>
  );
}

function rankTone(rank: number): string {
  if (rank === 1) return "border-foreground/20 bg-foreground text-background";
  if (rank === 2) return "border-border bg-muted text-foreground";
  if (rank === 3) return "border-border bg-background text-foreground";
  return "border-transparent bg-transparent text-muted-foreground";
}

export function RankMark({ rank }: { rank: number }) {
  return (
    <span
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-full border text-xs font-semibold tabular-nums",
        rankTone(rank),
      )}
      aria-label={`Rank ${rank}`}
    >
      {rank === 1 ? <Trophy className="size-3.5" aria-hidden="true" /> : rank}
    </span>
  );
}

export function ScoreboardDataRegion({
  children,
  refreshing,
}: {
  children: ReactNode;
  refreshing?: boolean;
}) {
  return (
    <div
      aria-busy={refreshing || undefined}
      className={cn(
        "transition-opacity duration-200 motion-reduce:transition-none",
        refreshing && "opacity-60",
      )}
    >
      {children}
    </div>
  );
}
