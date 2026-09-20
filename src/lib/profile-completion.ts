import type { GraduationTermValue, StudentYearValue } from "@/lib/student-profile";

const PROFILE_COMPLETION_STEPS = ["EMAIL", "PHONES", "WISCARD", "STUDENT", "APPAREL", "PHOTO"] as const;

export type ProfileCompletionStep = (typeof PROFILE_COMPLETION_STEPS)[number];
export type ProfileCompletionField =
  | "campusEmail"
  | "athleticsEmail"
  | "personalPhone"
  | "workPhone"
  | "wiscard"
  | "studentYear"
  | "anticipatedGraduation"
  | "clothingSize"
  | "shoeSize"
  | "photo";

type ProfileCompletionProfile = {
  id: string;
  name: string;
  role: "ADMIN" | "STAFF" | "STUDENT" | "COLLABORATOR";
  email: string;
  athleticsEmail: string | null;
  phone: string | null;
  personalPhone: string | null;
  workPhone: string | null;
  workPhoneNotApplicable: boolean;
  wiscardCardNumber: string | null;
  wiscardIssueCode: string | null;
  studentYearOverride: StudentYearValue | null;
  gradYear: number | null;
  graduationTerm: GraduationTermValue | null;
  topSizeFit: "UNISEX" | "WOMENS" | "MENS" | null;
  topSize: string | null;
  shoeSizeSystem: "US_WOMENS" | "US_MENS" | null;
  shoeSize: string | null;
  avatarUrl: string | null;
  profilePromptSnoozedUntil: Date | string | null;
  hiddenFromRoster?: boolean;
};

const FIELD_STEP: Record<ProfileCompletionField, ProfileCompletionStep> = {
  campusEmail: "EMAIL",
  athleticsEmail: "EMAIL",
  personalPhone: "PHONES",
  workPhone: "PHONES",
  wiscard: "WISCARD",
  studentYear: "STUDENT",
  anticipatedGraduation: "STUDENT",
  clothingSize: "APPAREL",
  shoeSize: "APPAREL",
  photo: "PHOTO",
};

const INTERNAL_OPERATIONAL_FIELDS: ProfileCompletionField[] = [
  "campusEmail",
  "athleticsEmail",
  "personalPhone",
  "workPhone",
  "wiscard",
];

function applicableProfileFields(role: ProfileCompletionProfile["role"]): ProfileCompletionField[] {
  if (role === "COLLABORATOR") return ["photo"];
  const fields: ProfileCompletionField[] = [
    "campusEmail",
    "athleticsEmail",
    "personalPhone",
    "workPhone",
    "wiscard",
    "clothingSize",
    "shoeSize",
    "photo",
  ];
  if (role === "STUDENT") {
    return [
      "campusEmail",
      "personalPhone",
      "wiscard",
      "studentYear",
      "anticipatedGraduation",
      "clothingSize",
      "shoeSize",
      "photo",
    ];
  }
  return fields;
}

export function visibleProfileSteps(role: ProfileCompletionProfile["role"]): ProfileCompletionStep[] {
  if (role === "COLLABORATOR") return ["PHOTO"];
  // Students aren't asked for an athletics email or work phone — the EMAIL
  // step has nothing left for them to fill in once athletics email drops off,
  // and PHONES already skips straight to a single personal-phone field below.
  return role === "STUDENT"
    ? PROFILE_COMPLETION_STEPS.filter((step) => step !== "EMAIL")
    : PROFILE_COMPLETION_STEPS.filter((step) => step !== "STUDENT");
}

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

export function isCampusLoginEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith("@wisc.edu");
}

function isAthleticsEmail(email: string | null | undefined): boolean {
  return Boolean(email?.trim().toLowerCase().endsWith("@athletics.wisc.edu"));
}

export function getProfileCompletion(profile: ProfileCompletionProfile, now = new Date()) {
  const completeByField: Record<ProfileCompletionField, boolean> = {
    campusEmail: isCampusLoginEmail(profile.email),
    athleticsEmail: isAthleticsEmail(profile.athleticsEmail),
    personalPhone: hasText(profile.personalPhone),
    workPhone: hasText(profile.workPhone) || profile.workPhoneNotApplicable,
    wiscard: hasText(profile.wiscardCardNumber) && hasText(profile.wiscardIssueCode),
    studentYear: profile.role !== "STUDENT" || Boolean(profile.studentYearOverride),
    anticipatedGraduation: profile.role !== "STUDENT" || Boolean(profile.gradYear && profile.graduationTerm),
    clothingSize: Boolean(profile.topSizeFit) && hasText(profile.topSize),
    shoeSize: Boolean(profile.shoeSizeSystem) && hasText(profile.shoeSize),
    photo: hasText(profile.avatarUrl),
  };
  const applicableFields = applicableProfileFields(profile.role);
  const operationalFields = profile.role === "COLLABORATOR"
    ? [] as ProfileCompletionField[]
    : profile.role === "STUDENT"
      ? INTERNAL_OPERATIONAL_FIELDS.filter((field) => field !== "workPhone" && field !== "athleticsEmail").concat("studentYear", "anticipatedGraduation")
      : INTERNAL_OPERATIONAL_FIELDS;
  const missingFields = applicableFields
    .filter((field) => !completeByField[field]);
  const completedCount = applicableFields.filter((field) => completeByField[field]).length;
  const snoozedUntil = profile.profilePromptSnoozedUntil
    ? new Date(profile.profilePromptSnoozedUntil)
    : null;
  const isSnoozed = Boolean(snoozedUntil && snoozedUntil.getTime() > now.getTime());
  const firstIncompleteStep = visibleProfileSteps(profile.role).find((step) =>
    missingFields.some((field) => FIELD_STEP[field] === step),
  ) ?? null;
  const operationalReady = operationalFields.every((field) => completeByField[field]);
  const profileComplete = missingFields.length === 0;
  const hiddenSmokeIdentity = profile.hiddenFromRoster === true;

  return {
    operationalReady: hiddenSmokeIdentity || operationalReady,
    profileComplete: hiddenSmokeIdentity || profileComplete,
    isComplete: hiddenSmokeIdentity || profileComplete,
    isSnoozed,
    shouldPrompt: !hiddenSmokeIdentity && missingFields.length > 0 && !isSnoozed,
    snoozedUntil: snoozedUntil?.toISOString() ?? null,
    completedCount: hiddenSmokeIdentity ? applicableFields.length : completedCount,
    totalCount: applicableFields.length,
    missingFields: hiddenSmokeIdentity ? [] : missingFields,
    firstIncompleteStep: hiddenSmokeIdentity ? null : firstIncompleteStep,
    completeByField,
  };
}
