import { z } from "zod";
import { normalizeProfilePhone, profilePhoneSchema } from "@/lib/profile-phone";

export const ONBOARDING_GROUP_FIELDS = {
  EMAIL: ["athleticsEmail"],
  PERSONAL_PHONE: ["personalPhone"],
  WORK_PHONE: ["workPhone", "workPhoneNotApplicable"],
  WISCARD: ["wiscardCardNumber", "wiscardIssueCode"],
  STUDENT: ["studentYearOverride"],
  GRADUATION: ["graduationTerm", "gradYear"],
  CLOTHING: ["topSizeFit", "topSize"],
  SHOES: ["shoeSizeSystem", "shoeSize"],
} as const;

export type OnboardingGroup = keyof typeof ONBOARDING_GROUP_FIELDS;
export type OnboardingValues = Record<string, string | number | boolean | null>;
const phone = profilePhoneSchema.transform((value) => normalizeProfilePhone(value)!).nullable();
const size = z.string().trim().min(1).max(40).nullable();
const year = new Date().getFullYear();
export const onboardingGroupSchemas = {
  EMAIL: z.object({ athleticsEmail: z.string().trim().toLowerCase().email().max(255).endsWith("@athletics.wisc.edu").nullable() }).strict(),
  PERSONAL_PHONE: z.object({ personalPhone: phone }).strict(),
  WORK_PHONE: z.object({ workPhone: phone, workPhoneNotApplicable: z.boolean() }).strict(),
  WISCARD: z.object({ wiscardCardNumber: z.string().regex(/^\d{10}$/).nullable(), wiscardIssueCode: z.string().regex(/^\d$/).nullable() }).strict(),
  STUDENT: z.object({ studentYearOverride: z.enum(["FRESHMAN", "SOPHOMORE", "JUNIOR", "SENIOR", "GRAD"]).nullable() }).strict(),
  GRADUATION: z.object({ graduationTerm: z.enum(["SPRING", "SUMMER", "FALL", "WINTER"]).nullable(), gradYear: z.number().int().min(year - 1).max(year + 10).nullable() }).strict()
    .refine((value) => (value.graduationTerm === null) === (value.gradYear === null), "Choose both graduation fields"),
  CLOTHING: z.object({ topSizeFit: z.enum(["UNISEX", "MENS", "WOMENS"]).nullable(), topSize: size }).strict(),
  SHOES: z.object({ shoeSizeSystem: z.enum(["US_MENS", "US_WOMENS"]).nullable(), shoeSize: size }).strict()
    .refine((value) => value.shoeSize === null || value.shoeSizeSystem !== null, "Choose shoe sizing first"),
};

export const onboardingSaveSchema = z.object({
  step: z.literal("SAVE"),
  group: z.enum(Object.keys(ONBOARDING_GROUP_FIELDS) as [OnboardingGroup, ...OnboardingGroup[]]),
  expectedVersion: z.string().regex(/^[a-f0-9]{64}$/),
  values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
}).strict();

export function groupValues(profile: object, group: OnboardingGroup): OnboardingValues {
  const values = profile as OnboardingValues;
  return Object.fromEntries(ONBOARDING_GROUP_FIELDS[group].map((key) => [key, values[key] ?? null]));
}

export function sameGroup(a: OnboardingValues, b: OnboardingValues): boolean {
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((key) => a[key] === b[key]);
}
