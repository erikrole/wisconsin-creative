import { PageHeader } from "@/components/PageHeader";
import TeamScoreboardClient from "./TeamScoreboardClient";

export default function ScoreboardPage() {
  return (
    <>
      <PageHeader
        title="Scoreboard"
        description="The season so far: the team record, who worked it, and the stories in the numbers. Tap anything to dig in."
        className="mb-5"
      />
      <TeamScoreboardClient />
    </>
  );
}
