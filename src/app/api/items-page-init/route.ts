import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { cachedOk } from "@/lib/http";
import { requirePermissionOrCollaboratorCapability } from "@/lib/rbac";
import { settledReader } from "@/lib/settled";

const settledValue = settledReader("items-page-init");

/**
 * Consolidated endpoint for the items list page.
 * Returns user role, locations, departments, categories, and brands
 * in a single round-trip instead of 4 separate fetches.
 */
export const GET = withAuth(async (_req, { user }) => {
  requirePermissionOrCollaboratorCapability(user, "asset", "view", "GEAR_CATALOG_VIEW");
  const isCollaborator = user.role === "COLLABORATOR";
  const [
    locationsResult,
    departmentsResult,
    categoriesResult,
    brandRowsResult,
    kitsResult,
  ] = await Promise.allSettled([
    db.location.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    isCollaborator ? Promise.resolve([]) : db.department.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.category.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, parentId: true },
    }),
    isCollaborator ? Promise.resolve([]) : db.asset.groupBy({
      by: ["brand"],
      where: { brand: { not: "" } },
      orderBy: { brand: "asc" },
    }),
    isCollaborator ? Promise.resolve([]) : db.kit.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  const partialFailures: string[] = [];
  const locations = settledValue(locationsResult, [] as Array<{ id: string; name: string }>, "locations", partialFailures);
  const departments = settledValue(departmentsResult, [] as Array<{ id: string; name: string }>, "departments", partialFailures);
  const categories = settledValue(categoriesResult, [] as Array<{ id: string; name: string; parentId: string | null }>, "categories", partialFailures);
  const brandRows = settledValue(brandRowsResult, [] as Array<{ brand: string }>, "brands", partialFailures);
  const kits = settledValue(kitsResult, [] as Array<{ id: string; name: string }>, "kits", partialFailures);

  return cachedOk({
    data: {
      user: { role: user.role },
      locations,
      departments,
      categories,
      brands: brandRows.map((r) => r.brand),
      kits,
    },
    partialFailures,
  });
});
