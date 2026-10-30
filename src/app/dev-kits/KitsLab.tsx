"use client";

import KitsPage from "@/app/(app)/kits/page";
import LabShell, { type LabRoute } from "@/app/dev-lab/LabShell";

const LOCATIONS = [{ id: "loc-camp", name: "Camp Randall" }, { id: "loc-kohl", name: "Kohl Center" }, { id: "loc-cage", name: "Equipment cage" }];

const KITS = [
  ["Sideline A", "Football sideline shooter: FX6, 70-200, monopod", "FB", "LOC_A", 0, 9, 3, 0],
  ["Sideline B", "Second sideline body with the 24-70", "FB", "LOC_B", 0, 8, 2, 1],
  ["Endzone", "Endzone high camera and tripod", "FB", null, 0, 6, 1, 0],
  ["Court roamer", "Gimbal kit for volleyball and basketball", "WVB", null, 1, 7, 2, 0],
  ["Postgame presser", "Two cams, shotgun mic and lights", null, null, 1, 5, 4, 0],
  ["Hockey glass", "Glass mount and wide lens", "MHKY", null, 1, 0, 0, 0],
].map(([name, description, sportCode, gamedayRole, loc, members, bulkMembers, unavailable], index) => ({
  id: `kit-${index}`,
  name, description, sportCode, gamedayRole,
  active: true,
  createdAt: "2025-08-01T12:00:00Z",
  updatedAt: new Date(Date.now() - (index + 1) * 86_400_000 * 3).toISOString(),
  location: LOCATIONS[loc as number]!,
  _count: { members, bulkMembers },
  availability: { serialized: members, unavailable },
}));

const route: LabRoute = (url) => {
  if (url.pathname === "/api/locations") return { data: LOCATIONS };
  if (url.pathname === "/api/kits") {
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const data = KITS.filter((kit) => !q || `${kit.name} ${kit.description}`.toLowerCase().includes(q));
    return { data, total: data.length, limit: 25, offset: 0, summary: { total: data.length, active: 6, archived: 2, empty: 1 } };
  }
  return undefined;
};

export default function KitsLab({ fontClass }: { fontClass: string }) {
  return (
    <LabShell fontClass={fontClass} route={route}>
      <KitsPage />
    </LabShell>
  );
}
