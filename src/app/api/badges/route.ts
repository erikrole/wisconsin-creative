import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requireRole } from "@/lib/rbac";
import { badgesEnabled } from "@/lib/badges";
import { isHiddenUntilEarnedBadge } from "@/lib/badges/display";
import { listActiveBadgeDefinitions } from "@/lib/badges/queries";

export const GET = withAuth(async (req, { user }) => {
  requireRole(user.role, ["ADMIN", "STAFF", "STUDENT"]);
  if (!badgesEnabled()) {
    return ok({ data: [], disabled: true });
  }

  const { searchParams } = new URL(req.url);
  const manualOnly = searchParams.get("manualOnly") === "true";
  const definitions = (await listActiveBadgeDefinitions(manualOnly ? { trigger: "manual" } : undefined))
    // The catalog listing is the one badge surface with no client-side hidden
    // filter, so it handed every signed-in user the name and description of
    // each unearned easter egg. A surprise is only hidden if the API keeps it.
    .filter((definition) => !isHiddenUntilEarnedBadge(definition.key));

  return ok({
    data: definitions.map((definition) => ({
      id: definition.id,
      key: definition.key,
      name: definition.name,
      description: definition.description,
      icon: definition.icon,
      category: definition.category,
      kind: definition.kind,
      threshold: definition.threshold,
      ruleKey: definition.ruleKey,
      active: definition.active,
      sortOrder: definition.sortOrder,
    })),
  });
});
