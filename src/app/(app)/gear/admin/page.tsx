import { Role } from "@prisma/client";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { GearPicksAdmin } from "./GearPicksAdmin";

export const metadata = { title: "UA gear pick results" };

/** Admin-only results for UA staff gear picks: roster, deadline, lines, totals, and CSV. */
export default async function GearPicksAdminPage() {
  const user = await requireAuth();
  if (user.role !== Role.ADMIN) redirect("/gear");
  return <GearPicksAdmin />;
}
