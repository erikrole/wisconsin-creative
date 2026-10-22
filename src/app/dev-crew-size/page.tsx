import { notFound } from "next/navigation";
import CrewSizeLab from "./CrewSizeLab";

// Dev-only: renders the Crew size dialog against fixture slots so it can be reviewed without a database.
export default function DevCrewSizePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <CrewSizeLab />;
}
