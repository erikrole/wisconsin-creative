import type { Role } from "./types";
import { Badge, type BadgeProps } from "@/components/ui/badge";

const ROLE_VARIANT: Record<Role, BadgeProps["variant"]> = {
  ADMIN: "purple",
  STAFF: "blue",
  STUDENT: "gray",
  COLLABORATOR: "blue",
};

/** Directory chips show Staff for Admins so operator rank is not advertised. */
export function publicDirectoryRole(role: Role): Role {
  return role === "ADMIN" ? "STAFF" : role;
}

export default function RoleBadge({
  role,
  affiliationLabel,
}: {
  role: Role;
  affiliationLabel?: string | null;
}) {
  const displayed = publicDirectoryRole(role);
  const affiliation = affiliationLabel?.trim() || null;
  const label =
    displayed === "COLLABORATOR"
      ? affiliation || "Collaborator"
      : displayed.charAt(0) + displayed.slice(1).toLowerCase();

  return (
    <Badge
      variant={ROLE_VARIANT[displayed]}
      style={{ fontFamily: "var(--font-heading)", fontWeight: 600, letterSpacing: "0.03em" }}
      aria-label={displayed === "COLLABORATOR" && affiliation ? `Collaborator, ${affiliation}` : undefined}
    >
      {label}
    </Badge>
  );
}
