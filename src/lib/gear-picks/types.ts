import type { GearPickFitKey, GearPickPhoneCatalog } from "./catalog";

/** Client-safe response shapes for /api/gear-picks/*. Dates are ISO strings. */

export type GearPickCycleDto = {
  id: string;
  title: string;
  deadline: string | null;
  isOpen: boolean;
  /** When admins opened picks to everyone on the list; null while only admins can see them. */
  launchedAt: string | null;
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

type GearPickParticipantDto = {
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
  /** Present only when the caller asks for it. The website already bundles the catalog. */
  catalog?: GearPickPhoneCatalog;
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
  students: GearPickAdminStudent[];
  studentCandidates: { id: string; name: string }[];
  /** Admin-only budget view. `committedCents` counts staff picks only for now. */
  budget: GearPickBudgetDto;
  order: GearPickOrderDto;
  receipts: GearPickReceiptDto[];
  handouts: GearPickHandoutDto[];
};

/** The order record. The Equipment department places the order; the site only records it. */
export type GearPickOrderDto = {
  placedAt: string | null;
  poNumber: string | null;
  orderNumber: string | null;
  expectedAt: string | null;
};

export type GearPickReceiptDto = {
  id: string;
  sku: string;
  size: string | null;
  quantity: number;
  receivedAt: string;
  note: string | null;
  receivedBy: string | null;
};

/** A Creative budget line that tops up the allotment. The amount lives only on the line. */
export type GearPickTopUpDto = {
  lineId: string;
  budgetId: string;
  budgetLabel: string;
  description: string;
  amountCents: number;
};

export type GearPickBudgetDto = {
  /** The Under Armour allotment for the year. */
  budgetCents: number;
  confirmed: boolean;
  /** Creative budget lines marked as counting toward this year, cancelled lines left out. */
  topUps: GearPickTopUpDto[];
  topUpCents: number;
  /** Allotment plus Creative top-ups: what the year can spend. */
  availableCents: number;
  /** Dollar total of every saved pick list, drafts included. */
  picksCents: number;
  /** Student kit price times the students on the roster. */
  studentKitsCents: number;
  studentKitCents: number;
  committedCents: number;
  remainingCents: number;
};

export type GearPickAdminStudent = {
  id: string;
  user: { id: string; name: string; active: boolean };
  topSize: string | null;
  topSizeFit: "UNISEX" | "WOMENS" | "MENS" | null;
  shoeSize: string | null;
  needsSize: boolean;
};

/** A piece handed out to a person. The key is the person, SKU, size and source. */
export type GearPickHandoutDto = {
  userId: string;
  sku: string;
  size: string;
  source: "STANDARD_ISSUE" | "CORE_KIT" | "STUDENT_KIT" | "PICK";
  quantity: number;
  handedOutAt: string;
};

/** A finished year, read-only. Money is in whole cents. */
export type GearPastCycleDto = {
  id: string;
  title: string;
  budgetCents: number;
  /** Spend the old sheet counted against the budget. */
  budgetedSpendCents: number;
  otherSpendCents: number;
  /** Budget minus budgeted spend. Negative means over budget. */
  remainingCents: number;
  note: string | null;
  items: {
    sku: string;
    itemName: string;
    colorLabel: string;
    unitPriceCents: number;
    plannedQty: number;
    orderedQty: number;
    receivedQty: number;
  }[];
  people: { name: string; groupLabel: string; fit: string; topSize: string | null; shoeSize: string | null }[];
};

/** One piece in the signed-in person's own kit, with whether it has been handed to them. */
export type GearMyKitPieceDto = {
  sku: string;
  itemName: string;
  colorLabel: string;
  source: "STANDARD_ISSUE" | "CORE_KIT" | "STUDENT_KIT" | "PICK";
  size: string;
  quantity: number;
  handed: boolean;
  handedOutAt: string | null;
};

/** What the signed-in person is getting this year and where it stands. Null when they are not on this year's list. */
export type GearMyKitDto = {
  cycleTitle: string;
  group: "Staff" | "Student";
  order: GearPickOrderDto;
  pieces: GearMyKitPieceDto[];
};
