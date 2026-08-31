import { Role } from "@prisma/client";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { badgesEnabled } from "@/lib/badges";
import BadgesClient from "./BadgesClient";

export default async function BadgesPage() {
  const user = await requireAuth();

  if (user.role !== Role.ADMIN && user.role !== Role.STAFF) {
    redirect("/");
  }

  return (
    <BadgesClient
      isAdmin={user.role === Role.ADMIN}
      badgesAvailable={badgesEnabled()}
    />
  );
}
