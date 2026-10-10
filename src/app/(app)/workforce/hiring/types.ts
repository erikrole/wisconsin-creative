import type { ApplicantStanding, ApplicationStage, GraduationTerm, ShiftArea } from "@prisma/client";

export type CycleSummary = {
  id: string;
  label: string;
  term: GraduationTerm;
  year: number;
  status: "PLANNING" | "OPEN" | "CLOSED" | "ARCHIVED";
  closedAt: string | null;
  notes: string | null;
  slots: { area: ShiftArea; targetCount: number }[];
  stageCounts: Partial<Record<ApplicationStage, number>>;
};

export type BoardApplication = {
  id: string;
  applicantId: string;
  name: string;
  email: string | null;
  standing: ApplicantStanding | null;
  gradTerm: GraduationTerm | null;
  gradYear: number | null;
  location: string | null;
  hasPortfolio: boolean;
  stage: ApplicationStage;
  reviewed: boolean;
  hasInterview: boolean;
  summerAvailable: boolean | null;
  rawAreas: string[];
  primaryArea: ShiftArea | null;
  hasResume: boolean;
  ratingAverage: number | null;
  ratingCount: number;
  externalApplicationId: string | null;
  experienceSummary?: string | null;
  sourceLinks?: { label: string; url: string }[];
};

export type ApplicationDetail = {
  id: string;
  cycle: { id: string; label: string; status: string };
  stage: ApplicationStage;
  reviewed: boolean;
  interviewUrl: string | null;
  summerAvailable: boolean | null;
  rawAreas: string[];
  primaryArea: ShiftArea | null;
  fieldsExperience: string[];
  fieldsInterested: string[];
  softwareExperience: string[];
  externalApplicationId: string | null;
  invite: { id: string; claimed: boolean } | null;
  /** When personal data is due to be purged; null when not scheduled. */
  purgeOn: string | null;
  applicant: {
    id: string;
    name: string;
    standing: ApplicantStanding | null;
    gradTerm: GraduationTerm | null;
    gradYear: number | null;
    phone: string | null;
    location: string | null;
    portfolioUrl: string | null;
    socialHandles: string | null;
    emails: { email: string; isPrimary: boolean }[];
    hiredUserId: string | null;
    history: { id: string; stage: ApplicationStage; cycleLabel: string }[];
  };
  sourceLinks?: { label: string; url: string }[];
  documents: { id: string; kind: string; fileName: string; contentType: string; sizeBytes: number; createdAt: string }[];
  notes: { id: string; body: string; rating: number | null; createdAt: string; author: { id: string; name: string } | null }[];
};

export const AREA_OPTIONS: { value: ShiftArea; label: string }[] = [
  { value: "VIDEO", label: "Video" },
  { value: "PHOTO", label: "Photography" },
  { value: "GRAPHICS", label: "Graphic design" },
  { value: "SOCIAL", label: "Social" },
  { value: "COMMS", label: "Comms" },
  { value: "LIVE_PRODUCTION", label: "Live production" },
];

export const AREA_LABEL: Record<string, string> = Object.fromEntries(AREA_OPTIONS.map((a) => [a.value, a.label]));

/** Error text from an already-parsed JSON body (the body can only be read once). */
export function messageOf(json: unknown, fallback: string): string {
  if (json && typeof json === "object" && "error" in json && typeof (json as { error: unknown }).error === "string") {
    return (json as { error: string }).error;
  }
  return fallback;
}
