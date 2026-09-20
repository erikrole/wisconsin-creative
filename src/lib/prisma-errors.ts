import { Prisma } from "@prisma/client";

/* Server-side Prisma error classification shared by booking mutations. */

function prismaErrorText(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const meta = typeof error === "object" && error && "meta" in error
    ? JSON.stringify((error as { meta?: unknown }).meta ?? {})
    : "";
  return `${message} ${meta}`;
}

/** True when Postgres rejected an asset allocation for overlapping a live checkout. */
export function isBookingAllocationConstraintError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  const text = prismaErrorText(error);

  if (code === "23P01" || text.includes("asset_allocations_no_overlap")) {
    return true;
  }

  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  if (error.code === "P2002") {
    const target = (error.meta?.target as string[] | string | undefined) ?? "";
    const targetStr = Array.isArray(target) ? target.join(",") : String(target);
    return (
      targetStr.includes("asset_allocations_asset_id_active_unique") ||
      targetStr.includes("asset_id")
    );
  }

  return error.code === "P2004" && text.includes("asset_allocations");
}
