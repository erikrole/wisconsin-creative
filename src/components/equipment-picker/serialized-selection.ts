import type { ConflictInfo } from "@/components/equipment-picker/use-conflict-check";
import type { PickerAsset } from "@/components/EquipmentPicker";
import { hasSerializedTurnaroundBuffer } from "@/lib/booking-availability-window";

const ACTIVE_ALLOCATION_STATUSES = new Set(["CHECKED_OUT", "PENDING_PICKUP", "RESERVED"]);

function parseTime(value?: string | null) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

export function canSelectSerializedAssetForWindow(
  asset: Pick<PickerAsset, "computedStatus" | "currentHolder">,
  args: {
    startsAt?: string;
    conflict?: ConflictInfo;
  },
) {
  // A schedule conflict is a hard picker exclusion even when the asset's
  // inventory status still says AVAILABLE. The status describes the item, not
  // whether this requested window can use it.
  if (args.conflict) return false;
  if (asset.computedStatus === "AVAILABLE") return true;
  if (!ACTIVE_ALLOCATION_STATUSES.has(asset.computedStatus)) return false;

  const holderEndsAt = parseTime(asset.currentHolder?.endsAt);
  const requestedStartsAt = parseTime(args.startsAt);
  if (holderEndsAt === null || requestedStartsAt === null) return false;

  return hasSerializedTurnaroundBuffer({
    previousEndsAt: holderEndsAt,
    nextStartsAt: requestedStartsAt,
  });
}
