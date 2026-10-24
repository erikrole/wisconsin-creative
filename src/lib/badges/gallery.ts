import { Role } from "@prisma/client";
import type { AuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isHiddenUntilEarnedBadge, isPrivateHolderBadge } from "./display";
import { badgeEligibleUserWhere, getUserBadgeProfile } from "./queries";

export type BadgeGalleryHolder = {
  userId: string;
  awardedAt: string;
};

export type BadgeGalleryBadge = {
  id: string;
  key: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  kind: string;
  trigger: string;
  threshold: number | null;
  active: boolean;
  sortOrder: number;
  rarity: string;
  rarityProvisional: boolean;
  /** True for a surprise the viewer has not earned. Name, copy and icon are withheld. */
  mystery: boolean;
  /** True when the gallery shows how many people hold it but never who. */
  privateHolders: boolean;
  holderCount: number;
  /** Newest first. Empty when holders are private or peers are not visible. */
  holders: BadgeGalleryHolder[];
  earnedByViewer: boolean;
  viewerAwardedAt: string | null;
  viewerSource: string | null;
  progressCurrent: number | null;
  progressTarget: number | null;
};

export type BadgeGalleryPerson = {
  id: string;
  name: string;
  avatarUrl: string | null;
  role: Role;
  /** Earned badges, not counting the private-holder bloopers. */
  count: number;
};

export type BadgeGallery = {
  viewerId: string;
  /** Whether this viewer can see other people's badges. */
  canCompare: boolean;
  badges: BadgeGalleryBadge[];
  /** Everyone who can earn badges, most badges first. Only the viewer when `canCompare` is false. */
  people: BadgeGalleryPerson[];
  /** Surprises nobody has found yet, so they are not drawn at all. */
  undiscoveredSurprises: number;
};

const MYSTERY_NAME = "Surprise badge";
const MYSTERY_DESCRIPTION = "A hidden badge. Its name and how to earn it stay secret until you earn it yourself.";

/**
 * One read for the team badge gallery: the viewer's own shelf (progress, rarity,
 * and the same self-repair the profile tab runs), plus who holds each badge
 * among the people who can earn one.
 *
 * Peer visibility follows `badges.peerVisible`, the switch the profile tab
 * already honours. When it is off, a student still gets the whole catalog and
 * their own progress, just without anyone else in it; staff and admins always
 * see the team, as they can on any profile.
 */
export async function getBadgeGallery(viewer: AuthUser): Promise<BadgeGallery> {
  const profile = await getUserBadgeProfile(viewer, viewer.id);
  const canCompare = profile.peerVisible || viewer.role === Role.ADMIN || viewer.role === Role.STAFF;

  const definitionIds = profile.badges.map((badge) => badge.id);
  const [people, awards] = await Promise.all([
    db.user.findMany({
      where: canCompare ? badgeEligibleUserWhere : { id: viewer.id },
      select: { id: true, name: true, avatarUrl: true, role: true },
      orderBy: { name: "asc" },
    }),
    db.studentBadge.findMany({
      where: {
        definitionId: { in: definitionIds },
        user: canCompare ? badgeEligibleUserWhere : { id: viewer.id },
      },
      orderBy: [{ awardedAt: "desc" }, { id: "asc" }],
      select: { userId: true, definitionId: true, awardedAt: true },
    }),
  ]);

  const holdersByDefinition = new Map<string, BadgeGalleryHolder[]>();
  for (const award of awards) {
    const list = holdersByDefinition.get(award.definitionId) ?? [];
    list.push({ userId: award.userId, awardedAt: award.awardedAt.toISOString() });
    holdersByDefinition.set(award.definitionId, list);
  }

  const privateDefinitionIds = new Set(
    profile.badges.filter((badge) => isPrivateHolderBadge(badge.key)).map((badge) => badge.id),
  );
  const countByUser = new Map<string, number>();
  for (const award of awards) {
    if (privateDefinitionIds.has(award.definitionId)) continue;
    countByUser.set(award.userId, (countByUser.get(award.userId) ?? 0) + 1);
  }

  let undiscoveredSurprises = 0;
  const badges: BadgeGalleryBadge[] = [];
  for (const badge of profile.badges) {
    const holders = holdersByDefinition.get(badge.id) ?? [];
    // Served holder counts come from the whole population, so they stay
    // honest even when this viewer only sees themselves.
    const holderCount = canCompare ? holders.length : badge.holders;
    const mystery = !badge.earned && isHiddenUntilEarnedBadge(badge.key);
    // A retired badge only appears as history the viewer holds.
    if (!badge.active && !badge.earned) continue;
    if (mystery && (!badge.active || holderCount === 0)) {
      if (badge.active) undiscoveredSurprises += 1;
      continue;
    }
    const privateHolders = isPrivateHolderBadge(badge.key);

    badges.push({
      id: badge.id,
      key: mystery ? `mystery_${badge.id}` : badge.key,
      name: mystery ? MYSTERY_NAME : badge.name,
      description: mystery ? MYSTERY_DESCRIPTION : badge.description,
      icon: mystery ? "Sparkles" : badge.icon,
      category: mystery ? "MILESTONE" : badge.category,
      kind: mystery ? "RULE" : badge.kind,
      trigger: mystery ? "hidden" : badge.trigger,
      threshold: mystery ? null : badge.threshold,
      active: badge.active,
      sortOrder: badge.sortOrder,
      rarity: badge.rarity,
      rarityProvisional: badge.rarityProvisional,
      mystery,
      privateHolders,
      holderCount,
      holders: privateHolders || !canCompare ? [] : holders,
      earnedByViewer: badge.earned,
      viewerAwardedAt: badge.awardedAt,
      viewerSource: badge.source,
      progressCurrent: mystery ? null : badge.progressCurrent,
      progressTarget: mystery ? null : badge.progressTarget,
    });
  }

  return {
    viewerId: viewer.id,
    canCompare,
    badges,
    people: people
      .map((person) => ({ ...person, count: countByUser.get(person.id) ?? 0 }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    undiscoveredSurprises,
  };
}
