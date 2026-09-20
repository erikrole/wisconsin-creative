type VenueMappingOrderCandidate = {
  pattern: string;
  priority?: number | null;
  createdAt?: Date | string | null;
  id?: string | null;
};

export function isValidVenueMappingPattern(pattern: string) {
  try {
    new RegExp(pattern, "i");
    return true;
  } catch {
    return false;
  }
}

function compareVenueMappings(
  a: VenueMappingOrderCandidate,
  b: VenueMappingOrderCandidate,
) {
  const priorityDiff = (b.priority ?? 0) - (a.priority ?? 0);
  if (priorityDiff !== 0) return priorityDiff;

  const lengthDiff = b.pattern.length - a.pattern.length;
  if (lengthDiff !== 0) return lengthDiff;

  const createdAtA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const createdAtB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  if (createdAtA !== createdAtB) return createdAtA - createdAtB;

  return (a.id ?? a.pattern).localeCompare(b.id ?? b.pattern);
}

export function sortVenueMappings<T extends VenueMappingOrderCandidate>(mappings: T[]) {
  return [...mappings].sort(compareVenueMappings);
}

export function venueMappingMatches(pattern: string, ...searchTexts: string[]) {
  try {
    const matcher = new RegExp(pattern, "i");
    return searchTexts.some((text) => matcher.test(text));
  } catch {
    return false;
  }
}
