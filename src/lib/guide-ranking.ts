import { Role, ShiftArea } from "@prisma/client";

export type GuideAudience = {
  role: Role;
  primaryArea: ShiftArea | null;
  areaAssignments: Array<{ area: ShiftArea; isPrimary?: boolean }>;
};

export type RankableGuide = {
  id: string;
  title: string;
  targetRoles: Role[];
  targetAreas: ShiftArea[];
  featured: boolean;
  featuredRank: number | null;
  updatedAt: Date | string;
};

function guidePersonalizationScore(guide: RankableGuide, audience: GuideAudience): number {
  let score = 0;

  if (guide.targetRoles.length === 0) score += 5;
  else if (guide.targetRoles.includes(audience.role)) score += 30;
  else score -= 10;

  if (guide.targetAreas.length === 0) score += 5;
  else if (audience.primaryArea && guide.targetAreas.includes(audience.primaryArea)) score += 45;
  else if (audience.areaAssignments.some((assignment) => guide.targetAreas.includes(assignment.area))) score += 25;
  else score -= 10;

  return score;
}

export function guidePersonalizationReason(guide: RankableGuide, audience: GuideAudience): string {
  if (guide.featured) return "Featured";
  if (audience.primaryArea && guide.targetAreas.includes(audience.primaryArea)) {
    return `For ${areaLabel(audience.primaryArea)}`;
  }
  const assignedArea = audience.areaAssignments.find((assignment) => guide.targetAreas.includes(assignment.area));
  if (assignedArea) return `For ${areaLabel(assignedArea.area)}`;
  if (guide.targetRoles.includes(audience.role)) return `For ${roleLabel(audience.role)}`;
  return "General";
}

export function sortGuidesForAudience<T extends RankableGuide>(guides: T[], audience: GuideAudience): T[] {
  return [...guides].sort((a, b) => {
    if (a.featured !== b.featured) return a.featured ? -1 : 1;

    if (a.featured && b.featured) {
      const rankA = a.featuredRank ?? Number.MAX_SAFE_INTEGER;
      const rankB = b.featuredRank ?? Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;
    }

    const scoreDiff = guidePersonalizationScore(b, audience) - guidePersonalizationScore(a, audience);
    if (scoreDiff !== 0) return scoreDiff;

    const updatedDiff = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    if (updatedDiff !== 0) return updatedDiff;

    return a.title.localeCompare(b.title);
  });
}

function roleLabel(role: Role) {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

function areaLabel(area: ShiftArea) {
  const labels: Record<ShiftArea, string> = {
    VIDEO: "Video",
    PHOTO: "Photo",
    GRAPHICS: "Graphics",
    SOCIAL: "Social",
    COMMS: "Comms",
    LIVE_PRODUCTION: "Live Production",
  };
  return labels[area];
}
