import type { GearPickFitKey } from "./catalog";

/** Client-safe response shapes for /api/gear-picks/*. Dates are ISO strings. */

export type GearPickCycleDto = {
  id: string;
  title: string;
  deadline: string | null;
  isOpen: boolean;
};

export type GearPickLineDto = {
  sku: string;
  style: string;
  colorCode: string;
  size: string | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  /** Resolved from the catalog for display; falls back to the SKU if it was removed. */
  itemName: string;
  colorLabel: string;
  category: string | null;
};

export type GearPickSubmissionDto = {
  version: number;
  totalCents: number;
  submittedAt: string | null;
  updatedAt: string;
  lines: GearPickLineDto[];
};

export type GearPickParticipantDto = {
  id: string;
  fit: GearPickFitKey;
  allowanceCents: number;
};

export type GearPicksMeResponse = {
  cycle: GearPickCycleDto | null;
  participant: GearPickParticipantDto | null;
  submission: GearPickSubmissionDto | null;
  profile: {
    topSize: string | null;
    topSizeFit: "UNISEX" | "WOMENS" | "MENS" | null;
    shoeSize: string | null;
    shoeSizeSystem: "US_WOMENS" | "US_MENS" | null;
  };
  isAdmin: boolean;
};

export type GearPickSubmissionStatus = "NOT_STARTED" | "DRAFT" | "SUBMITTED";

export type GearPickAdminParticipant = GearPickParticipantDto & {
  user: { id: string; name: string; email: string; active: boolean; topSize: string | null; shoeSize: string | null };
  status: GearPickSubmissionStatus;
  submission: GearPickSubmissionDto | null;
};

export type GearPickAggregateRow = {
  sku: string;
  itemName: string;
  colorLabel: string;
  size: string | null;
  quantity: number;
  totalCents: number;
};

export type GearPicksAdminResponse = {
  cycle: GearPickCycleDto;
  participants: GearPickAdminParticipant[];
  totals: GearPickAggregateRow[];
  summary: {
    participantCount: number;
    submittedCount: number;
    draftCount: number;
    notStartedCount: number;
    totalCents: number;
  };
  candidates: { id: string; name: string; role: string }[];
};
