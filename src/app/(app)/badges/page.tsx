import { Role } from "@prisma/client";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { badgesEnabled } from "@/lib/badges";
import BadgesClient from "./BadgesClient";

/**
 * The team badge gallery. Everyone who can earn badges browses it and compares
 * with teammates; staff and admins also get the Award tab. Collaborators have
 * no badges, so they go home.
 */
export default async function BadgesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requireAuth();

  if (user.role === Role.COLLABORATOR) {
    redirect("/");
  }

  const { tab } = await searchParams;
  const isStaff = user.role === Role.ADMIN || user.role === Role.STAFF;

  return (
    <BadgesClient
      isAdmin={user.role === Role.ADMIN}
      isStaff={isStaff}
      badgesAvailable={badgesEnabled()}
      initialTab={tab === "team" || tab === "award" ? tab : "gallery"}
    />
  );
}
