import { PageHeader } from "@/components/PageHeader";
import TeamScoreboardClient from "./TeamScoreboardClient";

export default function ScoreboardPage() {
  return (
    <>
      <PageHeader
        title="Scoreboard"
        description="Current-season coverage, the official record, and who worked. Stack sport, venue, opponent, and site filters."
        className="mb-5"
      />
      <TeamScoreboardClient />
    </>
  );
}
