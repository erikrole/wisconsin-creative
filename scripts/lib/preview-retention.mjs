export function previewRetentionDecision({ exists, openPullRequest, pinned, deletedAt, lastSeenAt, now = Date.now(), graceDays = 7 }) {
  if (exists || openPullRequest) return "referenced";
  if (pinned) return "pinned";
  if (!deletedAt) return "record-deletion";
  const deleted = Date.parse(deletedAt), lastSeen = Date.parse(lastSeenAt);
  if (!Number.isFinite(deleted) || !Number.isFinite(lastSeen)) throw new Error("Invalid preview retention timestamps; refusing cleanup");
  const grace = graceDays * 86_400_000;
  return now - deleted >= grace && now - lastSeen >= grace ? "eligible" : "retained";
}
