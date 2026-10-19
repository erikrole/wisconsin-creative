import { Role } from "@prisma/client";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import WorkforceNav from "./WorkforceNav";

/** Admin-only for the whole Workforce area (D-065). */
export default async function WorkforceLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuth();
  if (user.role !== Role.ADMIN) redirect("/");
  return (
    <>
      <WorkforceNav />
      {children}
    </>
  );
}
