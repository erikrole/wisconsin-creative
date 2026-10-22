import { notFound } from "next/navigation";
import AutoAssignLab from "./AutoAssignLab";

// Dev-only: renders Auto assign against fixture responses so it can be reviewed without a database.
export default function DevAutoAssignPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AutoAssignLab />;
}
