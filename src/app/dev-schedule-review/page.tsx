import { notFound } from "next/navigation";
import ScheduleReviewLab from "./ScheduleReviewLab";

// Dev-only: the Schedule list with pending trades and requests for an admin, no database.
export default function DevScheduleReviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ScheduleReviewLab />;
}
