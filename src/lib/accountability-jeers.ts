type AccountabilityJeerPerson = {
  userId: string;
  active: boolean;
  lateEventCount: number;
  activeOverdueCount: number;
  lastIncidentAt: string;
};

export const ACCOUNTABILITY_JEERS = [
  "Punctuality called about checkout; the clock sent it to voicemail.",
  "Checkout-to-return keeps follow-through on a long commute.",
  "Your due-date diplomacy deserves a tiny summit.",
  "The gear shelf appreciates a little less suspense.",
  "A reminder should not need a retirement plan.",
  "The checkout clipboard is requesting a cleaner final mark.",
  "Your handoff takes the scenic route with confidence.",
  "A simple gear return should not require a field guide.",
  "Return behavior: generous margins included.",
  "The clock has standards; your due date has amendments.",
  "Punctuality is a lovely theory; your habits keep testing it.",
  "A brisker closeout would improve the paperwork's posture.",
  "The gear queue could use a more confident merge.",
  "Your checkout timing gives urgency a broad definition.",
  "A shorter return cycle would simplify the handoff math.",
  "Follow-through should be a nudge, not a department.",
  "The reminder trail has become an endurance exercise.",
  "The scheduler deserves a less elastic assignment.",
  "The checklist favors checkmarks over interpretation.",
  "A neat return is operations' favorite small luxury.",
  "Your closeout pace gives the queue room to stretch.",
  "The operations log rewards a crisper ending.",
  "Return logistics are asking for a firmer handshake.",
  "A polished closeout leaves fewer loose ends to alphabetize.",
  "Your shelf habits give inventory a long memory.",
  "The handoff window has a talent for ambiguity.",
  "A tighter return loop would spare the checklist a few footnotes.",
  "A shorter paper trail would give follow-up fewer errands.",
  "Your routine has made nudging a core competency.",
  "The deadline deserves a less philosophical reading.",
  "A narrower return window would reduce the variables.",
  "The workflow would enjoy a return path with fewer moving parts.",
  "Your follow-through gives flexibility an impressive résumé.",
  "A cleaner return trail would lighten the admin load.",
  "The check-in/check-out routine could use fewer steps.",
  "Your checkout timing gives forms extra cardio.",
  "A little return discipline would calm the spreadsheet.",
  "The process would appreciate less interpretive flair.",
  "Your cadence makes patience a workplace skill.",
  "A firmer return habit would strengthen closeout.",
  "The gear room admires a decisive checkout.",
  "Your timing keeps the operations desk politely alert.",
  "A more compact return handoff would make the queue feel lighter.",
  "The due date appreciates a direct answer.",
  "The calendar is not a suggestion box for gear timing.",
  "A clean return handoff is the workflow's favorite shortcut.",
  "The queue would welcome forward momentum.",
  "Your pace turns checkout into a recurring agenda item.",
  "The forms like their return history concise.",
  "A polished return path keeps the process pleasantly simple.",
] as const;

const JEER_DECK_VERSION = "accountability-jeers:v1";

export function accountabilityLeaderboardFingerprint(
  leaderboard: ReadonlyArray<AccountabilityJeerPerson>,
) {
  return JSON.stringify(
    leaderboard.map((person, index) => [
      index,
      person.userId,
      person.active,
      person.lateEventCount,
      person.activeOverdueCount,
      person.lastIncidentAt,
    ]),
  );
}

function hashString(value: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function selectAccountabilityJeers(
  leaderboard: ReadonlyArray<AccountabilityJeerPerson>,
  count = 3,
) {
  const requestedCount = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  const drawCount = Math.min(requestedCount, leaderboard.length, ACCOUNTABILITY_JEERS.length);
  if (drawCount === 0) return [];

  const fingerprint = accountabilityLeaderboardFingerprint(leaderboard);
  const random = seededRandom(hashString(`${JEER_DECK_VERSION}:${fingerprint}`));
  const shuffled = [...ACCOUNTABILITY_JEERS];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = shuffled[index]!;
    const replacement = shuffled[swapIndex]!;
    shuffled[index] = replacement;
    shuffled[swapIndex] = current;
  }

  return shuffled.slice(0, drawCount);
}
