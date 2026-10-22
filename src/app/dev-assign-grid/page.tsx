import { notFound } from "next/navigation";
import AssignGridLab from "./AssignGridLab";

// Dev-only: renders the Assign shifts month grid against fixture responses so it can be reviewed without a database.
export default function DevAssignGridPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AssignGridLab />;
}
