"use client";

import { ItemThumbnailStack } from "@/components/ItemThumbnailStack";
import { UserAvatarGroup, type UserAvatarGroupUser } from "@/components/UserAvatarGroup";
import type { ItemThumb, EventSummary } from "../dashboard-types";
import { AREA_LABELS } from "@/types/areas";

export function GearAvatarStack({ items, totalCount }: { items: ItemThumb[]; totalCount: number }) {
  return (
    <ItemThumbnailStack
      items={items.map((item) => ({
        id: item.id,
        name: item.name || "Item",
        imageUrl: item.imageUrl,
      }))}
      totalCount={totalCount}
      max={items.length}
      surfaceClassName="border-background bg-muted"
    />
  );
}

export function ShiftAvatarStack({ assignedUsers }: { assignedUsers: EventSummary["assignedUsers"] }) {
  if (assignedUsers.length === 0) return null;

  const users: UserAvatarGroupUser[] = assignedUsers.map((u) => {
    const areaLabel = u.area ? AREA_LABELS[u.area] ?? u.area : null;
    return {
      id: u.id,
      name: u.name,
      avatarUrl: u.avatarUrl,
      label: areaLabel ? `${u.name} · ${areaLabel}` : u.name,
    };
  });

  return (
    <UserAvatarGroup
      users={users}
      max={5}
      avatarClassName="ring-0"
    />
  );
}
