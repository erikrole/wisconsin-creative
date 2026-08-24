import { PageHeader } from "@/components/PageHeader";
import TeamScoreboardClient from "./TeamScoreboardClient";

export default function ScoreboardPage() {
  return (
    <>
      <PageHeader
        title="Scoreboard"
        description="Team records, work totals, and per-person leaderboards. Stack sport, venue, opponent, and site filters."
        className="mb-5"
      />
      <TeamScoreboardClient />
    </>
  );
}
