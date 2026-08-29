export type TravelReadinessRequirement = {
  area: string;
  staffRequired: number;
  studentRequired: number;
};

export type TravelReadinessMember = {
  defaultTraveler: boolean;
  workerType: "FT" | "ST";
  primaryArea: string | null;
};

export type TravelReadinessGap = {
  area: string;
  workerType: "FT" | "ST";
  required: number;
  eligible: number;
  missing: number;
};

export type TravelReadiness = {
  mode: "EXPLICIT_TRAVEL" | "FULL_ROSTER_FALLBACK";
  status: "READY" | "GAPS" | "NO_TEMPLATE";
  effectivePoolSize: number;
  membersWithoutArea: number;
  gaps: TravelReadinessGap[];
};

/**
 * Compare saved away minimums with the roster pool an away event would use.
 * This is deliberately template-level readiness only; event availability,
 * time off, conflicts, and working-copy checks remain preview/apply concerns.
 */
export function evaluateTravelReadiness(
  requirements: TravelReadinessRequirement[],
  members: TravelReadinessMember[],
): TravelReadiness {
  const explicitTravel = members.some((member) => member.defaultTraveler);
  const effectivePool = explicitTravel
    ? members.filter((member) => member.defaultTraveler)
    : members;
  const activeRequirements = requirements.filter(
    (requirement) => requirement.staffRequired > 0 || requirement.studentRequired > 0,
  );
  const gaps = activeRequirements.flatMap((requirement) => {
    const workerRequirements = [
      { workerType: "FT" as const, required: requirement.staffRequired },
      { workerType: "ST" as const, required: requirement.studentRequired },
    ];
    return workerRequirements.flatMap(({ workerType, required }) => {
      if (required <= 0) return [];
      const eligible = effectivePool.filter(
        (member) => member.workerType === workerType && member.primaryArea === requirement.area,
      ).length;
      if (eligible >= required) return [];
      return [{
        area: requirement.area,
        workerType,
        required,
        eligible,
        missing: required - eligible,
      }];
    });
  });

  return {
    mode: explicitTravel ? "EXPLICIT_TRAVEL" : "FULL_ROSTER_FALLBACK",
    status: activeRequirements.length === 0 ? "NO_TEMPLATE" : gaps.length > 0 ? "GAPS" : "READY",
    effectivePoolSize: effectivePool.length,
    membersWithoutArea: effectivePool.filter((member) => !member.primaryArea).length,
    gaps,
  };
}
