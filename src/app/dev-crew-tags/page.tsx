import { notFound } from "next/navigation";
import CrewTagsLab from "./CrewTagsLab";

// Dev-only: renders the position label editor against fixture crew so it can be reviewed without a database.
export default function DevCrewTagsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <CrewTagsLab />;
}
