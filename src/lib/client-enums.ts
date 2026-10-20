/**
 * Browser-safe values for shared forms and display helpers.
 * Keep these in sync with Prisma through tests/client-enums.test.ts; importing
 * the generated Prisma client for enum values also loads its browser runtime.
 */
export const Role = {
  ADMIN: "ADMIN",
  STAFF: "STAFF",
  STUDENT: "STUDENT",
  COLLABORATOR: "COLLABORATOR",
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const ShiftArea = {
  VIDEO: "VIDEO",
  PHOTO: "PHOTO",
  GRAPHICS: "GRAPHICS",
  SOCIAL: "SOCIAL",
  COMMS: "COMMS",
  LIVE_PRODUCTION: "LIVE_PRODUCTION",
} as const;
export type ShiftArea = (typeof ShiftArea)[keyof typeof ShiftArea];

export const ResourceType = {
  CONTACTS: "CONTACTS",
  BUILDING_NUMBERS: "BUILDING_NUMBERS",
  MEDIA_DRIVE: "MEDIA_DRIVE",
  SERVER_PATHS: "SERVER_PATHS",
  SOP: "SOP",
  HOW_TO: "HOW_TO",
  TROUBLESHOOTING: "TROUBLESHOOTING",
  ACCOUNT_NOTE: "ACCOUNT_NOTE",
  EVENT_OPS: "EVENT_OPS",
  GENERAL: "GENERAL",
} as const;
export type ResourceType = (typeof ResourceType)[keyof typeof ResourceType];

export const ResourceAssetKind = {
  LOGO: "LOGO",
  FONT: "FONT",
  GRAPHIC_ELEMENT: "GRAPHIC_ELEMENT",
  TEMPLATE: "TEMPLATE",
  COLOR_REFERENCE: "COLOR_REFERENCE",
  PHOTO: "PHOTO",
  VIDEO: "VIDEO",
  DOCUMENT: "DOCUMENT",
  OTHER: "OTHER",
} as const;
export type ResourceAssetKind = (typeof ResourceAssetKind)[keyof typeof ResourceAssetKind];

export const SportAutoAssignPolicy = {
  FULL_CREW: "FULL_CREW",
  STAFF_ONLY: "STAFF_ONLY",
  HOLD: "HOLD",
} as const;
export type SportAutoAssignPolicy = (typeof SportAutoAssignPolicy)[keyof typeof SportAutoAssignPolicy];

export const ApplicantStanding = {
  INCOMING: "INCOMING",
  FRESHMAN: "FRESHMAN",
  SOPHOMORE: "SOPHOMORE",
  JUNIOR: "JUNIOR",
  SENIOR: "SENIOR",
  GRADUATE: "GRADUATE",
  OTHER: "OTHER",
} as const;
export type ApplicantStanding = (typeof ApplicantStanding)[keyof typeof ApplicantStanding];

export const ApplicationStage = {
  APPLIED: "APPLIED",
  ROUND_1: "ROUND_1",
  HIRE: "HIRE",
  PASSED: "PASSED",
  WITHDRAWN: "WITHDRAWN",
} as const;
export type ApplicationStage = (typeof ApplicationStage)[keyof typeof ApplicationStage];

export const GraduationTerm = {
  WINTER: "WINTER",
  SPRING: "SPRING",
  SUMMER: "SUMMER",
  FALL: "FALL",
} as const;
export type GraduationTerm = (typeof GraduationTerm)[keyof typeof GraduationTerm];
