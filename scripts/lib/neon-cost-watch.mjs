// Pure helpers for the weekly Neon cost watch. Neon bills each branch past the plan's
// included ten by the hour, and compute by the hour it is awake, so the two numbers
// worth watching are the branch count and how many hours a day each compute stays up.
const DAY = 86_400_000, HOUR = 3_600_000;

/** Awake hours per UTC day per endpoint (or branch) from Neon's start/suspend operations. */
export function awakeHoursByDay(operations, { now = Date.now(), days = 3, activeEndpoints = [] } = {}) {
  const groups = new Map();
  for (const operation of operations) {
    if (!["start_compute", "suspend_compute"].includes(operation.action) || operation.status !== "finished") continue;
    const key = operation.endpoint_id ?? operation.branch_id;
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), { action: operation.action, at: Date.parse(operation.created_at) }]);
  }
  // A compute that is awake now and logged no start or suspend in the window has been up the whole time.
  for (const id of activeEndpoints) if (!groups.has(id)) groups.set(id, [{ action: "start_compute", at: 0 }]);
  const todayStart = Math.floor(now / DAY) * DAY, windowStart = todayStart - days * DAY, result = {};
  for (const [key, events] of groups) {
    events.sort((a, b) => a.at - b.at);
    const perDay = Object.fromEntries(Array.from({ length: days }, (_, i) => [new Date(windowStart + i * DAY).toISOString().slice(0, 10), 0]));
    let awakeSince = null;
    // An endpoint that was already awake when the history begins is counted from the window start.
    if (events[0]?.action === "suspend_compute") awakeSince = windowStart;
    for (const event of events) {
      if (event.action === "start_compute") { awakeSince ??= event.at; continue; }
      if (awakeSince !== null) addInterval(perDay, awakeSince, event.at, windowStart, todayStart);
      awakeSince = null;
    }
    if (awakeSince !== null) addInterval(perDay, awakeSince, now, windowStart, todayStart);
    result[key] = perDay;
  }
  return result;
}

function addInterval(perDay, from, to, windowStart, windowEnd) {
  for (let cursor = Math.max(from, windowStart), end = Math.min(to, windowEnd); cursor < end;) {
    const dayStart = Math.floor(cursor / DAY) * DAY, stop = Math.min(end, dayStart + DAY);
    const key = new Date(dayStart).toISOString().slice(0, 10);
    if (key in perDay) perDay[key] += (stop - cursor) / HOUR;
    cursor = stop;
  }
}

/** Findings for one project: too many branches, or a compute that barely sleeps. */
export function evaluateProject({ name, branches, awakeByDay }, { maxBranches, maxAwakeHoursPerDay }) {
  const findings = [];
  const live = branches.filter((branch) => branch.current_state !== "deleted").length;
  if (live > maxBranches) findings.push(`${name}: ${live} branches, ${live - maxBranches} over the ${maxBranches} included (about $1.46/month each).`);
  for (const [endpoint, perDay] of Object.entries(awakeByDay)) {
    const hours = Object.values(perDay), average = hours.reduce((sum, value) => sum + value, 0) / (hours.length || 1);
    if (average > maxAwakeHoursPerDay) findings.push(`${name}: compute ${endpoint} was awake ${average.toFixed(1)} hours a day on average over the last ${hours.length} days (limit ${maxAwakeHoursPerDay}).`);
  }
  return findings;
}
