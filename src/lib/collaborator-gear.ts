type BookingListItem = {
  id: string;
  refNumber: string | null;
  kind: string;
  status: string;
  title: string;
  requesterUserId: string;
  createdBy: string;
  locationId: string;
  startsAt: Date;
  endsAt: Date;
  createdAt: Date;
  updatedAt: Date;
  notes?: string | null;
  location: { id: string; name: string };
  requester?: { id: string; name: string; avatarUrl: string | null };
  serializedItems: Array<{
    id: string;
    assetId: string;
    allocationStatus: string;
    asset: {
      id: string;
      assetTag: string;
      name: string | null;
      brand: string | null;
      model: string | null;
      imageUrl: string | null;
    };
  }>;
  bulkItems: Array<{
    id: string;
    plannedQuantity: number;
    checkedOutQuantity: number;
    checkedInQuantity: number;
    bulkSku: { id: string; name: string; unit: string };
  }>;
  event?: unknown;
  events?: unknown;
};

export function sanitizeCollaboratorBooking<T extends BookingListItem>(booking: T) {
  return {
    id: booking.id,
    refNumber: booking.refNumber,
    kind: booking.kind,
    status: booking.status,
    title: booking.title,
    requesterUserId: booking.requesterUserId,
    createdBy: booking.createdBy,
    locationId: booking.locationId,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
    notes: booking.notes ?? null,
    location: booking.location,
    requester: booking.requester
      ? {
          id: booking.requester.id,
          name: booking.requester.name,
          avatarUrl: booking.requester.avatarUrl,
        }
      : undefined,
    serializedItems: booking.serializedItems.map((item) => ({
      id: item.id,
      assetId: item.assetId,
      allocationStatus: item.allocationStatus,
      asset: {
        id: item.asset.id,
        assetTag: item.asset.assetTag,
        name: item.asset.name,
        brand: item.asset.brand,
        model: item.asset.model,
        imageUrl: item.asset.imageUrl,
      },
    })),
    bulkItems: booking.bulkItems.map((item) => ({
      id: item.id,
      plannedQuantity: item.plannedQuantity,
      checkedOutQuantity: item.checkedOutQuantity,
      checkedInQuantity: item.checkedInQuantity,
      bulkSku: item.bulkSku,
    })),
  };
}

export function collaboratorBookingResponse<T extends BookingListItem>(
  booking: T,
  allowedActions: string[],
) {
  return {
    ...sanitizeCollaboratorBooking(booking),
    allowedActions,
  };
}

type PickerAsset = {
  id: string;
  assetTag: string;
  name: string | null;
  brand: string | null;
  model: string | null;
  imageUrl: string | null;
  computedStatus: string;
  location: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
  isFavorited?: boolean;
};

export function sanitizeCollaboratorPickerAsset(asset: PickerAsset) {
  return {
    id: asset.id,
    assetTag: asset.assetTag,
    name: asset.name,
    model: asset.model,
    imageUrl: asset.imageUrl,
    computedStatus: asset.computedStatus,
    availability: asset.computedStatus === "AVAILABLE" ? "AVAILABLE" : "UNAVAILABLE",
    location: asset.location,
    category: asset.category,
    categoryName: asset.category?.name ?? null,
    isFavorited: asset.isFavorited ?? false,
  };
}

type BulkCatalogItem = {
  id: string;
  name: string;
  imageUrl: string | null;
  locationName: string;
  locationId: string;
  category: string;
  categoryId: string | null;
  availableQuantity: number;
  isFavorited?: boolean;
};

type KitDetailForCollaborator = {
  members: Array<{
    asset: {
      currentHolder: { endsAt: string } | null;
    };
  }>;
};

/** Keep when the current hold ends so a kit can still be reserved after it. Drop who has it. */
export function sanitizeCollaboratorKitDetail<T extends KitDetailForCollaborator>(kit: T) {
  return {
    ...kit,
    members: kit.members.map((member) => ({
      ...member,
      asset: {
        ...member.asset,
        currentHolder: member.asset.currentHolder
          ? { endsAt: member.asset.currentHolder.endsAt }
          : null,
      },
    })),
  };
}

export function sanitizeCollaboratorBulkItem(item: BulkCatalogItem) {
  return {
    id: item.id,
    kind: "bulk" as const,
    name: item.name,
    imageUrl: item.imageUrl,
    location: { id: item.locationId, name: item.locationName },
    category: { id: item.categoryId, name: item.category },
    availability: item.availableQuantity > 0 ? "AVAILABLE" : "UNAVAILABLE",
    availableQuantity: Math.max(0, item.availableQuantity),
    isFavorited: item.isFavorited ?? false,
  };
}
