import type { BookingKind, BookingStatus, Role } from "@prisma/client";

export type CompanionRole = Extract<Role, "ADMIN" | "STAFF">;

export type CompanionProjection = {
  version: 1;
  revision: number;
  generatedAt: string;
  stats: {
    checkedOut: number;
    overdue: number;
    reserved: number;
    dueToday: number;
  };
  pendingPickupTotal: number;
  openBookings: Array<{
    id: string;
    title: string;
    endsAt: Date;
    refNumber: string | null;
    requester: { id: string; name: string; avatarUrl: string | null };
    location: { id: string; name: string };
    serializedItems: Array<{ id: string; name?: string; assetTag?: string }>;
    bulkItems: Array<{ id: string; name?: string; quantity?: number }>;
  }>;
  bookingActivity: Array<{
    id: string;
    title: string;
    kind: BookingKind;
    status: BookingStatus;
    startsAt: Date;
    endsAt: Date;
    updatedAt: Date;
    requester: { id: string; name: string; avatarUrl: string | null };
    location: { id: string; name: string };
    serializedItems: Array<{ id: string; name?: string; assetTag?: string }>;
    bulkItems: Array<{ id: string; name?: string; quantity?: number }>;
  }>;
  kioskDevices: Array<{
    id: string;
    name: string;
    location: { id: string; name: string };
    active: boolean;
    activated: boolean;
    lastSeenAt: Date | null;
    appVersion: string | null;
    appBuild: string | null;
    osVersion: string | null;
    deviceModel: string | null;
    pendingPickupCount: number;
    openCheckoutCount: number;
  }>;
};

type CompanionProjectionResponse = Omit<CompanionProjection, "kioskDevices"> & {
  kioskDevices: CompanionProjection["kioskDevices"];
  kioskAccess: "available" | "restricted";
};

export function projectionForRole(
  projection: CompanionProjection,
  role: CompanionRole,
): CompanionProjectionResponse {
  return {
    ...projection,
    kioskDevices: role === "ADMIN" ? projection.kioskDevices : [],
    kioskAccess: role === "ADMIN" ? "available" : "restricted",
  };
}
