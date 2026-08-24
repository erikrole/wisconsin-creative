import {
  STUDENT_YEAR_OPTIONS as SHARED_STUDENT_YEAR_OPTIONS,
  type GraduationTermValue,
  type StudentYearValue,
} from "@/lib/student-profile";

export type Role = "ADMIN" | "STAFF" | "STUDENT" | "COLLABORATOR";
export type StaffingType = "FT" | "ST";

export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  affiliation?: string | null;
  collaboratorProfile?: string | null;
  collaboratorPolicy?: {
    id: string;
    status: "ACTIVE" | "SUSPENDED";
    version: number;
    capabilities?: string[];
    affiliation: {
      key: string;
      displayName: string;
      badgeLabel: string;
    };
  } | null;
  staffingType: StaffingType;
  phone: string | null;
  wiscardNumber?: string | null;
  slackHandle: string | null;
  slackProfileUrl: string | null;
  primaryArea: string | null;
  locationId: string | null;
  location: string | null;
  avatarUrl: string | null;
  active?: boolean;
  hiddenFromRoster?: boolean;
  // Surfaced from migration 0048 so the list can display Title (staff) / Year (student).
  title: string | null;
  gradYear: number | null;
  studentYearOverride: StudentYear | null;
  lastActiveAt: string | null;
};

export type SportAssignment = {
  id: string;
  sportCode: string;
  createdAt: string;
};

export type AreaAssignment = {
  id: string;
  area: string;
  isPrimary: boolean;
  createdAt: string;
};

export type StudentYear = StudentYearValue;
export type GraduationTerm = GraduationTermValue;

export type UserDetail = UserRow & {
  createdAt: string | null;
  personalPhone: string | null;
  workPhone: string | null;
  workPhoneNotApplicable: boolean;
  wiscardCardNumber: string | null;
  wiscardIssueCode: string | null;
  sportAssignments: SportAssignment[];
  areaAssignments: AreaAssignment[];
  icsToken?: string | null;
  /** W-L-T tally across games this user held a shift assignment on. */
  gameRecord?: {
    eventsWorked: number;
    wins: number;
    losses: number;
    ties: number;
    bySport: Array<{ sportCode: string | null; wins: number; losses: number; ties: number }>;
    bySite: Array<{ site: "HOME" | "AWAY" | "NEUTRAL" | null; wins: number; losses: number; ties: number }>;
  } | null;
  // Profile fields migrated from the team Sheet.
  title: string | null;
  athleticsEmail: string | null;
  startDate: string | null;
  directReportId: string | null;
  directReportName: string | null;
  directReport: { id: string; name: string } | null;
  gradYear: number | null;
  graduationTerm: GraduationTerm | null;
  studentYearOverride: StudentYear | null;
  topSize: string | null;
  topSizeFit: "UNISEX" | "WOMENS" | "MENS" | null;
  bottomSize: string | null;
  shoeSize: string | null;
  shoeSizeSystem: "US_WOMENS" | "US_MENS" | null;
  birthdayMonth: number | null;
  birthdayDay: number | null;
  birthYear?: number | null;
};

export const STUDENT_YEAR_OPTIONS: { value: StudentYear; label: string }[] = [
  ...SHARED_STUDENT_YEAR_OPTIONS,
];

/**
 * Derive a student's current academic year. Override wins; otherwise inferred from
 * grad year using a Sept→Aug academic calendar (Aug+ counts as the next class year).
 */
export function deriveStudentYear(
  gradYear: number | null,
  override: StudentYear | null,
  now: Date = new Date(),
): StudentYear | null {
  if (override) return override;
  if (gradYear == null) return null;
  const month = now.getMonth(); // 0–11
  const acadYearEnd = month >= 7 ? now.getFullYear() + 1 : now.getFullYear();
  const yearsRemaining = gradYear - acadYearEnd;
  if (yearsRemaining <= -1) return "GRAD";
  if (yearsRemaining === 0) return "SENIOR";
  if (yearsRemaining === 1) return "JUNIOR";
  if (yearsRemaining === 2) return "SOPHOMORE";
  if (yearsRemaining >= 3) return "FRESHMAN";
  return null;
}

export type { Location } from "@/types/common";

export type ListResponse = {
  data: UserRow[];
  total: number;
  limit: number;
  offset: number;
  stats?: {
    total: number;
    active: number;
    inactive: number;
    missingPhotos: number;
    byRole: Record<Role, number>;
  };
};

export type SortKey =
  | "name"
  | "name_desc"
  | "role"
  | "role_desc"
  | "email"
  | "email_desc"
  | "lastActive"
  | "lastActive_desc"
  | "";

export const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "ADMIN", label: "Admin" },
  { value: "STAFF", label: "Staff" },
  { value: "STUDENT", label: "Student" },
  { value: "COLLABORATOR", label: "Collaborator" },
];

export const STAFFING_TYPE_OPTIONS: { value: StaffingType; label: string }[] = [
  { value: "FT", label: "Staff" },
  { value: "ST", label: "Student" },
];

export const AREA_LABELS: Record<string, string> = {
  VIDEO: "Video",
  PHOTO: "Photo",
  GRAPHICS: "Graphics",
  SOCIAL: "Social",
  COMMS: "Communications",
  LIVE_PRODUCTION: "Live Production",
};

export const AREA_OPTIONS = Object.entries(AREA_LABELS).map(([value, label]) => ({
  value,
  label,
}));
