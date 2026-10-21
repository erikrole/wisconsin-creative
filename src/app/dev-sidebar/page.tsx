import { notFound } from "next/navigation";
import SidebarLab from "./SidebarLab";

// Dev-only: renders the real sidebar with a fake user so it can be reviewed without a database.
export default function DevSidebarPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <SidebarLab />;
}
