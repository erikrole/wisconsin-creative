"use client";

import StaffProfilePage from "@/app/(app)/staff/[id]/page";
import LabShell, { type LabRoute } from "@/app/dev-lab/LabShell";

const at = (days: number, hour: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

const USER = {
  id: "u-maddy",
  name: "Maddy Pehler",
  email: "mpehler@wisc.edu",
  role: "STUDENT",
  staffingType: "ST",
  phone: "608-555-0142",
  personalPhone: "608-555-0142",
  workPhone: null,
  workPhoneNotApplicable: true,
  wiscardNumber: null,
  wiscardCardNumber: null,
  wiscardIssueCode: null,
  slackHandle: "maddy.p",
  slackProfileUrl: null,
  primaryArea: "VIDEO",
  locationId: "loc-camp",
  location: "Camp Randall",
  avatarUrl: null,
  active: true,
  title: null,
  gradYear: 2027,
  graduationTerm: "SPRING",
  studentYearOverride: null,
  lastActiveAt: at(0, 9),
  createdAt: "2025-08-20T15:00:00Z",
  sportAssignments: [{ id: "sa1", sportCode: "FB", createdAt: "2025-08-20T15:00:00Z" }, { id: "sa2", sportCode: "WVB", createdAt: "2025-08-20T15:00:00Z" }],
  areaAssignments: [{ id: "aa1", area: "VIDEO", isPrimary: true, createdAt: "2025-08-20T15:00:00Z" }],
  gameRecord: { eventsWorked: 23, wins: 15, losses: 7, ties: 1, bySport: [], bySite: [] },
  athleticsEmail: null,
  startDate: "2025-08-25",
  directReportId: "dev",
  directReportName: "Erik Role",
  directReport: { id: "dev", name: "Erik Role" },
  topSize: "M",
  topSizeFit: "UNISEX",
  bottomSize: "M",
  shoeSize: "8",
  shoeSizeSystem: "US_WOMENS",
  birthdayMonth: 4,
  birthdayDay: 12,
  hasIcsToken: false,
};

const RIGHT_NOW = {
  nextShift: { summary: "Football vs. Iowa", location: "Camp Randall", area: "VIDEO", startsAt: at(1, 9), endsAt: at(1, 15), live: false },
  holding: [{ id: "bk-1", title: "Football vs. Iowa", dueAt: at(1, 17), overdue: false }],
  week: [
    { summary: "Volleyball vs. Nebraska", area: "VIDEO", startsAt: at(0, 16), endsAt: at(0, 21) },
    { summary: "Football vs. Iowa", area: "VIDEO", startsAt: at(1, 9), endsAt: at(1, 15) },
  ],
  performance: { checkouts: 31, onTimeRate: 94 },
};

const BADGES = [
  { key: "iron_man", earned: true, active: true, name: "Iron Man", icon: "flame", awardedAt: at(-3, 12), progressCurrent: 10, progressTarget: 10 },
  { key: "on_time", earned: true, active: true, name: "On time", icon: "clock", awardedAt: at(-20, 12), progressCurrent: 20, progressTarget: 20 },
  { key: "road_warrior", earned: false, active: true, name: "Road warrior", icon: "bus", awardedAt: null, progressCurrent: 3, progressTarget: 5 },
];

const route: LabRoute = (url) => {
  if (url.pathname === "/api/users/u-maddy") return { data: USER };
  if (url.pathname === "/api/users/u-maddy/right-now") return { data: RIGHT_NOW };
  if (url.pathname.startsWith("/api/badges/user/")) return { data: { badges: BADGES } };
  if (url.pathname === "/api/form-options") return { data: { locations: [{ id: "loc-camp", name: "Camp Randall" }] } };
  if (url.pathname === "/api/shifts/my-hours") return { data: null };
  if (url.pathname === "/api/shifts/ics-token") return { data: null };
  if (url.pathname === "/api/collaborator-affiliations") return { data: [] };
  if (url.pathname.startsWith("/api/gear-picks/")) return new Response(null, { status: 403 });
  if (url.pathname === "/api/me/sidebar-prefs") return { data: null };
  return undefined;
};

export default function ProfileLab({ fontClass }: { fontClass: string }) {
  return (
    <LabShell fontClass={fontClass} route={route}>
      <StaffProfilePage />
    </LabShell>
  );
}
