/* ── Shared types for Item Detail page and sub-components ── */

export type ActiveBookingDetail = {
  id: string;
  kind: string;
  status: string;
  title: string;
  startsAt: string;
  endsAt: string;
  requesterName: string;
  requesterAvatarUrl?: string | null;
};

export type UpcomingReservation = {
  bookingId: string;
  title: string;
  status: string;
  startsAt: string;
  endsAt: string;
  requesterName: string;
};

export type AssetDetail = {
  id: string;
  updatedAt: string;
  assetTag: string;
  name: string | null;
  type: string;
  brand: string;
  model: string;
  serialNumber: string | null;
  qrCodeValue: string;
  purchaseDate: string | null;
  purchasePrice: string | number | null;
  warrantyDate: string | null;
  residualValue: string | number | null;
  status: string;
  computedStatus: string;
  isFavorited: boolean;
  checkinReports?: Array<{
    id: string;
    type: "DAMAGED" | "LOST";
    description: string | null;
    imageUrl: string | null;
    createdAt: string;
    /** When the evidence last changed; a kiosk update moves it past createdAt. */
    lastReportedAt?: string;
    reportedBy: { name: string };
    booking: { id: string; title: string };
  }>;
  notes: string | null;
  linkUrl: string | null;
  imageUrl: string | null;
  location: { id: string; name: string };
  department: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
  availableForReservation: boolean;
  availableForCheckout: boolean;
  availableForCustody: boolean;
  metadata: Record<string, string> | null;
  activeBooking: ActiveBookingDetail | null;
  hasBookingHistory: boolean;
  parentAsset: { id: string; assetTag: string; name: string | null; brand: string; model: string } | null;
  firmwareWatch: {
    id: string;
    productName: string | null;
    brand: string;
    model: string;
    sourceUrl: string;
    supportMode: "ACTIVE" | "MAINTENANCE" | "UNKNOWN";
    supportNote: string | null;
    latestVersion: string | null;
    latestReleaseDate: string | null;
    lastCheckedAt: string | null;
    lastError: string | null;
  } | null;
  accessories: Array<{
    id: string;
    assetTag: string;
    name: string | null;
    brand: string;
    model: string;
    serialNumber: string | null;
    status: string;
    type: string;
    imageUrl: string | null;
  }>;
  upcomingReservations: UpcomingReservation[];
  history: Array<{
    id: string;
    createdAt: string;
    booking: {
      id: string;
      kind: "RESERVATION" | "CHECKOUT";
      status: string;
      title: string;
      startsAt: string;
      endsAt: string;
      sportCode?: string | null;
      requester: { name: string; avatarUrl?: string | null };
      location: { name: string };
      event?: {
        id: string;
        summary: string;
        sportCode: string | null;
        opponent: string | null;
        isHome: boolean | null;
        startsAt: string;
        endsAt: string;
      } | null;
    };
  }>;
};

export type { CategoryOption } from "@/types/category";

/* ── Insights API types ──────────────────────────────────── */

export type WindowStats = {
  totalBookings: number;
  utilizationPct: number;
  monthly: Array<{ month: string; checkouts: number; reservations: number }>;
  bySport: Array<{ sport: string; days: number }>;
  topBorrowers: Array<{ name: string; count: number }>;
  byKind: { CHECKOUT: number; RESERVATION: number };
  byDayOfWeek: number[];
  punctuality: { onTime: number; late: number };
  avgDurationDays: number;
  longestDurationDays: number;
  costPerUse: number | null;
  idleStreakDays: number | null;
  ageDays: number | null;
};

export type WindowKey = "30d" | "90d" | "1yr" | "all";

export type InsightsData = Record<WindowKey, WindowStats>;
