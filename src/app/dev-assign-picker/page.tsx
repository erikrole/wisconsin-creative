import { notFound } from "next/navigation";
import AssignPickerLab from "./AssignPickerLab";

// Dev-only: renders the crew assignment picker with fixture people so it can be reviewed without a database.
export default function DevAssignPickerPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AssignPickerLab />;
}
