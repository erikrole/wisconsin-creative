"use client";

import { PageHeader } from "@/components/PageHeader";
import UtilizationPage from "@/app/(app)/reports/utilization/page";
import { ReportsNav } from "@/app/(app)/reports/ReportsNav";
import LabShell, { type LabRoute } from "@/app/dev-lab/LabShell";

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

const UTILIZATION = {
  activeAssets: 183,
  days: 90,
  partialFailures: [],
  totalAssets: 201,
  statusCounts: { AVAILABLE: 142, CHECKED_OUT: 23, RESERVED: 11, MAINTENANCE: 3, RETIRED: 18, PENDING_PICKUP: 4 },
  byLocation: [
    { location: "Equipment cage", locationId: "loc-cage", count: 128 },
    { location: "Camp Randall", locationId: "loc-camp", count: 41 },
    { location: "Kohl Center", locationId: "loc-kohl", count: 32 },
  ],
  byType: [{ type: "Camera", count: 38 }, { type: "Lens", count: 64 }, { type: "Audio", count: 52 }, { type: "Drone", count: 6 }],
  byCategory: [
    { category: "Lenses", categoryId: "cat-lens", count: 64 },
    { category: "Audio", categoryId: "cat-audio", count: 52 },
    { category: "Cameras", categoryId: "cat-cam", count: 38 },
    { category: "Drones", categoryId: "cat-drone", count: 6 },
  ],
  byDepartment: [{ department: "Video", departmentId: "dep-video", count: 121 }, { department: "Photo", departmentId: "dep-photo", count: 80 }],
  custody: {
    assetsUsed: 131,
    checkoutCount: 412,
    custodyDays: 2184,
    idleCount: 52,
    idlePricedCount: 31,
    idleValue: 48210,
    neverCheckedOutCount: 9,
    utilizationRate: 0.132,
    idleAssets: [
      { assetId: "a1", assetTag: "600 1", category: "Lenses", lastCheckedOutAt: daysAgo(140), name: "Sony FE 600mm f/4 GM", purchasePrice: 12998 },
      { assetId: "a2", assetTag: "MAVIC3", category: "Drones", lastCheckedOutAt: daysAgo(210), name: "DJI Mavic 3 Cine", purchasePrice: 4999 },
      { assetId: "a3", assetTag: "RONIN2", category: "Cameras", lastCheckedOutAt: null, name: "DJI Ronin 2", purchasePrice: 3999 },
      { assetId: "a4", assetTag: "WMIC-4", category: "Audio", lastCheckedOutAt: daysAgo(98), name: "Sony UWP-D21 wireless", purchasePrice: 649 },
    ],
    topUsed: [
      ["FX6-A", "Sony FX6", 31, 74, 0.82],
      ["70-200 3", "Sony FE 70-200mm GM II", 28, 66, 0.73],
      ["FX3-1", "Sony FX3", 24, 51, 0.57],
      ["A7S3-2", "Sony a7S III", 19, 43, 0.48],
      ["MKH416-2", "Sennheiser MKH 416", 17, 30, 0.33],
    ].map(([assetTag, name, checkouts, custodyDays, utilizationRate], index) => ({
      assetId: `t${index}`, assetTag, name, checkouts, custodyDays, utilizationRate,
    })),
  },
};

const route: LabRoute = (url) => {
  if (url.pathname === "/api/reports/utilization") return { data: UTILIZATION, ...UTILIZATION };
  return undefined;
};

export default function ReportsLab({ fontClass }: { fontClass: string }) {
  // Mirrors reports/layout.tsx, which is a server component and can't render here.
  return (
    <LabShell fontClass={fontClass} route={route}>
      <PageHeader title="Reports" className="mb-4" />
      <ReportsNav role="ADMIN" canViewUsageAnalytics />
      <UtilizationPage />
    </LabShell>
  );
}
