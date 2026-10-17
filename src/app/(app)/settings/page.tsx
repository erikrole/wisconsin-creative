import { requireAuth } from "@/lib/auth";
import { canViewUsageAnalytics } from "@/lib/usage-analytics";
import { SettingsDirectory } from "./SettingsDirectory";

export default async function SettingsPage() {
  const user = await requireAuth();
  return (
    <SettingsDirectory
      role={user.role}
      canViewUsageAnalytics={canViewUsageAnalytics(user)}
    />
  );
}
