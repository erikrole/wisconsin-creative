export function formatScheduleReleaseCountdown(
  releaseAtIso: string | null | undefined,
  now = Date.now(),
  audience = "Assignees",
) {
  const fallback = "Release not scheduled. Review this crew before relying on these changes";
  if (!releaseAtIso) return fallback;

  const releaseAt = new Date(releaseAtIso).getTime();
  if (!Number.isFinite(releaseAt)) return fallback;

  const minutes = Math.ceil((releaseAt - now) / 60_000);
  if (minutes <= 0) return "Release time reached. Waiting for confirmation";
  return `Release scheduled in ${minutes} minute${minutes === 1 ? "" : "s"}. ${audience} are notified after release`;
}
