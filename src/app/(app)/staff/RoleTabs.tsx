import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ListResponse } from "./types";

type Stats = NonNullable<ListResponse["stats"]>;

const TABS: { value: string; label: string; count: (stats: Stats) => number }[] = [
  { value: "", label: "All", count: (s) => s.byRole.STUDENT + s.byRole.STAFF + s.byRole.ADMIN + s.byRole.COLLABORATOR },
  { value: "STUDENT", label: "Students", count: (s) => s.byRole.STUDENT },
  { value: "STAFF", label: "Staff", count: (s) => s.byRole.STAFF },
  { value: "ADMIN", label: "Admins", count: (s) => s.byRole.ADMIN },
  { value: "COLLABORATOR", label: "Collaborators", count: (s) => s.byRole.COLLABORATOR },
];

/** One-tap role breakdown with live counts; replaces the role dropdown and the metric cards. */
export default function RoleTabs({
  value,
  stats,
  onChange,
}: {
  value: string;
  stats: Stats | undefined;
  onChange: (role: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(next) => onChange(next ?? "")}
        aria-label="Filter by role"
        className="min-w-max"
      >
        {TABS.map((tab) => {
          const count = stats ? tab.count(stats) : null;
          return (
            <ToggleGroupItem key={tab.value || "all"} value={tab.value} aria-label={tab.label}>
              {tab.label}
              {count !== null && (
                <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">{count}</span>
              )}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
    </div>
  );
}
