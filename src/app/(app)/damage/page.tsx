import { Role } from "@prisma/client";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { DamageCasesView } from "./DamageCasesView";

export const metadata = { title: "Damage and loss" };

/** Staff triage for damaged and missing gear reported at return. */
export default async function DamagePage() {
  const user = await requireAuth();
  if (user.role !== Role.ADMIN && user.role !== Role.STAFF) redirect("/");
  return <DamageCasesView />;
}
