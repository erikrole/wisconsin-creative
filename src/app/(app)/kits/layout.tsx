import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { requirePermission } from "@/lib/rbac";
import { HttpError } from "@/lib/http";

export default async function KitsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuth();
  try {
    requirePermission(user.role, "kit", "create");
  } catch (error) {
    if (error instanceof HttpError && error.status === 403) redirect("/");
    throw error;
  }
  return children;
}
