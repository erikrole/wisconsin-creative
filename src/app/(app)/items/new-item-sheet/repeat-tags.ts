export type RepeatTagAsset = {
  assetTag?: string | null;
};

export type RepeatTagSummary = {
  base: string;
  existingCount: number;
  nextTag: string;
  matchedTags: string[];
};

function normalizeTag(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const tagSorter = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function getRepeatTagBase(value: string) {
  const normalized = normalizeTag(value);
  return normalized.replace(/\s+\d+$/, "");
}

export function getNextSequentialAssetTag(value: string) {
  const normalized = normalizeTag(value);
  if (!normalized) return "";
  const numbered = normalized.match(/^(.*\S)\s+(\d+)$/);
  if (!numbered) return `${normalized} 2`;
  return `${numbered[1]} ${Number(numbered[2]) + 1}`;
}

export function summarizeRepeatTags(value: string, assets: RepeatTagAsset[]): RepeatTagSummary | null {
  const typedBase = getRepeatTagBase(value);
  if (!typedBase) return null;

  const typedBaseLower = typedBase.toLowerCase();
  const candidateBases = new Map<string, string>();

  for (const asset of assets) {
    const tag = typeof asset.assetTag === "string" ? normalizeTag(asset.assetTag) : "";
    if (!tag) continue;

    const candidateBase = getRepeatTagBase(tag);
    if (candidateBase.toLowerCase().startsWith(typedBaseLower)) {
      candidateBases.set(candidateBase.toLowerCase(), candidateBase);
    }
  }

  const summaries = [...candidateBases.values()]
    .map((base) => buildRepeatTagSummary(base, assets))
    .filter((summary): summary is RepeatTagSummary => summary !== null && summary.existingCount > 0)
    .sort((a, b) => {
      const aExact = a.base.toLowerCase() === typedBaseLower;
      const bExact = b.base.toLowerCase() === typedBaseLower;
      if (aExact !== bExact) return aExact ? -1 : 1;
      if (a.existingCount !== b.existingCount) return b.existingCount - a.existingCount;
      if (a.base.length !== b.base.length) return a.base.length - b.base.length;
      return tagSorter.compare(a.base, b.base);
    });

  return summaries[0] ?? null;
}

function buildRepeatTagSummary(base: string, assets: RepeatTagAsset[]): RepeatTagSummary | null {
  const matcher = new RegExp(`^${escapeRegExp(base)}(?:\\s+(\\d+))?$`, "i");
  let highestNumber = 0;
  const matchedTags: string[] = [];

  for (const asset of assets) {
    const tag = typeof asset.assetTag === "string" ? normalizeTag(asset.assetTag) : "";
    const match = tag.match(matcher);
    if (!match) continue;

    matchedTags.push(tag);
    const numericSuffix = match[1] ? Number(match[1]) : 1;
    if (Number.isFinite(numericSuffix)) {
      highestNumber = Math.max(highestNumber, numericSuffix);
    }
  }

  return {
    base,
    existingCount: matchedTags.length,
    nextTag: highestNumber > 0 ? `${base} ${highestNumber + 1}` : base,
    matchedTags,
  };
}
