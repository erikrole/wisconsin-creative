import type { SignatureMemberGroup } from "@prisma/client";

const GROUP_ORDER: Record<SignatureMemberGroup, number> = {
  PLAYER: 0,
  COACHING_STAFF: 1,
  CREATIVE_STAFF: 2,
  SUPPORT_STAFF: 3,
};

type SortableSignatureMember = {
  name: string;
  jerseyNumber: number | null;
  roleGroup: SignatureMemberGroup;
  sourceOrder?: number | null;
};

function signatureLastName(name: string): string {
  const normalized = name.trim();
  if (normalized.includes(",")) return normalized.split(",", 1)[0] ?? normalized;
  const parts = normalized.split(/\s+/);
  return parts[parts.length - 1] ?? normalized;
}

export function compareSignatureRosterMembers(
  left: SortableSignatureMember,
  right: SortableSignatureMember,
): number {
  const groupDifference = GROUP_ORDER[left.roleGroup] - GROUP_ORDER[right.roleGroup];
  if (groupDifference !== 0) return groupDifference;

  if (left.roleGroup === "PLAYER" && right.roleGroup === "PLAYER") {
    const leftNumber = left.jerseyNumber ?? Number.POSITIVE_INFINITY;
    const rightNumber = right.jerseyNumber ?? Number.POSITIVE_INFINITY;
    if (leftNumber !== rightNumber) return leftNumber - rightNumber;
  }

  if (left.roleGroup !== "PLAYER" && right.roleGroup !== "PLAYER") {
    const leftSourceOrder = left.sourceOrder ?? Number.POSITIVE_INFINITY;
    const rightSourceOrder = right.sourceOrder ?? Number.POSITIVE_INFINITY;
    if (leftSourceOrder !== rightSourceOrder) return leftSourceOrder - rightSourceOrder;
  }

  const lastNameDifference = signatureLastName(left.name).localeCompare(signatureLastName(right.name), "en-US", { sensitivity: "base" });
  if (lastNameDifference !== 0) return lastNameDifference;
  return left.name.localeCompare(right.name, "en-US", { sensitivity: "base" });
}
