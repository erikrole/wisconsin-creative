import { withAuth } from "@/lib/api";
import { handleOpenShiftPickup } from "../pickup/handler";

// Compatibility alias for older web/native clients. New UI calls `/pickup`.
// Both routes intentionally file the same approval-first REQUESTED claim; keep
// this alias until installed old clients no longer call it.
export const POST = withAuth(handleOpenShiftPickup);
