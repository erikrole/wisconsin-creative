export type SerializedItem = {
  id: string;
  allocationStatus?: string;
  asset: {
    id: string;
    assetTag: string;
    name?: string | null;
    brand: string;
    model: string;
    serialNumber: string;
    type: string;
    imageUrl?: string | null;
    qrCodeValue?: string | null;
    primaryScanCode?: string | null;
    location?: { id: string; name: string };
  };
};

export type BulkItem = {
  id: string;
  plannedQuantity: number;
  checkedOutQuantity: number;
  checkedInQuantity: number;
  bulkSku: { id: string; name: string; category: string; unit: string; imageUrl?: string | null; trackByNumber?: boolean };
  unitAllocations?: Array<{ bulkSkuUnit: { unitNumber: number; status: string } }>;
};

export type AuditEntry = {
  id: string;
  action: string;
  createdAt: string;
  beforeJson: Record<string, unknown> | null;
  afterJson: Record<string, unknown> | null;
  actor: { id: string; name: string } | null;
};

import type { Location } from "@/types/common";
export type LocationInfo = Location;

export type BookingDetail = {
  id: string;
  kind: "RESERVATION" | "CHECKOUT";
  title: string;
  refNumber: string | null;
  status: string;
  custodyScope: "PERSON" | "SHARED";
  startsAt: string;
  endsAt: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  location: LocationInfo;
  requester: { id: string; name: string; email: string; avatarUrl?: string | null; role?: string };
  creator?: { id: string; name: string; email: string; avatarUrl?: string | null };
  serializedItems: SerializedItem[];
  bulkItems: BulkItem[];
  isOverdue: boolean;
  isActive: boolean;
  bookingType: string;
  auditLogs: AuditEntry[];
  hasMoreAuditLogs?: boolean;
  auditLogNextCursor?: string | null;
  itemLocations: LocationInfo[];
  locationMode: "SINGLE" | "MIXED";
  allowedActions?: string[];
  sourceReservation?: { id: string; refNumber: string | null; title: string } | null;
  event?: { id: string; summary: string; sportCode: string | null; opponent: string | null; isHome: boolean | null } | null;
  /** All events linked to this booking (1..3), sorted chronologically by ordinal.
   *  When only one event is linked it will match `event` above. */
  events?: Array<{
    id: string;
    summary: string;
    sportCode: string | null;
    opponent: string | null;
    isHome: boolean | null;
    startsAt: string;
    endsAt: string;
  }>;
  sportCode?: string | null;
  shiftAssignment?: {
    id: string;
    userId?: string;
    status?: string;
    source?: string;
    callStartsAt?: string | null;
    callEndsAt?: string | null;
    callNote?: string | null;
    shift: {
      id?: string;
      area: string;
      workerType?: string;
      startsAt?: string;
      endsAt?: string;
      callStartsAt?: string | null;
      callEndsAt?: string | null;
      shiftGroup?: {
        eventId?: string;
        publishedAt?: string | null;
        workingCopy?: { shiftGroupId: string } | null;
      };
    };
  } | null;
  scheduleStatus?: "scheduled" | "needs_review" | "not_applicable";
  scheduleStatusReason?: string | null;
  kit?: { id: string; name: string } | null;
  pickupKioskDevice?: { id: string; name: string; location: { id: string; name: string } } | null;
  photos?: BookingPhoto[];
};

export type BookingPhoto = {
  id: string;
  phase: "CHECKOUT" | "CHECKIN";
  imageUrl: string;
  createdAt: string;
  actor: { id: string; name: string };
};

export type AvailableAsset = {
  id: string;
  assetTag: string;
  brand: string;
  model: string;
  locationId: string;
  imageUrl?: string | null;
};

export type BulkSkuOption = {
  id: string;
  name: string;
  category: string;
  unit: string;
  locationId: string;
  currentQuantity?: number;
};

export type ConflictData = {
  conflicts?: Array<{
    assetId: string;
    conflictingBookingId: string;
    conflictingBookingTitle?: string;
    startsAt: string;
    endsAt: string;
  }>;
};

export type TabKey = "details" | "equipment" | "history";

export type HistoryFilter = "all" | "booking" | "equipment";

export type CheckinProgress = {
  returned: number;
  total: number;
  percent: number;
};
