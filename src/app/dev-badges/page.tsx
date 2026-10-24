import { notFound } from "next/navigation";
import BadgesLab from "./BadgesLab";

// Dev-only: renders the team badge gallery in the real app chrome with sample
// data built from the seeded catalog, so it can be reviewed without a database.
// /dev-badges?role=STUDENT|STAFF|ADMIN&tab=gallery|team|award&theme=dark&peers=off
export default function DevBadgesPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <BadgesLab />;
}
